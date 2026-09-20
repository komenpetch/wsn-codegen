import { describe, it, expect } from "vitest";
import { mustFind, mustReplace } from "../src/engine/emitted";
import { installScheduler } from "../src/engine/scheduler";
import { bindNodeIdentity } from "../src/engine/nodeIdentity";
import { installAppTransmit } from "../src/engine/appTransmit";
import type { PacketModel } from "../src/engine/packetModel";
import type { EncodedMachine, GeneratedTree } from "../src/engine/types";

// Seventeen passes rewrite the emitted C++ by finding an anchor in it, and the
// language makes the failure silent by default: `String.replace` with no match
// returns the string unchanged, `indexOf` returns -1 for the caller to ignore.
//
// Seven of the seventeen used to take that exit. Most surfaced at clang, since
// the half that did splice then referenced what the other half never declared.
// Two did not: a scheduler whose timer hook never matched and an identity
// binding whose initialize() never matched both produce a module that compiles,
// links, runs its full sixty seconds and executes no model events. This project
// has already paid for that shape twice.
//
// These tests are the guard on the guard. They do not check WHICH anchors exist
// -- the generation tests do that by producing a working module -- they check
// that a missing anchor is an ERROR rather than a shrug.
describe("a missing anchor is a precondition failure, not a no-op", () => {
  it("mustFind names the pass and the anchor it wanted", () => {
    expect(() => mustFind("some emitted code", "Define_Module(", "myPass"))
      .toThrow(/myPass.*Define_Module/s);
    expect(mustFind("abcDefine_Module(", "Define_Module(", "myPass")).toBe(3);
  });

  it("mustReplace throws instead of returning the text unchanged", () => {
    expect(() => mustReplace("some emitted code", /nothing here/, "x", "myPass"))
      .toThrow(/myPass/);
    expect(mustReplace("a-b", "-", "+", "myPass")).toBe("a+b");
  });

  // A global regex still replaces every match even though mustReplace has
  // already .test()ed it — String.prototype.replace resets lastIndex itself.
  // Kept because it pins that behaviour, not because a guard depends on it.
  it("replaces every match of a global regex", () => {
    expect(mustReplace("x x x", /x/g, "y", "myPass")).toBe("y y y");
  });

  const bareModel = { events: [], variables: [], variableTypes: new Map() } as unknown as EncodedMachine;
  const tree = (files: [string, string][]): GeneratedTree =>
    files.map(([path, content]) => ({ path, content }));

  it("installScheduler refuses a tree with no .cc rather than emitting no scheduler", () => {
    // The documented historical failure: "three files still written, no
    // scheduler and no medium binding -- indistinguishable from a model that
    // simply has no network layer."
    expect(() => installScheduler(tree([["X.h", "  public:\n"]]), bareModel, "X", []))
      .toThrow(/installScheduler/);
  });

  it("bindNodeIdentity refuses a .cc whose initialize() it cannot find", () => {
    expect(() => bindNodeIdentity(
      tree([["X.h", "    // ── Event-B machine state ──\n"], ["X.cc", "void X::somethingElse() {\n}\n"]]),
      bareModel, [], "X"))
      .toThrow(/bindNodeIdentity/);
  });

  // ⚠ AND FINDING AN ANCHOR IS NOT THE SAME AS FINDING THE RIGHT ONE, which is
  // the gap `mustFind` cannot close on its own: it proves a match exists, not
  // that it is the one the pass meant.
  //
  // The .cc reads `par("inDests")` on the SIMPLE MODULE, so the .ned must
  // declare it on that type. A network-layer .ned holds six more matches for
  // `    parameters:` — the `<Name>NetworkLayer` wrapper and its four
  // submodules, whose deeper indentation still contains the anchor as a
  // SUBSTRING. A declaration landing on any of them is a parameter the module
  // never sees, and OMNeT++ refuses it at setup with "unknown parameter" —
  // exactly what emitting the .ned and the .cc from one derivation exists to
  // prevent. It matched correctly only because `simple` is emitted first.
  const openCtx = [{
    name: "C", sets: [], constants: [],
    axioms: [{ label: "a0", text: "Dests ⊆ ND" }],
  }];
  const shell = (ned: string): GeneratedTree => tree([
    ["X.h", "    // ── Event-B machine state ──\n"],
    ["X.cc", "void X::initialize(int stage) {\n}\n"],
    ["X.ned", ned],
  ]);

  it("declares the node-subset parameter on the simple module, not the first match", () => {
    // The wrapper is written FIRST here, which is what the old bare .replace
    // would have taken. Its order in the real emitter is an accident of
    // netProtocolShell running after codeEmitter.
    const out = bindNodeIdentity(shell(
      "module XNetworkLayer like INetworkLayer\n{\n    parameters:\n"
      + "        @display(\"i=block/layer\");\n"
      + "    submodules:\n        arp: Arp {\n            parameters:\n                x = 1;\n        }\n}\n\n"
      + "simple X like IApp\n{\n    parameters:\n        int payloadLength = default(10);\n}\n",
    ), bareModel, openCtx, "X");
    const ned = out.find((f) => f.path.endsWith(".ned"))!.content;

    const decl = ned.indexOf("bool inDests = default(false);");
    expect(decl).toBeGreaterThan(-1);
    // The declaration must come after `simple X` and before its own closing
    // brace — i.e. inside the type the .cc names, not the wrapper above it.
    expect(decl).toBeGreaterThan(ned.indexOf("simple X"));
    expect(ned.slice(0, ned.indexOf("simple X"))).not.toContain("inDests");
    // And the wrapper's own section is left exactly as it was.
    expect(ned).toContain("module XNetworkLayer like INetworkLayer\n{\n    parameters:\n        @display");
  });

  it("refuses a .ned whose simple module it cannot find", () => {
    expect(() => bindNodeIdentity(
      shell("module XNetworkLayer like INetworkLayer\n{\n    parameters:\n}\n"),
      bareModel, openCtx, "X"))
      .toThrow(/bindNodeIdentity.*simple X/s);
  });

  it("refuses a simple module that declares no parameters section", () => {
    expect(() => bindNodeIdentity(
      shell("simple X like IApp\n{\n    gates:\n        input in;\n}\n"),
      bareModel, openCtx, "X"))
      .toThrow(/bindNodeIdentity.*parameters/s);
  });

  // ⚠ THE APPLICATION TRANSMIT TOOK THE SILENT EXIT UNTIL 2026-09-21, while the
  // closing anchor two lines below it in the same function already threw, and
  // the NETWORK branch already refused on this very marker (mediumBinding: "the
  // shell's shape changed"). Absent, the module keeps SensorApp's placeholder
  // ByteCountChunk instead of the model's packet AND the sender-side drain is
  // never emitted — so `sentDown` grows one entry per transmission and both of
  // pM1's cleanup events die for every packet the node ever sent. It compiles,
  // links and runs either way, which is why only a thrown error catches it.
  it("installAppTransmit refuses a .cc with no transmit block to replace", () => {
    const pm = { lattice: { tagOf: new Map([["DATA", 0]]) } } as unknown as PacketModel;
    expect(() => installAppTransmit(
      tree([
        ["X.h", "    // Event-B events, one guarded bool method each\n"],
        ["X.cc", "bool X::send_down(Node x, PktId pkt) {\n    return true;\n}\n"],
      ]), "X", pm))
      .toThrow(/appTransmit/);
  });
});

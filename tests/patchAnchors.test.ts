import { describe, it, expect } from "vitest";
import { mustFind, mustReplace } from "../src/engine/emitted";
import { installScheduler } from "../src/engine/scheduler";
import { bindNodeIdentity } from "../src/engine/nodeIdentity";
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
});

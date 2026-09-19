import { describe, it, expect } from "vitest";
import { addMissingPacketTypeConstants } from "../src/engine/postEmit";
import type { GeneratedTree } from "../src/engine/types";

// `addMissingPacketTypeConstants` declares a bare int for each packet-type tag,
// because the rule catalog emits comparisons like `type.at(pkt) == BEACON` and
// a partition axiom proves only set membership, never a value. Its own comment
// says it skips a tag that is "already declared … rather than risk a
// redefinition" — but it only ever looked for ONE spelling.
//
// ⚠ The context emitter has two. A partition's SINGLETON part becomes an
// element (`inline const int DATA = 0;`), and its NON-SINGLETON part becomes a
// set (`inline std::set<int> CONTROL = {1};`). `partition(TYPE, CONTROL,
// {DATA})` with nothing splitting CONTROL further makes CONTROL both a set by
// its axiom and a lattice leaf by having no children, so the tag was declared a
// second time as `const int` beside the set:
//
//   error: redefinition of 'CONTROL' with a different type: 'const int' vs 'std::set<int>'
//
// The bare int was dead in any case — the emitted code reaches the enum as
// `PktType::CONTROL` and the set as `CONTROL.count(...)`, and never the
// constant.
const header = (decls: string): GeneratedTree => [
  { path: "X.h", content: `${decls}\n// ---- PPkt: the packet pattern class\nclass PPkt {};\n` },
  { path: "X.cc", content: "" },
];

const emitted = (t: GeneratedTree) => t.find((f) => f.path.endsWith(".h"))!.content;

describe("addMissingPacketTypeConstants skips a name the context already declares", () => {
  it("does not redeclare a tag already emitted as a SET", () => {
    const out = emitted(addMissingPacketTypeConstants(
      header("inline std::set<int> CONTROL = {1};"), new Map([["CONTROL", 1]])));
    expect(out).not.toContain("inline const int CONTROL");
    expect(out).toContain("inline std::set<int> CONTROL = {1};");
  });

  it("still does not redeclare a tag already emitted as an INT", () => {
    // The case the original check handled; it must not regress.
    const out = emitted(addMissingPacketTypeConstants(
      header("inline const int DATA = 0;"), new Map([["DATA", 0]])));
    expect(out.match(/inline const int DATA/g)).toHaveLength(1);
  });

  it("still declares a tag the context declares in neither spelling", () => {
    // BEACON/ROUTE come from a sub-partition, which proves membership but pins
    // no value, so the context emits nothing for them and this pass must.
    const out = emitted(addMissingPacketTypeConstants(
      header("inline std::set<int> CONTROL = {1, 2};"), new Map([["ROUTE", 1], ["BEACON", 2]])));
    expect(out).toContain("inline const int ROUTE = 1;");
    expect(out).toContain("inline const int BEACON = 2;");
  });

  it("matches whole identifiers, so a longer name is not mistaken for the tag", () => {
    // `CONTROL_STATUS` declared as a set must not suppress the CONTROL tag.
    const out = emitted(addMissingPacketTypeConstants(
      header("inline std::set<int> CONTROL_STATUS = {7};"), new Map([["CONTROL", 1]])));
    expect(out).toContain("inline const int CONTROL = 1;");
  });
});

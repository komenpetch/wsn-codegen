import { describe, it, expect } from "vitest";
import { generate, generateMerged, MODULE_NAME } from "../src/engine/pipeline";
import { releaseNodeIdentity } from "../src/engine/nodeIdentity";
import { loadProject } from "../scripts/projects";
import type { GeneratedTree } from "../src/engine/types";

// ND and the node subsets the harness fills (Dests, Destination, Actuators) are
// namespace-scope sets: one per program, shared by every module, and they outlive
// the network. Each node puts its own id in at initialisation. OMNeT++'s
// deleteNetwork() deletes every module and then reissues module ids from the
// start (csimulation.cc:521, 536), so a second network in the same process
// gets the same ids, and a set nothing empties still holds the first network's
// members. Measured 2026-10-18: V4 then Parent360 in one Qtenv window left the
// sink in Dests, so in Parent360 it never beaconed and no tree formed (run 1 of
// a two-run process ends at event #61386 instead of #92074). So a node takes its
// id out again when its module is destroyed.
const fileOf = (tree: GeneratedTree, ext: string) => tree.find((f) => f.path.endsWith(ext))!.content;

// The namespace-scope sets this module puts its own id into.
const insertedSets = (tree: GeneratedTree): string[] => {
  const h = fileOf(tree, ".h"), cc = fileOf(tree, ".cc");
  const shared = new Set([...h.matchAll(/^inline std::set<int> (\w+)[ ;=]/gm)].map((m) => m[1]));
  return [...cc.matchAll(/^\s*(?:if \(par\("\w+"\)\.boolValue\(\)\) )?(\w+)\.insert\(myNodeId\);/gm)]
    .map((m) => m[1]).filter((n) => shared.has(n)).sort();
};

// The destructor's whole text, up to its matching closing brace.
const destructorOf = (tree: GeneratedTree): string => {
  const cc = fileOf(tree, ".cc");
  const at = cc.indexOf(`${MODULE_NAME}::~${MODULE_NAME}() {`);
  expect(at, "the destructor is emitted").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = cc.indexOf("{", at); i < cc.length; i++) {
    if (cc[i] === "{") depth++;
    else if (cc[i] === "}" && --depth === 0) return cc.slice(at, i + 1);
  }
  throw new Error("the destructor has no closing brace");
};
const erasedSets = (dtor: string): string[] =>
  [...dtor.matchAll(/(\w+)\.erase\(myNodeId\);/g)].map((m) => m[1]).sort();

const networkOutputs: [string, () => GeneratedTree, string[]][] = [
  ["MintRoute M4 (network branch)", () => generate(loadProject("MintRoute"), "M4", MODULE_NAME, 2), ["ND"]],
  ["RTMCS M6 (network branch)", () => generate(loadProject("RTMCS"), "M6", MODULE_NAME, 2),
    ["Actuators", "Destination", "ND"]],
  ["structure 3", () => generateMerged(loadProject("AppLayer"), undefined, 3), ["Dests", "ND"]],
  ["structure 3, aodv", () => generateMerged(loadProject("AppLayer"), undefined, 3, undefined, true, "aodv"),
    ["Dests", "ND"]],
  ["structure 4", () => generateMerged(loadProject("AppLayer"), undefined, 4), ["Dests", "ND"]],
  ["structure 4, aodv", () => generateMerged(loadProject("AppLayer"), undefined, 4, undefined, true, "aodv"),
    ["Dests", "ND"]],
];

describe("a node takes its id out of the shared node sets when its module is destroyed", () => {
  for (const [name, make, sets] of networkOutputs) {
    it(`${name}: the destructor erases exactly the sets initialize inserts into`, () => {
      const tree = make();
      // Pinned, so the scan cannot pass by finding nothing.
      expect(insertedSets(tree)).toEqual(sets);
      const dtor = destructorOf(tree);
      expect(erasedSets(dtor)).toEqual(sets);
      // The destructor's own work is kept.
      expect(dtor).toMatch(/cancelAndDelete\(\w+\);/);
    });
  }

  for (const v of [1, 2] as const) {
    it(`structure ${v}: puts no id in a shared set, so erases none`, () => {
      const tree = generateMerged(loadProject("AppLayer"), undefined, v);
      expect(insertedSets(tree)).toEqual([]);
      expect(fileOf(tree, ".cc")).not.toContain(".erase(myNodeId)");
    });
  }
});

describe("releaseNodeIdentity", () => {
  const H = [
    "inline std::set<int> ND;  // C0 axm0_1",
    "inline std::set<int> Dests;  // C0 axm0_3",
    "class M {",
    "    std::set<int> mine;",
    "};",
  ].join("\n");
  const init = [
    "void M::initialize(int stage) {",
    "    if (stage == 1) {",
    "        myNodeId = 7;",
    "        ND.insert(myNodeId);",
    "        if (par(\"inDests\").boolValue()) Dests.insert(myNodeId);",
    "        mine.insert(myNodeId);",
    "    }",
    "}",
  ].join("\n");
  const tree = (cc: string): GeneratedTree => [
    { path: "M.h", content: H },
    { path: "M.cc", content: cc },
    { path: "M.ned", content: "simple M {}" },
  ];

  it("turns a one-line destructor into a block that keeps its statement and erases each shared set", () => {
    const out = releaseNodeIdentity(tree(`M::~M() { cancelAndDelete(t); }\n\n${init}\n`), "M");
    const cc = fileOf(out, ".cc");
    expect(cc).toMatch(/M::~M\(\) \{\n {4}cancelAndDelete\(t\);\n(?: {4}\/\/[^\n]*\n)+ {4}ND\.erase\(myNodeId\);\n {4}Dests\.erase\(myNodeId\);\n\}\n/);
  });

  it("appends to a multi-line destructor before its closing brace, keeping every line", () => {
    const out = releaseNodeIdentity(
      tree(`M::~M() {\n    cancelAndDelete(a);\n    cancelAndDelete(b);\n}\n\n${init}\n`), "M");
    const cc = fileOf(out, ".cc");
    expect(cc).toMatch(/M::~M\(\) \{\n {4}cancelAndDelete\(a\);\n {4}cancelAndDelete\(b\);\n(?: {4}\/\/[^\n]*\n)+ {4}ND\.erase\(myNodeId\);\n {4}Dests\.erase\(myNodeId\);\n\}\n/);
  });

  it("leaves a set that is the module's own member alone: it goes with the module", () => {
    const out = releaseNodeIdentity(tree(`M::~M() { cancelAndDelete(t); }\n\n${init}\n`), "M");
    expect(fileOf(out, ".cc")).not.toContain("mine.erase(myNodeId)");
  });

  it("changes nothing when the module puts its id in no shared set", () => {
    const t = tree("M::~M() { cancelAndDelete(t); }\n\nvoid M::initialize(int stage) {\n}\n");
    expect(releaseNodeIdentity(t, "M")).toEqual(t);
  });

  it("refuses when ids are put in a shared set and there is no destructor to take them out", () => {
    expect(() => releaseNodeIdentity(tree(`${init}\n`), "M")).toThrow(/destructor/);
  });
});

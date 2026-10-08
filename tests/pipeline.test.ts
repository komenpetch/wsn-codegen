import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  generate, generateMerged, machineNames, leafMachine, MODULE_NAME,
} from "../src/engine/pipeline";

const load = (n: string) =>
  ({ name: `${n}.bum`, xml: readFileSync(`tests/fixtures/shdecom/${n}.bum`, "utf8") });
const all = () => [load("pM1"), load("uM2"), load("pM3")];

describe("pipeline.generate (single target)", () => {
  it("generates 3 files for a named target machine", () => {
    const tree = generate(all(), "pM3", "EbWsn");
    expect(tree.map((f) => f.path).sort()).toEqual(["EbWsn.cc", "EbWsn.h", "EbWsn.ned"]);
    expect(tree.find((f) => f.path === "EbWsn.cc")!.content).toContain("bool EbWsn::sensing(");
  });
  it("throws a clear error for an empty selection", () => {
    expect(() => generate([], "pM1", "X")).toThrow(/No Event-B/);
  });
});

describe("pipeline.machineNames / leafMachine / MODULE_NAME", () => {
  it("lists every machine in the project (name-agnostic)", () => {
    expect(machineNames(all())).toEqual(["pM1", "uM2", "pM3"]);
  });
  it("lists machines in refinement order (base → leaf), not file order", () => {
    // Alphabetical/directory order is pM1, pM3, uM2 — the chain is pM1→uM2→pM3.
    expect(machineNames([load("pM3"), load("pM1"), load("uM2")]))
      .toEqual(["pM1", "uM2", "pM3"]);
  });
  it("finds the most-refined (leaf) machine regardless of file order", () => {
    expect(leafMachine(all())).toBe("pM3");
    expect(leafMachine([load("pM3"), load("pM1"), load("uM2")])).toBe("pM3");
  });
  // One name for every generated module (user, 2026-10-09). It used to be
  // derived per machine (Pm3Wsn, Um4Wsn, M4Wsn …); a different leaf machine must
  // now give the SAME name, which is the whole point of the change.
  it("names every module EbWsn, whatever the leaf machine", () => {
    expect(MODULE_NAME).toBe("EbWsn");
    expect(generateMerged([load("pM1")]).map((f) => f.path).sort())
      .toEqual(["EbWsn.cc", "EbWsn.h", "EbWsn.ned"]);
    expect(generateMerged(all()).map((f) => f.path).sort())
      .toEqual(["EbWsn.cc", "EbWsn.h", "EbWsn.ned"]);
  });
});

describe("pipeline.generateMerged (whole project → one module)", () => {
  it("emits exactly 3 files, merging the chain into the leaf machine", () => {
    const tree = generateMerged(all());
    expect(tree.map((f) => f.path).sort()).toEqual(["EbWsn.cc", "EbWsn.h", "EbWsn.ned"]);
    // The merged module carries state/events from across the whole chain: the
    // sensing event added at pM3 AND events introduced back at pM1.
    const cc = tree.find((f) => f.path === "EbWsn.cc")!.content;
    expect(cc).toContain("bool EbWsn::sensing(");   // added at pM3 (leaf)
    // send_up is introduced at pM1 (base) and emitted under its SensorApp name
    expect(cc).toContain("bool EbWsn::socketDataArrived(");
  });
  it("merges regardless of file order (leaf is content, not position)", () => {
    const tree = generateMerged([load("pM3"), load("pM1"), load("uM2")]);
    expect(tree.map((f) => f.path).sort()).toEqual(["EbWsn.cc", "EbWsn.h", "EbWsn.ned"]);
  });
  it("honors a custom output name", () => {
    const tree = generateMerged(all(), "WsnApp");
    expect(tree.map((f) => f.path).sort()).toEqual(["WsnApp.cc", "WsnApp.h", "WsnApp.ned"]);
  });
  it("throws a clear error for an empty selection", () => {
    expect(() => generateMerged([])).toThrow(/No Event-B/);
  });
});

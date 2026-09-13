import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  generate, generateMerged, machineNames, leafMachine, defaultName,
} from "../src/engine/pipeline";

const load = (n: string) =>
  ({ name: `${n}.bum`, xml: readFileSync(`tests/fixtures/shdecom/${n}.bum`, "utf8") });
const all = () => [load("pM1"), load("uM2"), load("pM3")];

describe("pipeline.generate (single target)", () => {
  it("generates 3 files for a named target machine", () => {
    const tree = generate(all(), "pM3", "Pm3App");
    expect(tree.map((f) => f.path).sort()).toEqual(["Pm3App.cc", "Pm3App.h", "Pm3App.ned"]);
    expect(tree.find((f) => f.path === "Pm3App.cc")!.content).toContain("bool Pm3App::sensing(");
  });
  it("throws a clear error for an empty selection", () => {
    expect(() => generate([], "pM1", "X")).toThrow(/No Event-B/);
  });
});

describe("pipeline.machineNames / leafMachine / defaultName", () => {
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
  it("derives a default C++ name per machine label", () => {
    expect(defaultName("pM3")).toBe("Pm3Wsn");
    expect(defaultName("uM4")).toBe("Um4Wsn");
  });
});

describe("pipeline.generateMerged (whole project → one module)", () => {
  it("emits exactly 3 files, merging the chain into the leaf machine", () => {
    const tree = generateMerged(all());
    expect(tree.map((f) => f.path).sort()).toEqual(["Pm3Wsn.cc", "Pm3Wsn.h", "Pm3Wsn.ned"]);
    // The merged module carries state/events from across the whole chain: the
    // sensing event added at pM3 AND events introduced back at pM1.
    const cc = tree.find((f) => f.path === "Pm3Wsn.cc")!.content;
    expect(cc).toContain("bool Pm3Wsn::sensing(");   // added at pM3 (leaf)
    // send_up is introduced at pM1 (base) and emitted under its SensorApp name
    expect(cc).toContain("bool Pm3Wsn::socketDataArrived(");
  });
  it("merges regardless of file order (leaf is content, not position)", () => {
    const tree = generateMerged([load("pM3"), load("pM1"), load("uM2")]);
    expect(tree.map((f) => f.path).sort()).toEqual(["Pm3Wsn.cc", "Pm3Wsn.h", "Pm3Wsn.ned"]);
  });
  it("honors a custom output name", () => {
    const tree = generateMerged(all(), "WsnApp");
    expect(tree.map((f) => f.path).sort()).toEqual(["WsnApp.cc", "WsnApp.h", "WsnApp.ned"]);
  });
  it("throws a clear error for an empty selection", () => {
    expect(() => generateMerged([])).toThrow(/No Event-B/);
  });
});

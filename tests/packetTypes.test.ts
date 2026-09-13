import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseModel } from "../src/engine/parser";
import type { RawContext } from "../src/engine/types";
import { packetTypeLattice } from "../src/engine/packetTypes";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const load = (rel: string) => {
  const dir = resolve(ROOT, rel);
  return parseModel(readdirSync(dir).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") })));
};

// Minimal synthetic RawContext builder for tests that don't need real .buc
// fixtures -- just a name and a list of axiom predicate strings.
const ctx = (name: string, axiomTexts: string[]): RawContext => ({
  name,
  sets: [],
  constants: [],
  axioms: axiomTexts.map((text, i) => ({ label: `axm${i}`, text })),
});

describe("packetTypeLattice", () => {
  it("reads MintRoute's nested partitions", () => {
    const lat = packetTypeLattice(load("EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck").contexts)!;
    expect(lat.root).toBe("TYPE");
    expect(lat.children.get("TYPE")).toEqual(["CONTROL", "DATA"]);
    expect(lat.children.get("CONTROL")).toEqual(["ROUTE", "BEACON"]);
    expect(lat.leaves).toEqual(["DATA", "ROUTE", "BEACON"]);
    expect(lat.tagOf.get("DATA")).toBe(0);
    expect(new Set(lat.tagOf.values()).size).toBe(3);   // tags are distinct
  });

  it("handles a flat partition with no CONTROL subdivision", () => {
    const lat = packetTypeLattice(load("Update_wsn/C0_project").contexts)!;
    expect(lat.children.get("CONTROL")).toBeUndefined();
    expect(lat.leaves).toEqual(["DATA", "CONTROL"]);
  });

  it("returns null when no partition axiom exists", () => {
    expect(packetTypeLattice([])).toBeNull();
  });

  it("anchors the root on the `type in PKT -> NAME` axiom, not on file order", () => {
    // AAAA_UNRELATED is processed first and, like TYPE, is nobody else's
    // child -- under the old "first nobody's-child wins" heuristic it would
    // be picked as root purely because it comes first. The `type` axiom
    // must override that and select TYPE instead.
    const contexts = [
      ctx("A_first.buc", ["partition(AAAA_UNRELATED, {x}, {y})"]),
      ctx("C1.buc", ["partition(TYPE, CONTROL, {DATA})", "type ∈ PKT → TYPE"]),
    ];
    const lat = packetTypeLattice(contexts)!;
    expect(lat.root).toBe("TYPE");
    expect(lat.children.get("TYPE")).toEqual(["CONTROL", "DATA"]);
  });

  it("throws naming the candidates when several partition roots exist and no type axiom decides it", () => {
    const contexts = [
      ctx("A.buc", ["partition(FOO, {a}, {b})"]),
      ctx("B.buc", ["partition(BAR, {c}, {d})"]),
    ];
    expect(() => packetTypeLattice(contexts)).toThrow(/FOO/);
    expect(() => packetTypeLattice(contexts)).toThrow(/BAR/);
  });
});

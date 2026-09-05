import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseModel } from "../../wsn-codegen/src/engine/parser";
import { packetTypeLattice } from "../engine/packetTypes";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const load = (rel: string) => {
  const dir = resolve(ROOT, rel);
  return parseModel(readdirSync(dir).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") })));
};

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
});

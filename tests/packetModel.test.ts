import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseModel } from "../../wsn-codegen/src/engine/parser";
import { flatten } from "../../wsn-codegen/src/engine/flattener";
import { resolveEncodings } from "../../wsn-codegen/src/engine/encodingResolver";
import { packetTypeLattice } from "../engine/packetTypes";
import { packetModel } from "../engine/packetModel";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MINT = "EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck";
const dir = resolve(ROOT, MINT);
const raw = parseModel(readdirSync(dir).filter((f) => /\.(bum|buc)$/.test(f))
  .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") })));

describe("packetModel (ENC7)", () => {
  const lat = packetTypeLattice(raw.contexts)!;
  const pm = packetModel(raw, resolveEncodings(flatten(raw, "M4")), lat);

  it("collapses the PKT-keyed function family into fields", () => {
    const names = pm.fields.map((f) => f.ebName);
    for (const want of ["pktSeqNo", "pktSrc", "pktFwdr", "pktData", "pktNbHops"])
      expect(names).toContain(want);
    expect(names).toContain("initialSrcAddr");   // from the context, not a variable
    expect(names).not.toContain("type");          // the discriminator, not a plain field
  });

  it("does not absorb node-keyed state", () => {
    const names = pm.fields.map((f) => f.ebName);
    for (const notWant of ["floodTbl", "floodFlg", "floodSeqNo", "nbHops"])
      expect(names).not.toContain(notWant);
  });

  it("maps each leaf type to its creating event", () => {
    expect(pm.leaves).toEqual(expect.arrayContaining([
      { typeName: "DataPkt", tag: "DATA", event: "create_dataPkt" },
      { typeName: "BeaconPkt", tag: "BEACON", event: "create_bconPkt" },
      { typeName: "RoutePkt", tag: "ROUTE", event: "create_routePkt" },
    ]));
  });
});

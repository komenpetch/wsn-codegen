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

// RTMCS: a second case study where the creating event for one tag (RRER)
// asserts no literal `type(pkt) = RRER` guard at all -- only `type(pkt) ∈
// CONTROL` plus `type(pkt) ≠ RREP`/`≠ RREQ` (elimination). Meanwhile a
// genuinely CONSUMING event, receive_rrerPkt, DOES carry the literal
// equality -- the exact shape that made the first-match-by-file-order
// implementation pick the wrong (consuming) event. See
// npm run event -- RTMCS M6 create_rrer receive_rrerPkt --flat.
const RTMCS_DIR = resolve(ROOT, "EventB_model/RTMCS_7_4_proof");
const rtmcsRaw = parseModel(readdirSync(RTMCS_DIR).filter((f) => /\.(bum|buc)$/.test(f))
  .map((f) => ({ name: f, xml: readFileSync(resolve(RTMCS_DIR, f), "utf8") })));

describe("packetModel (ENC7) -- RTMCS", () => {
  const lat = packetTypeLattice(rtmcsRaw.contexts)!;
  const pm = packetModel(rtmcsRaw, resolveEncodings(flatten(rtmcsRaw, "M6")), lat);
  const rrer = pm.leaves.find((l) => l.tag === "RRER");
  const rreq = pm.leaves.find((l) => l.tag === "RREQ");
  const rrep = pm.leaves.find((l) => l.tag === "RREP");

  it("maps RRER to its real creating event (create_rrer), resolved by elimination", () => {
    expect(rrer).toEqual({ typeName: "RrerPkt", tag: "RRER", event: "create_rrer" });
  });

  it("maps RREQ and RREP to their real creating events", () => {
    expect(rreq).toEqual({ typeName: "RreqPkt", tag: "RREQ", event: "create_rreq" });
    expect(rrep).toEqual({ typeName: "RrepPkt", tag: "RREP", event: "create_rrep" });
  });

  it("never maps a consuming event -- receive_rrerPkt is not the RRER leaf's event", () => {
    // Under the old first-match-by-guard rule this returned receive_rrerPkt,
    // which carries a literal `type(pkt) = RRER` guard but only reads and
    // forwards the packet; it never establishes pktSeqNo/pktSrc/pktFwdr/etc.
    expect(rrer?.event).not.toBe("receive_rrerPkt");
  });
});

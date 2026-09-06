import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseModel } from "../../wsn-codegen/src/engine/parser";
import { flatten } from "../../wsn-codegen/src/engine/flattener";
import { resolveEncodings } from "../../wsn-codegen/src/engine/encodingResolver";
import { packetTypeLattice } from "../engine/packetTypes";
import { packetModel, isCreatingEvent, resolveTag } from "../engine/packetModel";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MINT = "EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck";
const dir = resolve(ROOT, MINT);
const raw = parseModel(readdirSync(dir).filter((f) => /\.(bum|buc)$/.test(f))
  .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") })));

describe("packetModel (ENC7)", () => {
  const lat = packetTypeLattice(raw.contexts)!;
  const machine = resolveEncodings(flatten(raw, "M4"));
  const pm = packetModel(raw, machine, lat);

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

  // isCreatingEvent is NECESSARY but not SUFFICIENT (see the comment on it in
  // engine/packetModel.ts): send_up moves an already-created packet from the
  // wire buffer back onto the packet-field family (`pkt ∉ dom(pktData)` guard
  // + `pktData ≔ pktData ∪ {pkt ↦ data}` action), so it satisfies the
  // "establishes an attribute" test just like a real create_* event does.
  // What keeps it out of packetModel's leaves is resolveTag returning null
  // for it (send_up carries no `type(pkt)` guard at all). This test pins
  // that conjunction directly: if either half changed so that send_up
  // started resolving to a real tag, or so that a null-tag event could still
  // reach a leaf, this would catch it before packetModel.leaves did.
  it("send_up satisfies isCreatingEvent but resolveTag excludes it (the conjunction packetModel relies on)", () => {
    const sendUp = machine.events.find((e) => e.label === "send_up")!;
    expect(sendUp).toBeDefined();
    expect(isCreatingEvent(sendUp, pm.fields)).toBe(true);
    expect(resolveTag(sendUp, lat)).toBeNull();
    expect(pm.leaves.some((l) => l.event === "send_up")).toBe(false);
  });
});

// RTMCS: a second case study where the creating event for one tag (RRER)
// asserts no literal `type(pkt) = RRER` guard at all -- only `type(pkt) ∈
// CONTROL` plus `type(pkt) ≠ RREP`/`≠ RREQ` (elimination). Several genuinely
// CONSUMING events also carry the literal `type(pkt) = RRER` equality --
// start_tx_rrer and receive_rrerPkt among them -- which is exactly the
// ambiguity the old first-match-by-guard implementation could not resolve.
// CORRECTED 2026-09-06: verified by reverting engine/packetModel.ts to
// commit 461f1b0 and running this suite, the old code actually picked
// start_tx_rrer (not receive_rrerPkt -- it is declared earlier in the
// flattened M6 event list, and machine.events.find() returns the first
// match). See npm run event -- RTMCS M6 start_tx_rrer receive_rrerPkt
// create_rrer --flat.
const RTMCS_DIR = resolve(ROOT, "EventB_model/RTMCS_7_4_proof");
const rtmcsRaw = parseModel(readdirSync(RTMCS_DIR).filter((f) => /\.(bum|buc)$/.test(f))
  .map((f) => ({ name: f, xml: readFileSync(resolve(RTMCS_DIR, f), "utf8") })));

describe("packetModel (ENC7) -- RTMCS", () => {
  const lat = packetTypeLattice(rtmcsRaw.contexts)!;
  const machine = resolveEncodings(flatten(rtmcsRaw, "M6"));
  const pm = packetModel(rtmcsRaw, machine, lat);
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

  // This must fail under the OLD first-match-by-guard rule to prove anything.
  // Verified by reverting engine/packetModel.ts to 461f1b0 and re-running
  // this suite: the old rule maps RRER to start_tx_rrer, not receive_rrerPkt
  // (start_tx_rrer is declared earlier in the flattened M6 event list, so
  // `machine.events.find()` hits it first -- both carry the same literal
  // `type(pkt) = RRER` guard). Asserting `!== "receive_rrerPkt"` alone would
  // therefore have passed under both the old and new code and proven
  // nothing; asserting against the event actually produced by the bug is
  // what makes this a real regression guard.
  it("never maps a consuming event -- start_tx_rrer is not the RRER leaf's event", () => {
    expect(rrer?.event).not.toBe("start_tx_rrer");
    expect(rrer?.event).not.toBe("receive_rrerPkt");
  });

  // isCreatingEvent alone is over-inclusive (see the comment on it in
  // engine/packetModel.ts): send_down and send_up both establish attribute
  // functions the same way a real create_* event does -- send_down guards
  // `pkt ∉ dom(vPktData)` and assigns `vPktData ≔ vPktData ∪ {pkt ↦ data}`
  // while domain-subtracting the wire copy; send_up does the mirror image on
  // the wire copy itself (`pkt ∉ dom(pktData)` + `pktData ≔ pktData ∪
  // {pkt ↦ data}`). Neither creates a packet -- both move one between the
  // channel and the app-facing buffer -- and neither carries a `type(pkt)`
  // guard, so resolveTag excludes both. This pins that conjunction so a
  // future change to either function cannot silently let one of them leak
  // into packetModel.leaves.
  it("send_down and send_up satisfy isCreatingEvent but resolveTag excludes both", () => {
    const sendDown = machine.events.find((e) => e.label === "send_down")!;
    const sendUp = machine.events.find((e) => e.label === "send_up")!;
    expect(sendDown).toBeDefined();
    expect(sendUp).toBeDefined();
    expect(isCreatingEvent(sendDown, pm.fields)).toBe(true);
    expect(isCreatingEvent(sendUp, pm.fields)).toBe(true);
    expect(resolveTag(sendDown, lat)).toBeNull();
    expect(resolveTag(sendUp, lat)).toBeNull();
    expect(pm.leaves.some((l) => l.event === "send_down" || l.event === "send_up")).toBe(false);
  });
});

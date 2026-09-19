import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { isTypingSet } from "../src/engine/scheduler";
import { generate } from "../src/engine/pipeline";

// A membership whose right side is a CARRIER -- restricted or widened -- is the
// parameter's TYPE, not a claim that it already exists.
//
// ⚠ Only the BARE carrier name used to be accepted, and RTMCS writes its
// freshness guard as
//
//     pkt ∈ PKT ∖ (xmittedPkts ∪ middleware)          (M0)
//
// which says: in PKT, not yet transmitted, not in the middleware. Read as "the
// packet already exists", it denied every RTMCS creating event its mint, hence
// its type stamp, hence its place in the reachability pass -- the entire
// RREQ/RREP/RRER chain dropped on a guard meaning the reverse of how it was
// read. MintRoute writes the bare `pkt ∈ PKT`, which is why three case studies
// did not surface it.
//
// The operator matters, so it is tested rather than assumed. `∖` restricts and
// `∪` widens -- neither asserts membership in anything but the carrier -- while
// `∩` DOES assert membership in the other operand and so is not typing.

const CARRIERS = new Set(["PKT", "ND", "TYPE", "ℤ"]);

describe("isTypingSet", () => {
  it("accepts the bare carrier -- MintRoute's spelling, which always worked", () => {
    expect(isTypingSet("PKT", CARRIERS)).toBe(true);
  });

  it("accepts a carrier RESTRICTED by ∖ -- the RTMCS guard this exists for", () => {
    expect(isTypingSet("PKT ∖ (xmittedPkts  ∪  middleware)", CARRIERS)).toBe(true);
    // The CommPattern's own originator typing, and RTMCS's, in one shape.
    expect(isTypingSet("ND ∖Destination", CARRIERS)).toBe(true);
    expect(isTypingSet("ND ∖ Dests", CARRIERS)).toBe(true);
  });

  it("accepts a carrier WIDENED by ∪ -- RTMCS M5's `nxt ∈ ND ∪ {BROADCAST}`", () => {
    expect(isTypingSet("ND ∪ {BROADCAST}", CARRIERS)).toBe(true);
  });

  it("REFUSES ∩, because that one does carry an existence claim", () => {
    // `C ∩ S` asserts membership in S as well as in C. Absent from the corpus,
    // refused anyway: refusal makes an event report as unschedulable with a
    // reason, where the opposite mistake mints a packet that should not exist.
    expect(isTypingSet("PKT ∩ sensedPkts", CARRIERS)).toBe(false);
    expect(isTypingSet("PKT ∖ a ∩ b", CARRIERS)).toBe(false);
  });

  it("refuses a plain state variable -- the case that must keep working", () => {
    // MintRoute's `final_tx_controlPkt` guards `pkt ∈ middleware`, and reading
    // that as freshness minted a ROUTE packet every tick for an event whose job
    // is to retire one that exists.
    expect(isTypingSet("middleware", CARRIERS)).toBe(false);
    expect(isTypingSet("dom(pktSeqNo)", CARRIERS)).toBe(false);
    expect(isTypingSet("ran(ndBuff ∪ WiMedium)", CARRIERS)).toBe(false);
  });

  it("refuses an empty or malformed right side rather than guessing", () => {
    expect(isTypingSet("", CARRIERS)).toBe(false);
    expect(isTypingSet("   ", CARRIERS)).toBe(false);
  });
});

// End-to-end, on the real models: the shape above decides whether a creating
// event MINTS a packet or is dropped for want of one.
const dir = "../EventB_model/RTMCS_7_4_proof";
const load = (d: string) =>
  readdirSync(d).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(join(d, f), "utf8") }));

describe.skipIf(!existsSync(dir))("RTMCS originates packets again", () => {
  const tree = generate(load(dir), "M6", "M6Wsn", 2);
  const h = tree.find((f) => f.path.endsWith(".h"))!.content;
  const cc = tree.find((f) => f.path.endsWith(".cc"))!.content;

  it("reaches the creating event at all -- otherwise this suite proves nothing", () => {
    expect(cc).toContain("bool M6Wsn::try_create_rreq()");
  });

  it("MINTS the RREQ rather than searching for one that cannot exist", () => {
    const m = cc.slice(cc.indexOf("bool M6Wsn::try_create_rreq()"));
    expect(m.slice(0, m.indexOf("\n}"))).toContain("newPktId()");
  });

  it("stamps the type, which only a minted packet can carry", () => {
    const m = cc.slice(cc.indexOf("bool M6Wsn::try_create_rreq()"));
    expect(m.slice(0, m.indexOf("\n}"))).toContain("setType(PktType::RREQ)");
  });

  it("schedules the whole discovery chain, both directions", () => {
    // Dropping the mint took all of these with it: no RREQ exists, so nothing
    // that guards on one is reachable.
    for (const ev of ["create_rreq", "start_tx_rreq", "receive_rreqPkt",
      "dest_recv_rreqPkt", "create_rrep", "receive_rrepPkt"])
      expect(h).toContain(`bool try_${ev}();`);
  });

  it("and both route-table maintenance events", () => {
    expect(h).toContain("bool try_add_bwdRouteEntry();");
    expect(h).toContain("bool try_add_fwdrouteEntry();");
  });
});

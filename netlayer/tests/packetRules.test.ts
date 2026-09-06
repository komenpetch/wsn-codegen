import { describe, it, expect } from "vitest";
import { packetRules } from "../engine/packetRules";
import type { PacketField } from "../engine/packetModel";

// Both real fields here are PARTIAL (`PKT ⇸ ...`) -- pktSeqNo/pktNbHops's
// actual shape in both MintRoute and RTMCS (verified against the raw .bum
// invariants; neither model ever declares them `PKT → ...`). A separate
// TOTAL fixture field (initialSrcAddr's real shape, `PKT → ND`) is added
// below to exercise the other half of PKT-DOM.
const fields: PacketField[] = [
  { name: "seqNum", ebName: "pktSeqNo", cppType: "int", source: "variable", total: false },
  { name: "nbHops", ebName: "pktNbHops", cppType: "int", source: "variable", total: false },
];
const totalFields: PacketField[] = [
  { name: "initialSrcAddr", ebName: "initialSrcAddr", cppType: "Node", source: "context", total: true },
];
const apply = (expr: string) => {
  for (const r of packetRules(fields)) {
    const hit = r.match(expr);
    if (hit) return r.emit(hit, () => undefined);
  }
  return null;
};
const applyTotal = (expr: string) => {
  for (const r of packetRules(totalFields)) {
    const hit = r.match(expr);
    if (hit) return r.emit(hit, () => undefined);
  }
  return null;
};

// task-7 finding (task-7-report.md): every guarded-bool-method event mirror
// declares its Event-B PKT-domain parameters as scalar `PktId`/int
// (wsn-codegen codeEmitter.ts's `ALIAS.PKT = "PktId"`, applied uniformly --
// off-limits to this project). `pkt->getSeqNum()`/`pkt->setSeqNum(...)`
// therefore does not compile at any of GET/SET's evidenced call sites: `pkt`
// is never actually a pointer there, and there is no PktId -> PPkt* registry
// anywhere in the generated module to make it one. GET/SET now REFUSE these
// clauses (match but emit "") the same way PKT-DOM-NOT refuses `∉ dom(F)`
// below -- intercepting ahead of the generic app-layer FN1/FN3-override
// rules, which would otherwise emit a compiling-but-wrong map lookup against
// a member ENC7 no longer maintains. `apply()` does not replicate the real
// engine's untranslated-clause fallback (see the DOM_NOT comment below), so
// `toBeFalsy()` accepts either "no rule matched" (null) or "matched but
// refused" ("") -- both are the safe, honest outcome this test guards.
describe("packet-access rules", () => {
  it("does not fabricate a pointer read for f(pkt) -- pkt is never a pointer here", () => {
    expect(apply("sno = pktSeqNo(pkt)")).toBeFalsy();
  });

  it("does not fabricate a pointer write (override spelling) -- pkt is never a pointer here", () => {
    expect(apply("pktSeqNo ≔ pktSeqNo {pkt↦sno}")).toBeFalsy();
  });

  it("does not fabricate a pointer write (union spelling) -- pkt is never a pointer here", () => {
    expect(apply("pktNbHops ≔ pktNbHops ∪ {pkt ↦nbh}")).toBeFalsy();
  });

  // Important finding fixed 2026-09-06 (final-review pass): the mirror image
  // of the ∉ bug just below. PKT-DOM used to emit `true` for EVERY `∈
  // dom(F)` clause on the reasoning "a chunk always carries all its fields"
  // -- which only holds when F is a TOTAL function. pktSeqNo is PARTIAL
  // (`PKT ⇸ ℕ`, initialised to ∅) in both real corpora, so `pkt ∈
  // dom(pktSeqNo)` is a genuine "has this attribute been set yet"
  // precondition (send_down's own read-back guard), and emitting `true` for
  // it silently dropped that precondition. It now matches (so the generic
  // app-layer DOM rule never gets a turn) but refuses, same as PKT-DOM-NOT.
  it("refuses ∈-domain membership on a PARTIAL chunk field rather than assuming it vacuous", () => {
    expect(apply("pkt ∈ dom(pktSeqNo)")).toBeFalsy();
  });

  // The other half: a TOTAL field (initialSrcAddr, `PKT → ND` in both real
  // models) really is vacuously true under ENC7 -- every packet has always
  // had this attribute, by the model's own totality axiom -- so PKT-DOM still
  // emits `true` here, the one case the "chunk always carries all its
  // fields" reasoning actually holds for.
  it("still treats ∈-domain membership as vacuously true for a TOTAL chunk field", () => {
    expect(applyTotal("pkt ∈ dom(initialSrcAddr)")).toBe("true");
  });

  // Regression for the Critical finding fixed 2026-09-06 (task-6-report.md):
  // PKT-DOM's match regex used a non-capturing group for the operator
  // (`(?:∈|∉)`), so it could not tell `∈` from `∉` and emitted `true` for
  // both. `pkt ∉ dom(pktSeqNo)` is create_bconPkt/create_routePkt's "this
  // packet does not exist yet" precondition -- collapsing it to `true`
  // silently discarded it. The fix splits PKT-DOM (∈ only, "true") from a
  // new PKT-DOM-NOT rule that MATCHES the ∉ spelling -- so the generic
  // app-layer DOM rule (which would emit `pktSeqNo.count(pkt) == 0` against a
  // std::map ENC7 no longer declares) never gets a turn -- but explicitly
  // REFUSES it by emitting "" (falsy). The real engine's translateEvent
  // (`if (cpp) guards.push(cpp); else untranslatedGuards.push(clause)`)
  // treats that falsy emit exactly like no rule matching: the clause becomes
  // an UNTRANSLATED GUARD and the event refuses to fire. This file's `apply()`
  // helper does not replicate that fallback -- it returns whatever the first
  // matching rule's emit() produces, verbatim -- so the assertion is
  // `toBeFalsy()` (matches both `null`, "no rule matched", and `""`, "matched
  // but refused") rather than a specific value: either result is safe, and
  // both are what this test exists to guarantee. What would fail this test is
  // PKT-DOM-NOT (or the generic DOM rule reached in its absence) emitting a
  // truthy, compiling string for the ∉ spelling -- the original bug.
  it("does not accept pkt ∉ dom(f) as pkt ∈ dom(f) -- matches (if at all) only to refuse", () => {
    expect(apply("pkt ∉ dom(pktSeqNo)")).toBeFalsy();
  });

  it("leaves non-packet variables alone", () => {
    expect(apply("s ∈ dom(floodTbl)")).toBeNull();
  });

  it("every rule carries a tier and evidence", () => {
    for (const r of packetRules(fields)) {
      expect([1, 2, 3]).toContain(r.tier);
      expect(r.evidence.length).toBeGreaterThan(0);
    }
  });
});

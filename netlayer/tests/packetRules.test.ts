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
  // These rules USED to refuse every clause, because the generated code held a
  // bare `PktId` and had no way to reach the chunk carrying the field. The
  // identity binding (a per-module `pktStore` mapping PktId to its PPkt, and the
  // `pktOf`/`ensurePkt` accessors emitted beside it) removed that obstacle, so
  // they now translate. What must NOT come back is the thing the refusals were
  // protecting against: a clause that compiles but means something else.

  it("reads a field through the identity binding, not off a bare id", () => {
    expect(apply("sno = pktSeqNo(pkt)")).toBe("sno == pktOf(pkt)->getSeqNum()");
  });

  it("writes a field through the identity binding (override spelling)", () => {
    expect(apply("pktSeqNo ≔ pktSeqNo {pkt↦sno}"))
      .toBe("ensurePkt(pkt)->setSeqNum(sno); pktLive.insert(pkt);");
  });

  it("writes a field through the identity binding (union spelling)", () => {
    expect(apply("pktNbHops ≔ pktNbHops ∪ {pkt ↦nbh}"))
      .toBe("ensurePkt(pkt)->setNbHops(nbh); pktLive.insert(pkt);");
  });

  // The precondition this guards is the one PKT-DOM used to drop by emitting
  // `true`: for a PARTIAL field (`PKT ⇸ ℕ`, initialised to ∅) membership is a
  // real "has this packet been created yet" test, not a tautology. It is
  // answerable again because pktStore IS that domain -- so the assertion is
  // that a real test is emitted, and specifically NOT the constant `true`.
  it("tests ∈-domain membership on a PARTIAL field for real, never as a constant", () => {
    const out = apply("pkt ∈ dom(pktSeqNo)");
    expect(out).toBe("pktLive.count(pkt) > 0");
    expect(out).not.toBe("true");
  });

  it("answers ∈-domain membership for a TOTAL field from the same store", () => {
    expect(applyTotal("pkt ∈ dom(initialSrcAddr)")).toBe("true");
  });

  // Regression for the Critical ∈/∉ conflation (task-6-report.md): PKT-DOM once
  // used a non-capturing `(?:∈|∉)` group, could not tell the operators apart,
  // and emitted the same thing for both -- silently inverting the creating
  // events' "this packet does not exist yet" precondition. The two spellings
  // must still produce OPPOSITE tests, which is what this asserts.
  it("does not conflate pkt ∉ dom(f) with pkt ∈ dom(f)", () => {
    const notIn = apply("pkt ∉ dom(pktSeqNo)");
    const isIn  = apply("pkt ∈ dom(pktSeqNo)");
    expect(notIn).toBe("pktLive.count(pkt) == 0");
    expect(notIn).not.toBe(isIn);
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

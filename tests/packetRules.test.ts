import { describe, it, expect } from "vitest";
import { packetRules } from "../engine/packetRules";
import type { PacketField } from "../engine/packetModel";

const fields: PacketField[] = [
  { name: "seqNum", ebName: "pktSeqNo", cppType: "int", source: "variable" },
  { name: "nbHops", ebName: "pktNbHops", cppType: "int", source: "variable" },
];
const apply = (expr: string) => {
  for (const r of packetRules(fields)) {
    const hit = r.match(expr);
    if (hit) return r.emit(hit, () => undefined);
  }
  return null;
};

describe("packet-access rules", () => {
  it("reads an attribute as a field", () => {
    expect(apply("sno = pktSeqNo(pkt)")).toBe("sno == pkt->getSeqNum()");
  });

  it("writes an attribute through the setter (override spelling)", () => {
    expect(apply("pktSeqNo ≔ pktSeqNo {pkt↦sno}")).toBe("pkt->setSeqNum(sno);");
  });

  it("writes an attribute through the setter (union spelling)", () => {
    expect(apply("pktNbHops ≔ pktNbHops ∪ {pkt ↦nbh}")).toBe("pkt->setNbHops(nbh);");
  });

  it("treats ∈-domain membership as always-true for a chunk field", () => {
    expect(apply("pkt ∈ dom(pktSeqNo)")).toBe("true");
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

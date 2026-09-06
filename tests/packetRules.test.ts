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

  it("treats domain membership as always-true for a chunk field", () => {
    expect(apply("pkt ∉ dom(pktSeqNo)")).toBe("true");
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

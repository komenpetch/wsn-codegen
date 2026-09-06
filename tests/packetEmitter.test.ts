import { describe, it, expect } from "vitest";
import { emitPacketClasses } from "../engine/packetEmitter";
import type { PacketModel } from "../engine/packetModel";

const pm: PacketModel = {
  lattice: {
    root: "TYPE",
    children: new Map([["TYPE", ["CONTROL", "DATA"]], ["CONTROL", ["ROUTE", "BEACON"]]]),
    leaves: ["DATA", "ROUTE", "BEACON"],
    tagOf: new Map([["DATA", 0], ["ROUTE", 1], ["BEACON", 2]]),
  },
  fields: [
    { name: "seqNum", ebName: "pktSeqNo", cppType: "int", source: "variable", total: false },
    { name: "srcAddr", ebName: "pktSrc", cppType: "Node", source: "variable", total: false },
  ],
  leaves: [
    { typeName: "DataPkt", tag: "DATA", event: "create_dataPkt" },
    { typeName: "RoutePkt", tag: "ROUTE", event: "create_routePkt" },
    { typeName: "BeaconPkt", tag: "BEACON", event: "create_bconPkt" },
  ],
};

describe("emitPacketClasses", () => {
  const { header, impl } = emitPacketClasses(pm);

  it("emits the enum with every leaf tag", () => {
    expect(header).toContain("enum class PktType");
    for (const t of ["DATA = 0", "ROUTE = 1", "BEACON = 2"]) expect(header).toContain(t);
  });

  it("emits PPkt as a FieldsChunk with the INET obligations", () => {
    expect(header).toContain("class PPkt : public inet::FieldsChunk");
    expect(header).toContain("virtual PPkt *dup() const override");
    expect(header).toContain("handleChange();");
    expect(header).toContain("chunkLength");
  });

  it("emits an accessor pair per field, using the C++ names", () => {
    expect(header).toContain("int getSeqNum() const");
    expect(header).toContain("void setSeqNum(int v)");
    expect(header).toContain("Node getSrcAddr() const");
  });

  it("emits one leaf class per tag, each pinning its type", () => {
    for (const [cls, tag] of [["DataPkt", "DATA"], ["RoutePkt", "ROUTE"], ["BeaconPkt", "BEACON"]]) {
      expect(header).toContain(`class ${cls} : public PPkt`);
      expect(impl).toContain(`type = PktType::${tag};`);
    }
  });

  it("names the Event-B event each leaf came from", () => {
    expect(header).toContain("// Event-B: create_bconPkt");
  });
});

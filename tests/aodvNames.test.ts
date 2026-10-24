import { describe, it, expect } from "vitest";
import { loadProject } from "../scripts/projects";
import { generateMerged } from "../src/engine/pipeline";

// The v4 AODV plan (design/V4_AODV_Plan.md, Q17 and Q19, user 2026-10-18):
// structure 4 with the AODV split names the RREQ path after INET's AODV
// (src/inet/routing/aodv/Aodv.cc), the part the generated module runs; the
// RREP and RRER methods, which the AODV test code replaces, keep their regular
// names. MintRoute's output and structure 3 do not move.
const files = () => loadProject("AppLayer");
const byPath = (tree: { path: string; content: string }[]) =>
  Object.fromEntries(tree.map((f) => [f.path, f.content]));
const v4aodv = byPath(generateMerged(files(), undefined, 4, undefined, true, "aodv"));
const v4flood = byPath(generateMerged(files(), undefined, 4));
const v3aodv = byPath(generateMerged(files(), undefined, 3, undefined, true, "aodv"));

describe("structure 4, AODV: the RREQ path under INET AODV's names", () => {
  const h = v4aodv["EbWsn.h"], cc = v4aodv["EbWsn.cc"];

  it("the RREQ timer's target is startRouteDiscovery (Aodv.cc:249)", () => {
    expect(h).toContain("    virtual void startRouteDiscovery();\n");
    expect(cc).toContain("// INET AODV's name for it (Aodv.cc:249).\nvoid EbWsn::startRouteDiscovery() {\n"
      + "    try_create_rreqPkt();\n    runDeliveryEvents();\n}\n");
    expect(cc).toMatch(/if \(msg->getKind\(\) == SEND_RREQ_FLOOD_TIMER\) \{\n {8}startRouteDiscovery\(\);\n/);
  });

  it("the RREQ transmit is sendRREQ (Aodv.cc:271)", () => {
    expect(h).toContain("    virtual void sendRREQ(Node x, PktId pkt);\n");
    expect(cc).toContain("// INET AODV's name for it (Aodv.cc:271).\nvoid EbWsn::sendRREQ(Node x, PktId pkt) {\n");
    expect(cc).toContain("        case PktType::RREQ: sendRREQ(x, pkt); break;\n");
  });

  it("the RREQ reception is handleRREQ (Aodv.cc:772)", () => {
    expect(h).toContain("    virtual void handleRREQ(Packet *packet, const Ptr<const PPkt>& header);\n");
    expect(cc).toContain("// INET AODV's name for it (Aodv.cc:772).\n"
      + "void EbWsn::handleRREQ(Packet *packet, const Ptr<const PPkt>& header) {\n"
      + "    runDeliveryEvents();\n    delete packet;\n}\n");
    expect(cc).toContain("        case PktType::RREQ:\n            handleRREQ(packet, _wire);\n");
  });

  it("the model event create_rreqPkt is createRREQ (Aodv.cc:374); its try_ and count keep the Event-B label", () => {
    expect(h).toMatch(/^ {4}bool createRREQ\(Node x, int des, PktId pkt, Data data, int sno\); {3}\/\/ Event-B: create_rreqPkt$/m);
    expect(cc).toContain("// Event-B: create_rreqPkt — emitted under INET AODV's name for it (Aodv.cc:374).\n"
      + "bool EbWsn::createRREQ(Node x, int des, PktId pkt, Data data, int sno) {");
    expect(cc).toContain("bool EbWsn::try_create_rreqPkt()");
    expect(cc).toContain("    if (createRREQ(x, des, pkt, data, sno)) { firedCount[\"create_rreqPkt\"]++; return true; }");
  });

  it("no old RREQ name survives", () => {
    for (const text of [h, cc]) {
      expect(text).not.toMatch(/\bsendRreqBroadcast\b/);
      expect(text).not.toMatch(/\bonReceiveRreqPkt\b/);
      expect(text).not.toMatch(/(?<![\w"])create_rreqPkt\(/);
    }
  });

  it("RREP and RRER keep their regular names", () => {
    for (const leaf of ["Rrep", "Rrer"]) {
      expect(h).toContain(`    virtual void send${leaf}Broadcast();\n`);
      expect(h).toContain(`    virtual void send${leaf}Broadcast(Node x, PktId pkt);\n`);
      expect(h).toContain(`    virtual void onReceive${leaf}Pkt(Packet *packet, const Ptr<const PPkt>& header);\n`);
      expect(cc).toContain(`bool EbWsn::create_${leaf.toLowerCase()}Pkt(`);
    }
  });
});

describe("the AODV names do not reach other outputs", () => {
  const aodvNames = /\b(startRouteDiscovery|sendRREQ|handleRREQ|createRREQ)\b/;

  it("structure 4 with flooding (MintRoute) has none", () => {
    for (const text of Object.values(v4flood)) expect(text).not.toMatch(aodvNames);
    expect(v4flood["EbWsn.cc"]).toContain("void EbWsn::sendRouteBroadcast(Node x, PktId pkt) {");
  });

  it("structure 3 with AODV has none and keeps its regular names", () => {
    for (const text of Object.values(v3aodv)) expect(text).not.toMatch(aodvNames);
    expect(v3aodv["EbWsn.cc"]).toContain("void EbWsn::sendRreqBroadcast(Node x, PktId pkt) {");
    expect(v3aodv["EbWsn.cc"]).toContain("bool EbWsn::create_rreqPkt(");
  });
});

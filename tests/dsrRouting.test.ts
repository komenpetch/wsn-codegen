import { describe, it, expect } from "vitest";
import { loadProject } from "../scripts/projects";
import { generateMerged } from "../src/engine/pipeline";
import { patternExtensionFor } from "../src/engine/patternExtension";
import { AODV_EVENTS, AODV_LEAVES, DSR_LEAVES, DSR_NAMES, installLeafNames } from "../src/engine/baselineShell";

// The v4 DSR plan (design/V4_DSR_Plan.md, Q4 and B1, user 2026-10-24):
// `--routing dsr` is structure 4 with the RREQ/RREP/RRER split in a context of
// its own (C2_dsr), and the RREQ transmit named after the Final Report's DSR
// (sendRREQ, printed p.48). Nothing is named after INET's AODV. MintRoute's and
// AODV's outputs do not move (checked byte for byte in step 1).
const files = () => loadProject("AppLayer");
const byPath = (tree: { path: string; content: string }[]) =>
  Object.fromEntries(tree.map((f) => [f.path, f.content]));
const dsr = byPath(generateMerged(files(), undefined, 4, undefined, true, "dsr"));
const aodv = byPath(generateMerged(files(), undefined, 4, undefined, true, "aodv"));

describe("structure 4, DSR: its own context and the Final Report's name", () => {
  const h = dsr["EbWsn.h"], cc = dsr["EbWsn.cc"];

  it("the context is C2_dsr, not C2_aodv", () => {
    expect(h).toContain("(derived from C0, C1, C2_dsr)");
    expect(h + cc).not.toContain("C2_aodv");
  });

  it("the RREQ transmit is sendRREQ, citing the Final Report", () => {
    expect(h).toContain("    virtual void sendRREQ(Node x, PktId pkt);\n");
    expect(cc).toContain("// The Final Report's name for it (printed p.48, the text above Fig 6.9).\n"
      + "void EbWsn::sendRREQ(Node x, PktId pkt) {\n");
    expect(cc).toContain("        case PktType::RREQ: sendRREQ(x, pkt); break;\n");
  });

  it("the timer's target, the reception and the creating event keep their regular names", () => {
    expect(h).toContain("    virtual void sendRreqBroadcast();\n");
    expect(cc).toMatch(/if \(msg->getKind\(\) == SEND_RREQ_FLOOD_TIMER\) \{\n {8}sendRreqBroadcast\(\);\n/);
    expect(h).toContain("    virtual void onReceiveRreqPkt(Packet *packet, const Ptr<const PPkt>& header);\n");
    expect(cc).toContain("            onReceiveRreqPkt(packet, _wire);\n");
    expect(cc).toContain("bool EbWsn::create_rreqPkt(Node x, int des, PktId pkt, Data data, int sno) {");
    expect(cc).toContain("    if (create_rreqPkt(x, des, pkt, data, sno)) { firedCount[\"create_rreqPkt\"]++; return true; }");
  });

  it("nothing is named or cited after INET's AODV", () => {
    // Every structure-4 module, MintRoute's flooding one included, cites
    // Aodv.cc once in the route publication's design comment (D5/D15, "as
    // Aodv.cc:709 does"). That names no method; a DSR module adds none to it.
    const flood = byPath(generateMerged(files(), undefined, 4, undefined, true, "flooding"));
    const count = (t: string) => t.split("Aodv.cc").length - 1;
    expect(count(h) + count(cc)).toBe(count(flood["EbWsn.h"]) + count(flood["EbWsn.cc"]));
    for (const text of [h, cc]) {
      expect(text).not.toContain("INET AODV");
      for (const n of [AODV_LEAVES.RREQ.timer!.name, AODV_LEAVES.RREQ.receive!.name, AODV_EVENTS.create_rreqPkt.name])
        expect(text).not.toMatch(new RegExp(`\\b${n}\\b`));
    }
  });

  it("the transmit overload's old name does not survive, under any argument names", () => {
    expect(h + cc).not.toMatch(/\bsendRreqBroadcast\(\s*[^)\s]/);
  });

  it("the timer's target, which keeps its name, says it calls sendRREQ", () => {
    expect(cc).toContain("// put it on the air through sendRREQ below.\nvoid EbWsn::sendRreqBroadcast() {");
    expect(cc).not.toContain("through the overload below.\nvoid EbWsn::sendRreqBroadcast()");
  });

  it("is the AODV module with AODV's names and citations undone, and the context renamed", () => {
    // What structure 4 with this split is, apart from names: the two must not
    // drift into different modules.
    const undoAodv = (text: string) => text
      .replace(/^\/\/ INET AODV's name for it \(Aodv\.cc:\d+\)\.\n/gm, "")
      .replace(/^\/\/ Event-B: create_rreqPkt — emitted under INET AODV's name for it \(Aodv\.cc:\d+\)\.\n/gm, "")
      .replace(/ {3}\/\/ Event-B: create_rreqPkt$/gm, "")
      .replace(/\bstartRouteDiscovery\b/g, "sendRreqBroadcast")
      .replace(/\bhandleRREQ\b/g, "onReceiveRreqPkt")
      .replace(/\bcreateRREQ\(/g, "create_rreqPkt(")
      .replace("C2_aodv", "C2_dsr");
    const undoDsr = (text: string) =>
      text.replace(/^\/\/ The Final Report's name for it \(printed p\.\d+, the text above Fig 6\.9\)\.\n/gm,
        "// INET AODV's name for it (Aodv.cc:271).\n");
    for (const f of ["EbWsn.h", "EbWsn.cc", "EbWsn.ned"])
      expect(undoAodv(undoDsr(dsr[f]))).toBe(undoAodv(aodv[f]));
  });

  it("the DSR table names only the RREQ transmit", () => {
    expect(Object.keys(DSR_LEAVES)).toEqual(["RREQ"]);
    expect(DSR_LEAVES.RREQ).toEqual({ send: { name: "sendRREQ", line: 48 } });
  });
});

describe("the survival check after a lone transmit rename", () => {
  // A crafted module: just the anchors DSR's rename needs, and the timer's
  // no-argument target, which DSR keeps.
  const h = "    virtual void sendRreqBroadcast();\n    virtual void sendRreqBroadcast(Node x, PktId pkt);\n";
  const cc = "// put it on the air through the overload below.\nvoid EbWsn::sendRreqBroadcast() {\n}\n"
    + "void EbWsn::sendRreqBroadcast(Node x, PktId pkt) {\n}\n"
    + "        case PktType::RREQ: sendRreqBroadcast(x, pkt); break;\n";

  it("passes when only the timer's target keeps the old name", () => {
    const out = installLeafNames({ h, cc, ned: "" }, "EbWsn", ["RREQ"], DSR_NAMES);
    expect(out.cc).toContain("void EbWsn::sendRREQ(Node x, PktId pkt) {");
    expect(out.cc).toContain("// put it on the air through sendRREQ below.\nvoid EbWsn::sendRreqBroadcast() {");
  });

  it("refuses when a call to the renamed overload survives", () => {
    expect(() => installLeafNames({ h, cc: cc + "    sendRreqBroadcast(x, pkt);\n", ned: "" }, "EbWsn", ["RREQ"], DSR_NAMES))
      .toThrow(/sendRreqBroadcast\(Node, PktId\) survives/);
  });

  it("refuses a surviving use under other argument names", () => {
    expect(() => installLeafNames({ h, cc: cc + "    sendRreqBroadcast(nb, pkt);\n", ned: "" }, "EbWsn", ["RREQ"], DSR_NAMES))
      .toThrow(/sendRreqBroadcast\(Node, PktId\) survives/);
  });
});

describe("--routing dsr: where it applies", () => {
  it("bundles C2_dsr alone, and uM4 sees it", () => {
    const src = patternExtensionFor(files(), "pM3", "dsr", true);
    const names = src.files.map((f) => f.name);
    expect(names.filter((n) => /^C2_(ctl|aodv|dsr)\.buc$/.test(n))).toEqual(["C2_dsr.buc"]);
    const uM4 = src.files.find((f) => f.name === "uM4.bum")!.xml;
    expect(uM4).toContain('org.eventb.core.target="C2_dsr"');
  });

  it("is refused on structure 3, which has no baseline shell", () => {
    expect(() => generateMerged(files(), undefined, 3, undefined, true, "dsr")).toThrow(/structure 4 only/);
  });

  it("is refused on structure 2, which carries no pattern", () => {
    // One check from the profile since routing.ts: DSR's own limit, which is
    // the narrower and so the more exact reason.
    expect(() => generateMerged(files(), undefined, 2, undefined, true, "dsr")).toThrow(/structure 4 only/);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../src/engine/pipeline";

// A parameter ranged over a SET DIFFERENCE is still enumerable.
//
// The CommPattern's own creating event types its originator `x ∈ ND ∖ Dests`.
// The enumeration matcher was `^p ∈ (\w+)$`, which does not match a difference,
// so `x` was not resolvable on the first pass. The packet got minted first, and
// `x` then fell through to the only other clause mentioning it —
// `x = initialSrcAddr(pkt)` — and was READ off the freshly minted chunk, where
// that field is still its default −1. `ND.count(-1) > 0` is false, so the event
// declined on its first guard, every tick, on every node: a module that ran its
// full sixty seconds and fired nothing.
//
// ✅ The fix invents nothing. `initialSrcAddr` is never assigned in ANY of the
// three models — it is a given — but the generator already stamps it for
// MintRoute, whose `s = Sink` resolves the originator independently and whose
// `s = initialSrcAddr(pkt)` is then satisfied BY CONSTRUCTION:
//
//     int s = Sink;
//     ensurePkt(pkt)->setInitialSrcAddr(s);
//
// Enumerating over the difference puts the pattern's event on that same path.
const load = (d: string) =>
  readdirSync(d).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(join(d, f), "utf8") }));

// ⚠ THE CREATING EVENT IS `create_controlPkt`, NOT the abstract
// `creatingControlPacket`. Once the extension derives a creating event for the
// control set -- which it does even when nothing splits that set, because the
// sequence number has to be stamped by whatever creates a control packet --
// the derived event supersedes the abstract one, exactly as MintRoute's own
// per-leaf events supersede it there. The behaviour asserted below moved with
// it intact; only the method name changed.
describe("a parameter ranged over a set difference is enumerated, not read back", () => {
  const cc = generate(load("../Update_wsn/C0_project"), "pM3", "Pm3Wsn", 3)
    .find((f) => f.path.endsWith(".cc"))!.content;
  const method = cc.slice(cc.indexOf("bool Pm3Wsn::try_create_controlPkt()"));
  const body = method.slice(0, method.indexOf("\n}"));

  it("reaches the method at all — otherwise this suite proves nothing", () => {
    expect(cc).toContain("bool Pm3Wsn::try_create_controlPkt()");
  });

  it("enumerates the originator over the carrier", () => {
    expect(body).toContain("for (Node x : ND) {");
  });

  it("skips the subtracted set rather than ignoring it", () => {
    // `∖ Dests` is load-bearing: the pattern says control packets originate
    // AWAY from the destinations, so looping ND alone would be a different event.
    expect(body).toContain("if (Dests.count(x) > 0) continue;");
  });

  it("stamps the source on the minted packet instead of reading it back", () => {
    expect(body).toContain("ensurePkt(pkt)->setInitialSrcAddr(x);");
    expect(body).not.toContain("Node x = pktOf(pkt)->getInitialSrcAddr();");
  });

  it("holds for a second model, on a parameter that is not a packet source", () => {
    // MintRoute's `est_due` types `x ∈ ND ∖ estNDs` — the same shape with no
    // packet anywhere near it, so this is the enumeration alone rather than the
    // enumeration plus the mint. It became schedulable for the first time with
    // this fix; before it the generator reported "no binding for x".
    const m4 = generate(load("../EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck"),
      "M4", "M4Wsn", 2).find((f) => f.path.endsWith(".cc"))!.content;
    const est = m4.slice(m4.indexOf("bool M4Wsn::try_est_due()"));
    const b = est.slice(0, est.indexOf("\n}"));
    expect(m4).toContain("bool M4Wsn::try_est_due()");
    expect(b).toContain("for (Node x : ND) {");
    expect(b).toContain("if (estNDs.count(x) > 0) continue;");
  });

  it("leaves MintRoute's context-constant originator path alone", () => {
    // `create_bconPkt` resolves `s` from `s = Sink`, not an enumeration, and
    // that path already worked. It must not change.
    const m4 = generate(load("../EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck"),
      "M4", "M4Wsn", 2).find((f) => f.path.endsWith(".cc"))!.content;
    const bcon = m4.slice(m4.indexOf("bool M4Wsn::try_create_bconPkt()"));
    const b = bcon.slice(0, bcon.indexOf("\n}"));
    expect(b).toContain("int s = Sink;");
    expect(b).toContain("ensurePkt(pkt)->setInitialSrcAddr(s);");
  });
});

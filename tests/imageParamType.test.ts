import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../src/engine/pipeline";

// The scheduler binds a relational image — `des = ran({pkt} ◁ finalDestAddr)`
// in the CommPattern's own creating event. Two things about that binding were
// wrong, and each produced a module that looked perfectly healthy.
//
//  1. It was always bound as `std::set<Node>`, which is right for a parameter
//     the model types as a set (MintRoute's `nbs`) and wrong for one it does
//     not: `des` has only its defining guard, so it is declared `int`, and the
//     call did not compile once the creating events became reachable.
//
//  2. ⚠ It read the CONTEXT MAP. ENC7 moves packet attributes onto the chunk,
//     leaving `inline std::map<PktId, Node> finalDestAddr;` declared and empty —
//     so the domain check failed on every candidate and the event fired zero
//     times while being listed as schedulable. The sibling `p = f(x)` branch
//     already knew this; the image branch did not. Same two-storage trap as the
//     2026-09-08 `type(pkt)` defect and the 2026-09-13 `netSeqNo` one.
const load = (d: string) =>
  readdirSync(d).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(join(d, f), "utf8") }));

describe("a relational-image parameter is bound at its declared type, from the right storage", () => {
  const tree = generate(load("../Update_wsn/C0_project"), "pM3", "Pm3Wsn", 3);
  const h = tree.find((f) => f.path.endsWith(".h"))!.content;
  const cc = tree.find((f) => f.path.endsWith(".cc"))!.content;

  it("reaches the binding at all — otherwise this suite proves nothing", () => {
    // If the creating event stops being schedulable the assertions below would
    // pass vacuously. Fail loudly instead. (This guard has already earned its
    // keep once: it is what caught the suite going stale.)
    expect(cc).toContain("bool Pm3Wsn::try_creatingControlPacket()");
  });

  it("binds a scalar-declared parameter as a scalar, not as a set", () => {
    expect(h).toContain("bool creatingControlPacket(Node x, int des, PktId pkt, Data data);");
    expect(cc).not.toContain("std::set<Node> des = relImage(");
  });

  it("reads the CHUNK, not the context map ENC7 replaced", () => {
    expect(cc).toContain("int des = pktOf(pkt)->getFinalDestAddr();");
    expect(cc).not.toContain("int des = finalDestAddr.at(pkt);");
  });

  it("guards the chunk lookup, since a guard is an unordered conjunction", () => {
    expect(cc).toMatch(/if \(pktStore\.count\(pkt\) == 0\)[\s\S]{0,120}int des = pktOf\(pkt\)->getFinalDestAddr\(\);/);
  });

  it("still binds a set-declared parameter as a set", () => {
    // MintRoute's `nbs` is typed a set by its own model and must not change.
    const m4 = generate(load("../EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck"),
      "M4", "M4Wsn", 2);
    const m4h = m4.find((f) => f.path.endsWith(".h"))!.content;
    expect(m4h).toContain("const std::set<Node>& nbs");
  });
});

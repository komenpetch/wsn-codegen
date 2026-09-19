import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../src/engine/pipeline";

// PKT-IMG — a packet-field read written as a relational image reaches the CHUNK.
//
// `F[{p}] = ran({p} ◁ F)`, and for a function that singleton carries exactly
// `F(p)`, so the image form and the application form are the same read and must
// reach the same storage. Under ENC7 that storage is the chunk.
//
// ⚠ WHAT THIS COST BEFORE THE RULE EXISTED. `des = ran({pkt} ◁ finalDestAddr)`
// is the CommPattern's own creating-event guard, and with no PKT rule matching
// it fell through to the base catalog's MS6 and read the CONTEXT MAP ENC7 had
// replaced. In the pattern `finalDestAddr` is a context CONSTANT with a
// property axiom and no elements, so that map is emitted DECLARED AND EMPTY and
// nothing can ever fill it:
//
//   - before MS6 was domain-checked: `finalDestAddr.at(pkt)` on an empty map,
//     i.e. `std::out_of_range` thrown at runtime;
//   - after: a guard false on every candidate, so the event fired zero times;
//   - and the reachability pass then dropped the event outright, reporting
//     `nothing that runs ever fills finalDestAddr` — true of the map, false of
//     the model, and it took the module's only creating event with it.
//
// ⚠ Meanwhile the SCHEDULER already bound the same clause off the chunk. So the
// binding computed `des` from the chunk and the guard then rejected it against
// the map: one name, two storages, disagreeing inside a single method. Fourth
// occurrence of that trap (2026-09-08 `type(pkt)`, 2026-09-13 `netSeqNo`, the
// scheduler's own image binding, and this guard).
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
describe("a packet field read in image form reaches the chunk, not the context map", () => {
  const cc = generate(load("../Update_wsn/C0_project"), "pM3", "Pm3Wsn", 3)
    .find((f) => f.path.endsWith(".cc"))!.content;

  it("reads the chunk", () => {
    expect(cc).toContain("des == pktOf(pkt)->getFinalDestAddr()");
  });

  it("never reads the map ENC7 replaced", () => {
    // Both spellings: the undefended `.at` MS6 used to emit, and the
    // domain-checked one it emits now. Either would be a read of the empty map.
    expect(cc).not.toContain("finalDestAddr.at(pkt)");
    expect(cc).not.toContain("finalDestAddr.count(pkt)");
  });

  it("checks the chunk exists, since a guard is an unordered conjunction", () => {
    // For a TOTAL function the model's own domain check is vacuous — the
    // question left is whether THIS module holds a chunk for the packet.
    expect(cc).toContain("(pktOf(pkt) != nullptr && des == pktOf(pkt)->getFinalDestAddr())");
  });

  it("puts the creating event back within reach of the scheduler", () => {
    // The consequence that matters: with binding and guard agreeing, the
    // module's only creating event is schedulable AND reachable again.
    expect(cc).toContain("bool Pm3Wsn::try_create_controlPkt()");
    expect(cc).toContain("int des = pktOf(pkt)->getFinalDestAddr();");
  });

  it("leaves the application form to PKT-GET, unchanged", () => {
    // `x = initialSrcAddr(pkt)` is the same read in the other spelling and was
    // already correct. PKT-IMG must not claim it or change it.
    expect(cc).toContain("x == pktOf(pkt)->getInitialSrcAddr()");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../src/engine/pipeline";
import { packetTypeLeaves } from "../src/engine/emitted";

// A creating event's type guard is satisfied BY CONSTRUCTION — in both of the
// spellings the corpus uses, not just MintRoute's.
//
// `type(pkt) = BEACON` names a leaf outright. The CommPattern instead writes
// `type(pkt) ∈ CONTROL`, and whether that pins a tag is a question about the
// LATTICE rather than about the shape:
//
//   pattern    partition(TYPE, CONTROL, {DATA})        → CONTROL is a LEAF
//   MintRoute  + partition(CONTROL, {ROUTE}, {BEACON}) → CONTROL is a GROUP
//
// Membership in a one-element set determines the value; membership in a
// two-element one does not. So the discriminator is exactly "is this name a
// leaf", and the emitted enum already carries that decision — MintRoute's is
// `DATA, ROUTE, BEACON` with no CONTROL member at all.
//
// ⚠ WHAT THE MISSING HALF COST. `creatingControlPacket` minted a packet, left
// its type at the enum's default (`PktType::DATA = 0`), and then declined on
// its own `CONTROL.count(...) > 0` guard — scheduled, reachable, called on
// every tick of every node, and never once firing. A module that runs its full
// sixty seconds and originates nothing is this project's most expensive failure
// shape, and this is the third time it has appeared.
const load = (d: string) =>
  readdirSync(d).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(join(d, f), "utf8") }));

const MINTROUTE = "../EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck";

// ⚠ THE CREATING EVENT IS `create_controlPkt`, NOT the abstract
// `creatingControlPacket`. Once the extension derives a creating event for the
// control set -- which it does even when nothing splits that set, because the
// sequence number has to be stamped by whatever creates a control packet --
// the derived event supersedes the abstract one, exactly as MintRoute's own
// per-leaf events supersede it there. The behaviour asserted below moved with
// it intact; only the method name changed.
describe("a membership type guard stamps a tag when, and only when, it pins one", () => {
  const v3 = generate(load("../Update_wsn/C0_project"), "pM3", "Pm3Wsn", 3);
  const cc = v3.find((f) => f.path.endsWith(".cc"))!.content;
  const h = v3.find((f) => f.path.endsWith(".h"))!.content;
  const body = (() => {
    const i = cc.indexOf("bool Pm3Wsn::try_create_controlPkt()");
    return i < 0 ? "" : cc.slice(i, cc.indexOf("\n}", i));
  })();

  it("reaches the method at all — otherwise this suite proves nothing", () => {
    expect(cc).toContain("bool Pm3Wsn::try_create_controlPkt()");
  });

  it("stamps the leaf the membership guard names", () => {
    expect(body).toContain("ensurePkt(pkt)->setType(PktType::CONTROL);");
  });

  it("stamps it before the guard that reads it back", () => {
    // The event's own guard is `CONTROL.count(getType()) > 0`. Unstamped, the
    // chunk's default is DATA and the guard is false on every candidate.
    expect(cc).toContain("CONTROL.count(static_cast<int>(pktOf(pkt)->getType())) > 0");
    expect(packetTypeLeaves(h)).toContain("CONTROL");
  });

  it("names a member the emitted enum actually declares", () => {
    // `PktType::X` for an X the emitter never declared does not compile, which
    // is why the leaf set is read off the enum rather than off the axioms.
    const tag = /setType\(PktType::(\w+)\)/.exec(body)?.[1];
    expect(tag).toBeTruthy();
    expect(packetTypeLeaves(h)).toContain(tag!);
  });
});

describe("a membership guard over a partitioned set stamps nothing", () => {
  const m4 = generate(load(MINTROUTE), "M4", "M4Wsn", 2);
  const cc = m4.find((f) => f.path.endsWith(".cc"))!.content;
  const h = m4.find((f) => f.path.endsWith(".h"))!.content;

  it("does not treat CONTROL as a tag, because it is not a leaf there", () => {
    expect(packetTypeLeaves(h)).toEqual(new Set(["DATA", "ROUTE", "BEACON"]));
    expect(cc).not.toContain("PktType::CONTROL");
  });

  it("still stamps the leaves its own creating events name outright", () => {
    // The equality spelling must be untouched: this is where a model that DOES
    // distinguish control subtypes gets its tags, one creating event per leaf.
    expect(cc).toContain("ensurePkt(pkt)->setType(PktType::BEACON);");
  });
});

describe("packetTypeLeaves reads the enum, and only the enum", () => {
  it("returns nothing for a header with no packet-type lattice", () => {
    // Structures 1 and 2 carry no PPkt, so there is no enum and no stamp to
    // derive — it must return empty rather than guess.
    const v2h = generate(load("../Update_wsn/C0_project"), "pM3", "Pm3Wsn", 2)
      .find((f) => f.path.endsWith(".h"))!.content;
    expect(v2h).not.toContain("enum class PktType");
    expect(packetTypeLeaves(v2h).size).toBe(0);
  });

  it("does not pick up members of some other enum", () => {
    expect(packetTypeLeaves("enum class Other {\n    A = 0,\n};\n")).toEqual(new Set());
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../src/engine/pipeline";
import { chosenAtCreation } from "../src/engine/scheduler";

// A creating event CHOOSES its packet's node-valued attributes. It cannot read
// one off the packet it is in the middle of minting.
//
// ⚠ RTMCS's `create_rreq` determines its originator as `s = initialSrcAddr(pkt)`
// and gives `s` no other binding, so it fell through to the ordinary `p = f(x)`
// read and took the value off the fresh chunk -- where the field is still its
// default, -1. The event then declined on `floodSeqNo.count(-1)`, every tick, on
// every node: SCHEDULABLE AND FIRING ZERO TIMES, which is the failure this
// project has paid for more than once.
//
// The generator already knew the answer and applied it twice: MintRoute's
// `s = Sink` and the pattern's `x ∈ ND ∖ Dests` bind the originator
// independently, and the fresh-packet branch then STAMPS the field, satisfying
// the same guard by construction. Only the shape where the read is the sole
// binding was missing.
//
// `cppType === "Node"` is derived from the model's own `initialSrcAddr ∈ PKT →
// ND` -- the same derivation the chunk field's type comes from -- so nothing
// here is keyed on the name `initialSrcAddr`.

const load = (d: string) =>
  readdirSync(d).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(join(d, f), "utf8") }));

const bodyOf = (cc: string, sig: string) => {
  const at = cc.indexOf(sig);
  expect(at, `${sig} is not emitted -- this suite would prove nothing`).toBeGreaterThan(-1);
  const rest = cc.slice(at);
  return rest.slice(0, rest.indexOf("\n}"));
};

// Unit tests on the predicate itself. ⚠ ONE OF ITS CONDITIONS IS NOT EXERCISED
// BY ANY CORPUS EVENT -- every `q = F(pkt)` clause on a minted packet happens to
// name a node-valued field -- so a mutation of the node-valued check SURVIVES
// the end-to-end suite below. That is exactly why these exist.
const NODE_FIELDS = new Set(["initialSrcAddr", "pktFwdr", "pktSrc"]);

describe("chosenAtCreation", () => {
  const params = ["s", "pkt", "sno", "fDes"];
  const none = new Set<string>();

  it("picks the originator RTMCS defines only by reading the fresh packet", () => {
    expect(chosenAtCreation(["s = initialSrcAddr(pkt)"], "pkt", params, none, NODE_FIELDS))
      .toEqual(["s"]);
  });

  it("⚠ refuses a field the model does NOT type as a node", () => {
    // `sno = pktSeqNo(pkt)` would otherwise enumerate a sequence number over
    // node ids -- which compiles, and is nonsense. No corpus event has this
    // shape, which is why the end-to-end tests cannot catch it.
    expect(chosenAtCreation(["sno = pktSeqNo(pkt)"], "pkt", params, none, NODE_FIELDS))
      .toEqual([]);
  });

  it("leaves a parameter that is already bound another way", () => {
    // MintRoute's `s = Sink` resolves it first; the caller's stamp then
    // satisfies `s = initialSrcAddr(pkt)` by construction.
    expect(chosenAtCreation(["s = initialSrcAddr(pkt)"], "pkt", params,
      new Set(["s"]), NODE_FIELDS)).toEqual([]);
  });

  it("refuses a name that is not a parameter of this event", () => {
    expect(chosenAtCreation(["zz = initialSrcAddr(pkt)"], "pkt", params, none, NODE_FIELDS))
      .toEqual([]);
  });

  it("only looks at the packet BEING MINTED, not at one already held", () => {
    // `create_rrep` reads `fDes = initialSrcAddr(rreq)` off a received packet.
    expect(chosenAtCreation(["fDes = initialSrcAddr(rreq)"], "pkt", params, none, NODE_FIELDS))
      .toEqual([]);
  });

  it("does not return the same parameter twice", () => {
    expect(chosenAtCreation(
      ["s = initialSrcAddr(pkt)", "s = initialSrcAddr(pkt)"], "pkt", params, none, NODE_FIELDS))
      .toEqual(["s"]);
  });
});

const RTMCS = "../EventB_model/RTMCS_7_4_proof";
const MINT = "../EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck";
const APP = "../Update_wsn/C0_project";

describe.skipIf(!existsSync(RTMCS))("a minted packet's node-valued field is chosen, not read", () => {
  const cc = generate(load(RTMCS), "M6", "M6Wsn", 2)
    .find((f) => f.path.endsWith(".cc"))!.content;
  const body = bodyOf(cc, "bool M6Wsn::try_create_rreq()");

  it("enumerates the originator instead of reading it off the fresh chunk", () => {
    expect(body).toContain("for (Node s : ND) {");
    expect(body).not.toContain("int s = pktOf(pkt)->getInitialSrcAddr();");
  });

  it("stamps it, because enumerating without stamping fixes nothing", () => {
    // The guard is still `s = initialSrcAddr(pkt)`, emitted against the chunk.
    // Unstamped it reads -1 and the event declines exactly as before.
    expect(body).toContain("ensurePkt(pkt)->setInitialSrcAddr(s);");
  });

  it("⚠ enumerates BEFORE the mint, so a failed candidate cannot erase a chunk "
    + "the next iteration re-stamps", () => {
    // Bound after the mint, the loop would sit inside the packet's lifetime and
    // the rollback would fire inside the loop -- losing the type tag with it.
    // ND holding exactly one node today would have hidden that.
    expect(body.indexOf("for (Node s : ND) {"))
      .toBeLessThan(body.indexOf("PktId pkt = newPktId();"));
  });

  it("does NOT touch a read off a packet that was genuinely received", () => {
    // `create_rrep` reads `fDes = initialSrcAddr(rreq)` where `rreq` is a packet
    // this node received -- a real value on a real chunk. Converting that to an
    // enumeration would invent a destination the model did not choose.
    const rrep = bodyOf(cc, "bool M6Wsn::try_create_rrep()");
    expect(rrep).toContain("pktOf(rreq)->getInitialSrcAddr()");
    expect(rrep).not.toContain("for (Node fDes : ND) {");
  });
});

describe.skipIf(!existsSync(MINT))("an originator bound another way is left alone", () => {
  it("MintRoute keeps `s = Sink` and is not enumerated", () => {
    const cc = generate(load(MINT), "M4", "M4Wsn", 2)
      .find((f) => f.path.endsWith(".cc"))!.content;
    const body = bodyOf(cc, "bool M4Wsn::try_create_bconPkt()");
    expect(body).toContain("int s = Sink;");
    expect(body).toContain("ensurePkt(pkt)->setInitialSrcAddr(s);");
    expect(body).not.toContain("for (Node s : ND) {");
  });
});

describe.skipIf(!existsSync(APP))("and so is one bound by its own typing guard", () => {
  it("the pattern keeps enumerating over ND ∖ Dests, not over bare ND", () => {
    const cc = generate(load(APP), "pM3", "Pm3Wsn", 3)
      .find((f) => f.path.endsWith(".cc"))!.content;
    const body = bodyOf(cc, "bool Pm3Wsn::try_create_beaconPkt()");
    expect(body).toContain("for (Node x : ND) {");
    expect(body).toContain("if (Dests.count(x) > 0) continue;");
    expect(body).toContain("ensurePkt(pkt)->setInitialSrcAddr(x);");
  });
});

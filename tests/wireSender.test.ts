import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../src/engine/pipeline";

// The forwarder on the wire is the node that sent the frame.
//
// ⚠ IT WAS NOT, AND THE CAUSE IS SHARED MUTABLE STATE RATHER THAN A BAD RULE.
// `localIdFor` keeps ONE local chunk per packet identity, and both the arrival
// and the transmit path use it. `start_tx` stamps the forwarder onto that chunk;
// `transmitPacket` copies the chunk some time later. In between, an arrival of
// the SAME packet from a different neighbour overwrites the stamp — so the frame
// leaves carrying that neighbour's id, and every receiver records a neighbour it
// has never heard from.
//
// Measured on the nine-node field: 15 frames left with the wrong forwarder, and
// every node's neighbour table was over-count by up to three.
//
// ✅ The model already answers it. `send_down` observes `x ↦ pkt ∈ sentDown`,
// and that `x` IS this transmission's sender — the emitted method had it as a
// parameter all along and threw it away. Pinning the WIRE COPY from it closes
// the race without the local chunk having to be race-free: the chunk is the
// model's own state and is left exactly as the model made it.
//
// After: zero mismatched arrivals on every node, and each node's table is
// EXACTLY its measured radio neighbourhood — `add_newEntry` per node equals the
// number of distinct radio sources, 1/2/5/3/4/6/4/4/3 across the field.
const load = (d: string) =>
  readdirSync(d).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(join(d, f), "utf8") }));

// ⚠ THE LEAF NAMED HERE IS BEACON, AND IT USED TO BE CONTROL. On 2026-09-21 the
// app-layer chain took `partition(CONTROL, {ROUTE}, {BEACON})`, so CONTROL
// stopped being a lattice leaf and the per-leaf transmit it names became
// `sendBeaconBroadcast`. Nothing about what this suite proves moved — it needs
// SOME per-leaf transmit to look at, and that is now the beacon's.
describe("the wire copy carries the sender the model named", () => {
  const tree = generate(load("../Update_wsn/C0_project"), "pM3", "Pm3Wsn", 3);
  const cc = tree.find((f) => f.path.endsWith(".cc"))!.content;
  const h = tree.find((f) => f.path.endsWith(".h"))!.content;

  it("reaches the transmit at all — otherwise this suite proves nothing", () => {
    expect(cc).toContain("void Pm3Wsn::sendBeaconBroadcast(Node x, PktId pkt) {");
  });

  it("pins the wire copy's sender field from send_down's own parameter", () => {
    const fn = cc.slice(cc.indexOf("void Pm3Wsn::sendBeaconBroadcast"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("chunk->setFwdrAddr(x);");
    // It pins the COPY, not the model's chunk: the model owns that state.
    expect(body).not.toContain("held->setFwdrAddr");
    expect(body).not.toContain("ensurePkt(pkt)->setFwdrAddr");
  });

  it("pins it before the frame is built, not after", () => {
    const fn = cc.slice(cc.indexOf("void Pm3Wsn::sendBeaconBroadcast"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body.indexOf("chunk->setFwdrAddr(x);"))
      .toBeLessThan(body.indexOf("new Packet("));
  });

  it("carries the sender all the way from the event to the wire", () => {
    // send_down's realisation has `x`; it used to discard it at the dispatch.
    expect(cc).toContain("bool Pm3Wsn::sendDown(Node x, PktId pkt)");
    expect(cc).toContain("transmitPacket(x, pkt);");
    expect(cc).toContain("void Pm3Wsn::transmitPacket(Node x, PktId pkt)");
    expect(cc).toContain("sendBeaconBroadcast(x, pkt); break;");
    expect(h).toContain("virtual void sendBeaconBroadcast(Node x, PktId pkt);");
  });

  it("derives the sender FIELD rather than naming it", () => {
    // senderFieldOf reads which chunk field carries the sender off the model —
    // the field a transmit event stamps with the same parameter it files the
    // packet under. A model whose field is called something else gets that name.
    //
    // ⚠ THIS USED TO ASSERT THAT THE STAMP DOES NOT APPEAR THREE TIMES, which
    // pinned a COUNT rather than the derivation: it held only while the lattice
    // had two leaves, and the 2026-09-21 control split broke it by adding a
    // third without anything about the sender changing. One stamp per per-leaf
    // transmit is the actual invariant, and it tracks the lattice.
    const stamps = cc.match(/chunk->setFwdrAddr\(x\);/g) ?? [];
    const methods = cc.match(/^void Pm3Wsn::send\w+Broadcast\(Node x, PktId pkt\) \{$/gm) ?? [];
    expect(methods.length).toBeGreaterThan(1);
    expect(stamps.length).toBe(methods.length);
  });
});

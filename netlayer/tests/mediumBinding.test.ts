// The medium binding, pinned against the real MintRoute corpus.
//
// What matters here is not that some code is emitted but that the DERIVATION
// holds: every part of the binding is read off the model, so a test that
// asserted the emitted text alone would pass just as well for a hardcoded
// answer. Each case below names the model fact it depends on.
import { describe, it, expect } from "vitest";
import { generateNet } from "../scripts/generate-net";
import type { GeneratedTree } from "../../src/engine/types";

const tree: GeneratedTree = generateNet("MintRoute", "M4");
const cc = tree.find((f) => f.path.endsWith(".cc"))!.content;
const h = tree.find((f) => f.path.endsWith(".h"))!.content;

describe("medium binding: transmit", () => {
  it("hands the model's own packet to the radio from the model's own transmit event", () => {
    // The CommPattern rename puts send_down's body in sendSensorPacket(...).
    const body = cc.slice(cc.indexOf("bool M4App::sendSensorPacket(int cn"));
    expect(body.slice(0, body.indexOf("\n}"))).toContain("mediumSend(pkt);");
  });

  it("no longer sends the app-layer shell's own sensing payload from that event", () => {
    // The shell builds a ByteCountChunk addressed to sinkAddress -- application
    // traffic, not the model's packet. Exactly one of those may remain: the
    // shell's own no-argument sendSensorPacket(), which the timer still drives.
    const occurrences = cc.match(/makeShared<ByteCountChunk>/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it("broadcasts, because the model's medium names no destination", () => {
    expect(cc).toContain("getBroadcastAddress()");
    const send = cc.slice(cc.indexOf("void M4App::mediumSend"));
    expect(send.slice(0, send.indexOf("\n}"))).toContain("mediumBroadcastAddress()");
  });
});

describe("medium binding: receive", () => {
  const arrival = cc.slice(
    cc.indexOf("void M4App::socketDataArrived(INetworkSocket *, Packet *packet) {"));
  const body = arrival.slice(0, arrival.indexOf("\n}"));

  it("runs the model's own delivery event rather than hand-coding its postcondition", () => {
    // Every argument comes from the arrival: the local id, the radio's answer,
    // the sender off the chunk, and the staged wire copies.
    expect(body).toContain(
      "socketDataArrived(_pkt, _nbrs, _f, vPktSeqNo.at(_pkt), vPktSrc.at(_pkt), " +
      "vPktFwdr.at(_pkt), vPktData.at(_pkt), vPktNbHops.at(_pkt))");
    expect(body).toContain('firedCount["send_up"]++');
  });

  it("stages every wire copy the transmit event serialised", () => {
    // send_down stores five packet fields into vPkt* before wiping them; the
    // arrival must restore exactly those five, or send_up's read-back guards
    // cannot hold.
    for (const [staging, getter] of [
      ["vPktSeqNo", "getSeqNum"], ["vPktSrc", "getSrcAddr"], ["vPktFwdr", "getFwdrAddr"],
      ["vPktData", "getData"], ["vPktNbHops", "getNbHops"],
    ]) expect(body).toContain(`${staging}[_pkt] = wire->${getter}();`);
  });

  it("makes true the three medium memberships send_up demands", () => {
    for (const v of ["WiMedium", "sentDown", "channel"])
      expect(body).toContain(`${v}.insert({_f, _pkt});`);
  });

  it("takes the sender from the chunk field the model itself stamps it into", () => {
    // start_tx_* files the packet under `x` in WiMedium and stamps pktFwdr with
    // the same `x`. That equality is what makes the forwarder readable at the
    // receiver at all -- nothing here assumes the field's name.
    expect(body).toContain("Node _f = wire->getFwdrAddr();");
  });

  it("answers the propagation question with the radio, not the topology variable", () => {
    expect(body).toContain("envNeighbours[_pkt].insert(myNodeId);");
    expect(body).not.toContain("wsnLinks");
  });

  it("gives the model a chance to react without waiting for the next tick", () => {
    expect(body).toContain("runEnabledEvents();");
  });
});

describe("medium binding: packet identity across nodes", () => {
  const fn = cc.slice(cc.indexOf("PktId M4App::localIdFor"));
  const key = fn.slice(fn.indexOf("std::vector<long> key"), fn.indexOf("auto it ="));

  it("keys on the fields no event overwrites", () => {
    for (const g of ["getType", "getInitialSrcAddr", "getSeqNum", "getSrcAddr", "getData"])
      expect(key).toContain(`w->${g}()`);
  });

  it("excludes every per-hop field, or the duplicate test can never be true", () => {
    // pktFwdr and pktNbHops are re-stamped by relational override at each hop;
    // netSeqNo is re-stamped by a per-key update, `netSeqNo(pkt) ≔ lsno`. That
    // second spelling was missed first time round, which put the link sequence
    // number in the key and gave the same packet a new identity at every hop --
    // a flood that never recognises a duplicate and so never stops.
    for (const g of ["getFwdrAddr", "getNbHops", "getNetSeqNo"])
      expect(key).not.toContain(`w->${g}()`);
  });

  it("carries across only what the model does not restore for itself", () => {
    // send_up re-populates the packet-attribute variables from the wire copies;
    // the context-sourced fields are constants no event ever assigns, so they
    // have to travel with the chunk.
    expect(fn).toContain("local->setInitialSrcAddr(w->getInitialSrcAddr());");
    expect(fn).toContain("local->setType(w->getType());");
    expect(fn).not.toContain("local->setSeqNum(");
  });
});

describe("medium binding: what the scheduler may no longer fire", () => {
  const run = cc.slice(cc.indexOf("bool M4App::runEnabledEvents()"));
  const body = run.slice(0, run.indexOf("\n}"));

  it("does not fire the delivery or propagation events on their own timetable", () => {
    // Left schedulable, these fire on the SENDING node: it would compute its own
    // neighbours from the topology variable and deliver the packet to itself.
    for (const label of ["send_up", "find_neighbours", "assign_forwarder", "lose_all_neighbours"]) {
      expect(body).not.toContain(`try_${label}()`);
      expect(h).toContain(`realised by the simulator's medium, not scheduled: ${label}`);
    }
  });

  it("still fires the events a reception enables", () => {
    // The point of the whole exercise: something arrives, and the model consumes
    // it. receive_controlPkt is the flood's own forwarding decision.
    for (const label of ["receive_controlPkt", "receive_dup_controlPkt", "sink_recv_controlPkt"])
      expect(body).toContain(`try_${label}()`);
  });
});

describe("medium binding: guards that used to look translated", () => {
  it("reads the packet type off the chunk, the one storage ENC7 chose", () => {
    // `type.count(pkt)` compiled and was false for every packet that arrived
    // over the medium, because only the creating node ever wrote that map.
    expect(cc).not.toMatch(/\btype\.count\(/);
    expect(cc).not.toMatch(/\btype\.at\(/);
    expect(cc).toContain("pktOf(pkt)->getType()");
  });

  it("derives the receiver's hop count from the chunk too", () => {
    expect(cc).not.toMatch(/pktNbHops\.at\(/);
    expect(cc).toContain("pktOf(pkt)->getNbHops() + 1");
  });

  it("gives up holding a packet it has handed to the medium", () => {
    // `{pkt} ⩤ pktSeqNo` in send_down is the model saying the packet has left.
    // Emitting nothing there left it permanently held, so the same packet could
    // never be accepted again and the duplicate events could never run.
    const tx = cc.slice(cc.indexOf("bool M4App::sendSensorPacket(int cn"));
    expect(tx.slice(0, tx.indexOf("\n}"))).toContain("pktLive.erase(pkt);");
  });
});

// Not a medium rule, but the defect the medium binding surfaced: an event that
// refuses to fire must not change state on its way to saying so. MintRoute's
// finish_tx_pkt erased from WiMedium and sentUp and then returned false, and
// because its caller was iterating WiMedium to find candidates, the run died
// with an access violation. The rule is simple enough to check textually: after
// the refusal, nothing executes.
describe("an event that refuses to fire changes nothing", () => {
  const REFUSAL = "// Refuses to fire:";

  it("puts the refusal before the actions in every incomplete event", () => {
    const bad: string[] = [];
    for (const m of cc.matchAll(/^bool M4App::(\w+)\([^)]*\) \{\n([\s\S]*?)\n\}/gm)) {
      const [, method, body] = m;
      const at = body.indexOf(REFUSAL);
      if (at < 0) continue;                       // event translates fully
      const after = body.slice(at).split("\n").slice(1);
      const executable = after.filter((l) => {
        const t = l.trim();
        return t !== "" && !t.startsWith("//") && t !== "return false;";
      });
      if (executable.length > 0) bad.push(`${method}: ${executable[0].trim()}`);
    }
    expect(bad, `\n${bad.join("\n")}`).toEqual([]);
  });

  it("still shows what the event would have done", () => {
    // The actions stay readable next to the markers that say why they cannot
    // run -- the shape of the model is part of what the output is for.
    const fn = cc.slice(cc.indexOf("bool M4App::finish_tx_pkt"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("// The actions this event would perform, for reference only:");
    expect(body).toContain("// WiMedium.erase({f, pkt});");
  });

  it("finds at least one incomplete event, or it is checking nothing", () => {
    expect(cc).toContain(REFUSAL);
  });
});

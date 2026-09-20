// The medium binding, pinned against the real MintRoute corpus.
//
// What matters here is not that some code is emitted but that the DERIVATION
// holds: every part of the binding is read off the model, so a test that
// asserted the emitted text alone would pass just as well for a hardcoded
// answer. Each case below names the model fact it depends on.
import { describe, it, expect } from "vitest";
import { generate, defaultName } from "../src/engine/pipeline";
import { loadProject } from "../scripts/projects";
import type { GeneratedTree } from "../src/engine/types";

// Through the ONE public entry point, not a network-only backdoor: reaching the
// medium binding this way is itself part of what is under test, because
// pipeline.ts only takes the network branch when the model has a medium.
const gen = (project: string, machine: string): GeneratedTree =>
  generate(loadProject(project), machine, defaultName(machine), 2);

const tree: GeneratedTree = gen("MintRoute", "M4");
// Derived, never spelled out. A hardcoded class name here is what once let a
// sibling test pass while matching zero methods after a rename (see
// generateNet.test.ts) -- the assertions below would go quiet the same way.
const CLS = defaultName("M4");
const cc = tree.find((f) => f.path.endsWith(".cc"))!.content;
const h = tree.find((f) => f.path.endsWith(".h"))!.content;

// The CommPattern pair's emitted method name, read off the provenance comment
// exactly the way mediumBinding.ts and scheduler.ts read it. The pair is named
// after whichever shell it lands in -- sendSensorPacket / socketDataArrived in
// the app layer, sendDown / handleLowerPacket in the network layer -- and that
// provenance comment is the seam both passes resolve it through. Spelling the
// name out here would test a constant instead of the seam, and would go quiet
// the next time the shell's names change.
const methodFor = (label: string): string => {
  const m = new RegExp(`^// Event-B: ${label} —[^\n]*\nbool ${CLS}::(\\w+)\\(`, "m").exec(cc);
  if (!m) throw new Error(`no emitted method carries the Event-B provenance "${label}"`);
  return m[1];
};
const TX = methodFor("send_down");
const RX = methodFor("send_up");

describe("medium binding: transmit", () => {
  it("hands the model's own packet to the radio from the model's own transmit event", () => {
    // The CommPattern rename puts send_down's body in the shell's own transmit
    // method -- sendDown(...) at this layer.
    const body = cc.slice(cc.indexOf(`bool ${CLS}::${TX}(int cn`));
    expect(body.slice(0, body.indexOf("\n}"))).toContain("mediumSend(pkt);");
  });

  it("carries no application traffic at all", () => {
    // The app layer's shell built a ByteCountChunk addressed to the sink. A
    // network protocol has no such traffic of its own: every packet it sends is
    // one the model made.
    expect(cc).not.toContain("makeShared<ByteCountChunk>");
  });

  it("has one send method per packet type, named as MintRoute names its own", () => {
    // The advisor's structure, and the type names come from the model's own
    // partition lattice -- RTMCS generates sendRreqBroadcast/sendRrepBroadcast/
    // sendRrerBroadcast from its own.
    for (const m of ["sendBeaconBroadcast", "sendRouteBroadcast", "sendDataBroadcast"]) {
      expect(cc).toContain(`void ${CLS}::${m}(PktId pkt)`);
      expect(h).toContain(`virtual void ${m}(PktId pkt);`);
    }
  });

  it("dispatches to them on the packet's own type", () => {
    const send = cc.slice(cc.indexOf(`void ${CLS}::mediumSend`));
    const body = send.slice(0, send.indexOf("\n}"));
    expect(body).toContain("switch (held->getType())");
    expect(body).toContain("case PktType::BEACON: sendBeaconBroadcast(pkt); break;");
  });

  it("goes down to the MAC as a broadcast, not out through a socket", () => {
    const send = cc.slice(cc.indexOf(`void ${CLS}::sendBeaconBroadcast`));
    const body = send.slice(0, send.indexOf("\n}"));
    expect(body).toContain("setDownControlInfo(packet, MacAddress::BROADCAST_ADDRESS);");
    expect(body).toContain("sendDown(packet);");
    expect(body).not.toContain("socket");
  });
});

describe("medium binding: receive", () => {
  const arrival = cc.slice(cc.indexOf(`void ${CLS}::handleLowerPacket(Packet *packet) {`));
  const body = arrival.slice(0, arrival.indexOf("\n}"));

  it("runs the model's own delivery event rather than hand-coding its postcondition", () => {
    // Every argument comes from the arrival: the local id, the radio's answer,
    // the sender off the chunk, and the staged wire copies.
    expect(body).toContain(
      `${RX}(_pkt, _nbrs, _f, vPktSeqNo.at(_pkt), vPktSrc.at(_pkt), ` +
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
  const fn = cc.slice(cc.indexOf(`PktId ${CLS}::localIdFor`));
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
  const run = cc.slice(cc.indexOf(`bool ${CLS}::runEnabledEvents()`));
  const body = run.slice(0, run.indexOf("\n}"));

  it("does not fire the delivery or propagation events on their own timetable", () => {
    // Left schedulable, these fire on the SENDING node: it would compute its own
    // neighbours from the topology variable and deliver the packet to itself.
    for (const label of ["send_up", "find_neighbours", "assign_forwarder", "lose_all_neighbours"]) {
      expect(body).not.toContain(`try_${label}()`);
      // The label and the fact it is excluded are the seam; the REASON is now
      // one of several (the medium realises it / a carried event supersedes it)
      // and pinning its exact wording would test a constant.
      expect(h).toContain(`// not scheduled: ${label} -- `);
      expect(h).toMatch(new RegExp(`// not scheduled: ${label} -- .*medium`));
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
    // ⚠ Per field: `{pkt} ⩤ pktSeqNo` gives up pktSeqNo's domain and says
    // nothing about pktSrc's. Under the shared set one erase dropped them all,
    // which is why RTMCS's clear_pkt -- which deliberately never touches
    // pktSrc -- used to wipe it anyway.
    const tx = cc.slice(cc.indexOf(`bool ${CLS}::${TX}(int cn`));
    const body = tx.slice(0, tx.indexOf("\n}"));
    expect(body).toContain("live_pktSeqNo.erase(pkt);");
    expect(body).toContain("live_pktSrc.erase(pkt);");
  });

  // ⚠ THE SEND GOES LAST, AFTER EVERY ACTION. An Event-B event is atomic, so
  // the frame must carry the state the event PRODUCES. The app-layer transmit
  // structure this replaces sits at the TOP of the actions, and sending there
  // put the packet on the air before the event had finished stamping it:
  // RTMCS's send_down ends with `envDestAddr(pkt) ≔ nxt`, a chunk field, so
  // every frame left carrying it at its default and the receiver's send_up
  // declined 35 of 35 arrivals on exactly that comparison.
  //
  // MintRoute cannot show that symptom -- it writes only machine maps and live
  // sets after the send -- which is precisely why the ordering needs pinning
  // here rather than being left to a run that would not catch it.
  it("transmits after the event's actions, not before them", () => {
    const tx = cc.slice(cc.indexOf(`bool ${CLS}::${TX}(int cn`));
    const body = tx.slice(0, tx.indexOf("\n}"));
    const send = body.indexOf("mediumSend(");
    expect(send).toBeGreaterThan(0);
    // Nothing the event does may follow the send.
    const after = body.slice(send).split("\n").slice(1)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("//") && l !== "return true;");
    expect(after).toEqual([]);
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
    const methods = new RegExp(`^bool ${CLS}::(\w+)\([^)]*\) \{\n([\s\S]*?)\n\}`, "gm");
    for (const m of cc.matchAll(methods)) {
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
    const fn = cc.slice(cc.indexOf(`bool ${CLS}::finish_tx_pkt`));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("// The actions this event would perform, for reference only:");
    expect(body).toContain("// WiMedium.erase({f, pkt});");
  });

  it("finds at least one incomplete event, or it is checking nothing", () => {
    expect(cc).toContain(REFUSAL);
  });
});

// The base class, settled from INET source and confirmed by the advisor
// (2026-09-08). INET's own two shapes disagree, and the disagreement is the
// answer: MintRoute is a NetworkProtocolBase that carries packets, AODV is a
// RoutingProtocolBase daemon over UDP that manipulates a routing table through
// netfilter hooks and never carries one. The machines forward packets.
describe("network-layer shell", () => {
  it("is a network protocol, not an application", () => {
    expect(h).toContain(`class ${CLS} : public NetworkProtocolBase, public INetworkProtocol {`);
    expect(h).not.toContain("ApplicationBase");
    expect(h).not.toContain("INetworkSocket");
  });

  it("implements the base class's contract", () => {
    // getProtocol() is NetworkProtocolBase's only pure virtual; the packet
    // directions and the self-message are LayeredProtocolBase's.
    expect(h).toContain("const Protocol& getProtocol() const override");
    for (const m of ["handleUpperPacket", "handleLowerPacket", "handleSelfMessage"])
      expect(h).toContain(`void ${m}(`);
  });

  it("keeps MintRoute's three init stages, for MintRoute's reasons", () => {
    const init = cc.slice(cc.indexOf(`void ${CLS}::initialize(int stage) {`));
    const body = init.slice(0, init.indexOf("\n}\n"));
    expect(body).toContain("NetworkProtocolBase::initialize(stage);");
    for (const s of ["INITSTAGE_LOCAL", "INITSTAGE_NETWORK_INTERFACE_CONFIGURATION", "INITSTAGE_NETWORK_LAYER"])
      expect(body).toContain(s);
  });

  it("drives the model from a self-message timer, as MintRoute drives its floods", () => {
    const fn = cc.slice(cc.indexOf(`void ${CLS}::handleSelfMessage`));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("runEnabledEvents();");
    expect(body).toContain("scheduleAfter(tickInterval, modelTimer);");
  });

  it("carries the send-side utilities verbatim in shape from MintRoute", () => {
    const fn = cc.slice(cc.indexOf(`void ${CLS}::setDownControlInfo`));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("addTagIfAbsent<MacAddressReq>()->setDestAddress(macAddr);");
    expect(body).toContain("addTagIfAbsent<PacketProtocolTag>()->setProtocol(&getProtocol());");
    expect(cc).toContain("return myNetwAddr.getAddressType()->getBroadcastAddress();");
  });

  it("ships the network-layer wrapper the protocol cannot run without", () => {
    // MintRoute needs MintRouteNetworkLayer to have an ARP module and a
    // dispatcher; so does this. Both live in the one .ned, because the output
    // contract is three files.
    const ned = tree.find((f) => f.path.endsWith(".ned"))!.content;
    expect(ned).toContain(`simple ${CLS} extends NetworkProtocolBase like INetworkProtocol`);
    expect(ned).toContain(`module ${CLS}NetworkLayer like INetworkLayer`);
    expect(ned).toContain(`np: ${CLS} {`);
  });
});

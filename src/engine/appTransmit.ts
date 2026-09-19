// Transmit, for the APPLICATION shell.
//
// The network-layer module gets its transmit from the medium binding, which ends
// every frame in `sendDown(packet)` -- a NetworkProtocolBase method. An
// ApplicationBase has no such method; it has a socket. So this is the same three
// steps at a different layer, and the shape is taken from the shell's OWN
// working transmit rather than invented:
//
//     Packet *packet = new Packet(name);
//     packet->addTag<PacketProtocolTag>()->setProtocol(...);
//     packet->addTag<L3AddressReq>()->setDestAddress(...);
//     socket->send(packet);
//
// What this replaces, and why it is a replacement rather than an addition
// ----------------------------------------------------------------------
// The CommPattern merge already put SensorApp's transmit inside the model's own
// `send_down` method, and it sends a PLACEHOLDER: a ByteCountChunk of
// payloadLength bytes, addressed to the sink. That was right while the model had
// no packet of its own. Now it does -- the creating events build a PPkt and the
// transmit events stamp it -- so the placeholder is swapped for the packet the
// model actually made, dispatched on its own type.
//
// The per-type method names are MintRoute's, which is what the advisor asked
// for: sendBeaconBroadcast, sendRouteBroadcast, sendDataBroadcast. They are
// derived from the packet-type lattice's leaves, not listed, so a model with
// different packet types gets different methods (RTMCS: sendRreq/Rrep/Rrer).
//
// BROADCAST, because that is what the model means. MintRoute's own methods
// address MacAddress::BROADCAST_ADDRESS; the application's equivalent is the
// address type's broadcast address, the same value the network shell's
// resolveBroadcast() returns.

import type { GeneratedTree } from "./types";
import type { PacketModel, PacketField } from "./packetModel";
import { broadcastMethodOf, getterOf, setterOf, DELIVERED_BY } from "./packetModel";
import { headerOf, implOf } from "./emitted";
import { esc } from "./text";
import { emitLocalIdFor, identityMembers } from "./mediumBinding";
import type { PacketIdentity } from "./mediumBinding";

// Where the CommPattern merge put SensorApp's transmit inside the model's event.
const PLACEHOLDER_START = "    // — SensorApp transmit structure (SensorApp::sendSensorPacket) —";
const DISPATCH = "transmitPacket";
// The module's own record of which transmissions it has already realised, used
// only when the model's transmit event keeps no such record of its own.
const TX_DONE = "txRealised";

const decls = (tags: string[], once: boolean): string => [
  "    // ── Transmit ──",
  "    // One method per packet type, named as MintRoute names its own. The",
  "    // application hands the frame to its socket where the network protocol",
  "    // would hand it to sendDown(); everything else is the same three steps.",
  "    //",
  "    // `x` is send_down's own sender parameter — see the wire copy below for",
  "    // why the transmit takes it rather than reading it back off the chunk.",
  `    void ${DISPATCH}(Node x, PktId pkt);`,
  ...tags.map((t) => `    virtual void ${broadcastMethodOf(t)}(Node x, PktId pkt);`),
  "    L3Address broadcastAddress() const;",
  ...(once ? [
    "    // Transmissions this module has already realised. The model's own",
    "    // send_down keeps no such record, and nothing clears the pair it",
    "    // observes on the SENDER, so without this one packet goes on the air",
    "    // once per scheduler tick -- see transmitRecordsItsOwnFiring.",
    `    std::set<std::pair<Node, PktId>> ${TX_DONE};`,
  ] : []),
].join("\n");

const defs = (cls: string, tags: string[], senderSetter: string | null): string => {
  const one = (tag: string) => [
    `// Event-B: the model's own transmit, for a packet of type ${tag}.`,
    `// Shaped after MintRoute::${broadcastMethodOf(tag)}: build the frame from the`,
    "// packet the model made, address it to the broadcast address, send it, count it.",
    `void ${cls}::${broadcastMethodOf(tag)}(Node x, PktId pkt) {`,
    "    PPkt *held = pktOf(pkt);",
    "    if (held == nullptr || socket == nullptr) return;",
    "    auto chunk = makeShared<PPkt>(*held);",
    ...(senderSetter ? [
      "    // ⚠ THE SENDER IS PINNED FROM THE MODEL, NOT READ BACK OFF THE CHUNK.",
      "    //",
      "    // There is ONE local chunk per packet identity (localIdFor), and both",
      "    // the arrival and this transmit path use it. So between start_tx",
      "    // stamping the forwarder and this method copying the chunk, another",
      "    // arrival of the SAME packet from a different neighbour can overwrite",
      "    // that stamp -- and the frame then goes out carrying the neighbour's",
      "    // id. Receivers record a neighbour they have never heard from.",
      "    //",
      "    // The model already says who is sending: send_down observes",
      "    // `x ↦ pkt ∈ sentDown`, and that `x` is this transmission's sender.",
      "    // Pinning the wire copy from it closes the race without the local",
      "    // chunk having to be race-free -- the chunk is the model's state and",
      "    // stays as the model left it; only the copy on the wire is fixed.",
      "    //",
      "    // Measured before this: 15 frames across a nine-node field left with",
      "    // the wrong forwarder, which cost every node up to three neighbour",
      "    // table entries for nodes outside its radio range.",
      `    chunk->${senderSetter}(x);`,
    ] : []),
    "    chunk->setChunkLength(B(payloadLength));",
    `    Packet *packet = new Packet("eb-${tag.toLowerCase()}", chunk);`,
    "    packet->addTag<PacketProtocolTag>()->setProtocol(&Protocol::manet);",
    "    packet->addTag<L3AddressReq>()->setDestAddress(broadcastAddress());",
    "    emit(packetSentSignal, packet);",
    "    socket->send(packet);",
    "    sentCount++;",
    "}",
  ].join("\n");

  return [
    "// The broadcast address of whatever address type this node resolved, which is",
    "// the same value the network-layer shell's resolveBroadcast() returns.",
    `L3Address ${cls}::broadcastAddress() const {`,
    "    return sinkAddress.isUnspecified()",
    "        ? L3Address() : sinkAddress.getAddressType()->getBroadcastAddress();",
    "}",
    "",
    "// Dispatch on the packet's OWN type, as the model recorded it.",
    `void ${cls}::${DISPATCH}(Node x, PktId pkt) {`,
    "    PPkt *held = pktOf(pkt);",
    "    if (held == nullptr) return;",
    "    switch (held->getType()) {",
    ...tags.map((t) => `        case PktType::${t}: ${broadcastMethodOf(t)}(x, pkt); break;`),
    "        default:",
    `            EV_WARN << "${cls}: packet " << pkt << " has no transmit method for its type" << endl;`,
    "            break;",
    "    }",
    "}",
    "",
    ...tags.map(one),
  ].join("\n");
};

// Replace the placeholder transmit inside the model's send_down method with the
// dispatch. The region runs from the marker the CommPattern merge writes to the
// method's closing `return true;`, so the event's GUARDS and its accounting are
// untouched -- only what is put on the wire changes.
function rewriteSendDown(cc: string, once: boolean): string {
  const at = cc.indexOf(PLACEHOLDER_START);
  if (at < 0) return cc;
  const end = cc.indexOf("\n    return true;\n}", at);
  if (end < 0)
    throw new Error("appTransmit: the SensorApp transmit block has no closing `return true;`.");
  return cc.slice(0, at) + [
    "    // The model made this packet; send THAT, not a placeholder payload.",
    "    // (The CommPattern merge put SensorApp's own ByteCountChunk transmit here,",
    "    // which was right while the model had no packet of its own.)",
    `    if (socket == nullptr) return false;`,
    ...(once ? [
      "    // ⚠ ONE TRANSMISSION PER (node, packet).",
      "    //",
      "    // This model's send_down is an OBSERVATION -- it has no actions, and",
      "    // nothing here removes the pair it observes: `sentDown` is cleared by",
      "    // send_up, which in a per-node module runs on the RECEIVER. So the",
      "    // guard above stays true for ever on the sender and the scheduler",
      "    // re-fires the event every tick. Measured: 57 frames on the air for one",
      "    // start_tx_bconPkt.",
      "    //",
      "    // Re-firing the EVENT is legal -- with no actions it is idempotent.",
      "    // Realising it is not, because the realisation is a transmission. A",
      "    // model whose own transmit event keeps this record (MintRoute guards",
      "    // `cn ↦ pkt ∉ channel` and adds to it) gets none of this; see",
      "    // transmitRecordsItsOwnFiring.",
      `    if (!${TX_DONE}.insert({x, pkt}).second)`,
      "        return false;",
    ] : []),
    `    ${DISPATCH}(x, pkt);`,
    "    sendSeqNo++;",
  ].join("\n") + cc.slice(end);
}

export function installAppTransmit(tree: GeneratedTree, cls: string, pm: PacketModel,
  // True when the model's transmit event does NOT record its own firing, so the
  // module must. See transmitRecordsItsOwnFiring.
  once = false,
  // The field that carries the sender, from senderFieldOf. The FIELD, not one
  // of its spellings: this used to take a pre-derived setter name while the
  // arrival took a pre-derived getter and the scheduler took the Event-B name,
  // three primitive shapes of one concept crossing three boundaries.
  // Null when the model stamps no such field, in which case the wire copy is
  // left exactly as the model made it.
  senderField: PacketField | null = null): GeneratedTree {
  // Ordered by tag value, the same order the PktType enum is emitted in.
  const tags = [...pm.lattice.tagOf.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t);
  if (tags.length === 0) return tree;

  const h = headerOf(tree), cc = implOf(tree);
  if (!h || !cc) return tree;
  const anchor = "    // Event-B events, one guarded bool method each";
  if (!h.content.includes(anchor))
    throw new Error("appTransmit: no event block found to place the transmit declarations before.");

  return tree.map((f) => {
    if (f.path.endsWith(".h"))
      return { ...f, content: f.content
        .replace(anchor, decls(tags, once) + "\n\n" + anchor)
        // getAddressType() lives here; the app shell does not already include it.
        .replace('#include "inet/networklayer/common/L3Address.h"',
          '#include "inet/networklayer/common/L3Address.h"\n'
          + '#include "inet/networklayer/contract/IL3AddressType.h"') };
    if (f.path.endsWith(".cc")) {
      const body = rewriteSendDown(f.content, once);
      const at = body.search(new RegExp(`^bool ${esc(cls)}::`, "m"));
      if (at < 0) throw new Error("appTransmit: no event method to place the transmit definitions before.");
      return { ...f, content: body.slice(0, at) + defs(cls, tags, senderField ? setterOf(senderField) : null) + "\n\n" + body.slice(at) };
    }
    return f;
  });
}

// ── Receive ────────────────────────────────────────────────────────────────
//
// The mirror of the transmit, and the other half of what the network module
// gets from the medium binding. An arrival IS the delivery the model's `send_up`
// describes, so the callback does not hand-write that event's postcondition --
// it stages what the event's guards require and then RUNS the event.
//
// This replaces the `EXTENSION POINT (send-up flow)` the app-layer shell has
// carried since v4, which said in as many words that binding the identities and
// calling the send_up overload here was the remaining hand step.
const ARRIVAL_MARKER = "    // EXTENSION POINT (send-up flow):";

// What an arrival puts into the medium before running the delivery: the
// memberships the delivery event's own guards require present (`insert`) and
// absent (`remove`), plus what the receive events downstream of it require.
export interface MediumStaging {
  insert: readonly string[];
  remove: readonly string[];
}

function arrival(deliverMethod: string, senderGetter: string,
  staged: MediumStaging, deserialise: readonly { setter: string; getter: string }[]): string[] {
  const pair = "{_f, _pkt}";
  // Remember only what was actually CHANGED. Inserting a pair a set already
  // holds changes nothing, so erasing it on the way out would delete state the
  // model owns rather than state this arrival staged.
  const stage = [
    ...staged.insert.map((v) => `    bool _st_${v} = ${v}.insert(${pair}).second;`),
    ...staged.remove.map((v) => `    bool _st_${v} = ${v}.erase(${pair}) > 0;`),
  ];
  const undo = [
    ...staged.insert.map((v) => `        if (_st_${v}) ${v}.erase(${pair});`),
    ...staged.remove.map((v) => `        if (_st_${v}) ${v}.insert(${pair});`),
  ];
  return [
    "    // An arrival is the delivery the model's send_up describes. Peek the",
    "    // front chunk AS A CHUNK and cast: peeking it as a PPkt asks INET to",
    "    // CONVERT whatever is there into one, which throws on any other chunk",
    "    // type -- and the shell's own traffic arrives at this same callback.",
    "    auto _front = packet->peekAtFront<Chunk>(b(-1), Chunk::PF_ALLOW_NULLPTR);",
    "    auto _wire = dynamicPtrCast<const PPkt>(_front);",
    "    if (_wire == nullptr) {",
    "        EV_INFO << \"non-model arrival (\" << packet->getByteLength() << \"B)\" << endl;",
    "        receivedCount++;",
    "        emit(packetReceivedSignal, packet);",
    "        delete packet;",
    "        return;",
    "    }",
    "    // ⚠ ECHO SUPPRESSION, on an address the SIMULATOR owns.",
    "    //",
    "    // An IP stack delivers a limited broadcast back UP to its own sender, so",
    "    // this callback sees the node's own frames. The obvious test -- is the",
    "    // packet's forwarder me? -- CANNOT be used: the forwarder is a model",
    "    // field and the model re-stamps it. Measured: the sink transmitted its",
    "    // own beacon carrying another node's id as the forwarder, so the test",
    "    // passed, the echo was accepted, and each accepted echo produced another",
    "    // beacon at zero simulated time. 52,034 events at one instant.",
    "    //",
    "    // The L3 source address is the simulator's own record of who sent it.",
    "    auto _srcInd = packet->findTag<L3AddressInd>();",
    "    if (_srcInd != nullptr && isOwnAddress(_srcInd->getSrcAddress())) {",
    "        delete packet;   // our own broadcast, looped back by the stack",
    "        return;",
    "    }",
    `    Node _f = _wire->${senderGetter}();`,
    "    emit(packetReceivedSignal, packet);",
    "    receivedCount++;",
    "    PktId _pkt = localIdFor(_wire.get());",
    // WHO DELIVERED IT -- recorded here because that is the only place it is
    // known. The publication outlives this arrival and the shared chunk moves
    // on; see DELIVERED_BY.
    `    ${DELIVERED_BY}[_pkt] = _f;`,
    ...(deserialise.length === 0 ? [] : [
      "    // ⚠ DESERIALISE, because the model's own delivery event does not.",
      "    //",
      "    // Event-B keeps a packet's attributes as functions keyed by packet id,",
      "    // so \"this node knows this packet\" is literally `pkt ∈ dom(pktNbHops)`.",
      "    // The packet source's own delivery event restores every field from the",
      "    // wire copies its transmit staged, and a module running THAT event gets",
      "    // the deserialisation for free. This module runs the base chain's",
      "    // delivery event instead -- the abstract one, which publishes who",
      "    // received the packet and nothing else -- because the CommPattern pair",
      "    // belongs to the base model and is what the socket callback is bound to.",
      "    // So the arrival does it: without this the chunk exists locally while",
      "    // the model considers the packet non-existent, and every carried receive",
      "    // event fails that domain guard. Measured: 18 of 18 rejections.",
      "    PPkt *_local = ensurePkt(_pkt);",
      ...deserialise.map((d) => `    _local->${d.setter}(_wire->${d.getter}());`),
      "    pktLive.insert(_pkt);",
    ]),
    "    // What the delivery and the receive events require of the MEDIUM. In the",
    "    // global model the transmitting node wrote these into one shared",
    "    // relation; here the transmission itself is the evidence, and it just",
    "    // happened. Derived from the events' own guards -- see",
    "    // arrivalRequirementsOf and deliveryRequirementsOf. Without the medium",
    "    // membership every attempt at the forwarding event was rejected by its",
    "    // FIRST guard and no later one was ever reached.",
    "    //",
    "    // ⚠ STAGED, AND UNDONE WHEN THE DELIVERY DECLINES. These memberships are",
    "    // a PRECONDITION being asserted, not state the model asked for: they say",
    "    // \"a transmission of this packet reached this node\", and they are only",
    "    // true of the model's state once the delivery event has consumed them. A",
    "    // declined delivery that leaves them behind poisons the medium — measured:",
    "    // send_up fired 1-3 times on a node that received dozens of frames, and",
    "    // every other arrival left a pair in sentDown that nothing removes, after",
    "    // which the forwarding event's `pkt ∉ ran(sentDown)` guard could never be",
    "    // true again. Same defect as the scheduler's bail-out leak: stage, fail,",
    "    // don't roll back.",
    ...stage,
    "    // Who received it: this node. The radio already decided that.",
    "    std::set<Node> _nbrs{ myNodeId };",
    `    if (${deliverMethod}(_f, _pkt, _nbrs)) {`,
    '        firedCount["send_up"]++;',
    "    } else {",
    "        // Nothing consumed the staging, so this node never saw the packet as",
    "        // far as the model is concerned. Put the medium back exactly as found.",
    ...undo,
    "    }",
    "    // A delivery enables the receive events; run one round now rather than",
    "    // waiting for the next tick. That is what turns a reception into a",
    "    // rebroadcast: they re-queue the packet into the buffer the transmit",
    "    // events read.",
    "    runDeliveryEvents();",
    "    delete packet;",
    "}",
  ];
}

// Whether an address belongs to THIS node -- any of its interfaces, not one
// resolved address.
//
// ⚠ The one-address version was wrong and the run said so. An IP stack loops a
// limited broadcast back to its own sender, and the copy that comes back
// carries the LOOPBACK address as its source: the trace reads
// `me=10.0.0.1 src=127.0.0.1`, so `src == myNetwAddr` was false and the node
// accepted, counted and re-stamped its own beacon. The interface table is the
// node's own list of every address it answers to, loopback included, so it
// cannot be defeated by which interface the stack chose to deliver through.
const isOwnAddressFn = (cls: string): string => [
  "// Is this address one of this node's own? See above: an echo comes back with",
  "// the LOOPBACK source address, so one resolved address is not enough.",
  `bool ${cls}::isOwnAddress(const L3Address& addr) const {`,
  "    if (addr.isUnspecified()) return false;",
  "    IInterfaceTable *ift = L3AddressResolver().findInterfaceTableOf(getContainingNode(this));",
  "    return ift != nullptr && ift->findInterfaceByAddress(addr) != nullptr;",
  "}",
].join("\n");

export function installAppReceive(tree: GeneratedTree, cls: string,
  id: PacketIdentity, deliverMethod: string, senderField: PacketField,
  staged: MediumStaging = { insert: [], remove: [] },
  deserialise: readonly { setter: string; getter: string }[] = []): GeneratedTree {
  return tree.map((f) => {
    if (f.path.endsWith(".h"))
      return { ...f, content: f.content
        .replace("    // ── Transmit ──",
          `    // Who delivered each packet to this node: a property of the DELIVERY,
    // not of the packet, and not readable off the shared chunk once this
    // node's own transmit has re-stamped it.
    std::map<PktId, Node> ${DELIVERED_BY};
`
          + identityMembers
          + "\n    // True when the address is one of this node's own, loopback included."
          + "\n    bool isOwnAddress(const L3Address& addr) const;\n"
          + "\n    // ── Transmit ──")
        // findInterfaceByAddress lives here; the app shell includes neither.
        .replace('#include "inet/networklayer/contract/IL3AddressType.h"',
          '#include "inet/networklayer/contract/IL3AddressType.h"\n'
          + '#include "inet/networklayer/contract/IInterfaceTable.h"') };
    if (f.path.endsWith(".cc")) {
      const at = f.content.indexOf(ARRIVAL_MARKER);
      if (at < 0) return f;
      const end = f.content.indexOf("\n}", at);
      if (end < 0) throw new Error("appTransmit: the arrival callback has no closing brace.");
      const body = f.content.slice(0, at)
        + arrival(deliverMethod, getterOf(senderField), staged, deserialise).join("\n")
        + f.content.slice(end + 2);
      // localIdFor and isOwnAddress go beside the transmit methods.
      const defAt = body.indexOf("// The broadcast address of whatever address type");
      return { ...f, content: defAt < 0 ? body
        : body.slice(0, defAt) + emitLocalIdFor(id, cls) + "\n\n"
          + isOwnAddressFn(cls) + "\n\n" + body.slice(defAt) };
    }
    return f;
  });
}

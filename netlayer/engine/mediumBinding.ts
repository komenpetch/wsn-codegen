import type { EncodedMachine, GeneratedTree, FlatEvent } from "../../src/engine/types";
import { splitConjuncts } from "../../src/engine/ruleEngine";
import type { PacketModel, PacketField } from "./packetModel";

// The medium binding: the third and last of the identity bindings.
//
// `PktId → PPkt` gave the generated code a packet; `ND → simulation nodes` gave
// it a node. Both replaced a documented hand step with generator capability.
// This one replaces the last: the model's MEDIUM -- the variables a packet
// passes through between leaving one node and arriving at another -- with the
// simulator's own radio.
//
// Why it cannot be done with a translation rule
// ---------------------------------------------
// Every model variable is indexed by node. `WiMedium ∈ ND ↔ PKT` is not "this
// node's radio", it is EVERY node's, as one relation: the machine describes the
// whole network as a single state space. The generated module is one class per
// node, so each node gets a private copy of a structure that was meant to be
// shared, and the sink's transmission lands in the sink's own `ctlNeighbours`
// where no other node will ever look. That is not a missing clause. It is a
// question about how a global machine is realised across distributed modules,
// and the honest answer is that the medium variables are not translated at all
// -- they are REPLACED by a real transmission, which INET already implements in
// far more detail than the model does (propagation, range, interference,
// collisions). See findings/2026-09-07-global-model-per-node-module.md.
//
// What the binding actually does
// ------------------------------
// Transmit: when the model's own transmit event fires, the packet's chunk goes
// out on the air, broadcast, exactly once.
//
// Receive: an arrival is the simulator's answer to the question the model asks
// with `envNeighbours` -- "who is in range". So the arriving node writes that
// answer into the propagation variable (`{pkt ↦ me}`), stages the wire copies
// the transmission carried, and then runs THE MODEL'S OWN delivery event. It
// does not hand-code the delivery postcondition: `send_up` executes, on the
// receiver, driven by a real reception.
//
// The events the simulator thereby realises (propagation, delivery) are removed
// from the spontaneous scheduler. Left in, they would fire on the SENDER, which
// would compute its own neighbours from the model's topology variable and
// deliver the packet to itself -- a flood that propagates entirely inside one
// module, which is precisely the convincing-green-run failure this project
// exists to avoid.
//
// Nothing below names a protocol. The two event labels it starts from,
// `send_down` and `send_up`, are the CommPattern pair -- the same two labels
// the app-layer emitter itself keys on to merge the SensorApp transmit and
// receive structures (codeEmitter.ts) -- and everything else is derived from
// what those two events read and write.

const TRANSMIT = "send_down";
const DELIVER = "send_up";

export interface MediumPlan {
  transmit: string;
  deliver: string;
  deliverMethod: string;         // emitted name (the CommPattern rename)
  txPacketParam: string;
  rxPacketParam: string;
  senderParam: string;           // the transmitting node, as `send_up` names it
  senderGetter: string;          // the chunk field the model stamps it into
  wire: { staging: string; getter: string }[];
  requires: string[];            // pair-sets an arrival must place {f, pkt} in
  propagation: string;
  identity: { getter: string; cast: boolean }[];
  carried: { setter: string; getter: string }[];   // fields the model never restores
  args: string[];
  tags: string[];                 // packet-type leaves, one transmit method each
  realisedByMedium: Set<string>;
}

const conj = (ev: FlatEvent) => ev.guards.flatMap(splitConjuncts).map((c) => c.trim());
const acts = (ev: FlatEvent) => ev.actions.flatMap(splitConjuncts).map((c) => c.trim());
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const getterOf = (f: PacketField) => `get${cap(f.name)}`;
const setterOf = (f: PacketField) => `set${cap(f.name)}`;

// The parameter a packet-field read is keyed on: in `sno = pktSeqNo(pkt)`, that
// is `pkt`. Reading it off the clauses rather than off the parameter's C++ type
// matters -- the emitter types a parameter `PktId` only where the event states
// `pkt ∈ PKT`, and the receive events never do. Guards and ACTIONS both, because the two halves of the pair use packet
// fields in opposite directions: the transmit event READS them
// (`sno = pktSeqNo(pkt)`) on its way to the wire, and the delivery event only
// ever WRITES them (`pktSeqNo ≔ pktSeqNo ∪ {pkt ↦ sno}`) on the way back. A
// guards-only version finds the transmit event's parameter and returns nothing
// for the delivery event's -- which reads as "this model has no medium".
function packetParamOf(ev: FlatEvent, fields: PacketField[]): string | undefined {
  for (const f of fields) {
    for (const c of conj(ev)) {
      const m = new RegExp(`^\\w+\\s*=\\s*${f.ebName}\\(\\s*(\\w+)\\s*\\)$`).exec(c);
      if (m) return m[1];
    }
    for (const a of acts(ev)) {
      const m = new RegExp(
        `^${f.ebName}\\s*≔\\s*${f.ebName}\\s*(?:[\\uE103⊕⊴∪]\\s*)?\\{\\s*(\\w+)\\s*↦\\s*\\w+\\s*\\}$`).exec(a);
      if (m) return m[1];
    }
  }
  return undefined;
}

// A field is part of a packet's IDENTITY exactly when no event ever overwrites
// it: `pktFwdr` and `pktNbHops` are re-stamped at every hop, so they describe
// the last hop, not the packet. What is left -- the originating address, the
// sequence number, the payload -- is what makes two receptions of "the same
// packet" recognisable as the same packet, which is what the flood's own
// duplicate test needs (`pkt ∉ floodTbl(nb)` is asked of a packet, not of a
// transmission).
//
// Two spellings of "change this packet's attribute", and both matter:
// relational override (`pktFwdr ≔ pktFwdr ⊕ {pkt ↦ x}`) and the per-key update
// (`netSeqNo(pkt) ≔ lsno`). Missing the second one put the per-hop link
// sequence number into the identity key, which gives the same packet a
// different key at every hop -- the duplicate test can then never be true and a
// flood never stops.
//
// The CREATING events are excluded: they use the override spelling too, but
// that is how the attribute gets its value in the first place, not a change of
// identity. Every other event writing it that way is changing a packet that
// already exists.
function immutableFields(model: EncodedMachine, pm: PacketModel): PacketField[] {
  const creating = new Set(pm.leaves.map((l) => l.event));
  const mutated = new Set<string>();
  for (const ev of model.events) {
    if (creating.has(ev.label)) continue;
    for (const a of acts(ev))
      for (const f of pm.fields) {
        if (new RegExp(`^${f.ebName}\\s*≔\\s*${f.ebName}\\s*[\\uE103⊕⊴]`).test(a)) mutated.add(f.ebName);
        if (new RegExp(`^${f.ebName}\\s*\\(\\s*\\w+\\s*\\)\\s*≔`).test(a)) mutated.add(f.ebName);
      }
  }
  return pm.fields.filter((f) => !mutated.has(f.ebName));
}

export function planMedium(model: EncodedMachine, pm: PacketModel, cc: string, cls: string): MediumPlan | null {
  const tx = model.events.find((e) => e.label === TRANSMIT);
  const rx = model.events.find((e) => e.label === DELIVER);
  if (!tx || !rx) return null;                     // no CommPattern pair, no medium
  const fields = pm.fields;
  const enc = (id: string) => model.encodings.get(id);

  const txPkt = packetParamOf(tx, fields);
  const rxPkt = packetParamOf(rx, fields);
  if (!txPkt || !rxPkt) return null;

  // The wire format, read off the transmit event: for each parameter it binds
  // from a packet field (`sno = pktSeqNo(pkt)`) and then stores in a machine
  // variable (`vPktSeqNo ≔ vPktSeqNo ∪ {pkt ↦ sno}`), that variable IS the
  // wire copy of that field. This is the model's own serialisation, stated in
  // its own actions; the binding just reads which pairs it names.
  const wire: { staging: string; getter: string }[] = [];
  for (const f of fields) {
    const read = conj(tx).map((c) =>
      new RegExp(`^(\\w+)\\s*=\\s*${f.ebName}\\(\\s*${txPkt}\\s*\\)$`).exec(c)).find(Boolean);
    if (!read) continue;
    const q = read[1];
    const stored = acts(tx).map((a) =>
      new RegExp(`^(\\w+)\\s*≔\\s*\\1\\s*∪\\s*\\{\\s*${txPkt}\\s*↦\\s*${q}\\s*\\}$`).exec(a)).find(Boolean);
    if (stored) wire.push({ staging: stored[1], getter: getterOf(f) });
  }
  if (wire.length === 0) return null;              // nothing is serialised: not a medium

  // What the delivery event demands of the medium: every `f ↦ pkt ∈ V` guard
  // over a pair-set. An arrival has to make those true, because in the global
  // model they were made true by the transmitting node writing the same shared
  // relation.
  const requires: string[] = [];
  let senderParam = "";
  for (const c of conj(rx)) {
    const m = new RegExp(`^(\\w+)\\s*↦\\s*${rxPkt}\\s*∈\\s*(\\w+)$`).exec(c);
    if (m && enc(m[2]) === "pair-set") { requires.push(m[2]); senderParam = m[1]; }
  }
  if (requires.length === 0 || !senderParam) return null;

  // Which chunk field carries the transmitting node. Not assumed to be "the
  // forwarder field" by name: the event that puts a packet INTO the medium is
  // the one that stamps it, and it stamps it with the same parameter it files
  // the packet under -- `WiMedium ≔ WiMedium ∪ {x ↦ pkt}` alongside
  // `pktFwdr ≔ pktFwdr ⊕ {pkt ↦ x}`. That equality is the model saying a frame
  // carries its sender, which is also what a radio does.
  let senderGetter = "";
  for (const ev of model.events) {
    if (ev.label === TRANSMIT || ev.label === DELIVER) continue;
    for (const a of acts(ev)) {
      const put = requires.map((v) =>
        new RegExp(`^${v}\\s*≔\\s*${v}\\s*∪\\s*\\{\\s*(\\w+)\\s*↦\\s*(\\w+)\\s*\\}$`).exec(a)).find(Boolean);
      if (!put) continue;
      const [, x, p] = put;
      for (const f of fields)
        if (acts(ev).some((b) =>
          new RegExp(`^${f.ebName}\\s*≔\\s*${f.ebName}\\s*[\\uE103⊕⊴]\\s*\\{\\s*${p}\\s*↦\\s*${x}\\s*\\}$`).test(b)))
          senderGetter = getterOf(f);
    }
  }
  if (!senderGetter) return null;

  // The propagation variable: what the delivery event reads to learn who
  // receives. In the model an environment event fills it from the topology
  // relation; here the radio fills it, one arrival at a time.
  const prop = conj(rx).map((c) =>
    new RegExp(`^(\\w+)\\s*=\\s*ran\\s*\\(\\s*\\{\\s*${rxPkt}\\s*\\}\\s*◁\\s*(\\w+)\\s*\\)$`).exec(c)).find(Boolean);
  if (!prop) return null;
  const [, nbrsParam, propagation] = prop;

  // Events the simulator now realises: the delivery event itself, plus every
  // event whose whole effect is on the propagation variable -- those are the
  // model's simulation of "who is in range", which is the radio's answer, not
  // a decision the protocol makes.
  const realisedByMedium = new Set<string>([DELIVER]);
  for (const ev of model.events) {
    if (ev.label === "INITIALISATION" || ev.label === DELIVER) continue;
    const a = acts(ev);
    if (a.length > 0 && a.every((x) => new RegExp(`^${propagation}\\s*≔`).test(x)))
      realisedByMedium.add(ev.label);
  }

  // The call into the model's own delivery event. Every argument must come from
  // something the arrival actually has -- the chunk, the staged wire copies, or
  // the simulator's answer. A parameter that fits none of those means the model
  // asks for something a reception does not carry, and the binding refuses
  // rather than inventing a value.
  const sig = new RegExp(`^// Event-B: ${DELIVER}[^\\n]*\\nbool ${cls}::(\\w+)\\(([^)]*)\\) \\{$`, "m").exec(cc)
    ?? new RegExp(`^bool ${cls}::(${DELIVER})\\(([^)]*)\\) \\{$`, "m").exec(cc);
  if (!sig) return null;
  const deliverMethod = sig[1];
  const params = sig[2].trim() === "" ? [] : sig[2].split(",").map((p) => p.trim().split(/\s+/).pop()!);

  const args: string[] = [];
  for (const p of params) {
    if (p === rxPkt) { args.push("_pkt"); continue; }
    if (p === nbrsParam) { args.push("_nbrs"); continue; }
    if (p === senderParam) { args.push("_f"); continue; }
    const staged = conj(rx).map((c) =>
      new RegExp(`^${p}\\s*=\\s*(\\w+)\\(\\s*${rxPkt}\\s*\\)$`).exec(c)).find(Boolean);
    if (staged && wire.some((w) => w.staging === staged[1])) { args.push(`${staged[1]}.at(_pkt)`); continue; }
    // `pkt ↦ nxt ∈ F` with F a packet field -- a function's graph tested via
    // maplet membership, which for a bound `pkt` is just a read of F. RTMCS's
    // send_up binds its next-hop parameter this way and MintRoute's does not,
    // so without this the binding worked for one case study and refused the
    // other. Read from the ARRIVING chunk, not from this node's copy: the local
    // chunk is fresh and carries only what localIdFor put on it, while the wire
    // carries every field the sender stamped.
    const graph = conj(rx).map((c) =>
      new RegExp(`^${rxPkt}\\s*↦\\s*${p}\\s*∈\\s*(\\w+)$`).exec(c)).find(Boolean);
    const asField = graph && fields.find((f) => f.ebName === graph[1]);
    if (asField) { args.push(`wire->${getterOf(asField)}()`); continue; }
    return null;                                    // unbindable parameter: refuse
  }

  const identity = immutableFields(model, pm)
    .map((f) => ({ getter: getterOf(f), cast: false }));
  identity.unshift({ getter: "getType", cast: true });   // the discriminator is immutable too

  // What the model does NOT restore for itself. `send_up` re-populates the
  // packet-attribute variables from the wire copies, so those are its job; the
  // context-sourced fields (a packet's fixed identity) and the discriminator
  // are constants no event ever assigns, so they have to be carried across with
  // the chunk.
  const carried = fields.filter((f) => f.source === "context")
    .map((f) => ({ setter: setterOf(f), getter: getterOf(f) }));

  return {
    transmit: TRANSMIT, deliver: DELIVER, deliverMethod,
    txPacketParam: txPkt, rxPacketParam: rxPkt,
    senderParam, senderGetter, wire, requires, propagation,
    identity, carried, args, realisedByMedium,
    // Ordered by tag value, the same order the PktType enum is emitted in.
    tags: [...pm.lattice.tagOf.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t),
  };
}

// ── emission ────────────────────────────────────────────────────────────────

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
// One transmit method per packet type, named as MintRoute names its own:
// BEACON -> sendBeaconBroadcast, ROUTE -> sendRouteBroadcast. Every packet the
// model transmits goes out as a broadcast, because the model's medium names no
// destination -- it delivers to whoever is in range.
const sendName = (tag: string) => `send${cap1(tag)}Broadcast`;

function members(plan: MediumPlan): string {
  return [
    "    // ── Medium binding ──",
    "    // A packet's identity ACROSS nodes. Each module mints its own PktIds,",
    "    // so the same packet is a different integer on every node; the flood's",
    "    // duplicate test asks about the packet, not about the integer. The key",
    "    // is the fields no event ever overwrites -- see immutableFields().",
    "    std::map<std::vector<long>, PktId> pktIdByWire;",
    "    void mediumSend(PktId pkt);",
    ...plan.tags.map((t) => `    virtual void ${sendName(t)}(PktId pkt);`),
    "    PktId localIdFor(const PPkt *w);",
  ].join("\n");
}

function transmitFn(plan: MediumPlan, cls: string): string {
  const one = (tag: string) => [
    `// Event-B: ${plan.transmit} (the model's own hand-to-the-medium), for a`,
    `// packet of type ${tag}. Shaped after MintRoute::${sendName(tag)}: build the`,
    "// frame, address it to the MAC broadcast, send it down, count it.",
    `void ${cls}::${sendName(tag)}(PktId pkt) {`,
    "    PPkt *held = pktOf(pkt);",
    "    if (held == nullptr) return;",
    "    auto chunk = makeShared<PPkt>(*held);",
    "    chunk->setChunkLength(B(headerLength));",
    `    auto packet = new Packet("eb-${tag.toLowerCase()}", chunk);`,
    "    setDownControlInfo(packet, MacAddress::BROADCAST_ADDRESS);",
    "    emit(packetSentSignal, packet);",
    "    sendDown(packet);",
    "    sentCount++;",
    "}",
  ].join("\n");

  return [
    "// Hand the packet to the medium. The model does not name a destination --",
    "// its medium delivers to whoever is in range -- so every packet goes out as",
    "// a broadcast, and which method builds it is decided by the packet's own",
    "// type, exactly as MintRoute has one send method per packet type.",
    `void ${cls}::mediumSend(PktId pkt) {`,
    "    PPkt *held = pktOf(pkt);",
    "    if (held == nullptr) return;",
    "    switch (held->getType()) {",
    ...plan.tags.map((t) => `        case PktType::${t}: ${sendName(t)}(pkt); break;`),
    "        default:",
    `            EV_WARN << "${cls}: packet " << pkt << " has no transmit method for its type" << endl;`,
    "            break;",
    "    }",
    "}",
    "",
    ...plan.tags.map(one),
  ].join("\n\n");
}

function identityFn(plan: MediumPlan, cls: string): string {
  const key = plan.identity.map((i) =>
    i.cast ? `static_cast<long>(w->${i.getter}())` : `static_cast<long>(w->${i.getter}())`);
  return [
    "// Resolve an arriving chunk to THIS node's id for that packet, minting one",
    "// the first time. Two receptions of the same packet -- over different hops,",
    "// from different forwarders -- must land on the same id, or the model's own",
    "// duplicate test can never be true and the flood never terminates.",
    `PktId ${cls}::localIdFor(const PPkt *w) {`,
    `    std::vector<long> key{ ${key.join(", ")} };`,
    "    auto it = pktIdByWire.find(key);",
    "    if (it != pktIdByWire.end()) return it->second;",
    "    PktId id = newPktId();",
    "    pktIdByWire[key] = id;",
    "    // The fields the model never restores for itself: a packet's fixed",
    "    // identity, which is context in Event-B and travels with the chunk here.",
    "    PPkt *local = ensurePkt(id);",
    "    local->setType(w->getType());",
    ...plan.carried.map((c) => `    local->${c.setter}(w->${c.getter}());`),
    "    return id;",
    "}",
  ].join("\n");
}

function arrivalFn(plan: MediumPlan, cls: string): string {
  return [
    "// An arrival IS the medium. INET's radio has already decided that this node",
    "// is in range -- that is the question the model asks with its propagation",
    "// variable, and this is the answer. So the arrival stages what the",
    "// transmission carried and then runs THE MODEL'S OWN delivery event; the",
    "// postcondition is not hand-written here, it is executed.",
    "//",
    "// This is MintRoute's handleLowerPacket position: a frame off the air,",
    "// dispatched on what the model says it is.",
    `void ${cls}::handleLowerPacket(Packet *packet) {`,
    "    // Peek the front chunk AS A CHUNK and cast. Peeking it as a PPkt asks",
    "    // INET to CONVERT whatever is there into one, which throws on any other",
    "    // chunk type -- and the shell's own sensing traffic (a ByteCountChunk",
    "    // addressed to the sink) arrives at this same callback. PF_ALLOW_NULLPTR",
    "    // does not cover that: it permits a short chunk, not a wrong one.",
    "    auto front = packet->peekAtFront<Chunk>(b(-1), Chunk::PF_ALLOW_NULLPTR);",
    "    auto wire = dynamicPtrCast<const PPkt>(front);",
    "    if (wire == nullptr) {",
    "        // Not a model packet: the shell's own application traffic. Account",
    "        // for it the way the shell did rather than dropping it silently.",
    "        EV_INFO << \"" + cls + ": non-model arrival (\" << packet->getByteLength() << \"B)\\n\";",
    "        receivedCount++;",
    "        emit(packetReceivedSignal, packet);",
    "        delete packet;",
    "        return;",
    "    }",
    `    Node _f = wire->${plan.senderGetter}();`,
    "    if (_f == myNodeId) { delete packet; return; }   // our own broadcast, echoed back",
    "    emit(packetReceivedSignal, packet);",
    "",
    "    PktId _pkt = localIdFor(wire.get());",
    "    // Deserialise: the wire copies the transmit event staged, back into the",
    "    // variables the delivery event reads them from.",
    ...plan.wire.map((w) => `    ${w.staging}[_pkt] = wire->${w.getter}();`),
    "    // The medium state the delivery event requires. In the global model the",
    "    // transmitting node wrote these into the one shared relation; here the",
    "    // transmission itself is the evidence, and it just happened.",
    ...plan.requires.map((v) => `    ${v}.insert({_f, _pkt});`),
    "    // Who receives: the radio's answer, not the topology variable's.",
    `    ${plan.propagation}[_pkt].clear();`,
    `    ${plan.propagation}[_pkt].insert(myNodeId);`,
    "    std::set<Node> _nbrs{ myNodeId };",
    "",
    `    if (${plan.deliverMethod}(${plan.args.join(", ")}))`,
    `        firedCount["${plan.deliver}"]++;`,
    "    // A delivery enables receive events; run one round now rather than",
    "    // waiting for the next timer tick.",
    "    runEnabledEvents();",
    "    delete packet;",
    "}",
  ].join("\n");
}

export function bindMedium(tree: GeneratedTree, plan: MediumPlan, cls: string): GeneratedTree {
  return tree.map((f) => {
    if (f.path.endsWith(".h")) {
      const anchor = "    // ── Event-B machine state ──";
      if (!f.content.includes(anchor)) return f;
      let h = f.content.replace(anchor, members(plan) + "\n" + anchor);
      // The broadcast address and the send-down helpers are the shell's own
      // now (setDownControlInfo / resolveBroadcast, both from MintRoute), so
      // nothing has to be declared here beyond the binding's own members.
      if (!h.includes("#include <vector>"))
        h = h.replace("#include <utility>", "#include <utility>\n#include <vector>");
      return { ...f, content: h };
    }
    if (!f.path.endsWith(".cc")) return f;
    let cc = f.content;

    // Transmit: the CommPattern merge injects the app layer's own transmit
    // structure into the model's transmit event -- a ByteCountChunk addressed
    // to the sink, which is an application's sensing traffic and not the
    // model's packet. Replace it with the medium send, which dispatches on the
    // packet's own type to one of MintRoute's per-type send methods.
    const TX_MARKER = "// — SensorApp transmit structure";
    if (!cc.includes(TX_MARKER))
      throw new Error("mediumBinding: the emitted transmit structure was not found; the shell's shape changed.");
    const txBlock = new RegExp(
      String.raw`[ \t]*// — SensorApp transmit structure[\s\S]*?\n[ \t]*sentCount\+\+;\n`);
    if (txBlock.test(cc))
      cc = cc.replace(txBlock,
        `    // — Medium binding: hand the model's own packet to the radio —\n` +
        `    mediumSend(${plan.txPacketParam});\n`);
    else
      // The marker is there but not as executable code, which means the
      // transmit event does not fully translate and refuses to fire -- the
      // emitter comments its actions out. There is nothing to wire a transmit
      // path to, and saying so beats throwing: the receive half and the send
      // methods are still correct, and the event's own UNTRANSLATED markers
      // already say why it cannot run. (RTMCS M6's send_down is in this state;
      // MintRoute M4's is not.)
      cc = cc.replace(TX_MARKER,
        `// Not wired to the medium: this event refuses to fire (see its\n` +
        `    //     UNTRANSLATED markers above), so it never reaches a transmission.\n` +
        `    //     ${TX_MARKER.slice(3)}`);

    // Receive: the network shell emits handleLowerPacket as a stub (a frame off
    // the air with nowhere in the model to go); the binding is what gives it
    // somewhere.
    const cbStart = cc.indexOf(`void ${cls}::handleLowerPacket(Packet *packet) {`);
    if (cbStart < 0)
      throw new Error("mediumBinding: handleLowerPacket not found; the shell's shape changed.");
    const cbEnd = cc.indexOf("\n}", cbStart);
    // The stub's own comment says it is waiting for this; drop it with the body.
    const lead = cc.lastIndexOf("// Filled in by the medium binding", cbStart);
    const from = lead >= 0 && lead < cbStart ? lead : cbStart;
    cc = cc.slice(0, from) + arrivalFn(plan, cls) + cc.slice(cbEnd + 2);

    // The new functions go beside the packet classes, before Define_Module.
    const at = cc.indexOf("\nDefine_Module(");
    const block = [transmitFn(plan, cls), identityFn(plan, cls)].join("\n\n");
    cc = at < 0 ? cc + "\n" + block : cc.slice(0, at + 1) + block + "\n\n" + cc.slice(at + 1);
    return { ...f, content: cc };
  });
}

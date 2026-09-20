import { mapletAddedTo, variableGainingMaplet, variableLosingMaplet } from "./actionShapes";
import type { EncodedMachine, GeneratedTree, FlatEvent } from "./types";
import { splitConjuncts } from "./ruleEngine";
import type { PacketModel, PacketField } from "./packetModel";
import { getterOf, setterOf, broadcastMethodOf, liveSetOf } from "./packetModel";
import { OVERRIDE_GLYPHS, OVERRIDE_OR_UNION_GLYPHS } from "./text";
import { methodForLabel, splitParams } from "./emitted";
import { deserialiseFieldsOf } from "./packetOps";

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
  wire: { staging: string; getter: string; enc: PacketField | null }[];
  requires: string[];            // pair-sets an arrival must place {f, pkt} in
  propagation: string;
  identity: { getter: string; cast: boolean }[];
  carried: { setter: string; getter: string }[];   // fields the model never restores
  // Chunk fields the DELIVERY event does not write back, which the arrival
  // must therefore copy off the wire itself. See deserialiseFieldsOf.
  unrestored: { setter: string; getter: string; live: string }[];
  args: string[];
  tags: string[];                 // packet-type leaves, one transmit method each
  realisedByMedium: Set<string>;
  // Medium state the DELIVERY event removes that the sender's own copy never
  // sees removed, because that event runs on the receiver. See mediumCore.
  txSender: string;
  strandedOnSender: string[];
}

const conj = (ev: FlatEvent) => ev.guards.flatMap(splitConjuncts).map((c) => c.trim());
const acts = (ev: FlatEvent) => ev.actions.flatMap(splitConjuncts).map((c) => c.trim());

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
        `^${f.ebName}\\s*≔\\s*${f.ebName}\\s*(?:[${OVERRIDE_OR_UNION_GLYPHS}]\\s*)?\\{\\s*(\\w+)\\s*↦\\s*\\w+\\s*\\}$`).exec(a);
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
        if (new RegExp(`^${f.ebName}\\s*≔\\s*${f.ebName}\\s*[${OVERRIDE_GLYPHS}]`).test(a)) mutated.add(f.ebName);
        if (new RegExp(`^${f.ebName}\\s*\\(\\s*\\w+\\s*\\)\\s*≔`).test(a)) mutated.add(f.ebName);
      }
  }
  return pm.fields.filter((f) => !mutated.has(f.ebName));
}

// Everything the binding can read off the MODEL ALONE, with no reference to
// emitted C++. Split out of planMedium because "does this model have a medium
// at all" is the question that decides which SHELL the module gets, and that
// has to be answered BEFORE anything is emitted: a model with no medium is an
// app-layer model and keeps the app-layer shell. planMedium's remaining work --
// matching the delivery event's emitted signature and binding its arguments --
// needs the generated `.cc`, so it cannot be part of this.
export type MediumCore = {
  txPkt: string;
  rxPkt: string;
  rx: EncodedMachine["events"][number];
  wire: { staging: string; getter: string; enc: PacketField | null }[];
  requires: string[];
  senderParam: string;
  senderGetter: string;
  nbrsParam: string;
  propagation: string;
  realisedByMedium: Set<string>;
  txSender: string;
  strandedOnSender: string[];
};

// True when the model describes a medium: packets are serialised field by
// field, handed to a shared relation, and delivered to whoever a propagation
// variable names. That is what makes a model a NETWORK-layer model, and it is
// READ OFF the model rather than configured — the same discipline as the rest
// of the binding.
//
// ⚠ IT RECOGNISES ONE OF THE CORPUS'S TWO MEDIUM DESIGNS, and that is a fact
// about this test rather than about the models. Measured 2026-09-19:
//
//   MintRoute          moves five fields into `vPkt*` on send and back on
//                      receive — the wire-copy mirror this test looks for.
//   WSN_Pattern        crosses a packet with `channel` + `envNeighbours` and a
//   (flooding study)   `recvNbrFlg` handshake, with NO field-by-field copy.
//
// So a model with a perfectly good medium of the second shape reads FALSE here
// and is given the application shell. Nothing depends on that today — the
// medium is deferred to the topology step, where a second shape would have to
// be recognised before it could be bound. Recorded so the next reader does not
// mistake a false for "this model has no medium".
export const modelHasMedium = (model: EncodedMachine, pm: PacketModel): boolean =>
  mediumCore(model, pm) !== null;

function mediumCore(model: EncodedMachine, pm: PacketModel): MediumCore | null {
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
  const wire: { staging: string; getter: string; enc: PacketField | null }[] = [];
  for (const f of fields) {
    const read = conj(tx).map((c) =>
      new RegExp(`^(\\w+)\\s*=\\s*${f.ebName}\\(\\s*${txPkt}\\s*\\)$`).exec(c)).find(Boolean);
    if (!read) continue;
    const q = read[1];
    const staging = acts(tx).map((a) => variableGainingMaplet(a, txPkt, q)).find(Boolean);
    // ⚠ IS THE WIRE COPY ITSELF AN ENC7 FIELD? RTMCS types `vPktData ∈ PKT ⇸ ℤ`
    // and `envDestAddr ∈ PKT ⇸ (ND ∪ {BROADCAST})`, so ENC7 owns their storage
    // and a machine-map write here is a SECOND one. That is what it was: the
    // arrival wrote the map while `send_up`'s own guards read the chunk
    // (`live_vPktData.count(pkt) > 0`, `pktOf(pkt)->getVPktData()`), so the
    // delivery event declined on every frame that arrived. MintRoute types all
    // five of its wire copies over `ran(channel)`, so none is a field and
    // nothing about it changes.
    if (staging) wire.push({ staging, getter: getterOf(f),
      enc: fields.find((g) => g.ebName === staging) ?? null });
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
      const put = requires.map((v) => mapletAddedTo(a, v)).find(Boolean);
      if (!put) continue;
      const [x, p] = put;
      for (const f of fields)
        if (acts(ev).some((b) =>
          new RegExp(`^${f.ebName}\\s*≔\\s*${f.ebName}\\s*[${OVERRIDE_GLYPHS}]\\s*\\{\\s*${p}\\s*↦\\s*${x}\\s*\\}$`).test(b)))
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

  // ⚠ WHAT THE DELIVERY EVENT CLEANS UP THAT THE SENDER'S OWN COPY NEVER SEES.
  //
  // `start_tx` files `{x ↦ pkt}` into the medium and `send_up` removes it
  // again -- but in a per-node module `send_up` runs on the RECEIVER, so the
  // sender's own entry is never removed and its copy grows for ever. The
  // model's cleanup is real and in the right place; it is the one-class-per-node
  // realisation that strands it, the same split as `deliveredBy` and
  // `transmitRecordsItsOwnFiring`.
  //
  // Measured: RTMCS's receive events guard `nb ∉ dom(sentUp ∪ sentDown)` -- "the
  // receiver has nothing in flight" -- which is false for ever once a node has
  // transmitted anything. 1152 of its rejections were that clause. ⚠ MintRoute
  // writes the same idea as a MAPLET (`nb ↦ pkt ∉ …`), per packet rather than
  // per node, so it never depended on the entry going away.
  //
  // ⚠ NOT the set the transmit uses as its OWN self-limit. `send_down` guards
  // `cn ↦ pkt ∉ channel` and adds the same maplet, which is what stops it
  // transmitting the same packet twice; clearing that would put every packet on
  // the air repeatedly. Both case studies use `channel` for exactly that, and
  // both have `sentDown` removed by `send_up` without it being a self-limit.
  const txSelfLimit = new Set<string>();
  for (const c of conj(tx)) {
    const m = /^(\w+)\s*↦\s*(\w+)\s*∉\s*(\w+)$/.exec(c);
    if (m && m[2] === txPkt && acts(tx).some((a) => variableGainingMaplet(a, m[1], txPkt) === m[3]))
      txSelfLimit.add(m[3]);
  }
  // The transmitting node, as the TRANSMIT event names it: the parameter it
  // pairs with the packet in a pair-set it observes.
  let txSender = "";
  for (const c of conj(tx)) {
    const m = /^(\w+)\s*↦\s*(\w+)\s*∈\s*(\w+)$/.exec(c);
    if (m && m[2] === txPkt && enc(m[3]) === "pair-set") txSender = m[1];
  }
  const strandedOnSender: string[] = [];
  for (const a of acts(rx)) {
    const v = variableLosingMaplet(a, senderParam, rxPkt);
    if (v && enc(v) === "pair-set" && !txSelfLimit.has(v) && !strandedOnSender.includes(v))
      strandedOnSender.push(v);
  }

  return { txPkt, rxPkt, rx, wire, requires, senderParam, senderGetter,
           nbrsParam, propagation, realisedByMedium, txSender, strandedOnSender };
}

export function planMedium(model: EncodedMachine, pm: PacketModel, cc: string, cls: string): MediumPlan | null {
  const core = mediumCore(model, pm);
  if (!core) return null;
  const { txPkt, rxPkt, rx, wire, requires, senderParam, senderGetter,
          nbrsParam, propagation, realisedByMedium } = core;
  const fields = pm.fields;

  // The call into the model's own delivery event. Every argument must come from
  // something the arrival actually has -- the chunk, the staged wire copies, or
  // the simulator's answer. A parameter that fits none of those means the model
  // asks for something a reception does not carry, and the binding refuses
  // rather than inventing a value.
  // By Event-B label, so the delivery method is found whatever the shell named
  // it -- socketDataArrived in the app layer, handleLowerPacket in the network
  // layer. emitted.ts owns the parsing; this pass used to build its own regex
  // for it, and was one of the two that forgot to escape the class name.
  const sig = methodForLabel(cc, cls, DELIVER);
  if (!sig) return null;
  const deliverMethod = sig.method;
  const params = splitParams(sig.params).map((p) => p.name);

  const args: string[] = [];
  for (const p of params) {
    if (p === rxPkt) { args.push("_pkt"); continue; }
    if (p === nbrsParam) { args.push("_nbrs"); continue; }
    if (p === senderParam) { args.push("_f"); continue; }
    const staged = conj(rx).map((c) =>
      new RegExp(`^${p}\\s*=\\s*(\\w+)\\(\\s*${rxPkt}\\s*\\)$`).exec(c)).find(Boolean);
    const stagedWire = staged && wire.find((w) => w.staging === staged[1]);
    if (stagedWire) {
      // Read it back from wherever the arrival just PUT it -- the chunk when
      // ENC7 owns this wire copy, the machine map otherwise. Reading the map
      // unconditionally handed the delivery event a value from storage its own
      // guards do not consult.
      args.push(stagedWire.enc
        ? `pktOf(_pkt)->${getterOf(stagedWire.enc)}()`
        : `${staged[1]}.at(_pkt)`);
      continue;
    }
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
  // ⚠ `carried` is NOT the whole set, and assuming it was cost 248 rejected
  // firings. It covers the fields no event assigns at all; `unrestored` is the
  // wider, derived question -- which fields does the DELIVERY event fail to
  // write back? -- and `netSeqNo` is in the gap between them: the transmit
  // event assigns it, so it is not context-sourced, and `send_up` does not
  // restore it, so a receiving node never gets it. See deserialiseFieldsOf.
  const unrestored = deserialiseFieldsOf(model, pm, DELIVER)
    .filter((u) => !carried.some((c) => c.setter === u.setter));

  return {
    transmit: TRANSMIT, deliver: DELIVER, deliverMethod,
    txPacketParam: txPkt, rxPacketParam: rxPkt,
    senderParam, senderGetter, wire, requires, propagation,
    identity, carried, unrestored, args, realisedByMedium,
    txSender: core.txSender, strandedOnSender: core.strandedOnSender,
    // Ordered by tag value, the same order the PktType enum is emitted in.
    tags: [...pm.lattice.tagOf.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t),
  };
}

// ── emission ────────────────────────────────────────────────────────────────

// One transmit method per packet type, named as MintRoute names its own:
// BEACON -> sendBeaconBroadcast, ROUTE -> sendRouteBroadcast. Every packet the
// model transmits goes out as a broadcast, because the model's medium names no
// destination -- it delivers to whoever is in range.
const sendName = broadcastMethodOf;

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

// The cross-node packet identity, and the members it needs. Exported because
// the APPLICATION shell needs exactly this too: an arriving chunk has to resolve
// to the same local PktId every time, whichever shell received it. Takes the two
// field lists rather than a MediumPlan, because the app path has no medium plan
// to give it -- its send_down serialises nothing, so planMedium refuses.
export interface PacketIdentity {
  identity: { getter: string; cast: boolean }[];
  carried: { setter: string; getter: string }[];
}

// What makes two receptions of one packet recognisable as one packet, and what
// the model never restores for itself -- both read off the model.
export function packetIdentityOf(model: EncodedMachine, pm: PacketModel): PacketIdentity {
  const identity = immutableFields(model, pm).map((f) => ({ getter: getterOf(f), cast: false }));
  identity.unshift({ getter: "getType", cast: true });   // the discriminator is immutable too
  const carried = pm.fields.filter((f) => f.source === "context")
    .map((f) => ({ setter: setterOf(f), getter: getterOf(f) }));
  return { identity, carried };
}

export const identityMembers = [
  "    // A packet's identity ACROSS nodes. Each module mints its own PktIds,",
  "    // so the same packet is a different integer on every node; the flood's",
  "    // duplicate test asks about the packet, not about the integer. The key",
  "    // is the fields no event ever overwrites -- see immutableFields().",
  "    std::map<std::vector<long>, PktId> pktIdByWire;",
  "    PktId localIdFor(const PPkt *w);",
].join("\n");

export function emitLocalIdFor({ identity, carried }: PacketIdentity, cls: string): string {
  const key = identity.map((i) => `static_cast<long>(w->${i.getter}())`);
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
    ...carried.map((c) => `    local->${c.setter}(w->${c.getter}());`),
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
    // ⚠ Into the storage that wire copy actually HAS. A staging variable the
    // model types over PKT is an ENC7 field, so its home is the chunk and its
    // domain is its own live set -- writing a machine map of the same name puts
    // the value somewhere the delivery event's guards never look.
    ...plan.wire.map((w) => w.enc
      ? `    ensurePkt(_pkt)->${setterOf(w.enc)}(wire->${w.getter}());`
        + (w.enc.total ? "" : ` ${liveSetOf(w.enc)}.insert(_pkt);`)
      : `    ${w.staging}[_pkt] = wire->${w.getter}();`),
    ...(plan.unrestored.length === 0 ? [] : [
      "    // ⚠ And the chunk fields the delivery event does NOT restore.",
      "    //",
      "    // `send_up` puts five of them back from the staging variables above;",
      "    // the rest travel on the wire and no event on a receiving node ever",
      "    // writes them. In the global model that is fine -- one function, and",
      "    // the receiver reads what the sender wrote -- but this module holds",
      "    // its OWN chunk per node, so an unrestored field stays at its default.",
      "    // Measured: `netSeqNo` stayed 0, so update_nbr's",
      "    // `delta = sNo − lastSeqno(y ↦ x) − 1` was negative on all 248 attempts.",
      "    //",
      "    // On EVERY arrival, not inside localIdFor: that caches by identity and",
      "    // returns early for a packet already seen, while these are exactly the",
      "    // per-hop fields that change between one reception and the next.",
      "    {",
      "        PPkt *_local = ensurePkt(_pkt);",
      // ⚠ AND THE WRITE PUTS THE PACKET IN THAT FIELD'S DOMAIN. Copying the
      // value across without marking it left the receiver holding the value on
      // its chunk while the model still said `pkt ∉ dom(F)` -- which is what
      // `finalDestAddr` did: the packet's own destination reached every node and
      // `receive_rreqPkt` rejected all 2048 calls on the domain test alone.
      ...plan.unrestored.flatMap((u) => [
        `        _local->${u.setter}(wire->${u.getter}());`,
        ...(u.live === "" ? [] : [`        ${u.live}.insert(_pkt);`]),
      ]),
      "    }",
    ]),
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
    if (txBlock.test(cc)) {
      cc = cc.replace(txBlock, "");
      // ⚠ AFTER THE EVENT'S ACTIONS, NOT IN PLACE OF THE BLOCK IT REPLACES.
      // An Event-B event is atomic: the guards hold, every action applies, and
      // the transmission realises the whole of it -- so the frame must carry
      // the state the event PRODUCES. The app-layer transmit structure sits at
      // the top of the actions, and sending there put the packet on the air
      // before the event had finished stamping it.
      //
      // Measured, not reasoned: RTMCS's send_down ends with
      // `envDestAddr(pkt) ≔ nxt`, an ENC7 chunk field, so every frame left
      // carrying that field at its DEFAULT. The receiver's send_up guards
      // `pkt ↦ nxt ∈ envDestAddr` against it and declined 35 of 35 arrivals --
      // instrumented as `chunk=-1 nxt=0`, the second value being the default.
      // MintRoute is unaffected either way: its send_down writes only machine
      // maps and live sets after the send, never the chunk.
      // By Event-B label, the same way the delivery side finds its method, so
      // the CommPattern rename cannot make this silently miss.
      const txSig = methodForLabel(cc, cls, TRANSMIT);
      if (!txSig)
        throw new Error("mediumBinding: the transmit method was not found to place the send after its actions.");
      const at = cc.indexOf(`bool ${cls}::${txSig.method}(`);
      const endOfBody = cc.indexOf("\n}", at);
      const lastReturn = cc.lastIndexOf("    return true;", endOfBody);
      if (lastReturn < at)
        throw new Error("mediumBinding: the transmit method has no `return true;` to place the send before.");
      const stranded = plan.txSender === "" ? [] : plan.strandedOnSender.map((v) =>
        `    ${v}.erase({${plan.txSender}, ${plan.txPacketParam}});\n`);
      cc = cc.slice(0, lastReturn)
        + `    // — Medium binding: hand the model's own packet to the radio —\n`
        + `    mediumSend(${plan.txPacketParam});\n`
        + (stranded.length === 0 ? "" :
          `    // The packet has left. In the model the DELIVERY event removes these,\n`
          + `    // but in a per-node module that event runs on the RECEIVER, so the\n`
          + `    // sender's own entry would never be removed. See strandedOnSender.\n`)
        + stranded.join("")
        + cc.slice(lastReturn);
    } else
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
    const block = [transmitFn(plan, cls), emitLocalIdFor(plan, cls)].join("\n\n");
    cc = at < 0 ? cc + "\n" + block : cc.slice(0, at + 1) + block + "\n\n" + cc.slice(at + 1);
    return { ...f, content: cc };
  });
}

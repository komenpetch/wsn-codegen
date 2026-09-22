import type { GeneratedTree, RawModel } from "./types";
import { parseModel } from "./parser";
import { flatten, parentOf } from "./flattener";
import { resolveEncodings } from "./encodingResolver";
import { emit, type EmitVersion } from "./codeEmitter";
import { tryNetworkLayer, emitWithPacketClasses } from "./netPipeline";
import { installNetProtocolShell, renameCommPatternPair } from "./netProtocolShell";
import { installScheduler } from "./scheduler";
import { bindNodeIdentity, nodeSetsOf } from "./nodeIdentity";
import { packetModelOf } from "./packetModel";
import { packetTypeLattice, type TypeLattice } from "./packetTypes";
import { carryPacketOps, carryEvents, transmitEventsOf, receiveEventsOf, enablingEventsOf, senderQueuesOf, arrivalRequirementsOf, deliveryRequirementsOf, supersededEventsOf, drainEventsOf, deserialiseFieldsOf, transmitRecordsItsOwnFiring, senderSideDrainOf, hoistedReceiveEvents, senderFieldOf, mergeContexts } from "./packetOps";
import { installAppTransmit, installAppReceive } from "./appTransmit";
import { routeTableOf, bindRoutingTable } from "./routingTable";
import { patternExtensionFor } from "./patternExtension";
import { packetIdentityOf } from "./mediumBinding";
import { methodForLabel, implText, splitParams } from "./emitted";
import { fixAliasedEncodings, fixBooleanEncodings } from "./aliasEncoding";
import { capTag, carrierSetsOf } from "./text";
import { wrapInNamespace } from "./moduleNamespace";

export type EbFiles = { name: string; xml: string }[];

// A default C++ class/file name for a machine label: "pM3" → "Pm3Wsn",
// "M4" → "M4Wsn".
//
// The suffix names the DOMAIN, not a layer. It used to be "App" (Pm3App), from
// when the only output was an ApplicationBase module, and the network-layer work
// briefly added a second name ("M4Net") alongside it. Two names for one
// generator's one output invited exactly the confusion they caused: which of
// them a given file was, and whether the two were separate artifacts. One
// generator, one output, one name — what varies is how much network layer the
// model puts inside it.
export function defaultName(machine: string): string {
  return machine ? capTag(machine) + "Wsn" : "Wsn";
}

function parsedMachines(files: EbFiles): RawModel {
  if (files.length === 0)
    throw new Error("No Event-B files selected. Choose a folder of Rodin .bum files.");
  const raw = parseModel(files);
  if (raw.machines.length === 0)
    throw new Error("No Event-B machine (.bum) found in the selection.");
  return raw;
}

// Refinement depth of each machine (1 = base). Shared by leaf detection and
// chain-ordered listing.
function depthFn(raw: RawModel): (name: string) => number {
  const byName = new Map(raw.machines.map((m) => [m.name, m]));
  return (name: string): number => {
    let d = 0;
    const seen = new Set<string>();
    let cur = byName.get(name);
    while (cur) {
      if (seen.has(cur.name))
        throw new Error(`Refinement cycle detected at machine '${cur.name}'.`);
      seen.add(cur.name);
      d++;
      // parentOf, not a bare lookup: a machine declaring a target that is absent has an
      // incomplete chain and must not be scored as a base machine of depth 1.
      cur = parentOf(byName, cur);
    }
    return d;
  };
}

// The most-refined machine — the leaf of the deepest refines chain. Flattening
// it yields the merged model: all ancestors' state + events in one class.
function leafOf(raw: RawModel): string {
  const depth = depthFn(raw);
  // Deepest chain wins; ties fall back to parse order (stable sort).
  return raw.machines.map((m) => m.name).sort((a, b) => depth(b) - depth(a))[0];
}

// The machine labels in the project, ordered base → leaf along the refines
// chain (file order breaks ties), so displays like "pM1 → uM2 → pM3" reflect
// refinement, not directory listing. Name-agnostic — any chain works.
export function machineNames(files: EbFiles): string[] {
  const raw = parseModel(files);
  const depth = depthFn(raw);
  return raw.machines.map((m) => m.name).sort((a, b) => depth(a) - depth(b));
}

// The machine the project merges into (the most-refined / leaf machine).
export function leafMachine(files: EbFiles): string {
  return leafOf(parsedMachines(files));
}

// Generate one class for a single target machine, flattened over its refines
// chain (base first). `outputName` is the emitted class/file name.
export function generate(files: EbFiles, target: string, outputName: string,
  version: EmitVersion = 2, packetSource?: PacketSource, drain = false): GeneratedTree {
  return emitOne(parsedMachines(files), target, outputName, version,
    packetSourceFor(files, target, version, packetSource), drain);
}

// The one place the two halves of the generator meet.
//
// The network layer is not a separate generator and not a separate output: it
// is what this pipeline emits IN ADDITION when the target machine has one —
// the packet classes, the per-type transmit methods, the flooding scheduler and
// the medium binding, on top of the same app-layer module. tryNetworkLayer says
// no for a model with no medium, and that model gets the app-layer module
// unchanged. Either way the result is exactly three files, one module.
//
// v1–v3 never take the network branch: those are the frozen emitted structures
// behind the report's compare table, and they predate the network layer.
// Where a v5 module's packet pattern class comes from. It is a SEPARATE Event-B
// project on purpose: PPkt is a pattern, read off whichever model states the
// packet-type partition richly enough, and then carried by a module generated
// from another. MintRoute's partition gives DATA/ROUTE/BEACON and seven fields;
// the app-layer chain's gives DATA/CONTROL and four.
export interface PacketSource { files: EbFiles; machine: string; }

// What structure 3 carries, and where it comes from.
//
// THE DEFAULT IS THE BUNDLED PATTERN EXTENSION — PPkt and PRouteTable ship
// inside the tool (src/assets/pattern-extension), the way the rule catalog
// does. That is the product's contract: ONE project in, one module out. Before
// this the extension was an INPUT the user had to supply through `--ppkt-from`,
// so the generator knew nothing about the pattern it is meant to embody.
//
// ⚠ The explicit override is kept, and is deliberately NOT exposed by the CLI
// or the web app. It is the seam the structure-3 regression tests use to carry
// a RICHER packet source than the extension (MintRoute's, with its medium,
// flood state and Sink constant) — which is what exercises the carry machinery:
// supersession, drain-on-arrival, the mint rollback, deserialise-in-arrival.
// Removing the parameter outright would have deleted the cover for four
// hard-won fixes along with it.
function packetSourceFor(files: EbFiles, base: string, version: EmitVersion,
  override?: PacketSource): PacketSource | undefined {
  if (version !== 3) return override;
  return override ?? patternExtensionFor(files, base);
}

function emitOne(raw: RawModel, target: string, outputName: string, version: EmitVersion,
  packetSource?: PacketSource, drain = false): GeneratedTree {
  const tree = emitBody(raw, target, outputName, version, packetSource, drain);
  // ONE exit point for the namespace, so a future structure cannot be added
  // without it. A module emitted without the wrap compiles perfectly on its own
  // and fails only when linked beside a second generated module, with
  // `redefinition of 'DATA'` pointing at the context block rather than at the
  // omission. v1-v3 are excluded deliberately: they are the frozen compare-table
  // artifacts and predate the whole question.
  return version >= 2 ? wrapInNamespace(tree, outputName) : tree;
}

function emitBody(raw: RawModel, target: string, outputName: string, version: EmitVersion,
  packetSource?: PacketSource, drain = false): GeneratedTree {
  // v5: the app layer's SensorApp shell, carrying PPkt. The shell is v4's --
  // codeEmitter treats 5 as 4 -- and the packet classes are spliced on top from
  // `packetSource`, which is why v4 itself does not move: it stays the frozen
  // compare-table artifact it was measured as.
  //
  // The packet source is a SEPARATE project on purpose: PPkt is a pattern, and a
  // pattern is not owned by the protocol it was read off.
  if (version === 3) {
    if (!packetSource)
      throw new Error("Structure 3 needs a packet source: which project's packet-type partition PPkt comes from.");
    const pRaw = parseModel(packetSource.files);
    const pMachine = packetSource.machine || leafOf(pRaw);
    const pm = packetModelOf(pRaw, pMachine);
    if (!pm)
      throw new Error("The packet source declares no packet-type partition, so there is no PPkt to carry.");
    // ⚠ THE TWO SLOTS ARE NOT INTERCHANGEABLE, and swapping them used to emit a
    // module that could not compile while reporting success.
    //
    // Once PPkt is carried, the packet source's lattice is the ONLY source of
    // packet-type constants -- it replaces the base model's own. But the base
    // model's events still guard on the names IT knows (`type(pkt) = BEACON`),
    // so a source whose partition is coarser than the base's leaves those names
    // undeclared: `PktType::BEACON` against an enum with no such member, and
    // `CONTROL` redefined as `const int` beside the base context's
    // `std::set<int>`. Measured with MintRoute as the base and AppLayer as the
    // source: 13 clang errors, none of them visible at generation time.
    //
    // The check is containment, not equality: a source may legitimately know
    // MORE types than the base uses -- that is the normal case, and what makes
    // the app-layer chain plus MintRoute's PPkt work.
    // ⚠ Walk FROM THE ROOT, don't take every key of `children`. The lattice is
    // built from all of a project's partition axioms, so its children map also
    // holds CTL_STATUS, ENV_STATUS, PKT and anything else the contexts
    // partition. Taking the keys wholesale reported forty "missing packet
    // types", burying the two that actually mattered.
    const latticeNames = (l: TypeLattice): Set<string> => {
      const out = new Set<string>([l.root]);
      const walk = (t: string) => {
        for (const c of l.children.get(t) ?? [])
          if (!out.has(c)) { out.add(c); walk(c); }
      };
      walk(l.root);
      for (const leaf of l.leaves) out.add(leaf);
      return out;
    };
    const baseLattice = packetTypeLattice(raw.contexts);
    if (baseLattice) {
      const carried = latticeNames(pm.lattice);
      const missing = [...latticeNames(baseLattice)].filter((t) => !carried.has(t));
      if (missing.length)
        throw new Error(
          `The packet source cannot carry this model's packet types: ${missing.join(", ")} `
          + `${missing.length === 1 ? "is" : "are"} declared by the target model's partition but not by `
          + `the packet source's. The emitted module would reference them as enum members that do not `
          + `exist. Check the two projects are not the wrong way round -- the packet source supplies the `
          + `packet class, the target model supplies the behaviour that uses it.`);
    }
    // The pattern brings its OPERATIONS, not only its structure: the events that
    // construct each leaf class come across too, with the state they need and
    // the context constants they read. Without them the packet classes are
    // emitted and never constructed -- see packetOps.ts for what this costs.
    const pModel = resolveEncodings(flatten(pRaw, pMachine));
    const base = resolveEncodings(flatten(raw, target));
    // Read BEFORE anything is carried, because every "which events did we
    // carry" question below is answered as "not in this set" -- and `model`
    // grows with each carry, so asking it later would answer a different
    // question each time.
    const baseLabels = new Set(base.events.map((e) => e.label));
    // Creating events, then the TRANSMIT events -- the ones whose actions feed
    // the variable this model's own `send_down` observes. Derived, not named:
    // see transmitEventsOf.
    let model = carryPacketOps(base, pModel, pm);
    model = carryEvents(model, pModel, transmitEventsOf(base, pModel));
    // The RECEIVE events: the mirror image, derived from what send_up publishes.
    // These re-queue an arrival into the buffer the transmit events read, which
    // is what turns a reception into a rebroadcast.
    model = carryEvents(model, pModel, receiveEventsOf(base, pModel));
    // Then the ENABLERS: without whatever sets floodFlg TRUE, create_bconPkt can
    // never fire. Narrow on purpose -- the transitive closure is 39 of the 40
    // events in MintRoute's machine, i.e. the whole protocol.
    const carriedSoFar = model.events.map((e) => e.label);
    model = carryEvents(model, pModel, enablingEventsOf(model, pModel, carriedSoFar));
    // ⚠ And the events that DRAIN what the carried ones only ever fill. Without
    // this the carried receive events add to `updateNbrs` and nothing removes
    // from it, so each node accepts one packet per forwarder for ever and the
    // flood fires once per run instead of once per beacon. See drainEventsOf.
    const carriedWithEnabling = model.events.map((e) => e.label)
      .filter((l) => !baseLabels.has(l));
    const drainLabels = drainEventsOf(model, pModel, carriedWithEnabling);
    model = carryEvents(model, pModel, drainLabels);
    const mergedRaw = { ...raw, contexts: mergeContexts(raw.contexts, pRaw.contexts) };
    // The same two encoding fixes the network branch applies, and for the same
    // reason: encodingResolver's infer() silently defaults an unrecognised type
    // to "set". They matter HERE because the carried state is the packet
    // source's -- MintRoute's `bcastRouTimer ∈ BOOL` came through as a
    // std::set<int> and the emitted `bcastRouTimer == TRUE` would not compile.
    fixAliasedEncodings(mergedRaw, model);
    fixBooleanEncodings(model);
    // Last: the transmit. The packet classes, the creating events and the
    // transmit events are all in place by now, so what this replaces is the
    // placeholder payload the CommPattern merge left in send_down.
    let tree = emitWithPacketClasses({
      raw: mergedRaw, model, name: outputName, pm, carriers: carrierSetsOf(raw, pRaw),
    });
    // ── The shell ──────────────────────────────────────────────────────────
    //
    // Structure 3 is a NETWORK PROTOCOL, not an application. That is what the
    // 4x4 pattern class diagram's GREEN column asks for -- Interface +
    // Base -- and what the two network-layer outputs have emitted since
    // 2026-09-08: `NetworkProtocolBase, INetworkProtocol`, on the advisor's
    // direction and on INET's own evidence (MintRoute is a protocol IN the
    // stack and carries data; AODV is a routing daemon over UDP and never
    // carries a packet -- the machines forward packets).
    //
    // ⚠ THE SHELL IS INSTALLED BY STRUCTURE, NOT DERIVED FROM A MEDIUM, and
    // that is a deliberate departure worth stating. Structure 2 picks its shell
    // by asking `modelHasMedium`, because a model that serialises its own
    // packets is telling you which layer it belongs to. This model does not
    // have a medium and is not going to get one: the medium is "how nodes reach
    // each other", which the project's scope rule puts on the per-case-study
    // side. So here the STRUCTURE chooses -- which is a choice the user makes
    // explicitly, not an implicit predicate a reader could not predict.
    //
    // ⚠ AND IT REPLACES THE SHELL RATHER THAN EMITTING A SECOND ONE.
    // installNetProtocolShell rewrites the SensorApp shell the emitter just
    // produced -- swapping the base class, the member block and the lifecycle
    // methods, and adding the <Name>NetworkLayer wrapper to the .ned. Which is
    // why it must run HERE, before anything patches those methods: the
    // transmit, the identity binding and the arrival all attach to what this
    // pass leaves behind.
    tree = installNetProtocolShell(tree, outputName, target);
    // The CommPattern pair takes INET's own names on this shell: Event-B
    // send_down becomes a `sendDown` overload and send_up a `handleLowerPacket`
    // overload, beside NetworkProtocolBase's own. Before the transmit and the
    // arrival, both of which resolve the pair by reading the provenance comment
    // the rename leaves in place.
    tree = renameCommPatternPair(tree, outputName);
    // The transmit replaces the placeholder payload the CommPattern merge left
    // in send_down; the scheduler then fires the events that reach it. Without
    // the scheduler the creating events are emitted and never called, so the
    // module compiles and does nothing -- which is what v5 was until now.
    // Derived BEFORE the transmit, because the transmit pins the wire copy
    // from send_down's own sender parameter rather than reading it back off
    // the shared local chunk. See senderFieldOf.
    const fwdr = senderFieldOf(pModel, pm, transmitEventsOf(base, pModel));
    tree = installAppTransmit(tree, outputName, pm,
      // This model's send_down is a pure OBSERVATION and nothing clears the
      // pair it observes on the SENDER, so the module records which
      // transmissions it has already realised. A model that keeps that record
      // itself gets nothing. See transmitRecordsItsOwnFiring.
      !transmitRecordsItsOwnFiring(base), fwdr,
      // And having taken that record on, it must also put back the pair the
      // model's own delivery event would have removed -- which in a per-node
      // module it removes on the RECEIVER, never on the sender.
      senderSideDrainOf(model, (v) => model.encodings.get(v) ?? ""), "network");
    // The carried state is node-keyed (`floodSeqNo ≔ ND × {0}`), so without this
    // every such map is empty, create_bconPkt declines on its first guard, and
    // the scheduler fires nothing at all.
    // ⚠ The UNMERGED contexts of both sides, not `mergedRaw.contexts`.
    // mergeContexts is deduplicating for EMISSION and is lossy by design: for
    // MintRoute it keeps `Sink = 0` but drops both `Sink ∈ ND` and the constant
    // declaration itself, because neither is new. sinkConstantOf only READS, so
    // it wants everything the two models say -- given the merged set it finds no
    // sink here and silently stops emitting the sink test. (Caught by the byte
    // gate; before it, structure 3 emitted that test correctly.)
    tree = bindNodeIdentity(tree, model, [...raw.contexts, ...pRaw.contexts],
      outputName, "network");
    // The receive half: an arrival runs the model's own send_up, which publishes
    // who received the packet; the carried receive events then consume that and
    // re-queue it for transmission. That loop is the rebroadcast.
    const sendUp = methodForLabel(implText(tree), outputName, "send_up");
    // ⚠ DERIVED, not named. This used to be
    // `pm.fields.find(f => f.ebName === "pktFwdr")` -- the one place the carry
    // named a field -- and the guard below then skipped the WHOLE receive
    // binding if it missed, so a packet source with a differently named sender
    // field would have produced a module that compiles, runs and never
    // receives. See senderFieldOf.
    if (!sendUp || !fwdr)
      throw new Error(
        "The packet pattern cannot be bound to an arrival: "
        + (!sendUp ? `no emitted method carries the Event-B provenance "send_up". `
                   : "the transmit events never stamp a chunk field with the node they "
                     + "file the packet under, so no field carries the sender. ")
        + "Refusing rather than emitting a module that would compile and never receive.");
    // ⚠ The arrival binds the CommPattern's ABSTRACT delivery, `send_up(x, pkt,
    // nbrs)`, and passes exactly those three. A model that carries its own
    // medium states its delivery event differently: MintRoute's send_up takes
    // the wire fields as parameters because it IS the deserialiser, so its
    // emitted signature has eight and the call passed three to it.
    //
    // That model does not want this shell at all. The layer is DERIVED from the
    // model, not chosen -- a model with a medium gets the network-protocol shell
    // from structure 2, which is written for exactly this shape. Structure 3 is
    // the application shell carrying a packet class, and it fits a model whose
    // delivery event is the abstract one.
    //
    // Checked against the emitted signature rather than against "has a medium"
    // so the condition cannot drift from what the emitted call actually needs.
    const sendUpParams = splitParams(sendUp.params);
    if (sendUpParams.length !== 3)
      throw new Error(
        `Structure 3 cannot bind an arrival to this model's send_up: the arrival calls it with `
        + `(node, packet, neighbours) and the emitted method takes ${sendUpParams.length} parameters `
        + `(${sendUpParams.map((p) => p.name).join(", ")}). A delivery event that carries the wire `
        + `fields belongs to a model with its own medium, which structure 2 emits as a network `
        + `protocol. Use structure 2 for this model, or structure 3 with a model whose delivery `
        + `event is the abstract CommPattern one.`);
    {
      // What the arrival stages, in both polarities. The delivery event states
      // its own half (`x ↦ pkt ∈ sentDown ∧ x ↦ pkt ∉ sentUp`); the receive
      // events downstream of it state the rest. Both are read off guards --
      // nothing here names sentDown or WiMedium.
      const need = deliveryRequirementsOf(base);
      const staged = {
        // the MERGED model, not `base`: WiMedium and the rest of the medium
        // state only exist once the packet source's events have been carried,
        // so asking `base` whether it has them answers no and stages nothing.
        insert: [...new Set([...need.mustContain,
          ...arrivalRequirementsOf(model, pModel, receiveEventsOf(base, pModel),
            senderQueuesOf(model, pModel, transmitEventsOf(base, pModel)))])],
        remove: need.mustNotContain,
      };
      tree = installAppReceive(tree, outputName, packetIdentityOf(model, pm),
        sendUp.method, fwdr, staged,
        // Nothing restores the packet's fields on a receiving node otherwise:
        // this model's delivery event is the ABSTRACT one. See
        // deserialiseFieldsOf.
        deserialiseFieldsOf(base, pm), "network");
    }
    // What an ARRIVAL may run: the events a delivery enables -- those that
    // consume what send_up publishes, and the transmits that carry the result
    // on. NOT the creating events: an arrival that ran the whole set made every
    // reception produce another packet, at zero simulated time.
    //
    // ⚠ AND THE DELIVERY PAIR'S OWN `send_down`, WHICH IS WHERE A TRANSMISSION
    // IS REALISED. Without it this set stopped one step short of its own stated
    // intent: `transmitEventsOf` returns the events that FEED `sentDown`
    // (`start_tx`), while `send_down` is the OBSERVATION they feed and the point
    // the binding puts a real frame on the air. So a forwarded packet was queued
    // on the arrival and then waited for the next timer tick to leave.
    //
    // Measured: `send_down` pinned at 56-59 on every node -- one per tick over a
    // 60 s run -- against 74-110 `start_tx`, leaving 76-112 packets still queued
    // at the end.
    //
    // FORWARD IMMEDIATELY, ORIGINATE ON THE TIMER, and that split is read off
    // the case studies rather than chosen:
    //
    //   - INET's own MintRoute.cc does the forwarding INSIDE the reception
    //     handler -- `onReceiveSensingPkt` rewrites the header and calls
    //     `sendDown(packet)` there and then -- while `handleSelfMessage` is what
    //     originates, one beacon and one route broadcast per firing.
    //   - The thesis's CommPattern process says the same of the model: (S6) a
    //     receiver that is not the destination re-records the packet in the
    //     waiting buffer, and "steps (S4)-(S6) will be repeated" -- S4 being
    //     `send down`. The loop is driven by reception, not by a clock.
    //   - And this generator's OWN network module already does it: its arrival
    //     calls the full `runEnabledEvents()`, `send_down` included, which is the
    //     configuration the recorded four-hop flood was measured in.
    // ⚠ SO THE SET IS "EVERYTHING EXCEPT THE CREATING EVENTS", which is what the
    // paragraph above always said and what the two derivations only approximated.
    // Naming the two ENDS of the chain -- what consumes the publication, and what
    // feeds the transmit -- left its MIDDLE out: `fwdr_receive_pkt` is the
    // rebroadcast decision itself (recvBuff → ndBuff) and belongs to neither set,
    // so an accepted packet waited for the timer before it was even queued.
    // Measured with only `send_down` added: `fwdr_receive_pkt` pinned at 53-59,
    // one per tick, against 291-348 packets accepted.
    //
    // ✅ And "run the whole reception path here" is what both references do:
    // MintRoute.cc's `onReceiveSensingPkt` does the dedup, the table update, the
    // destination test, the header rewrite AND the sendDown in one handler; this
    // generator's network module runs the entire `runEnabledEvents()`. The ONLY
    // thing held back is packet creation, and that exclusion is measured, not
    // cautionary -- over a full IP stack the node hears its own broadcast, so an
    // arrival that created a packet produced another arrival at zero simulated
    // time: 52,034 events at one instant.
    const creating = new Set(pm.leaves.map((l) => l.event));
    const recv = receiveEventsOf(base, pModel);
    // ⚠ The base model's ABSTRACT versions of what was just carried must stop
    // being scheduled. Carrying a refinement into a model that still holds the
    // abstraction leaves the module running two accounts of one story, and the
    // abstract one wins every race because it says almost nothing -- measured:
    // the app chain's `receive` fired 57 times on a node where the carried
    // `receive_controlPkt` fired 0, and filed the packet into `ndBuff`, which is
    // the very guard the concrete event then failed. See supersededEventsOf.
    const carriedLabels = model.events.map((e) => e.label).filter((l) => !baseLabels.has(l));
    const superseded = new Map<string, string>(
      supersededEventsOf(model, pRaw, pMachine, carriedLabels)
        .map((l) => [l, "a carried event supersedes it (the packet pattern's own refinement)"] as const));
    // ⚠ And the delivery event itself, which the ARRIVAL realises.
    //
    // It was being reported as `not schedulable: send_up -- no binding for
    // nbrs`, which reads as a translation gap and is not one: the socket
    // callback binds `nbrs` to this node and calls the event on every real
    // reception. The network module already labels its equivalent correctly
    // ("the simulator's medium realises it"); this is the application's
    // version of the same fact, and reporting a gap that is not there is the
    // kind of thing this project treats as a defect in its own right.
    // ⚠ Captured BEFORE send_up joins the map. A superseded event never runs;
    // send_up runs on EVERY reception, called by the arrival, and it is what
    // fills ctlNeighbours -- which receive_controlPkt guards on. Reachability
    // analysis that confused the two would delete the flood. See
    // unreachableEvents.
    const neverRuns = new Set(superseded.keys());
    superseded.set("send_up", "the arrival realises it, on a real reception");
    // The batch is the receive events FIRST — flattening puts a carried
    // refinement after every pM1 event, so `receive_controlPkt` would otherwise
    // run last and an arrival would consume nothing — then everything else in
    // model order.
    //
    // ⚠ Except an event the hoist would STARVE: `send_up` publishes `sentUp` as
    // well as `ctlNeighbours`, so the cleanup `finish_tx_pkt` is swept into the
    // receive class and lands ahead of the `fwdr_receive_pkt` that fills its
    // `ndBuff` guard. Measured: a candidate existed on 652 of the 655 arrivals
    // that forwarded a packet, and the event fired 0 times in a whole run.
    //
    // ⚠ Built HERE, below `superseded`, and that placement is load-bearing: an
    // event that will not be scheduled cannot be the thing that fills a guard
    // "later in the batch". Computed above it, `send_up` — which the arrival
    // realises and which is what fills `ctlNeighbours` — counted as a filler and
    // demoted every receive event to the end, which is the opposite of the fix.
    const inBatch = model.events.map((e) => e.label)
      .filter((l) => !creating.has(l) && !superseded.has(l));
    // To a FIXPOINT, not one pass: demoting an event makes it a later filler,
    // which can starve a different one that looked safe. See
    // hoistedReceiveEvents, which is exported so the loop itself has a test —
    // this call site needs the advisor's models and cannot be run on CI.
    const hoisted = hoistedReceiveEvents(model, recv, inBatch);
    const delivery = [...hoisted, ...inBatch.filter((l) => !hoisted.includes(l))];
    const scheduled = installScheduler(tree, model, outputName, pm.fields, superseded, true,
      carrierSetsOf(raw, pRaw), delivery,
      "the model's own\n    //  transmit event is the transmit path now", neverRuns,
      // ⚠ The drain events run ON THE ARRIVAL, not on the timer. They undo what
      // a reception does, so a reception is the only thing that enables them --
      // and the hand-written MintRoute is built exactly this way: its
      // updateNbrCounters() is called at the top of onReceiveBeaconPkt, never
      // from a timer. Scheduling them instead would give the module a second,
      // timer-driven account of one reception.
      drainLabels,
      // The forwarder is a property of the DELIVERY, so a receive event binds
      // it from what the arrival recorded rather than off the shared chunk.
      fwdr,
      // Drain the non-creating events to a bounded fixpoint. Off by default.
      drain);
    // PRouteTable published to INET, when the model has a route table to
    // publish. Null is a legitimate answer -- a model with no node-relation
    // carrying per-entry data has no table, and one with TWO (RTMCS M5's
    // forward and backward routes) needs a modelling decision this pass must
    // not make for it.
    const table = routeTableOf(model, nodeSetsOf([...raw.contexts, ...pRaw.contexts]));
    return table ? bindRoutingTable(scheduled, outputName, table) : scheduled;
  }
  if (version === 2) {
    // One model, whichever way this goes: tryNetworkLayer hands back the one it
    // built, so a model with no network layer is not flattened and encoded twice.
    const { model, tree } = tryNetworkLayer(raw, target, outputName);
    return tree ?? emit(model, outputName, version, raw.contexts);
  }
  // Contexts reach the emitter so v4 can inline the Event-B context block
  // (constants derived from the project's own axioms) instead of #including a
  // shipped fixture; v1-v3 ignore them.
  return emit(resolveEncodings(flatten(raw, target)), outputName, version, raw.contexts);
}

// Merge the whole project into ONE module: generate from the most-refined
// machine, whose flattened form subsumes the entire refinement chain. Emits
// exactly three files (<name>.h/.cc/.ned). `outputName` defaults to the leaf's
// derived name. `version` selects the emitted structure (see EmitVersion).
export function generateMerged(files: EbFiles, outputName?: string,
  version: EmitVersion = 2, packetSource?: PacketSource, drain = false): GeneratedTree {
  const raw = parsedMachines(files);
  const leaf = leafOf(raw);
  return emitOne(raw, leaf, outputName ?? defaultName(leaf), version,
    packetSourceFor(files, leaf, version, packetSource), drain);
}

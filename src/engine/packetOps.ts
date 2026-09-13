// The packet pattern class as a pattern with OPERATIONS, not just a structure.
//
// v5 began by carrying PPkt's TYPES from another project: the chunk, its fields
// and one leaf class per packet type. That is a structure, and a structure with
// nothing to build it is inert -- the generated module declared DataPkt,
// RoutePkt and BeaconPkt and constructed none of them, because the event that
// creates a beacon is a MintRoute machine event and the app-layer chain has no
// such event.
//
// So the packet source now carries its CREATING EVENTS too (user decision
// 2026-09-13): `create_bconPkt`, `create_routePkt`, `create_dataPkt` -- exactly
// the events packetModel already identified as the leaf classes' constructors,
// nothing chosen by name.
//
// ⚠ WHAT THIS COSTS, MEASURED. Those three events touch 25 machine variables of
// MintRoute's, of which 18 are not in the app-layer model: WiMedium,
// bcastRouNodes, bcastRouTimer, dataSeqNo, floodFlg, floodSeqNo, floodTbl,
// floodedPkts, middleware, nbHops, pktNbHops, pktSeqNo, pktSrc, recLostPkts,
// sensedPkts, sensingNDs, sinkBuff, xmittedPkts. They come across with the
// events, because an event without its state does not translate. This is the
// line past which "carrying a pattern" becomes "merging two models", and it is
// crossed deliberately: WiMedium in that list is a MEDIUM variable, so the
// module now holds part of MintRoute's network-layer state.
//
// What does NOT come across: MintRoute's protocol-specific functions -- the ETX
// parent selection, chooseParent, cpCost, cRouteTree, the routing decisions.
// Those are the Specific layer in the class diagram and were never in scope.

import { INITIALISATION } from "./types";
import { addsMaplet, addsTo, anyMapletAdded, removesFrom, variableAddedTo } from "./actionShapes";
import type { EncodedMachine, FlatEvent, RawContext, RawModel, Labelled } from "./types";
import { eventAncestry } from "./flattener";
import type { PacketModel, PacketField } from "./packetModel";
import { getterOf, setterOf } from "./packetModel";
import { OVERRIDE_GLYPHS } from "./text";


// Machine variables an event mentions, in its guards or its actions.
function variablesUsedBy(ev: FlatEvent, known: Map<string, string>): string[] {
  const text = [...ev.guards, ...ev.actions].join(" ");
  return [...new Set(text.match(/[A-Za-z_]\w*/g) ?? [])].filter((t) => known.has(t));
}

// The packet source's creating events, plus the state they need, folded into the
// module's own model.
//
// The base model wins every collision: where both projects declare `ndBuff` or
// `pktFwdr`, the module keeps its own typing, because the module's own events
// are translated against it. The two agree on those seven variables' meaning --
// they are the CommPattern variables both models inherit from the same pattern
// -- which is why this is a merge rather than a rename.
export function carryPacketOps(base: EncodedMachine, source: EncodedMachine,
  pm: PacketModel): EncodedMachine {
  return carryEvents(base, source, pm.leaves.map((l) => l.event));
}

// The contexts of both projects, deduplicated.
//
// The creating events read context constants the module's own project does not
// declare -- `s = Sink` and `type(pkt) = BEACON` are guards of create_bconPkt,
// and Sink is a MintRoute constant. Both projects also declare DATA, CONTROL,
// type and initialSrcAddr, and emitting a context twice produces
// `inline const int DATA` twice: a redefinition, in the very block whose whole
// job is to make the module self-contained.
//
// Deduplication is by NAME, first declaration winning, so the module's own
// project defines every name it shares with the packet source. An axiom is kept
// only when it is the first to pin a given name -- otherwise the second
// project's `partition(TYPE, CONTROL, {DATA})` would re-emit constants the first
// has already defined.
export function mergeContexts(base: RawContext[], extra: RawContext[]): RawContext[] {
  const seenName = new Set(base.flatMap((c) => [...c.sets, ...c.constants]));
  const seenCtx = new Set(base.map((c) => c.name));
  const out = [...base];

  for (const c of extra) {
    if (seenCtx.has(c.name)) continue;
    const sets = c.sets.filter((s) => !seenName.has(s));
    const constants = c.constants.filter((k) => !seenName.has(k));
    // An axiom survives only if every name it DEFINES is new. `defines` is read
    // as the identifiers on the left of `=` or inside a partition, which is how
    // the emitter itself decides what an axiom pins.
    const axioms = c.axioms.filter((a) => definesOnly(a, seenName));
    if (sets.length === 0 && constants.length === 0 && axioms.length === 0) continue;
    out.push({ ...c, sets, constants, axioms });
    for (const n of [...sets, ...constants]) seenName.add(n);
    seenCtx.add(c.name);
  }
  return out;
}

// True when the axiom introduces no name that is already defined. A partition
// axiom names several at once, so all of them must be new for it to be kept.
function definesOnly(a: Labelled, taken: ReadonlySet<string>): boolean {
  const partition = /^\s*partition\s*\(\s*([^)]*)\)/.exec(a.text);
  // ⚠ `NAME ∈ <type>` counts as naming NAME. Reading only `=` and `partition`
  // meant a PROPERTY axiom named nothing, `names.length > 0` was false, and the
  // axiom was dropped from the merged context -- so MintRoute's
  // `LIVELINESS ∈ ℕ1` never reached the emitter and the v5 module referenced an
  // identifier it never declared. Same omission as the one in codeEmitter's
  // constant emission, and it surfaced the same way: a compile error the moment
  // a clause using the constant finally translated.
  const names = partition
    ? (partition[1].match(/[A-Za-z_]\w*/g) ?? [])
    : [(/^\s*([A-Za-z_]\w*)\s*(?:=|∈)/.exec(a.text) ?? [])[1]].filter(Boolean) as string[];
  return names.length > 0 && names.every((n) => !taken.has(n));
}

// The TRANSMIT events, carried alongside the creating ones.
//
// Which events those are is read off the CommPattern, not listed. The pattern's
// `send_down` has NO ACTIONS in the app-layer model:
//
//     send_down  any x, pkt
//        when   x ∈ ND ∧ pkt ∈ PKT
//        when   x ↦ pkt ∈ sentDown
//
// It is an OBSERVATION -- "this node has sent this packet down" -- and the
// variable it observes is the pattern's own record of that. So the events that
// actually transmit are the ones whose actions put a pair into that variable,
// and in MintRoute those are exactly `start_tx_dataPkt`, `start_tx_bconPkt` and
// `start_tx_routePkt`, which move a packet out of `ndBuff` and stamp its
// forwarder. Nothing here matches on "start_tx".
//
// This is also why the transmit hangs on `send_down` in the generated code
// rather than on the start_tx events: the model puts the observation there, so
// that is the point at which the packet has gone down and a real frame should
// go with it.
export function transmitEventsOf(base: EncodedMachine, source: EncodedMachine,
  sendDownLabel = "send_down"): string[] {
  const sd = base.events.find((e) => e.label === sendDownLabel);
  if (!sd) return [];
  const observed = new Set<string>();
  for (const g of sd.guards) {
    const m = /^\s*(\w+)\s*↦\s*(\w+)\s*∈\s*(\w+)\s*$/.exec(g.trim());
    if (m && base.variableTypes.has(m[3])) observed.add(m[3]);
  }
  if (observed.size === 0) return [];

  return source.events
    .filter((e) => [...observed].some((v) => e.actions.some((a) => addsMaplet(a, v))))
    .map((e) => e.label);
}

// The RECEIVE events, derived the mirror image of the transmit ones.
//
// The CommPattern's two halves are not symmetric in the model, and that is the
// point. `send_down` has no actions -- it OBSERVES `sentDown`, so the transmit
// events are the ones that feed it. `send_up` does have actions: it PUBLISHES
// who received the packet --
//
//     then ctlNeighbours ≔ ctlNeighbours ∪ ({pkt} × nbrs)
//
// -- so the receive events are the ones that CONSUME that, and in MintRoute they
// guard `pkt ↦ nb ∈ ctlNeighbours` and then re-queue into `ndBuff`, which is
// what the transmit events read. That loop, publish → consume → re-queue →
// transmit, is the rebroadcast.
//
// Nothing here matches on "receive".
export function receiveEventsOf(base: EncodedMachine, source: EncodedMachine,
  sendUpLabel = "send_up"): string[] {
  const su = base.events.find((e) => e.label === sendUpLabel);
  if (!su) return [];
  const published = new Set<string>();
  for (const a of su.actions) {
    const v = variableAddedTo(a);
    if (v && base.variableTypes.has(v)) published.add(v);
  }
  if (published.size === 0) return [];

  // An event consumes it by guarding on membership in it.
  return source.events
    .filter((e) => [...published].some((v) =>
      e.guards.some((g) => new RegExp(`↦\\s*\\w+\\s*∈\\s*${v}\\s*$`).test(g.trim()))))
    .map((e) => e.label);
}

// Carry named events plus the state they need, on the same terms as the
// creating ones: the base model's typing wins every collision.
export function carryEvents(base: EncodedMachine, source: EncodedMachine,
  labels: readonly string[]): EncodedMachine {
  const wanted = new Set(labels);
  const events = source.events.filter((e) => wanted.has(e.label) &&
    !base.events.some((b) => b.label === e.label));
  if (events.length === 0) return base;

  const variableTypes = new Map(base.variableTypes);
  const encodings = new Map(base.encodings);
  const variables = [...base.variables];
  for (const ev of events)
    for (const v of variablesUsedBy(ev, source.variableTypes)) {
      if (variableTypes.has(v)) continue;
      variableTypes.set(v, source.variableTypes.get(v)!);
      const enc = source.encodings.get(v);
      if (enc) encodings.set(v, enc);
      variables.push(v);
    }
  // The carried state must also be INITIALISED, or every guard that reads it is
  // false on the first tick and the events are emitted, scheduled and never
  // fire -- the module compiles and does nothing, which is the exact failure
  // this project has hit before (v3 sent zero packets for a whole round).
  //
  // Only the actions that assign a CARRIED variable come across; the module's
  // own INITIALISATION is otherwise untouched.
  const carried = new Set(variables.filter((v) => !base.variableTypes.has(v)));
  const srcInit = source.events.find((e) => e.label === INITIALISATION);
  const ownInit = base.events.find((e) => e.label === INITIALISATION);
  let merged = [...base.events, ...events];
  if (srcInit && ownInit && carried.size > 0) {
    const assigns = (a: string) => {
      const m = /^\s*(\w+)\s*(?:\(|≔)/.exec(a.trim());
      return m ? carried.has(m[1]) : false;
    };
    const extra = srcInit.actions.filter(assigns);
    if (extra.length > 0)
      merged = merged.map((e) => e.label === INITIALISATION
        ? { ...e, actions: [...e.actions, ...extra] } : e);
  }
  return { ...base, variables, variableTypes, encodings, events: merged };
}

// The ENABLING events: the ones without which a carried event's guard can never
// be true.
//
// ⚠ Why this is a narrow rule and not a closure. `create_bconPkt` guards
// `floodFlg(s) = TRUE` while the initialisation sets floodFlg FALSE, so the
// beacon can never be created unless whatever sets it TRUE comes across too --
// that is `start_flooding`. But following "what does a carried event's guard
// read, and who writes it" TRANSITIVELY pulls in 39 of MintRoute's 40 events,
// measured: the whole machine, including the routing decisions that are the
// Specific layer and were never in scope. So the rule stops at one question:
// which event supplies a value the INITIALISATION withholds?
//
// Guards of the form `f(x) = V` on a carried variable whose initialisation gives
// something else; the enabler is a source event that assigns f the value V.
// Nothing is transitive, and nothing matches on a name.
// Events that DRAIN a work queue the carried ones only ever fill.
//
// ⚠ This is what makes a carried flood repeat instead of firing once. Three
// carried receive events add `f ↦ nb` to `updateNbrs`, and `receive_controlPkt`
// guards `f ↦ nb ∉ updateNbrs` -- so once a node has heard from a forwarder it
// can never hear from it again. In the packet source the release exists
// (`update_nbr`: `updateNbrs ≔ updateNbrs ∖ {x ↦ y}`, which is INET
// MintRoute's `updateNbrCounters` clause for clause), but it is neither a
// creating, transmit, receive nor enabling event, so nothing carried it.
// Measured before this: the guard rejected 652 of 681 attempts in 30 s.
//
// The condition is exact and bounded: a variable qualifies only when something
// CARRIED adds to it and NOTHING carried removes from it. That selects
// `updateNbrs` and leaves out `ndBuff`, which the carried transmit events
// drain.
//
// ⚠ `floodTbl` is added to and never removed either, and is correctly NOT
// carried for -- not by a special case, but because the search below finds no
// event that processes it. It is the flood's permanent seen-set; there is no
// release to carry.
//
// ⚠ AND "REMOVES FROM IT" IS NOT THE TEST. `add_newEntry` only READS the
// queue, yet it is the sole writer of `neighbourTbl` and of the initial
// `lastSeqno(y ↦ x) = 0` that both removers guard on; carrying the removers
// without it leaves them unable to fire. The rule is "mentions the queue",
// which is "processes" it, and on MintRoute it selects exactly three events.
export function drainEventsOf(model: EncodedMachine, source: EncodedMachine,
  carriedLabels: readonly string[]): string[] {
  const carried = new Set(carriedLabels);
  // addsTo rather than addsMaplet: a variable filled by a cartesian product is
  // just as undrained as one filled a maplet at a time. actionShapes.ts carries
  // the difference between the two readings.

  // Variables the carried events fill and never empty.
  const filled = new Set<string>();
  const drained = new Set<string>();
  for (const ev of model.events) {
    if (ev.label === INITIALISATION || !carried.has(ev.label)) continue;
    for (const v of model.variables) {
      if (ev.actions.some((a) => addsTo(a, v))) filled.add(v);
      if (ev.actions.some((a) => removesFrom(a, v))) drained.add(v);
    }
  }
  const blocked = [...filled].filter((v) => !drained.has(v));
  if (blocked.length === 0) return [];

  // Whatever in the SOURCE processes one of those queues and is not already on
  // its way across.
  //
  // ⚠ "Already there" is the MERGED model's labels, not just the carried ones.
  // The two projects are refinements of one pattern, so they share event names:
  // `send_down` and `finish_tx_pkt` exist in both, and asking only about the
  // carried list called the BASE model's own events drains -- which would have
  // let carryEvents replace them with the source's versions, and moved the
  // CommPattern pair off the timer onto the arrival.
  const present = new Set(model.events.map((e) => e.label));
  const out = new Set<string>();
  for (const ev of source.events) {
    if (ev.label === INITIALISATION || present.has(ev.label)) continue;
    const text = [...ev.guards, ...ev.actions];
    if (blocked.some((v) => text.some((c) => new RegExp(`\\b${v}\\b`).test(c))))
      out.add(ev.label);
  }
  return [...out];
}

export function enablingEventsOf(model: EncodedMachine, source: EncodedMachine,
  carriedLabels: readonly string[]): string[] {
  const init = source.events.find((e) => e.label === INITIALISATION);
  if (!init) return [];
  const carried = new Set(carriedLabels);
  const out = new Set<string>();

  for (const ev of source.events) {
    if (!carried.has(ev.label)) continue;
    for (const g of ev.guards) {
      const m = /^\s*(\w+)\s*\(\s*\w+\s*\)\s*=\s*(\w+)\s*$/.exec(g.trim());
      if (!m) continue;
      const [, f, want] = m;
      if (!model.variableTypes.has(f)) continue;
      // Does the initialisation already give that value? `f ≔ ND × {V}`.
      const initialised = init.actions.some((a) =>
        new RegExp(`^\\s*${f}\\s*≔[^≔]*×\\s*\\{\\s*${want}\\s*\\}\\s*$`).test(a.trim()));
      if (initialised) continue;
      // Who sets it to what the guard wants?
      for (const cand of source.events) {
        if (carried.has(cand.label) || cand.label === INITIALISATION) continue;
        if (cand.actions.some((a) =>
          new RegExp(`^\\s*${f}\\s*\\(\\s*\\w+\\s*\\)\\s*≔\\s*${want}\\s*$`).test(a.trim())))
          out.add(cand.label);
      }
    }
  }
  return [...out];
}

// Medium state an ARRIVAL must make true before the receive events can fire.
//
// The receive events do not only read what `send_up` publishes; they also assert
// that the packet is ON THE MEDIUM -- MintRoute's `receive_controlPkt` opens with
// `pkt ∈ ran(WiMedium)`. In the global model the transmitting node wrote that;
// here the transmission itself is the evidence, and it just happened, so the
// arrival stages it.
//
// Measured before this existed: every one of 41 attempts at receive_controlPkt
// was rejected by that first guard, and no later guard was ever reached. The
// packet classes, the events, the scheduler and the binding were all in place
// and the flood still could not propagate one hop.
//
// Variables `send_up` itself writes are EXCLUDED -- it moves the packet from
// sentDown to sentUp as its own postcondition, and staging those here would
// falsify its own guards (`x ↦ pkt ∉ sentUp`).
export function arrivalRequirementsOf(base: EncodedMachine, source: EncodedMachine,
  receiveLabels: readonly string[], sendUpLabel = "send_up"): string[] {
  const su = base.events.find((e) => e.label === sendUpLabel);
  const written = new Set<string>();
  for (const a of su?.actions ?? []) {
    const m = /^\s*(\w+)\s*≔/.exec(a.trim());
    if (m) written.add(m[1]);
  }
  const wanted = new Set(receiveLabels);
  // A receive event's OWN postcondition is not a precondition the medium has to
  // establish. `receive_controlPkt` guards that the packet is on the medium and
  // then re-queues it into `ndBuff`; staging ndBuff here would hand this node a
  // buffer entry belonging to the SENDER, which its transmit events would then
  // pick up and send on that node's behalf.
  //
  // ⚠ ADDING to a variable is what disqualifies it, not touching it. A receive
  // event that CONSUMES the membership -- `WiMedium ≔ WiMedium ∖ {f ↦ pkt}`,
  // taking the packet off the medium -- still requires that membership to exist
  // first, so it must stay staged. Excluding on any assignment at all dropped
  // exactly that case and put the arrival back to staging nothing useful.
  for (const ev of source.events)
    if (wanted.has(ev.label))
      for (const a of ev.actions) {
        const v = variableAddedTo(a);
        if (v) written.add(v);
      }

  const out = new Set<string>();
  for (const ev of source.events) {
    if (!wanted.has(ev.label)) continue;
    for (const g of ev.guards.flatMap((x) => x.split("∧"))) {
      const m = /^\s*\w+\s*∈\s*ran\s*\(\s*(\w+)\s*\)\s*$/.exec(g.trim());
      if (m && base.variableTypes.has(m[1]) && !written.has(m[1])) out.add(m[1]);
    }
  }
  return [...out];
}

// What the DELIVERY event itself requires of the medium, split by polarity.
//
// `send_up` guards `x ↦ pkt ∈ sentDown` and `x ↦ pkt ∉ sentUp`: one membership
// it needs present, one it needs absent. The arrival has to establish both
// before running it. Derived rather than hardcoded -- another model's delivery
// event names its own variables.
export function deliveryRequirementsOf(base: EncodedMachine, sendUpLabel = "send_up"):
  { mustContain: string[]; mustNotContain: string[] } {
  const su = base.events.find((e) => e.label === sendUpLabel);
  const mustContain: string[] = [], mustNotContain: string[] = [];
  for (const g of (su?.guards ?? []).flatMap((x) => x.split("∧"))) {
    const m = /^\s*\w+\s*↦\s*\w+\s*(∈|∉)\s*(\w+)\s*$/.exec(g.trim());
    if (!m || !base.variableTypes.has(m[2])) continue;
    (m[1] === "∈" ? mustContain : mustNotContain).push(m[2]);
  }
  return { mustContain: [...new Set(mustContain)], mustNotContain: [...new Set(mustNotContain)] };
}

// Base events the CARRIED ones supersede, and which must therefore stop being
// scheduled.
//
// ⚠ Why this exists. A carried event is a lower-level account of something the
// base model already describes abstractly, and translating both leaves the
// module running two versions of one story. Measured on v5: the app chain's
// abstract `receive` fired 57 times on a node where the carried
// `receive_controlPkt` fired 0, and the abstract one is why -- it consumes the
// publication the concrete one guards on, and its successor files the packet
// into `ndBuff`, which is exactly the guard the concrete one then fails
// (`nb ↦ pkt ∉ ndBuff`, 16 rejections). The abstract event wins the race every
// time because it says almost nothing: its guards are purely negative, so it
// does not even require that a packet arrived.
//
// Two kinds of evidence, and only these two:
//
//  1. DECLARED. Rodin records `refinesEvent`, so `start_tx_bconPkt refines
//     start_tx` is a fact in the file. Every base label a carried event refines
//     transitively is superseded. This one also stops the base `start_tx` from
//     re-stamping `pktFwdr` with a node it enumerated -- a frame went out
//     carrying another node's id as its forwarder, which is what made the
//     receiver's `nb ↦ pkt ∉ WiMedium` guard false.
//
//  2. UNGUARDED CONSUMPTION. The two projects are different refinements of one
//     pattern, so a divergent branch declares no refinement at all: MintRoute
//     has no `receive` and the app chain has no `receive_controlPkt`. What
//     still identifies the pair is the DELIVERY PUBLICATION -- the variable
//     `send_up` publishes into. A carried event consumes it under a membership
//     guard, saying when consuming is legitimate; the abstract base event just
//     removes from it. A base event that removes without guarding, where a
//     carried event guards, is the abstraction of that carried event.
//
// Nothing here matches on a name, and rule 2 fires only when rule 2's premise
// holds -- a carried GUARDED consumer exists. With no carried receive events
// the base model keeps its own reception chain intact.
export function supersededEventsOf(base: EncodedMachine, pRaw: RawModel, pMachine: string,
  carriedLabels: readonly string[], sendUpLabel = "send_up"): string[] {
  const baseLabels = new Set(base.events.map((e) => e.label));
  const carried = new Set(carriedLabels);
  const out = new Set<string>();

  // 1. declared refinement
  for (const [label, ancestors] of eventAncestry(pRaw, pMachine)) {
    if (!carried.has(label)) continue;
    for (const a of ancestors) if (baseLabels.has(a)) out.add(a);
  }

  // 2. unguarded consumption of the delivery publication
  const su = base.events.find((e) => e.label === sendUpLabel);
  const published = new Set<string>();
  for (const a of su?.actions ?? []) {
    const v = variableAddedTo(a);
    if (v && base.variableTypes.has(v)) published.add(v);
  }
  const guardsMembership = (ev: FlatEvent, v: string) =>
    ev.guards.some((g) => new RegExp(`↦\\s*\\w+\\s*∈\\s*${v}\\s*$`).test(g.trim()));
  const eventRemovesFrom = (ev: FlatEvent, v: string) =>
    ev.actions.some((a) => removesFrom(a, v));

  for (const v of published) {
    // premise: a carried event consumes this publication UNDER a guard
    if (!base.events.some((e) => carried.has(e.label) && guardsMembership(e, v))) continue;
    for (const e of base.events) {
      if (carried.has(e.label) || e.label === sendUpLabel || e.label === INITIALISATION) continue;
      if (eventRemovesFrom(e, v) && !guardsMembership(e, v)) out.add(e.label);
    }
  }
  return [...out];
}

// The packet fields an ARRIVAL must copy off the wire itself, or none when the
// model's own delivery event already does it.
//
// Event-B keeps a packet's attributes as functions keyed by packet id, so
// "this node knows this packet" is literally `pkt in dom(pktNbHops)`. Something
// has to put it there on a receiving node. Two models answer differently:
//
//   - The packet source's own delivery event restores every field from the wire
//     copies its transmit staged (`pktNbHops := pktNbHops union {pkt |-> nbh}`).
//     That IS the deserialisation, and the network module gets it for free by
//     running that event.
//   - The base chain's delivery event is the ABSTRACT one. It publishes who
//     received the packet and nothing else.
//
// v5 runs the second, because the CommPattern pair belongs to the base model and
// is what the shell's socket callback is bound to. So nothing restores the
// fields, the chunk exists locally while the model considers the packet
// non-existent, and every carried receive event fails its domain guard.
// Measured: once the staging rollback, the echo test and the supersession rule
// were in, `pkt in dom(pktNbHops)` was the ONLY guard still rejecting -- 18 of
// 18.
//
// The test is the delivery event's own actions, so a model whose delivery
// restores its fields gets nothing from here and keeps doing it itself.
export function deserialiseFieldsOf(base: EncodedMachine, pm: PacketModel,
  sendUpLabel = "send_up"): { setter: string; getter: string }[] {
  const su = base.events.find((e) => e.label === sendUpLabel);
  if (!su) return [];
  const restores = (ebName: string) =>
    su.actions.some((a) => new RegExp(`^\\s*${ebName}\\s*(?:\\(|≔)`).test(a.trim()));
  // The COMPLEMENT, per field, not an all-or-nothing answer.
  //
  // ⚠ The all-or-nothing version was wrong, and the network module is where it
  // showed. MintRoute's `send_up` restores five of the seven fields from the
  // wire copies its `send_down` staged -- so "the model does it, stand back"
  // was true of those five and false of `netSeqNo`, which NO event on a
  // receiving node ever writes. In the global model that is fine: `netSeqNo` is
  // one function and the receiver reads what the sender wrote. In a per-node
  // module the receiver holds its own chunk, so the field stayed 0, and
  // `update_nbr`'s `delta = sNo − lastSeqno(y ↦ x) − 1` was negative on every
  // one of 248 attempts -- the freshness test can never pass when the sequence
  // number never arrives.
  return pm.fields.filter((f) => !restores(f.ebName))
    .map((f) => ({ setter: setterOf(f), getter: getterOf(f) }));
}

// Does the model's transmit-observation event record that it has already fired
// for a given pair?
//
// ⚠ Why it matters. The CommPattern's `send_down` observes a pair-set -- "this
// node has sent this packet down" -- and the two projects write it differently:
//
//     MintRoute   when cn ↦ pkt ∈ sentDown ∧ cn ↦ pkt ∉ channel
//                 then channel ≔ channel ∪ {cn ↦ pkt}
//
//     app chain   when x ↦ pkt ∈ sentDown          (no actions at all)
//
// MintRoute's own guard/action pair makes it fire exactly once per pair.
// The app chain's has nothing of the kind, and nothing else removes the pair it
// observes either: `sentDown` is cleared by `send_up`, which in a per-node
// module runs on the RECEIVER. So on the sender the guard is true for ever, the
// scheduler re-fires the event every tick, and the module puts a real frame on
// the air each time -- measured, 57 frames for one `start_tx_bconPkt`.
//
// Event-B is right that re-firing is legal: an event with no actions is
// idempotent. What is NOT idempotent is the module's REALISATION of it, which
// is a transmission. So when the model keeps no such record, the binding keeps
// one; when it does, the binding keeps out of the way.
export function transmitRecordsItsOwnFiring(base: EncodedMachine,
  sendDownLabel = "send_down"): boolean {
  const sd = base.events.find((e) => e.label === sendDownLabel);
  if (!sd) return true;                     // no pair to observe: nothing to limit
  for (const g of sd.guards) {
    const m = /^\s*(\w+)\s*↦\s*(\w+)\s*∉\s*(\w+)\s*$/.exec(g.trim());
    if (!m || !base.variableTypes.has(m[3])) continue;
    const [, x, pkt, v] = m;
    const adds = new RegExp(`^\\s*${v}\\s*≔\\s*${v}\\s*∪\\s*\\{\\s*${x}\\s*↦\\s*${pkt}\\s*\\}\\s*$`);
    if (sd.actions.some((a) => adds.test(a.trim()))) return true;
  }
  return false;
}

// Which chunk field carries the SENDER, derived rather than named.
//
// ⚠ This replaces a hardcoded `pm.fields.find(f => f.ebName === "pktFwdr")`,
// which was the one place the packet-pattern carry named a field. Worse than
// inelegant: the caller then did `if (sendUp && fwdr)`, so a packet source
// whose sender field is called anything else would have produced a module with
// the ENTIRE receive binding silently missing — it would compile, run, and
// never receive.
//
// The derivation is the network branch's, and it is a fact the model states:
// the event that files a packet into a pair-set under a node ALSO stamps a
// chunk field with that same node (`WiMedium ≔ WiMedium ∪ {x ↦ pkt}` beside
// `pktFwdr ≔ pktFwdr ⊕ {pkt ↦ x}`). That equality is the model saying a frame
// carries its sender, which is also what a radio does. Measured on MintRoute:
// all three transmit events agree on it, through two different pair-sets.
export function senderFieldOf(source: EncodedMachine, pm: PacketModel,
  transmitLabels: readonly string[]): PacketField | undefined {
  const wanted = new Set(transmitLabels);
  for (const ev of source.events) {
    if (!wanted.has(ev.label)) continue;
    for (const a of ev.actions) {
      const put = anyMapletAdded(a);
      if (!put) continue;
      const [, x, p] = put;
      for (const f of pm.fields) {
        const stamp = new RegExp(
          `^\\s*${f.ebName}\\s*≔\\s*${f.ebName}\\s*[${OVERRIDE_GLYPHS}]\\s*\\{\\s*${p}\\s*↦\\s*${x}\\s*\\}\\s*$`);
        if (ev.actions.some((b) => stamp.test(b.trim()))) return f;
      }
    }
  }
  return undefined;
}

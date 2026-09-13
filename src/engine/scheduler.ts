import type { EncodedMachine, GeneratedTree } from "./types";
import { splitConjuncts } from "./ruleEngine";
import type { PacketField } from "./packetModel";
import { getterOf } from "./packetModel";
import { nestedMapVars } from "./nestedMap";
import { emittedMethods, splitParams, implOf, unreachableEvents } from "./emitted";

// A generic event scheduler.
//
// The generated module has one guarded `bool` method per Event-B event, and
// nothing ever called them: the events could fire, but no simulation trigger
// reached them. This emits the missing half, and emits it from the MODEL rather
// than from knowledge of any protocol -- there is no mention of flooding,
// beacons or MintRoute anywhere below.
//
// The semantics being implemented is Event-B's own: an event is enabled when
// there EXIST parameter values satisfying its guards, and firing it runs its
// actions. The whole difficulty is the existential. A parameter is not searched
// for blindly -- integers cannot be enumerated -- it is classified:
//
//   determined  a guard pins it outright: `sno = floodSeqNo(s) + 1`, `s = Sink`,
//               `nbh = −1`. Compute it; do not search.
//   enumerated  a guard ranges it over a finite carrier: `x ∈ ND`. Loop.
//   fresh       a packet the event is about to CREATE, recognised by a
//               `p ∉ dom(F)` / `p ∉ <set>` freshness guard. Mint one.
//
// Parameters are emitted in dependency order, because `sno = floodSeqNo(s) + 1`
// cannot be computed before `s` exists. An event with a parameter that fits
// none of the three classes is skipped, with the reason emitted as a comment --
// the same discipline as an untranslated clause: a visible gap, never a silent
// one.
//
// Constraints on a FRESH packet are satisfied by CONSTRUCTION rather than by
// rejection. `type(pkt) = BEACON` says "there exists a packet of this type not
// yet used"; minting one and stamping its type is exactly that existential,
// where searching would almost always fail. If the event then declines to fire,
// everything the scheduler synthesised is rolled back, so a failed attempt
// leaves no trace.

const CARRIER_ALIAS: Record<string, string> = { ND: "Node", PKT: "PktId", "ℤ": "Data" };

interface Param { name: string; cppType: string; }
interface Plan {
  label: string;
  params: Param[];
  lines: string[];      // setup, in dependency order
  rollback: string[];   // undo of anything synthesised
  ok: boolean;
  why?: string;         // when !ok
  // The packet-type tag this event STAMPS on a fresh packet. Emitted by the
  // scheduler, not by the event body, so a reachability scan over the .cc
  // cannot see it -- it has to be carried here.
  stamps?: string;
  method?: string;      // emitted name, when the CommPattern merge renamed it
}

const NUM = String.raw`(?:−|-)?\d+`;
const num = (s: string) => s.replace(/−/g, "-");

// Each event's emitted signature, keyed by Event-B LABEL.
//
// The signature comes from the .cc rather than from the model so that it is the
// one the emitter actually produced, already corrected by fixSetTypedParameters.
// And the key is the label, not the method name: the CommPattern pair is renamed
// after whichever shell it lands in -- sendSensorPacket / socketDataArrived in
// the app layer, sendDown / handleLowerPacket in the network layer -- so a
// lookup by name alone would silently miss send_down, which is the event that
// moves a packet onto the channel, i.e. the one that makes a flood propagate
// rather than just leave the sink. emitted.ts reads the provenance comment the
// emitter writes above each renamed method, so neither name is hardcoded here.
function signatures(cc: string, cls: string): Map<string, { params: Param[]; method: string }> {
  const out = new Map<string, { params: Param[]; method: string }>();
  for (const m of emittedMethods(cc, cls)) {
    // Labelled first, so a renamed method is reachable under its Event-B label;
    // an unlabelled one is keyed by its own name, which for every event except
    // the CommPattern pair is the same string.
    const key = m.label ?? m.method;
    if (!out.has(key)) out.set(key, { params: splitParams(m.params), method: m.method });
  }
  return out;
}

function planFor(label: string, params: Param[], guards: string[], carriers: Set<string>,
  enc: (id: string) => string | undefined, nestedVars: Set<string>, pktField: Map<string, string>): Plan {
  const clauses = guards.flatMap((g) => splitConjuncts(g));
  const lines: string[] = [];
  const rollback: string[] = [];
  let stamps: string | undefined;
  const resolved = new Set<string>();
  // Inside a loop an unmet precondition must skip this candidate, not abandon
  // the whole event -- returning would silently stop at the first bad one.
  let depth = 0;
  // ⚠ A bail-out must UNDO whatever has already been synthesised, or the
  // scheduler leaks.
  //
  // Parameters are bound in dependency order, and a FRESH packet is minted as
  // soon as its parameter is reached -- before the later parameters' own
  // preconditions are checked. Those preconditions bail with this. The rollback
  // used to live only at the bottom of the method, after the event declined, so
  // any bail-out in between returned past it and left the minted packet in
  // pktStore for ever:
  //
  //     PktId pkt = newPktId();                          // minted
  //     ensurePkt(pkt)->setType(PktType::BEACON);
  //     if (floodSeqNo.count(s) == 0) return false;      // ← leaked it
  //     ...
  //     pktStore.erase(pkt);                             // never reached
  //
  // Measured on a running simulation: pktStore grew by one per declined
  // creating event per tick on every node whose floodSeqNo has no entry for
  // Sink -- i.e. every non-sink node, in BOTH the application and the network
  // module. The leak is not only memory: try_receive iterates pktStore, so the
  // phantom packets made `receive` fire on nodes that had received nothing,
  // which is how this was found.
  //
  // `rollback` is read at CALL time, so each bail undoes exactly what had been
  // synthesised by that point.
  const bail = () => `{ ${rollback.map((r) => r.trim()).join(" ")}${rollback.length ? " " : ""}`
    + `${depth > 0 ? "continue;" : "return false;"} }`;
  const known = (expr: string) =>
    (expr.match(/[A-Za-z_]\w*/g) ?? []).every((t) => !params.some((p) => p.name === t) || resolved.has(t));

  // The type tag a fresh packet must carry, if the event pins one.
  const typeOf = (p: string): string | undefined => {
    for (const c of clauses) {
      const m = new RegExp(`^type\\(\\s*${p}\\s*\\)\\s*=\\s*(\\w+)$`).exec(c.trim());
      if (m) return m[1];
    }
    return undefined;
  };
  const isFresh = (p: string) =>
    clauses.some((c) => new RegExp(`^${p}\\s*∉`).test(c.trim()));

  let progress = true;
  while (progress && resolved.size < params.length) {
    progress = false;
    for (const par of params) {
      if (resolved.has(par.name)) continue;
      const p = par.name;

      // determined: p = <literal>
      const lit = clauses.map((c) => new RegExp(`^${p}\\s*=\\s*(${NUM})$`).exec(c.trim())).find(Boolean);
      if (lit) {
        lines.push(`    ${par.cppType} ${p} = ${num(lit[1])};`);
        resolved.add(p); progress = true; continue;
      }
      // determined: p = f(x) [+|- n]
      const fn = clauses.map((c) =>
        new RegExp(`^${p}\\s*=\\s*(\\w+)\\(\\s*(\\w+)\\s*\\)(?:\\s*(\\+|−|-)\\s*(\\d+))?$`).exec(c.trim())
      ).find(Boolean);
      if (fn && known(fn[2])) {
        const [, f, x, op, n] = fn;
        const arith = op ? ` ${op === "+" ? "+" : "-"} ${n}` : "";
        // ENC7 may have moved this attribute onto the chunk, in which case the
        // context map is empty and reading it would skip every candidate. This
        // is the same trap as in the construction branch below, and it is what
        // stopped find_neighbours firing even once it became schedulable.
        const acc = pktField.get(f);
        if (acc) {
          lines.push(`    if (pktStore.count(${x}) == 0) ${bail()}`);
          lines.push(`    ${par.cppType} ${p} = pktOf(${x})->get${acc}()${arith};`);
        } else {
          lines.push(`    if (${f}.count(${x}) == 0) ${bail()}`);
          lines.push(`    ${par.cppType} ${p} = ${f}.at(${x})${arith};`);
        }
        resolved.add(p); progress = true; continue;
      }
      // determined: p = R[{x}] -- a relational image. Set-valued, but still
      // COMPUTED rather than searched: once x is known the image is a lookup,
      // which is what makes a set-typed parameter bindable at all.
      const img = clauses.map((c) =>
        new RegExp(`^${p}\\s*=\\s*(\\w+)\\s*\\[\\s*\\{\\s*(\\w+)\\s*\\}\\s*\\]$`).exec(c.trim())
      ).find(Boolean);
      if (img && known(img[2])) {
        const [, R, x] = img;
        lines.push(`    std::set<Node> ${p} = relImage(${R}, ${x});`);
        resolved.add(p); progress = true; continue;
      }
      // determined: p = <bare name already known, or a context constant>
      const bare = clauses.map((c) => new RegExp(`^${p}\\s*=\\s*(\\w+)$`).exec(c.trim())).find(Boolean);
      if (bare && known(bare[1])) {
        lines.push(`    ${par.cppType} ${p} = ${bare[1]};`);
        resolved.add(p); progress = true; continue;
      }
      // fresh packet
      if (isFresh(p) && par.cppType === "PktId") {
        lines.push(`    ${par.cppType} ${p} = newPktId();`);
        rollback.push(`    pktStore.erase(${p});`);
        const tag = typeOf(p);
        // The chunk, and only the chunk. The context map `type` is the other
        // storage ENC7 replaced; writing it too kept the creating node working
        // and left every RECEIVING node's `type(pkt)` guard unsatisfiable,
        // since a packet off the wire has a chunk and no map entry. TYPE-CMP /
        // TYPE-MEM (mediumRules.ts) now read the chunk everywhere, so there is
        // one storage again and nothing to keep in step.
        if (tag) { lines.push(`    ensurePkt(${p})->setType(PktType::${tag});`); stamps = tag; }
        // Any `q = g(p)` guard over an already-known q is satisfied by
        // construction too -- the model is describing the packet being made.
        for (const c of clauses) {
          const m = new RegExp(`^(\\w+)\\s*=\\s*(\\w+)\\(\\s*${p}\\s*\\)$`).exec(c.trim());
          if (m && resolved.has(m[1])) {
            // ENC7 may have MOVED this attribute onto the chunk. Writing the old
            // context map would then satisfy nothing: the guard reads the chunk.
            // Getting this wrong is why the first instrumented run fired
            // start_flooding but never create_bconPkt.
            const acc = pktField.get(m[2]);
            if (acc) {
              lines.push(`    ensurePkt(${p})->set${acc}(${m[1]});`);
            } else {
              lines.push(`    ${m[2]}[${p}] = ${m[1]};`);
              rollback.push(`    ${m[2]}.erase(${p});`);
            }
          }
        }
        resolved.add(p); progress = true; continue;
      }
      // `a ↦ b ∈ V` with V a pair-set: the pair IS the candidate, so one loop
      // binds both variables at once. This is the dominant shape in the
      // transmit and receive events -- `x ↦ pkt ∈ ndBuff` says exactly "for
      // each packet this node is holding".
      {
        const pr = clauses.map((c) =>
          new RegExp(`^(\\w+)\\s*↦\\s*(\\w+)\\s*∈\\s*(\\w+)$`).exec(c.trim())).find((m) => {
            if (!m) return false;
            const [, a, b, v] = m;
            return enc(v) === "pair-set" && (a === p || b === p)
              && !resolved.has(a) && !resolved.has(b);
          });
        if (pr) {
          const [, a, b, v] = pr;
          const ta = params.find((q) => q.name === a)?.cppType ?? "int";
          const tb = params.find((q) => q.name === b)?.cppType ?? "int";
          lines.push(`    for (auto& _pr_${a}_${b} : ${v}) {`); depth++;
          lines.push(`    ${ta} ${a} = _pr_${a}_${b}.first;`);
          lines.push(`    ${tb} ${b} = _pr_${a}_${b}.second;`);
          resolved.add(a); resolved.add(b); progress = true; continue;
        }
      }
      // `a ↦ b ∈ M` with M a MAP-OF-SETS: the same maplet-membership shape as
      // the pair-set case above, but the container nests, so the search does
      // too. This is the binding the whole receive family hangs on --
      // `pkt ↦ nb ∈ ctlNeighbours` is "for each packet pending delivery to
      // nb" -- and without it receive_controlPkt, receive_dup_controlPkt and
      // sink_recv_controlPkt were all reported as "no binding for pkt", i.e.
      // a packet could arrive and no event could consume it.
      //
      // Which side is already bound decides the shape. With `nb` bound (its
      // own `nb ∈ ND` carrier guard, which in a per-node module means "me"),
      // only the outer map is searched and membership is a lookup; that is
      // the case that matters, and it reads exactly like the model clause.
      {
        const mm = clauses.map((c) =>
          new RegExp(`^(\\w+)\\s*↦\\s*(\\w+)\\s*∈\\s*(\\w+)$`).exec(c.trim())).find((m) => {
            if (!m) return false;
            const [, a, b, v] = m;
            return enc(v) === "map-of-sets" && (a === p || b === p)
              && !(resolved.has(a) && resolved.has(b));
          });
        if (mm) {
          const [, a, b, v] = mm;
          const ta = params.find((q) => q.name === a)?.cppType ?? "int";
          const tb = params.find((q) => q.name === b)?.cppType ?? "int";
          if (resolved.has(b)) {
            lines.push(`    for (auto& _ms_${a} : ${v}) {`); depth++;
            lines.push(`    if (_ms_${a}.second.count(${b}) == 0) continue;`);
            lines.push(`    ${ta} ${a} = _ms_${a}.first;`);
            resolved.add(a);
          } else if (resolved.has(a)) {
            lines.push(`    if (${v}.count(${a}) == 0) ${bail()}`);
            lines.push(`    for (${tb} ${b} : ${v}.at(${a})) {`); depth++;
            resolved.add(b);
          } else {
            lines.push(`    for (auto& _ms_${a}_${b} : ${v}) {`); depth++;
            lines.push(`    ${ta} ${a} = _ms_${a}_${b}.first;`);
            lines.push(`    for (${tb} ${b} : _ms_${a}_${b}.second) {`); depth++;
            resolved.add(a); resolved.add(b);
          }
          progress = true; continue;
        }
      }
      // `o ↦ {i ↦ v} ∈ N` on a two-level table: once o and i are known, v is a
      // lookup, not a search.
      {
        const nm = clauses.map((c) =>
          new RegExp(`^(\\w+)\\s*↦\\s*\\{\\s*(\\w+)\\s*↦\\s*${p}\\s*\\}\\s*∈\\s*(\\w+)$`).exec(c.trim()))
          .find((m) => m !== null && nestedVars.has(m[3]) && known(m[1]) && known(m[2]));
        if (nm) {
          const [, o, i, v] = nm;
          lines.push(`    if (${v}.count(${o}) == 0 || ${v}.at(${o}).count(${i}) == 0) ${bail()}`);
          lines.push(`    ${par.cppType} ${p} = ${v}.at(${o}).at(${i});`);
          resolved.add(p); progress = true; continue;
        }
      }
      // `p ↦ v ∈ F` with F a PACKET FIELD -- "the packet whose F is v".
      //
      // ⚠ This is the ONLY binding for a packet parameter in an event that
      // never states `p ∈ PKT`, and that is not a corner case: the emitter
      // types a parameter `PktId` only where the event says `p ∈ PKT`, so the
      // generic "any PktId enumerates pktStore" fallback below never fires for
      // these. `update_nbr` and `update_route` are exactly this shape
      // (`pkt ↦ x ∈ pktFwdr`), and they are the only two events that drain
      // `updateNbrs` -- the set whose never-draining capped the flood at one
      // beacon per forwarder.
      //
      // ENC7 moved the field onto the chunk, so the candidates are the
      // registry's entries filtered by that field.
      {
        const pf = clauses.map((c) =>
          new RegExp(`^${p}\\s*↦\\s*(\\w+)\\s*∈\\s*(\\w+)$`).exec(c.trim()))
          .find((m) => m !== null && pktField.has(m[2]) && known(m[1]));
        if (pf) {
          const [, v, f] = pf;
          lines.push(`    for (auto& _pf_${p} : pktStore) {`); depth++;
          lines.push(`    if (_pf_${p}.second == nullptr`
            + ` || _pf_${p}.second->get${pktField.get(f)!}() != ${v}) continue;`);
          lines.push(`    ${par.cppType} ${p} = _pf_${p}.first;`);
          resolved.add(p); progress = true; continue;
        }
      }
      // enumerated over a finite carrier
      const inSet = clauses.map((c) => new RegExp(`^${p}\\s*∈\\s*(\\w+)$`).exec(c.trim())).find(Boolean);
      if (inSet && carriers.has(inSet[1]) && inSet[1] !== "PKT") {
        lines.push(`    for (${par.cppType} ${p} : ${inSet[1]}) {`); depth++;
        resolved.add(p); progress = true; continue;
      }
      // `p ∈ S` where S is an already-bound SET parameter or a set-encoded
      // variable: the candidates are its elements. `nb ∈ nbs` -- pick one
      // neighbour out of the neighbour set find_neighbours just computed -- is
      // the shape, and without it the delivery chain stalls after one hop.
      if (inSet && (
        params.some((q) => q.name === inSet[1] && resolved.has(q.name)) ||
        enc(inSet[1]) === "set")) {
        lines.push(`    for (${par.cppType} ${p} : ${inSet[1]}) {`); depth++;
        resolved.add(p); progress = true; continue;
      }
      // An EXISTING packet -- the transmit and receive events take one the node
      // already holds, so the candidates are exactly the registry's keys. This
      // is the other half of the fresh case: dom of the packet-keyed functions
      // is pktStore, so enumerating it is enumerating the packets that exist.
      if (par.cppType === "PktId") {
        lines.push(`    for (auto& _e_${p} : pktStore) {`); depth++;
        lines.push(`    ${par.cppType} ${p} = _e_${p}.first;`);
        resolved.add(p); progress = true; continue;
      }
    }
  }

  const missing = params.filter((p) => !resolved.has(p.name)).map((p) => p.name);
  return missing.length === 0
    ? { label, params, lines, rollback, ok: true, stamps }
    : { label, params, lines, rollback, ok: false, why: `no binding for ${missing.join(", ")}` };
}

export function emitScheduler(model: EncodedMachine, cls: string, cc: string, fields: PacketField[],
  // Events NOT scheduled spontaneously, each with the reason, which is emitted
  // beside the declaration. Two reasons exist so far and they are different
  // claims: "the simulator realises this" (the medium binding) and "a carried
  // event supersedes this" (the packet-pattern merge).
  notScheduled: ReadonlyMap<string, string> = new Map(),
  carrierSets: ReadonlySet<string> = new Set(),
  deliveryLabels: readonly string[] = [],
  // Events that genuinely never execute -- NOT the same as `notScheduled`,
  // which also holds send_up, an event the arrival calls on every reception.
  neverRuns: ReadonlySet<string> = new Set()): { decls: string; defs: string } {
  // The accessor SUFFIX, from the one place that defines accessor names.
  const pktField = new Map(fields.map((f) => [f.ebName, getterOf(f).slice("get".length)]));
  // Two-level tables, from nestedMap.ts's own detector rather than a second
  // regex here. The copy this replaces claimed in its comment to recognise them
  // "the same way" and did not: it stopped at the opening paren, so it also
  // matched variables whose RANGE is a parenthesised UNION -- MintRoute's
  // `ctlNeighbours ∈ PKT ↔ (ND ∪ {FAILED_XMIT})` and `cpCost ∈ ND → (ℕ ∪
  // {INFINITY})`, RTMCS's `netDestAddr`, nine in all across the three case
  // studies. Those are flat relations, and treating one as a nested map emits
  // `v.at(o).at(i)` against a `std::map<K, std::set<V>>`, which does not
  // compile. No current model has the guard shape that reaches it, so nothing
  // was broken -- the point is that the two answers have to be the same answer.
  const nestedVars = new Set(nestedMapVars(model).map((v) => v.name));
  const sigs = signatures(cc, cls);
  // The model's own carrier sets, passed in from the contexts. This used to be
  // `Object.keys(CARRIER_ALIAS)` -- the three names that happen to need a C++
  // type alias -- which is a different question and a shorter list: MintRoute
  // declares PKT, TYPE, CTL_STATUS and ENV_STATUS. A parameter typed
  // `p ∈ CTL_STATUS` failed the enumeration test below and its event was
  // reported unschedulable with a binding that was in fact available.
  const carriers = new Set([...carrierSets, ...Object.keys(CARRIER_ALIAS)]);
  const plans: Plan[] = [];
  for (const ev of model.events) {
    if (ev.label === "INITIALISATION") continue;
    // An event the simulator's medium realises is NOT spontaneous: it happens
    // when a transmission happens, and the medium binding calls it then. Left
    // in this list it would fire on its own timetable and, worse, on the
    // SENDING node -- the sender would compute its own neighbours from the
    // model's topology variable and deliver the packet to itself. See
    // mediumBinding.ts for how the set is derived (it is not a name list).
    if (notScheduled.has(ev.label)) continue;
    const sig = sigs.get(ev.label);
    if (!sig) continue;                          // not emitted as a bool method
    const plan = planFor(ev.label, sig.params, ev.guards, carriers, (id) => model.encodings.get(id), nestedVars, pktField);
    plan.method = sig.method;
    plans.push(plan);
  }

  const schedulable = plans.filter((p) => p.ok);
  const skippedPlans = plans.filter((p) => !p.ok);
  // ⚠ SCHEDULABLE IS NOT REACHABLE. Binding an event's parameters and its guards
  // ever holding are different questions, and the gap was measured: 18 try_
  // methods emitted, 7 ever fired. The rest each wait on something no runnable
  // code produces -- a DATA packet nothing stamps, `bcastRouTimer = TRUE` that
  // nothing assigns, a `recvBuff` written only by an event a refinement retired.
  //
  // An event that can never fire is not free: it is a method a reader has to
  // understand, and it makes the scheduler look like it drives far more of the
  // model than it does.
  //
  // The unschedulable events join `neverRuns` for this: they are exactly the
  // ones that produce nothing because they never execute.
  const unreachable = unreachableEvents(cc, cls, schedulable.map((p) => p.label),
    new Set([...neverRuns, ...skippedPlans.map((p) => p.label)]),
    // Which event stamps which packet tag. The stamp is emitted BY THIS
    // SCHEDULER, into the try_ method, so it is not in the .cc the analysis
    // reads -- without this, create_bconPkt is reported as "nothing creates a
    // BEACON packet", which is exactly what it does.
    new Map(schedulable.filter((p) => p.stamps).map((p) => [p.label, p.stamps!])));
  const firable = schedulable.filter((p) => !unreachable.has(p.label));
  const defs: string[] = [];
  for (const p of firable) {
    const loops = p.lines.filter((l) => l.trim().startsWith("for (")).length;
    const call = `${p.method ?? p.label}(${p.params.map((x) => x.name).join(", ")})`;
    const body = [
      ...p.lines,
      `    if (${call}) { firedCount["${p.label}"]++; return true; }`,
      ...(p.rollback.length ? p.rollback : []),
      ...Array(loops).fill("    }"),
      "    return false;",
    ];
    defs.push(`bool ${cls}::try_${p.label}()\n{\n${body.join("\n")}\n}`);
  }

  const runBody = firable.map((p) => `    if (try_${p.label}()) fired = true;`).join("\n");
  defs.push(
    `// One round of the Event-B operational semantics: attempt every event whose\n` +
    `// parameters this scheduler can bind, in declaration order, and report\n` +
    `// whether any fired. Called from the periodic timer.\n` +
    `bool ${cls}::runEnabledEvents()\n{\n    bool fired = false;\n${runBody}\n    return fired;\n}`,
  );

  // ⚠ What an ARRIVAL may run, which is NOT the whole enabled set.
  //
  // A delivery enables the events that consume it and, through the buffer they
  // re-queue into, the transmits that carry it on. It does NOT enable the
  // packet-CREATING events -- yet an arrival that ran the full set fired them,
  // so on a node that originates traffic every reception produced another
  // packet, transmitted it, and (with an IP stack that loops a broadcast back to
  // its own sender) received it again, at zero simulated time: 52,034 events at
  // one instant, measured.
  //
  // Derived, not listed: the receive events come from what send_up publishes,
  // the transmit events from what send_down observes.
  if (deliveryLabels.length > 0) {
    const usable = deliveryLabels.filter((l) => firable.some((p) => p.label === l));
    defs.push(
      "// The events a DELIVERY enables -- the subset an arrival may run.\n" +
      `bool ${cls}::runDeliveryEvents()\n{\n    bool fired = false;\n` +
      usable.map((l) => `    if (try_${l}()) fired = true;`).join("\n") +
      "\n    return fired;\n}",
    );
  }

  const decls = [
    "    // ── Event scheduler (Event-B operational semantics) ──",
    "    // How many times each event actually fired. Without this the run is",
    "    // unmeasurable: a green 60s and a plausible packet count say nothing",
    "    // about whether the MODEL executed, which is the only thing under test.",
    "    std::map<std::string, long> firedCount;",
    ...firable.map((p) => `    bool try_${p.label}();`),
    ...skippedPlans.map((p) => `    // not schedulable: ${p.label} -- ${p.why}`),
    ...[...unreachable].map(([label, why]) =>
      `    // not scheduled: ${label} -- ${why}`),
    ...[...notScheduled].map(([label, why]) =>
      `    // not scheduled: ${label} -- ${why}`),
    `    bool runEnabledEvents();`,
    ...(deliveryLabels.length
      ? ["    // What an ARRIVAL may run: the events a delivery enables, which is",
         "    // NOT the whole set -- an arrival running everything fired the",
         "    // packet-creating events too, at zero simulated time.",
         "    bool runDeliveryEvents();"]
      : []),
  ].join("\n");

  return { decls, defs: defs.join("\n\n") };
}

// Splice the scheduler in, and call it from the sensing timer.
export function installScheduler(tree: GeneratedTree, model: EncodedMachine, cls: string, fields: PacketField[],
  notScheduled: ReadonlyMap<string, string> = new Map(), modelDrivesTransmit = false,
  carrierSets: ReadonlySet<string> = new Set(),
  // Events an ARRIVAL may run. Empty means no separate delivery entry point.
  deliveryLabels: readonly string[] = [],
  // Why the shell's own demo traffic is suppressed, in the shell's own terms.
  // The network module's transmit path is the medium binding; the application's
  // is the model's transmit event calling transmitPacket(). Same decision, two
  // reasons, and the emitted comment should say which one applies.
  transmitOwner = "the medium\n    //  binding makes the model's transmit event the transmit path",
  // Events that genuinely never execute. `notScheduled` is NOT this set: it also
  // holds send_up, which the arrival calls on every reception and which fills
  // ctlNeighbours -- masking it would make receive_controlPkt look unreachable.
  neverRuns: ReadonlySet<string> = new Set()): GeneratedTree {
  const ccFile = implOf(tree);
  if (!ccFile) return tree;
  const { decls, defs } = emitScheduler(model, cls, ccFile.content, fields, notScheduled, carrierSets, deliveryLabels, neverRuns);

  return tree.map((f) => {
    if (f.path.endsWith(".h")) {
      const anchor = "  public:";
      const at = f.content.lastIndexOf(anchor);
      if (at < 0) return f;
      return { ...f, content: f.content.slice(0, at) + decls + "\n\n" + f.content.slice(at) };
    }
    if (f.path.endsWith(".cc")) {
      let content = f.content;
      // Record what fired. Without this the run is unmeasurable: a green 60s
      // and a plausible packet count say nothing about whether the MODEL
      // executed, which is the only thing under test.
      const FIN = `void ${cls}::finish() {`;
      if (content.includes(FIN))
        content = content.replace(
          FIN,
          FIN +
            '\n    for (auto& _fc : firedCount)' +
            '\n        recordScalar(("fired:" + _fc.first).c_str(), _fc.second);',
        );
      const at = content.indexOf("\nDefine_Module(");
      content = at < 0 ? content + "\n" + defs : content.slice(0, at + 1) + defs + "\n\n" + content.slice(at + 1);
      // Drive it from the timer that already exists in the shell.
      //
      // Once the model's own transmit event drives the radio -- the medium
      // binding in the network module, transmitPacket() in the application --
      // the timer drives the MODEL and nothing else.
      // The shell's own sendSensorPacket() is app-layer demo traffic -- a
      // ByteCountChunk addressed to the sink, which the network-layer machine
      // does not describe -- and it now shares one radio with the model's own
      // packets. Leaving it in does not just add noise to the counts: it
      // contends for the same duty-cycled MAC, so the model's transmissions are
      // the ones that get lost. The method stays emitted, like the shell's other
      // helpers; nothing calls it.
      content = content.replace(
        /^(\s*)sendSensorPacket\(\);$/m,
        modelDrivesTransmit
          ? `$1runEnabledEvents();   // Event-B events enabled at this tick\n` +
            `$1// (the shell's own sendSensorPacket() is not called: ${transmitOwner})`
          : `$1sendSensorPacket();\n$1runEnabledEvents();   // Event-B events enabled at this tick`,
      );
      return { ...f, content };
    }
    return f;
  });
}

import type { EncodedMachine, GeneratedTree } from "./types";
import { splitConjuncts } from "./ruleEngine";
import type { PacketField } from "./packetModel";
import { getterOf } from "./packetModel";
import { nestedMapVars } from "./nestedMap";
import { pairKeyedVars } from "./pairKeyed";
import { emittedMethods, splitParams, implOf, headerOf, unreachableEvents, mustFind, mustReplace, packetTypeLeaves } from "./emitted";
import { DELIVERED_BY } from "./packetModel";
import { orderByPhase } from "./phaseFlags";
import { esc } from "./text";

// A relational image, in either of the two spellings the corpus uses.
//
// `R[{x}]` is the direct one. `ran({x} ◁ R)` -- the range of a domain
// restriction -- is the SAME SET by the identity `R[{x}] = ran({x} ◁ R)`, and
// it is the spelling the CommPattern itself uses:
//
//     des = ran({pkt} ◁ finalDestAddr)      (creatingControlPacket, uM2)
//
// Only the direct spelling was recognised, so `des` was reported as having no
// binding on every model that carries the pattern's creating events -- although
// it is fully DETERMINED once `pkt` is known, which is a lookup and not a
// search. Both forms resolve to the same emitted `relImage(R, x)`.
//
// ⚠ Deliberately narrow: `ran(R)` is the whole range, `ran(S ◁ R)` over a set
// variable is an image over many points, and `▷` restricts the range instead of
// the domain. None of those is `R[{x}]`, so none is claimed here.
export function relationalImageOf(clause: string, p: string): { R: string; x: string } | null {
  const c = clause.trim();
  const direct = new RegExp(`^${esc(p)}\\s*=\\s*(\\w+)\\s*\\[\\s*\\{\\s*(\\w+)\\s*\\}\\s*\\]$`).exec(c);
  if (direct) return { R: direct[1], x: direct[2] };
  const ranDom = new RegExp(
    `^${esc(p)}\\s*=\\s*ran\\s*\\(\\s*\\{\\s*(\\w+)\\s*\\}\\s*◁\\s*(\\w+)\\s*\\)$`).exec(c);
  if (ranDom) return { R: ranDom[2], x: ranDom[1] };
  return null;
}

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

/**
 * Is the right-hand side of a membership the parameter's TYPE rather than a
 * claim that it already exists?
 *
 * ⚠ THIS USED TO ACCEPT ONLY THE BARE CARRIER NAME, and that read one of the
 * corpus's guards as the exact reverse of what it says:
 *
 *     pkt ∈ PKT ∖ (xmittedPkts ∪ middleware)        (RTMCS M0)
 *
 * which is the freshest statement that model makes — in PKT, not yet
 * transmitted, not in the middleware. Read as "already exists", it denied every
 * RTMCS creating event its mint, hence its type stamp, hence its place in the
 * reachability pass: the whole RREQ/RREP/RRER chain dropped on a guard that
 * means the opposite of how it was read. MintRoute writes the bare `pkt ∈ PKT`
 * and was never affected, which is why this survived three case studies.
 *
 * The operators are NOT interchangeable, so the test is on them and not just on
 * the head name:
 *
 *     C ∖ S    in C and NOT in S    a restriction — no existence claim
 *     C ∪ S    in C or in S         a widening    — no existence claim
 *     C ∩ S    in C AND in S        CARRIES an existence claim — not typing
 *
 * Measured against the raw `.bum` XML of all three case studies: `∖` and `∪`
 * both occur (`ND ∖ Destination`, `ND ∪ {BROADCAST}`); `∩` does not occur at
 * all. It is refused anyway, and refusal is the SAFE direction — a parameter
 * wrongly held to exist makes its event report as unschedulable with a stated
 * reason, whereas one wrongly held fresh mints a packet that should not exist.
 */
export function isTypingSet(rhs: string, carriers: ReadonlySet<string>): boolean {
  if (rhs.includes("∩")) return false;
  const head = /^\s*(\w+)/.exec(rhs);
  return head !== null && carriers.has(head[1]);
}

/**
 * Which of an event's parameters are node-valued attributes of a packet it is
 * MINTING, and so must be chosen rather than read.
 *
 * ⚠ RTMCS's `create_rreq` determines its originator as `s = initialSrcAddr(pkt)`
 * and gives `s` no other binding. Read off a chunk being minted, that yields the
 * field's default -1, and the event declines on `floodSeqNo.count(-1)` every
 * tick on every node -- schedulable and firing zero times. For a creating event
 * the source is not something to look up: the creator IS the source.
 *
 * Each condition earns its place, and one of them is NOT exercised by the
 * corpus, which is said plainly rather than left to be discovered:
 *
 *   resolved      a parameter bound another way is left alone -- MintRoute's
 *                 `s = Sink` and the pattern's `x ∈ ND ∖ Dests` already resolve
 *                 the originator, and the caller's stamp then satisfies the same
 *                 guard by construction. Exercised: both would change if dropped.
 *   a parameter   `q` must be one; a bare name that is not is not ours to bind.
 *   node-valued   ⚠ NO CORPUS EVENT distinguishes this today -- every such clause
 *                 on a minted packet happens to name a node-valued field. Kept
 *                 because without it a creating event whose sequence number were
 *                 written `sno = pktSeqNo(pkt)` would enumerate a sequence number
 *                 over node ids, which compiles and is nonsense. Tested directly
 *                 below for that reason; a mutation of it survives the end-to-end
 *                 suite.
 *
 * `nodeFields` is derived from the model's own `initialSrcAddr ∈ PKT → ND`, via
 * the same PacketField.cppType the chunk's field type comes from, so no field
 * name appears here.
 */
export function chosenAtCreation(
  clauses: readonly string[], packet: string, params: readonly string[],
  resolved: ReadonlySet<string>, nodeFields: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const c of clauses) {
    const m = new RegExp(`^(\\w+)\\s*=\\s*(\\w+)\\(\\s*${packet}\\s*\\)$`).exec(c.trim());
    if (!m || resolved.has(m[1]) || out.includes(m[1])) continue;
    if (!nodeFields.has(m[2]) || !params.includes(m[1])) continue;
    out.push(m[1]);
  }
  return out;
}

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

// How many extra rounds `runEnabledEvents` may drain when draining is on.
// A bound, not a fixpoint-forever: two events can enable each other.
const DRAIN_ROUNDS = 64;

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

/**
 * Everything a plan needs that is a property of the MODEL rather than of the
 * event being planned. It is built once per module and read by every event.
 *
 * ⚠ These seven travelled as seven positional parameters, and the structure-3
 * work pushed the signature to ten -- `leaves` and `senderField` were threaded
 * through three functions to reach here, and at ten arguments an extra one is
 * added by counting commas. They are one thing: the context a plan is made in.
 */
interface PlanContext {
  carriers: Set<string>;
  enc: (id: string) => string | undefined;
  nestedVars: Set<string>;
  pktField: Map<string, string>;
  /** Leaves of the emitted packet-type lattice -- see typeOf. */
  leaves: ReadonlySet<string>;
  /**
   * Packet fields the model types as NODE-valued (`initialSrcAddr ∈ PKT → ND`).
   * A creating event may choose such a field's value; it cannot read one off a
   * packet it is in the middle of minting.
   */
  nodeFields: ReadonlySet<string>;
  /**
   * The Event-B name of the field carrying the SENDER, from senderFieldOf.
   * Null when the model stamps none, in which case nothing is delivery-scoped.
   */
  senderField: string | null;
  /**
   * Variables whose key is a MAPLET, not a scalar -- the two binding cases
   * below read them as `f.at({a, b})`.
   */
  pairKeyed: Set<string>;
}

function planFor(label: string, params: Param[], guards: string[], ctx: PlanContext): Plan {
  const { carriers, enc, nestedVars, pktField, leaves, nodeFields, senderField, pairKeyed } = ctx;
  const clauses = guards.flatMap((g) => splitConjuncts(g));
  const lines: string[] = [];
  const rollback: string[] = [];
  let stamps: string | undefined;
  const resolved = new Set<string>();
  // Packets this event MINTS, as opposed to ones it was handed. A field read off
  // a minted packet is a read of a default, not of data -- see the node-valued
  // branch below.
  const minted = new Set<string>();
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
  //
  // Two spellings pin one, and only reading the first left the pattern's own
  // creating event unable to fire. `type(p) = BEACON` is MintRoute's: a leaf
  // named outright. `type(p) ∈ CONTROL` is the CommPattern's, and whether it
  // pins a tag depends on the lattice rather than on the shape:
  //
  //   - the pattern declares `partition(TYPE, CONTROL, {DATA})` and nothing
  //     further, so CONTROL is itself a LEAF -- membership in a one-element set
  //     determines the value, and the emitted enum has a `CONTROL` member;
  //   - MintRoute declares `partition(CONTROL, {ROUTE}, {BEACON})` on top, so
  //     CONTROL is an intermediate group with no enum member of its own.
  //     Membership says "one of two" and determines nothing, which is correct:
  //     a model that distinguishes control subtypes supplies a creating event
  //     per leaf, and each of those names its own tag in the first spelling.
  //
  // So the discriminator is exactly "is this name a leaf", and `leaves` is read
  // off the emitted enum, which is where that decision was already made.
  //
  // ⚠ Without this, `creatingControlPacket` minted a packet whose type stayed
  // at the enum's default (DATA = 0) and then declined on its own
  // `CONTROL.count(...)` guard -- scheduled, reachable, called every tick, and
  // never once firing.
  const typeOf = (p: string): string | undefined => {
    for (const c of clauses) {
      const eq = new RegExp(`^type\\(\\s*${p}\\s*\\)\\s*=\\s*(\\w+)$`).exec(c.trim());
      if (eq) return eq[1];
      const mem = new RegExp(`^type\\(\\s*${p}\\s*\\)\\s*∈\\s*(\\w+)$`).exec(c.trim());
      if (mem && leaves.has(mem[1])) return mem[1];
    }
    return undefined;
  };
  // ⚠ A `∉` guard alone does NOT mean the event creates the packet. Every
  // event that takes a packet the node ALREADY HOLDS also says what must not
  // be true of it -- MintRoute's `final_tx_controlPkt` guards
  // `pkt ∈ middleware` and `pkt ∉ sensedPkts` together, and reading only the
  // second minted a brand-new ROUTE packet every tick for an event whose whole
  // job is to retire one that exists. That also fooled the reachability pass
  // into scheduling `start_tx_routePkt`, because a minted-and-stamped packet
  // looks exactly like a produced one.
  //
  // So a positive membership naming the parameter settles it: in a set, in a
  // pair, in a function's domain -- whichever spelling, the model is saying the
  // packet is already there. Membership in a CARRIER set is excluded, because
  // that clause is the parameter's TYPE and every parameter has one -- and so is
  // membership in a carrier RESTRICTED or WIDENED, which is `isTypingSet`.
  const existsAlready = (p: string) => clauses.some((c) => {
    const t = c.trim();
    if (t.includes("∉")) return false;
    const m = /^([^∈]*)∈\s*(.*)$/.exec(t);
    if (!m) return false;
    // p must be a MEMBER of the left side, not an argument inside it.
    // `type(pkt) ∈ CONTROL` says what kind of packet this is, not that it
    // exists -- reading it as existence retired `create_bconPkt` and took the
    // whole flood with it, which is how this narrowing was found.
    const lhs = m[1].replace(/\w+\s*\([^)]*\)/g, " ");
    if (!new RegExp(`\\b${p}\\b`).test(lhs)) return false;
    return !(lhs.trim() === p && isTypingSet(m[2], carriers));
  });
  const isFresh = (p: string) =>
    clauses.some((c) => new RegExp(`^${p}\\s*∉`).test(c.trim())) && !existsAlready(p);

  let progress = true;
  // ⚠ `p ∈ dom(F)` is a LAST RESORT and is switched on only once every other
  // branch has stalled, because it can otherwise steal a parameter that
  // belongs to a stronger binding. Measured: RTMCS's `create_rreq` guards both
  // `s = initialSrcAddr(pkt)` and `s ∈ dom(floodTbl)`, and `s` is reached
  // BEFORE `pkt`. Allowed to fire immediately, the domain branch bound the
  // originator off `floodTbl` and the creating event stopped CHOOSING its
  // source -- undoing the fix that made RTMCS originate a packet at all.
  // Deferring it costs nothing: an event whose parameter has a real binding
  // resolves on the first pass and never reaches this.
  let domAllowed = false;
  while (resolved.size < params.length) {
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
      ).find(Boolean)
        // ⚠ OR THE GRAPH FORM, `x ↦ p ∈ F`, WHICH SAYS THE SAME THING. A
        // function IS its graph, so with the key bound the maplet DETERMINES the
        // value exactly as the application does. The mirror of the pktStore
        // branch further down, which binds the key from a known value.
        //
        // ⚠ AND THE TWO CASE STUDIES DIFFER HERE, WHICH IS WHY IT WAS MISSING.
        // MintRoute's receive events write `pkt ∈ dom(pktFwdr) ∧ f = pktFwdr(pkt)`
        // -- the application form, already handled. RTMCS's write
        // `pkt ↦ f ∈ pktFwdr`. Unrecognised, `f` fell through to "enumerate over
        // ND" -- and `bindNodeIdentity` makes ND hold exactly THIS node, so the
        // loop could only ever try `f = myNodeId` and the guard comparing it
        // against the chunk's forwarder failed on every packet that came from a
        // neighbour. Measured: 672 rejections in dest_recv_rreqPkt, with no
        // later guard ever reached, so not one RREQ was ever delivered to its
        // destination.
        ?? clauses.map((c) => {
          const m = new RegExp(`^(\\w+)\\s*↦\\s*${p}\\s*∈\\s*(\\w+)$`).exec(c.trim());
          // Only for an ENC7 packet field: the value is on the chunk, which is
          // what makes it readable. A pair-set of nodes says nothing of the kind.
          return m && pktField.has(m[2]) && known(m[1])
            ? ([c, m[2], m[1], undefined, undefined] as unknown as RegExpExecArray)
            : null;
        }).find(Boolean);
      // ⚠ A NODE-VALUED FIELD OF A PACKET THIS EVENT IS MINTING IS NOT A READ.
      //
      // `create_rreq` (RTMCS) determines its originator as `s = initialSrcAddr(pkt)`
      // and gives `s` no other binding. Reading that off a freshly minted chunk
      // yields the field's default, -1, and the event then declines on the first
      // guard that uses it -- `floodSeqNo.count(-1)` -- every tick, on every node:
      // schedulable, and firing zero times.
      //
      // For a CREATING event the source is not something to look up; the creator
      // IS the source. The generator already knows this and already acts on it
      // twice -- MintRoute's `s = Sink` and the pattern's `x ∈ ND ∖ Dests` both
      // resolve the originator independently, and the fresh-packet branch below
      // then STAMPS the field, satisfying the same guard by construction. The only
      // shape missing was the one where the read is the ONLY binding, which is why
      // this sits inside the read rather than beside it.
      //
      // Enumerating over the node carrier is what makes it right per node rather
      // than merely non-negative: `bindNodeIdentity` emits `ND.insert(myNodeId)`,
      // so in a per-node module ND holds exactly this node, and the loop binds the
      // originator to the only node that could have originated it. The pattern's
      // own creating event has enumerated over ND since the set-difference fix.
      //
      // Derived, not named: `cppType === "Node"` on the PacketField comes from the
      // model's own `initialSrcAddr ∈ PKT → ND`. A field valued as anything else
      // (a sequence number, a payload) still reads, because nothing says what
      // value the creator should invent for it.
      if (fn && known(fn[2])) {
        const [, f, x, op, n] = fn;
        const arith = op ? ` ${op === "+" ? "+" : "-"} ${n}` : "";
        // ENC7 may have moved this attribute onto the chunk, in which case the
        // context map is empty and reading it would skip every candidate. This
        // is the same trap as in the construction branch below, and it is what
        // stopped find_neighbours firing even once it became schedulable.
        const acc = pktField.get(f);
        if (acc && f === senderField) {
          // ⚠ THE FORWARDER IS A PROPERTY OF THE DELIVERY, NOT OF THE PACKET,
          // so it is read from what the ARRIVAL recorded and not off the shared
          // chunk. This module processes a delivery lazily -- the publication
          // outlives the arrival that made it -- while this node's own
          // `start_tx` re-stamps that chunk with its own id, so a receive event
          // binding here at scheduling time read ITSELF as the forwarder.
          // Mirror of the transmit, which pins the wire copy from send_down's
          // own `x`; the model names this one too, as send_up's `x`.
          // The chunk is the fallback, for a packet this node created itself
          // and was never delivered.
          lines.push(`    if (pktStore.count(${x}) == 0) ${bail()}`);
          lines.push(`    ${par.cppType} ${p} = ${DELIVERED_BY}.count(${x}) > 0`
            + ` ? ${DELIVERED_BY}.at(${x}) : pktOf(${x})->get${acc}()${arith};`);
        } else if (acc) {
          lines.push(`    if (pktStore.count(${x}) == 0) ${bail()}`);
          lines.push(`    ${par.cppType} ${p} = pktOf(${x})->get${acc}()${arith};`);
        } else {
          lines.push(`    if (${f}.count(${x}) == 0) ${bail()}`);
          lines.push(`    ${par.cppType} ${p} = ${f}.at(${x})${arith};`);
        }
        resolved.add(p); progress = true; continue;
      }
      // determined: p = f(a ↦ b) -- a PAIR-KEYED function read. The key is a
      // maplet, so `p = f(x)` above cannot match it: that pattern allows one
      // \w+ inside the parens and this has two plus the glyph.
      const pk2 = clauses.map((c) =>
        new RegExp(`^${p}\\s*=\\s*(\\w+)\\(\\s*(\\w+)\\s*↦\\s*(\\w+)\\s*\\)$`).exec(c.trim())
      ).find(Boolean);
      if (pk2 && pairKeyed.has(pk2[1]) && known(pk2[2]) && known(pk2[3])) {
        const [, f, a, b] = pk2;
        lines.push(`    if (${f}.count({${a}, ${b}}) == 0) ${bail()}`);
        lines.push(`    ${par.cppType} ${p} = ${f}.at({${a}, ${b}});`);
        resolved.add(p); progress = true; continue;
      }
      // determined: p = q − f(a ↦ b) − n
      //
      // This one shape is what unblocks the repeating flood. `update_nbr` binds
      //     delta = sNo − lastSeqno(y ↦ x) − 1
      // and without it the event is unschedulable, so nothing ever removes a
      // pair from `updateNbrs` and every node accepts one packet per forwarder
      // for ever. It is INET MintRoute's `sDelta = seqNo - nbr.lastSeqno - 1`.
      const pkd = clauses.map((c) =>
        new RegExp(`^${p}\\s*=\\s*(\\w+)\\s*(?:−|-)\\s*(\\w+)\\(\\s*(\\w+)\\s*↦\\s*(\\w+)\\s*\\)`
          + `(?:\\s*(?:−|-)\\s*(\\d+))?$`).exec(c.trim())
      ).find(Boolean);
      if (pkd && pairKeyed.has(pkd[2]) && known(pkd[1]) && known(pkd[3]) && known(pkd[4])) {
        const [, q, f, a, b, n] = pkd;
        lines.push(`    if (${f}.count({${a}, ${b}}) == 0) ${bail()}`);
        lines.push(`    ${par.cppType} ${p} = ${q} - ${f}.at({${a}, ${b}})${n ? ` - ${n}` : ""};`);
        resolved.add(p); progress = true; continue;
      }
      // determined: a relational image. Set-valued, but still COMPUTED rather
      // than searched: once x is known the image is a lookup, which is what
      // makes a set-typed parameter bindable at all. Both spellings -- see
      // relationalImageOf.
      const img = clauses.map((c) => relationalImageOf(c, p)).find(Boolean);
      if (img && known(img.x)) {
        // ⚠ BIND AT THE PARAMETER'S DECLARED TYPE, not always as a set.
        //
        // `std::set<Node>` was hardcoded here, which is right for a parameter
        // the model types as a set (`nbs`, declared `const std::set<Node>&`)
        // and wrong for one it does not. The CommPattern's `des` has no typing
        // guard of its own -- only the defining `des = ran({pkt} ◁
        // finalDestAddr)` -- so it is declared `int`, and binding a set to it
        // does not compile. That was invisible until the creating events
        // became schedulable.
        //
        // The scalar branch agrees with what the rest of the module already
        // says: the rule catalog translates that same guard as `des ==
        // finalDestAddr.at(pkt)`. Over a total function the image is a
        // SINGLETON, so the element and the one-element set carry the same
        // information and the guard is equally true either way.
        //
        // ⚠ Recorded rather than hidden: the model makes `des` a SET, and
        // typing it scalar is a simplification the catalog made first. Making
        // it a genuine set means changing the parameter's inferred type AND
        // that catalog rule together -- both, or neither, or the two halves
        // disagree exactly as they did here.
        const imgAcc = pktField.get(img.R);
        if (/set</.test(par.cppType)) {
          lines.push(`    std::set<Node> ${p} = relImage(${img.R}, ${img.x});`);
        } else if (imgAcc) {
          // ⚠ ENC7 MAY HAVE MOVED THIS ATTRIBUTE ONTO THE CHUNK, exactly as in
          // the `p = f(x)` branch above. `finalDestAddr` is a PPkt field AND a
          // context map that nothing populates, so reading the map made the
          // domain check fail on every candidate and `creatingControlPacket`
          // fired zero times while looking perfectly schedulable -- the same
          // two-storage trap as the 2026-09-08 `type(pkt)` defect.
          lines.push(`    if (pktStore.count(${img.x}) == 0) ${bail()}`);
          lines.push(`    ${par.cppType} ${p} = pktOf(${img.x})->get${imgAcc}();`);
        } else {
          // `.at` throws on a missing key, and an Event-B guard is an unordered
          // conjunction, so the domain check cannot be assumed to precede it.
          lines.push(`    if (${img.R}.count(${img.x}) == 0) ${bail()}`);
          lines.push(`    ${par.cppType} ${p} = ${img.R}.at(${img.x});`);
        }
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
        // ⚠ ITS NODE-VALUED ATTRIBUTES ARE CHOSEN FIRST, BEFORE THE MINT.
        //
        // `create_rreq` (RTMCS) determines its originator as
        // `s = initialSrcAddr(pkt)` and gives `s` no other binding, so `s` fell
        // through to the ordinary `p = f(x)` read and was taken off the chunk of
        // the packet being minted -- where the field is still its default, -1.
        // The event then declined on the first guard using it,
        // `floodSeqNo.count(-1)`, every tick on every node: schedulable, firing
        // zero times.
        //
        // For a creating event the source is not something to look up; the
        // creator IS the source. The generator already acts on this twice --
        // MintRoute's `s = Sink` and the pattern's `x ∈ ND ∖ Dests` both bind the
        // originator independently, and the stamp loop below then satisfies the
        // same guard by construction. Only the shape where the read is the ONLY
        // binding was missing.
        //
        // Resolving them HERE, ahead of the mint, is what keeps the emitted loops
        // nested correctly: bound after the mint, the enumeration would sit inside
        // the packet's lifetime, and a candidate that failed would erase the very
        // chunk the next iteration re-stamps -- losing the type tag with it. ND
        // holding exactly one node today would have hidden that.
        //
        // Derived, not named: `cppType === "Node"` comes from the model's own
        // `initialSrcAddr ∈ PKT → ND`. A field valued as anything else -- a
        // sequence number, a payload -- still reads, because nothing in the model
        // says what value a creator should invent for it.
        for (const q of chosenAtCreation(clauses, p, params.map((v) => v.name),
          resolved, nodeFields)) {
          lines.push(`    for (Node ${q} : ND) {`); depth++;
          resolved.add(q); progress = true;
        }
        lines.push(`    ${par.cppType} ${p} = newPktId();`);
        minted.add(p);
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
      // enumerated over a finite carrier MINUS a subtracted set.
      //
      // ⚠ The difference is still an enumeration, and missing that was what
      // stopped the CommPattern's own creating event. It types its originator
      // `x ∈ ND ∖ Dests`; the plain matcher below does not match a difference,
      // so `x` was unresolvable on the first pass, the packet got minted
      // first, and `x` then fell through to `x = initialSrcAddr(pkt)` -- READ
      // off the fresh chunk, where that field is still −1. `ND.count(-1) > 0`
      // is false, so the event declined on its first guard every tick and the
      // module ran its full sixty seconds firing nothing.
      //
      // Resolving it HERE, before the packet exists, is what puts it on
      // MintRoute's working path: `s = Sink` resolves that model's originator
      // independently and `s = initialSrcAddr(pkt)` is then satisfied by
      // CONSTRUCTION, with the fresh-packet branch stamping the field. Nothing
      // is invented -- `initialSrcAddr` is never assigned in any model.
      //
      // The subtraction is load-bearing and is emitted, not dropped: the
      // pattern says control packets originate AWAY from the destinations.
      const inDiff = clauses.map((c) =>
        new RegExp(`^${p}\\s*∈\\s*(\\w+)\\s*∖\\s*(\\w+)$`).exec(c.trim())).find(Boolean);
      if (inDiff && carriers.has(inDiff[1]) && inDiff[1] !== "PKT") {
        lines.push(`    for (${par.cppType} ${p} : ${inDiff[1]}) {`); depth++;
        lines.push(`    if (${inDiff[2]}.count(${p}) > 0) continue;`);
        resolved.add(p); progress = true; continue;
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
      // `p ∈ dom(F)` -- the candidates are F's own keys.
      //
      // This is the same move the packet branch below makes ("dom of the
      // packet-keyed functions is pktStore, so enumerating it is enumerating
      // the packets that exist"), stated for an ordinary machine variable, and
      // it was the ONLY binding three RTMCS events and one MintRoute event had:
      // `reset_fldRREQ`, `reset_fldRREP`, `reset_fldRRER` and MintRoute's
      // `reset_flooding` all guard `x ∈ dom(floodFlg) ∧ floodFlg(x) = TRUE`.
      // Without it they were unschedulable, nothing ever lowered the flood
      // flag, and `start_fldRREP` -- which needs it LOW -- rejected 100% of its
      // calls on that one guard, so no RREP was ever created.
      //
      // ⚠ A PACKET FIELD IS EXCLUDED, and that is not caution but the
      // two-storage trap, which this project has now paid for four times: ENC7
      // moves a packet attribute's value onto the chunk and its machine map is
      // left dead (and may be stripped entirely), so binding off `dom(F)` for
      // one would enumerate an empty map -- or fail to compile. RTMCS's
      // `clear_pkt` reaches this branch and every one of its six `dom()` guards
      // names a relocated field, so it stays unschedulable, correctly.
      //
      // ⚠ Pair-keyed variables are excluded too: their key is a MAPLET, so
      // `e.first` is a `std::pair`, not the scalar the parameter is typed as.
      const dm = domAllowed ? clauses.map((c) =>
        new RegExp(`^${p}\\s*∈\\s*dom\\s*\\(\\s*(\\w+)\\s*\\)$`).exec(c.trim())).find(Boolean) : undefined;
      if (dm && !pktField.has(dm[1]) && !pairKeyed.has(dm[1]) &&
          (enc(dm[1]) === "function" || enc(dm[1]) === "map-of-sets")) {
        lines.push(`    for (auto& _dm_${p} : ${dm[1]}) {`); depth++;
        lines.push(`    ${par.cppType} ${p} = _dm_${p}.first;`);
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
    // A pass that bound nothing means the ordinary branches are exhausted: turn
    // the last resort on and go round once more, then stop.
    if (progress) continue;
    if (domAllowed) break;
    domAllowed = true;
  }

  const missing = params.filter((p) => !resolved.has(p.name)).map((p) => p.name);
  return missing.length === 0
    ? { label, params, lines, rollback, ok: true, stamps }
    : { label, params, lines, rollback, ok: false, why: `no binding for ${missing.join(", ")}` };
}

function emitScheduler(model: EncodedMachine, cls: string, cc: string, fields: PacketField[],
  // Events NOT scheduled spontaneously, each with the reason, which is emitted
  // beside the declaration. Two reasons exist so far and they are different
  // claims: "the simulator realises this" (the medium binding) and "a carried
  // event supersedes this" (the packet-pattern merge).
  notScheduled: ReadonlyMap<string, string> = new Map(),
  carrierSets: ReadonlySet<string> = new Set(),
  deliveryLabels: readonly string[] = [],
  // Events that genuinely never execute -- NOT the same as `notScheduled`,
  // which also holds send_up, an event the arrival calls on every reception.
  neverRuns: ReadonlySet<string> = new Set(),
  // Events the ARRIVAL runs inline instead of the timer scheduling them.
  arrivalEvents: readonly string[] = [],
  // Leaves of the emitted packet-type lattice, read off the header -- see typeOf.
  leaves: ReadonlySet<string> = new Set(),
  // See planFor.
  senderField: PacketField | null = null,
  // Drain the non-creating events to a bounded fixpoint each pass. Off by
  // default, so every recorded measurement stays reproducible and the fix can
  // be measured against them side by side rather than replacing them.
  drain = false): { decls: string; defs: string } {
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
  // Derived here rather than plumbed through installScheduler: the model is
  // already in hand and pairKeyedVars reads it directly.
  const pairKeyed = new Set(pairKeyedVars(model).map((v) => v.name));
  const sigs = signatures(cc, cls);
  // The model's own carrier sets, passed in from the contexts. This used to be
  // `Object.keys(CARRIER_ALIAS)` -- the three names that happen to need a C++
  // type alias -- which is a different question and a shorter list: MintRoute
  // declares PKT, TYPE, CTL_STATUS and ENV_STATUS. A parameter typed
  // `p ∈ CTL_STATUS` failed the enumeration test below and its event was
  // reported unschedulable with a binding that was in fact available.
  const carriers = new Set([...carrierSets, ...Object.keys(CARRIER_ALIAS)]);
  // Built once: none of it varies by event.
  const planContext: PlanContext = {
    carriers, enc: (id) => model.encodings.get(id),
    nestedVars, pktField, leaves,
    // From the model's own `∈ PKT → ND`, via PacketField.cppType -- the same
    // derivation the chunk's field type comes from, asked once here.
    nodeFields: new Set(fields.filter((f) => f.cppType === "Node").map((f) => f.ebName)),
    senderField: senderField ? senderField.ebName : null, pairKeyed,
  };
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
    const plan = planFor(ev.label, sig.params, ev.guards, planContext);
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
  // ⚠ Some events are not SCHEDULED at all -- they are run inline on the
  // arrival, because a reception is the only thing that enables them.
  //
  // The hand-written MintRoute settles the shape: it calls updateNbrCounters()
  // at the top of onReceiveBeaconPkt, so the neighbour counters are updated by
  // the reception itself, never searched for by a timer. The model says the
  // same thing as events that DRAIN what the receive events fill, and giving
  // those a try_ method puts a second, timer-driven account of one reception
  // into the module. So they are emitted where the reception is handled, and
  // there is one place a reception is accounted for.
  const inlined = new Set(arrivalEvents.filter((l) => firable.some((p) => p.label === l)));
  // ⚠ THE ORDER OF THIS LIST IS BEHAVIOUR, NOT PRESENTATION. Each event is
  // attempted once per tick in this order and sees what the earlier ones left,
  // so an event tried after the one that falsifies its guard never fires at
  // all. Model order alone leaves RTMCS's `start_fldRREP` dead by construction
  // and lets three phase terminators empty their own phase -- see phaseFlags.ts
  // for the two repairs and for what they deliberately do not attempt. Every
  // event neither rule touches keeps its model position.
  const unordered = firable.filter((p) => !inlined.has(p.label));
  const order = orderByPhase(model, unordered.map((p) => p.label));
  const scheduled = order.map((l) => unordered.find((p) => p.label === l)!);
  const defs: string[] = [];
  const closers = (p: Plan) => Array(p.lines.filter((l) => l.trim().startsWith("for (")).length);
  const callOf = (p: Plan) => `${p.method ?? p.label}(${p.params.map((x) => x.name).join(", ")})`;
  for (const p of scheduled) {
    const body = [
      ...p.lines,
      `    if (${callOf(p)}) { firedCount["${p.label}"]++; return true; }`,
      ...(p.rollback.length ? p.rollback : []),
      ...closers(p).fill("    }"),
      "    return false;",
    ];
    defs.push(`bool ${cls}::try_${p.label}()\n{\n${body.join("\n")}\n}`);
  }

  // The same body, at the arrival, with no method to name it. The lambda is
  // scoping only: the binding loops exit early (an event that fires erases the
  // very pair the loop is walking), and a bare `return` here would abandon the
  // rest of the arrival.
  const inlineAt = (p: Plan) => [
    `    // ${p.label} -- run by the reception, not by the timer.`,
    "    if ([&]() -> bool {",
    ...p.lines.map((l) => `    ${l}`),
    `        if (${callOf(p)}) { firedCount["${p.label}"]++; return true; }`,
    ...p.rollback.map((l) => `    ${l}`),
    ...closers(p).fill("        }"),
    "        return false;",
    "    }()) fired = true;",
  ].join("\n");

  // ⚠ WHICH EVENTS MAY BE DRAINED, AND WHY THE CREATING ONES MAY NOT.
  //
  // An Event-B event fires while its guards hold; attempting each ONCE per pass
  // is an implementation artifact, and a measurable one. On a node with no
  // incoming traffic -- which is the only place it is visible, because an
  // arrival grants extra passes -- a node creating one ROUTE and one BEACON per
  // tick gets ONE start_tx opportunity and transmits ONE. Measured on the sink
  // under [Config SinkBeacon]: 60s -> 22 created, 11 transmitted, backlog 11;
  // 120s -> 46 created, 23 transmitted, backlog 23. Exactly linear, so the
  // undrained packets accumulate in ndBuff and pktStore for ever.
  //
  // But the CREATING events must stay at once per pass. Their guards are
  // satisfiable indefinitely -- a fresh packet can always be minted -- so
  // draining them would originate unboundedly many per tick, which is strictly
  // worse than the backlog. A tick IS one origination opportunity; that is the
  // environment boundary, and it belongs on the timer.
  //
  // A creating event is exactly a plan that MINTS, and the mint is what puts
  // `pktStore.erase` into its rollback. Derived rather than named, so a model
  // whose creating events are called anything at all still works.
  const mints = (p: Plan) => p.rollback.some((r) => r.includes("pktStore.erase"));
  const call = (p: Plan) => `    if (try_${p.label}()) fired = true;`;
  const drainable = scheduled.filter((p) => !mints(p));

  // ⚠ THE FIRST PASS IS LEFT EXACTLY AS IT WAS, in model order, and the drain
  // rounds are ADDED after it. Partitioning the first pass instead would move
  // the creating events ahead of everything else, and the order events are
  // attempted in is behaviour -- each attempt sees what the earlier ones left.
  const drainRounds = [
    "    // Then drain what a single pass leaves behind. See above: the creating",
    "    // events are deliberately NOT in here.",
    `    for (int _round = 0; _round < ${DRAIN_ROUNDS}; _round++) {`,
    "        bool _any = false;",
    ...drainable.map((p) => `        if (try_${p.label}()) _any = true;`),
    "        if (!_any) break;   // fixpoint reached",
    "        fired = true;",
    "    }",
    "    // The bound is not decoration: two events can enable each other, and an",
    "    // unbounded loop here would be a zero-time storm. This project has had",
    "    // one -- 52,034 events at a single instant.",
  ].join("\n");

  // Nothing to drain means no loop at all, rather than a loop over an empty body
  // guarded by a constant the compiler folds away.
  const runBody = scheduled.map(call).join("\n")
    + (drain && drainable.length > 0 ? `\n${drainRounds}` : "");
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
  if (deliveryLabels.length > 0 || inlined.size > 0) {
    const usable = deliveryLabels.filter((l) => scheduled.some((p) => p.label === l));
    defs.push(
      "// The events a DELIVERY enables -- the subset an arrival may run.\n" +
      `bool ${cls}::runDeliveryEvents()\n{\n    bool fired = false;\n` +
      usable.map((l) => `    if (try_${l}()) fired = true;`).join("\n") +
      // ⚠ After the receive events, never before: they are what fills the
      // state these drain, so running them first would find nothing.
      (inlined.size
        ? "\n" + firable.filter((p) => inlined.has(p.label)).map(inlineAt).join("\n")
        : "") +
      "\n    return fired;\n}",
    );
  }

  const decls = [
    "    // ── Event scheduler (Event-B operational semantics) ──",
    "    // How many times each event actually fired. Without this the run is",
    "    // unmeasurable: a green 60s and a plausible packet count say nothing",
    "    // about whether the MODEL executed, which is the only thing under test.",
    "    std::map<std::string, long> firedCount;",
    ...scheduled.map((p) => `    bool try_${p.label}();`),
    ...[...inlined].map((l) =>
      `    // not scheduled: ${l} -- the reception runs it, inline in` +
      ` runDeliveryEvents()`),
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
  neverRuns: ReadonlySet<string> = new Set(),
  // Events the ARRIVAL runs inline -- see emitScheduler.
  arrivalEvents: readonly string[] = [],
  // See planFor.
  senderField: PacketField | null = null,
  // See emitScheduler.
  drain = false): GeneratedTree {
  const ccFile = implOf(tree);
  if (!ccFile)
    throw new Error("installScheduler: the generated tree has no .cc to install a scheduler into.");
  // The packet-type leaves come from the emitted HEADER, where the enum is.
  const hdr = headerOf(tree);
  const { decls, defs } = emitScheduler(model, cls, ccFile.content, fields, notScheduled, carrierSets,
    deliveryLabels, neverRuns, arrivalEvents, packetTypeLeaves(hdr?.content ?? ""), senderField,
    drain);

  return tree.map((f) => {
    if (f.path.endsWith(".h")) {
      const anchor = "  public:";
      const at = f.content.lastIndexOf(anchor);
      // Not mustFind: this is the LAST occurrence, and a missing one is the
      // same precondition failure.
      if (at < 0)
        throw new Error("installScheduler: the generated header has no `  public:` "
          + "to declare the scheduler before. The emitter's output shape changed.");
      return { ...f, content: f.content.slice(0, at) + decls + "\n\n" + f.content.slice(at) };
    }
    if (f.path.endsWith(".cc")) {
      let content = f.content;
      // Record what fired. Without this the run is unmeasurable: a green 60s
      // and a plausible packet count say nothing about whether the MODEL
      // executed, which is the only thing under test.
      // ⚠ Loud, because losing THIS is losing the evidence rather than the
      // behaviour: without the scalars a run that executed no model events and
      // a run that executed all of them produce identical output.
      const FIN = `void ${cls}::finish() {`;
      content = mustReplace(content, FIN,
        FIN +
          '\n    for (auto& _fc : firedCount)' +
          '\n        recordScalar(("fired:" + _fc.first).c_str(), _fc.second);',
        "installScheduler (firing counters)");
      // Throws rather than appending at EOF, matching spliceImpl in
      // netPipeline.ts — the silent fallback still compiled, so an emitter
      // change that moved Define_Module would have quietly relocated the
      // scheduler with nothing to show for it.
      const at = mustFind(content, "\nDefine_Module(", "installScheduler (definitions)");
      content = content.slice(0, at + 1) + defs + "\n\n" + content.slice(at + 1);
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
      // ⚠ THE SCHEDULER MUST END UP WITH EXACTLY ONE DRIVE PATH, and which one
      // depends on the shell — so the precondition is checked against the
      // emitted code rather than against a flag.
      //
      // The NETWORK shell writes its own `runEnabledEvents();` into the timer it
      // emits (netProtocolShell.ts), and it is installed before this pass, so
      // there is no `sendSensorPacket();` here to rewrite and none is wanted.
      // The APPLICATION shell has no such call: its timer calls SensorApp's own
      // `sendSensorPacket();`, and rewriting THAT is the only thing that reaches
      // runEnabledEvents(). With neither present the module compiles, links,
      // runs its full sixty seconds and fires ZERO model events — the most
      // expensive failure this generator has, and one it has already had.
      const alreadyDriven = /^\s*runEnabledEvents\(\);/m.test(content);
      if (!alreadyDriven) content = mustReplace(content,
        /^(\s*)sendSensorPacket\(\);$/m,
        modelDrivesTransmit
          ? `$1runEnabledEvents();   // Event-B events enabled at this tick\n` +
            `$1// (the shell's own sendSensorPacket() is not called: ${transmitOwner})`
          : `$1sendSensorPacket();\n$1runEnabledEvents();   // Event-B events enabled at this tick`,
        "installScheduler (timer hook)");
      // ⚠ And take the comment that described the call we just replaced.
      // codeEmitter emits an `EXTENSION POINT (send-down flow)` note beneath
      // `sendSensorPacket();` explaining how one WOULD drive the transmit chain
      // from the model. Once this pass has done exactly that, the note contradicts
      // the two lines above it and reads as an unfinished seam in a module that
      // is finished -- the same stale-doc-comment class as the generated header
      // that carried a SensorApp description above a NetworkProtocolBase class.
      //
      // ⚠ Checked as a POST-condition, not with mustReplace. `mustReplace`
      // would be wrong here: `modelDrivesTransmit` does not imply the note
      // exists -- codeEmitter emits this variant only on the `parity &&
      // hasSendDown` branch, and the other branch that carries a
      // `sendSensorPacket();` for the timer hook to rewrite carries no note at
      // all. So requiring a match would throw on a legitimate module. What IS
      // required is that a note which WAS there is gone once this pass has
      // run; that catches the wording drifting out of sync with the regex,
      // which is the failure worth being loud about.
      const NOTE = "// EXTENSION POINT (send-down flow): to drive the transmission from the";
      if (modelDrivesTransmit) {
        const had = content.includes(NOTE);
        content = content.replace(
          /^[ \t]*\/\/ EXTENSION POINT \(send-down flow\): to drive the transmission from the\n(?:[ \t]*\/\/.*\n)*/m,
          "");
        if (had && content.includes(NOTE))
          throw new Error("installScheduler (send-down note): the note is still present after "
            + "the strip, so codeEmitter's wording and this regex have drifted apart. The "
            + "module would ship describing an unfinished seam this pass has just finished.");
      }
      return { ...f, content };
    }
    return f;
  });
}

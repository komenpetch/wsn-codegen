import type { Rule, RuleMatch } from "./rules";
import type { PacketField } from "./packetModel";
import { getterOf, setterOf } from "./packetModel";
import { esc, OVERRIDE_OR_UNION_GLYPHS } from "./text";

export interface NetRule extends Rule { tier: 1 | 2 | 3; evidence: string[]; supersedes?: string; }

const re = (p: RegExp) => (expr: string): RuleMatch | null => {
  const g = p.exec(expr.trim());
  return g ? { captures: g.groups ?? {} } : null;
};

// Per-(ebName, kind) evidence -- VERIFIED 2026-09-06 against the real flattened
// corpora (MintRoute M5, RTMCS M6: `npm run event -- <Project> <machine> --all
// --flat`, cross-checked with a probe that ran each rule's own `match` regex
// against every event's split conjuncts; see task-5-report.md for the
// transcript). A (field, kind) pair that is not listed here has NO clause in
// EITHER corpus that the corresponding rule's `match` accepts -- rather than
// ship a rule with fabricated evidence (the bug this table replaces: every
// kind used to cite the same two MintRoute events regardless of whether they
// actually exercised it), the rule for that (field, kind) is simply not
// generated. Two corrections this uncovered beyond the flagged PKT-DEL bug:
//   - PKT-GET's true evidence is `send_down` (it reads the field back via
//     `y = f(pkt)` when handing the packet to the channel), not
//     create_bconPkt/create_routePkt, which only ever WRITE these fields.
//   - The `f(p) = v` spelling (field-call on the left) that PKT-CMP was meant
//     to match never occurs anywhere in either corpus -- every equality in
//     both models spells it `v = f(p)` (GET's form) -- so PKT-CMP is dropped
//     entirely rather than kept with evidence that cannot be found.
// initialSrcAddr's DOM evidence is a RTMCS event (MintRoute never guards
// `dom(initialSrcAddr)`); that is fine -- the field has the same name and
// shape in both models, and `composeRules`/the evidence check verify each
// cited event against ITS OWN project's corpus, not the field's origin.
//
// DOM vs DOM_NOT (added 2026-09-06, fixing a silent semantic inversion --
// task-6-report.md): `x ∈ dom(F)` and `x ∉ dom(F)` are NOT the same clause
// under ENC7 and do not share evidence. `∈` is read back by send_down right
// before the field is wiped (DEL) -- vacuously true, since a chunk always
// carries all its fields. `∉` is the "this packet/value does not exist yet"
// precondition of the events that first populate F (typically the create_*
// events) -- not translatable under ENC7 at all (see the rule comment in
// packetRules() below). So DOM's evidence must be a genuine `∈ dom(F)`
// clause and DOM_NOT's a genuine `∉ dom(F)` clause; for several fields these
// are different events entirely (verified against the real MintRoute
// M5 / RTMCS M6 flattened corpora, `npm run event -- <Project> <machine>
// --all --flat`, the same source packetRulesEvidence.test.ts checks
// against). A field with real clauses in only one direction gets only that
// rule -- e.g. initialSrcAddr is guarded `∈ dom(...)` four times across both
// corpora and `∉` never; envDestAddr and pktErrND are guarded `∉ dom(...)`
// exactly once each (their own creation site) and `∈` never.
type Kind = "GET" | "IMG" | "SET" | "SET_KEY" | "DOM" | "DOM_NOT" | "DEL" | "MEM" | "ARITH";
const EVIDENCE: Record<string, Partial<Record<Kind, string[]>>> = {
  // Context-sourced: a fixed per-packet identity, never written or removed.
  initialSrcAddr: {
    GET: ["MintRoute.create_dataPkt", "RTMCS.create_dataPkt"],
    DOM: ["RTMCS.create_rrer"],
  },
  // finalDestAddr's sibling, and the one field whose reads were left to the
  // base catalog -- because the corpus this table was first built from spells
  // them `des = finalDestAddr(pkt)` (GET's form, and RTMCS's own variable), and
  // the pattern spells the SAME read as a relational image.
  //
  // ⚠ WITH NO RULE HERE, `des = ran({pkt} ◁ finalDestAddr)` fell through to the
  // base catalog's MS6 and read `finalDestAddr` -- the CONTEXT MAP that ENC7
  // replaced. In the pattern that name is a context CONSTANT with a property
  // axiom and no elements, so the map is emitted DECLARED AND EMPTY and nothing
  // can ever fill it. Both creating events guarded against it: before MS6 was
  // domain-checked that was `std::out_of_range` thrown at runtime; after, a
  // guard that is false on every candidate. Fourth occurrence of the
  // two-storage trap (2026-09-08 `type(pkt)`, 2026-09-13 `netSeqNo`, the
  // scheduler's own image binding, and now its guard).
  //
  // ⚠ And the dead map survived `stripDeadPacketFieldMaps` because these very
  // guards referenced it -- the stale read is what kept its own storage alive.
  finalDestAddr: {
    IMG: ["AppLayer.creatingControlPacket", "AppLayer.creatingDataPacket"],
  },
  // The core attribute family every case study carries (pM1's ENC7 chunk
  // fields): established by the create_* events, read back and handed off
  // the wire by send_down, and (RTMCS only) swept out again by clear_pkt.
  // DOM (∈): send_down's own read-back guard, `pkt ∈ dom(F) ∧ v = F(pkt)`,
  // immediately before F is wiped for pkt. DOM_NOT (∉): the create_* events'
  // "packet does not exist yet" precondition -- and also send_up's own
  // precondition before it re-populates F from the vPkt* staging fields.
  pktSeqNo: {
    GET: ["MintRoute.send_down", "RTMCS.send_down"],
    SET: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DOM: ["MintRoute.send_down", "RTMCS.send_down"],
    DOM_NOT: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DEL: ["MintRoute.send_down", "RTMCS.send_down", "RTMCS.clear_pkt"],
  },
  pktSrc: {
    GET: ["MintRoute.send_down", "RTMCS.send_down"],
    SET: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DOM: ["MintRoute.send_down", "RTMCS.send_down"],
    DOM_NOT: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DEL: ["MintRoute.send_down", "RTMCS.send_down"],   // RTMCS.clear_pkt never touches pktSrc
  },
  pktFwdr: {
    GET: ["MintRoute.send_down", "RTMCS.send_down"],
    SET: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DOM: ["MintRoute.send_down", "RTMCS.send_down"],
    DOM_NOT: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DEL: ["MintRoute.send_down", "RTMCS.send_down", "RTMCS.clear_pkt"],
    // `pkt ↦ x ∈ pktFwdr` -- a function's graph tested via maplet membership
    // (valid Event-B for a `PKT ⇸ ND` variable, since a function IS its
    // graph) -- in MintRoute M3's update_nbr/update_nbr2 (the latter carried
    // into M4 as update_route). Real, task-7-discovered: the app-layer
    // catalog's generic "PS1" rule (rules.ts) matches ANY `a ↦ b ∈ R` clause
    // unconditionally and emits a pair-lookup `R.count({a, b})` regardless of
    // R's actual resolved encoding; pktFwdr is function-encoded
    // (`std::map<PktId, Node>`), so that does not compile. See MEM below.
    MEM: ["MintRoute.update_nbr", "MintRoute.update_route"],
  },
  pktData: {
    GET: ["MintRoute.send_down", "RTMCS.send_down"],
    SET: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DOM: ["MintRoute.send_down", "RTMCS.send_down"],
    DOM_NOT: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DEL: ["MintRoute.send_down", "RTMCS.send_down", "RTMCS.clear_pkt"],
  },
  pktNbHops: {
    GET: ["MintRoute.send_down", "RTMCS.send_down"],
    SET: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DOM: ["MintRoute.send_down", "RTMCS.send_down"],
    DOM_NOT: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DEL: ["MintRoute.send_down", "RTMCS.send_down", "RTMCS.clear_pkt"],
    // The hop count is the one field a receiver derives rather than reads:
    // `nbh = pktNbHops(pkt) + 1` is "one more hop than the packet has
    // travelled". It is the shape GET does not cover, and the receive events
    // are where it lives -- which is why it stayed invisible until something
    // was actually received.
    ARITH: ["MintRoute.receive_controlPkt", "MintRoute.receive_dataPkt"],
  },
  // Total from INITIALISATION (`netSeqNo := PKT x {0}`) in both projects, so
  // it is never guarded for domain membership and never anti-restricted. It is
  // written ONLY as `netSeqNo(pkt) := v`, the per-key spelling -- which this
  // catalog had no rule for, and said so.
  //
  // ⚠ That missing rule was not a harmless gap. With no PKT rule matching,
  // the write fell through to the app-layer catalog's generic function rule and
  // went into the MACHINE MAP (`netSeqNo[pkt] = lsno;`) while GET reads the
  // CHUNK (`pktOf(pkt)->getNetSeqNo()`) -- two storages for one variable, the
  // same silent shape as the 2026-09-08 `type(pkt)` defect. Measured: the
  // receiver read 0 for every packet, so update_nbr's `delta >= 0` was false on
  // all 248 attempts and MintRoute's freshness test could never pass. SET_KEY
  // closes it; the now-dead machine map is removed by stripDeadPacketFieldMaps.
  netSeqNo: {
    GET: ["MintRoute.update_nbr", "RTMCS.add_bwdRouteEntry"],
    SET_KEY: ["MintRoute.start_tx_bconPkt", "RTMCS.start_tx_rrep"],
  },
  // MintRoute-only: the channel's own destination-address bookkeeping.
  // DOM (∈): find_neighbours' own read-back guard (same event GET already
  // cites). DOM_NOT (∉): send_down's precondition before it first stages
  // vPktDestAddr for the outgoing copy.
  vPktDestAddr: {
    GET: ["MintRoute.find_neighbours"],
    SET: ["MintRoute.send_down"],
    DOM: ["MintRoute.find_neighbours"],
    DOM_NOT: ["MintRoute.send_down"],
  },
  pktDestAddr: {
    GET: ["MintRoute.send_down"],
    SET: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DOM: ["MintRoute.send_down"],
    DOM_NOT: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DEL: ["MintRoute.send_down"],
  },
  // RTMCS-only: its analogue of MintRoute's pktDestAddr/vPktDestAddr pair,
  // plus the RREQ/RREP/RRER-specific fields.
  // DOM (∈): send_up's own read-back guard (same event GET already cites).
  // DOM_NOT (∉): send_down's precondition before it stages vPktData.
  vPktData: {
    GET: ["RTMCS.send_up"],
    SET: ["RTMCS.send_down"],
    DOM: ["RTMCS.send_up"],
    DOM_NOT: ["RTMCS.send_down"],
    DEL: ["RTMCS.send_up"],
  },
  netDestAddr: {
    GET: ["RTMCS.send_down"],
    SET: ["RTMCS.create_rreq", "RTMCS.create_rrep"],
    DOM: ["RTMCS.send_down"],
    DOM_NOT: ["RTMCS.create_rreq", "RTMCS.create_rrep"],
    DEL: ["RTMCS.clear_pkt"],
  },
  // No DOM (∈) rule: envDestAddr is guarded `∉ dom(...)` exactly once in the
  // whole corpus (send_down, its own creation site) and never `∈` anywhere --
  // there is no genuine `∈ dom(envDestAddr)` clause anywhere to be evidence
  // for, so (per this catalog's own "no fabricated evidence" rule) no such
  // rule is generated.
  envDestAddr: {
    SET: ["RTMCS.send_down"],
    DOM_NOT: ["RTMCS.send_down"],
  },
  // Same shape as envDestAddr: pktErrND is guarded `∉` exactly once, at its
  // own creation site (create_rrer), and `∈` never.
  pktErrND: {
    SET: ["RTMCS.create_rrer"],
    DOM_NOT: ["RTMCS.create_rrer"],
  },
};

// Once ENC7 has put an attribute on the chunk, every operation on it changes:
// the map is gone, so `f(k)` is a getter and `f := f (+) {k|->v}` is a setter.
// `k in dom(f)` is a THIRD case, and it splits in two (see PKT-DOM / PKT-DOM-NOT
// below): `k ∈ dom(f)` is vacuously true (a chunk always has all its fields),
// but `k ∉ dom(f)` asks whether the packet/chunk itself exists at all -- info
// ENC7 does not carry -- and is not translatable. Collapsing both to `true`
// (the bug fixed 2026-09-06, task-6-report.md) silently discarded the "packet
// does not exist yet" precondition of the creating events.
export function packetRules(fields: PacketField[]): NetRule[] {
  const out: NetRule[] = [];
  for (const f of fields) {
    const F = esc(f.ebName);
    // Accessor names on the emitted chunk, reachable now that the identity
    // binding gives the generated code a PPkt to call them on.
    const G = getterOf(f), S = setterOf(f);
    const ev = EVIDENCE[f.ebName] ?? {};

    // `y = F(p)`: reads back the chunk field of "the packet identified by
    // p". Correct ONLY where `p` is bound to a live PPkt* in scope. Every
    // guarded-bool-method event mirror declares its Event-B PKT-domain
    // parameters as scalar `PktId` (wsn-codegen's own generic parameter
    // typing, `ALIAS.PKT = "PktId"` in codeEmitter.ts -- off-limits, and
    // applied uniformly with no per-field exception), so `p` is never a
    // pointer at any evidenced call site (task-7 finding: emitting
    // `p->getX()` here does not compile -- `p` is `int`). There is no
    // PktId -> PPkt* registry anywhere in the generated module (the
    // project's own documented "identity binding" gap), so this clause is
    // genuinely not translatable yet -- same "intercept ahead of the
    // generic rule, emit ''" technique as PKT-DOM-NOT below (the generic
    // app-layer FN1 rule would otherwise emit a map lookup against a member
    // ENC7 no longer maintains).
    if (ev.GET) out.push({
      id: `PKT-GET-${f.ebName}`, tier: 1, evidence: ev.GET,
      match: re(new RegExp(`^(?<y>\\w+)\\s*=\\s*${F}\\(\\s*(?<p>\\w+)\\s*\\)$`)),
      emit: (m) => `${m.captures.y} == pktOf(${m.captures.p})->${G}()`,
    });
    // `y = ran({p} ◁ F)`: GET's read, written as a relational image. The two
    // are the same clause -- `F[{p}] = ran({p} ◁ F)`, and for a function that
    // singleton carries exactly `F(p)` -- so they must reach the same storage,
    // and under ENC7 that is the chunk.
    //
    // ⚠ The SCHEDULER already binds this form off the chunk (`des = pktOf(pkt)
    // ->getFinalDestAddr()`). Without this rule the guard went to the machine
    // map instead, so the binding and the guard read two different storages for
    // one name and the event declined on a value it had just computed itself.
    //
    // `≠ nullptr` rather than a domain check: for a TOTAL function the domain
    // is all of PKT by axiom, so what the guard is really asking is whether
    // this module has a chunk for `p` at all -- the same question PKT-ARITH
    // asks, and the same one the scheduler's own `pktStore.count(p)` bail asks.
    if (ev.IMG) out.push({
      id: `PKT-IMG-${f.ebName}`, tier: 1, evidence: ev.IMG,
      match: re(new RegExp(
        `^(?<y>\\w+)\\s*=\\s*ran\\(\\s*\\{\\s*(?<p>\\w+)\\s*\\}\\s*◁\\s*${F}\\s*\\)$`)),
      emit: (m) => {
        const { y, p } = m.captures;
        return `(pktOf(${p}) != nullptr && ${y} == pktOf(${p})->${G}())`;
      },
    });
    // `y = F(p) ± n`: the same chunk read as GET, with arithmetic on it. Kept
    // separate from GET because it is a different clause shape, and because
    // the app-layer catalog already has a rule for it (scalarRules'
    // ARITH-FN-CMP) that emits a domain-checked lookup into the machine map
    // ENC7 no longer maintains -- correct-looking, always false. That is the
    // silent form of the failure: not a compile error, not an UNTRANSLATED
    // marker, just an event that never fires. Intercept ahead of it.
    if (ev.ARITH) out.push({
      id: `PKT-ARITH-${f.ebName}`, tier: 1, evidence: ev.ARITH,
      match: re(new RegExp(
        `^(?<y>\\w+)\\s*=\\s*${F}\\(\\s*(?<p>\\w+)\\s*\\)\\s*(?<op>\\+|−|-)\\s*(?<n>\\d+)$`)),
      emit: (m) => {
        const { y, p, op, n } = m.captures;
        return `(pktOf(${p}) != nullptr && ${y} == pktOf(${p})->${G}() ${op === "+" ? "+" : "-"} ${n})`;
      },
    });
    // Both write spellings the models use: relational override (U+E103 / U+2295
    // / U+22B4) and union with a maplet. No `u` flag: in unicode mode `\{` is an
    // invalid identity escape and the RegExp constructor throws. U+E103 is in
    // the BMP, so the plain `` escape reaches it without that flag.
    // `F ≔ F <+ {p↦v}` / `F ≔ F ∪ {p↦v}`: same scalar-`p` limitation as GET
    // just above -- `p` is never a pointer at any evidenced call site, so
    // this is not translatable yet either.
    if (ev.SET) out.push({
      id: `PKT-SET-${f.ebName}`, tier: 1, evidence: ev.SET,
      match: re(new RegExp(
        `^${F}\\s*≔\\s*${F}\\s*(?:[${OVERRIDE_OR_UNION_GLYPHS}]\\s*)?\\{\\s*(?<p>\\w+)\\s*↦\\s*(?<v>\\w+)\\s*\\}$`)),
      emit: (m) => `ensurePkt(${m.captures.p})->${S}(${m.captures.v}); pktLive.insert(${m.captures.p});`,
    });
    // `F(p) ≔ v` -- the PER-KEY spelling of the same write. A separate rule
    // because it is a separate clause shape, and the one the catalog was
    // missing: with nothing matching here the write fell through to the generic
    // function rule and landed in the machine map while every read went to the
    // chunk. `immutableFields` in mediumBinding.ts already had to learn this
    // same spelling for the same reason.
    //
    // pktLive only for a PARTIAL field: a total function's domain is all of
    // PKT, so writing one says nothing about whether the packet exists, and
    // marking it live here would assert something the model does not.
    if (ev.SET_KEY) out.push({
      id: `PKT-SET-KEY-${f.ebName}`, tier: 1, evidence: ev.SET_KEY,
      match: re(new RegExp(`^${F}\\s*\\(\\s*(?<p>\\w+)\\s*\\)\\s*≔\\s*(?<v>\\w+)$`)),
      emit: (m) => `ensurePkt(${m.captures.p})->${S}(${m.captures.v});`
        + (f.total ? "" : ` pktLive.insert(${m.captures.p});`),
    });
    // `x ∈ dom(F)`: for a TOTAL function (F.total, e.g. initialSrcAddr,
    // netSeqNo -- `PKT → ...`) this is vacuously true under ENC7, since a
    // chunk always carries all its fields. For a PARTIAL function
    // (`PKT ⇸ ...`, the shape most packet fields actually have --
    // pktSeqNo/pktSrc/pktFwdr/pktData/pktNbHops and friends, all initialised
    // to ∅) it is NOT vacuous: it is the real "has this attribute been set
    // yet" precondition (send_down's own read-back guard, right before the
    // field is wiped), and emitting `true` for it silently drops that
    // precondition -- the mirror image of the ∉ bug fixed below, and the
    // Important finding the 2026-09-06 final-review pass fixes. So DOM only
    // ever emits `true` for a total field; for a partial one it refuses the
    // clause exactly like PKT-DOM-NOT does (same "intercept ahead of the
    // generic app-layer DOM rule, emit ''" technique, same UNTRANSLATED
    // outcome). Matches ONLY the ∈ spelling (the non-capturing-group bug that
    // also matched ∉ here, silently emitting `true` for it too, was a
    // separate Critical finding, task-6-report.md).
    if (ev.DOM) out.push({
      id: `PKT-DOM-${f.ebName}`, tier: 1, evidence: ev.DOM,
      match: re(new RegExp(`^(?<p>\\w+)\\s*∈\\s*dom\\(\\s*${F}\\s*\\)$`)),
      // Now answerable for BOTH kinds of field, because the identity binding
      // gives the domain a home. A total field is carried by every chunk, so
      // membership is the chunk's own existence; a partial field's domain is
      // exactly the set of packets this node holds -- and that is what
      // pktStore is. One lookup answers both. Before the registry existed
      // there was nothing to look in, so a partial field had to be refused.
      emit: (m) => f.total ? "true" : `pktLive.count(${m.captures.p}) > 0`,
    });
    // `x ∉ dom(F)` is NOT translatable under ENC7: it asks whether the
    // packet/chunk exists at all, and once F's value lives on the chunk that
    // information is gone. Left unhandled, this clause would otherwise reach
    // the generic app-layer DOM rule (rules.ts id "DOM"), whose match() has
    // no operator restriction and would emit `${F}.count(x) == 0` -- a
    // std::map lookup against a member ENC7 never declares (the field is a
    // chunk getter/setter pair, not a map), which would not compile even if
    // it didn't also silently drop the precondition.
    //
    // So this rule exists purely to INTERCEPT the clause ahead of that
    // generic rule and refuse it explicitly: match() accepts it (so the
    // generic DOM rule never gets a turn -- composeRules puts every
    // PKT-* rule before the app-layer catalog), but emit() returns "" and
    // the engine (ruleEngine.ts translateEvent: `if (cpp) guards.push(cpp);
    // else untranslatedGuards.push(clause)`) treats a falsy emit exactly
    // like no rule matching at all: the clause becomes an
    // `// UNTRANSLATED GUARD` comment and the event refuses to fire. That is
    // the honest outcome -- silently reporting `true` here is the exact bug
    // this rule replaces.
    if (ev.DOM_NOT) out.push({
      id: `PKT-DOM-NOT-${f.ebName}`, tier: 1, evidence: ev.DOM_NOT,
      match: re(new RegExp(`^(?<p>\\w+)\\s*∉\\s*dom\\(\\s*${F}\\s*\\)$`)),
      // The freshness precondition of every creating event ("this packet does
      // not exist yet"), and the registry is precisely what makes it
      // answerable again.
      emit: (m) => f.total ? "false" : `pktLive.count(${m.captures.p}) == 0`,
    });
    // Domain anti-restriction on a chunk field: this node no longer holds the
    // packet's attributes. Under ENC7 the five attributes share one domain
    // (pktLive -- see the registry's own comment), so the erase is the same
    // erase whichever field names it, and repeating it per field is idempotent.
    //
    // This USED to emit a no-op comment ("the field travels with the packet"),
    // which was true only while nothing was ever transmitted. Once the medium
    // is bound, `{pkt} ⩤ pktSeqNo` in the transmit event is the model saying
    // the packet has left, and the delivery event's own `pkt ∉ dom(pktSeqNo)`
    // precondition is asked of a node that has since received it back. Emitting
    // nothing there left the packet permanently "held", so a node could never
    // accept the same packet twice and the duplicate-handling events could
    // never run.
    //
    // Imprecision worth stating rather than hiding: one event in the corpus
    // (RTMCS's clear_pkt) deletes a PROPER SUBSET of the family -- it never
    // touches pktSrc -- and ENC7 cannot represent a partly-defined packet, so
    // there the erase says slightly more than the model does. That collapse is
    // ENC7's, made when the family became one chunk; PKT-SET has the mirror
    // form of it (any field write marks the whole packet live).
    if (ev.DEL) out.push({
      id: `PKT-DEL-${f.ebName}`, tier: 3, evidence: ev.DEL,
      match: re(new RegExp(`^${F}\\s*≔\\s*\\{\\s*(?<p>\\w+)\\s*\\}\\s*⩤\\s*${F}$`)),
      emit: (m) => `pktLive.erase(${m.captures.p});`,
    });
    // `p ↦ v ∈ F` / `∉` -- a function's graph tested via maplet membership
    // (valid Event-B for a `PKT ⇸ T` variable, since a function IS its
    // graph; MintRoute's update_nbr/update_route test `pkt ↦ x ∈ pktFwdr`
    // this way, task-7 finding). The app-layer catalog's generic "PS1" rule
    // (rules.ts) matches ANY `a ↦ b ∈ R` clause unconditionally and emits a
    // pair-lookup `R.count({a, b})` regardless of R's actual resolved
    // encoding -- correct when R really is a pair-set (this project's own
    // relation fields, e.g. wsnLinks), wrong for a packet field, which is
    // function-encoded (`std::map<PktId, T>`) and, per the GET/SET rules
    // just above, not otherwise reachable from a bare PktId anyway. So this
    // rule exists purely to intercept the clause ahead of PS1 (composeRules
    // puts every PKT-* rule before the app-layer catalog) and refuse it
    // explicitly, same as PKT-DOM-NOT.
    //
    // ⚠ THE RATIONALE ABOVE IS STALE, AND IT IS ANSWERED NOW.
    // "Not otherwise reachable from a bare PktId" stopped being true when the
    // identity binding gave the module a pktStore: a function's graph contains
    // `p ↦ v` exactly when the packet is in the field's domain and the field
    // holds that value, and both halves are answerable -- `pktOf(p)` for the
    // chunk, `pktLive` for a partial field's domain, precisely as PKT-DOM and
    // PKT-GET do it. It is literally `p ∈ dom(F) ∧ F(p) = v`, i.e. this rule's
    // two neighbours conjoined, which is why it needs nothing they do not have.
    //
    // It was implemented on 2026-09-13 and reverted the same day on a scope
    // ruling: answering it translated eight RTMCS receive events that had been
    // refusing, and RTMCS has no simulation harness in this project, so `clang`
    // exit 0 was the only evidence available for a real behavioural change. It
    // is re-applied here with the pair-keyed work, which is the condition the
    // parked note set, and the evidence is a MintRoute run -- `update_nbr` and
    // `update_route` are the two events this guard was refusing, and they are
    // exactly the pair that DRAINS `updateNbrs`. Without this the pair-keyed
    // encoding schedules them and they still refuse, so the flood still fires
    // once. ⚠ RTMCS is still unrun; its eight events remain compile-only
    // evidence.
    if (ev.MEM) out.push({
      id: `PKT-MEM-${f.ebName}`, tier: 1, evidence: ev.MEM,
      match: re(new RegExp(
        `^(?<p>\\w+)\\s*↦\\s*(?<v>\\w+)\\s*(?<op>∈|∉)\\s*${F}$`)),
      emit: (m) => {
        const { p, v, op } = m.captures;
        // A total field rides on every chunk, so its domain is the chunk's own
        // existence; a partial one's domain is pktLive. Same split as PKT-DOM.
        // ⚠ pktLive and pktStore are deliberately separate (see the registry's
        // own comment), so a live packet is not automatically a chunk this node
        // holds -- the null check stays in both arms rather than being folded
        // into the total one.
        const dom = f.total ? "" : `pktLive.count(${p}) > 0 && `;
        const has = `(${dom}pktOf(${p}) != nullptr && pktOf(${p})->${G}() == ${v})`;
        return op === "∈" ? has : `!${has}`;
      },
    });
  }
  return out;
}

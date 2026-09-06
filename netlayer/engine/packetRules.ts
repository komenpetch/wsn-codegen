import type { Rule, RuleMatch } from "../../src/engine/rules";
import type { PacketField } from "./packetModel";

export interface NetRule extends Rule { tier: 1 | 2 | 3; evidence: string[]; supersedes?: string; }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
type Kind = "GET" | "SET" | "DOM" | "DOM_NOT" | "DEL" | "MEM";
const EVIDENCE: Record<string, Partial<Record<Kind, string[]>>> = {
  // Context-sourced: a fixed per-packet identity, never written or removed.
  initialSrcAddr: {
    GET: ["MintRoute.create_dataPkt", "RTMCS.create_dataPkt"],
    DOM: ["RTMCS.create_rrer"],
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
  },
  // Total from INITIALISATION (`netSeqNo := PKT x {0}`) in both projects, so
  // it is never guarded for domain membership, never chunk-set via the
  // union/override spelling (only ever `netSeqNo(pkt) := v`, a different
  // shape this catalog has no rule for), and never anti-restricted.
  netSeqNo: {
    GET: ["MintRoute.update_nbr", "RTMCS.add_bwdRouteEntry"],
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
    const G = `get${cap(f.name)}`, S = `set${cap(f.name)}`;
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
        `^${F}\\s*≔\\s*${F}\\s*(?:[\\uE103⊕⊴∪]\\s*)?\\{\\s*(?<p>\\w+)\\s*↦\\s*(?<v>\\w+)\\s*\\}$`)),
      emit: (m) => `ensurePkt(${m.captures.p})->${S}(${m.captures.v});`,
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
      emit: (m) => `pktStore.count(${m.captures.p}) > 0`,
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
      emit: (m) => `pktStore.count(${m.captures.p}) == 0`,
    });
    // Domain anti-restriction on a chunk field is a no-op: the packet is being
    // discarded, and the field goes with it.
    if (ev.DEL) out.push({
      id: `PKT-DEL-${f.ebName}`, tier: 3, evidence: ev.DEL,
      match: re(new RegExp(`^${F}\\s*≔\\s*\\{\\s*\\w+\\s*\\}\\s*⩤\\s*${F}$`)),
      emit: () => `/* packet discarded; field travels with it */`,
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
    if (ev.MEM) out.push({
      id: `PKT-MEM-${f.ebName}`, tier: 1, evidence: ev.MEM,
      match: re(new RegExp(`^\\w+\\s*↦\\s*\\w+\\s*(?:∈|∉)\\s*${F}$`)),
      emit: () => "",
    });
  }
  return out;
}

import { redeclareMembers } from "./emitted";
import type { EncodedMachine, GeneratedTree } from "./types";
import type { NetRule } from "./packetRules";
import type { RuleMatch } from "./rules";
import { esc, OVERRIDE_GLYPHS } from "./text";
import { alias } from "./nestedMap";

// PAIR-KEYED FUNCTIONS: a function whose DOMAIN is another variable, and that
// variable is a relation -- so the key is a MAPLET, not a scalar.
//
//     neighbourTbl ∈ ND ↔ ND          -- a relation: pairs of nodes
//     lastSeqno    ∈ neighbourTbl → ℕ  -- one number per PAIR
//
// The encoding resolver sees the arrow, calls it a function, and emits
// `std::map<int, int>` -- a key of the wrong arity. Nothing has caught that
// because every clause using one of these variables is currently UNTRANSLATED,
// which is exactly the "silently wrong declaration behind an unreachable code
// path" shape this project has been bitten by twice.
//
// ⚠ NOT the same as nestedMap.ts's two-level table, and they must not be
// merged. `nbHops ∈ ND ↔ (PKT ⇸ ℤ)` is a relation whose RANGE is a function --
// two separate lookups, an outer key and an inner one. This is a function whose
// DOMAIN is a set of pairs -- one lookup on a compound key. They take the same
// number of indices and are different Event-B types; collapsing them is how the
// 2026-09-13 drift happened, where one regex treated a parenthesised union as a
// nested map.
//
// WHY IT MATTERS (measured, 2026-09-13). This is the whole of PRouteTable's
// first encoding decision, and it is what caps the flood:
//
//   - 42 of MintRoute M4's 82 untranslated clauses mention one of these
//     variables, and 21 of RTMCS M6's 68. In RTMCS they ARE the route table
//     (`fwdNextND`/`fwdSeqNo`/`fwdHopCnt` over `fwdRouteTbl`).
//   - `add_newEntry` is the only writer of `neighbourTbl` besides the empty
//     initialisation, and it refuses to fire on these clauses -- so
//     `neighbourTbl` is permanently empty and every event guarding
//     `y ↦ x ∈ neighbourTbl` is dead.
//   - `update_nbr` and `update_route` are the only two events that REMOVE from
//     `updateNbrs`, which three receive events add to. With both refusing to
//     fire, `updateNbrs` is a work queue that never drains, and
//     `receive_controlPkt`'s `f ↦ nb ∉ updateNbrs` guard rejected 652 of 681
//     attempts in a 30 s run -- one accepted beacon per forwarder, for ever.
//
// INET's own MintRoute settles the semantics: `updateNbrCounters` keeps
// `neighborTbl[src].lastSeqno` and accepts when
// `seqNo - lastSeqno - 1 >= 0`, which is `update_nbr` clause for clause. The
// outer index is the node itself, so INET needs only the neighbour as a key;
// the model states both because its state space is the whole network.

// `f ∈ <relation variable> → T` (or ⇸).
const ARROWS = "→⇸";

export interface PairKeyedVar {
  name: string;
  domain: string;          // the relation variable the key ranges over
  keyA: string; keyB: string;
  value: string;
}

const re = (p: RegExp) => (expr: string): RuleMatch | null => {
  const g = p.exec(expr.trim());
  return g ? { captures: g.groups ?? {} } : null;
};

// The relation variables of the model: `R ∈ A ↔ B`, whose elements are pairs.
function relationVars(model: EncodedMachine): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>();
  for (const [name, inv] of model.variableTypes) {
    const m = new RegExp(`^\\s*${esc(name)}\\s*∈\\s*(\\w+|ℤ)\\s*↔\\s*(\\w+|ℤ)\\s*$`).exec(inv);
    if (m) out.set(name, [m[1], m[2]]);
  }
  return out;
}

export function pairKeyedVars(model: EncodedMachine): PairKeyedVar[] {
  const rels = relationVars(model);
  const out: PairKeyedVar[] = [];
  for (const [name, inv] of model.variableTypes) {
    const m = new RegExp(
      `^\\s*${esc(name)}\\s*∈\\s*(\\w+)\\s*[${ARROWS}]\\s*(\\w+|ℕ|ℤ)\\s*$`).exec(inv);
    if (!m) continue;
    const key = rels.get(m[1]);
    if (!key) continue;                    // domain is a carrier set: an ordinary function
    out.push({ name, domain: m[1], keyA: alias(key[0]), keyB: alias(key[1]), value: alias(m[2]) });
  }
  return out;
}

// Rewrite the emitted member declaration to the compound-key map. A post-emit
// pass for the same reason nestedMap's is: EncodingForm has no pair-keyed form
// to select, and the resolver is not this pipeline's to change.
export function fixPairKeyedDeclarations(tree: GeneratedTree, vars: PairKeyedVar[]): GeneratedTree {
  return redeclareMembers(tree, vars.map((v) => ({
    name: v.name,
    cppType: `std::map<std::pair<${v.keyA}, ${v.keyB}>, ${v.value}>`,
    note: `${v.name} ∈ ${v.domain} → … (key is a maplet)`,
  })));
}

// The rule forms, one family per variable. Every shape here is taken from a
// clause that exists in one of the two corpora -- see the evidence on each.
export function pairKeyedRules(vars: PairKeyedVar[], model: EncodedMachine): NetRule[] {
  const out: NetRule[] = [];
  const NUM = "(?:−|-)?\\d+";
  const num = (s: string) => s.replace(/−/g, "-");
  const op = (o: string) => (o === "≥" ? ">=" : o === "≤" ? "<=" : o === "−" ? "-" : o);

  for (const v of vars) {
    const N = esc(v.name);
    // Which events actually exercise this variable, read off the model rather
    // than listed -- the catalog's evidence discipline, without a name table
    // that would go stale.
    const evidence = model.events
      .filter((e) => [...e.guards, ...e.actions].some((c) => new RegExp(`\\b${N}\\b`).test(c)))
      .map((e) => e.label).filter((l) => l !== "INITIALISATION").slice(0, 3);
    if (evidence.length === 0) continue;

    const key = (a: string, b: string) => `{${a}, ${b}}`;
    const has = (a: string, b: string) => `${v.name}.count(${key(a, b)}) > 0`;
    const at = (a: string, b: string) => `${v.name}.at(${key(a, b)})`;

    // ── guards ────────────────────────────────────────────────────────────
    // `y ↦ x ↦ v ∈/∉ f` -- membership of a maplet in the function's GRAPH.
    // A function is its graph in Event-B, so this asks both that the key is
    // present and that it maps to this value.
    out.push({
      id: `PK-MEM-${v.name}`, tier: 2, evidence,
      match: re(new RegExp(
        `^(?<a>\\w+)\\s*↦\\s*(?<b>\\w+)\\s*↦\\s*(?<val>\\w+)\\s*(?<neg>∈|∉)\\s*${N}$`)),
      emit: (m) => {
        const { a, b, val, neg } = m.captures;
        const t = `(${has(a, b)} && ${at(a, b)} == ${val})`;
        return neg === "∈" ? t : `!${t}`;
      },
    });
    // `y ↦ x ∈/∉ dom(f)`
    out.push({
      id: `PK-DOM-${v.name}`, tier: 2, evidence,
      match: re(new RegExp(
        `^(?<a>\\w+)\\s*↦\\s*(?<b>\\w+)\\s*(?<neg>∈|∉)\\s*dom\\s*\\(\\s*${N}\\s*\\)$`)),
      emit: (m) => {
        const { a, b, neg } = m.captures;
        return neg === "∈" ? has(a, b) : `${v.name}.count(${key(a, b)}) == 0`;
      },
    });
    // `r = f(y ↦ x)` -- binding a parameter to the stored value. Domain-checked,
    // because an Event-B guard is an unordered conjunction and the `∈ dom(f)`
    // that licenses the read may be written after it.
    out.push({
      id: `PK-GET-${v.name}`, tier: 2, evidence,
      match: re(new RegExp(
        `^(?<r>\\w+)\\s*=\\s*${N}\\s*\\(\\s*(?<a>\\w+)\\s*↦\\s*(?<b>\\w+)\\s*\\)$`)),
      emit: (m) => {
        const { r, a, b } = m.captures;
        return `(${has(a, b)} && ${r} == ${at(a, b)})`;
      },
    });
    // `f(y ↦ x) <cmp> n`
    out.push({
      id: `PK-CMP-${v.name}`, tier: 2, evidence,
      match: re(new RegExp(
        `^${N}\\s*\\(\\s*(?<a>\\w+)\\s*↦\\s*(?<b>\\w+)\\s*\\)\\s*(?<o>≥|≤|>|<)\\s*(?<n>${NUM})$`)),
      emit: (m) => {
        const { a, b, o, n } = m.captures;
        return `(${has(a, b)} && ${at(a, b)} ${op(o)} ${num(n)})`;
      },
    });
    // `d = q − f(y ↦ x) − n` -- MintRoute's freshness test, which is INET
    // MintRoute's `sDelta = seqNo - nbr.lastSeqno - 1` exactly.
    out.push({
      id: `PK-GET-ARITH-${v.name}`, tier: 2, evidence,
      match: re(new RegExp(
        `^(?<r>\\w+)\\s*=\\s*(?<q>\\w+)\\s*(?<o1>−|-|\\+)\\s*${N}\\s*\\(\\s*(?<a>\\w+)\\s*↦\\s*(?<b>\\w+)\\s*\\)\\s*(?<o2>−|-|\\+)\\s*(?<n>\\d+)$`)),
      emit: (m) => {
        const { r, q, o1, a, b, o2, n } = m.captures;
        return `(${has(a, b)} && ${r} == ${q} ${op(o1)} ${at(a, b)} ${op(o2)} ${n})`;
      },
    });

    // ── actions ───────────────────────────────────────────────────────────
    // `f ≔ f ∪ {y ↦ x ↦ v}` (graph union: the guard has already asserted the
    // key is absent) and `f ≔ f ⊕ {y ↦ x ↦ v}` (override). Both are one
    // assignment on a compound key.
    out.push({
      id: `PK-PUT-${v.name}`, tier: 2, evidence,
      match: re(new RegExp(
        `^${N}\\s*≔\\s*${N}\\s*[∪${OVERRIDE_GLYPHS}]\\s*\\{\\s*(?<a>\\w+)\\s*↦\\s*(?<b>\\w+)\\s*↦\\s*(?<val>\\w+|${NUM})\\s*\\}$`)),
      emit: (m) => `${v.name}[${key(m.captures.a, m.captures.b)}] = ${num(m.captures.val)};`,
    });
    // `f ≔ f ⊕ {y ↦ x ↦ (f(y ↦ x) + n)}` -- increment in place.
    out.push({
      id: `PK-PUT-INC-${v.name}`, tier: 2, evidence,
      match: re(new RegExp(
        `^${N}\\s*≔\\s*${N}\\s*[∪${OVERRIDE_GLYPHS}]\\s*\\{\\s*(?<a>\\w+)\\s*↦\\s*(?<b>\\w+)\\s*↦\\s*\\(\\s*${N}\\s*\\(\\s*\\k<a>\\s*↦\\s*\\k<b>\\s*\\)\\s*(?<o>\\+|−|-)\\s*(?<n>\\d+)\\s*\\)\\s*\\}$`)),
      emit: (m) => {
        const { a, b, o, n } = m.captures;
        return `${v.name}[${key(a, b)}] = ${at(a, b)} ${op(o)} ${n};`;
      },
    });
    // `f ≔ f ⊕ {y ↦ x ↦ (w − n)}` -- a value computed from a parameter.
    out.push({
      id: `PK-PUT-ARITH-${v.name}`, tier: 2, evidence,
      match: re(new RegExp(
        `^${N}\\s*≔\\s*${N}\\s*[∪${OVERRIDE_GLYPHS}]\\s*\\{\\s*(?<a>\\w+)\\s*↦\\s*(?<b>\\w+)\\s*↦\\s*\\(\\s*(?<w>\\w+)\\s*(?<o>\\+|−|-)\\s*(?<n>\\d+)\\s*\\)\\s*\\}$`)),
      emit: (m) => {
        const { a, b, w, o, n } = m.captures;
        return `${v.name}[${key(a, b)}] = ${w} ${op(o)} ${n};`;
      },
    });
    // `f(y ↦ x) ≔ v` -- per-key write.
    out.push({
      id: `PK-SET-${v.name}`, tier: 2, evidence,
      match: re(new RegExp(
        `^${N}\\s*\\(\\s*(?<a>\\w+)\\s*↦\\s*(?<b>\\w+)\\s*\\)\\s*≔\\s*(?<val>\\w+|${NUM})$`)),
      emit: (m) => `${v.name}[${key(m.captures.a, m.captures.b)}] = ${num(m.captures.val)};`,
    });
    // `f(y ↦ x) ≔ g(x ↦ y)` -- copy from another pair-keyed function, with the
    // key components in the OTHER order. `.at` is safe here: this is an action,
    // so every guard (including the `∈ dom(g)` this event states) has passed.
    out.push({
      id: `PK-SET-FROM-${v.name}`, tier: 2, evidence,
      match: re(new RegExp(
        `^${N}\\s*\\(\\s*(?<a>\\w+)\\s*↦\\s*(?<b>\\w+)\\s*\\)\\s*≔\\s*(?<g>\\w+)\\s*\\(\\s*(?<c>\\w+)\\s*↦\\s*(?<d>\\w+)\\s*\\)$`)),
      emit: (m) => {
        const { a, b, g, c, d } = m.captures;
        return `${v.name}[${key(a, b)}] = ${g}.at(${key(c, d)});`;
      },
    });
  }
  return out;
}

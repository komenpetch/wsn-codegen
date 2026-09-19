import type { EncodingForm } from "./types";

export interface RuleMatch { captures: Record<string, string> }
export interface Rule {
  id: string;
  match: (expr: string) => RuleMatch | null;
  emit: (m: RuleMatch, enc: (id: string) => EncodingForm | undefined) => string;
}

const re = (p: RegExp) => (expr: string): RuleMatch | null => {
  const g = p.exec(expr.trim());
  return g ? { captures: g.groups ?? {} } : null;
};
const c = (m: RuleMatch) => m.captures;

// Ordered MOST-SPECIFIC-FIRST. The rule engine takes the first match per clause.
// Brace interiors allow optional whitespace (\s*) because the raw Event-B
// assignments carry irregular spacing, e.g. `sentUp ≔ sentUp ∪ {x↦ pkt  }`.
export const RULES: Rule[] = [
  // ── CMP2 total-function init: f ≔ (A ∖ B) × {const}  (incl. const = ∅) ──
  { id: "CMP2", match: re(/^(?<f>\w+)\s*≔\s*\(\s*(?<A>\w+)\s*∖\s*(?<B>\w+)\s*\)\s*×\s*\{\s*(?<v>∅|\w+)\s*\}$/),
    emit: (m) => {
      const { f, A, B, v } = c(m);
      const val = v === "∅" ? "{}" : v;
      return `for (int _n : ${A}) if (${B}.count(_n) == 0) ${f}[_n] = ${val};`;
    } },

  // ── reset to empty: X ≔ ∅  (FN5/SET5/PS7/MS8) ──
  { id: "CLEAR", match: re(/^(?<X>\w+)\s*≔\s*∅$/),
    emit: (m) => `${c(m).X}.clear();` },

  // ── MS7 product join: M ≔ M ∪ ({k} × s) ──
  { id: "MS7", match: re(/^(?<M>\w+)\s*≔\s*\k<M>\s*∪\s*\(\s*\{\s*(?<k>\w+)\s*\}\s*×\s*(?<s>\w+)\s*\)$/),
    emit: (m) => { const { M, k, s } = c(m); return `for (auto _v : ${s}) ${M}[${k}].insert(_v);`; } },

  // ── MS2 per-key set insert: f(k) ≔ f(k) ∪ {x} ──
  { id: "MS2", match: re(/^(?<f>\w+)\(\s*(?<k>\w+)\s*\)\s*≔\s*\k<f>\(\s*\k<k>\s*\)\s*∪\s*\{\s*(?<x>\w+)\s*\}$/),
    emit: (m) => { const { f, k, x } = c(m); return `${f}[${k}].insert(${x});`; } },

  // ── MS3 per-key set remove: f(k) ≔ f(k) ∖ {x} ──
  { id: "MS3-fn", match: re(/^(?<f>\w+)\(\s*(?<k>\w+)\s*\)\s*≔\s*\k<f>\(\s*\k<k>\s*\)\s*∖\s*\{\s*(?<x>\w+)\s*\}$/),
    emit: (m) => { const { f, k, x } = c(m);
      return `${f}[${k}].erase(${x}); if (${f}[${k}].empty()) ${f}.erase(${k});`; } },

  // ── FN3 function set-update: f(k) ≔ v ──
  { id: "FN3-app", match: re(/^(?<f>\w+)\(\s*(?<k>\w+)\s*\)\s*≔\s*(?<v>\w+)$/),
    emit: (m) => { const { f, k, v } = c(m); return `${f}[${k}] = ${v};`; } },

  // ── FN3 relational override: f ≔ f  {k↦v}.
  // THREE SPELLINGS OCCUR IN REAL PROJECTS and all must be accepted:
  //   U+E103   Rodin's private-use codepoint. It renders as nothing outside Rodin,
  //            so it also survives as a bare space in copied text.
  //   U+2295 ⊕ what a plain Rodin export of this project's own pM1 contains. Found
  //            2026-08-10 by generating from the pristine export and getting one
  //            more UNTRANSLATED than from the working copy.
  //   U+22B4 ⊴ a legacy spelling.
  // Missing a spelling does not fail loudly: the action goes untranslated and the
  // event refuses to fire, which reads as a gap in the MODEL, not in the parser. ──
  { id: "FN3-override", match: re(/^(?<f>\w+)\s*≔\s*\k<f>\s*(?:[⊴⊕]\s*)?\{\s*(?<k>\w+)\s*↦\s*(?<v>\w+)\s*\}$/),
    emit: (m) => { const { f, k, v } = c(m); return `${f}[${k}] = ${v};`; } },

  // ── ∪ {a↦b}: pair-set insert (PS2), function-extend (FN3), or map-of-sets
  //    per-key insert (MS2's pair spelling) — dispatched by enc ──
  { id: "UNION-pair", match: re(/^(?<R>\w+)\s*≔\s*\k<R>\s*∪\s*\{\s*(?<a>\w+)\s*↦\s*(?<b>\w+)\s*\}$/),
    emit: (m, enc) => { const { R, a, b } = c(m);
      if (enc(R) === "function") return `${R}[${a}] = ${b};`;
      if (enc(R) === "map-of-sets") return `${R}[${a}].insert(${b});`;
      return `${R}.insert({${a}, ${b}});`; } },

  // ── ∖ {a↦b}: pair-set erase (PS3), map-of-sets per-key remove (MS3), or
  //    function-shrink (FN4, the mirror of the union case above) — dispatched by
  //    enc. A function is a map keyed by `a`, so removing the maplet means
  //    erasing key `a` — but only when it currently maps to `b`, since
  //    Event-B set-minus removes nothing if the pair is absent. Without this
  //    case a function fell through to `R.erase({a, b})`, which does not
  //    compile against std::map.
  { id: "DIFF-pair", match: re(/^(?<R>\w+)\s*≔\s*\k<R>\s*∖\s*\{\s*(?<a>\w+)\s*↦\s*(?<b>\w+)\s*\}$/),
    emit: (m, enc) => { const { R, a, b } = c(m);
      if (enc(R) === "map-of-sets")
        return `${R}[${a}].erase(${b}); if (${R}[${a}].empty()) ${R}.erase(${a});`;
      if (enc(R) === "function")
        return `if (auto it = ${R}.find(${a}); it != ${R}.end() && it->second == ${b}) ${R}.erase(it);`;
      return `${R}.erase({${a}, ${b}});`; } },

  // ── PS6 range subtraction: R ≔ R ⩥ {y} ──
  { id: "PS6", match: re(/^(?<R>\w+)\s*≔\s*\k<R>\s*⩥\s*\{\s*(?<y>\w+)\s*\}$/),
    emit: (m) => { const { R, y } = c(m);
      return `for (auto it = ${R}.begin(); it != ${R}.end(); ) ` +
             `it->second == ${y} ? it = ${R}.erase(it) : ++it;`; } },

  // ── SET2/SET3 singleton union/diff on a plain set ──
  { id: "SET2", match: re(/^(?<S>\w+)\s*≔\s*\k<S>\s*∪\s*\{\s*(?<x>\w+)\s*\}$/),
    emit: (m) => { const { S, x } = c(m); return `${S}.insert(${x});`; } },
  { id: "SET3", match: re(/^(?<S>\w+)\s*≔\s*\k<S>\s*∖\s*\{\s*(?<x>\w+)\s*\}$/),
    emit: (m) => { const { S, x } = c(m); return `${S}.erase(${x});`; } },

  // ── MS5 per-key emptiness: {k} ◁ M = ∅  /  ≠ ∅ ──
  { id: "MS5", match: re(/^\{\s*(?<k>\w+)\s*\}\s*◁\s*(?<M>\w+)\s*(?<op>=|≠)\s*∅$/),
    emit: (m) => { const { k, M, op } = c(m);
      return op === "=" ? `(${M}.count(${k}) == 0 || ${M}.at(${k}).empty())`
                        : `(${M}.count(${k}) > 0 && !${M}.at(${k}).empty())`; } },

  // ── MS6 range of key restriction (equality guard): d = ran({k} ◁ M) ──
  // ⚠ Domain-checked. `.at` THROWS on a missing key, and an Event-B guard is an
  // unordered CONJUNCTION -- `d = ran({k} ◁ M)` may be written before whatever
  // establishes `k ∈ dom(M)`, while the emitter turns guards into a SEQUENCE.
  // The 2026-09-07 round replaced FN1/FN1-cmp/FN1-SET1 with domain-checked
  // forms for exactly this reason and MS6 was missed; it stayed harmless only
  // while nothing reached it, then surfaced as `std::out_of_range: map::at` at
  // event #19 the moment the CommPattern's creating event became schedulable.
  //
  // A key outside the domain makes this guard FALSE, not an exception:
  // `ran({k} ◁ M)` is `∅` there, and no scalar equals the empty set.
  { id: "MS6", match: re(/^(?<d>\w+)\s*=\s*ran\(\s*\{\s*(?<k>\w+)\s*\}\s*◁\s*(?<M>\w+)\s*\)$/),
    emit: (m) => { const { d, k, M } = c(m);
      return `(${M}.count(${k}) > 0 && ${d} == ${M}.at(${k}))`; } },

  // ── MS1 per-key membership: x ∈ M(k) / ∉  (map-of-sets; M is not dom/ran) ──
  { id: "MS1", match: re(/^(?<x>\w+)\s*(?<op>∈|∉)\s*(?!dom\(|ran\()(?<M>\w+)\(\s*(?<k>\w+)\s*\)$/),
    emit: (m) => { const { x, op, M, k } = c(m);
      return op === "∈" ? `(${M}.count(${k}) > 0 && ${M}.at(${k}).count(${x}) > 0)`
                        : `(${M}.count(${k}) == 0 || ${M}.at(${k}).count(${x}) == 0)`; } },

  // ── membership of a function application: f(k) ∈ S / ∉  (FN1 ∘ SET1),
  //    e.g. type(pkt) ∈ CONTROL ──
  { id: "FN1-SET1", match: re(/^(?<f>\w+)\(\s*(?<k>\w+)\s*\)\s*(?<op>∈|∉)\s*(?<S>\w+)$/),
    emit: (m) => { const { f, k, op, S } = c(m);
      return `${S}.count(${f}.at(${k})) ${op === "∈" ? "> 0" : "== 0"}`; } },

  // ── pair membership: a↦b ∈ R / ∉  (PS1) ──
  { id: "PS1", match: re(/^(?<a>\w+)\s*↦\s*(?<b>\w+)\s*(?<op>∈|∉)\s*(?<R>\w+)$/),
    emit: (m) => { const { a, b, op, R } = c(m);
      return `${R}.count({${a}, ${b}}) ${op === "∈" ? "> 0" : "== 0"}`; } },

  // ── domain membership: x ∈ dom(R) / ∉  (PS4 pair-set scan; FN2 function count;
  //    MS4 map-of-sets count — the last two share the emitted form) ──
  { id: "DOM", match: re(/^(?<x>\w+)\s*(?<op>∈|∉)\s*dom\(\s*(?<R>\w+)\s*\)$/),
    emit: (m, enc) => { const { x, op, R } = c(m);
      if (enc(R) === "pair-set") return op === "∈" ? `inDom(${R}, ${x})` : `!inDom(${R}, ${x})`;
      return `${R}.count(${x}) ${op === "∈" ? "> 0" : "== 0"}`; } },

  // ── range membership: x ∈ ran(R) / ∉  (PS5 scan) ──
  { id: "RAN", match: re(/^(?<x>\w+)\s*(?<op>∈|∉)\s*ran\(\s*(?<R>\w+)\s*\)$/),
    emit: (m) => { const { x, op, R } = c(m);
      return op === "∈" ? `inRan(${R}, ${x})` : `!inRan(${R}, ${x})`; } },

  // ── CMP1 set-difference membership: x ∈ A ∖ B ──
  { id: "CMP1", match: re(/^(?<x>\w+)\s*∈\s*(?<A>\w+)\s*∖\s*(?<B>\w+)$/),
    emit: (m) => { const { x, A, B } = c(m); return `(${A}.count(${x}) > 0 && ${B}.count(${x}) == 0)`; } },

  // ── FN1 application in an equality guard: y = f(x) ──
  { id: "FN1", match: re(/^(?<y>\w+)\s*=\s*(?<f>\w+)\(\s*(?<x>\w+)\s*\)$/),
    emit: (m) => { const { y, f, x } = c(m); return `${y} == ${f}.at(${x})`; } },

  // ── function-value equality guard: f(k) = v ──
  { id: "FN1-cmp", match: re(/^(?<f>\w+)\(\s*(?<k>\w+)\s*\)\s*=\s*(?<v>\w+)$/),
    emit: (m) => { const { f, k, v } = c(m); return `${f}.at(${k}) == ${v}`; } },

  // ── emptiness: S = ∅ / ≠ ∅  (SET4) ──
  { id: "SET4", match: re(/^(?<S>\w+)\s*(?<op>=|≠)\s*∅$/),
    emit: (m) => { const { S, op } = c(m); return `${op === "≠" ? "!" : ""}${S}.empty()`; } },

  // ── bare membership: x ∈ S / ∉  (SET1) ──
  { id: "SET1", match: re(/^(?<x>\w+)\s*(?<op>∈|∉)\s*(?<S>\w+)$/),
    emit: (m) => { const { x, op, S } = c(m); return `${S}.count(${x}) ${op === "∈" ? "> 0" : "== 0"}`; } },

  // ── scalar equality guard: a = b  (e.g. data = CTL_VAL) ──
  { id: "EQ", match: re(/^(?<a>\w+)\s*=\s*(?<b>\w+)$/),
    emit: (m) => { const { a, b } = c(m); return `${a} == ${b}`; } },
];

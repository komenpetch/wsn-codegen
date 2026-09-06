// Non-packet compile-blockers found by task 7's compile gate (task-7-report.md)
// that don't fit packetRules.ts's per-packet-field shape. Kept separate so
// packetRules.ts stays about PPkt specifically.
import type { Rule, RuleMatch } from "../../src/engine/rules";
import type { NetRule } from "./packetRules";

const re = (p: RegExp) => (expr: string): RuleMatch | null => {
  const g = p.exec(expr.trim());
  return g ? { captures: g.groups ?? {} } : null;
};

// MintRoute M3 declares `neighbourTbl ∈ ND ↔ ND` (resolved "map-of-sets": it
// is genuinely per-key-accessed elsewhere, e.g. `ran({nd} ◁ neighbourTbl)`)
// and `estNbrs ⊆ neighbourTbl` (resolved "pair-set" once aliasEncoding.ts
// dereferences that subset-of-a-relation invariant -- estNbrs itself is
// never per-key-accessed, only ever touched via maplet membership: `nd ↦ nb
// ∈/∉ estNbrs`, `estNbrs ∪ {nd ↦ nb}`). Both resolutions are individually
// correct for how EACH variable is used elsewhere -- but update_est /
// update_est_nothing / bcastRou_due (which extends reset_estTimer) also
// compare the two directly for equality (`estNbrs = neighbourTbl` / `≠`),
// and the generic app-layer "EQ" rule (rules.ts, off-limits) emits a bare
// `estNbrs == neighbourTbl` with no awareness that a `std::set<pair<int,
// int>>` and a `std::map<int, std::set<int>>` cannot compare (task-7
// finding). There is no single C++ container shape that is simultaneously
// right for both variables' OTHER usages, so translating this equality
// correctly would need conversion code neither this catalog nor the
// app-layer's generates -- refuse it explicitly (match but emit "", the
// same "intercept ahead of the generic rule" technique packetRules.ts uses
// for PKT-DOM-NOT/PKT-GET/PKT-SET/PKT-MEM) rather than let EQ produce
// something that does not compile.
// rules.ts's "PS1" (`a ↦ b ∈ R` / `∉`, app-layer, off-limits) is
// unconditional: it never looks at `enc(R)` and always emits a pair-lookup
// `R.count({a, b})`, which is only actually correct when R is genuinely
// pair-set-encoded. MintRoute M3's `neighbourTbl ∈ ND ↔ ND` is resolved
// "map-of-sets" instead (correctly -- it is genuinely per-key-accessed
// elsewhere, `ran({nd} ◁ neighbourTbl)`), so `y ↦ x ∈ neighbourTbl`
// (add_newEntry / update_nbr / update_route) does not compile against the
// `std::map<Node, std::set<Node>>` PS1 assumes is a pair-set (task-7
// finding; the same root cause packetRules.ts's PKT-MEM rule already works
// around for the function-encoded packet field pktFwdr -- see its comment).
// Rather than add another per-variable interceptor for every non-packet
// relation this affects, supersede PS1 itself with an encoding-aware
// version: pair-set keeps PS1's own behaviour; map-of-sets dispatches like
// the app-layer's own "MS1" rule (same shape, `R.count(a) > 0 &&
// R.at(a).count(b) > 0`); function dispatches as graph membership
// (`R.count(a) > 0 && R.at(a) == b`) -- relevant if some OTHER project's
// maplet-membership clause reaches a function-encoded variable that no
// PKT-* rule already intercepted. Nothing here changes wsnLinks/crashedLinks
// (pair-set, PS1's original branch, unaffected) or pktFwdr (PKT-MEM matches
// first -- see compose.ts's "first match wins" ordering -- so this rule
// never gets a turn for it).
const PS1_REPLACEMENT: Rule = {
  id: "PS1",
  match: re(/^(?<a>\w+)\s*↦\s*(?<b>\w+)\s*(?<op>∈|∉)\s*(?<R>\w+)$/),
  emit: (m, enc) => {
    const { a, b, op, R } = m.captures;
    const hit = op === "∈";
    if (enc(R) === "map-of-sets")
      return hit
        ? `(${R}.count(${a}) > 0 && ${R}.at(${a}).count(${b}) > 0)`
        : `(${R}.count(${a}) == 0 || ${R}.at(${a}).count(${b}) == 0)`;
    if (enc(R) === "function")
      return hit
        ? `(${R}.count(${a}) > 0 && ${R}.at(${a}) == ${b})`
        : `(${R}.count(${a}) == 0 || ${R}.at(${a}) != ${b})`;
    return `${R}.count({${a}, ${b}}) ${hit ? "> 0" : "== 0"}`;
  },
};

export function miscRules(): NetRule[] {
  return [
    {
      id: "MISC-ESTNBRS-NEIGHBOURTBL-EQ",
      tier: 1,
      evidence: ["MintRoute.update_est", "MintRoute.update_est_nothing", "MintRoute.bcastRou_due"],
      match: re(/^estNbrs\s*(?:=|≠)\s*neighbourTbl$/),
      emit: () => "",
    },
    {
      id: "MISC-PS1-ENCODING-AWARE",
      tier: 1,
      supersedes: "PS1",
      evidence: ["MintRoute.add_newEntry", "MintRoute.update_nbr", "MintRoute.update_route"],
      match: PS1_REPLACEMENT.match,
      emit: PS1_REPLACEMENT.emit,
    },
  ];
}

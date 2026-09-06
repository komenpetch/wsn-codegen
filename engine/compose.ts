import { RULES } from "../../wsn-codegen/src/engine/rules";
import type { Rule } from "../../wsn-codegen/src/engine/rules";
import type { NetRule } from "./packetRules";

// The engine takes the FIRST matching rule, so order is behaviour. This
// function enforces exactly two things, both by throwing:
//   1. every net rule carries non-empty `evidence` (the events that exercise
//      it -- tests/packetRulesEvidence.test.ts checks these names against the
//      real corpora);
//   2. a rule that DOES declare `supersedes` names an id that actually exists
//      in the app-layer `RULES` catalog -- that rule then replaces the named
//      rule IN PLACE (same position in the list), the "explicit replacement"
//      form (e.g. miscRules.ts's MISC-PS1-ENCODING-AWARE ⊃ PS1).
//
// It does NOT detect undeclared shadowing. A rule that omits `supersedes`
// ("fresh") is simply prepended in front of the WHOLE app-layer catalog with
// no check of what it overlaps -- so it wins (first match) against ANY
// app-layer rule whose pattern happens to match the same clause, declared or
// not. That is not a gap to close here: several PKT-* rules in
// packetRules.ts rely on exactly this "intercept ahead of the generic rule"
// behaviour to refuse a clause the generic rule would otherwise mistranslate,
// deliberately staying "fresh" (no `supersedes`) so nothing here requires
// them to name what they shadow. Current relies, each documented at its own
// definition: PKT-DOM / PKT-DOM-NOT intercept app-layer "DOM" (`x ∈/∉
// dom(F)`); PKT-MEM intercepts "PS1" (`a ↦ b ∈/∉ R`) for packet fields the
// same way MISC-PS1-ENCODING-AWARE intercepts it for machine variables;
// PKT-GET intercepts "FN1" (`y = f(x)`). A real cross-check (walking both
// rule sets' match() patterns for overlap) is future work, not required here
// -- this comment's job is only to state what composeRules actually
// guarantees, not to promise a check the code does not perform.
export function composeRules(net: NetRule[]): Rule[] {
  for (const r of net) {
    if (r.evidence.length === 0)
      throw new Error(`Rule ${r.id} has no evidence. Every rule names the events that exercise it.`);
    if (r.supersedes && !RULES.some((b) => b.id === r.supersedes))
      throw new Error(`Rule ${r.id} claims to supersede '${r.supersedes}', which is not in the app-layer catalog.`);
  }
  const replacing = new Map(net.filter((r) => r.supersedes).map((r) => [r.supersedes!, r]));
  const fresh = net.filter((r) => !r.supersedes);
  const base = RULES.map((b) => replacing.get(b.id) ?? b);
  return [...fresh, ...base];
}

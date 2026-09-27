// Small text helpers shared across the engine, and the Rodin glyphs the rule
// layer matches on.
//
// Each of these had been written out separately in three to eight places. That
// is how `esc` came to be applied in one emitted-signature parser and forgotten
// in the other two, and it is the same shape of gap as the U+E103 one the
// 2026-07-05 audit found: a glyph handled in one matcher and missing from
// another, silently dropping actions.

// Escape a string for literal use inside a RegExp. Every identifier this engine
// interpolates into a pattern -- a variable name, a class name, a parameter
// list -- goes through here.
export const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// First letter upper, rest untouched: `seqNum` -> `SeqNum`. This is the one
// used to build C++ accessor names, where the tail's casing is significant.
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// First letter upper, rest LOWERED: `BEACON` -> `Beacon`. For turning a
// model's upper-case tag into a C++ method-name fragment
// (sendBeaconBroadcast). Distinct from `cap` and easy to confuse with it --
// `capTag(seqNum)` would give `Seqnum` -- so it is named for what it is for.
export const capTag = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

// Rodin's spellings of "replace these entries of a function".
//
// U+E103 is the one that matters: Rodin stores relational override as a
// PRIVATE-USE character, not as the ⊕ that appears in printed Event-B, and an
// earlier audit found it silently dropping `pktFwdr ≔ pktFwdr⊕{k↦v}` actions
// because one matcher did not list it.
export const OVERRIDE_GLYPHS = "⊕⊴";

// Override, plus union. An action that ADDS an entry (`f ≔ f ∪ {k↦v}`) and one
// that REPLACES it are the same shape for a matcher asking "which parameter is
// the key here", and different for one asking "does any event change this
// field". Both questions are asked in this engine, so both character classes
// exist -- named, rather than spelled out at each site, so choosing the wrong
// one is a visible choice.
export const OVERRIDE_OR_UNION_GLYPHS = OVERRIDE_GLYPHS + "∪";

// The carrier sets a model declares, unioned across any number of projects.
//
// v5 carries a packet pattern class from a DIFFERENT project than the module it
// generates, so "which names are carrier sets here" spans both. Written out by
// hand in three places before this, in two spellings.
//
// ⚠ This is what the CONTEXTS declare. It does NOT include a carrier introduced
// by an axiom instead of a `sets` entry -- `ND ⊆ ℕ` is exactly that, and it is a
// carrier every generated module uses. Callers that need ND add it themselves
// (scheduler.ts unions CARRIER_ALIAS's keys for this reason).
export const carrierSetsOf = (...contextOwners: { contexts: { sets: string[] }[] }[]): Set<string> =>
  new Set(contextOwners.flatMap((o) => o.contexts.flatMap((c) => c.sets)));

/**
 * Every set that lives inside `root`, to a FIXPOINT: `root` itself, plus
 * anything a `S ⊆ root` predicate places within it, plus anything inside that,
 * so `A ⊆ B ⊆ root` counts whatever order the predicates appear in.
 *
 * ⚠ TWO QUESTIONS ASK THIS AND THEY DIFFER IN BOTH ARGUMENTS, which is why it
 * takes them rather than hardcoding either. `nodeSetsOf` asks it of ND over the
 * CONTEXT axioms; `packetModel` asks it of PKT over the context axioms AND the
 * machine invariants -- because a subset of the packet carrier is typically a
 * VARIABLE (`xmittedPkts ⊆ PKT`), so its declaration is an invariant and a
 * context-only version cannot see it.
 */
/**
 * A context axiom or machine invariant written as a conjunction of
 * declarations, split into those declarations: `Sink ∈ ND ∧ Sink = 0` →
 * `Sink ∈ ND`, `Sink = 0`. The parser applies it, so every reader that matches
 * one declaration per axiom sees each one (2026-09-27: a conjunction axiom read
 * the WRONG routing and silently dropped its constant).
 *
 * ⚠ Returned WHOLE unless `∧` is the only connective at the top level. An `∧`
 * inside brackets of any kind belongs to what the brackets hold; and a top-level
 * quantifier, lambda or comprehension marker (`∀ ∃ λ · ∣`) takes the rest of the
 * predicate as its scope — MintRoute TCL.buc's `∀t·t∈wsnfn∧(…)⇒…` has its `∧`
 * at paren depth 0 inside one, and cutting there makes two false axioms. `⇒`,
 * `⇔` and `∨` bind looser than `∧`, and a top-level `¬` is left to its reader:
 * none of those is a conjunction of declarations.
 */
export function splitDeclaration(text: string): string[] {
  const cuts: number[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (depth === 0) {
      if ("∀∃λ·∣⇒⇔∨¬".includes(ch)) return [text];
      if (ch === "∧") cuts.push(i);
    }
  }
  if (cuts.length === 0) return [text];
  const parts: string[] = [];
  let start = 0;
  for (const c of cuts) { parts.push(text.slice(start, c)); start = c + 1; }
  parts.push(text.slice(start));
  const trimmed = parts.map((p) => p.trim());
  return trimmed.some((p) => p.length === 0) ? [text] : trimmed;
}

export function subsetClosure(root: string, predicates: readonly string[]): Set<string> {
  const inside = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of predicates) {
      const m = /^(\w+)\s*⊆\s*(\w+)$/.exec(p.trim());
      if (m && inside.has(m[2]) && !inside.has(m[1])) { inside.add(m[1]); grew = true; }
    }
  }
  return inside;
}

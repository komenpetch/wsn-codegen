import type { EncodedMachine, FlatEvent, EncodingForm } from "./types";
import { RULES } from "./rules";

export function splitConjuncts(expr: string): string[] {
  const parts: string[] = []; let depth = 0, start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "∧" && depth === 0) { parts.push(expr.slice(start, i)); start = i + 1; }
  }
  parts.push(expr.slice(start));
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

const BUILTIN_TYPES = new Set(["ℕ", "ℕ1", "ℤ", "BOOL", "𝔹", "PKT", "ND"]);

/**
 * Is this clause a TYPE declaration — carrying no information beyond saying
 * what sort of thing the parameter is — so that dropping it loses nothing?
 *
 * ⚠ A DROPPED GUARD IS SILENT. It never reaches `// UNTRANSLATED`, so an event
 * whose precondition is weakened this way looks fully translated and fires in
 * states the model forbids. That is what happened to `dest_recv_pkt`:
 *
 *     when nb ∈ Dests          (the pattern's own destination test)
 *
 * `Dests` is a context name, so it counted as a type and the clause vanished.
 * Measured consequence: with `Dests` EMPTY — where `nb ∈ Dests` is
 * unsatisfiable and the event must fire ZERO times — `dest_recv_pkt` fired 2 on
 * sensor1, and with `Dests = {sink}` a NON-destination (sensor4) fired it too.
 * Non-destinations were consuming packets. It stayed invisible because
 * `fwdr_receive_pkt` holds the complementary guard `nb ∉ Dests` (which survives,
 * `∉` not being matched here) and wins the race for `recvBuff`; the hole only
 * shows when fwdr is blocked for some other reason.
 *
 * ── The discriminator is in the AXIOMS, not in a name list ──
 *
 * A context name is a TYPE when the context DEFINES it as one, and a SUBSET
 * when the context restricts it:
 *
 *     WSN = ND ↔ ND              definition  → `l ∈ WSN` is typing
 *     randomFn = minR‥maxR       definition  → left as typing (see below)
 *     Dests ⊆ ND                 SUBSET      → `nb ∈ Dests` is a restriction
 *     Destination ⊆ ND           SUBSET      → a restriction
 *     Actuators ⊆ Destination    SUBSET      → a restriction
 *
 * `subsets` carries exactly the `N ⊆ S` names, derived by the caller from the
 * context axioms. BUILTIN_TYPES still wins outright, so `PKT` and `ND` keep
 * their existing treatment and this cannot disturb them.
 *
 * ⚠ ONLY `∈`, NOT `⊆`, and that is deliberate rather than cautious. A `⊆`
 * clause on a parameter is how Event-B declares a SET-VALUED parameter's type,
 * and the corpus's only instance is exactly that (`nbs ⊆ ND` in
 * find_neighbours). Restoring it would gain nothing and, there being no `⊆`
 * rule, would turn that event into an untranslated one that refuses to fire.
 *
 * ⚠ AND THE SAME TRAP IS WHY THIS IS NARROW. Every clause this stops dropping
 * must have a rule, or it becomes `// UNTRANSLATED` and codeEmitter makes the
 * event REFUSE. Checked against the catalog before the change: the builtins
 * `p ∈ ℤ` / `p ∈ ℕ` have NO rule, so widening this to "anything that is not a
 * carrier set" would have switched off `create_rreq`, `add_bwdRouteEntry`,
 * `start_tx_rrep` and eleven more — the RREP path included.
 */
export function isTypingPredicate(
  expr: string,
  nonVars: Set<string>,
  subsets: ReadonlySet<string> = new Set(),
): boolean {
  const isType = (s: string) => nonVars.has(s) || BUILTIN_TYPES.has(s);
  // x ∈ T / x ⊆ T (bare RHS) — but NOT x ∈ A ∖ B (CMP1), whose RHS contains ∖.
  // \S+ (not \w+): the built-in carriers ℤ / ℕ / 𝔹 are outside \w.
  const m = /^\w+\s*([∈⊆])\s*(\S+)$/.exec(expr);
  if (m && m[1] === "∈" && subsets.has(m[2]) && !BUILTIN_TYPES.has(m[2])) return false;
  if (m && isType(m[2])) return true;
  // nbrs ∈ {n∣ n ∈ ℙ(ND)} — set-builder typing, drop.
  if (/^\w+\s*∈\s*\{.*∣.*\}$/.test(expr)) return true;
  return false;
}

function matchWhole(expr: string, enc: (id: string) => EncodingForm | undefined): string | null {
  for (const rule of RULES) { const hit = rule.match(expr); if (hit) return rule.emit(hit, enc); }
  return null;
}

export interface TranslatedEvent {
  label: string;
  parameters: string[];
  guards: string[];
  actions: string[];
  // Clauses no rule matched (typing guards excluded). The emitter surfaces
  // them as // UNTRANSLATED comments — a dropped guard would silently weaken
  // the event's precondition, a dropped action its effect.
  untranslatedGuards: string[];
  untranslatedActions: string[];
}

// Opt-in accounting for the benchmark only. The framework's step 2, Rule
// Mapping, is encoding resolution PLUS rule application, but rule application
// happens inside the emitter, which also does the assembly belonging to step 3.
// Measured on the case study, rule application is about 56 % of the emitter's
// time, so attributing all of it to step 3 misreports both steps by more than a
// factor of two. This counter lets the benchmark split them without the emitter
// having to know about timing. Off unless the benchmark turns it on, so the
// shipped tool pays nothing.
export const ruleClock = { on: false, ms: 0 };

export function translateEvent(
  ev: FlatEvent,
  model: EncodedMachine,
  // Context names declared `N ⊆ S` — see isTypingPredicate. Defaulted so the
  // existing unit tests, which have no contexts to read, keep their meaning.
  subsets: ReadonlySet<string> = new Set(),
): TranslatedEvent {
  if (ruleClock.on) {
    ruleClock.on = false;                       // avoid re-entry double counting
    const t = performance.now();
    try { return translateEvent(ev, model, subsets); }
    finally { ruleClock.ms += performance.now() - t; ruleClock.on = true; }
  }
  const enc = (id: string) => model.encodings.get(id);
  // Machine-only: any identifier that is neither a machine variable nor an
  // event parameter is a context name (ND, Dests, type, …) for typing-guard
  // detection. Parameters must NOT count as types: `x ∈ nbrs` with nbrs a
  // set-typed parameter is a semantic guard (SET1), not a typing predicate —
  // treating it as typing would drop it silently (RTMCS/MintRoute
  // assign_forwarder's `nb ∈ nbs` is a real instance).
  const params = new Set(ev.parameters);
  const nonVars = new Set<string>();
  for (const t of [...ev.guards, ...ev.actions])
    for (const tok of t.match(/[A-Za-z_]\w*/g) ?? [])
      if (!model.variables.includes(tok) && !params.has(tok)) nonVars.add(tok);

  const guards: string[] = [];
  const untranslatedGuards: string[] = [];
  for (const g of ev.guards)
    for (const clause of splitConjuncts(g)) {
      if (isTypingPredicate(clause, nonVars, subsets)) continue;
      const cpp = matchWhole(clause, enc);
      if (cpp) guards.push(cpp);
      else untranslatedGuards.push(clause);
    }
  const actions: string[] = [];
  const untranslatedActions: string[] = [];
  for (const a of ev.actions) {
    const cpp = matchWhole(a.trim(), enc);
    if (cpp) actions.push(cpp);
    else untranslatedActions.push(a.trim());
  }

  return { label: ev.label, parameters: ev.parameters, guards, actions, untranslatedGuards, untranslatedActions };
}

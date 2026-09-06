// wsn-codegen's encodingResolver (wsn-codegen/src/engine/encodingResolver.ts,
// off-limits to this project per a prior ruling) classifies a variable's
// encoding purely from the syntactic shape of its invariant's RHS type
// expression (the text after `∈` / `⊆`). It never dereferences a BARE NAME on
// that RHS -- and MintRoute has two different ways such a bare name shows up:
//
//  1. A context-level type ALIAS. C2 declares `@axm2_1 WSN = ND ↔ ND`, and M2
//     declares `wsnLinks ∈ WSN` / `crashedLinks ∈ WSN`. The RHS of that
//     invariant is just the bare identifier "WSN".
//  2. A subset-of-another-VARIABLE invariant. M3 declares
//     `neighbourTbl ∈ ND ↔ ND` (correctly resolved to "map-of-sets") and
//     `estNbrs ⊆ neighbourTbl` -- a subset of a relation's graph is itself
//     relation-shaped, but encodingResolver's `⊆` branch tests only whether
//     the LITERAL invariant text contains "⊆" at all, never what is on its
//     right, so it returns "set" unconditionally for any `X ⊆ <anything>`.
//
// Both cases fall through none of infer()'s pattern branches (→, ⇸, ↔, ⊆,
// ℙ() and silently hit the "set" default ("safe default for an un-typed
// subset variable"). Both wsnLinks/crashedLinks and estNbrs are actually
// relations, used with maplet syntax (`x ↦ y ∈ wsnLinks`, `nd ↦ nb ∈
// estNbrs`, `wsnLinks[{f}]`) in the events that touch them. Encoding them as
// a scalar `std::set<int>` produces a member the rule catalog's own
// pair-lookup code (`wsnLinks.count({x, y})`, correct for a genuine pair-set
// -- see rules.ts "PS1") cannot compile against.
//
// The textbook fix is in encodingResolver.ts (dereference the bare name
// before classifying), but that file is off-limits. This corrects the SAME
// cases from the outside: `shapeOf` dereferences a bare RHS name through
// EITHER a context alias (case 1) or another machine variable's own
// invariant (case 2, recursing at most one further level -- enough for both
// known cases, and a chain longer than that is intentionally left alone
// rather than chased blindly), and for every variable whose invariant names
// one of those bare (and which the resolver consequently defaulted to
// "set"), re-derives the encoding from the dereferenced shape. The
// classification logic below duplicates encodingResolver's
// infer()/usesKeyAccess() (neither is exported) -- kept in lockstep by hand;
// if wsn-codegen's version changes, this one needs the same change made here.
import type { EncodedMachine, EncodingForm, FlatMachine, RawModel } from "../../src/engine/types";

export function fixAliasedEncodings(raw: RawModel, model: EncodedMachine): void {
  const contextAliases = collectTypeAliases(raw);

  function shapeOf(name: string, seen: Set<string>): string | undefined {
    if (seen.has(name)) return undefined;   // guard against a reference cycle
    seen.add(name);
    if (contextAliases.has(name)) return contextAliases.get(name);
    const inv = model.variableTypes.get(name);
    if (inv === undefined) return undefined;   // not a context alias or a machine variable
    const rhs = inv.replace(/^[^∈⊆]*[∈⊆]\s*/, "").trim();
    return /^[A-Za-z_]\w*$/.test(rhs) ? shapeOf(rhs, seen) : rhs;
  }

  for (const [id, inv] of model.variableTypes) {
    const rhs = inv.replace(/^[^∈⊆]*[∈⊆]\s*/, "").trim();
    if (!/^[A-Za-z_]\w*$/.test(rhs)) continue;        // not a bare-name invariant at all
    if (model.encodings.get(id) !== "set") continue;   // only the silent-default case needs correcting
    const shape = shapeOf(rhs, new Set([id]));
    if (shape === undefined) continue;                 // rhs is a genuine, unaliased carrier set (e.g. ND) -- "set" stands
    model.encodings.set(id, inferAliased(id, shape, model));
  }
}

// Context axioms of the shape `IDENT = <type-expr>` where <type-expr> itself
// contains a relation/function/set operator -- a type alias, not a value
// axiom like `minR = 1000`.
function collectTypeAliases(raw: RawModel): Map<string, string> {
  const aliases = new Map<string, string>();
  const re = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/;
  for (const ctx of raw.contexts)
    for (const ax of ctx.axioms) {
      const m = re.exec(ax.text.trim());
      if (m && /→|⇸|↔|⊆|ℙ\(/.test(m[2])) aliases.set(m[1], m[2].trim());
    }
  return aliases;
}

// Mirrors encodingResolver.ts's infer(), applied to an already-dereferenced RHS.
function inferAliased(id: string, rhs: string, machine: FlatMachine): EncodingForm {
  if (/→|⇸/.test(rhs)) {
    if (/(→|⇸)\s*ℙ\(/.test(rhs)) return "map-of-sets";
    return "function";
  }
  if (/↔/.test(rhs)) {
    if (/↔\s*ℙ\(/.test(rhs)) return "map-of-sets";
    return usesKeyAccess(id, machine) ? "map-of-sets" : "pair-set";
  }
  if (/^ℙ\(/.test(rhs) || /⊆/.test(rhs)) return "set";
  return "set";
}

// A third case encodingResolver's infer() falls through on: a variable typed
// directly against the Event-B builtin `BOOL` (or `𝔹`), e.g. MintRoute M4's
// `bcastRouTimer ∈ BOOL`. rhs = "BOOL" matches none of infer()'s branches
// (→, ⇸, ↔, ⊆, ℙ() either, so it defaults to "set" -- `std::set<int>
// bcastRouTimer;` -- even though codeEmitter.ts's cppType() already has a
// working `case "bool": return "bool";` arm that infer() simply never
// reaches (task-7 finding: `bcastRouTimer == FALSE` does not compile against
// a set). Unlike the alias cases above there is no dereferencing to do here
// -- BOOL is a language builtin, not a name to look up -- so this is a
// separate, narrower correction: only a bare `∈ BOOL` / `∈ 𝔹` invariant
// currently resolved to "set" is retagged.
export function fixBooleanEncodings(model: EncodedMachine): void {
  for (const [id, inv] of model.variableTypes) {
    const rhs = inv.replace(/^[^∈⊆]*[∈⊆]\s*/, "").trim();
    if (rhs !== "BOOL" && rhs !== "𝔹") continue;
    if (model.encodings.get(id) !== "set") continue;
    model.encodings.set(id, "bool");
  }
}

// Mirrors encodingResolver.ts's usesKeyAccess().
function usesKeyAccess(id: string, machine: FlatMachine): boolean {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyForms = [
    new RegExp(`◁\\s*${esc}\\b`),
    new RegExp(`\\b${esc}\\s*\\(`),
    new RegExp(`\\b${esc}\\s*≔\\s*${esc}\\s*∪\\s*\\(\\{`),
  ];
  for (const ev of machine.events)
    for (const t of [...ev.guards, ...ev.actions])
      if (keyForms.some((p) => p.test(t))) return true;
  return false;
}

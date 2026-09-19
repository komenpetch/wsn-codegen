// Two projects naming the same set differently.
//
// The tool bundles the advisor's pattern chain and merges it with the user's own
// project. They are two versions of ONE pattern, so they agree about almost
// everything — but `Ex_WSN_Pattern/WSN_Pattern/C1.buc` declares
// `partition(TYPE, FLOOD, {DATA})` where `Update_wsn/C0_project/C1.buc` declares
// `partition(TYPE, CONTROL, {DATA})`. Same concept, two names.
//
// ⚠ WHY IT CANNOT BE LEFT TO `mergeContexts`. That function deduplicates by
// NAME, so both survive: the emitted context declares two `std::set<int>`
// constants, the user's events guard on one and the bundled pattern's on the
// other, and the two halves of one module silently stop talking to each other.
// Nothing fails to compile.
//
// ── THE WARRANT ─────────────────────────────────────────────────────────────
//
// `partition(S, P₁, …, Pₙ)` means `S = ⋃Pᵢ` with the parts pairwise disjoint.
// So given the same parent and the same other parts:
//
//     project: S = A ⊎ R          bundled: S = X ⊎ R
//     ⟹  A = S ∖ R = X
//
// valid for any arity ≥ 2. It requires, and this is the whole of it:
//
//   (a) the SAME S — and across two projects the parent is only a NAME. It is
//       the merge that identifies names, so the rule may only be applied where
//       the merge genuinely will: the parent must be declared on BOTH sides. A
//       parent one side never declares is a different set sharing a spelling.
//   (b) the rest identical AS A SET OF PARTS. ⚠ The parts are UNORDERED —
//       `partition(S, A, B)` and `partition(S, B, A)` are the same predicate —
//       so comparing them by position both misses real renames and refuses
//       ones that follow from the axioms.
//
// ── ⚠ AND AN EQUALITY IS NOT A RENAME ───────────────────────────────────────
//
// `FLOOD = CONTROL` is a fact about two sets. `FLOOD ↦ CONTROL` is a rewrite of
// the model's text, and it is lossy in a way the equality is not:
//
//   - After substitution the bundled axiom becomes a duplicate of the project's
//     and `mergeContexts` drops it. The fact that the pattern ever said FLOOD is
//     GONE — and with it any trace to find the mistake by if (a) was violated.
//   - Rodin discharges obligations about `FLOOD`; the emitted C++ would say
//     `CONTROL`. The proved model and the running code stop sharing a
//     vocabulary, which is the traceability this project exists to claim.
//
// So the two are separate functions. `derivedSetEqualities` states the fact and
// carries the axioms it was read off. `substituteEqualNames` performs the
// rewrite, and a caller has to ask for it.
import type { Labelled, RawContext, RawMachine, RawModel } from "./types";
import { esc } from "./text";

/** A set equality derived from two partitions, carrying the axioms that warrant it. */
export type SetEquality = {
  /** The name in the bundled pattern. */
  bundledName: string;
  /** The name in the user's project — authoritative, never rewritten. */
  projectName: string;
  /** The two partition axioms the equality follows from. */
  warrant: { bundled: string; project: string };
};

type Partition = { parent: string; parts: string[]; text: string };

// `partition(TYPE, CONTROL, {DATA})` → parent TYPE, parts ["CONTROL", "{DATA}"].
//
// Split on top-level commas only: `{A, B}` is ONE part, and splitting naively
// would make it two and change the arity, which is what arity is compared for.
function parsePartition(text: string): Partition | null {
  const m = /^\s*partition\s*\((.*)\)\s*$/s.exec(text);
  if (!m) return null;
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of m[1]) {
    if (ch === "{" || ch === "(") depth++;
    if (ch === "}" || ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur.trim());
  if (parts.length < 2) return null;
  return { parent: parts[0], parts: parts.slice(1), text: text.trim() };
}

const partitionsOf = (contexts: readonly RawContext[]): Partition[] =>
  contexts.flatMap((c) => c.axioms
    .map((a) => parsePartition(a.text))
    .filter((p): p is Partition => p !== null));

/** Every set and constant a side declares — what "the merge will identify this" means. */
const declaredIn = (contexts: readonly RawContext[]): Set<string> =>
  new Set(contexts.flatMap((c) => [...c.sets, ...c.constants]));

/** The identifiers a part names: `CONTROL` → ["CONTROL"], `{DATA}` → ["DATA"]. */
const namesIn = (part: string): string[] => part.match(/[A-Za-z_]\w*/g) ?? [];

const norm = (part: string): string => part.replace(/\s+/g, "");

/** Parts of `a` that appear nowhere in `b` — a SET difference, because parts are unordered. */
const only = (a: Partition, b: Partition): string[] => {
  const other = b.parts.map(norm);
  return a.parts.filter((p) => !other.includes(norm(p)));
};

/**
 * Set equalities that follow from the two sides' partition axioms.
 *
 * Returns bundled-name = project-name, with the warrant. Empty when the two
 * sides already agree.
 *
 * ⚠ Throws rather than guessing whenever more than one reading is available:
 * two parts differing, two bundled names collapsing onto one project name, or
 * one bundled name equalling two project names. Each would compile perfectly
 * while meaning something nobody decided.
 */
export function derivedSetEqualities(
  sides: { project: readonly RawContext[]; bundledPattern: readonly RawContext[] },
): SetEquality[] {
  // ⚠ Named, not positional. Both sides are `RawContext[]`, so a positional
  // signature lets a caller swap them and still type-check — and the swap points
  // the rewrite at the user's own model, which the header says must never
  // happen. Structure 3's two packet-source slots were swappable in exactly this
  // way, and the swap cost 13 clang errors that named nothing useful.
  const { project, bundledPattern } = sides;
  const projectPartitions = partitionsOf(project);
  const sharedNames = declaredIn(project);

  const found: SetEquality[] = [];
  const byBundled = new Map<string, SetEquality>();
  const byProject = new Map<string, SetEquality>();

  for (const b of partitionsOf(bundledPattern)) {
    // Precondition (a): the parent must be a name BOTH sides declare, or the two
    // partitions are not about the same set and nothing follows.
    if (!sharedNames.has(b.parent)) continue;

    const candidates = projectPartitions.filter(
      (p) => p.parent === b.parent && p.parts.length === b.parts.length);
    if (candidates.length === 0) continue;

    // Already the same partition — possibly written in another order, which is
    // the same predicate and yields nothing to reconcile.
    if (candidates.some((p) => only(p, b).length === 0)) continue;

    const oneApart = candidates.filter((p) => only(p, b).length === 1 && only(b, p).length === 1);
    if (oneApart.length !== 1)
      throw new Error(
        `Cannot reconcile two packet-type partitions. The bundled pattern declares\n`
        + `  ${b.text}\n`
        + `and the project declares\n`
        + candidates.map((p) => `  ${p.text}`).join("\n") + "\n"
        + `A single differing part would be a rename this tool can read off the `
        + `axioms. These differ in more than one, so which name means which is a `
        + `choice nobody has made — resolve it in the model rather than here.`);

    const p = oneApart[0];
    const from = namesIn(only(b, p)[0]), to = namesIn(only(p, b)[0]);
    if (from.length !== 1 || to.length !== 1)
      throw new Error(
        `Cannot reconcile two packet-type partitions: the differing part holds `
        + `'${only(b, p)[0]}' in the bundled pattern and '${only(p, b)[0]}' in the `
        + `project, and a rename is only readable when each names exactly one `
        + `identifier.\n  ${b.text}\n  ${p.text}`);

    if (from[0] === to[0]) continue;
    const eq: SetEquality = {
      bundledName: from[0], projectName: to[0],
      warrant: { bundled: b.text, project: p.text },
    };

    // ⚠ Neither direction may be many-to-one, and both are silent if unchecked.
    // Two bundled sets collapsing onto one project name merges sets the pattern
    // deliberately keeps apart; one bundled set equalling two project names is
    // decided by axiom order and nothing else.
    const sameBundled = byBundled.get(eq.bundledName);
    if (sameBundled && sameBundled.projectName !== eq.projectName)
      throw new Error(
        `Cannot reconcile packet-type partitions: the bundled pattern's `
        + `'${eq.bundledName}' equals the project's '${sameBundled.projectName}' by one `
        + `partition and '${eq.projectName}' by another, so it has no single meaning.\n`
        + `  ${sameBundled.warrant.bundled}\n  ${eq.warrant.bundled}`);

    const sameProject = byProject.get(eq.projectName);
    if (sameProject && sameProject.bundledName !== eq.bundledName)
      throw new Error(
        `Cannot reconcile packet-type partitions: the bundled pattern's `
        + `'${sameProject.bundledName}' and '${eq.bundledName}' would both equal the `
        + `project's '${eq.projectName}', merging two sets the pattern keeps distinct.\n`
        + `  ${sameProject.warrant.bundled}\n  ${eq.warrant.bundled}`);

    if (sameBundled) continue;
    found.push(eq);
    byBundled.set(eq.bundledName, eq);
    byProject.set(eq.projectName, eq);
  }
  return found;
}

/**
 * Rewrite the bundled pattern's names to the project's.
 *
 * ⚠ SEPARATE DECISION, AND LOSSY. The equality it takes is a fact; this rewrite
 * discards the bundled model's own vocabulary, so the axioms Rodin proved and
 * the C++ that runs no longer use the same names. Prefer recording the equality
 * (one storage, two names) wherever the emitter can express it; reach for this
 * only where it cannot.
 *
 * Reaches the MACHINES as well as the contexts — a context-only rewrite leaves
 * every carried guard referring to a name nothing declares.
 */
export function substituteEqualNames(
  raw: RawModel, equalities: readonly SetEquality[],
): RawModel {
  if (equalities.length === 0) return raw;
  const by = new Map(equalities.map((e) => [e.bundledName, e.projectName]));

  // Whole identifiers only. `FLOODED` and `preFLOOD` are different names, and a
  // substring replace would quietly corrupt them.
  const pattern = new RegExp(`\\b(${[...by.keys()].map(esc).join("|")})\\b`, "g");
  const sub = (s: string): string => s.replace(pattern, (n) => by.get(n) ?? n);
  const subLabelled = (ls: Labelled[]): Labelled[] =>
    ls.map((l) => ({ ...l, text: sub(l.text) }));

  const machines: RawMachine[] = raw.machines.map((m) => ({
    ...m,
    variables: m.variables.map(sub),
    invariants: subLabelled(m.invariants),
    events: m.events.map((ev) => ({
      ...ev,
      parameters: ev.parameters.map(sub),
      guards: subLabelled(ev.guards),
      actions: subLabelled(ev.actions),
    })),
  }));

  const contexts: RawContext[] = raw.contexts.map((c) => ({
    ...c,
    sets: c.sets.map(sub),
    constants: c.constants.map(sub),
    axioms: subLabelled(c.axioms),
  }));

  return { ...raw, machines, contexts };
}

// Two projects naming the same set differently.
//
// The tool bundles the advisor's pattern chain and merges it with the user's
// own project. They are two versions of ONE pattern, so they agree about almost
// everything — but `Ex_WSN_Pattern/WSN_Pattern/C1.buc` declares
// `partition(TYPE, FLOOD, {DATA})` where `Update_wsn/C0_project/C1.buc`
// declares `partition(TYPE, CONTROL, {DATA})`. Same concept, two names.
//
// ⚠ WHY THIS CANNOT BE LEFT ALONE. `mergeContexts` deduplicates by NAME, so
// both survive: the emitted context declares two `std::set<int>` constants, the
// user's events guard on one and the bundled pattern's guard on the other, and
// the two halves of one module silently stop talking to each other. Nothing
// fails to compile. It is the same shape as the lattice mismatch that produced
// 13 clang errors none of which named the real cause — except quieter, because
// here it produces no error at all.
//
// The direction is settled and not symmetric: the 2026-05-17 verification
// against raw Rodin XML established `CONTROL` as the authoritative name, and
// more importantly the BASE model is the user's input. Renaming their model to
// match a bundled fixture would be the tool editing its own input.
import type { Labelled, RawContext, RawMachine, RawModel } from "./types";
import { esc } from "./text";

type Partition = { parent: string; parts: string[]; text: string };

// `partition(TYPE, CONTROL, {DATA})` → parent TYPE, parts ["CONTROL", "{DATA}"].
//
// Split on top-level commas only: `{A, B}` is ONE part, and splitting naively
// would make it two and change the arity, which is the thing arity is being
// compared for.
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

// The identifiers a part names: `CONTROL` → ["CONTROL"], `{DATA}` → ["DATA"].
const namesIn = (part: string): string[] => part.match(/[A-Za-z_]\w*/g) ?? [];

// Which positions two same-arity partitions disagree in.
const differingPositions = (a: Partition, b: Partition): number[] =>
  a.parts.flatMap((p, i) => (p.replace(/\s+/g, "") === b.parts[i].replace(/\s+/g, "") ? [] : [i]));

/**
 * Extra-project set names that mean what a base-project name already means.
 *
 * Returns `extraName → baseName`. Empty when the two projects already agree.
 *
 * ⚠ Throws rather than guessing when a pairing is ambiguous. One differing
 * position in an otherwise identical partition is a rename and can be read off
 * with certainty. Two differing positions is a DIFFERENT partition wearing
 * similar clothes, and any pairing chosen from it would compile perfectly while
 * meaning something nobody decided.
 */
export function setAliasesOf(
  sides: { project: readonly RawContext[]; bundledPattern: readonly RawContext[] },
): Map<string, string> {
  // ⚠ Named, not positional. Both sides are `RawContext[]`, so a positional
  // signature lets a caller swap them and still type-check — and the swap points
  // the rename at the user's own model, which the header above says must never
  // happen. Structure 3's two packet-source slots were swappable in exactly this
  // way; the swap cost 13 clang errors that named nothing useful.
  const { project, bundledPattern } = sides;
  const basePartitions = partitionsOf(project);
  const aliases = new Map<string, string>();
  // Which bundled name each project name has already claimed, so a second
  // claimant is refused instead of silently merged into the first.
  const claimedBy = new Map<string, string>();

  for (const e of partitionsOf(bundledPattern)) {
    // Same parent AND same arity. Matching on the parent alone would pair
    // `partition(TYPE, CONTROL, {DATA})` with a three-way partition of TYPE and
    // invent an alias out of the length difference.
    const candidates = basePartitions.filter(
      (b) => b.parent === e.parent && b.parts.length === e.parts.length);
    if (candidates.length === 0) continue;

    // Already agreed with one of them — nothing to rename, and no reason to
    // look at the others.
    if (candidates.some((b) => differingPositions(b, e).length === 0)) continue;

    const oneApart = candidates.filter((b) => differingPositions(b, e).length === 1);
    if (oneApart.length !== 1)
      throw new Error(
        `Cannot reconcile two packet-type partitions. The bundled pattern declares\n`
        + `  ${e.text}\n`
        + `and the project declares\n`
        + candidates.map((b) => `  ${b.text}`).join("\n") + "\n"
        + `A single differing position would be a rename this tool can read off. `
        + `These differ in more than one, so which name means which is a choice `
        + `nobody has made — resolve it in the model rather than here.`);

    const b = oneApart[0];
    const i = differingPositions(b, e)[0];
    const from = namesIn(e.parts[i]), to = namesIn(b.parts[i]);
    if (from.length !== 1 || to.length !== 1)
      throw new Error(
        `Cannot reconcile two packet-type partitions. The differing position holds `
        + `'${e.parts[i]}' in the bundled pattern and '${b.parts[i]}' in the project; `
        + `a rename is only readable when each names exactly one identifier.\n`
        + `  ${e.text}\n  ${b.text}`);

    if (from[0] === to[0]) continue;

    // ⚠ Neither direction may be many-to-one, and both are silent if unchecked.
    //
    // Two bundled sets collapsing onto one project name merges sets the pattern
    // deliberately keeps apart, so every clause over the loser quietly becomes a
    // clause over the winner. One bundled set claiming two project names is
    // last-write-wins, which picks by axiom order and nothing else. Both are the
    // ambiguity this function already refuses above; they just arrive across
    // partitions instead of within one.
    const already = aliases.get(from[0]);
    if (already !== undefined && already !== to[0])
      throw new Error(
        `Cannot reconcile packet-type partitions: the bundled pattern's '${from[0]}' `
        + `matches the project's '${already}' in one partition and '${to[0]}' in another, `
        + `so it has no single meaning. Resolve it in the model rather than here.\n`
        + `  ${e.text}`);

    const claimant = claimedBy.get(to[0]);
    if (claimant !== undefined && claimant !== from[0])
      throw new Error(
        `Cannot reconcile packet-type partitions: the bundled pattern's '${claimant}' and `
        + `'${from[0]}' would both be renamed to the project's '${to[0]}', merging two sets `
        + `the pattern keeps distinct. Resolve it in the model rather than here.\n`
        + `  ${e.text}`);

    aliases.set(from[0], to[0]);
    claimedBy.set(to[0], from[0]);
  }
  return aliases;
}

/**
 * Rewrite every occurrence of an aliased name in a model.
 *
 * ⚠ Reaches the MACHINES, not only the contexts. A context-only rename would
 * leave every carried guard referring to a name nothing declares.
 */
export function applyAliases(raw: RawModel, aliases: ReadonlyMap<string, string>): RawModel {
  if (aliases.size === 0) return raw;

  // Whole identifiers only. `FLOODED` and `preFLOOD` are different names, and a
  // substring replace would quietly corrupt them.
  const pattern = new RegExp(`\\b(${[...aliases.keys()].map(esc).join("|")})\\b`, "g");
  const sub = (s: string): string => s.replace(pattern, (n) => aliases.get(n) ?? n);
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

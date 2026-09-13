import type { RawModel, RawMachine, RawEvent, FlatMachine, FlatEvent } from "./types";

// The machine `m` refines, or undefined when it refines nothing and is therefore a base.
//
// THROWS when `m` declares a target that is not among the files given. Those two cases
// used to be indistinguishable -- `m.refines ? byName.get(m.refines) : undefined` yields
// undefined for both -- and that is how an incomplete chain went unnoticed: a machine
// whose parent was missing looked like a base machine, took depth 1, lost the leaf tie to
// whichever base parsed first, and was silently dropped from the output. The generator
// reported success and emitted the wrong machine. See test_input/lift for the case.
export function parentOf(
  byName: Map<string, RawMachine>, m: RawMachine,
): RawMachine | undefined {
  if (m.refines === undefined) return undefined;
  const parent = byName.get(m.refines);
  if (!parent)
    throw new Error(
      `Machine '${m.name}' refines '${m.refines}', which is not among the files given. ` +
      `The refinement chain is incomplete, so '${m.name}' cannot be placed in it. ` +
      `Add '${m.refines}.bum', or generate from a complete project.`,
    );
  return parent;
}

// Build the refines chain from `target` down to the base machine, base first.
function chain(model: RawModel, target: string): RawMachine[] {
  const byName = new Map(model.machines.map((m) => [m.name, m]));
  const out: RawMachine[] = [];
  const seen = new Set<string>();
  let cur: RawMachine | undefined = byName.get(target);
  if (!cur) throw new Error(`Machine '${target}' not found among parsed files.`);
  while (cur) {
    if (seen.has(cur.name))
      throw new Error(`Refinement cycle detected at machine '${cur.name}'.`);
    seen.add(cur.name);
    out.unshift(cur);                       // base ends up at index 0
    cur = parentOf(byName, cur);
  }
  return out;
}

// An event's identity across the chain: its own label, or the label it refines.
function ancestorLabel(ev: RawEvent): string { return ev.refines ?? ev.label; }

// Every label each flattened event refines, transitively, excluding its own.
//
// The flattener collapses an event's ancestry into its most-refined label,
// which is right for translating it and loses the one fact a MERGE needs: that
// MintRoute's `receive_controlPkt` IS the app chain's abstract `receive`, seen
// at a lower level. Carry the refinement into a model that still holds the
// abstraction and the module has both, and the abstract one -- whose guards are
// purely negative -- fires first and consumes what the refinement needed.
//
// Rodin states this in the event's own `refinesEvent` target, so it is read,
// never guessed from names.
export function eventAncestry(model: RawModel, target: string): Map<string, Set<string>> {
  const anc = new Map<string, Set<string>>();
  for (const m of chain(model, target)) {
    // Staged, then applied: several events may refine the same ancestor (an
    // event split), and each must see the PREVIOUS machine's ancestry.
    const staged: [string, Set<string>][] = [];
    for (const ev of m.events) {
      const key = ancestorLabel(ev);
      const s = new Set(anc.get(key) ?? []);
      if (key !== ev.label) s.add(key);
      staged.push([ev.label, s]);
    }
    for (const [label, s] of staged) anc.set(label, s);
  }
  return anc;
}

export function flatten(model: RawModel, target: string): FlatMachine {
  const machines = chain(model, target);

  // Accumulate each event by ancestor identity, base → target, so a child that
  // `extends`/`refines` inherits everything declared earlier in the chain.
  // Lookups within one machine all see the previous machine's state: several
  // events may refine the SAME ancestor (an event split, e.g. creatingPkt →
  // creatingDataPacket + creatingControlPacket), and each must inherit its body.
  const acc = new Map<string, FlatEvent>();
  for (const m of machines) {
    const staged: FlatEvent[] = [];
    const refinedKeys = new Set<string>();
    for (const ev of m.events) {
      const key = ancestorLabel(ev);
      const prior = acc.get(key);
      staged.push({
        label: ev.label,                                       // most-refined label wins
        parameters: dedupe([...(prior?.parameters ?? []), ...ev.parameters]),
        guards: dedupe([...(prior?.guards ?? []), ...ev.guards.map((g) => g.text)]),
        actions: dedupe([...(prior?.actions ?? []), ...ev.actions.map((a) => a.text)]),
      });
      refinedKeys.add(key);
    }
    // A refined event may be renamed (creatingPkt → creatingDataPacket); drop
    // the ancestor keys, then re-key each merged event under its new label so
    // a further refinement in the next machine finds it.
    for (const key of refinedKeys) acc.delete(key);
    for (const ev of staged) acc.set(ev.label, ev);
  }

  const variables = dedupe(machines.flatMap((m) => m.variables));
  const variableTypes = new Map<string, string>();
  for (const m of machines)
    for (const inv of m.invariants) {
      const id = inv.text.split(/\s*[∈⊆]\s*/)[0].trim();
      if (variables.includes(id)) variableTypes.set(id, inv.text);
    }

  return {
    name: target,
    chain: machines.map((m) => m.name),
    variables,
    variableTypes,
    events: [...acc.values()],
  };
}

function dedupe<T>(xs: T[]): T[] { return [...new Set(xs)]; }

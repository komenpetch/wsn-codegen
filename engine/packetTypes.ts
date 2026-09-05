import type { RawContext } from "../../wsn-codegen/src/engine/types";

export interface TypeLattice {
  root: string;
  children: Map<string, string[]>;
  leaves: string[];
  tagOf: Map<string, number>;
}

// partition(P, A, B, ...) where each part is a bare name or a singleton {name}.
// Rodin writes both forms in the same model: C1 has partition(TYPE, CONTROL,
// {DATA}) -- CONTROL a subset, DATA an element -- and C3 has
// partition(CONTROL, {ROUTE}, {BEACON}), both elements. Accepting only the
// first shape is why ROUTE and BEACON were emitted nowhere.
const PARTITION = /partition\(\s*(\w+)\s*,\s*(.+?)\s*\)\s*$/;

function parts(list: string): string[] {
  return list.split(",").map((s) => s.trim().replace(/^\{\s*|\s*\}$/g, "")).filter(Boolean);
}

export function packetTypeLattice(contexts: RawContext[]): TypeLattice | null {
  const children = new Map<string, string[]>();
  for (const c of contexts)
    for (const a of c.axioms) {
      const m = PARTITION.exec(a.text);
      if (m) children.set(m[1], parts(m[2]));
    }
  if (children.size === 0) return null;

  // The root is the one partitioned name that is nobody else's child.
  const asChild = new Set([...children.values()].flat());
  const root = [...children.keys()].find((k) => !asChild.has(k));
  if (!root) return null;

  const found: string[] = [];
  (function walk(n: string) {
    const kids = children.get(n);
    if (!kids) { found.push(n); return; }
    for (const k of kids) walk(k);
  })(root);

  // DATA keeps tag 0 to match the app layer's emitted context, so a model with
  // only the flat partition encodes identically before and after. `leaves` uses
  // this same order, so leaves[i] and tag i never disagree -- a depth-first
  // order would put ROUTE and BEACON before DATA and silently renumber it.
  const leaves = [...found].sort((a, b) => (a === "DATA" ? -1 : b === "DATA" ? 1 : 0));
  const tagOf = new Map(leaves.map((l, i) => [l, i]));
  return { root, children, leaves, tagOf };
}

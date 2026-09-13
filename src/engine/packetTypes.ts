import type { RawContext } from "./types";

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

// type ∈ PKT → <NAME> declares <NAME> as the packet-type carrier set by
// definition -- this is the axiom to anchor the root on, not file order.
// Rodin's own spacing is inconsistent ("type ∈PKT → TYPE", "type∈PKT→TYPE",
// etc.), so whitespace around ∈ and → is optional here.
const TYPE_FUNCTION = /\btype\s*∈\s*PKT\s*→\s*(\w+)/;

function parts(list: string): string[] {
  return list.split(",").map((s) => s.trim().replace(/^\{\s*|\s*\}$/g, "")).filter(Boolean);
}

export function packetTypeLattice(contexts: RawContext[]): TypeLattice | null {
  const children = new Map<string, string[]>();
  let typeFunctionRoot: string | null = null;
  for (const c of contexts)
    for (const a of c.axioms) {
      const m = PARTITION.exec(a.text);
      if (m) children.set(m[1], parts(m[2]));
      if (!typeFunctionRoot) {
        const t = TYPE_FUNCTION.exec(a.text);
        if (t) typeFunctionRoot = t[1];
      }
    }
  if (children.size === 0) return null;

  // Anchor the root on the model: `type ∈ PKT → <NAME>` declares <NAME> as
  // the packet-type carrier set, regardless of which partition axiom a
  // parser happens to read first. Real MintRoute directories contain
  // several unrelated partitions (TYPE's own CONTROL/DATA split, plus
  // CTL_STATUS, ENV_STATUS, PKT's ~38 packet instances) -- "the first
  // partitioned name nobody else is a child of" is not sound against that,
  // it just returns whichever candidate's axiom the parser reads first.
  let root: string | undefined;
  if (typeFunctionRoot && children.has(typeFunctionRoot)) {
    root = typeFunctionRoot;
  } else {
    // Fallback for models with no `type ∈ PKT → <NAME>` axiom: the one
    // partitioned name that is nobody else's child. Ambiguous is a hard
    // error here -- silently picking the first candidate is exactly the
    // file-ordering bug being fixed.
    const asChild = new Set([...children.values()].flat());
    const candidates = [...children.keys()].filter((k) => !asChild.has(k));
    if (candidates.length > 1) {
      throw new Error(
        `packetTypeLattice: ambiguous packet-type root -- no "type ∈ PKT → <NAME>" axiom found, ` +
          `and multiple partition roots are candidates: ${candidates.join(", ")}`
      );
    }
    root = candidates[0];
  }
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
  // Rank, not a hand-written comparator. The earlier form
  // `a === "DATA" ? -1 : b === "DATA" ? 1 : 0` returned -1 for
  // compare(DATA, DATA), so it was not a consistent ordering; V8's insertion
  // sort tolerates that below 22 elements, but a protocol with enough control
  // subtypes to reach TimSort could get an arbitrary permutation -- and
  // `tagOf` is built from this array's indices, so `leaves[i]` and tag `i`
  // would silently disagree (audit finding). Subtracting ranks is antisymmetric
  // and transitive, and the sort's stability preserves discovery order.
  const rank = (t: string) => (t === "DATA" ? 0 : 1);
  const leaves = [...found].sort((a, b) => rank(a) - rank(b));
  const tagOf = new Map(leaves.map((l, i) => [l, i]));
  return { root, children, leaves, tagOf };
}

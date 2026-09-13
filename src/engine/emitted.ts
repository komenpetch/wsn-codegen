// Reading facts back OUT of the code the emitter just produced.
//
// Several network-layer passes attach to the emitted C++ rather than to the
// model: the scheduler needs each event method's final parameter list, the
// medium binding needs the delivery event's emitted name, fixSetTypedParameters
// needs each definition's offset. All three ask the same question -- "which
// `bool <Class>::<method>(<params>) {` lines are in this .cc, and which Event-B
// event does each one come from" -- and all three used to build their own regex
// for it.
//
// They had already drifted: one escaped the class name before interpolating it
// and two did not, and the failure modes differed. fixSetTypedParameters throws
// when it matches nothing; the other two return an empty map and null, which
// means the generator still writes three files but with no scheduler and no
// medium binding -- indistinguishable from a model that simply has no network
// layer. One parser, one escaping decision, one place to change.

import type { GeneratedTree } from "./types";
import { esc } from "./text";

// One emitted guarded-bool event method.
export interface EmittedMethod {
  /** Event-B label, when the method carries a provenance comment. */
  label?: string;
  /** The name actually emitted -- the CommPattern pair is renamed per shell. */
  method: string;
  /** Parameter list exactly as emitted, e.g. `int x, const std::set<Node>& nbs`. */
  params: string;
  /** Offset of the definition line in the .cc, for passes that slice bodies. */
  start: number;
}

// The provenance comment the emitter writes above a renamed CommPattern method.
// Matching on it, rather than on the method name, is what lets the pair be
// called whatever its shell calls it.
const provRe = (cls: string) =>
  new RegExp(`^// Event-B: (\\w+)[^\\n]*\\nbool ${esc(cls)}::(\\w+)\\(([^)]*)\\) \\{$`, "gm");
const defRe = (cls: string) =>
  new RegExp(`^bool ${esc(cls)}::(\\w+)\\(([^)]*)\\) \\{$`, "gm");

// Every `bool <cls>::<method>(...) {` definition in the emitted .cc, in source
// order, each carrying its Event-B label when the emitter recorded one.
export function emittedMethods(cc: string, cls: string): EmittedMethod[] {
  const labelOf = new Map<string, string>();
  const prov = provRe(cls);
  for (let m = prov.exec(cc); m; m = prov.exec(cc)) labelOf.set(m[2], m[1]);

  const out: EmittedMethod[] = [];
  const re = defRe(cls);
  for (let m = re.exec(cc); m; m = re.exec(cc))
    out.push({ label: labelOf.get(m[1]), method: m[1], params: m[2], start: m.index });
  return out;
}

// The method emitted for one Event-B event, or undefined if the event produced
// no guarded bool method.
export const methodForLabel = (cc: string, cls: string, label: string): EmittedMethod | undefined =>
  emittedMethods(cc, cls).find((m) => m.label === label);

// Split an emitted parameter list into typed parameters. The type is everything
// before the last space, so `const std::set<Node>& nbrs` splits correctly.
export function splitParams(params: string): { cppType: string; name: string }[] {
  return params.trim() === "" ? [] : params.split(",").map((raw) => {
    const p = raw.trim();
    const i = p.lastIndexOf(" ");
    return { cppType: p.slice(0, i).trim(), name: p.slice(i + 1).trim() };
  });
}

// The two files every generated module has. Six sites used to inline these, and
// they disagreed on the missing case -- some returned the tree unchanged, one
// substituted "", one checked for undefined -- so a tree lacking one of them
// degraded differently depending on which pass reached it first.
export const headerOf = (tree: GeneratedTree) => tree.find((f) => f.path.endsWith(".h"));
export const implOf = (tree: GeneratedTree) => tree.find((f) => f.path.endsWith(".cc"));
export const implText = (tree: GeneratedTree): string => implOf(tree)?.content ?? "";

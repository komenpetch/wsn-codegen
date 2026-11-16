// Constants the tool bundles because a model uses them and declares them nowhere.
//
// PActivate (user, 2026-11-17). The pattern project's `activate` event guards
// `data ≥ safetyThreshold` (pM3 MPActivate_activate_g3), but no context of the
// pattern project declares `safetyThreshold`, so even a translated guard would not
// compile. RTMCS, whose actuation events the pattern's was taken from, declares it
// in its C2 (axm2_4 `safetyThreshold ∈ ℤ`, axm2_5 `safetyThreshold = 1001`). The
// tool ships the declaration, TYPE ONLY, as a real Rodin context
// (src/assets/pattern-extension/CActivate.buc), and adds it to a model that uses
// the name without declaring it -- exactly the condition, nothing wider: RTMCS
// declares it and keeps its own fixed value; MintRoute never uses it.
//
// The value is the application's, so the simulation sets it: structures 3-4 read
// it from a NED parameter (installBundledParameters). Structures 1-2 hold it as a
// fixed constant, because reading a parameter needs a line in `initialize()`, and
// in structure 2 that function is statement-identical to SensorApp's (the paper's
// 15/15). Both use the same default, RTMCS's value, cited below.
import CActivate from "../assets/pattern-extension/CActivate.buc?raw";
import { parseModel } from "./parser";
import { mustFind } from "./emitted";
import type { GeneratedTree, RawContext, RawModel } from "./types";

export interface BundledConstant {
  /** The constant's Event-B name. */
  name: string;
  /** The bundled context that declares it (its file name, without .buc). */
  context: string;
  xml: string;
  /** The value structures 1-2 hold and structures 3-4 default to. */
  defaultValue: number;
  /** Where that value comes from. */
  valueSource: string;
}

export const BUNDLED_CONSTANTS: readonly BundledConstant[] = [
  {
    name: "safetyThreshold", context: "CActivate", xml: CActivate, defaultValue: 1001,
    valueSource: "RTMCS C2 axm2_5 (safetyThreshold = 1001)",
  },
];

const usedNames = (raw: RawModel): Set<string> => {
  const out = new Set<string>();
  for (const m of raw.machines)
    for (const e of m.events)
      for (const c of [...e.guards, ...e.actions])
        for (const t of c.text.match(/[A-Za-z_]\w*/g) ?? []) out.add(t);
  return out;
};

/**
 * The model with each bundled context it needs added: one whose constant the
 * model's events use while no context declares it and no machine has a variable
 * of that name. Otherwise the model unchanged (the same object).
 */
export function withBundledConstants(raw: RawModel): RawModel {
  const used = usedNames(raw);
  const declared = new Set([
    ...raw.contexts.flatMap((c) => c.constants),
    ...raw.machines.flatMap((m) => m.variables),
  ]);
  const have = new Set(raw.contexts.map((c) => c.name));
  const added: RawContext[] = [];
  for (const b of BUNDLED_CONSTANTS) {
    if (!used.has(b.name) || declared.has(b.name) || have.has(b.context)) continue;
    const ctx = parseModel([{ name: `${b.context}.buc`, xml: b.xml }]).contexts;
    if (ctx.length !== 1 || !ctx[0].constants.includes(b.name))
      throw new Error(`bundled context ${b.context}.buc does not declare ${b.name}`);
    added.push(ctx[0]);
  }
  return added.length ? { ...raw, contexts: [...raw.contexts, ...added] } : raw;
}

/** The bundled constants a set of contexts carries (those whose bundled context is among them). */
export function bundledConstantsIn(contexts: readonly RawContext[]): BundledConstant[] {
  const names = new Set(contexts.map((c) => c.name));
  return BUNDLED_CONSTANTS.filter((b) => names.has(b.context)
    && contexts.some((c) => c.name === b.context && c.constants.includes(b.name)));
}

/** The one C++ declaration of a bundled constant, used by every structure. */
export function bundledDeclaration(b: BundledConstant): string {
  return `inline int ${b.name} = ${b.defaultValue};  // ${b.context}.buc (bundled with the tool): `
    + `${b.name} ∈ ℤ; value from ${b.valueSource}`;
}

/**
 * Structures 3-4: each bundled constant becomes a NED parameter of the simple
 * module, read into the constant at INITSTAGE_LOCAL. The .ned and the .cc are
 * edited together, so the .cc never reads a parameter the .ned does not declare.
 */
export function installBundledParameters(tree: GeneratedTree, contexts: readonly RawContext[],
  cls: string): GeneratedTree {
  const bs = bundledConstantsIn(contexts);
  if (bs.length === 0) return tree;
  return tree.map((f) => {
    if (f.path.endsWith(".cc")) {
      const anchor = "    if (stage == INITSTAGE_LOCAL) {\n";
      const at = mustFind(f.content, `void ${cls}::initialize(int stage)`, "installBundledParameters (.cc)");
      const local = f.content.indexOf(anchor, at);
      if (local < 0)
        throw new Error(`installBundledParameters: ${cls}::initialize has no INITSTAGE_LOCAL block`);
      const lines = bs.map((b) =>
        `        ${b.name} = par("${b.name}").intValue();   // the application sets it (${b.context}.buc)\n`);
      const cut = local + anchor.length;
      return { ...f, content: f.content.slice(0, cut) + lines.join("") + f.content.slice(cut) };
    }
    if (f.path.endsWith(".ned")) {
      // Scoped to the simple module: the wrapper and its submodules also have
      // `parameters:` sections (see bindNodeIdentity's NED note).
      const decl = mustFind(f.content, `simple ${cls}`, "installBundledParameters (.ned)");
      const anchor = "    parameters:";
      const at = f.content.indexOf(anchor, decl);
      if (at < 0) throw new Error(`installBundledParameters: \`simple ${cls}\` has no parameters section`);
      const decls = bs.map((b) => `        int ${b.name} = default(${b.defaultValue});`
        + `   // ${b.context}.buc: ${b.name} ∈ ℤ; default from ${b.valueSource}`);
      return { ...f, content: f.content.slice(0, at) + [anchor, ...decls].join("\n") + f.content.slice(at + anchor.length) };
    }
    return f;
  });
}

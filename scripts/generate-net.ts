// Network-layer generation: the app-layer pipeline plus PPkt.
//
//   npm run gen:net -- MintRoute M4 out-net
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseModel } from "../../wsn-codegen/src/engine/parser";
import { flatten } from "../../wsn-codegen/src/engine/flattener";
import { resolveEncodings } from "../../wsn-codegen/src/engine/encodingResolver";
import { emit } from "../../wsn-codegen/src/engine/codeEmitter";
import { defaultName } from "../../wsn-codegen/src/engine/pipeline";
import { RULES } from "../../wsn-codegen/src/engine/rules";
import type { Rule } from "../../wsn-codegen/src/engine/rules";
import type { GeneratedTree } from "../../wsn-codegen/src/engine/types";
import { packetTypeLattice } from "../engine/packetTypes";
import { packetModel } from "../engine/packetModel";
import { emitPacketClasses } from "../engine/packetEmitter";
import { packetRules } from "../engine/packetRules";
import { composeRules } from "../engine/compose";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PROJECTS: Record<string, string> = {
  MintRoute: "EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck",
  RTMCS: "EventB_model/RTMCS_7_4_proof",
};

export function generateNet(project: string, machine: string): GeneratedTree {
  const dir = resolve(ROOT, PROJECTS[project] ?? project);
  const raw = parseModel(readdirSync(dir).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") })));
  const model = resolveEncodings(flatten(raw, machine));

  const lattice = packetTypeLattice(raw.contexts);
  if (!lattice) throw new Error(`${project} declares no packet-type partition; PPkt cannot be generated.`);
  const pm = packetModel(raw, model, lattice);

  // Composition is installed for the duration of this generation only, so the
  // app-layer catalog module is never mutated for other callers.
  const composed = composeRules(packetRules(pm.fields));
  const tree = withRules(composed, () => emit(model, defaultName(machine), 4, raw.contexts));

  // Splice the packet classes into the header, above the module class.
  const { header, impl } = emitPacketClasses(pm);
  return tree.map((f) =>
    f.path.endsWith(".h") ? { ...f, content: spliceHeader(f.content, header) }
    : f.path.endsWith(".cc") ? { ...f, content: spliceImpl(f.content, impl) }
    : f);
}

// RULES is a const array the engine reads directly, so swap its CONTENTS for
// the duration of the call and restore them afterwards. Mutating a shared array
// is ugly; the alternative is threading a rule set through six engine
// signatures in wsn-codegen, which this plan is not allowed to modify.
function withRules<T>(rules: Rule[], fn: () => T): T {
  const saved = RULES.slice();
  RULES.length = 0; RULES.push(...rules);
  try { return fn(); } finally { RULES.length = 0; RULES.push(...saved); }
}
// Safe alongside the freeze guard only because vitest isolates each test FILE
// in its own module registry, so appLayerUnchanged.test.ts never observes a
// swapped catalog. If that isolation is ever turned off (`--no-isolate`,
// `pool: "vmThreads"`), this becomes a race and the guard starts flapping.

// The generated header opens with a banner then the class; put the packet
// classes after the last #include and before the first `class `.
function spliceHeader(h: string, block: string): string {
  const at = h.indexOf("\nclass ");
  if (at < 0) throw new Error("Generated header has no class declaration to splice before.");
  return h.slice(0, at + 1) + block + "\n" + h.slice(at + 1);
}

function spliceImpl(cc: string, block: string): string {
  const at = cc.indexOf("\nDefine_Module(");
  return at < 0 ? cc + "\n" + block : cc.slice(0, at + 1) + block + "\n" + cc.slice(at + 1);
}

// Run directly (not when imported by a test).
//
// The brief's original guard, `process.argv[1].endsWith("generate-net.ts")`,
// assumes argv[1] is this file. Under `npx vite-node generate-net.ts ...`
// that is false: vite-node's CLI consumes the script-path argument itself and
// leaves argv[1] pointing at its own cli.mjs (verified empirically — argv[2..]
// are the forwarded CLI args, the script path never appears in argv at all).
// So the brief's check silently never fires and the CLI never runs, whether
// invoked via `npm run gen:net` or directly. Vitest sets `process.env.VITEST`
// to "true" in every worker (also verified empirically), which is a stable
// signal across both call paths this file supports (imported by a test vs.
// run as a vite-node entry point) without depending on vite-node's argv
// layout at all.
if (process.env.VITEST !== "true") {
  const [project = "MintRoute", machine = "M4", outDir = "out-net"] = process.argv.slice(2);
  const out = resolve(ROOT, "netlayer", outDir);
  mkdirSync(out, { recursive: true });
  const tree = generateNet(project, machine);
  for (const f of tree) writeFileSync(resolve(out, f.path), f.content, "utf8");
  const n = (tree.map((f) => f.content).join("\n").match(/UNTRANSLATED/g) ?? []).length;
  console.log(`${project} ${machine}: ${tree.length} files -> ${out}/  (${n} untranslated)`);
}

// Network-layer generation: the app-layer pipeline plus PPkt.
//
//   npm run gen:net -- MintRoute M4 out-net
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseModel } from "../../src/engine/parser";
import { flatten } from "../../src/engine/flattener";
import { resolveEncodings } from "../../src/engine/encodingResolver";
import { emit } from "../../src/engine/codeEmitter";
import { defaultName } from "../../src/engine/pipeline";
import { RULES } from "../../src/engine/rules";
import type { Rule } from "../../src/engine/rules";
import type { GeneratedTree } from "../../src/engine/types";
import { packetTypeLattice } from "../engine/packetTypes";
import type { TypeLattice } from "../engine/packetTypes";
import { packetModel } from "../engine/packetModel";
import type { PacketField } from "../engine/packetModel";
import { emitPacketClasses } from "../engine/packetEmitter";
import { packetRules } from "../engine/packetRules";
import { miscRules } from "../engine/miscRules";
import { composeRules } from "../engine/compose";
import { fixAliasedEncodings, fixBooleanEncodings } from "../engine/aliasEncoding";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PROJECTS: Record<string, string> = {
  MintRoute: "EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck",
  RTMCS: "EventB_model/RTMCS_7_4_proof",
};

export function generateNet(project: string, machine: string): GeneratedTree {
  const dir = resolve(ROOT, PROJECTS[project] ?? project);
  const raw = parseModel(readdirSync(dir).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") })));
  const model = resolveEncodings(flatten(raw, machine));
  // wsn-codegen's encodingResolver never dereferences a context-level type
  // alias (MintRoute's `WSN = ND ↔ ND`), so a variable declared merely
  // `∈ WSN` (wsnLinks, crashedLinks) silently defaults to a scalar "set"
  // instead of "pair-set" -- see aliasEncoding.ts for the full account. Fix
  // it here, on the model this script owns, rather than in encodingResolver
  // itself (off-limits).
  fixAliasedEncodings(raw, model);
  // Same "encodingResolver's infer() silently defaults to 'set'" family of
  // gap, this time for a variable typed directly against the builtin BOOL
  // (MintRoute M4's `bcastRouTimer ∈ BOOL`) -- see aliasEncoding.ts.
  fixBooleanEncodings(model);

  const lattice = packetTypeLattice(raw.contexts);
  if (!lattice) throw new Error(`${project} declares no packet-type partition; PPkt cannot be generated.`);
  const pm = packetModel(raw, model, lattice);

  // Composition is installed for the duration of this generation only, so the
  // app-layer catalog module is never mutated for other callers.
  const composed = composeRules([...packetRules(pm.fields), ...miscRules()]);
  let tree = withRules(composed, () => emit(model, defaultName(machine), 4, raw.contexts));

  // Splice the packet classes into the header, above the module class.
  const { header, impl } = emitPacketClasses(pm);
  tree = tree.map((f) =>
    f.path.endsWith(".h") ? { ...f, content: spliceHeader(f.content, header) }
    : f.path.endsWith(".cc") ? { ...f, content: spliceImpl(f.content, impl) }
    : f);

  tree = undefReservedMacros(tree);
  tree = stripDeadPacketFieldMaps(tree, pm.fields);
  tree = addMissingPacketTypeConstants(tree, pm.lattice.tagOf);
  tree = fixNonLeafSetConstants(tree, pm.lattice);
  tree = fixSetTypedParameters(tree, defaultName(machine));
  return tree;
}

// wsn-codegen's codeEmitter.ts (off-limits) types an event parameter as a
// set only from a `p ∈ ℙ(T)` guard in that SAME event -- it never recognizes
// the `p ⊆ T` spelling (MintRoute M2's find_neighbours: `nbs ⊆ ND`), and it
// never looks at a SIBLING event to type a parameter that shares a name and
// role but repeats no type guard of its own (assign_forwarder and
// lose_all_neighbours both take `nbs = wsnLinks[{f}]`, the exact same
// relational image find_neighbours types, but neither restates `nbs ⊆ ND`).
// Both gaps leave the parameter declared as scalar `int` while the
// TRANSLATED BODY already correctly treats it as `std::set<Node>` -- e.g.
// `nbs.count(nb) > 0` (rules.ts's own "SET1"), `for (auto _v : nbs)`
// (rules.ts's own "MS7") -- a real compile error (task-7 finding): the body
// and the signature disagree.
//
// Rather than reconstruct codeEmitter's typing pass from outside (guard
// text alone cannot resolve the sibling-event case), this verifies directly
// against the ALREADY-EMITTED body: for every `int <name>` parameter of
// every method, check whether that method's own body uses `<name>` the way
// only a container can be used (`.count(`/`.empty()`/`.at(`, or `for (auto
// _v : name)`). Only a parameter the body itself proves needs retyping is
// retyped, in both the `.cc` definition and the `.h` declaration.
//
// `className` MUST be the same name the emitter actually used (`defaultName
// (machine)` -- "M4App"/"M6App"/whatever the machine label produces), not a
// literal "M4App". Hardcoding "M4App" here (the bug this fixes, task-7
// finding surfaced against RTMCS M6) makes `defRe` match nothing for any
// OTHER machine's class -- RTMCS M6 generates as "M6App" -- so the whole
// pass silently no-ops and every `int nbs` parameter the body already uses
// as a set (`nbs.empty()`, `nbs.count(...)`, `for (auto _v : nbs)`) stays
// declared `int`, a real compile error (7 of `g++ -fsyntax-only`'s 9 errors
// on the ungated RTMCS M6 output are exactly this: "request for member
// 'empty'/'count' in 'nbs', which is of non-class type 'int'"). A pass that
// quietly does nothing is worse than one that fails loudly, so this now
// throws if `className` matches zero function definitions at all -- that
// can only mean the class name is wrong, not that the machine legitimately
// has no guarded-bool-method events (every machine this project generates
// has at least one).
function fixSetTypedParameters(tree: GeneratedTree, className: string): GeneratedTree {
  const hFile = tree.find((f) => f.path.endsWith(".h"));
  const ccFile = tree.find((f) => f.path.endsWith(".cc"));
  if (!hFile || !ccFile) return tree;
  let h = hFile.content;
  let cc = ccFile.content;

  const escClass = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const defRe = new RegExp(`^bool ${escClass}::(\\w+)\\(([^)]*)\\) \\{$`, "gm");
  const defs: { method: string; params: string; start: number }[] = [];
  for (let m = defRe.exec(cc); m; m = defRe.exec(cc))
    defs.push({ method: m[1], params: m[2], start: m.index });
  if (defs.length === 0)
    throw new Error(
      `fixSetTypedParameters: found no "bool ${className}::method(...) {" definitions in the ` +
        `generated .cc -- className is almost certainly wrong (it must match the name the ` +
        `emitter actually used, defaultName(machine)), not that this machine has zero events.`
    );

  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const bodyEnd = i + 1 < defs.length ? defs[i + 1].start : cc.length;
    const body = cc.slice(def.start, bodyEnd);
    let changed = false;
    const newParamList = def.params.split(",").map((raw) => {
      const p = raw.trim();
      const pm = /^int (\w+)$/.exec(p);
      if (!pm) return p;
      const name = pm[1];
      const usedAsContainer = new RegExp(
        `\\b${name}\\.(?:count|empty|at)\\(|for\\s*\\(\\s*auto\\s+\\w+\\s*:\\s*${name}\\s*\\)`
      );
      if (!usedAsContainer.test(body)) return p;
      changed = true;
      return `const std::set<Node>& ${name}`;
    });
    if (!changed) continue;
    const newParams = newParamList.join(", ");
    const escParams = def.params.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cc = cc.replace(new RegExp(`bool ${escClass}::${def.method}\\(${escParams}\\) \\{`),
      `bool ${className}::${def.method}(${newParams}) {`);
    h = h.replace(new RegExp(`bool ${def.method}\\(${escParams}\\);`),
      `bool ${def.method}(${newParams});`);
  }
  return tree.map((f) =>
    f.path.endsWith(".h") ? { ...f, content: h }
    : f.path.endsWith(".cc") ? { ...f, content: cc }
    : f);
}

// packetTypeLattice's tags come from a partition axiom that only proves SET
// MEMBERSHIP (`partition(CONTROL, {ROUTE}, {BEACON})`), never a `NAME = value`
// axiom -- so wsn-codegen's context-constant emission (codeEmitter.ts,
// off-limits), which only emits a bare `inline const int NAME` for a
// constant an axiom directly pins a numeric value to, never declares ROUTE or
// BEACON at all (DATA happens to also be pinned this way via `partition(TYPE,
// CONTROL, {DATA})` at a shallower context, which is why it alone was already
// present). But the generic app-layer rule catalog (rules.ts, also
// off-limits) still emits bare comparisons like `type.at(pkt) == BEACON` for
// clauses such as `type(pkt) = BEACON` -- it has no notion of PktType at all
// -- so a name PPkt's own enum knows perfectly well (`PktType::BEACON`) is
// simply undeclared as a bare identifier (task-7 finding). Declare the
// missing ones as plain ints, equal to the same values the enum already
// uses, so both spellings agree; skip any tag already declared (DATA) rather
// than risk a redefinition.
function addMissingPacketTypeConstants(tree: GeneratedTree, tagOf: Map<string, number>): GeneratedTree {
  const marker = "// ---- PPkt: the packet pattern class";
  return tree.map((f) => {
    if (!f.path.endsWith(".h")) return f;
    const at = f.content.indexOf(marker);
    if (at < 0) return f;
    const before = f.content.slice(0, at);
    const missing = [...tagOf.entries()]
      .filter(([tag]) => !new RegExp(`\\binline const int ${tag}\\b`).test(before));
    if (missing.length === 0) return f;
    const decls = missing.map(([tag, value]) =>
      `inline const int ${tag} = ${value};  // packet-type tag (netlayer packetTypeLattice; ` +
      `the partition axiom only proves set membership, never a value -- kept equal to PktType::${tag})`
    ).join("\n") + "\n";
    return { ...f, content: f.content.slice(0, at) + decls + f.content.slice(at) };
  });
}

// The app-layer's context-constant emission (codeEmitter.ts, off-limits)
// derives a partition's non-singleton part's VALUE straight off that one
// axiom's own text -- `partition(TYPE, CONTROL, {DATA})` becomes the literal
// `inline std::set<int> CONTROL = {1};` -- with no knowledge that CONTROL is
// itself partitioned further down the lattice (MintRoute's
// `partition(CONTROL, {ROUTE}, {BEACON})`, RTMCS's `partition(CONTROL,
// {RREQ}, {RREP}, {RRER})`). So the emitted CONTROL literal and the emitted
// per-leaf tags contradict each other: MintRoute's `create_bconPkt` guards
// both `CONTROL.count(type.at(pkt)) > 0` (true only for tag 1) and
// `type.at(pkt) == BEACON` (tag 2) -- mutually unsatisfiable -- and RTMCS is
// worse, silently excluding RREP (2) and RRER (3) from CONTROL everywhere
// (13 `CONTROL.count` sites). packetTypeLattice already holds the whole
// lattice, so fix it here in terms of THAT, generally: any node this project
// emits as a `std::set<int>` gets corrected to contain exactly its
// descendant leaves' tags, whatever those happen to be -- nothing here
// hardcodes the name "CONTROL", so a model with a deeper or differently
// shaped lattice is handled the same way.
function fixNonLeafSetConstants(tree: GeneratedTree, lattice: TypeLattice): GeneratedTree {
  const leafTagsOf = (node: string): number[] => {
    const kids = lattice.children.get(node);
    if (!kids) {
      const tag = lattice.tagOf.get(node);
      return tag === undefined ? [] : [tag];
    }
    return kids.flatMap(leafTagsOf);
  };
  return tree.map((f) => {
    if (!f.path.endsWith(".h")) return f;
    let content = f.content;
    for (const node of lattice.children.keys()) {
      const tags = [...new Set(leafTagsOf(node))].sort((a, b) => a - b);
      if (tags.length === 0) continue;
      const declRe = new RegExp(`(inline std::set<int> ${node} = )\\{[^}]*\\}`);
      content = content.replace(declRe, `$1{${tags.join(", ")}}`);
    }
    return { ...f, content };
  });
}

// A context axiom can legitimately name a constant that collides with a
// reserved C/C++ library macro -- MintRoute's C4 `axm2_9: INFINITY = 9999`
// does exactly this. wsn-codegen's context-constant emission (codeEmitter.ts,
// off-limits) transliterates the axiom identifier verbatim, so the generated
// header declares `inline const int INFINITY = 9999;`. <cmath> (pulled in
// transitively through ApplicationBase.h -> ... -> omnetpp.h) defines
// INFINITY as `#define INFINITY __builtin_inff()`, so that line preprocesses
// to `inline const int __builtin_inff() = 9999;` -- a bogus function
// declaration that collides with the real compiler builtin of the same name,
// and every declaration after it in the header fails to parse as a knock-on
// effect (task-7 finding). `#undef`-ing right before the declaration is the
// standard, harmless fix (a no-op if the name was never a macro to begin
// with) and needs no knowledge of which axiom produced the name.
const RESERVED_MACRO_NAMES = ["INFINITY", "NAN"];
function undefReservedMacros(tree: GeneratedTree): GeneratedTree {
  return tree.map((f) => {
    if (!f.path.endsWith(".h")) return f;
    let content = f.content;
    for (const name of RESERVED_MACRO_NAMES) {
      const declRe = new RegExp(`^([ \\t]*inline const \\w+ ${name}\\b.*)$`, "m");
      content = content.replace(declRe, `#undef ${name}\n$1`);
    }
    return { ...f, content };
  });
}

// ENC7 moves a packet attribute's storage onto the PPkt chunk; packetRules.ts
// intercepts every clause that used to read/write the field's machine-level
// map and refuses to translate it (no PktId -> PPkt* registry exists to make
// `p->getX()`/`setX()` valid from a bare id -- see packetRules.ts). Once that
// happens, wsn-codegen's codeEmitter (off-limits) still declares the old
// `std::map<PktId, T>` member and clears it in `initialize()` regardless --
// it emits from the machine's full variable list, with no knowledge that
// packetRules "hollowed out" some of those variables. That is dead state
// contradicting the encoding (task-7 finding, matching the brief's own
// "known cause #1"). Fix it here by removing exactly the members that are
// PROVABLY unreferenced: verified textually against the actual generated
// output (not assumed from the field list), so a field whose name happens to
// coincide with something still in use (e.g. a PPkt field of the same short
// name) is conservatively left alone rather than risk an incorrect deletion.
function stripDeadPacketFieldMaps(tree: GeneratedTree, fields: PacketField[]): GeneratedTree {
  const hFile = tree.find((f) => f.path.endsWith(".h"));
  const ccFile = tree.find((f) => f.path.endsWith(".cc"));
  if (!hFile || !ccFile) return tree;
  let h = hFile.content, cc = ccFile.content;
  const ccNoComments = cc.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

  for (const field of fields) {
    const id = field.ebName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declRe = new RegExp(`^[ \\t]*std::(?:map|set)<[^;\\n]*>\\s+${id};.*\\n`, "m");
    if (!declRe.test(h)) continue;                       // not a declared machine-state member
    const clearLineRe = new RegExp(`^[ \\t]*${id}\\.clear\\(\\);[ \\t]*\\n`, "m");
    if (!clearLineRe.test(cc)) continue;                 // no clear() call to remove alongside it
    const occurrences = ccNoComments.match(new RegExp(`\\b${id}\\b`, "g")) ?? [];
    if (occurrences.length !== 1) continue;               // referenced somewhere besides the clear() call -- leave it
    h = h.replace(declRe, "");
    cc = cc.replace(clearLineRe, "");
  }
  return tree.map((f) =>
    f.path.endsWith(".h") ? { ...f, content: h }
    : f.path.endsWith(".cc") ? { ...f, content: cc }
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
  // Relative to THIS package, not to ROOT joined with a hardcoded "netlayer".
  // The hardcoded form kept writing to the old sibling path after this package
  // moved inside wsn-codegen, silently generating into a directory nobody reads.
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", outDir);
  mkdirSync(out, { recursive: true });
  const tree = generateNet(project, machine);
  for (const f of tree) writeFileSync(resolve(out, f.path), f.content, "utf8");
  const n = (tree.map((f) => f.content).join("\n").match(/UNTRANSLATED/g) ?? []).length;
  console.log(`${project} ${machine}: ${tree.length} files -> ${out}/  (${n} untranslated)`);
}

// The network-layer half of the generator: everything the app-layer pipeline
// emits, PLUS the packet classes (PPkt), the per-type transmit methods
// (sendBeaconBroadcast / sendRouteBroadcast / …), the flooding scheduler and
// the medium binding.
//
// It is NOT a separate generator and there is no separate command. `pipeline.ts`
// calls tryNetworkLayer() for every v4 generation; it returns null when the
// model has no medium to bind, and that model keeps the app-layer shell. So one
// project + one target machine still produces exactly three files, one module —
// the model decides how much of it is there.
import { flatten } from "./flattener";
import { resolveEncodings } from "./encodingResolver";
import { emit } from "./codeEmitter";
import { RULES } from "./rules";
import type { Rule } from "./rules";
import type { EncodedMachine, GeneratedTree, RawModel } from "./types";
import { esc } from "./text";
import type { TypeLattice } from "./packetTypes";
import { packetModelFor } from "./packetModel";
import type { PacketField, PacketModel } from "./packetModel";
import { emitPacketClasses } from "./packetEmitter";
import { packetRules } from "./packetRules";
import { miscRules } from "./miscRules";
import { scalarRules } from "./scalarRules";
import { composedRules } from "./composedRules";
import { nestedMapVars, nestedMapRules, fixNestedMapDeclarations } from "./nestedMap";
import { pairKeyedVars, pairKeyedRules, fixPairKeyedDeclarations } from "./pairKeyed";
import { installScheduler } from "./scheduler";
import { bindNodeIdentity } from "./nodeIdentity";
import { installNetProtocolShell, renameCommPatternPair } from "./netProtocolShell";
import { imageRules, insertImageHelper } from "./imageRules";
import { composeRules } from "./compose";
import { mediumRules } from "./mediumRules";
import { planMedium, bindMedium, modelHasMedium } from "./mediumBinding";
import { fixAliasedEncodings, fixBooleanEncodings } from "./aliasEncoding";
import { carrierSetsOf } from "./text";
import { emittedMethods, headerOf, implOf, implText } from "./emitted";

// PPkt and everything that follows from it, WITHOUT the network-layer shell.
//
// Shared by the two things that need packet classes: a network-layer module
// (tryNetworkLayer, below, which then adds the protocol shell and the medium)
// and an app-layer module that carries PPkt but no medium -- the SensorApp shell
// plus the packet pattern class, which is emitted structure v5.
//
// `pm` is a parameter rather than derived here BECAUSE of v5: the packet model
// may come from a DIFFERENT Event-B project than the module being emitted. The
// packet pattern class is a pattern, and a pattern is not owned by the protocol
// it was read off.
export interface PacketClassInput {
  raw: RawModel;
  model: EncodedMachine;
  name: string;
  pm: PacketModel;
  carriers: Set<string>;
}

export function emitWithPacketClasses(
  { raw, model, name, pm, carriers }: PacketClassInput): GeneratedTree {
  // Composition is installed for the duration of this generation only, so the
  // app-layer catalog module is never mutated for other callers.
  const nested = nestedMapVars(model);
  const pairKeyed = pairKeyedVars(model);
  // ⚠ pairKeyedRules FIRST, and rule order here is BEHAVIOUR, not style. With
  // them last, SETEXPR-PAIR-MEM claims `y ↦ x ∈ dom(sentEst)` and emits "" --
  // the deliberate intercept-and-refuse technique -- so update_route stayed
  // untranslated even though PK-DOM matched the clause in isolation. That cost
  // a debugging round the first time this was built.
  const composed = composeRules([...pairKeyedRules(pairKeyed, model),
    ...packetRules(pm.fields), ...mediumRules(pm.lattice), ...miscRules(),
    ...scalarRules(), ...composedRules(carriers), ...nestedMapRules(nested), ...imageRules()]);
  let tree = withRules(composed, () => emit(model, name, 2, raw.contexts));

  // Splice the packet classes into the header, above the module class.
  const { header, impl } = emitPacketClasses(pm);
  tree = tree.map((f) =>
    f.path.endsWith(".h") ? { ...f, content: spliceHeader(f.content, header) }
    : f.path.endsWith(".cc") ? { ...f, content: spliceImpl(f.content, impl) }
    : f);

  tree = renameReservedIdentifiers(tree);
  tree = stripDeadPacketFieldMaps(tree, pm.fields);
  tree = addMissingPacketTypeConstants(tree, pm.lattice.tagOf);
  tree = fixNonLeafSetConstants(tree, pm.lattice);
  tree = fixSetTypedParameters(tree, name);
  tree = fixNestedMapDeclarations(tree, nested);
  // ⚠ The encoding resolver calls a pair-keyed function an ordinary function
  // and declares `std::map<int, T>` -- a key of the wrong ARITY, on six
  // variables per case study. Nothing caught it because every clause using one
  // was `// UNTRANSLATED`; translating them is what makes the declaration matter.
  tree = fixPairKeyedDeclarations(tree, pairKeyed);
  tree = insertPacketRegistry(tree);
  tree = insertImageHelper(tree);
  return tree;
}

// Generate the merged module WITH its network layer, or return null if this
// model has none — in which case the caller emits the app-layer module instead.
//
// The test is the medium, read off the model: does it serialise a packet field
// by field, hand it to a shared relation, and deliver it to whoever a
// propagation variable names? A model that does is a network-layer model. The
// app-layer chain pM1 → uM2 → pM3 has the CommPattern pair but none of that, so
// it answers no and keeps its ApplicationBase shell — its emitted bytes are
// frozen evidence behind the paper's similarity figures and must not move.
//
// The model built here is this function's OWN: fixAliasedEncodings and
// fixBooleanEncodings MUTATE it, and a bail-out must not leave the caller
// holding a model those passes have already rewritten.
export interface NetworkLayerAttempt {
  /**
   * The flattened, encoded model. Built once here and handed back so the caller
   * does not rebuild it: when `tree` is null the app-layer path emits from THIS
   * model rather than flattening and encoding the same machine a second time.
   * Untouched by any network-layer pass -- see the ordering note below.
   */
  model: EncodedMachine;
  /** The generated module, or null when the model has no network layer. */
  tree: GeneratedTree | null;
}

export function tryNetworkLayer(raw: RawModel, machine: string, name: string): NetworkLayerAttempt {
  const model = resolveEncodings(flatten(raw, machine));

  // Both bail-outs come BEFORE the two encoding fixes below, and that ordering
  // is the reason the model can be handed back at all. The fixes MUTATE it; a
  // model returned to the app-layer path after they had run would be a
  // different model from the one that path builds for itself, so the app layer's
  // output would silently depend on how far into this function a bail-out got.

  // No packet-type partition means no PPkt, so nothing here applies.
  const pm = packetModelFor(raw, model);
  if (!pm) return { model, tree: null };
  // The medium decides. Asked BEFORE emitting, because the answer chooses the
  // shell, and the shell is what the rest of this pipeline attaches to.
  if (!modelHasMedium(model, pm)) return { model, tree: null };

  // wsn-codegen's encodingResolver never dereferences a context-level type
  // alias (MintRoute's `WSN = ND ↔ ND`), so a variable declared merely
  // `∈ WSN` (wsnLinks, crashedLinks) silently defaults to a scalar "set"
  // instead of "pair-set" -- see aliasEncoding.ts for the full account. Fix
  // it here, on the model this pipeline owns, rather than in encodingResolver
  // itself (off-limits).
  fixAliasedEncodings(raw, model);
  // Same "encodingResolver's infer() silently defaults to 'set'" family of
  // gap, this time for a variable typed directly against the builtin BOOL
  // (MintRoute M4's `bcastRouTimer ∈ BOOL`) -- see aliasEncoding.ts.
  fixBooleanEncodings(model);

  // The model's carrier sets: membership in one is a typing statement, not a
  // container lookup (setExpr.ts memberOfLeaf).
  const carriers = carrierSetsOf(raw);

  let tree = emitWithPacketClasses({ raw, model, name, pm, carriers });

  // The network-layer shell replaces the app layer's SensorApp shell BEFORE
  // anything patches it: the identity binding, the medium binding and the
  // scheduler all attach to methods this pass emits.
  tree = installNetProtocolShell(tree, name, machine);
  // Before planMedium: the CommPattern pair moves to NetworkProtocolBase's own
  // names here, and planMedium resolves the delivery method by reading the
  // provenance comment above it. Renaming afterwards would leave bindMedium
  // calling a method that no longer exists.
  tree = renameCommPatternPair(tree, name);
  tree = bindNodeIdentity(tree, model, name);
  // The medium binding is planned against the FINAL emitted signatures (the
  // CommPattern rename and fixSetTypedParameters have both run by now), and it
  // must precede the scheduler: which events the simulator realises decides
  // which events the scheduler may not fire on its own.
  const plan = planMedium(model, pm, implText(tree), name);
  if (plan) tree = bindMedium(tree, plan, name);
  // The medium binding's own exclusions, with the reason the emitted comment
  // has always carried.
  const notScheduled = new Map([...(plan?.realisedByMedium ?? [])].map((l) =>
    [l, "the simulator's medium realises it"] as const));
  tree = installScheduler(tree, model, name, pm.fields, notScheduled, plan !== null, carriers);
  return { model, tree };
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
// `className` MUST be the same name the emitter actually used (`netName
// (machine)` -- "M4Net"/"M6Net"/whatever the machine label produces), not a
// literal "M4Net". Hardcoding the class name here (the bug this fixes, task-7
// finding surfaced against RTMCS M6) makes `defRe` match nothing for any
// OTHER machine's class -- RTMCS M6 generates as "M6Net" -- so the whole
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
// The identity binding: PktId <-> PPkt.
//
// The model addresses a packet by an integer id and keeps its attributes in
// PKT-keyed functions. ENC7 moved those attributes onto a chunk, which left the
// generated code holding an `int` with no way to reach the chunk -- so every
// read, write and domain test on a packet field had to be refused, and every
// creating event refused to fire with it. This map is that missing link, and it
// is also literally the DOMAIN of those functions: a packet is in
// dom(pktSeqNo) exactly when this node holds it. That is why PKT-DOM and
// PKT-DOM-NOT translate to a lookup here rather than to `true`.
//
// Emitted as a MEMBER, not file scope: the packet-keyed functions are machine
// variables, so each node owns its own: a shared store would let one node see
// another's packets.
function insertPacketRegistry(tree: GeneratedTree): GeneratedTree {
  const ANCHOR = "    // ── Event-B machine state ──";
  return tree.map((f) => {
    if (!f.path.endsWith(".h") || !f.content.includes(ANCHOR)) return f;
    const registry = [
      ANCHOR,
      "    // Identity binding: the model's PktId to the chunk carrying its fields.",
      "    // This map is also dom(pktSeqNo), dom(pktSrc), ... -- see PKT-DOM.",
      "    std::map<PktId, inet::Ptr<PPkt>> pktStore;",
      "    // dom() of the PARTIAL packet-attribute functions. Distinct from",
      "    // pktStore: a chunk may exist before the model considers the packet",
      "    // created, and a TOTAL context function (initialSrcAddr) is defined",
      "    // for every packet regardless. Conflating the two made every",
      "    // creating event's freshness guard unsatisfiable.",
      "    std::set<PktId> pktLive;",
      "    PktId nextPktId = 1;",
      "    PPkt *pktOf(PktId id) {",
      "        auto it = pktStore.find(id);",
      "        return it == pktStore.end() ? nullptr : it->second.get();",
      "    }",
      "    PPkt *ensurePkt(PktId id) {",
      "        auto& p = pktStore[id];",
      "        if (!p) p = inet::makeShared<PPkt>();",
      "        return p.get();",
      "    }",
      "    PktId newPktId() { PktId id = nextPktId++; ensurePkt(id); return id; }",
    ].join("\n");
    return { ...f, content: f.content.replace(ANCHOR, registry) };
  });
}

export function fixSetTypedParameters(tree: GeneratedTree, className: string): GeneratedTree {
  const hFile = headerOf(tree);
  const ccFile = implOf(tree);
  if (!hFile || !ccFile) return tree;
  let h = hFile.content;
  let cc = ccFile.content;

  const defs = emittedMethods(cc, className);
  if (defs.length === 0)
    throw new Error(
      `fixSetTypedParameters: found no "bool ${className}::method(...) {" definitions in the ` +
        `generated .cc -- className is almost certainly wrong (it must match the name the ` +
        `emitter actually used, name), not that this machine has zero events.`
    );

  // Body windows are sliced from THIS snapshot, never from the running `cc`.
  // Slicing from a string that the loop is also rewriting was a real bug: each
  // applied fix grows the text by 18 characters (`int ` -> `const
  // std::set<Node>& `), so from the second fix onward every `defs[i].start`
  // offset pointed 18n characters too early. The window then straddled the
  // previous method's tail and truncated its own -- a parameter used as a
  // container only in a method's last statement would fall outside it, stay
  // `int`, and emit code that does not compile. Edits are collected here and
  // applied in one pass afterwards, so no offset is ever read from mutated text.
  const source = cc;
  const edits: { ccFrom: RegExp; ccTo: string; hFrom: RegExp; hTo: string }[] = [];

  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const bodyEnd = i + 1 < defs.length ? defs[i + 1].start : source.length;
    const body = source.slice(def.start, bodyEnd);
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
    const escParams = esc(def.params);
    edits.push({
      ccFrom: new RegExp(`bool ${esc(className)}::${def.method}\\(${escParams}\\) \\{`),
      ccTo: `bool ${className}::${def.method}(${newParams}) {`,
      hFrom: new RegExp(`bool ${def.method}\\(${escParams}\\);`),
      hTo: `bool ${def.method}(${newParams});`,
    });
  }
  for (const e of edits) {
    cc = cc.replace(e.ccFrom, e.ccTo);
    h = h.replace(e.hFrom, e.hTo);
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
// effect (task-7 finding).
//
// The first fix here was `#undef INFINITY` just above the declaration. It
// compiles, but it is not contained: the undef and the int constant then stand
// for the REST of every translation unit including this header, so anything
// downstream that expects `INFINITY` to be the float macro silently gets 9999
// instead, with no diagnostic (audit finding). Renaming the generated symbol
// avoids that entirely -- no macro is disturbed, nothing downstream changes
// meaning, and the Event-B name survives in the trailing provenance comment
// the emitter already writes on each constant.
const RESERVED_MACRO_NAMES = ["INFINITY", "NAN"];
const RENAME_PREFIX = "EB_";
function renameReservedIdentifiers(tree: GeneratedTree): GeneratedTree {
  // Only rename a name this module actually DECLARES. If the generated code
  // merely mentions `INFINITY` without declaring it, the reference belongs to
  // <cmath> and renaming it would break a correct use.
  const declaresIt = (name: string) =>
    tree.some((f) => f.path.endsWith(".h") &&
      new RegExp(`^[ \\t]*inline const \\w+ ${name}\\b`, "m").test(f.content));

  const targets = RESERVED_MACRO_NAMES.filter(declaresIt);
  if (targets.length === 0) return tree;

  // Renames CODE only, never a trailing `// ...` comment. The emitter writes
  // each constant's originating axiom there verbatim ("C4 axm2_9: INFINITY =
  // 9999"), and that provenance is the audit trail back to the Event-B source
  // -- rewriting it would make the comment quote an axiom that does not exist.
  // A `//` is treated as starting a comment only when the text before it has
  // balanced double quotes, so a `//` inside a string literal is left alone.
  const renameCode = (line: string): string => {
    let cut = -1;
    for (let i = 0; i + 1 < line.length; i++) {
      if (line[i] === "/" && line[i + 1] === "/") {
        const quotes = (line.slice(0, i).match(/(?<!\\)"/g) ?? []).length;
        if (quotes % 2 === 0) { cut = i; break; }
      }
    }
    const code = cut < 0 ? line : line.slice(0, cut);
    const rest = cut < 0 ? "" : line.slice(cut);
    let out = code;
    for (const name of targets)
      out = out.replace(new RegExp(`\\b${name}\\b`, "g"), `${RENAME_PREFIX}${name}`);
    return out + rest;
  };

  return tree.map((f) => {
    if (f.path.endsWith(".ned")) return f;   // NED has no C preprocessor
    return { ...f, content: f.content.split("\n").map(renameCode).join("\n") };
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
  const hFile = headerOf(tree);
  const ccFile = implOf(tree);
  if (!hFile || !ccFile) return tree;
  let h = hFile.content, cc = ccFile.content;
  const ccNoComments = cc.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

  for (const field of fields) {
    const id = esc(field.ebName);
    const declRe = new RegExp(`^[ \\t]*std::(?:map|set)<[^;\\n]*>\\s+${id};.*\\n`, "m");
    if (!declRe.test(h)) continue;                       // not a declared machine-state member
    const clearLineRe = new RegExp(`^[ \\t]*${id}\\.clear\\(\\);[ \\t]*\\n`, "m");
    if (!clearLineRe.test(cc)) continue;                 // no clear() call to remove alongside it
    const occurrences = ccNoComments.match(new RegExp(`\\b${id}\\b`, "g")) ?? [];
    if (occurrences.length !== 1) continue;               // referenced somewhere besides the clear() call -- leave it
    // The header must be checked too. Counting only the .cc was enough to
    // prove the member unused there, but the declaration being REMOVED lives
    // in the .h -- an inline accessor, in-class initializer or default
    // argument mentioning the field would have been deleted out from under
    // (audit finding). Strip comments, then require the single remaining
    // mention to be the declaration itself.
    const hNoComments = h.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    const hOccurrences = hNoComments.match(new RegExp(`\\b${id}\\b`, "g")) ?? [];
    if (hOccurrences.length !== 1) continue;              // used elsewhere in the header -- leave it
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
  // Throws rather than appending at EOF, matching spliceHeader. The silent
  // fallback still compiled, so a future emitter change that moved or renamed
  // Define_Module would have quietly relocated the packet constructors with
  // nothing to show for it (audit finding). A missing anchor means the
  // emitter's output shape changed and this splice needs revisiting.
  if (at < 0)
    throw new Error(
      "Generated .cc has no Define_Module( to splice the packet classes before. " +
        "The emitter's output shape changed; update spliceImpl.",
    );
  return cc.slice(0, at + 1) + block + "\n" + cc.slice(at + 1);
}


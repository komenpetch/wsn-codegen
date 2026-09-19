// Post-emit passes: rewriting the emitted C++ after codeEmitter has produced it.
//
// These do not translate anything. Each one finds an anchor in the generated
// text and rewrites around it, correcting something the emitter could not know
// or could not express -- a member declared with the wrong C++ type, a context
// constant the axioms never pinned, an identifier that collides with a C macro,
// a packet-field map that ENC7 made dead.
//
// They lived in netPipeline.ts, which made that file two things at once: the
// two orchestration functions that decide what a model gets, and six text
// passes that have nothing to do with that decision. The other passes of the
// same kind already have their own modules (nestedMap, pairKeyed, imageRules,
// moduleNamespace, appTransmit, nodeIdentity, scheduler, mediumBinding,
// netProtocolShell), so the same kind of thing had two different homes
// depending on which one happened to be written first.
//
// ⚠ An anchor here is a PRECONDITION. See emitted.ts's mustFind / mustReplace
// for why, and what a silent miss costs.

import type { GeneratedTree } from "./types";
import type { PacketField } from "./packetModel";
import type { TypeLattice } from "./packetTypes";
import { esc } from "./text";
import { emittedMethods, headerOf, implOf } from "./emitted";


// The generated header opens with a banner then the class; put the packet
// classes after the last #include and before the first `class `.
export function spliceHeader(h: string, block: string): string {
  const at = h.indexOf("\nclass ");
  if (at < 0) throw new Error("Generated header has no class declaration to splice before.");
  return h.slice(0, at + 1) + block + "\n" + h.slice(at + 1);
}

export function spliceImpl(cc: string, block: string): string {
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
export function insertPacketRegistry(tree: GeneratedTree): GeneratedTree {
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
export function addMissingPacketTypeConstants(tree: GeneratedTree, tagOf: Map<string, number>): GeneratedTree {
  const marker = "// ---- PPkt: the packet pattern class";
  return tree.map((f) => {
    if (!f.path.endsWith(".h")) return f;
    const at = f.content.indexOf(marker);
    if (at < 0) return f;
    const before = f.content.slice(0, at);
    // ⚠ BOTH spellings the context emitter can produce, not just the int. A
    // partition's SINGLETON part becomes `inline const int DATA = 0;` and its
    // NON-SINGLETON part becomes `inline std::set<int> CONTROL = {1};`. With
    // nothing splitting CONTROL further it is a set by its axiom AND a lattice
    // leaf by having no children, so checking only the int spelling declared it
    // a second time: `redefinition of 'CONTROL' … 'const int' vs 'std::set<int>'`.
    // The bare int is dead there anyway -- the emitted code reaches the enum as
    // `PktType::CONTROL` and the set as `CONTROL.count(...)`, never the constant.
    const missing = [...tagOf.entries()]
      .filter(([tag]) =>
        !new RegExp(`\\binline const int ${tag}\\b`).test(before)
        && !new RegExp(`\\binline std::set<int> ${tag}\\b`).test(before));
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
export function fixNonLeafSetConstants(tree: GeneratedTree, lattice: TypeLattice): GeneratedTree {
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
export function renameReservedIdentifiers(tree: GeneratedTree): GeneratedTree {
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
export function stripDeadPacketFieldMaps(tree: GeneratedTree, fields: PacketField[]): GeneratedTree {
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

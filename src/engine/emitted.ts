// The emitted C++ as a surface the later passes work against: reading facts
// back out of it, and writing into it safely.
//
// It began as the reading half only, and the opening sentence still said so
// after `mustFind`, `mustReplace` and `redeclareMembers` were added — a header
// comment describing half its own file. That is the same stale-doc-comment
// class this project has already been bitten by, where the generated header
// carried a SensorApp description above a NetworkProtocolBase class and every
// sentence of it was false.
//
// Two halves, and they belong together because they are the same seam: a pass
// that reads an anchor and a pass that rewrites one both depend on the exact
// shape codeEmitter produces, so when that shape moves there is one file to
// re-read rather than two.
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

// ── Writing INTO the emitted code, and failing loudly when the anchor is gone ──
//
// Seventeen passes rewrite the emitted text by finding an anchor in it, and a
// pass whose anchor has drifted does not fail -- `String.replace` with no match
// returns the string unchanged and `indexOf` returns -1 for the caller to
// ignore. Measured on this tree: seven of the seventeen could return the tree
// untouched without raising.
//
// Most of those surface at clang, because the half that DID splice then
// references what the other half never declared. Two do not, and they are the
// expensive ones: a scheduler whose timer hook never matched, and a node
// identity binding whose initialize() never matched, both produce a module that
// compiles, runs, and executes no model events. This project has paid for that
// shape twice already -- once as a module with "no scheduler and no medium
// binding, indistinguishable from a model that simply has no network layer",
// and once as a class-name regex that matched nothing so a test "passed while
// checking zero methods".
//
// So an anchor is a PRECONDITION, not a hint. These two say so.

/**
 * Rewrite emitted member declarations to a different C++ type.
 *
 * The encoding resolver has no form for a structured Event-B type, so two
 * passes correct its output after the fact: `nestedMap` (a variable whose range
 * is itself a function) and `pairKeyed` (a variable whose KEY is a maplet).
 * Both had their own copy of this, identical but for the replacement string —
 * same early return, same `tree.map`, same declaration regex. A second copy of
 * a regex is how the two answers drift, and this one is load-bearing: it is
 * what stops `std::map<int, T>` being declared for a key of the wrong arity.
 *
 * ⚠ A variable handed here MUST have a declaration to rewrite. Missing one
 * means the emitter declared it some other way and the C++ type is now wrong
 * for every clause the caller went on to translate — a compile error at best,
 * so it raises rather than leaving the wrong declaration in place.
 */
export function redeclareMembers(tree: GeneratedTree,
  members: readonly { name: string; cppType: string; note: string }[]): GeneratedTree {
  if (members.length === 0) return tree;
  return tree.map((f) => {
    if (!f.path.endsWith(".h")) return f;
    let content = f.content;
    for (const m of members) {
      const decl = new RegExp(`^([ \\t]*)std::\\w+<[^;\\n]*>\\s+${esc(m.name)};.*$`, "m");
      if (!decl.test(content))
        throw new Error(
          `redeclareMembers: no member declaration for '${m.name}' to rewrite to ` +
          `'${m.cppType}'. The emitter declared it some other way, so its C++ type ` +
          `no longer matches the clauses translated against it.`);
      content = content.replace(decl, `$1${m.cppType} ${m.name};   // ${m.note}`);
    }
    return { ...f, content };
  });
}

/** Index of `needle` in `text`, or throw naming the pass and the anchor. */
export function mustFind(text: string, needle: string, pass: string): number {
  const at = text.indexOf(needle);
  if (at < 0)
    throw new Error(
      `${pass}: the emitted code has no ${JSON.stringify(needle)} to attach to. ` +
      `The emitter's output shape changed; this pass needs revisiting rather than skipping.`);
  return at;
}

/**
 * `text.replace(pattern, replacement)`, but throwing when the pattern matches
 * nothing. The silent version is the defect: the pass reports success and the
 * behaviour it was supposed to install is simply absent.
 */
export function mustReplace(text: string, pattern: string | RegExp, replacement: string,
  pass: string): string {
  const hit = typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
  if (!hit)
    throw new Error(
      `${pass}: nothing in the emitted code matches ${pattern.toString()}. ` +
      `The emitter's output shape changed; this pass needs revisiting rather than skipping.`);
  // ⚠ The `.test()` above advances a GLOBAL regex's lastIndex, and a reset
  // looks necessary here. It is not: String.prototype.replace sets lastIndex
  // to 0 itself before a global match. Verified by mutation -- deleting a
  // reset placed here changed no test and no emitted byte, so it was removed
  // rather than left as defensive-looking code with a false rationale.
  return text.replace(pattern, replacement);
}

// ── Reachability: events nothing can ever enable ────────────────────────────
//
// An event is schedulable when its parameters can be BOUND. That is a different
// question from whether its guards can ever HOLD, and the gap between them was
// measured: the app-layer module emitted 18 `try_` methods and 7 ever fired.
// The other 11 were not translation gaps -- each needed something no runnable
// code produces.
//
// One rule in three forms. A guard REQUIRES something; some method PRODUCES it:
//
//   container non-empty   `X.count(..) > 0` / `inRan(X, ..)`   X.insert / X[..] =
//   a packet of a type    `getType() == PktType::T`            setType(PktType::T)
//   a scalar value        `v == TRUE`                          any assignment to v
//
// ⚠ READ THE EMITTED MODULE, NOT THE MODEL. `WiMedium` and `sentDown` are filled
// by the ARRIVAL, which is emitted binding code and not an Event-B event at all;
// a producer scan over the model would find no writer, call receive_controlPkt
// unreachable and silently delete the flood.
//
// ⚠ AND "NOT SCHEDULED" IS NOT "NEVER RUNS". `send_up` is excluded from the
// poll loop because the arrival calls it directly -- it runs on every reception
// and fills `ctlNeighbours`, which receive_controlPkt guards on. Only events
// that genuinely never execute may be masked, which is why `neverRuns` is passed
// in rather than inferred from the exclusion list.
//
// Conservative by construction: a NEGATED guard states an absence and is
// skipped, so nothing is dropped on the strength of a requirement this cannot
// read. Under-removing leaves a dead method; over-removing breaks behaviour.
interface Produced { containers: Set<string>; types: Set<string>; scalars: Set<string> }

function producedBy(text: string): Produced {
  const containers = new Set<string>(), types = new Set<string>(), scalars = new Set<string>();
  // TWO patterns, because neither covers the other's shape:
  //
  //   anywhere    `X.insert(`        also catches the arrival's rollback-aware
  //                                  staging, `bool _st_X = X.insert(..).second;`
  //                                  whose LINE begins with `bool`.
  //   line-start  `X[` or `X.insert` catches `ctlNeighbours[pkt].insert(nb)` and
  //                                  `nbHops[s][pkt] = nbh`, where the identifier
  //                                  before `.insert` is `]`, not a word.
  //
  // ⚠ Missing either one deletes live events and CASCADES: the staged write is
  // what fills WiMedium, so receive_controlPkt looked unreachable, and dropping
  // it removed its own writes, which took out the next event, and so on until
  // the flood was gone. A write is a statement and a read is an expression, but
  // the emitted forms are varied enough that one regex cannot see them all.
  for (const m of text.matchAll(/(\w+)\.insert\(/g)) containers.add(m[1]);
  for (const m of text.matchAll(/^\s*(\w+)(?:\[|\.insert\b)/gm)) containers.add(m[1]);
  for (const m of text.matchAll(/setType\(PktType::(\w+)\)/g)) types.add(m[1]);
  for (const m of text.matchAll(/^\s*(\w+)\s*=[^=]/gm)) scalars.add(m[1]);
  return { containers, types, scalars };
}

// Drop every `!( … )` group, parens balanced.
//
// ⚠ A container named inside a negation is NOT required to be non-empty — the
// guard wants the parameter to be OUTSIDE it, which says nothing about whether
// it has members. The CommPattern's own originator guard is exactly this shape:
//
//     x ∈ ND ∖ Dests   ->   (ND.count(x) > 0 && !(Dests.count(x) > 0))
//
// and `Dests` was being recorded as required, so every creating event was
// dropped for a reason that is false. `Dests` is a context constant the harness
// populates; nothing in the emitted code fills it, and nothing needs to.
//
// The whole group goes, including anything positive inside it: `!(a && b)` is
// an absence claim about the conjunction, so neither term is required.
// Conservative in the safe direction — under-removing leaves a dead method,
// over-removing breaks behaviour.
function stripNegatedGroups(expr: string): string {
  // Past a balanced parenthesised group starting at `k`.
  const past = (k: number): number => {
    let depth = 0, j = k;
    for (; j < expr.length; j++) {
      if (expr[j] === "(") depth++;
      else if (expr[j] === ")" && --depth === 0) return j + 1;
    }
    return j;
  };

  let out = "";
  for (let i = 0; i < expr.length;) {
    // `!=` is a comparison, not a negation; the second character decides.
    if (expr[i] !== "!" || expr[i + 1] === "=") { out += expr[i++]; continue; }

    let j = i + 1;
    if (expr[j] === "(") {
      j = past(j);                       // !( … )
    } else {
      // A bare negated term: `!inRan(a, b)`, `!X.count(y)`, `!X.empty()`.
      // Measured, not hypothetical -- the corpus has three `!inRan(` with no
      // parentheses of their own, and leaving them would record the very
      // container the guard wants the parameter to be OUTSIDE of.
      while (j < expr.length && /[A-Za-z0-9_.:]/.test(expr[j])) j++;
      if (expr[j] === "(") j = past(j);
    }
    i = j;
  }
  return out;
}

function requiredBy(body: string): Produced {
  const containers = new Set<string>(), types = new Set<string>(), scalars = new Set<string>();
  for (const line of body.split("\n")) {
    const g = /^\s*if \(!\((.*)\)\)\s*$/.exec(line);
    if (!g) continue;
    const expr = g[1];
    // ⚠ No `startsWith("!")` short-circuit any more. It skipped the WHOLE line
    // when the expression merely BEGAN with a negation, so a positive
    // requirement after it (`!(a) && floodTbl.count(x) > 0`) was missed too.
    // The stripper removes the negated terms and leaves the rest.
    const positive = stripNegatedGroups(expr);
    for (const m of positive.matchAll(/inRan\((\w+),/g)) containers.add(m[1]);
    for (const m of positive.matchAll(/(\w+)\.count\([^)]*\)\s*>\s*0/g)) containers.add(m[1]);
    for (const m of positive.matchAll(/getType\(\)\s*==\s*PktType::(\w+)/g)) types.add(m[1]);
    const sc = /^(\w+) == (?:TRUE|FALSE)$/.exec(expr);
    if (sc) scalars.add(sc[1]);
  }
  return { containers, types, scalars };
}

export function unreachableEvents(cc: string, cls: string,
  candidates: readonly string[], neverRuns: ReadonlySet<string>,
  // label → the packet tag that event stamps on a fresh packet. The scheduler
  // emits the stamp, so it is absent from `cc` and has to be supplied.
  stampsOf: ReadonlyMap<string, string> = new Map()): Map<string, string> {
  const methods = emittedMethods(cc, cls);
  // ⚠ `m.label ?? m.method`, the same key signatures() uses. Only the renamed
  // CommPattern pair carries a provenance comment, so keying on `label` alone
  // finds two methods out of forty -- every lookup misses, nothing is ever
  // dropped, and the pass silently does nothing.
  const byLabel = new Map(methods.map((m) => [m.label ?? m.method, m]));
  const bodyOf = (m: EmittedMethod): string => {
    const end = cc.indexOf("\n}", m.start);
    return end < 0 ? cc.slice(m.start) : cc.slice(m.start, end);
  };

  const dropped = new Map<string, string>();
  for (;;) {
    // Everything except the bodies that can never execute.
    let runnable = cc;
    for (const [label, m] of byLabel)
      if (neverRuns.has(label) || dropped.has(label))
        runnable = runnable.replace(bodyOf(m), "");
    const prod = producedBy(runnable);
    // A tag is produced by any creating event still standing.
    for (const [label, tag] of stampsOf)
      if (!neverRuns.has(label) && !dropped.has(label)) prod.types.add(tag);

    let changed = false;
    for (const label of candidates) {
      if (dropped.has(label) || neverRuns.has(label)) continue;
      const m = byLabel.get(label);
      if (!m) continue;
      const body = bodyOf(m);
      const req = requiredBy(body);
      // ⚠ AN EVENT MAY SATISFY ITS OWN REQUIREMENT. A creating event guards
      // `type(pkt) = BEACON` on a parameter it is about to MINT, and the
      // scheduler stamps the tag rather than searching for a packet that
      // already carries it -- "satisfied by CONSTRUCTION", as planFor puts it.
      // Judged against other methods only, create_bconPkt was dropped for
      // "nothing creates a BEACON packet", which is precisely what it does.
      const own = producedBy(body);
      const ownStamp = stampsOf.get(label);
      if (ownStamp) own.types.add(ownStamp);
      for (const t of own.types) req.types.delete(t);
      for (const c of own.containers) req.containers.delete(c);
      let why: string | undefined;
      for (const c of req.containers)
        if (!prod.containers.has(c)) { why = `nothing that runs ever fills \`${c}\``; break; }
      if (!why) for (const t of req.types)
        if (!prod.types.has(t)) { why = `nothing that runs ever creates a ${t} packet`; break; }
      if (!why) for (const s of req.scalars)
        if (!prod.scalars.has(s)) { why = `it guards \`${s}\`, which nothing ever assigns`; break; }
      if (why) { dropped.set(label, why); changed = true; }
    }
    if (!changed) return dropped;
  }
}

// The LEAVES of the emitted packet-type lattice, read off the enum the emitter
// produced rather than off the model.
//
// Two reasons it is read here and not derived from the RawModel's contexts.
// First, what a stamp must name is an enum member that EXISTS in this module --
// `PktType::X` for an X the emitter never declared does not compile -- so
// reading the enum tests exactly the thing that has to be true. Second, the
// emitter already made the leaf/non-leaf decision when it built the enum:
// MintRoute's is `DATA, ROUTE, BEACON` with no CONTROL member, because CONTROL
// is partitioned further and only a leaf carries a packet type. Re-deriving
// that from the axioms would be a second answer to a settled question.
export function packetTypeLeaves(h: string): Set<string> {
  const at = h.indexOf("enum class PktType");
  if (at < 0) return new Set();
  // ⚠ `indexOf` returns -1 on a miss and `slice(at, -1)` then hands back most
  // of the header, so every `NAME = 0,` line in it would read as a packet-type
  // leaf. That set feeds the scheduler's `typeOf`, which decides whether a
  // creating event stamps a type at all -- and a wrong or absent stamp is the
  // "scheduled, reachable, called every tick, never once firing" failure. A
  // truncated enum is not a case to degrade through.
  const end = h.indexOf("};", at);
  if (end < 0)
    throw new Error("packetTypeLeaves: the emitted `enum class PktType` has no closing `};`. "
      + "The emitter's output shape changed; reading past it would invent leaves.");
  const body = h.slice(at, end);
  return new Set((body.match(/^\s*(\w+)\s*=\s*\d+\s*,?\s*$/gm) ?? [])
    .map((l) => /(\w+)\s*=/.exec(l)![1]));
}

// Shape grouping of the network-layer rule gap.
//
//   npm run shapes               # tables
//   npm run shapes -- --list     # + clauses per group
//   npm run shapes -- --selftest # mutation test
//
// Companion to scan.ts, which counts. This one answers the question
// the counts cannot: WHAT SHAPES the gap is made of, and therefore what fixes
// it. Every distinct untranslated clause is assigned to exactly one group by a
// documented precedence (its PRIMARY blocker — the first thing that stops it
// matching), and the features it also carries are reported separately so a
// clause blocked by two things is not misread as blocked by one. A clause that
// matches no group lands in OTHER, which is printed in full: the classifier is
// not allowed to have a silent bucket.
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseModel } from "../../wsn-codegen/src/engine/parser";
import { flatten } from "../../wsn-codegen/src/engine/flattener";
import { resolveEncodings } from "../../wsn-codegen/src/engine/encodingResolver";
import { translateEvent, isTypingPredicate } from "../../wsn-codegen/src/engine/ruleEngine";
import { RULES } from "../../wsn-codegen/src/engine/rules";
import type { EncodedMachine } from "../../wsn-codegen/src/engine/types";

// See the note in scan.ts: paths resolve from this file, not the cwd.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const PROJECTS: [string, string, string][] = [
  ["RTMCS", resolve(ROOT, "EventB_model/RTMCS_7_4_proof"), "M6"],
  ["MintRoute", resolve(ROOT, "EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck"), "M5"],
];

// -- Feature detectors ----------------------------------------------------
// Each names one syntactic thing the catalog cannot currently handle. A clause
// may carry several; FEATURES is the whole truth about a clause, GROUPS below
// picks which one to file it under.
const isArith = (s: string) => /[+−∗÷]|\bmod\b|[≥≤]|(^|[^↦=≠<>])[<>]/.test(s);
const isCompoundOperand = (s: string) =>
  /(ran|dom)\(\s*[^()]*[∪∩∖]/.test(s) ||     // ran(A u B)
  /[∪∩∖]\s*(ran|dom)\(/.test(s) ||           // A \ ran(B)
  /[∪∩∖]\s*\w+\s*\(/.test(s) ||              // A \ destBuff(des)
  /∖\s*\{/.test(s) ||                                  // ND \ {Sink}
  /\)\s*[∪∩∖]/.test(s) ||                              // ran(WiMedium) \ sinkBuff
  /^\s*(ran|dom)\s*\(/.test(s) ||                      // ran(calPCost) /= empty

  /[∈∉]\s*[^∈∉]*[∪∩]/.test(s) ||                        // pkt not-in sensedPkts u floodedPkts
  /\(\s*\w+\s*[∪∩]\s*\w+\s*\)/.test(s);           // (sentUp u sentDown)

const FEATURES: [string, (s: string) => boolean][] = [
  ["nested-maplet", (s) => /↦\s*\{/.test(s)],
  ["pair-key", (s) => /↦[^↦{}]*↦/.test(s) || /\w\s*\(\s*\w+\s*↦/.test(s)],
  ["rel-image", (s) => /\w\s*\[/.test(s)],
  ["range-restrict", (s) => /▷/.test(s)],
  ["dom-subtract", (s) => /⩤/.test(s)],
  ["cartesian", (s) => /×/.test(s)],
  ["aggregate", (s) => /\b(min|max|card)\s*\(/.test(s)],
  ["nested-image", (s) => /ran\(\s*\{|◁\s*(dom|ran)\(/.test(s)],
  ["compound-operand", isCompoundOperand],
  ["disjunction", (s) => /[∨⇒]/.test(s)],
  ["arithmetic", isArith],
  ["disequality", (s) => /≠/.test(s) && !/≠\s*∅\s*$/.test(s)],
];

// -- Group assignment (precedence order = the order of this list) ---------
// Ordered by what must be settled FIRST: things that are not gaps at all, then
// container shapes (the container decides the operator, so nothing below can be
// written until they are settled), then composition, then scalar operators.
type FixKind = "not-a-gap" | "interface-machine" | "structural" | "rule";
interface Group {
  id: string;
  fix: FixKind;
  note: string;
  test: (s: string, m: EncodedMachine) => boolean;
}

// Balanced-paren strip, then re-ask the engine. Behavioural, not a regex: it
// asks whether the clause would already translate but for the wrapper.
function stripOuterParens(s: string): string {
  let t = s.trim();
  for (;;) {
    if (!t.startsWith("(") || !t.endsWith(")")) return t;
    let depth = 0;
    let closesEarly = false;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "(") depth++;
      else if (t[i] === ")") {
        depth--;
        if (depth === 0 && i < t.length - 1) { closesEarly = true; break; }
      }
    }
    if (closesEarly) return t;
    t = t.slice(1, -1).trim();
  }
}
const matchesSomeRule = (s: string) => RULES.some((r) => r.match(s));

function nonVarsOf(s: string, m: EncodedMachine): Set<string> {
  return new Set((s.match(/[A-Za-z_]\w*/g) ?? []).filter((t) => !m.variables.includes(t)));
}

// Every identifier in the clause's RHS is a context name (never a machine
// variable) -- i.e. the predicate constrains a parameter's TYPE, so ST4 should
// have dropped it. Compound type expressions are what the current
// bare-identifier test in isTypingPredicate misses.
function isCompoundTyping(s: string, m: EncodedMachine): boolean {
  const mm = /^[(\s]*(\w+)\s*[∈⊆]\s*(.+?)[)\s]*$/.exec(s);
  if (!mm) return false;
  const rhs = mm[2];
  if (!/ℙ|ℤ|ℕ|×|∪/.test(rhs)) return false;
  const ids = rhs.match(/[A-Za-z_]\w*/g) ?? [];
  return ids.every((id) => !m.variables.includes(id));
}

const GROUPS: Group[] = [
  { id: "G0 typing-not-recognised", fix: "not-a-gap",
    note: "ST4 should drop it; isTypingPredicate only accepts a bare-identifier RHS",
    test: (s, m) => isCompoundTyping(s, m) },
  { id: "G1 normalisation-only", fix: "not-a-gap",
    note: "already has a rule; only a wrapper or stray spacing stops the match",
    test: (s, m) => {
      const t = stripOuterParens(s).replace(/(dom|ran|min|max|card)\s+\(/g, "$1(");
      return t !== s.trim() && (matchesSomeRule(t) || isTypingPredicate(t, nonVarsOf(s, m)));
    } },
  { id: "G2 nested-maplet container", fix: "interface-machine",
    note: "ND <-> (PKT <-> Z): map<int,set<pair<int,int>>>; no interface machine holds one",
    test: (s) => /↦\s*\{/.test(s) },
  { id: "G3 pair-keyed table", fix: "interface-machine",
    note: "route table keyed by (node,dest): map<pair<int,int>,T>; the RouteTable component ships no interface machine",
    test: (s) => /↦[^↦{}]*↦/.test(s) || /\w\s*\(\s*\w+\s*↦/.test(s) ||
      /↦[^↦]*[∈∉]\s*dom\s*\(/.test(s) },
  { id: "G4 nested relational image", fix: "structural",
    note: "ran({k} <| M) as a sub-expression, and ran({k} <| dom(f)); needs a recursive matcher, not a rule",
    test: (s) => /ran\(\s*\{|◁\s*(dom|ran)\(/.test(s) },
  { id: "G5 relational image / range restriction", fix: "rule",
    note: "R[S] and R |> V have no rule in the catalog at all",
    test: (s) => /\w\s*\[/.test(s) || /▷/.test(s) },
  { id: "G6 compound operand", fix: "structural",
    note: "operator applied to an expression, not an identifier: ran(A u B), A \\ f(k)",
    test: isCompoundOperand },
  { id: "G7 disjunction / implication", fix: "structural",
    note: "splitConjuncts splits conjunction only",
    test: (s) => /[∨⇒]/.test(s) },
  { id: "G8 cartesian init", fix: "rule",
    note: "CMP2 in the catalog is f := D x {c}; the implementation only matches the (A \\ B) x {c} variant",
    test: (s) => /×/.test(s) },
  { id: "G9 domain anti-restriction", fix: "rule",
    note: "FN4 in the catalog is {x} <<| f; only its \\{a|->b} spelling is implemented",
    test: (s) => /⩤/.test(s) },
  { id: "G10 arithmetic", fix: "interface-machine",
    note: "sequence numbers, hop counts, ETX cost; no interface machine computes",
    test: isArith },
  { id: "G11 disequality", fix: "rule",
    note: "EQ covers a = b and SET4 covers /= empty; a /= b is a form-completeness omission",
    test: (s) => /≠/.test(s) && !/≠\s*∅\s*$/.test(s) },
  { id: "G12 aggregate", fix: "rule",
    note: "min(ran(f)) -- no aggregate rule",
    test: (s) => /\b(min|max|card)\s*\(/.test(s) },
  { id: "G14 set comparison", fix: "rule",
    note: "S subset-of T and S = {literal}; the catalog compares a set only against the empty set (SET4)",
    test: (s) => /⊆/.test(s) || /[=≠]\s*\{[^↦]*\}\s*$/.test(s) },
  { id: "G13 scalar assignment", fix: "interface-machine",
    note: "X := v on a scalar/BOOL variable; no interface machine has scalar state",
    test: (s) => /^\s*\w+\s*≔\s*[\w{}∅]+\s*$/.test(s) },
];

function classify(s: string, m: EncodedMachine): Group | null {
  return GROUPS.find((g) => g.test(s, m)) ?? null;
}

// -- Selftest -------------------------------------------------------------
// A classifier that silently matches everything, or nothing, reports success.
// Every group must be reachable, and shapes the catalog ALREADY handles must be
// claimed by no group.
const SELFTEST: [string, string][] = [
  ["r ∈ ℙ(ℤ × ℤ)", "G0 typing-not-recognised"],
  ["(x = Sink)", "G1 normalisation-only"],
  ["s ↦ {pkt ↦ nbh} ∉ nbHops", "G2 nested-maplet container"],
  ["nxt = fwdNextND(x↦s)", "G3 pair-keyed table"],
  ["ran({x}◁dom(fwdNextND)) ≠ ∅", "G4 nested relational image"],
  ["nbs = wsnLinks[{f}]", "G5 relational image / range restriction"],
  ["pkt ∉ ran(ndBuff ∪ WiMedium)", "G6 compound operand"],
  ["type(pkt) = DATA ∨ type(pkt) = BEACON", "G7 disjunction / implication"],
  ["floodFlg ≔ ND × {FALSE}", "G8 cartesian init"],
  ["pktSrc ≔ {pkt} ⩤ pktSrc", "G9 domain anti-restriction"],
  ["live > 0", "G10 arithmetic"],
  ["s ≠ nb", "G11 disequality"],
  ["m = min(ran(calPCost))", "G12 aggregate"],
  ["bcastRouTimer ≔ FALSE", "G13 scalar assignment"],
  ["x↦s ∈ dom(bwdNextND)", "G3 pair-keyed table"],
  ["x ∈ dom (totalSentBcon)", "G1 normalisation-only"],
  ["des ⊆ nodes", "G14 set comparison"],
  ["sensingNDs = {x}", "G14 set comparison"],
  ["pkt ∉ sensedPkts ∪  floodedPkts", "G6 compound operand"],
  ["ran(calPCost) ≠ ∅", "G6 compound operand"],
  // near misses: shapes the catalog DOES handle must not be claimed by a group
  ["x ∈ dom(R)", ""],
  ["S ≔ S ∪ {x}", ""],
  ["nbrs ≠ ∅", ""],
  ["type(pkt) ∈ CONTROL", ""],
];

// -- Run ------------------------------------------------------------------
const loadDir = (dir: string) =>
  readdirSync(dir).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") }));

const models: Record<string, EncodedMachine> = {};
const gaps: Record<string, Map<string, number>> = {};
for (const [proj, dir, leaf] of PROJECTS) {
  const model = resolveEncodings(flatten(parseModel(loadDir(dir)), leaf));
  models[proj] = model;
  const g = new Map<string, number>();
  for (const ev of model.events) {
    const t = translateEvent(ev, model);
    for (const u of [...t.untranslatedGuards, ...t.untranslatedActions])
      g.set(u, (g.get(u) ?? 0) + 1);
  }
  gaps[proj] = g;
}

if (process.argv.includes("--selftest")) {
  const m = models.RTMCS;
  let bad = 0;
  for (const [clause, want] of SELFTEST) {
    const got = classify(clause, m)?.id ?? "";
    if (got !== want) bad++;
    console.log(`${got === want ? "ok  " : "FAIL"}  ${clause}` +
      (got === want ? "" : `\n        want ${want || "(no group)"} got ${got || "(no group)"}`));
  }
  console.log(bad === 0 ? "\nselftest: all pass" : `\nselftest: ${bad} FAILURES`);
  process.exit(bad === 0 ? 0 : 1);
}

const projNames = PROJECTS.map((p) => p[0]);
console.log("\nDISTINCT untranslated clauses by shape (leaf machine of each project)\n");
console.log("group".padEnd(39) + "fix".padEnd(20) + projNames.map((p) => p.padStart(11)).join("") + "      total");
const rows: [Group, number[]][] = [];
for (const g of GROUPS) {
  const counts = projNames.map((p) => [...gaps[p].keys()].filter((s) => classify(s, models[p])?.id === g.id).length);
  rows.push([g, counts]);
}
for (const [g, counts] of rows)
  console.log(g.id.padEnd(39) + g.fix.padEnd(20) +
    counts.map((n) => String(n).padStart(11)).join("") +
    String(counts.reduce((a, b) => a + b, 0)).padStart(11));
const other = projNames.map((p) => [...gaps[p].keys()].filter((s) => classify(s, models[p]) === null));
console.log("OTHER (unclassified)".padEnd(39) + "".padEnd(20) +
  other.map((o) => String(o.length).padStart(11)).join("") + String(other.flat().length).padStart(11));
console.log("TOTAL distinct".padEnd(59) +
  projNames.map((p) => String(gaps[p].size).padStart(11)).join("") +
  String(projNames.reduce((a, p) => a + gaps[p].size, 0)).padStart(11));

console.log("\nBy fix kind (distinct clauses):");
const byFix: Record<string, number> = {};
for (const [g, counts] of rows) byFix[g.fix] = (byFix[g.fix] ?? 0) + counts.reduce((a, b) => a + b, 0);
for (const [k, v] of Object.entries(byFix).sort((a, b) => b[1] - a[1]))
  console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)}`);

if (other.flat().length > 0) {
  console.log("\nOTHER -- every unclassified clause (no silent bucket):");
  projNames.forEach((p, i) => other[i].forEach((s) => console.log(`  [${p}] ${s}`)));
}

console.log("\nSecondary features (distinct clauses carrying it, incl. those filed elsewhere):");
for (const [name, f] of FEATURES) {
  const n = projNames.reduce((a, p) => a + [...gaps[p].keys()].filter(f).length, 0);
  console.log(`  ${name.padEnd(22)} ${String(n).padStart(4)}`);
}

if (process.argv.includes("--list")) {
  for (const g of GROUPS) {
    const all = projNames.flatMap((p) =>
      [...gaps[p].entries()].filter(([s]) => classify(s, models[p])?.id === g.id)
        .map(([s, n]) => `[${p} ${n}x] ${s}`));
    if (all.length === 0) continue;
    console.log(`\n--- ${g.id}  (${g.fix}) -- ${g.note}`);
    for (const s of all) console.log("  " + s);
  }
}

// Guards against the helpers that had been copied around the engine coming back.
//
// The netlayer merge brought two halves of the generator into one folder, and
// with them several helpers that existed two, three, four and eight times over.
// Copies are not merely untidy here: the copies had already DRIFTED, and each
// drift was invisible.
//
//   - the emitted-signature parser existed three times, and one copy escaped the
//     class name before interpolating it while the other two did not;
//   - the two-level-table detector existed twice, and the second copy matched a
//     parenthesised set union as if it were a nested map -- nine variables
//     across the three case studies;
//   - the PPkt accessor name was derived in four places, one declaring the
//     methods and three emitting calls to them.
//
// So this asserts something stronger than "looks tidy": each of these
// expressions has exactly ONE home, and a second copy fails the suite rather
// than waiting to be noticed.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE = resolve(dirname(fileURLToPath(import.meta.url)), "../src/engine");

const sources = readdirSync(ENGINE)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ file: f, text: readFileSync(resolve(ENGINE, f), "utf8") }));

// Files mentioning `pattern`, minus the one that is allowed to own it.
const strays = (pattern: RegExp, owner: string): string[] =>
  sources.filter((s) => s.file !== owner && pattern.test(s.text)).map((s) => s.file);

// Code with comments removed. Every module here explains the Event-B shape it
// handles in prose, so a textual guard that reads comments flags the
// documentation rather than a copy.
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

describe("shared helpers have exactly one home", () => {
  it("only text.ts spells out the regex-escape character class", () => {
    // Was written out eight times across six files.
    expect(strays(/\[\.\*\+\?\^\$\{\}\(\)\|\[/, "text.ts")).toEqual([]);
  });

  it("only text.ts capitalises a first letter by hand", () => {
    // `cap` was defined identically three times and inlined a fourth; `capTag`
    // (which also lowercases the tail) is a near-twin that must not be confused
    // with it, which is exactly what two similarly named local copies invite.
    expect(strays(/charAt\(0\)\.toUpperCase\(\)/, "text.ts")).toEqual([]);
  });

  it("only text.ts names Rodin's override glyph", () => {
    // U+E103 is Rodin's private-use spelling of relational override. An audit
    // once found it silently dropping actions because one matcher listed it and
    // another did not; four regexes used to spell the class out by hand.
    expect(strays(/\\uE103/, "text.ts")).toEqual([]);
  });

  it("only emitted.ts SCANS the .cc for `bool <Class>::method(...)`", () => {
    // Scanning for every definition is the job that existed three times over.
    // Building an anchor for ONE already-identified method (fixSetTypedParameters
    // rewriting a specific signature, renameCommPatternPair moving a specific
    // name) is a different job and stays where it is used -- so the test keys on
    // the global flag, which is what makes a pattern a scan.
    const scan = /new RegExp\(`[^`]*bool \$\{[^`]*`,\s*"gm"\)/;
    expect(strays(scan, "emitted.ts")).toEqual([]);
  });

  it("only emitted.ts looks a file up inside a GeneratedTree", () => {
    // Six sites inlined this and disagreed on the missing case, so a tree
    // lacking one of the two files degraded differently per pass.
    expect(strays(/\.find\(\(f\) => f\.path\.endsWith\(/, "emitted.ts")).toEqual([]);
  });

  it("only packetModel.ts builds a PPkt accessor name", () => {
    // packetEmitter DECLARES these; packetRules, mediumBinding and scheduler
    // emit CALLS to them. Four derivations of one name agreed by coincidence.
    expect(strays(/`(get|set)\$\{cap\(/, "packetModel.ts")).toEqual([]);
  });

  it("only actionShapes.ts recognises `v ≔ v ∪ …` / `v ≔ v ∖ …`", () => {
    // Written TEN times across packetOps.ts and mediumBinding.ts, at three
    // different strictnesses, and the difference was behaviour rather than
    // style: the anchored maplet form rejects `v ≔ v ∪ ({k} × s)` and the bare
    // `∪` prefix accepts it, so two passes disagreed about which variables a
    // carried event fills. The choice now has a name at each call site.
    //
    // ⚠ THE FIRST VERSION OF THIS GUARD MATCHED NOTHING AT ALL — not even its
    // own owner — and it passed its mutation test only because the probe that
    // was supposed to break it had been mangled by a heredoc into the same
    // single-backslash spelling the guard expected. An inert guard is worse
    // than no guard: it reads as coverage. Two things fix it.
    //
    // (i) BOTH SPELLINGS. A regex LITERAL writes `\s`; a template literal fed
    // to `new RegExp` writes `\\s`. The real code uses both, and the tenth
    // copy — still in transmitRecordsItsOwnFiring when this was rewritten —
    // was the template one.
    //
    // (ii) CODE ONLY. Every one of these modules explains the Event-B shape in
    // prose above the function, so matching comments would flag documentation.
    // (iii) ANY INTERPOLATION, not just a bare name. The eleventh copy —
    // senderQueuesOf in packetOps.ts — wrote `${esc(v)}`, and `\w` excludes
    // parentheses, so the `\$\{\w+\}` branch could not match it. That is the
    // SECOND time this guard has been inert: a variable name passed through a
    // helper is the normal way to write this regex, so the narrow branch was
    // missing the likeliest spelling rather than an exotic one.
    const selfUpdate = /≔\\{1,2}s\*(?:\$\{[^}]+\}|\\{1,2}1|\w+)\\{1,2}s\*[∪∖]/;

    // ⚠ Not a single-owner check, and the exceptions are the interesting part.
    // Three other modules write this shape for a DIFFERENT question:
    // aliasEncoding and encodingResolver infer "what encoding does this
    // variable's usage imply", and nestedMap's NEST-ADD / NEST-DEL are RULE
    // patterns that translate the clause into C++. None of them is asking
    // "which events add to v", which is the question actionShapes owns.
    //
    // ⚠ This list is the guard's weak point: every name added to it is one
    // fewer file being checked, so a fourth exception should be argued rather
    // than appended. The test above asserts the pattern still matches its own
    // owner precisely so an exception list that has swallowed the signal
    // cannot masquerade as a passing guard.
    const owners = ["actionShapes.ts", "aliasEncoding.ts", "encodingResolver.ts", "nestedMap.ts"];
    const offenders = sources
      .filter((s) => !owners.includes(s.file) && selfUpdate.test(stripComments(s.text)))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
    // And the guard is live: it must still see the shape in its own owner,
    // which is exactly what the first version failed to do.
    expect(selfUpdate.test(stripComments(
      sources.find((s) => s.file === "actionShapes.ts")!.text))).toBe(true);
  });

  it("only emitted.ts rewrites an emitted member declaration", () => {
    // nestedMap.ts and pairKeyed.ts each carried an identical copy of this —
    // same early return, same tree.map, same declaration regex, differing only
    // in the replacement type. It is what stops a pair-keyed function being
    // declared `std::map<int, T>`, a key of the wrong arity, so a drifted
    // second copy would mis-declare exactly the variables a caller had just
    // gone to the trouble of translating.
    expect(strays(/std::\\\\w\+<\[\^;/, "emitted.ts")).toEqual([]);
  });

  it("only nestedMap.ts decides what a two-level table is", () => {
    // The scheduler's copy claimed in its own comment to match "the same way"
    // and did not: it stopped at the opening paren, so `ctlNeighbours ∈ PKT ↔
    // (ND ∪ {FAILED_XMIT})` counted as a nested map. Emitting `.at(o).at(i)`
    // against the `std::map<K, std::set<V>>` that variable actually becomes does
    // not compile.
    expect(strays(/↔\|→\|⇸\)\\s\*\\\(/, "nestedMap.ts")).toEqual([]);
  });
});

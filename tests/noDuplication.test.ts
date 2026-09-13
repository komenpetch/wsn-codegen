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

  it("only nestedMap.ts decides what a two-level table is", () => {
    // The scheduler's copy claimed in its own comment to match "the same way"
    // and did not: it stopped at the opening paren, so `ctlNeighbours ∈ PKT ↔
    // (ND ∪ {FAILED_XMIT})` counted as a nested map. Emitting `.at(o).at(i)`
    // against the `std::map<K, std::set<V>>` that variable actually becomes does
    // not compile.
    expect(strays(/↔\|→\|⇸\)\\s\*\\\(/, "nestedMap.ts")).toEqual([]);
  });
});

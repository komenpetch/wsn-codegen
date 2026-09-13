// Assemble bench-isolated.json from measurements taken BY HAND, one input folder
// at a time.
//
//   node scripts/collect-measurements.mjs <runs.ndjson> <out.json>
//
// bench-isolated.sh generates each synthetic project into a temp directory, measures
// it and deletes it, which is right for an unattended campaign and useless if you want
// to run the points yourself. The 24 projects are therefore also materialised, once,
// under test_input/measurement/, and this script turns the raw benchmark output you
// collect from them into the same JSON document bench-isolated.sh would have written.
//
// INPUT: one raw benchmark.ts JSON object per line ("NDJSON"), in any order, with any
// number of repeats per folder. Produce it by appending, never by retyping:
//
//   npx vite-node scripts/benchmark.ts <folder> | tail -1 >> runs.ndjson
//
// The folder name carries the sweep and the scale, so `model` is the only key needed:
// "clauses-096" means the clauses sweep at scale 96. That is why the folders are named
// the way they are, and why nothing here asks you to type a number.
//
// AGGREGATION IS NOT REIMPLEMENTED HERE. Lines sharing a model are piped through
// scripts/aggregate-campaigns.mjs, the same aggregator the unattended campaign uses, so
// the median rule, the derived T_total and the spread fields cannot drift between the
// two routes. A second implementation of that logic would be a second thing to get
// wrong.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error("usage: node scripts/collect-measurements.mjs <runs.ndjson> <out.json>");
  process.exit(2);
}

// Must match BASE_* in bench-isolated.sh: every sweep holds the other three here.
const BASE = { depth: 3, events: 5, vars: 8, clauses: 6 };
const ORDER = ["depth", "events", "vars", "clauses"];
const EXPECTED = {
  depth: [1, 2, 4, 6, 8, 10],
  events: [2, 5, 10, 20, 40, 80],
  vars: [4, 8, 16, 32, 64, 100],
  clauses: [2, 6, 12, 24, 48, 96],
};

// Strip a UTF-8 BOM and any stray CR before parsing. PowerShell's `>>` and
// `Add-Content -Encoding utf8` write a BOM at the head of the file and CRLF line
// endings; the BOM lands on the FIRST character of the FIRST record, so JSON.parse
// rejects line 1 of an otherwise perfect collection. Handled here rather than in the
// instructions, because "use a different redirection operator" is a rule someone will
// forget at 11pm on the ninth pass.
const lines = fs.readFileSync(src, "utf8")
  .replace(/^﻿/, "")
  .split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim())
  .filter(Boolean);
if (!lines.length) { console.error(`${src} is empty`); process.exit(1); }

const partial = process.argv.includes("--partial");

// Group raw runs by folder name.
//
// `dir` IS NORMALISED PER GROUP, deliberately. benchmark.ts echoes back the path
// exactly as it was typed, and `dir` is one of the structural fields the aggregator
// refuses to average across -- so measuring the same folder as
// "../test_input/measurement/clauses-002" once and ".../clauses-002/" (trailing slash,
// which is what a `for d in .../*/` loop produces) the next time makes aggregation fail
// with a confusing message, hours after the measuring was done. Grouping is by `model`,
// which is the folder's basename and is stable across every spelling, so within a group
// the runs are known to be the same folder and the differing `dir` strings carry no
// information. They are collapsed to the first one seen.
const byModel = new Map();
let noGc = 0;
for (const [i, line] of lines.entries()) {
  let rec;
  try { rec = JSON.parse(line); }
  catch { console.error(`line ${i + 1} of ${src} is not JSON -- paste the whole object, unedited`); process.exit(1); }
  if (!rec.model) { console.error(`line ${i + 1} has no "model" field`); process.exit(1); }
  if (rec.gcForced === false) noGc++;
  if (!byModel.has(rec.model)) byModel.set(rec.model, { dir: rec.dir, runs: [] });
  const g = byModel.get(rec.model);
  rec.dir = g.dir;
  g.runs.push(JSON.stringify(rec));
}

// Not fatal: the measurement is still valid, but baseMB is an upper bound rather than an
// exact post-GC baseline, and it will not be comparable with data taken with the flag.
if (noGc) {
  console.log(`WARNING: ${noGc} of ${lines.length} runs were taken without --expose-gc, `
    + `so their heap baseline is an upper bound.\n`
    + `         Re-run with  NODE_OPTIONS=--expose-gc  for a baseline comparable to the `
    + `committed data.\n`);
}

// model name -> {parameter, scale}. "clauses-096" -> clauses, 96.
const parse = (model) => {
  const m = /^(depth|events|vars|clauses)-0*(\d+)$/.exec(model);
  return m ? { parameter: m[1], scale: Number(m[2]) } : null;
};

const points = new Map(ORDER.map((p) => [p, []]));
const skipped = [];
for (const [model, group] of byModel) {
  const id = parse(model);
  if (!id) { skipped.push(model); continue; }
  // Same aggregator as the unattended campaign; it exits non-zero if the structural
  // fields disagree between repeats, which means the input changed mid-collection.
  let aggregated;
  try {
    aggregated = execFileSync("node", [path.join(here, "aggregate-campaigns.mjs")],
      { input: group.runs.join("\n") + "\n", encoding: "utf8" });
  } catch (e) {
    console.error(`aggregating ${model} failed -- ${String(e.stderr || e.message).trim()}`);
    process.exit(1);
  }
  const x = JSON.parse(aggregated);
  points.get(id.parameter).push({
    scale: id.scale,
    machines: x.machines, events: x.events, variables: x.variables, clauses: x.clauses,
    inputKB: x.inputKB,
    tParse: x.tParse, tFlatten: x.tFlatten, tEncode: x.tEncode, tEmit: x.tEmit, tTotal: x.tTotal,
    // Rule accounting and the three framework steps, added 2026-08-24. This whitelist is
    // the PowerShell path's copy of the one in bench-isolated.sh and had the same hole:
    // benchmark.ts emitted tRules, the aggregator dropped it, and this dropped it again.
    // Both are fixed; anything benchmark.ts adds has to be added in BOTH whitelists.
    ...(x.tRules === undefined ? {} : { tRules: x.tRules }),
    ...(x.tStep1 === undefined ? {} : { tStep1: x.tStep1, tStep2: x.tStep2, tStep3: x.tStep3 }),
    peakMB: x.peakMB, outLines: x.outLines, untranslated: x.untranslated,
    node: x.node, runs: x.runs, warmup: x.warmup, gcForced: x.gcForced,
    baseMB: x.baseMB, deltaMB: x.deltaMB,
    campaigns: x.campaigns,
    tTotalMin: x.tTotalMin, tTotalMax: x.tTotalMax, tTotalSpreadPct: x.tTotalSpreadPct,
    peakMBMin: x.peakMBMin, peakMBMax: x.peakMBMax, peakMBSpreadPct: x.peakMBSpreadPct,
  });
}

// Report what is missing rather than writing a document with holes in it. A sweep
// short of a point still plots, and the gap is invisible once it is a line on a chart.
let incomplete = false;
for (const p of ORDER) {
  const got = points.get(p).map((q) => q.scale).sort((a, b) => a - b);
  const want = EXPECTED[p];
  const missing = want.filter((s) => !got.includes(s));
  const campaigns = points.get(p).map((q) => q.campaigns);
  console.log(`${p.padEnd(8)} ${got.length}/${want.length} points`
    + (campaigns.length ? `  campaigns ${Math.min(...campaigns)}-${Math.max(...campaigns)}` : "")
    + (missing.length ? `  MISSING scale ${missing.join(", ")}` : ""));
  if (missing.length) incomplete = true;
}
if (skipped.length) console.log(`ignored (not a sweep folder): ${skipped.join(", ")}`);

// REFUSE TO WRITE AN INCOMPLETE DOCUMENT. An earlier version wrote the file and merely
// exited non-zero, which is not enough: nothing downstream requires six points per
// sweep, so a four-point sweep plots happily as a shorter line and the two missing
// scales are invisible on the chart. Overwriting good data with a partial set is the
// worse outcome, so completeness is checked before anything is written.
if (incomplete && !partial) {
  console.log("\nINCOMPLETE -- nothing written. Measure the folders listed above and re-run.");
  console.log("Pass --partial to write anyway (for a trial run; never for a published figure).");
  process.exit(1);
}

const doc = ORDER
  .filter((p) => points.get(p).length)
  .map((p) => ({
    parameter: p,
    base: BASE,
    points: points.get(p).sort((a, b) => a.scale - b.scale),
  }));

fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n", "utf8");
const n = doc.reduce((a, s) => a + s.points.length, 0);
console.log(`\nwrote ${out}: ${doc.length} parameters, ${n} points`
  + (incomplete ? "  (PARTIAL -- not publishable)" : ""));

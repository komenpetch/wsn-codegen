// Show how far through the measurement you are.
//
//   node scripts/measure-status.mjs runs.ndjson
//
// Measuring 24 folders ten times each is 240 invocations, and if you are doing it one
// folder at a time over more than one sitting there is nothing in the raw file that
// tells you where you stopped. This reads it and says so.
//
// It reports the LOWEST count across the 24 folders as the number of complete passes,
// because a pass is only useful when every folder has it: the sweeps are compared
// against each other, so a folder measured ten times next to one measured twice buys
// nothing extra.
import fs from "node:fs";

const src = process.argv[2] || "runs.ndjson";
if (!fs.existsSync(src)) {
  console.error(`${src} does not exist yet -- nothing measured so far.`);
  process.exit(1);
}

const SWEEPS = {
  depth: [1, 2, 4, 6, 8, 10],
  events: [2, 5, 10, 20, 40, 80],
  vars: [4, 8, 16, 32, 64, 100],
  clauses: [2, 6, 12, 24, 48, 96],
};
const name = (p, s) => `${p}-${String(s).padStart(3, "0")}`;
const want = Object.entries(SWEEPS).flatMap(([p, ss]) => ss.map((s) => name(p, s)));

const count = {};
let noGc = 0, lines = 0, unparsed = 0;
// BOM and CRLF tolerated: PowerShell's `>>` writes both. See the note in
// collect-measurements.mjs.
for (const raw of fs.readFileSync(src, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const line = raw.replace(/^﻿/, "").trim();
  if (!line) continue;
  lines++;
  let r;
  try { r = JSON.parse(line); } catch { unparsed++; continue; }
  if (r.gcForced === false) noGc++;
  if (r.model) count[r.model] = (count[r.model] || 0) + 1;
}

console.log(`${src}: ${lines} runs\n`);
for (const [p, scales] of Object.entries(SWEEPS)) {
  const cells = scales.map((s) => {
    const n = count[name(p, s)] || 0;
    return `${String(s).padStart(3)}:${String(n).padStart(2)}`;
  });
  console.log(`  ${p.padEnd(8)} ${cells.join("  ")}`);
}

const counts = want.map((w) => count[w] || 0);
const complete = Math.min(...counts);
const never = want.filter((w) => !count[w]);

console.log(`\ncomplete passes (every folder measured at least this often): ${complete}`);
if (never.length) console.log(`never measured: ${never.join(", ")}`);
if (noGc) console.log(`WARNING: ${noGc} run(s) taken without --expose-gc `
  + `(set $env:NODE_OPTIONS="--expose-gc" in PowerShell first)`);
if (unparsed) console.log(`WARNING: ${unparsed} line(s) could not be parsed as JSON`);

const extra = Object.keys(count).filter((m) => !want.includes(m));
if (extra.length) console.log(`not part of the sweep (ignored on collection): ${extra.join(", ")}`);

console.log(complete >= 10
  ? "\nEnough for the paper's figures. Run collect-measurements.mjs next."
  : `\n${10 - complete} more pass(es) to match the paper's figures (fewer is fine for a trial).`);

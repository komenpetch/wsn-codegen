// Computational-efficiency / scalability benchmark for the generation pipeline.
//
//   npx vite-node scripts/benchmark.ts <dir>          # ONE model, JSON to stdout
//   bash scripts/bench-integrated.sh                  # the six real models
//   bash scripts/bench-isolated.sh                    # synthetic scale sweeps
// Both campaign scripts run one model per process and write to paper/data/.
//
// Measures, for a single Rodin project: the size of the input (machines,
// events, variables, guard/action clauses, kB of XML), the wall-clock time of
// each pipeline stage, and peak heap.
//
// Why one model per process: heapUsed is cumulative within a process, so
// benchmarking several models in one run reports the heap left over from the
// earlier models rather than the cost of the current one.  Each model therefore
// gets a fresh process and its own baseline.
//
// Times are the MEDIAN of RUNS repetitions after WARMUP discarded runs; a
// single run on a JIT runtime is dominated by warm-up.  Peak heap is the
// maximum of heapUsed sampled after every stage of every timed run, reported
// both absolutely and as a delta over the post-GC baseline.  Run under
// NODE_OPTIONS=--expose-gc for an exact baseline; without it the baseline is an
// upper bound and the output says so.
import fs from "node:fs";
import path from "node:path";
import { parseModel } from "../src/engine/parser";
import { flatten } from "../src/engine/flattener";
import { resolveEncodings } from "../src/engine/encodingResolver";
import { emit } from "../src/engine/codeEmitter";
import { ruleClock } from "../src/engine/ruleEngine";
import type { RawModel } from "../src/engine/types";

const RUNS = 51;
const WARMUP = 15;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function leafOf(raw: RawModel): string {
  const byName = new Map(raw.machines.map((m) => [m.name, m]));
  const depth = (n: string): number => {
    let d = 0, cur = byName.get(n); const seen = new Set<string>();
    while (cur && !seen.has(cur.name)) { seen.add(cur.name); d++; cur = cur.refines ? byName.get(cur.refines) : undefined; }
    return d;
  };
  return raw.machines.map((m) => m.name).sort((a, b) => depth(b) - depth(a))[0];
}

const dir = process.argv[2];
if (!dir) { console.error("usage: vite-node scripts/benchmark.ts <projectDir>"); process.exit(2); }

const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith(".bum") || f.endsWith(".buc"))
  .map((f) => ({ name: f, xml: fs.readFileSync(path.join(dir, f), "utf8") }));
if (files.length === 0) { console.error(`no .bum/.buc in ${dir}`); process.exit(2); }
const inputKB = files.reduce((a, f) => a + Buffer.byteLength(f.xml, "utf8"), 0) / 1024;

const gc = (globalThis as { gc?: () => void }).gc;
if (gc) { gc(); gc(); }
const baseMB = process.memoryUsage().heapUsed / (1024 * 1024);

const tP: number[] = [], tF: number[] = [], tE: number[] = [], tM: number[] = [],
  tR: number[] = [];
let peak = 0, machines = 0, events = 0, variables = 0, clauses = 0, outLines = 0, untranslated = 0;
const sample = () => { peak = Math.max(peak, process.memoryUsage().heapUsed); };

for (let i = 0; i < RUNS + WARMUP; i++) {
  let t = performance.now();
  const raw = parseModel(files);
  const p = performance.now() - t; sample();

  t = performance.now();
  const flat = flatten(raw, leafOf(raw));
  const f = performance.now() - t; sample();

  t = performance.now();
  const enc = resolveEncodings(flat);
  const e = performance.now() - t; sample();

  // Rule application runs inside emit(), but belongs to step 2 (Rule Mapping),
  // not step 3 (Code Generation). ruleClock accumulates exactly the calls the
  // emitter makes, so the two framework steps can be reported separately.
  ruleClock.ms = 0; ruleClock.on = true;
  t = performance.now();
  const tree = emit(enc, "BenchApp", 2, raw.contexts);
  const m = performance.now() - t; sample();
  ruleClock.on = false;
  const rl = ruleClock.ms;

  if (i >= WARMUP) { tP.push(p); tF.push(f); tE.push(e); tM.push(m); tR.push(rl); }

  machines = raw.machines.length;
  events = flat.events.length;
  variables = flat.variables.length;
  clauses = flat.events.reduce((a, ev) => a + ev.guards.length + ev.actions.length, 0);
  const all = tree.map((x) => x.content).join("\n");
  // Count per file, dropping the trailing newline first. Joining the files and
  // splitting the result counted one phantom line per file -- each file ends in a
  // newline, so split() yields a final empty element, and the join added a blank
  // line between files as well. That overstated the emitted size by exactly the
  // file count (3), which is how the paper came to report 609 lines for 606.
  outLines = tree.reduce((n, x) => n + x.content.replace(/\n$/, "").split("\n").length, 0);
  untranslated = (all.match(/UNTRANSLATED/g) ?? []).length;
}

const tParse = median(tP), tFlatten = median(tF), tEncode = median(tE), tEmit = median(tM);
// Rule application, carved out of tEmit so the three framework steps can be
// reported: step 1 = parse+flatten, step 2 = encode+rules, step 3 = emit-rules.
const tRules = median(tR);
const s1 = r3(tParse + tFlatten);
const s2 = r3(tEncode + tRules);
const s3 = r3(tEmit - tRules);
const peakMB = peak / (1024 * 1024);

console.log(JSON.stringify({
  model: path.basename(dir),
  dir,
  node: process.version,
  runs: RUNS, warmup: WARMUP,
  gcForced: Boolean(gc),
  machines, events, variables, clauses,
  inputKB: Math.round(inputKB * 10) / 10,
  outLines, untranslated,
  tParse: r3(tParse), tFlatten: r3(tFlatten), tEncode: r3(tEncode), tEmit: r3(tEmit),
  tRules: r3(tRules),
  // The three step figures are rounded FIRST and the total is their sum, so the
  // numbers a reader adds up are the numbers that were printed. Rounding each
  // median independently and rounding the total separately leaves them off by a
  // thousandth, and Section 3.3.2 states the decomposition sums exactly.
  tStep1: s1, tStep2: s2, tStep3: s3,
  tTotal: r3(s1 + s2 + s3),
  baseMB: r3(baseMB), peakMB: r3(peakMB), deltaMB: r3(peakMB - baseMB),
}));

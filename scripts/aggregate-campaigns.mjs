// Aggregate N independent benchmark campaigns of ONE model into a single record.
//
// Reads one JSON object per line on stdin (one per campaign), writes one object.
//
// WHY THIS EXISTS.  benchmark.ts already reports the median of 51 timed repetitions
// after 15 warm-ups, which removes per-iteration noise. It does NOT remove
// between-PROCESS variation: JIT compilation decisions, heap layout and CPU state are
// fixed for the life of a process and shared by all 51 repetitions in it. Measured over
// 20 campaigns of the case study, T_total spans 5.9 % while its coefficient of variation
// is only 1.6 % -- i.e. the spread is process-to-process, not iteration-to-iteration.
// Raising 51 to 501 would therefore not help; running more PROCESSES is what helps.
//
// The running median converges quickly: by 5 campaigns it is within 0.3 % of the
// 20-campaign value, and the standard error of the mean falls as sigma/sqrt(n)
// (+/-1.6 % at n=1, +/-0.5 % at n=10). Ten campaigns is the knee of that curve.
//
// Structural fields must be identical across campaigns -- the pipeline is deterministic.
// If they are not, something changed mid-run and the aggregate would be meaningless, so
// this fails loudly instead of averaging over it.

// tTotal is NOT in this list on purpose -- see the note where it is derived below.
const TIMED = ['tParse', 'tFlatten', 'tEncode', 'tEmit'];
// tRules is measured, but it is a COMPONENT of tEmit, not a fifth stage, so it must be
// aggregated without joining TIMED -- adding it there would double-count it into tTotal
// and break the identity data.mjs checks. It was missing entirely until 2026-08-24:
// benchmark.ts emitted it, this script dropped it on the floor, and bench-isolated.sh's
// own field whitelist dropped it a second time, so a full campaign would have produced no
// step decomposition at all. Same failure the whitelist comment in bench-isolated.sh
// already warns about; anything benchmark.ts adds has to be added in BOTH places.
const SUBTIMED = ['tRules'];
const MEM = ['baseMB', 'peakMB', 'deltaMB'];
const STRUCTURAL = ['model', 'dir', 'node', 'runs', 'warmup', 'gcForced',
  'machines', 'events', 'variables', 'clauses', 'inputKB', 'outLines', 'untranslated'];

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const r3 = (x) => Math.round(x * 1000) / 1000;

let buf = '';
process.stdin.on('data', (d) => { buf += d; });
process.stdin.on('end', () => {
  const runs = buf.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (!runs.length) { console.error('aggregate: no campaigns on stdin'); process.exit(2); }

  for (const k of STRUCTURAL) {
    const seen = new Set(runs.map((r) => r[k]));
    if (seen.size !== 1) {
      console.error(`aggregate: structural field "${k}" differs across campaigns: ` +
        `${[...seen].join(', ')} -- the pipeline should be deterministic, refusing to average`);
      process.exit(1);
    }
  }

  const out = {};
  for (const k of STRUCTURAL) out[k] = runs[0][k];
  out.campaigns = runs.length;
  // Guarded so an older benchmark.ts, or a campaign set recorded before rule accounting
  // existed, still aggregates instead of writing NaN into the file.
  const hasRules = runs.every((r) => typeof r.tRules === 'number');
  for (const k of [...TIMED, ...(hasRules ? SUBTIMED : []), ...MEM])
    out[k] = r3(median(runs.map((r) => r[k])));

  // T_total is DERIVED as the sum of the four stage medians, not taken as the median
  // of the recorded totals. The median is not additive: median(a+b) != median(a)+median(b)
  // in general, so aggregating each field independently would leave the reported total
  // disagreeing with its own decomposition -- on the case study by 0.003 ms. The paper
  // defines T_total = T_parse + T_flat + T_enc + T_emit (Equation 3) and prints the
  // decomposition beside the total, so the identity has to hold exactly or a reader can
  // add up four printed numbers and get a fifth that is not the one printed.
  out.tTotal = r3(TIMED.reduce((a, k) => a + out[k], 0));

  // deltaMB is DERIVED for exactly the same reason, and used not to be. It is
  // peakMB - baseMB, and median(a-b) != median(a) - median(b), so medianing it
  // independently left the aggregate disagreeing with its own two components.
  // At 10 campaigns the gap stayed inside the 0.01 MB tolerance data.mjs allows
  // and nobody noticed; a 20-campaign run put it at 0.012 and the check fired.
  // A tolerance was hiding the cause, so the cause is fixed here instead.
  out.deltaMB = r3(out.peakMB - out.baseMB);

  // The three framework steps, derived from the AGGREGATED medians for the same reason
  // tTotal is: median(a+b) != median(a)+median(b), so medianing the per-campaign step
  // figures independently would leave step 2 disagreeing with the tEncode and tRules
  // printed beside it. Definitions follow benchmark.ts exactly -- step 2 is the rule work
  // carved out of emission, so tRules is ADDED to encode and SUBTRACTED from emit, and the
  // three steps still cover tParse..tEmit exactly once between them.
  if (hasRules) {
    out.tStep1 = r3(out.tParse + out.tFlatten);
    out.tStep2 = r3(out.tEncode + out.tRules);
    out.tStep3 = r3(out.tEmit - out.tRules);
  }

  // dispersion on the two headline quantities, so the paper can quote a spread that was
  // measured rather than asserted. tTotal's spread uses the per-campaign RECORDED totals
  // (each of which is internally consistent), which is the right basis for "how much does
  // a campaign move" even though the committed central value is the derived sum.
  for (const k of ['tTotal', 'peakMB']) {
    const v = runs.map((r) => r[k]);
    out[`${k}Min`] = r3(Math.min(...v));
    out[`${k}Max`] = r3(Math.max(...v));
    out[`${k}SpreadPct`] = r3(100 * (Math.max(...v) / Math.min(...v) - 1));
  }
  process.stdout.write(JSON.stringify(out));
});

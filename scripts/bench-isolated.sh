#!/usr/bin/env bash
# ISOLATED measurement campaign: sweep ONE input-scale parameter at a time over
# SYNTHETIC Rodin projects, so that cost can be attributed to individual
# pipeline stages.  The companion campaign is scripts/bench-integrated.sh, which
# measures the whole pipeline on the six real models.
#
#   bash scripts/bench-isolated.sh
#
# Writes the JSON to paper/data/bench-isolated.json and a table to stderr.
#
# Real Event-B models come in fixed sizes, so a scaling study needs valid Rodin
# projects at controlled scales; scripts/synth-model.ts produces them.  Four
# parameters, each stressing a different stage:
#
#   depth   → flattener         (length of the refines chain to walk + merge)
#   events  → parser            (input size: machines x events)
#   vars    → encodingResolver  (one typing invariant to classify each)
#   clauses → ruleEngine+emitter(guard/action clauses to match per event)
#
# Three are held at the base configuration while the fourth is swept, so the
# effects do not confound.  Only `depth` is clause-neutral by construction (the
# clause payload lives in the base machine); for the other three the recorded
# per-point scale figures are the MEASURED ones reported by benchmark.ts, never
# the requested ones -- they differ (requesting events=5 yields 6 events because
# INITIALISATION counts, and clauses = events x clausesPerEvent + vars).
#
# One model per node process, as in bench-integrated.sh: heapUsed is cumulative
# within a process, so several models in one run would report the earlier
# models' residue instead of the cost of the current one.  Each point therefore
# gets a fresh process and its own post-GC baseline (NODE_OPTIONS=--expose-gc).
set -u
cd "$(dirname "$0")/.."

# Base configuration: every sweep holds the other three parameters here.
BASE_DEPTH=3
BASE_EVENTS=5
BASE_VARS=8
BASE_CLAUSES=6

# Swept parameter : the six points, low to high.
SWEEPS=(
  "depth:1 2 4 6 8 10"
  "events:2 5 10 20 40 80"
  "vars:4 8 16 32 64 100"
  "clauses:2 6 12 24 48 96"
)

# Overridable; see the note in bench-integrated.sh. Defaults to paper/.
#   OUT=../paper2/data/bench-isolated.json bash scripts/bench-isolated.sh
OUT="${OUT:-../paper/data/bench-isolated.json}"
mkdir -p "$(dirname "$OUT")"

export NODE_OPTIONS="--expose-gc"

# CAMPAIGNS: independent PROCESSES per sweep point, aggregated to a median.
# Same reasoning as bench-integrated.sh: benchmark.ts already medians 51 repetitions
# inside one process, but JIT decisions, heap layout and CPU state are fixed per process
# and shared by all of them, so the residual scatter is process-to-process and only more
# processes remove it. Ten is the knee of the sigma/sqrt(n) curve.
#
# The synthetic project is generated ONCE per point and reused across its campaigns --
# regenerating would waste time and, worse, would let the input differ between campaigns
# that are supposed to be measuring the same thing.
#
# Cost: roughly 10x the single-campaign run. Override with
#   CAMPAIGNS=1 bash scripts/bench-isolated.sh
CAMPAIGNS="${CAMPAIGNS:-10}"

# System temp, NOT a bare /tmp path: benchmark.ts runs in a native Windows node
# process, which would resolve the MSYS "/tmp/..." string as "C:\tmp\...".
# cygpath -w converts; on a real POSIX box cygpath is absent and the path is
# already correct.
towin() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }

RAW=$(mktemp)
trap 'rm -f "$RAW"' EXIT

printf '%-8s %6s | %5s %5s %5s %7s %7s | %7s %6s %6s %7s %8s | %8s %8s %6s\n' \
  param scale mach evt var claus inKB tParse tFlat tEnc tEmit tTotal peakMB outLOC untr >&2

for sweep in "${SWEEPS[@]}"; do
  param="${sweep%%:*}"
  for scale in ${sweep#*:}; do
    dep=$BASE_DEPTH; ev=$BASE_EVENTS; va=$BASE_VARS; cl=$BASE_CLAUSES
    case "$param" in
      depth)   dep=$scale ;;
      events)  ev=$scale ;;
      vars)    va=$scale ;;
      clauses) cl=$scale ;;
      *) echo "unknown parameter: $param" >&2; exit 1 ;;
    esac

    dir=$(mktemp -d) || { echo "mktemp -d failed" >&2; exit 1; }
    win=$(towin "$dir")

    if ! npx vite-node scripts/synth-model.ts "$win" \
           --depth "$dep" --events "$ev" --vars "$va" --clauses "$cl" >/dev/null 2>&1; then
      echo "ERROR: synth failed for $param=$scale" >&2; rm -rf "$dir"; exit 1
    fi

    runs=$(for _ in $(seq 1 "$CAMPAIGNS"); do
             npx vite-node scripts/benchmark.ts "$win" 2>/dev/null | tail -1
           done)
    out=$(printf '%s\n' "$runs" | node scripts/aggregate-campaigns.mjs) \
      || { echo "ERROR: aggregation failed for $param=$scale" >&2; rm -rf "$dir"; exit 1; }
    rm -rf "$dir"
    [ -n "$out" ] || { echo "ERROR: benchmark failed for $param=$scale" >&2; exit 1; }

    printf '%s\t%s\t%s\n' "$param" "$scale" "$out" >> "$RAW"

    node -e '
      const [param, scale, json] = process.argv.slice(1);
      const x = JSON.parse(json);
      const p = (s, n) => String(s).padStart(n);
      process.stderr.write(
        param.padEnd(8) + p(scale,7) + " |" + p(x.machines,6) + p(x.events,5) + p(x.variables,5) +
        p(x.clauses,7) + p(x.inputKB,7) + " |" + p(x.tParse.toFixed(3),8) + p(x.tFlatten.toFixed(3),7) +
        p(x.tEncode.toFixed(3),7) + p(x.tEmit.toFixed(3),7) + p(x.tTotal.toFixed(3),9) +
        " |" + p(x.peakMB.toFixed(2),9) + p(x.outLines,8) + p(x.untranslated,7) + "\n");
    ' "$param" "$scale" "$out"
  done
done

# Assemble: one object per swept parameter, each with the base config and its
# six points.  Every point carries the MEASURED scale figures from benchmark.ts.
node -e '
  const fs = require("fs");
  const [raw, outPath, d, e, v, c] = process.argv.slice(1);
  const base = { depth: +d, events: +e, vars: +v, clauses: +c };
  const order = [];
  const byParam = new Map();
  for (const line of fs.readFileSync(raw, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const [param, scale, json] = line.split("\t");
    const x = JSON.parse(json);
    if (!byParam.has(param)) { byParam.set(param, []); order.push(param); }
    byParam.get(param).push({
      scale: Number(scale),
      machines: x.machines, events: x.events, variables: x.variables, clauses: x.clauses,
      inputKB: x.inputKB,
      tParse: x.tParse, tFlatten: x.tFlatten, tEncode: x.tEncode, tEmit: x.tEmit, tTotal: x.tTotal,
      // Rule accounting and the three framework steps. Added 2026-08-24; before that this
      // whitelist silently dropped them exactly as the note below describes, so a full
      // campaign produced no step decomposition. Spread with ?? so a record aggregated
      // without them still round-trips rather than writing nulls.
      ...(x.tRules === undefined ? {} : { tRules: x.tRules }),
      ...(x.tStep1 === undefined ? {} : { tStep1: x.tStep1, tStep2: x.tStep2, tStep3: x.tStep3 }),
      peakMB: x.peakMB, outLines: x.outLines, untranslated: x.untranslated,
      // Carry the aggregate fields through. This whitelist silently dropped them when
      // campaign aggregation was added, so the plots had no dispersion to draw and the
      // per-point spread was unrecoverable without re-measuring. Anything the aggregator
      // adds must be added here too.
      //
      // The protocol fields are here so the file DESCRIBES ITS OWN MEASUREMENT. Without
      // them a reader cannot tell from bench-isolated.json that each point is a median
      // of `runs` repetitions after `warmup` discards, on `node`, with GC forced -- they
      // would have to trust prose elsewhere. Repeated per point rather than hoisted,
      // because hoisting would change the document shape and every consumer with it.
      node: x.node, runs: x.runs, warmup: x.warmup, gcForced: x.gcForced,
      baseMB: x.baseMB, deltaMB: x.deltaMB,
      campaigns: x.campaigns,
      tTotalMin: x.tTotalMin, tTotalMax: x.tTotalMax, tTotalSpreadPct: x.tTotalSpreadPct,
      peakMBMin: x.peakMBMin, peakMBMax: x.peakMBMax, peakMBSpreadPct: x.peakMBSpreadPct,
    });
  }
  const doc = order.map((param) => ({ parameter: param, base, points: byParam.get(param) }));
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  const n = doc.reduce((a, s) => a + s.points.length, 0);
  process.stderr.write(`wrote ${outPath} (relative to wsn-codegen/): ${doc.length} parameters, ${n} points\n`);
' "$RAW" "$OUT" "$BASE_DEPTH" "$BASE_EVENTS" "$BASE_VARS" "$BASE_CLAUSES"

node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$OUT" \
  || { echo "ERROR: $OUT is not valid JSON" >&2; exit 1; }

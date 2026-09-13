#!/usr/bin/env bash
# INTEGRATED measurement campaign: the whole pipeline on the REAL Rodin projects
# this work uses as input.  Answers "what does generation cost on the models we
# actually have".  The companion campaign is scripts/bench-isolated.sh, which
# sweeps one synthetic input-scale parameter at a time and carries the
# scalability argument.
#
#   bash scripts/bench-integrated.sh
#
# Writes the JSON array to paper/data/bench-integrated.json and a
# human-readable table to stderr.
#
# One model per node process: heapUsed is cumulative within a process, so
# benchmarking several models in one run would report the earlier models'
# residue instead of the cost of the current one.  Each model therefore gets a
# fresh process and its own post-GC baseline (NODE_OPTIONS=--expose-gc).
#
# SCOPE.  Only the application-layer inputs under ../test_input are measured.
# The network-layer protocol models (AODV/RTMCS, MintRoute) are deliberately NOT
# included: this work does not address the network layer, so presenting those
# models -- even purely as timing specimens -- would imply a scope the project
# has not reached.
set -u
cd "$(dirname "$0")/.."

# C0_project is the REPORTED case study and lives at ../Update_wsn/C0_project, which is
# the canonical copy: it carries the advisor-confirmed relational override (U+E103) in
# pM1's start_tx. A byte-identical duplicate used to sit under ../test_input/PVersion and
# was removed on 2026-08-04; do not point this back at test_input.
#
# WSN_Pattern_shDecom6_3 is a generation smoke test that is NOT reported in the paper
# (see REPORTED in paper/scripts/make-tables.mjs). It exists only under ../test_input,
# so if that tree is removed this entry simply skips and the reported row is unaffected.
MODELS=(
  "../Update_wsn/C0_project"
  "../test_input/test_input/WSN_Pattern_shDecom6_3"
)

# Overridable, because there are now two papers. Defaults to paper/ so every existing
# instruction keeps working; run
#   OUT=../paper2/data/bench-integrated.json bash scripts/bench-integrated.sh
# to measure into paper2. Without this the script silently rewrites the OTHER paper's
# data and leaves the one you are working on untouched.
OUT="${OUT:-../paper/data/bench-integrated.json}"
mkdir -p "$(dirname "$OUT")"

export NODE_OPTIONS="--expose-gc"

# CAMPAIGNS: how many independent PROCESSES to run per model, aggregated to a median.
#
# benchmark.ts already medians 51 repetitions inside one process, which removes
# per-iteration noise. It cannot remove between-process variation -- JIT decisions, heap
# layout and CPU state are fixed for a process and shared by all 51 of its repetitions.
# Measured over 20 campaigns of the case study, T_total spans 5.9 % while its coefficient
# of variation is only 1.6 %: the spread is process-to-process. Raising 51 would not help.
#
# The running median converges by about 5 campaigns and the standard error of the mean
# falls as sigma/sqrt(n) -- +/-1.6 % at n=1, +/-0.5 % at n=10. Ten is the knee, and costs
# about 35 s for the two models. Override with  CAMPAIGNS=1 bash scripts/bench-integrated.sh
CAMPAIGNS="${CAMPAIGNS:-10}"

printf '%-28s %5s %5s %5s %7s %7s | %7s %6s %6s %7s %8s | %8s %8s\n' \
  model mach evt var claus inKB tParse tFlat tEnc tEmit tTotal peakMB outLOC >&2

{
  echo "["
  first=1
  for m in "${MODELS[@]}"; do
    [ -d "$m" ] || { echo "skip (missing): $m" >&2; continue; }
    echo "  $m: $CAMPAIGNS campaigns" >&2
    runs=$(for _ in $(seq 1 "$CAMPAIGNS"); do
             npx vite-node scripts/benchmark.ts "$m" 2>/dev/null | tail -1
           done)
    out=$(printf '%s\n' "$runs" | node scripts/aggregate-campaigns.mjs) || exit 1
    [ -n "$out" ] || { echo "skip (failed): $m" >&2; continue; }
    [ $first -eq 1 ] || echo ","
    first=0
    printf '%s' "$out"
    node -e '
      const x = JSON.parse(process.argv[1]);
      const p = (s, n) => String(s).padStart(n);
      process.stderr.write(
        x.model.slice(0,28).padEnd(28) + p(x.machines,5) + p(x.events,5) + p(x.variables,5) +
        p(x.clauses,7) + p(x.inputKB,7) + " |" + p(x.tParse.toFixed(3),8) + p(x.tFlatten.toFixed(3),7) +
        p(x.tEncode.toFixed(3),7) + p(x.tEmit.toFixed(3),7) + p(x.tTotal.toFixed(3),9) +
        " |" + p(x.peakMB.toFixed(2),9) + p(x.outLines,8) + "\n");
    ' "$out"
  done
  echo ""
  echo "]"
} > "$OUT"

node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$OUT" \
  || { echo "ERROR: $OUT is not valid JSON" >&2; exit 1; }
echo "wrote $OUT (relative to wsn-codegen/)" >&2

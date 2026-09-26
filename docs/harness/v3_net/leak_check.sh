#!/bin/bash
# Regression check for the DELIVERY LEAK (diagnosed and fixed 2026-09-27).
#
# Deliveries published by send_up and never consumed. They grew linearly with
# run length -- 51 / 111 / 218 at 30 / 60 / 120 s -- and each one also blocked
# every later copy of its packet, so the leak cost 16 % of decoded frames. Two
# causes, both fixed in the generator; this goes red if either comes back.
#
# It instruments the STAGED module (leak_probe.mjs), builds, runs, restores the
# source and rebuilds, so the harness is left exactly as it was found -- on
# success, on red, and on a broken run alike.
#
#   ./leak_check.sh [sim-time] [config]        defaults: 60s Sink
#
# EXIT: 0 GREEN no delivery waiting > 2 s
#       1 RED   at least one, with the causes classified
#       2 REFUSE nothing was delivered, so zero stuck proves nothing
#       3 BROKEN instrument / build / run failed
#
# ⚠ `set -u` deliberately not set: OMNeT++'s own setenv reads unbound variables.
# Run from the OMNeT++ MSYS2 CLANG64 shell (see loop.sh), with node on PATH.
T=${1:-60s}; CFG=${2:-Sink}
export PATH="/c/Program Files/nodejs:$PATH"
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q > /dev/null
export PATH="/c/Users/Komen/Desktop/Proj/Simulation/inet4.5/src:$PATH"
cd "$(dirname "$0")"
OUT=.leak

restore() {
  node leak_probe.mjs restore > /dev/null
  # ⚠ touch, or make sees an object newer than the restored source and keeps
  # the INSTRUMENTED binary -- the stale-binary trap this project keeps hitting.
  touch Pm3Wsn.cc
  ./build.sh > "$OUT/rebuild.log" 2>&1 || echo "WARNING: rebuild after restore failed -- see $OUT/rebuild.log"
}

rm -rf "$OUT"; mkdir -p "$OUT"
node leak_probe.mjs > "$OUT/probe.log" 2>&1 || { echo "BROKEN: instrumentation failed"; cat "$OUT/probe.log"; exit 3; }
trap restore EXIT
./build.sh > "$OUT/build.log" 2>&1 || { echo "BROKEN: build failed"; tail -20 "$OUT/build.log"; exit 3; }
./out/clang-release/v3_net.exe -u Cmdenv -c "$CFG" -n ".;../inet4.5/src" \
  --sim-time-limit="$T" --result-dir="$OUT/res" > "$OUT/run.log" 2>&1 \
  || { echo "BROKEN: run failed"; tail -10 "$OUT/run.log"; exit 3; }

SCA=$(ls "$OUT"/res/*.sca 2>/dev/null | head -1)
[ -n "$SCA" ] || { echo "BROKEN: no .sca"; exit 3; }
[ "$(grep -m1 '^attr configname' "$SCA" | awk '{print $3}')" = "$CFG" ] || { echo "BROKEN: wrong config"; exit 3; }
grep -q "LEAK_stuck" "$SCA" || { echo "BROKEN: not the instrumented build"; exit 3; }

sum() { grep "$1" "$SCA" | awk '{s+=$4} END{print s+0}'; }
stuck=$(sum LEAK_stuck); young=$(sum LEAK_young); sup=$(sum "generic\.np fired:send_up ")
echo "config=$CFG t=$T send_up=$sup stuck(>2s)=$stuck young(<=2s)=$young"
[ "$sup" -eq 0 ] && { echo "REFUSE: nothing was delivered, so zero stuck proves nothing"; exit 2; }
if [ "$stuck" -gt 0 ]; then
  echo "RED: $stuck deliveries left waiting -- selfOrig=$(sum LEAK_selfOrig) (cause 1)" \
       "inFlood=$(sum LEAK_inFlood) updPending=$(sum LEAK_updPending) (cause 2)"
  exit 1
fi
echo "GREEN: every delivery was consumed"
exit 0

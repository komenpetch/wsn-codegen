#!/bin/bash
# PER-TYPE check (2026-09-27). invariants.sh checks the flood's conservation laws
# summed over every control type; a defect in ONE type can hide inside that sum.
# This instruments the staged module (type_probe.mjs), runs it, and checks per
# node AND per packet type: start_tx = created + fwdr, fwdr <= accept,
# frames built = send_down, accept + dup <= frames received, fwdr + dest <= accept,
# and reports the distinct originators each node heard per type (reach).
# Written when structure 3 learnt two routings (flooding ROUTE/BEACON, AODV
# RREQ/RREP/RRER); both pass at 60 s, and at a load with zero queue overflow the
# flooding types come out IDENTICAL, which is what showed the first-type bias at
# the default load is a queue-overflow artefact rather than a per-type defect.
#
#   type_check.sh [module-dir|-] [sim-time] [config]     defaults: - 60s Sink
#   TICK=20s TAG=_slow type_check.sh - 120s Sink          lower the load
#
# module-dir: a directory holding Pm3Wsn.{h,cc,ned} to stage instead of the one
# loop.sh generated (e.g. a flooding-shaped input's). The harness is ALWAYS left
# exactly as loop.sh left it, on every exit path.
# EXIT: 0 every per-type law holds, 1 a violation, 3 instrument/build/run failed.
NET="$(cd "$(dirname "$0")" && pwd)"
MOD=${1:-}; T=${2:-60s}; CFG=${3:-Sink}
[ "$MOD" = "-" ] && MOD=""
export PATH="/c/Program Files/nodejs:$PATH"
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q > /dev/null
export PATH="/c/Users/Komen/Desktop/Proj/Simulation/inet4.5/src:$PATH"
cd "$NET"
OUT=$NET/.type_$(basename "${MOD:-default}")_${CFG}${TAG:-}
rm -rf "$OUT"; mkdir -p "$OUT"

restore() {
  node "$NET/type_probe.mjs" "$NET" restore > /dev/null
  cp .loop/gen/Pm3Wsn.h .loop/gen/Pm3Wsn.cc .loop/gen/Pm3Wsn.ned "$NET/"
  touch Pm3Wsn.cc Pm3Wsn.h
  ./build.sh > "$OUT/rebuild.log" 2>&1 || echo "WARNING: rebuild after restore failed"
  [ "$(md5sum < Pm3Wsn.cc)" = "$(md5sum < .loop/gen/Pm3Wsn.cc)" ] && echo "RESTORED (staged == loop.sh's generation)" || echo "!! NOT RESTORED"
}
trap restore EXIT

if [ -n "$MOD" ]; then cp "$MOD"/Pm3Wsn.h "$MOD"/Pm3Wsn.cc "$MOD"/Pm3Wsn.ned "$NET/"; fi
node "$NET/type_probe.mjs" "$NET" || { echo "BROKEN: instrument failed"; exit 3; }
touch Pm3Wsn.cc Pm3Wsn.h
./build.sh > "$OUT/build.log" 2>&1 || { echo "BROKEN: build failed"; tail -20 "$OUT/build.log"; exit 3; }
./out/clang-release/v3_net.exe -u Cmdenv -c "$CFG" -n ".;../inet4.5/src" \
  --sim-time-limit="$T" --result-dir="$OUT/res" ${TICK:+"--**.generic.np.tickInterval=$TICK"} > "$OUT/run.log" 2>&1 \
  || { echo "BROKEN: run failed"; tail -10 "$OUT/run.log"; exit 3; }
node "$NET/type_analyse.mjs" "$(ls "$OUT"/res/*.sca | head -1)"

#!/bin/bash
# PER-TYPE check for structure 4 with the DSR split and the DSR test code:
# ../v4_aodv's type_check.sh (itself ../v4_mintroute's) for [Config Route360]. The flood's conservation
# laws per node AND per packet type, plus per-type reach, because invariants.sh
# sums over types and a one-type defect could hide in the sum.
#
#   type_check.sh [sim-time] [config] [run]     defaults: 360s Route360 0
#
# The staged EbWsn.cc is ALWAYS put back exactly as found, on every exit path
# (checked by md5 against the copy taken before instrumenting).
# Run from the OMNeT++ MSYS2 CLANG64 shell (see build.sh), node on PATH.
# EXIT: 0 every per-type law holds, 1 a violation, 3 instrument/build/run failed.
NET="$(cd "$(dirname "$0")" && pwd)"
T=${1:-360s}; CFG=${2:-Route360}; RUN=${3:-0}
export PATH="/c/Program Files/nodejs:$PATH"
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q > /dev/null
export PATH="/c/Users/Komen/Desktop/Proj/Simulation/inet4.5/src:$PATH"
cd "$NET"
OUT=$NET/.type_$CFG
rm -rf "$OUT"; mkdir -p "$OUT"
CC_MD5=$(md5sum < EbWsn.cc)

restore() {
  node "$NET/type_probe.mjs" "$NET" restore > /dev/null
  touch EbWsn.cc EbWsn.h
  ./build.sh > "$OUT/rebuild.log" 2>&1 || echo "WARNING: rebuild after restore failed"
  if [ "$(md5sum < EbWsn.cc)" = "$CC_MD5" ]; then
    echo "RESTORED (EbWsn.cc as found)"
  else
    echo "!! NOT RESTORED"
  fi
}
trap restore EXIT

node "$NET/type_probe.mjs" "$NET" || { echo "BROKEN: instrument failed"; exit 3; }
touch EbWsn.cc EbWsn.h
./build.sh > "$OUT/build.log" 2>&1 || { echo "BROKEN: build failed"; tail -20 "$OUT/build.log"; exit 3; }
./out/clang-release/$(basename "$PWD").exe -u Cmdenv -c "$CFG" -r "$RUN" -n ".;../inet4.5/src" \
  --sim-time-limit="$T" --result-dir="$OUT/res" > "$OUT/run.log" 2>&1 \
  || { echo "BROKEN: run failed"; tail -10 "$OUT/run.log"; exit 3; }
echo "run: $(grep -o 'event #[0-9]*' "$OUT/run.log" | tail -1)"
node "$NET/type_analyse.mjs" "$(ls "$OUT"/res/*.sca | head -1)"

#!/bin/bash
# PER-TYPE check: ../v4_static's type_check.sh for [Config Parent] (step 3g). The
# flood's conservation laws per node AND per packet type, plus per-type reach,
# because invariants.sh sums over types and a one-type defect could hide in the
# sum. type_probe.mjs also counts the frames MintRoute's copy of the ROUTE
# transmit builds.
#
#   type_check.sh [sim-time] [config]     defaults: 300s Parent
#
# The harness is ALWAYS left exactly as loop.sh left it, on every exit path
# (both sources checked by md5).
# EXIT: 0 every per-type law holds, 1 a violation, 3 instrument/build/run failed.
NET="$(cd "$(dirname "$0")" && pwd)"
T=${1:-300s}; CFG=${2:-Parent}
export PATH="/c/Program Files/nodejs:$PATH"
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q > /dev/null
export PATH="/c/Users/Komen/Desktop/Proj/Simulation/inet4.5/src:$PATH"
cd "$NET"
OUT=$NET/.type_$CFG
rm -rf "$OUT"; mkdir -p "$OUT"
MR_MD5=$(md5sum < MintRoute.cc)

restore() {
  node "$NET/type_probe.mjs" "$NET" restore > /dev/null
  cp .loop/gen/EbWsn.h .loop/gen/EbWsn.cc .loop/gen/EbWsn.ned "$NET/"
  touch EbWsn.cc EbWsn.h MintRoute.cc
  ./build.sh > "$OUT/rebuild.log" 2>&1 || echo "WARNING: rebuild after restore failed"
  if [ "$(md5sum < EbWsn.cc)" = "$(md5sum < .loop/gen/EbWsn.cc)" ] && [ "$(md5sum < MintRoute.cc)" = "$MR_MD5" ]; then
    echo "RESTORED (EbWsn == loop.sh's generation, MintRoute.cc unchanged)"
  else
    echo "!! NOT RESTORED"
  fi
}
trap restore EXIT

node "$NET/type_probe.mjs" "$NET" || { echo "BROKEN: instrument failed"; exit 3; }
touch EbWsn.cc EbWsn.h MintRoute.cc
./build.sh > "$OUT/build.log" 2>&1 || { echo "BROKEN: build failed"; tail -20 "$OUT/build.log"; exit 3; }
./out/clang-release/$(basename "$PWD").exe -u Cmdenv -c "$CFG" -n ".;../inet4.5/src" \
  --sim-time-limit="$T" --result-dir="$OUT/res" > "$OUT/run.log" 2>&1 \
  || { echo "BROKEN: run failed"; tail -10 "$OUT/run.log"; exit 3; }
node "$NET/type_analyse.mjs" "$(ls "$OUT"/res/*.sca | head -1)"

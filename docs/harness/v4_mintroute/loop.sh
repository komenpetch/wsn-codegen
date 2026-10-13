#!/bin/bash
# Step 3g's run test, ONE command end to end (user, 2026-10-13, Q12):
#   generate structure 4 -> stage -> derive MintRoute's wrapper -> refuse if the
#   copied generated code drifted -> build -> run [Config V4] (the recorded
#   control), [Config ParentPlain] and [Config Parent] -> gate -> report.
#
# Generated from Update_wsn/C0_project AS IT IS, read in place (flooding, the
# no-sink default). type_check.sh and leak_check.sh stay separate, as in
# ../v4_static; they run on the build this script leaves staged.
#
# GATED: tree.mjs on [Config Parent] (every sensor has a parent it heard, the
# parents reach the sink, the sink is its own root at cost 0, INET's route to the
# sink is via the parent, every ROUTE arrival carries MintRoute's fields, no data
# event) and invariants.sh on the same run.
# REPORTED, not gated: hops against shortest paths, first-parent times, switches,
# costs, estimates (tree.mjs); [Config V4]'s event number against the recorded
# #38285; how many scalars differ between Parent and ParentPlain (mrt:* aside).
#
# EXIT CODES
#   0  GREEN   every gate holds
#   1  RED     a gate failed
#   2  REFUSE  MintRoute's copy of generated code drifted (check_copy.mjs): the
#              build would test a transmit that is not the generated one
#   3  BROKEN  generate / derive / build / run failed, or a run is not the one
#              this script thinks it is
#
# ⚠ `set -u` is deliberately NOT set: OMNeT++'s own setenv reads unbound
# variables (IN_NIX_SHELL) and dies under it.
#
# Run from the OMNeT++ MSYS2 CLANG64 shell:
#   MSYSTEM=CLANG64 CHERE_INVOKING=1 \
#     <omnetpp>/tools/win32.x86_64/usr/bin/bash.exe -lc \
#     '/c/Users/Komen/Desktop/Proj/Simulation/v4_mintroute/loop.sh'
set -e

# node is not on the CLANG64 shell's PATH; the generator needs it.
export PATH="/c/Program Files/nodejs:$PATH"
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q
export PATH="/c/Users/Komen/Desktop/Proj/Simulation/inet4.5/src:$PATH"

NET="$(cd "$(dirname "$0")" && pwd)"
GEN=/c/Users/Komen/Desktop/Proj/wsn-codegen
PROJECT=/c/Users/Komen/Desktop/Proj/Update_wsn/C0_project
EXE="./out/clang-release/$(basename "$NET").exe"
TMP=$NET/.loop
LIMIT=${LIMIT:-300s}

rm -rf "$TMP"; mkdir -p "$TMP"

cd "$GEN"
npm run generate -- "$PROJECT" "$TMP/gen" --v4 > "$TMP/gen.log" 2>&1 \
  || { echo "BROKEN: generate failed"; tail -20 "$TMP/gen.log"; exit 3; }
grep -q "(derived from [^)]*\bC2_ctl)" "$TMP/gen/EbWsn.h" \
  || { echo "BROKEN: expected the flooding split, got: $(grep -o '(derived from [^)]*)' "$TMP/gen/EbWsn.h")"; exit 3; }
# MintRouteTable shares the module's PRouteTable only if both inherit it
# virtually (Q14 = b).
grep -q "public virtual PRouteTable {" "$TMP/gen/EbWsn.h" \
  || { echo "BROKEN: the generated module does not inherit PRouteTable virtually"; exit 3; }

cp "$TMP/gen/EbWsn.h" "$TMP/gen/EbWsn.cc" "$TMP/gen/EbWsn.ned" "$NET/"
node "$NET/derive_wrapper.mjs" "$NET" > "$TMP/derive.log" 2>&1 \
  || { cat "$TMP/derive.log"; exit 3; }
rc=0; node "$NET/check_copy.mjs" "$NET" > "$TMP/copy.log" 2>&1 || rc=$?
cat "$TMP/copy.log"
[ "$rc" -eq 2 ] && exit 2
[ "$rc" -eq 0 ] || exit 3
# ⚠ touch, or make compares timestamps against the existing object and says
# "Nothing to be done" -- after which the run uses the STALE binary.
touch "$NET/EbWsn.cc" "$NET/EbWsn.h" "$NET/MintRoute.cc" "$NET/MintRoute.h"

cd "$NET"
# tree.mjs reads absent fired:* counters as 0; that is only "never fired" if
# the events exist under these names.
for ev in start_tx_dataPkt_bct start_tx_dataPkt_fwd receive_dataPkt receive_dup_dataPkt; do
  grep -q "bool $ev(" EbWsn.h || { echo "BROKEN: no event $ev in the staged EbWsn.h"; exit 3; }
done
grep -q "bool addEntry(" EbWsn.h || { echo "BROKEN: no addEntry in the staged EbWsn.h"; exit 3; }

./build.sh > "$TMP/build.log" 2>&1 \
  || { echo "BROKEN: build failed"; tail -25 "$TMP/build.log"; exit 3; }

run() {   # run <config> <sim-time> [extra args]
  local cfg=$1 t=$2; shift 2
  "$EXE" -u Cmdenv -c "$cfg" -n ".;../inet4.5/src" \
    --sim-time-limit="$t" --result-dir="$TMP/res_$cfg" "$@" > "$TMP/run_$cfg.log" 2>&1 \
    || { echo "BROKEN: run $cfg failed"; tail -25 "$TMP/run_$cfg.log"; exit 3; }
  local sca; sca=$(ls "$TMP"/res_$cfg/*.sca 2>/dev/null | head -1)
  [ -n "$sca" ] || { echo "BROKEN: no .sca for $cfg"; exit 3; }
  [ "$(grep -m1 '^attr configname' "$sca" | awk '{print $3}')" = "$cfg" ] \
    || { echo "BROKEN: $cfg's .sca is another config's"; exit 3; }
}
run V4 60s
run ParentPlain "$LIMIT"
# Parent's log keeps MintRoute's parent changes (EV_INFO).
run Parent "$LIMIT" --cmdenv-express-mode=false --cmdenv-log-level=info
PARENT=$(ls "$TMP"/res_Parent/*.sca | head -1)
PLAIN=$(ls "$TMP"/res_ParentPlain/*.sca | head -1)

# Every radio at -85 dBm, or the four-hop field is a mesh.
sens=$(grep -E "^par SensorScopeNetwork\.\w+\.wlan\[0\]\.radio\.receiver sensitivity " "$PARENT")
[ "$(echo "$sens" | awk '$4 == "-85dBm"' | wc -l)" -eq 9 ] \
  || { echo "BROKEN: not all nine radios read -85dBm:"; echo "$sens"; exit 3; }

for c in V4 ParentPlain Parent; do
  echo "$c: $(grep -m1 -o 'limit reached -- at t=[^,]*, event #[0-9]*' "$TMP/run_$c.log")"
done
echo "V4 recorded: event #38285 (steps 3e/3f)"
diffs=$(diff <(grep '^scalar ' "$PLAIN" | grep -v ' mrt:' | sort) \
             <(grep '^scalar ' "$PARENT" | grep -v ' mrt:' | sort) | grep -c '^[<>]' || true)
echo "scalars differing between ParentPlain and Parent (mrt:* excluded): $diffs"
echo "parent changes in the log:"
grep -o 'MintRoute: parent of .*' "$TMP/run_Parent.log" | sed 's/^/  /' || true
echo

rt=0; node "$NET/tree.mjs" "$PARENT" || rt=$?
echo
ri=0; SCA="$PARENT" ./invariants.sh || ri=$?

[ "$rt" -eq 3 ] || [ "$ri" -eq 3 ] && { echo "BROKEN"; exit 3; }
[ "$rt" -eq 0 ] && [ "$ri" -eq 0 ] && { echo "GREEN: the tree gates and the invariants hold"; exit 0; }
echo "RED: tree=$rt invariants=$ri"
exit 1

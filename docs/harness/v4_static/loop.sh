#!/bin/bash
# Step 3f's run test, ONE command end to end (design/NextHop_Extension_Draft.md
# §7; user, 2026-10-12, Q9 = a):
#   generate structure 4 -> stage -> derive StaticRoutes' wrapper -> build ->
#   run [Config Plain] and [Config Static] -> gate conditions 1-4 -> report.
#
# Generated from Update_wsn/C0_project AS IT IS, read in place (flooding, the
# no-sink default). invariants.sh, type_check.sh and leak_check.sh stay separate
# scripts, as in ../v3_flood; they run on the build this script leaves staged.
#
# GATED (from the static:* scalars StaticRoutes records, and fired:*):
#   1 addEntry's result agrees with "the next hop has been heard" on every call
#     (static:mismatch = 0), and both outcomes occurred (accepted, refused > 0)
#   2 INET's table holds every accepted entry as one route, dest via next hop,
#     metric 2 (static:routesWrong = 0), and one entry replaced a one-hop route
#     (static:overrodeOneHop > 0, D5)
#   3 the update moved its destination to the new next hop and changed no other
#     route (static:updateNewInstalled = 1, static:updateOthersChanged = 0), the
#     old route having been in the table first (static:updateOldInstalled = 1)
#   4 the data transmit and receptions fired 0 times (no DATA, D10)
# REPORTED, not gated: whether Static's other scalars equal Plain's, the event
# numbers, and the route lines in the log.
#
# EXIT CODES
#   0  GREEN   all four conditions hold
#   1  RED     a condition failed
#   2  REFUSE  a condition could not be tested: nothing accepted, nothing
#              refused, no one-hop route replaced, or the update never had an
#              old route to replace (or never happened) -- passing or failing
#              then would test nothing
#   3  BROKEN  generate / derive / build / run failed, or the run is not the
#              one this script thinks it is
#
# ⚠ `set -u` is deliberately NOT set: OMNeT++'s own setenv reads unbound
# variables (IN_NIX_SHELL) and dies under it.
#
# Run from the OMNeT++ MSYS2 CLANG64 shell:
#   MSYSTEM=CLANG64 CHERE_INVOKING=1 \
#     <omnetpp>/tools/win32.x86_64/usr/bin/bash.exe -lc \
#     '/c/Users/Komen/Desktop/Proj/Simulation/v4_static/loop.sh'
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
LIMIT=${LIMIT:-60s}

rm -rf "$TMP"; mkdir -p "$TMP"

cd "$GEN"
npm run generate -- "$PROJECT" "$TMP/gen" --v4 > "$TMP/gen.log" 2>&1 \
  || { echo "BROKEN: generate failed"; tail -20 "$TMP/gen.log"; exit 3; }
grep -q "(derived from [^)]*\bC2_ctl)" "$TMP/gen/EbWsn.h" \
  || { echo "BROKEN: expected the flooding split, got: $(grep -o '(derived from [^)]*)' "$TMP/gen/EbWsn.h")"; exit 3; }

cp "$TMP/gen/EbWsn.h" "$TMP/gen/EbWsn.cc" "$TMP/gen/EbWsn.ned" "$NET/"
node "$NET/derive_wrapper.mjs" "$NET" > "$TMP/derive.log" 2>&1 \
  || { cat "$TMP/derive.log"; exit 3; }
# ⚠ touch, or make compares timestamps against the existing object and says
# "Nothing to be done" -- after which the run uses the STALE binary.
touch "$NET/EbWsn.cc" "$NET/EbWsn.h" "$NET/StaticRoutes.cc"

cd "$NET"
# Condition 4 reads absent fired:* counters as 0; that is only "never fired" if
# the events exist under these names.
for ev in start_tx_dataPkt_bct start_tx_dataPkt_fwd receive_dataPkt receive_dup_dataPkt; do
  grep -q "bool $ev(" EbWsn.h || { echo "BROKEN: no event $ev in the staged EbWsn.h"; exit 3; }
done
grep -q "bool addEntry(" EbWsn.h || { echo "BROKEN: no addEntry in the staged EbWsn.h"; exit 3; }

./build.sh > "$TMP/build.log" 2>&1 \
  || { echo "BROKEN: build failed"; tail -25 "$TMP/build.log"; exit 3; }

run() {   # run <config>
  "$EXE" -u Cmdenv -c "$1" -n ".;../inet4.5/src" \
    --sim-time-limit="$LIMIT" --result-dir="$TMP/res_$1" \
    --cmdenv-express-mode=false --cmdenv-log-level=info > "$TMP/run_$1.log" 2>&1 \
    || { echo "BROKEN: run $1 failed"; tail -25 "$TMP/run_$1.log"; exit 3; }
  local sca; sca=$(ls "$TMP"/res_$1/*.sca 2>/dev/null | head -1)
  [ -n "$sca" ] || { echo "BROKEN: no .sca for $1"; exit 3; }
  [ "$(grep -m1 '^attr configname' "$sca" | awk '{print $3}')" = "$1" ] \
    || { echo "BROKEN: $1's .sca is another config's"; exit 3; }
}
run Plain
run Static
PLAIN=$(ls "$TMP"/res_Plain/*.sca | head -1)
STATIC=$(ls "$TMP"/res_Static/*.sca | head -1)

# Every radio at -85 dBm, or the four-hop field is a mesh.
sens=$(grep -E "^par SensorScopeNetwork\.\w+\.wlan\[0\]\.radio\.receiver sensitivity " "$STATIC")
[ "$(echo "$sens" | awk '$4 == "-85dBm"' | wc -l)" -eq 9 ] \
  || { echo "BROKEN: not all nine radios read -85dBm:"; echo "$sens"; exit 3; }

sum() { grep -E "^scalar .* $1 " "$STATIC" | awk '{s+=$4} END {print s+0}'; }
grep -q " static:calls " "$STATIC" || { echo "BROKEN: no static:* scalars -- StaticRoutes did not run"; exit 3; }

calls=$(sum static:calls); acc=$(sum static:accepted); ref=$(sum static:refused)
mis=$(sum static:mismatch); over=$(sum static:overrodeOneHop)
chk=$(sum static:routesChecked); wrong=$(sum static:routesWrong)
upd=$(sum static:updateApplied); old=$(sum static:updateOldInstalled)
new=$(sum static:updateNewInstalled); others=$(sum static:updateOthersChanged)
data=0
for ev in start_tx_dataPkt_bct start_tx_dataPkt_fwd receive_dataPkt receive_dup_dataPkt; do
  data=$((data + $(sum "fired:$ev")))
done

echo "addEntry: calls=$calls accepted=$acc refused=$ref mismatch=$mis"
echo "INET's table: entries checked=$chk wrong=$wrong one-hop routes replaced=$over"
echo "update: applied=$upd oldInstalled=$old newInstalled=$new othersChanged=$others"
echo "data events fired: $data"
# installRoute's three log lines: a new one-hop route ("one-hop route to X via
# itself"), a new route through another node ("route to X via Y"), and a next
# hop updated in place ("route to X now via Y").
echo "log: one-hop=$(grep -c 'one-hop route to' "$TMP/run_Static.log" || true)" \
     "through-another-node=$(grep -E 'route to \S+ via ' "$TMP/run_Static.log" | grep -vc 'one-hop' || true)" \
     "updated-in-place=$(grep -c 'route to \S* now via ' "$TMP/run_Static.log" || true)"
for c in Plain Static; do
  echo "$c: $(grep -m1 -o 'limit reached -- at t=[^,]*, event #[0-9]*' "$TMP/run_$c.log")"
done
# Every scalar but StaticRoutes' own, Plain against Static.
diffs=$(diff <(grep '^scalar ' "$PLAIN" | grep -v ' static:' | sort) \
             <(grep '^scalar ' "$STATIC" | grep -v ' static:' | sort) | grep -c '^[<>]' || true)
echo "scalars differing between Plain and Static (static:* excluded): $diffs"

RED=""
[ "$mis" -eq 0 ]    || RED="$RED 1:mismatch=$mis"
[ "$wrong" -eq 0 ]  || RED="$RED 2:routesWrong=$wrong"
# Condition 3 can only fail once it was tested: the update applied over an old
# route that was in INET's table. Otherwise it is REFUSE below, not RED --
# measured: at LIMIT=40s the 45s update never happens, and an unguarded
# newInstalled check reported that as a failure.
if [ "$upd" -eq 1 ] && [ "$old" -eq 1 ]; then
  [ "$new" -eq 1 ]    || RED="$RED 3:newInstalled=$new"
  [ "$others" -eq 0 ] || RED="$RED 3:othersChanged=$others"
fi
[ "$data" -eq 0 ]   || RED="$RED 4:data=$data"
if [ -n "$RED" ]; then echo "RED:$RED"; exit 1; fi

REFUSE=""
[ "$acc" -gt 0 ]  || REFUSE="$REFUSE nothing-accepted"
[ "$ref" -gt 0 ]  || REFUSE="$REFUSE nothing-refused"
[ "$chk" -gt 0 ]  || REFUSE="$REFUSE no-route-checked"
[ "$over" -gt 0 ] || REFUSE="$REFUSE no-one-hop-route-replaced"
[ "$upd" -eq 1 ]  || REFUSE="$REFUSE update-applied=$upd"
[ "$old" -eq 1 ]  || REFUSE="$REFUSE old-route-never-installed"
if [ -n "$REFUSE" ]; then echo "REFUSE:$REFUSE"; exit 2; fi

echo "GREEN: conditions 1-4 hold"
exit 0

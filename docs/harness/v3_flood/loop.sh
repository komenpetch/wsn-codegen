#!/bin/bash
# ONE command, end to end: generate -> stage -> build -> run -> assert.
# Identical in Simulation/v3_aodv and Simulation/v3_flood. The ONLY difference
# between them is the `ROUTING` file beside this script: `aodv` or `flooding`.
#
# Both generate from Update_wsn/C0_project AS IT IS -- read in place, never
# copied, never edited, nothing added (user, 2026-09-27: "we not try to edit the
# input, everything that we build came from pattern"). Both routings come from
# the pattern the tool ships; ROUTING is passed to the generator as
# `--routing`, which chooses which of the pattern's two control splits it
# applies (C2_ctl = flooding ROUTE/BEACON, C2_aodv = AODV RREQ/RREP/RRER).
#
# ⚠ The generated routing is CHECKED against ROUTING, and a mismatch is BROKEN,
# not a result: the split the generator bundled is named in the header's
# provenance line, so a change in the generator that stopped honouring the
# choice would turn this folder into the other one without a word.
#
# EXIT CODES
#   0  GREEN   routes were published
#   1  RED     the neighbour table is populated and NO routes were published
#   2  REFUSE  the flood never populated a neighbour table, so zero routes
#              proves nothing
#   3  BROKEN  generate / wrong routing / build / run failed
#
# ⚠ `set -u` is deliberately NOT set: OMNeT++'s own setenv reads unbound
# variables (IN_NIX_SHELL) and dies under it.
#
# Run from the OMNeT++ MSYS2 CLANG64 shell, e.g. with LIMIT=60s:
#   MSYSTEM=CLANG64 CHERE_INVOKING=1 \
#     <omnetpp>/tools/win32.x86_64/usr/bin/bash.exe -lc \
#     'LIMIT=60s /c/Users/Komen/Desktop/Proj/Simulation/v3_flood/loop.sh'
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
LIMIT=${LIMIT:-20s}
ROUTING=$(tr -d '[:space:]' < "$NET/ROUTING")
case "$ROUTING" in
  aodv)     SPLIT=C2_aodv ;;
  flooding) SPLIT=C2_ctl ;;
  *) echo "BROKEN: ROUTING must be aodv or flooding, got '$ROUTING'"; exit 3 ;;
esac

rm -rf "$TMP"; mkdir -p "$TMP"

cd "$GEN"
npm run generate -- "$PROJECT" "$TMP/gen" --v3 --routing "$ROUTING" > "$TMP/gen.log" 2>&1 \
  || { echo "BROKEN: generate failed"; tail -20 "$TMP/gen.log"; exit 3; }

# The split the generator bundled is named in the header's provenance line.
grep -q "(derived from [^)]*\b$SPLIT)" "$TMP/gen/Pm3Wsn.h" \
  || { echo "BROKEN: this folder runs $ROUTING, but the generator produced: $(grep -o '(derived from [^)]*)' "$TMP/gen/Pm3Wsn.h")"; exit 3; }

cp "$TMP/gen/Pm3Wsn.h" "$TMP/gen/Pm3Wsn.cc" "$TMP/gen/Pm3Wsn.ned" "$NET/"
# ⚠ touch, or make compares timestamps against the existing object and says
# "Nothing to be done" -- after which the run uses the STALE binary and reports
# the previous result. That has bitten this project more than once.
touch "$NET/Pm3Wsn.cc" "$NET/Pm3Wsn.h"

cd "$NET"
./build.sh > "$TMP/build.log" 2>&1 \
  || { echo "BROKEN: build failed"; tail -25 "$TMP/build.log"; exit 3; }

"$EXE" -u Cmdenv -c Sink -n ".;../inet4.5/src" \
  --sim-time-limit="$LIMIT" --result-dir="$TMP/res" \
  --cmdenv-express-mode=false --cmdenv-log-level=info > "$TMP/run.log" 2>&1 \
  || { echo "BROKEN: run failed"; tail -25 "$TMP/run.log"; exit 3; }

SCA=$(ls "$TMP"/res/*.sca 2>/dev/null | head -1)
[ -n "$SCA" ] || { echo "BROKEN: no .sca written"; exit 3; }

# Guard against reading a run that is not the one we think it is.
CFG=$(grep -m1 "^attr configname" "$SCA" | awk '{print $3}')
[ "$CFG" = "Sink" ] || { echo "BROKEN: ran config '$CFG', expected Sink"; exit 3; }

addnew=$(grep "fired:add_newEntry" "$SCA" | awk '{s+=$4} END {print s+0}')
routes=$(grep -c "one-hop route to" "$TMP/run.log" || true)
leaves=$(grep -oE 'bool try_create_[a-z]+Pkt\(\)' Pm3Wsn.h | sed -E 's/bool try_create_([a-z]+)Pkt\(\)/\1/' | sort -u | tr '\n' ' ')

echo "routing=$ROUTING  types=[ $leaves]  config=$CFG  limit=$LIMIT  add_newEntry=$addnew  routesPublished=$routes"

if [ "$addnew" -eq 0 ]; then
  echo "REFUSE: no neighbour-table entry was ever created, so zero routes is vacuous."
  exit 2
fi
if [ "$routes" -eq 0 ]; then
  echo "RED: $addnew neighbour-table entries exist and ZERO routes were published."
  exit 1
fi
echo "GREEN: $routes routes published from $addnew neighbour-table entries."
exit 0

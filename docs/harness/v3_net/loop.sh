#!/bin/bash
# Feedback loop for: structure 3 on NetworkProtocolBase publishes ZERO routes
# into INET's IRoutingTable.
#
# ONE command, end to end: regenerate from the generator, stage, build, run,
# assert. It has to span the generator because that is where the fix goes --
# a loop that only re-ran the simulator would go green against a hand-edited
# module and tell us nothing about the shipped tool.
#
# EXIT CODES
#   0  GREEN   routes were published
#   1  RED     the neighbour table is populated and NO routes were published
#   2  REFUSE  the flood never populated a neighbour table, so a route count
#              of zero proves nothing. Without this the loop would report a
#              confident RED for an unrelated upstream breakage, which is the
#              failure mode that makes a loop worse than none.
#   3  BROKEN  generate / build / run failed
#
# ⚠ `set -u` is deliberately NOT set: OMNeT++'s own setenv reads unbound
# variables (IN_NIX_SHELL) and dies under it.
#
# Run from the OMNeT++ MSYS2 CLANG64 shell:
#   MSYSTEM=CLANG64 CHERE_INVOKING=1 \
#     <omnetpp>/tools/win32.x86_64/usr/bin/bash.exe -lc \
#     '/c/Users/Komen/Desktop/Proj/Simulation/v3_net/loop.sh'
set -e

# node is not on the CLANG64 shell's PATH; the generator needs it.
export PATH="/c/Program Files/nodejs:$PATH"
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q
export PATH="/c/Users/Komen/Desktop/Proj/Simulation/inet4.5/src:$PATH"

GEN=/c/Users/Komen/Desktop/Proj/wsn-codegen
NET=/c/Users/Komen/Desktop/Proj/Simulation/v3_net
TMP=$NET/.loop
LIMIT=${LIMIT:-20s}

rm -rf "$TMP"; mkdir -p "$TMP"

cd "$GEN"
npm run generate -- AppLayer "$TMP/gen" --v3 > "$TMP/gen.log" 2>&1 \
  || { echo "BROKEN: generate failed"; tail -20 "$TMP/gen.log"; exit 3; }

cp "$TMP/gen/Pm3Wsn.h" "$TMP/gen/Pm3Wsn.cc" "$TMP/gen/Pm3Wsn.ned" "$NET/"
# ⚠ touch, or make compares timestamps against the existing object and says
# "Nothing to be done" -- after which the run uses the STALE binary and reports
# the previous result. That has bitten this project more than once.
touch "$NET/Pm3Wsn.cc" "$NET/Pm3Wsn.h"

cd "$NET"
./build.sh > "$TMP/build.log" 2>&1 \
  || { echo "BROKEN: build failed"; tail -25 "$TMP/build.log"; exit 3; }

./out/clang-release/v3_net.exe -u Cmdenv -c Sink -n ".;../inet4.5/src" \
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

echo "config=$CFG  limit=$LIMIT  add_newEntry=$addnew  routesPublished=$routes"

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

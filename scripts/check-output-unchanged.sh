#!/bin/bash
# Regenerate all three case studies and diff them against a byte reference.
#
# The test suite already freezes the APP layer (tests/appLayerUnchanged.test.ts).
# Nothing freezes the two network-layer outputs, and a refactor that quietly
# changed one of them would still pass `npm test` -- the medium-binding tests
# assert particular lines, not the whole file. This is the coarse net that
# catches the rest.
#
#   scripts/check-output-unchanged.sh <reference-dir>
#
# Capture a reference first by generating into it, then run this after each
# refactoring step.
set -u
REF="${1:?usage: check-output-unchanged.sh <reference-dir>}"
cd "$(dirname "$0")/.."

npm run generate -- AppLayer out               >/dev/null 2>&1 || { echo "FAIL: app layer did not generate"; exit 1; }
npm run generate -- MintRoute out-m4 --machine M4 >/dev/null 2>&1 || { echo "FAIL: MintRoute did not generate"; exit 1; }
npm run generate -- RTMCS out-m6 --machine M6  >/dev/null 2>&1 || { echo "FAIL: RTMCS did not generate"; exit 1; }
# ⚠ Structure 3 too. It was missing, and it is the structure that moves most:
# the app shell carrying PPkt from a second project is what the simulation
# harness actually runs, so a refactor could change the module under test while
# all nine files above stayed byte-identical.
npm run generate -- AppLayer out-v3 --v3 \
  >/dev/null 2>&1 || { echo "FAIL: structure 3 did not generate"; exit 1; }
# ⚠ And structure 4, one per routing. It was missing as well, and it is what the
# v4 harnesses run: only line assertions in tests that need the advisor's
# project (so never on CI) covered it. The default routing gives the same bytes
# as --routing flooding, so flooding stands for both.
for r in flooding aodv dsr; do
  npm run generate -- AppLayer "out-v4-$r" --v4 --routing "$r" \
    >/dev/null 2>&1 || { echo "FAIL: structure 4 ($r) did not generate"; exit 1; }
done

rc=0
for f in EbWsn.h EbWsn.cc EbWsn.ned; do
  diff -q "$REF/$f" "out/$f" >/dev/null 2>&1 || { echo "CHANGED  $f"; rc=1; }
done
for f in EbWsn.h EbWsn.cc EbWsn.ned; do
  diff -q "$REF/m4/$f" "out-m4/$f" >/dev/null 2>&1 || { echo "CHANGED  m4/$f"; rc=1; }
done
for f in EbWsn.h EbWsn.cc EbWsn.ned; do
  diff -q "$REF/m6/$f" "out-m6/$f" >/dev/null 2>&1 || { echo "CHANGED  m6/$f"; rc=1; }
done
# Every module is EbWsn (pipeline.ts MODULE_NAME), so each output's three files
# live under their own reference subdirectory: app layer at the top, then m4/,
# m6/, v3/, and structure 4's v4/ (flooding), v4-aodv/ and v4-dsr/.
for f in EbWsn.h EbWsn.cc EbWsn.ned; do
  diff -q "$REF/v3/$f" "out-v3/$f" >/dev/null 2>&1 || { echo "CHANGED  v3/$f"; rc=1; }
done
for d in v4 v4-aodv v4-dsr; do
  src="out-$d"; [ "$d" = v4 ] && src="out-v4-flooding"
  for f in EbWsn.h EbWsn.cc EbWsn.ned; do
    diff -q "$REF/$d/$f" "$src/$f" >/dev/null 2>&1 || { echo "CHANGED  $d/$f"; rc=1; }
  done
done
[ $rc -eq 0 ] && echo "all 21 generated files byte-identical to the reference"
exit $rc

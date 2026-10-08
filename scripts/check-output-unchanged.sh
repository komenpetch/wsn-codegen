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
# m6/ and v3/.
for f in EbWsn.h EbWsn.cc EbWsn.ned; do
  diff -q "$REF/v3/$f" "out-v3/$f" >/dev/null 2>&1 || { echo "CHANGED  v3/$f"; rc=1; }
done
[ $rc -eq 0 ] && echo "all 12 generated files byte-identical to the reference"
exit $rc

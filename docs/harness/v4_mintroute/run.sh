#!/bin/bash
# Run one config on the nine-node SensorScope field: CONFIG=V4 (the generated
# structure 4) or CONFIG=Baseline (INET's MintRoute port). Same field, same
# link, no apps -- the comparison is module against module (D16 Q3).
#
# `source setenv` is what puts the OMNeT++ DLLs on PATH; without it the exe
# dies with a missing-DLL error naming the wrong file (liboppqtenv.dll when
# the absent library is really libINET.dll).
set -e
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q
cd "$(dirname "$0")"
export PATH="/c/Users/Komen/Desktop/Proj/Simulation/inet4.5/src:$PATH"
./out/clang-release/$(basename "$PWD").exe -u Cmdenv -c ${CONFIG:-V4} -n ".;../inet4.5/src" \
  --sim-time-limit=60s --result-dir=results "$@"

#!/bin/bash
# Run the NEW structure 3 on the same nine-node SensorScope field codegen_v3
# uses, so the comparison is module-against-module.
#
# `source setenv` is what puts the OMNeT++ DLLs on PATH; without it the exe
# dies with a missing-DLL error naming the wrong file (liboppqtenv.dll when
# the absent library is really libINET.dll).
set -e
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q
cd "$(dirname "$0")"
export PATH="/c/Users/Komen/Desktop/Proj/Simulation/inet4.5/src:$PATH"
./out/clang-release/v3_net.exe -u Cmdenv -c ${CONFIG:-Sink} -n ".;../inet4.5/src" \
  --sim-time-limit=60s --result-dir=results "$@"

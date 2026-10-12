#!/bin/bash
# Run one config of the staged build (loop.sh stages and builds it):
#   CONFIG=Static|Plain ./run.sh [extra omnetpp args]
#
# `source setenv` is what puts the OMNeT++ DLLs on PATH; without it the exe
# dies with a missing-DLL error naming the wrong file (liboppqtenv.dll when
# the absent library is really libINET.dll).
set -e
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q
cd "$(dirname "$0")"
export PATH="/c/Users/Komen/Desktop/Proj/Simulation/inet4.5/src:$PATH"
./out/clang-release/$(basename "$PWD").exe -u Cmdenv -c ${CONFIG:-Static} -n ".;../inet4.5/src" \
  --sim-time-limit=60s --result-dir=results "$@"

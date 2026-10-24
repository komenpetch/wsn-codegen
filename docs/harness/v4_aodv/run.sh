#!/bin/bash
# Run one config: CONFIG=Control (default). The run length is the config's own
# sim-time-limit; pass --sim-time-limit=... to override it.
#
# `source setenv` is what puts the OMNeT++ DLLs on PATH; without it the exe
# dies with a missing-DLL error naming the wrong file (liboppqtenv.dll when
# the absent library is really libINET.dll).
set -e
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q
cd "$(dirname "$0")"
export PATH="/c/Users/Komen/Desktop/Proj/Simulation/inet4.5/src:$PATH"
./out/clang-release/$(basename "$PWD").exe -u Cmdenv -c ${CONFIG:-Control} -n ".;../inet4.5/src" \
  --result-dir=results "$@"

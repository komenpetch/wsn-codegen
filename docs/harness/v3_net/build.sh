#!/bin/bash
# Build the NEW structure 3 -- the app-layer module carrying the BUNDLED
# pattern extension (PPkt + PRouteTable) -- in a copy of codegen_v3's harness.
#
# codegen_v3 itself stays FROZEN: it holds the three-config flood comparison
# and its staged module is the old structure 3, carrying MintRoute's PPkt.
# This directory is a copy of its wiring with the new module staged instead,
# so any behavioural difference is the MODULE and not the harness.
#
# Run from the OMNeT++ MSYS2 CLANG64 shell:
#   MSYSTEM=CLANG64 CHERE_INVOKING=1 \
#     <omnetpp>/tools/win32.x86_64/usr/bin/bash.exe -lc \
#     '/c/Users/Komen/Desktop/Proj/Simulation/v3_net/build.sh'
set -e
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q
cd "$(dirname "$0")"

# -KINET4_5_PROJ=../inet4.5 : this project sits BESIDE inet4.5, not inside it.
opp_makemake -f --deep -O out -KINET4_5_PROJ=../inet4.5 -DINET_IMPORT -I. \
  '-I$(INET4_5_PROJ)/src' '-L$(INET4_5_PROJ)/src' '-lINET$(D)'

make MODE=release

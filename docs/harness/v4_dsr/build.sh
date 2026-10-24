#!/bin/bash
# Build the staged structure 4, DSR routing (EbWsn) -- see README.md.
# The executable is named after this folder (opp_makemake picks it), so every
# script here runs ./out/clang-release/$(basename "$PWD").exe.
#
# Run from the OMNeT++ MSYS2 CLANG64 shell, e.g. from PowerShell:
#   $env:MSYSTEM='CLANG64'; $env:CHERE_INVOKING='1'
#   & <omnetpp>\tools\win32.x86_64\usr\bin\bash.exe -l <this folder>/build.sh
set -e
source /c/Users/Komen/Desktop/omnetpp-6.3.0/setenv -q
cd "$(dirname "$0")"

# -KINET4_5_PROJ=../inet4.5 : this project sits BESIDE inet4.5, not inside it.
opp_makemake -f --deep -O out -KINET4_5_PROJ=../inet4.5 -DINET_IMPORT -I. \
  '-I$(INET4_5_PROJ)/src' '-L$(INET4_5_PROJ)/src' '-lINET$(D)'

make MODE=release

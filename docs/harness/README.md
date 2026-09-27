# Simulation harnesses

The OMNeT++/INET harnesses the generated modules are measured in. Every
simulation number quoted in the project record was produced by one of these, so
they are kept here rather than only beside the simulator, where nothing is
version-controlled.

## ⚠ These are copies, and the working copy is elsewhere

A harness has to sit beside `inet4.5` to build — `opp_makemake` resolves
`-KINET4_5_PROJ=../inet4.5` relative to the project directory, and the NED path
is `.;../inet4.5/src`. So the **working** copy lives at
`Simulation/<name>/`, outside this repo, and what is here is a snapshot.

**When you change one, change it there and copy it back.** They will drift
otherwise, and a drifted harness is worse than none: it makes a recorded number
unreproducible while looking reproducible.

## Why they are not in a repo of their own

`Proj/` is deliberately not a git repository (settled 2026-09-19), and that is
not being reopened. This directory is the mitigation: the artifacts that cannot
be regenerated get history and a backup, and the ones that can are left out.

## What is here, and what is not

Kept — none of it can be regenerated:

| file | what it is |
|---|---|
| `omnetpp.ini` | the configs, with each one's prediction and falsifier written in |
| `SensorScopeNetwork.ned` | the nine-node field: geometry, scale factor, and the link-margin reasoning |
| `MinNetwork.ned` | the minimal network |
| `build.sh` / `run.sh` | build and run, including the environment traps |
| `loop.sh` | the route-publication feedback loop (generator → stage → build → run → assert) |
| `probe_state.mjs` | instruments finish() with container sizes, for residues the battery cannot see |
| `invariants.sh` | the flood's conservation laws, as a pass/fail battery |
| `leak_check.sh` / `leak_probe.mjs` | no delivery left waiting > 2 s — the regression check for the 2026-09-27 delivery leak, red-capable (101 stuck on the pre-fix build), and it restores and rebuilds the module whatever the outcome |
| `type_check.sh` / `type_probe.mjs` / `type_analyse.mjs` | the flood's conservation laws **per packet type** (a per-type defect can hide inside `invariants.sh`'s sums) plus per-type reach; takes an optional module dir to stage instead of `loop.sh`'s, so it checks both the flooding and the AODV routing; red-capable (proven on a hand-broken `.sca`); restores and rebuilds whatever the outcome |

Deliberately **not** kept:

- `Pm3Wsn.{h,cc,ned}` — generated. `npm run generate -- AppLayer <out> --v3`
  reproduces them byte-identically, and a stale copy here would invite someone
  to read it as the current output.
- `Makefile` — written by `opp_makemake`, and it bakes in the source list at
  generation time. Regenerate it whenever a file is added, removed or renamed.
- `out/`, `results*/` — build output and measurement data.

## v3_aodv and v3_flood — one folder per routing (2026-09-27)

Both folders generate from **`Update_wsn/C0_project` as it is** — read in place,
never copied, never edited, nothing added: both routings come from the pattern the
tool ships. The scripts are identical; the ONLY difference is the `ROUTING` file
(`aodv` / `flooding`), which `loop.sh` passes to the generator as `--routing` to
choose the pattern's control split (flooding ROUTE/BEACON, AODV RREQ/RREP/RRER).
`loop.sh` **refuses (exit 3) when the generator produced the other routing** —
proven by making the generator ignore `--routing`. Each folder has its own
`README.md`. Every script derives the folder and the executable name from where it
lives, so nothing in either points at `v3_net`.

**v3_net stays as it is**: every measurement recorded before these two existed
was made there.

## v3_net

Structure 3 as a `NetworkProtocolBase`, on the nine-node SensorScope field.
Two configs: `Sink` (the flood, with the sink as a destination) and
`SinkBeacon` (sink-originated, one hop — ⚠ a broadcast, not a sink-seeded
flood; `Dests` does double duty, so a node that consumes is a node that does
not forward).

Both scripts run from the OMNeT++ MSYS2 CLANG64 shell:

```bash
MSYSTEM=CLANG64 CHERE_INVOKING=1 \
  <omnetpp>/tools/win32.x86_64/usr/bin/bash.exe -lc \
  '/c/Users/Komen/Desktop/Proj/Simulation/v3_net/loop.sh'
```

⚠ Not from plain Git Bash: `source setenv` there does not add
`tools/win32.x86_64/clang64/bin`, and the run then dies with a missing-DLL
error naming the wrong library (`liboppqtenv.dll` when the absent one is
`libINET.dll`).

## Not yet mirrored

`Simulation/v3_bundled/` (the app-shell structure 3) and
`Simulation/inet4.5/codegen_results/` (the network-layer harness for `M4Wsn`
and the RTMCS configs) are still unversioned. They hold recorded measurements
too and have the same exposure.

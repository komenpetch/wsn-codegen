# v3_flood — structure 3, flooding routing

**Input: `Update_wsn/C0_project`, as it is** — read in place, never copied, never
edited, nothing added. Both routings come from the pattern the tool ships; the
input is the same example in both folders.

**Routing: flooding** — MintRoute's control split, **ROUTE / BEACON**. The `ROUTING`
file says `flooding`, and `loop.sh` passes it to the generator as
`--routing flooding`. (Flooding is also what the tool gives a project that names
no sink when no routing is chosen, so this folder's module is the default one.)
`loop.sh` refuses (exit 3) if the generated module is ever anything else.

The AODV twin is `../v3_aodv`: identical except for its `ROUTING` file.

## Run (OMNeT++ MSYS2 CLANG64 shell)

| script | what |
|---|---|
| `LIMIT=60s ./loop.sh` | generate → stage → build → run → assert routes published |
| `CFG=Sink ./invariants.sh` / `CFG=SinkBeacon ./invariants.sh` | the flood's ten conservation laws (runs the staged build) |
| `./type_check.sh - 60s Sink` | the same laws per packet type, plus per-type reach |
| `./leak_check.sh` | no delivery left waiting > 2 s |
| `CONFIG=Sink ./run.sh` | a plain 60 s run into `results/` |

Measured 2026-09-27, nine-node field, `[Config Sink]`, 60 s: see the CLAUDE.md
entry "ONE SIMULATOR FOLDER PER ROUTING — THE INPUT IS NEVER EDITED".

## Regenerated 2026-10-29

`loop.sh` restaged the module from wsn-codegen `65f4c8c`. The only change from the
module staged on 2026-10-14 is the destructor, which now takes the node out of the
shared node sets (`3f68fb5`), so a second run in one process starts clean. Measured
against the 2026-10-14 run: event #38364, all 655 scalars identical. `loop.sh` GREEN
(31 routes), `invariants.sh` GREEN on `Sink` and `SinkBeacon`, `type_check.sh` and
`leak_check.sh` GREEN.

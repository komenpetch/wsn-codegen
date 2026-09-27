# v3_aodv — structure 3, AODV routing

**Input: `Update_wsn/C0_project`, as it is** — read in place, never copied, never
edited, nothing added. Both routings come from the pattern the tool ships; the
input is the same example in both folders.

**Routing: AODV** — RTMCS's control split, **RREQ / RREP / RRER**. The `ROUTING` file
says `aodv`, and `loop.sh` passes it to the generator as `--routing aodv`.
`loop.sh` refuses (exit 3) if the generated module is ever anything else.

⚠ **Not full AODV yet.** Within the current scope (no unicast, no route tables
beyond the neighbour table) all three types are FLOODED. RTMCS itself sends RREP
and RRER to one next hop along the reverse route; that part is deferred.

The flooding twin is `../v3_flood`: identical except for its `ROUTING` file.

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

# v4_static — step 3f, the route-table run test

The run test of the next-hop design's route-table half
(`design/NextHop_Extension_Draft.md` D13, §7, settled with the user on 2026-10-12).
Structure 4's only route-table operation, `addEntry`, is never scheduled: a
Specific class calls it (D1). `StaticRoutes` is a Specific class with no routing
logic, so whatever fails here belongs to the generated code. No DATA (D10).

- **Module:** `npm run generate -- Update_wsn/C0_project <out> --v4`, the input read
  in place and unedited (flooding, the no-sink default). `loop.sh` regenerates it
  every run.
- **Field, radio, MAC, queue:** `../v3_flood`'s `[General]`, verbatim.
- **Settings:** `../v4_mintroute [Config V4]`'s: the baseline's timers (5 s beacons,
  20 s route floods), header 80b, the sink in `Dests`.
- **`[Config Plain]`:** the generated `EbWsn` alone (control).
- **`[Config Static]`:** `StaticRoutes`, the fixed route entries below.

| sensor | entries ("destination via next hop") |
|---|---|
| sensor1 | sink via sensor2, then sensor4 from the first route timer at or after 30 s (D15) |
| sensor2, sensor4, sensor7 | sink via sensor5 |
| sensor3 | sink via sensor6; sensor5 via sensor6 (replaces a one-hop route, D5) |
| sensor5, sensor8 | sink via sensor6 |
| sensor6 | sink via sink (never heard: the sink originates and forwards nothing) |

## Files

| file | what it is |
|---|---|
| `StaticRoutes.{h,cc,ned}` | the test's Specific class and its probe (`static:*` scalars) |
| `derive_wrapper.mjs` | writes `StaticRoutesNetworkLayer.ned` from the staged `EbWsn.ned`: the generated wrapper with exactly two renames, refused otherwise |
| `loop.sh` | generate → stage → derive → build → run Plain and Static → gate conditions 1–4 (exit 0 GREEN, 1 RED, 2 REFUSE, 3 BROKEN) |
| `invariants.sh` | `../v3_flood`'s battery, I9 restated per timer (I9a, I9b), I10 on the nodes the `.sca` puts in `Dests` |
| `type_check.sh`, `type_probe.mjs`, `type_analyse.mjs` | `../v3_flood`'s per-type laws, default config Static |
| `leak_check.sh`, `leak_probe.mjs` | `../v3_flood`'s delivery-leak check, default config Static |
| `omnetpp.ini` | both configs, with the prediction and falsifier written before the first run |

```bash
MSYSTEM=CLANG64 CHERE_INVOKING=1 /c/Users/Komen/Desktop/omnetpp-6.3.0/tools/win32.x86_64/usr/bin/bash.exe -lc '/c/Users/Komen/Desktop/Proj/Simulation/v4_static/loop.sh'
```

Then `invariants.sh`, `type_check.sh` and `leak_check.sh` the same way; they run
on the build `loop.sh` leaves staged.

## Measured, 2026-10-12, 60 s (wsn-codegen `62db125`)

`loop.sh` **GREEN**. Every prediction written in `omnetpp.ini` held:

| | measured |
|---|---|
| `addEntry` calls / accepted / refused / disagreeing with "heard" | 20 / 9 / 11 / 0 |
| 5 s call (nothing heard yet) | all 9 entries refused, on every sensor |
| 25 s call | 8 accepted, each in INET's table in the same event; sensor6's refused |
| 45 s call | sensor1 moves to sensor4 (accepted); sensor6's refused again |
| accepted entries in INET's table as one route, via the next hop, metric 2 | 8 of 8 |
| one-hop route replaced by a route entry (sensor3 → sensor5 via sensor6) | 1 |
| update: old route installed first / new route after / other routes changed | yes / yes / 0 |
| data transmit and receptions fired | 0 |
| log: one-hop routes / through another node / next hop updated in place | 31 / 7 / 2 |
| Plain and Static: last event / scalars differing (`static:*` excluded) | #38285 both / 0 |

`[Config Plain]` reproduces `../v4_mintroute [Config V4]` (event #38285), and
`StaticRoutes` changes nothing but the routes: route entries are read only by the
data transmit, which never runs.

**The gates go red when they should.** Five generator defects, each applied to
the staged module after generation, 5 of 5 RED:

| defect | verdict |
|---|---|
| `addEntry` without its guard | RED on 1: 9 accepted before anything was heard |
| route entries never published | RED on 2: 8 of 8 wrong (3 untestable: no old route) |
| a changed next hop not updated in place | RED on 2 (2 wrong) and 3 |
| metric 1 through another node | RED on 2: 8 of 8 wrong |
| INET's table never updated | RED on 2: 8 of 8 wrong (3 untestable) |

At `LIMIT=40s` the 45 s update never happens and `loop.sh` REFUSEs (exit 2). ⚠ Its
first version said RED there: it checked the new route before checking that the
update had happened, so "not tested" read as "failed". Fixed, and the five
mutants re-run against the fixed gates.

**Reported, not gated** (§7), Static, 60 s:

| node | beacons / route floods created | `send_down` | `send_up` = MAC Rx | consumed | queue overflow |
|---|---|---|---|---|---|
| sink | 0 / 0 | 0 | 66 | 66 | 0 |
| sensor1 | 11 / 3 | 66 | 105 | 0 | 0 |
| sensor2 | 11 / 3 | 80 | 259 | 0 | 4 |
| sensor3 | 11 / 3 | 80 | 164 | 0 | 7 |
| sensor4 | 11 / 3 | 78 | 216 | 0 | 13 |
| sensor5 | 11 / 3 | 88 | 344 | 0 | 27 |
| sensor6 | 11 / 3 | 70 | 160 | 0 | 0 |
| sensor7 | 11 / 3 | 85 | 211 | 0 | 13 |
| sensor8 | 11 / 3 | 71 | 159 | 0 | 0 |
| **total** | **88 / 24** | **618** | **1684** | **66 of 112** | **64** |

These are `../v4_mintroute`'s piece-2 figures exactly. Against `../v3_flood
[Config Sink]` (88 / 88 created, `send_down` 763, `send_up` 1677, 68 of 176
consumed, overflow 180) the difference is the timers alone: structure 4 equalled
v3_flood counter for counter at `266ad76` (with the PPkt chunk grown from 28 to
32 B), and of every step since, only D16 piece 2 (one timer per packet type, the
route flood at 20 s) moved a counter; piece 3, 3d, 3e and this run left every
scalar identical (event #38285).

`type_check.sh` **GREEN** on Static: every per-type law holds, reach full for
both types (7 of 7 originators on each sensor, 8 of 8 on the sink), staged
module restored byte-identical. `leak_check.sh` **GREEN**: 0 of 1684 deliveries
left waiting.

`invariants.sh` **GREEN** on both configs. Its new checks were run on doctored
copies of the real `.sca`: a node starved of route floods (I9a), four route
floods against a 20 s timer in 60 s (I9b), a destination originating (I10), and
a missing interval or `inDests` parameter (BROKEN), each caught on its own line;
a difference of one between nodes is not flagged (I9a's tolerance).

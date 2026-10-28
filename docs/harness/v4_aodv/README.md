# v4_aodv — structure 4 with the AODV split, on the old SensorScope field

The harness for the v4 AODV plan (`design/V4_AODV_Plan.md`): the RTMCS case
study on structure 4. The generated module comes from `C0_project` with
`npm run generate -- AppLayer <dir> --v4 --routing aodv`; AODV's logic, ported
from INET's `src/inet/routing/aodv/Aodv.cc`, is added as pasted test code in
later steps of the plan. No DATA.

The field, radio, MAC and queue are `../v4_mintroute`'s `[General]` (the old
field `SensorScopeNetwork`: the sink's only neighbour is sensor6; shortest hops
sensor6 1, sensor3/5/8 2, sensor2/4/7 3, sensor1 4), except the link rate.

**The link is 250 kbps, not 19.2 kbps** (plan Q26 b, 2026-10-19), for v4 and
the baseline alike: the radio's and SMAC's bitrate. At 19.2 kbps INET's AODV,
with 52-byte frames against v4's 10, collapses on this field and leaves almost
no routes to compare. The rate does not change the links: range is set by the
−85 dBm sensitivity, and Control at 250 kbps decodes every frame on every link,
every model counter equal to the 19.2 kbps run's. What it changes is capture
when frames overlap (a frame needs about 0 dB SNIR at 250 kbps, −8 dB at 19.2
kbps). The 19.2 kbps runs and logs are in `results_19k2/`; `omnetpp.ini`'s
`[General]` gives the two command-line options that rerun one.

## Files

| File | What |
|---|---|
| `EbWsn.h`, `EbWsn.cc`, `EbWsn.ned` | the generated module (wsn-codegen 3f68fb5 + the AODV names table, step 2a) with the AODV test code pasted in (steps 2b and 4; `../../scratch/v4_aodv_2026-10-19/paste_aodv/edited/`, switched on by `aodv = true`, HELLO by `useHelloMessages = true`) |
| `SensorScopeNetwork.ned` | the old field, copied from `../v4_mintroute` |
| `omnetpp.ini` | configs, each with its prediction and result |
| `build.sh`, `run.sh` | build (release) and run one config (`CONFIG=...`) |
| `route.mjs` | the route test for a Route run: every sensor's route to the sink, its next hop heard, its chain reaching the sink, INET's table agreeing; reports hops against the shortest path and the link rate |
| `fail.mjs` | the step-4 report: Hello360 (HELLO, RERR, false link breaks) and the FailSensor5/6 tests of plan §8 (routes around or without the failed node, RERRs after the failure, stale routes in INET's table) |
| `tree_svg.mjs` | checks a run's tree picture (`results/<config>-#<run>-tree.svg`) against its scalars, from the picture alone |
| `invariants.sh` | `../v4_mintroute`'s battery, restated for the test code (RREPs bypass `send_down`; I9a only where `aodv` is false; I9b's cap includes the RREQ retries); `SCA=<file>` checks an existing run |
| `type_check.sh`, `type_probe.mjs`, `type_analyse.mjs` | the per-type laws (only RREQ is a model type here); instruments, builds, runs, restores |
| `leak_check.sh`, `leak_probe.mjs` | deliveries left waiting; instruments, builds, runs, restores |
| `similarity_aodv.mjs` | the ported test code against INET's `Aodv.cc`, function by function (plan §7); `--self` is the positive control |

## Run

From PowerShell (the OMNeT++ CLANG64 shell is needed for `make` and the DLLs):

```
$env:MSYSTEM='CLANG64'; $env:CHERE_INVOKING='1'
& C:\Users\Komen\Desktop\omnetpp-6.3.0\tools\win32.x86_64\usr\bin\bash.exe -l C:/Users/Komen/Desktop/Proj/Simulation/v4_aodv/build.sh
& C:\Users\Komen\Desktop\omnetpp-6.3.0\tools\win32.x86_64\usr\bin\bash.exe -l C:/Users/Komen/Desktop/Proj/Simulation/v4_aodv/run.sh
```

## Configs and results

### At 250 kbps (since 2026-10-19; `results/`)

- **Control**: event #26590. Every model counter equals the 19.2 kbps run's;
  MAC Rx = 88 × degree and MAC Tx = 88 on every node (SMAC's re-sends gone).
- **Route360** (events #29329 #26227 #30730 #28229 #31588): `route.mjs` GREEN
  ×5, the sink's sequence number 0, no queue overflow, every sensor routed by
  13.0 s, 6–16 RREQs per run. Invariants GREEN on all five; per-type and leak
  checks GREEN on #0. ⚠ sensor4's route is 4 hops (shortest 3) in #1 and #3.
  Cause, traced: a node keeps the first copy of an RREQ for its reverse route,
  and a fresher copy (a retry) replaces it whatever its length. INET does the
  same (`Aodv.cc:801–806`, `871`). The RREP returns along that path. In both
  runs sensor5, the busiest relay, passed sensor4's RREQ on after a longer path
  had already reached sensor6. What delayed sensor5 is not logged.
- **Baseline** (events #147664 #123630 #123118 #123509 #129334): every sensor
  has an active route at 360 s, no RERR, the sink's sequence number 0, the sink
  counts 292–296 of 288 datagrams (copies included), 22–31 RREQs. ⚠ Routes
  longer than the shortest path too: sensor4 in #1, sensor7 in #4.
- **compare_aodv.mjs**: the same hop count on 37 of 40 sensor routes, the same
  next hop on 29 of 40 (most differences are at the tie nodes sensor1, sensor2
  and sensor7).
- **The sink's DATA count includes copies.** Traced on Baseline #0: 295 =
  276 distinct + 19 copies, and 12 datagrams never arrived. SMAC delivers a
  frame again when it is re-sent after a lost ACK; `Smac::receiveData` has no
  duplicate test, and IPv4 and SensorApp pass both copies on.

### Step 4: HELLO, RERR and node failure (2026-10-19)

The AODV test code gains INET's HELLO (`createHelloMessage`,
`sendHelloMessagesIfNeeded`, `handleHelloMessage`), the lost-link rule INET
leaves as a TODO (RFC 3561 6.9, quoted at `Aodv.cc:1427–1434`), INET's RERR
(`handleLinkBreakSendRERR`, `createRERR`, `handleRERR`, with its precursor rule),
and MintRoute's `failAt` switch. HELLO sits behind INET's own `useHelloMessages`,
off by default as in MyWSN, so Control and Route360 are unchanged (same events,
every earlier scalar equal). Checked by `fail.mjs`.

- **Hello360 at 5 s × 2** (the plan's Q20; Route360 with HELLO, nothing fails):
  `route.mjs` GREEN ×5, but 3–8 **false link breaks** per run. INET sends a HELLO only when its last
  broadcast is more than 5 s old, and checks every 3.75–5 s, so HELLOs go out
  every 7.5–10 s. SMAC then holds each one for a listen window (up to 0.7 s), so
  a neighbour can hear nothing for just over 10 s and all its neighbours
  declare it lost at once. Each break sends RERRs and restarts discoveries.
- **FailSensor5 at 5 s × 2**: GREEN. sensor5 is noticed 10 s after its last
  frame, RERRs follow, sensor4 and sensor7 reroute through sensor2 within 3 s,
  and no route uses sensor5 at 600 s. sensor7 ends at 4 hops where 3 exist.
- **FailSensor6 at 5 s × 2**: GREEN. Every sensor loses its route by 158.03 s,
  none gets one back, each sends about 120 RREQs, and INET's table keeps the
  old route on all seven.
- **Since Q27 (b): `allowedHelloLoss = 3`, a 15 s limit**, set in `[Config
  Hello360]`. The longest gap INET's timing allows at a receiver is about
  10.7 s, so no false break comes from the timing; one lost HELLO would still
  cause one. Measured: Hello360 GREEN ×5 with 0 link breaks and 0 RERRs;
  FailSensor5 GREEN, sensor5 noticed 15 s after its last frame, sensors routed
  again within 4.2 s; FailSensor6 GREEN. The runs at 2 (above) are in
  `results_loss2/`.

Invariants GREEN on every run at either limit; per-type and leak checks GREEN
on FailSensor5 #0 and Hello360 #0 at either limit. Files added for step 4: `fail.mjs`; `invariants.sh` counts
HELLOs and RERRs in I4 and I5.

### Step 5: the paste guide and `copy-sim-aodv` (2026-10-19)

- `../../scratch/v4_aodv_2026-10-19/paste_aodv/GUIDE.md`: the paste steps
  (fourteen at step 5; sixteen since the route tree below: three in `EbWsn.h`,
  twelve in `EbWsn.cc`, one in `EbWsn.ned`), written by
  `tools/make_paste_aodv.mjs` from the same edit list that writes `edited/`.
- `../../copy-sim-aodv/`: the three edited files, an `omnetpp.ini` with this
  harness's `[General]` and six configs (Control, Route360, Hello360,
  FailSensor5, FailSensor6, Baseline, each with its expected result), a
  `SensorScopeNetwork.ned` with the old field twice (`SensorScopeNetwork`, and
  `SensorScopeAodvNetwork` with every node an `AodvSensorNode` defined in the
  same file, `forwarding = true`), and IDE project files named
  `copy-sim-aodv`. A project of its own: its `EbWsn` is MintRoute's class name.
- Checked by building the five files from scratch: every run equals this
  harness's run scalar for scalar (Baseline: all 720 of INET's scalars; the
  harness adds 126 `bl:*`). ⚠ Those counts leave out the radio medium's 31
  scalars with quoted names; counting every `scalar` line they are 649,
  945–948, 978, 969 and 751.
- The user's IDE project `../codegen_v4_aodv` (2026-10-19, read only): Route360,
  Hello360, FailSensor5 and FailSensor6 #0, run one after another in one
  process, each equal to this harness's run in every scalar.

### The route tree (2026-10-19)

The test code draws each sensor's route to the sink, as MintRoute's does its
tree, in a block of its own marked `TREE DRAWING` (paste steps 3, 4 and 15; five
call lines in the AODV block): in Qtenv an arrow from each sensor to its next
hop (blue: active; grey dashes: invalidated by AODV, still in INET's table;
hidden: no route; a failed node's icon red), and at the end of every run with
`aodv` on, `results/<config>-#<run>-tree.svg`, written by the sink.

- Drawing only: with it, all 18 runs end at the same event and every scalar is
  equal (the staged files replaced, rebuilt and every config re-run; the
  results before are in the session scratchpad). `route.mjs` and `fail.mjs`
  still GREEN.
- `tree_svg.mjs <run.sca> <run-tree.svg>` checks a picture against its run from
  the picture alone (arrow ends, colour, hop counts, links): OK on all 12
  pictures, and RED on four doctored copies (an arrow made red, a hop count
  changed, an arrow removed, an invalidated route drawn as active).
- The Qtenv arrows, run in Cmdenv with the GUI check removed (scratch copy):
  Route360 #1, Hello360 #0, FailSensor5, FailSensor6 at the same events with
  every scalar equal; each arrow is the node's route.
- Next hops in the pictures: Route360 #1 sensor4 → sensor7 and #3 sensor4 →
  sensor2 (4 hops); FailSensor5 sensor1 → sensor4 → sensor7 → sensor8 →
  sensor6 → sink; FailSensor6 every route grey, still pointing where INET's
  table points.

### Similarity of the ported code (2026-10-27)

`node similarity_aodv.mjs` scores the staged module's ported functions against
INET's `Aodv.cc`, by name, with `scratch/similarity_mintroute.mjs`'s method
(normalised statements, LCS). The plan's 21 functions (§6) are in scope; the
other 30 methods of `Aodv.cc` are classified as not ported, and the script
refuses to run if any method is unclassified. On the staged module (md5
d3fdb709):

- 20 of 21 defined; `forwardRREQ` is not (the model's flood rebroadcasts the
  RREQ through `sendRREQ`, Q19). None statement-identical.
- All 21: **sym 19.9 %, recall 18.4 %** (module 339, baseline 403, LCS 74).
  Test code only (16 functions): sym 23.6 %, recall 20.9 %. Test code pasted
  into a generated method (`startRouteDiscovery`, `createRREQ`, `sendRREQ`,
  `handleRREQ`): sym 12.9 %, recall 13.0 %.
- Of the 322 baseline statements not reproduced: 44 are INET's route storage
  (`IRoute`, `AodvRouteData`, `routingTable`), which the test code replaces by
  decision (Q8, D15); 16 are `L3Address`/`addressType` and 20 are signatures (node
  ids, not addresses); 28 are log lines and 9 `ASSERT`s; 12 are RREP-ACK,
  jitter and expiry; the rest include the data path, IPv6, gratuitous-RREP and
  rate-limit lines inside the in-scope functions, and local names that differ.
- Checks: `--self` gives 21 of 21 identical; removing `handleRREP` from a copy
  reports it not defined; giving `createRERR` INET's own body scores it 100 %.

**After the rename round (2026-10-27): sym 27.0 %, recall 25.6 %** (module 360,
LCS 103); test code only 33.3 % / 30.7 %; pasted into generated methods
14.4 % / 14.6 %. Staged files now `EbWsn.cc` a6f5d5b2, `EbWsn.h` ddc6548e (`.ned`
c0d7e1d7 unchanged). The round changed only the AODV test code (paste blocks
c9, c10, h2, and one include), by four rules: INET's parameter names
(`hasOngoingRouteDiscovery(target)`); INET's spelling of the same computation
(`containsKey`, `*periodicJitter`, `lastBroadcastTime == 0`, the field-by-field
`UnreachableNode` copy, `helloMessage`/`newRERR` as named values); INET's log
lines word for word where they log the same event; INET's `ASSERT`s where the
condition holds by construction (`hasOngoingRouteDiscovery` in
complete/cancelRouteDiscovery, `containsKey(addressToRreqRetries, destAddr)`,
`useHelloMessages`). No new function (`getSelfIPAddress` is not added), no change
to route storage, control flow or generated code. **Behaviour unchanged, shown
twice:** a scratch build ran Control, Route360 ×5, Hello360 ×5, FailSensor5 and
FailSensor6 at the recorded events with every scalar equal and all 12 pictures
byte-identical; a second scratch build without `-DNDEBUG` (assertions on, their
text checked present in `EbWsn.o`) ran all 13 runs to `finish()` with no
assertion failing and the same scalars and pictures. ⚠ That build crashes while
deleting the network after a run (one run per process was used); the pre-rename
files crash the same way, so it comes from compiling the module without
`-DNDEBUG` against the release `libINET`, not from the round. The harness was
rebuilt and its Control run reproduced (649 of 649 scalars).

### At 19.2 kbps (2026-10-18/19; `results_19k2/`)

- **Control** (plan step 1, 2026-10-18): the generated module with no test code,
  the sink outside `Dests`, the sensors' RREQ timer at 5 s, the sink's RREQ timer
  and every RREP/RRER timer off. Event #31421; every model counter as predicted:
  11 RREQs per sensor, each transmitted once by every node (792), received
  88 × degree times per node with no loss (2816), 32 neighbour entries and 32
  one-hop routes, no queue overflow. SMAC put 816 data frames on the air for the
  792 the module handed down (its re-send after a failed contention, recorded
  2026-09-22).
- **Control after step 2a** (2026-10-19): the RREQ path under INET AODV's names
  (`startRouteDiscovery`, `sendRREQ`, `handleRREQ`, `createRREQ`). Renames only:
  all 618 scalars equal to the run above, event #31421.
- **Route360** (plan step 2b, 2026-10-19): the AODV test code on, 360 s, seed
  sets 0-4 (events #45736 #32068 #37264 #35354 #35363). After one fix (routes
  the test code changed outside a delivery round were not published to INET's
  table; createRoute/updateRoutingTable now publish, as INET's own do), route.mjs
  is GREEN in all five: every sensor has a route to the sink through a heard
  neighbour, no refused `addEntry`, INET's table agrees. RREQs originated
  35/12/25/18/22, not 8: the 2.96 s wait is short for SMAC's unicast RREPs
  (0.65 s a hop on average, up to 4.0 s). The sink's AODV sequence number rose
  to 1-3 and some routes came out longer than the shortest path, because the
  model floods the RREQ the sink should keep (A1) and sensor6's AODV code took
  that copy in; since Q25 (b) the AODV code ignores a RREQ sent by its own
  destination (INET's destination never forwards one, Aodv.cc:907), the model's
  flood unchanged: same events, sequence number 0, every route a shortest path.
  The sink's queue overflows in runs #0, #2, #4 (18/14/10 frames, RREQ
  forwards and RREPs in pairs, 14-18 s); reported by route.mjs. Invariants
  GREEN on all five runs and on Control; per-type and leak checks GREEN on
  runs #0 and #1.

Control on the files with the test code pasted in (`aodv = false`) equals the
step-1 run, 618 of 618 scalars.
- **Baseline** (plan step 3, 2026-10-19): INET's own AODV with MyWSN's
  `[Config AODV]` settings and SensorApp every 10 s, on `SensorScopeAodvNetwork`
  (the same field, every node a `BaselineAodvSensorNode`; written by
  `derive_baseline_net.mjs`, because a `typename` line cannot retype the field's
  concretely typed nodes). `BaselineAodv` records each node's route at the end
  (`bl:*`); `baseline_route.mjs` reports a run, `compare_aodv.mjs` pairs
  Route360 and Baseline run for run. ⚠ At this harness's 19.2 kbps link INET's
  AODV collapses: 2-3 of 8 sensors routed, DATA 1-4 %, 420-501 RREQs, the sink
  stalled on unicast RREPs. Its frames are 52 B against v4's 10 B. A probe at
  250 kbps routed every sensor, and the harness moved to 250 kbps (above).

Files added for step 3: `BaselineAodv.{h,cc,ned}`, `derive_baseline_net.mjs`
(writes `SensorScopeAodvNetwork.ned`), `baseline_route.mjs`, `compare_aodv.mjs`.
All three report scripts read the link rate off every module's `par` lines and
refuse a run whose radio and SMAC rates differ; `compare_aodv.mjs` also refuses
to pair two runs taken at different rates.

## Mirror

Mirrored in `wsn-codegen/docs/harness/v4_aodv/` (source files only). The working
copy is this folder; re-sync the mirror after editing.

# Case study: MintRoute

MintRoute builds a collection tree towards a sink. The sink broadcasts beacons; every node
estimates the quality of each link from the packets it hears, advertises its own cost in a
route broadcast, and picks the neighbour with the lowest path cost as its parent. This case
study runs the generated structure 4 as a MintRoute node and checks that the tree comes out
right.

**Baseline:** INET's MintRoute port (`src/inet/networklayer/mintroute/` in this project's INET
tree), which follows the MiXiM `MintRoute` of the thesis.

**Generated with:** `npm run generate -- <pattern project> out --v4 --routing flooding`. The
flooding split is the pattern's `ROUTE` and `BEACON` control types.

## Generated and pasted

| Generated | Pasted (the Specific layer) |
|---|---|
| `PPkt`, `RoutePkt` and `BeaconPkt` packet classes | `chooseParent`: pick the neighbour with the lowest total cost, with the baseline's skip tests and switch threshold |
| `sendBeaconBroadcast`, `sendRouteBroadcast`, `onReceiveBeaconPkt`, `onReceiveRoutePkt`, under MintRoute's names | `evaluateCost`: the ETX link cost, `2^24 / (sendEst · receiveEst) + (parentCost << 6)` |
| one timer per packet type: beacons every 5 s, route floods every 20 s, in the shape of MintRoute's `handleSelfMessage` | `updateEst` and `updateNeighborTable`: the smoothed link estimates |
| the neighbour table with its per-link counters (`received`, `lastSeqno`, `missed`), and `findOrCreateEntry`, `newEntry`, `updateNbrCounters` | the route fields (parent, cost, hop count, the estimate list) carried in a `MintRoutePkt` that extends the generated `RoutePkt` |
| the route-table operation `addEntry` and route publication into INET's routing table | `MintRouteTable`: the ETX state the generator does not produce |
| the flood with duplicate suppression, and the baseline's counters (`nbBeaconsSent`, `nbRouteFloodsSent`, `nbRouteFloodsReceived`) | the call that records the chosen parent with `addEntry` |

The generated module has two empty hooks, `updateNeighborTable()` and `chooseParent()`,
called from the route timer in the order `MintRoute.cc` calls them. The pasted code fills
them. Parent selection is hand-written on purpose: the Event-B model's version computes the
whole network's tree in one step and uses a different link cost, so it does not translate into
a per-node module (see the last section).

## Settings

- The sink is outside the set of destinations, so it originates; only the sink beacons (the
  sensors' beacon interval is 0), as in `MintRoute.cc`. Every node route-floods every 20 s.
- Frames are 10 bytes. The harness field and link settings are on the
  [case studies overview](index.md).
- `[Config Parent]` turns the test code on; `[Config ParentPlain]` runs the same settings on the
  generated module alone, as the control.

## Configurations and results

Harness field, 19.2 kbps, 10-byte frames. Events are the index of the run's last event.

| Config | Run | What was measured |
|---|---|---|
| `V4` | 60 s, ends at #36346 | the generated module alone: 88 beacons and 24 route floods created (11 and 3 per sensor), no queue overflow, the sink consumes all 112 |
| `Baseline` | 60 s, #5434 | the sink beacons 11 times and the sensors never; every node route-floods 3 times; each node receives exactly 3 times its neighbour count, so nothing is rebroadcast and nothing is lost |
| `ParentPlain` | 300 s, #78440 | the control: complete flood, every node transmits 194 frames (59 sink beacons plus 135 route floods), no overflow |
| `Parent` | 300 s, #78440 | the tree below. The pasted code changes no timing: every scalar equals `ParentPlain`'s |

**The tree** (`Parent`): sensor6 chooses the sink at 45 s; sensor3, sensor5 and sensor8
choose sensor6 at 65 s; sensor2 chooses sensor3 and sensor4 and sensor7 choose sensor5 at 85
s; sensor1 chooses sensor2 at 105 s. Every hop count is the shortest path. Costs are 4, 8, 12
and 16 (about 4 per perfect hop). No node changes parent. INET's routing table holds a route
to the sink via the chosen parent on all eight sensors, and 4,320 of 4,320 route packets
arrived carrying the route fields.

On the **figure field** (links exactly as drawn in the paper) the same configurations give a
different tree and the same behaviour: sensor6 and sensor8 choose the sink; sensor3 and
sensor5 choose sensor6; sensor7 chooses sensor8; sensor2 chooses sensor3; sensor4 chooses
sensor5; sensor1 chooses sensor2. Five runs with seed sets 0 to 4 (`Parent360`, 360 s, events
#92074 #92277 #92114 #91391 #91611) give that tree every time, complete at 105 s with no parent
change. The figure field's network file and the `Parent360` and failure configurations that use
it are in a separate project folder, not in the repository.

**Node failure** (figure field, node dead from 150 s, run to 600 s). INET's own crash cannot be
used: a crashed module whose timer fires throws. The test code drops every message once a
switch time has passed.

| Config | Result |
|---|---|
| `FailSensor5` (#132987) | sensor4 moves to sensor7 at 225 s; every living sensor still reaches the sink |
| `FailSensor6` (#134150) | sensor5 moves to sensor8 at 225 s, sensor2 to sensor5 at 245 s, sensor3 to sensor2 at 285 s; no loop at any time; every sensor reaches the sink through sensor8 |

On the harness field, sensor6 is the sink's only neighbour, so failing it leaves no route to
the sink at all. That run is useful for what it shows about the field, not the protocol.

## Checks

- **Ground truth for the tree.** A scratch build recorded all 1,156 `chooseParent` decisions
  across seven runs and replayed each against an independent copy of `MintRoute.cc`'s rules:
  0 disagreements. Every neighbour entry's hop, parent and cost matched that neighbour's
  latest advertisement, and the Qtenv arrows and the written picture matched the state.
- **Conservation laws** (`invariants.sh`): every transmit is an origination or a forward, a
  node forwards no more than it accepted, the queue conserves frames, accepted plus duplicates
  equals the frames the MAC decoded. Green on every run, and red on a hand-broken copy.
- **Per-type laws and leaks** (`type_check.sh`, `leak_check.sh`): the same laws per packet type,
  and no delivery left waiting. Green; 0 of 6,208 deliveries stuck at 300 s.
- **Six hand-code faults**, each introduced on purpose (no `addEntry`, no send estimate, parent
  set to the sink, a drifted copy of the transmit, and so on), were each caught, by the tree
  checker or by the copy check that refuses a build whose copy of the generated transmit has
  drifted.

## Comparison with the baseline

**Originations match; receptions do not, by design.** Over 1,200 s the sink beacons 239 times
and every node route-floods 60 times, in both modules. Receptions differ because the model
floods and the baseline deletes a control packet after counting it: 17,247 route packets
received in the generated module against 1,920 in the baseline.

**The baseline has no tree to compare with.** Without data traffic, INET's port chooses no
parent on any sensor, at 60, 300 or 1,200 s. It counts link quality only from beacons and
data, never from route packets, and only the sink beacons, so only sensor6 measures any link.
With SensorApp data added, it forms one parent of eight at 1,200 s; at 360 s one of five seeds
gives seven parents and a loop between two nodes. The reference for the tree is therefore the field itself: shortest hops from the
coordinates, the rule replay above, and INET's own routing table.

## Similarity to the baseline

Scored with the same longest-common-subsequence measure as the SensorApp case, against
`MintRoute.cc`, on the version with the measurement support taken out (the tree drawing, the
failure switch, the result scalars). Behaviour was checked unchanged by that removal.

| Scope | Precision | Recall | F |
|---|---|---|---|
| the 14 methods the structure covers, generated code only | 25.10 % | 28.70 % | 26.78 % |
| 18 functions: those 14 plus the 4 of the parent choice (`chooseParent`, `evaluateCost`, `updateEst`, `updateNeighborTable`) | 37.23 % | 43.21 % | 40.00 % |
| all three files (`.h`, `.cc`, `.ned` against `MintRoute.h`, `.cc`, `.ned`) | 11.02 % | 31.84 % | 16.38 % |

All 14 baseline method names exist in the generated module; 3 of the 14 are
statement-identical (`handleSelfMessage`, `setDownControlInfo`, `resolveBroadcast`). With the
parent choice, 4 of 18 are. The figure does not reach 100 % for reasons the model decides:
the generated send methods build the model's header where `MintRoute.cc` builds its own, and
the receive handlers carry the model's bodies.

## Known differences and limits

- **The link cost is ETX, and the Event-B model's differs.** The thesis text, the MiXiM code
  and the INET port all use ETX. Model machine `M5` uses `(120 − rEst)(120 − sEst) + cpCost`
  on percentages. Replaying the minimum-cost tree under both on the same runs, the optimal
  parents differ at one node in four of seven runs, always between equally short
  alternatives. The tool follows the baseline; the difference is an open question.
- **Ties depend on the seed.** Three nodes have two equally short candidates. One lost frame
  in the first 45 s decides each tie, so a different seed set can give a different, equally
  short tree (seed set 5 does on the harness field). A given configuration and seed always
  gives the same tree.
- **No data.** Routes and the tree are built and checked; no data packet is sent, so the
  unicast branch of the transmit is compiled and read but never run.
- **One link-estimate detail was corrected on the way.** The first frame from every neighbour
  was not counted, because the rebroadcast restamped the shared packet before the counter read
  it. The generator now counts on arrival; estimates on lossless links read 255 and each
  remaining lower value is a real loss.

## Files in the repository

[`harness/v4_mintroute/`](../harness/v4_mintroute/README.md): `omnetpp.ini` with every
configuration, its prediction and its result; the field; `build.sh`, `run.sh`, `loop.sh`;
`tree.mjs` (the tree checker), `compare.mjs` (baseline beside generated), `invariants.sh`,
`type_check.sh`, `leak_check.sh`; the hand-written class (`MintRoute.{h,cc,ned}`,
`MintRouteTable.h`, `MintRoutePkt.h`); and `BaselineMintRoute` for the run with data. The
pasted-in form of the test code, behind the `mintRoute` switch, and its paste guide are not in
the repository yet.

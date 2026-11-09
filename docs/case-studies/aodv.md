# Case study: AODV

AODV finds a route when one is needed. A node with no route to a destination floods a route
request (RREQ); the destination answers with a route reply (RREP) that travels back along the
path the request took; a node that loses a link sends a route error (RERR). This case study
runs the generated structure 4 as an AODV node, in the shape of the RTMCS case study.

**Baseline:** INET 4.5's `Aodv` (`src/inet/routing/aodv/Aodv.cc`). It is a routing daemon over
UDP and IPv4 that edits INET's routing table through netfilter hooks and never carries a data
packet itself, so its architecture cannot be copied into a module that sits on the MAC. Its
rules can be, and the pasted code ports them.

**Generated with:** `npm run generate -- <pattern project> out --v4 --routing aodv`. The AODV
split is the pattern's `RREQ`, `RREP` and `RRER` control types.

## Generated and pasted

| Generated | Pasted (`[AODV test code]`, switched by `aodv = true`) |
|---|---|
| `RreqPkt`, `RrepPkt` and `RrerPkt` packet classes | `AodvRreqPkt` and `AodvRrepPkt`, extending them with INET's field names (hop count, sequence numbers, lifetime) |
| the RREQ flood, with the model's duplicate suppression standing in for AODV's originator-and-RREQ-id check | the discovery rule: start a discovery only when there is no valid route and none under way |
| the RREQ path under INET's names: `startRouteDiscovery`, `sendRREQ`, `handleRREQ`, `createRREQ` | the reverse route and the destination's RREP, sent as a unicast along it; `forwardRREP` and `handleRREP` with INET's four freshness rules |
| one timer per packet type | retries: up to 4 RREQs, each waiting 2.96 s, then the discovery is cancelled |
| the neighbour table and its per-link counters | route data (validity, sequence number, hop count) kept in the test code, since the model's table holds only the next hop |
| the route-table operation `addEntry` and route publication into INET's routing table | HELLO messages, the lost-link rule, and RERR (`handleLinkBreakSendRERR`, `handleRERR`) |

**Why the replies bypass the model.** The generated events would flood an RREP like any
control packet. AODV sends it to one next hop, so the pasted code takes RREP frames at the
arrival, before the model sees them, and unicasts them along the reverse route. The RREQ stays
inside the model, which is where its flood and duplicate suppression live.

## Settings and scope decisions

- **No data.** A sensor starts a discovery for the sink on its RREQ timer (every 5 s), which
  stands in for the first datagram. INET's `Aodv` starts a discovery only when a datagram has no
  route, and the model has no data path to supply one.
- **The sink is outside the set of destinations.** Otherwise it sends no model frame, no node
  has it in its neighbour table, and the route-table operation refuses the last hop. The cost
  is that the sink rebroadcasts each RREQ once, which AODV's destination does not do. The
  pasted code ignores a RREQ whose sender is its own destination, so the sink's sequence
  number stays at 0.
- **No route expiry.** Routes stay active until an RERR invalidates them.
- **One table.** The model's table holds the reverse and forward routes; AODV's other fields
  live in the test code.
- **250 kbps.** At 19.2 kbps INET's 52-byte AODV frames collapse on this field. The runs below
  use 250 kbps for the generated module and the baseline alike.

## Configurations and results

Harness field, 250 kbps. Route tests read each sensor's route from the run's scalars.

| Config | Run | What was measured |
|---|---|---|
| `Control` | 60 s, #26590 | the generated module alone, no test code: 11 RREQs per sensor, none from the sink, no loss, 88 transmissions per node |
| `Route360` | 360 s, five seed sets: #29329 #26227 #30730 #28229 #31588 | route test green on all five: every sensor has a route to the sink through a neighbour it heard, every chain reaches the sink, INET's table agrees; all routed by 13.0 s; 6 to 16 RREQs per run; the sink's sequence number 0; no queue overflow |
| `Hello360` | five seed sets: #37030 #35901 #37018 #39993 #37671 | the same with HELLO on and nothing failing: 0 link breaks, 0 RERRs, 5 to 12 RREQs |
| `FailSensor5` | 600 s, #59982 | sensor5 dead from 150 s; its six neighbours notice at 164.03 s; 7 RERRs; sensor1, sensor4 and sensor7 have routes again by 168.24 s; no route uses sensor5 |
| `FailSensor6` | 600 s, #217735 | sensor6 dead from 150 s; noticed at 158.01 s; no sensor has a route afterwards (about 120 RREQs each), as the field allows: sensor6 is the sink's only neighbour |

**Not every route is a shortest path.** In two of the five `Route360` runs sensor4's route has 4
hops where 3 exist. A node keeps the first copy of a RREQ for its reverse route, and a fresher
copy (a retry) replaces it whatever its length. INET's code does the same. The RREP returns
along that path.

**Why 6 to 16 RREQs and not 8.** An RREP takes 0.65 s per hop on average and up to 4 s, so a
discovery can outlast the 2.96 s wait and retry. Several sensors get their route from an RREP
that arrives after the retries were cancelled. The baseline uses the same INET timings.

## Checks

- **Route test** (`route.mjs`): every sensor's route to the sink, whether its next hop was heard,
  whether the chain reaches the sink, whether INET's table holds the same next hop, and hops
  against the shortest path. Fails, refuses (wrong configuration, sensitivity or link rate) or
  passes.
- **Failure test** (`fail.mjs`): routes around or without the failed node, RERRs after the
  failure, stale routes in INET's table.
- **Conservation laws**, restated for the test code (RREPs bypass `send_down`, so they are
  counted separately): green on every run, red on doctored copies.
- **Per-type and leak checks**: green; 0 of 320 deliveries stuck.
- **HELLO limit.** At a 10 s limit (`allowedHelloLoss = 2`) 3 to 8 false link breaks appeared
  per run, because INET sends a HELLO only every 7.5 to 10 s and SMAC can hold one for a
  listen window. The limit is 15 s (`allowedHelloLoss = 3`) in the configurations above; the
  runs at 10 s are kept for reference.

## Comparison with the baseline

The baseline runs INET's `Aodv` as `MyWSN [Config AODV]` sets it (no HELLO, destination-only
replies, a fixed time to live), with SensorApp sending to the sink every 10 s, for 360 s, five
seed sets (#147664 #123630 #123118 #123509 #129334).

| | baseline | generated module |
|---|---|---|
| every sensor routed at 360 s | yes, in all five | yes, in all five |
| RERRs | none | none (no failure) |
| sink sequence number | 0 | 0 |
| RREQs per run | 22 to 31 | 6 to 16 |
| same hop count, sensor by sensor | 37 of 40 | |
| same next hop, sensor by sensor | 29 of 40 | |

Most differences are at the sensors with two equally short paths (sensor1, sensor2, sensor7).
The baseline counts 292 to 296 datagrams at the sink for 288 sent, because SMAC delivers a frame
again when it is re-sent after a lost acknowledgement and neither IPv4 nor SensorApp drops the
copy.

**An earlier baseline never ran AODV.** `MyWSN`'s configuration set the node type with a
`typename` line. OMNeT++ ignores that line for a submodule declared with a fixed type, so the
nodes stayed plain `SensorNode`s with no `aodv` module, and the run's packet counts were not
AODV's. The harness derives a network in which every node is declared with the AODV node type,
and sets IP forwarding on, which INET's own AODV router has and the `MyWSN` node lacked.

## Similarity to the baseline

Against `Aodv.cc`, function by function, on the version without the measurement support:

| Scope | Precision | Recall | F |
|---|---|---|---|
| the 21 functions the structure needs (20 defined, 0 statement-identical) | 31.89 % | 25.56 % | 28.37 % |
| all three files (`.h`, `.cc`, `.ned` against `Aodv.h`, `.cc`, `.ned`) | 4.49 % | 10.09 % | 6.21 % |

The 21 are chosen from the 51 functions in `Aodv.cc`. Of the other 30, 15 are not needed here
(the data path, route expiry, RREP-acknowledgement, gratuitous replies, the blacklist, the
link-break signal) and 15 are done differently (UDP and IP plumbing, module lifecycle). The
one needed function not defined is `forwardRREQ`: the model's flood rebroadcasts every new RREQ
through the generated `sendRREQ`, so a separate forwarding function would be a second send path.

The generated code alone scores 0 on the 21 functions, because the routing logic is the pasted
part; what the generator contributes shows in the four RREQ names it carries and in the run
results, not in this table. Using INET's parameter names and log wording where the code does the
same job raised the figure from about 19 to about 27 percent on the version that still had the
measurement support.

## Known differences and limits

- **The logic is ported from INET's `Aodv`, not translated from RTMCS.** Structure 4 refuses
  the RTMCS project, and RTMCS's RREQ is driven by a phase flag and not by demand. Its RERR comes
  only from a lost data packet, which no run here has.
- **The lost-link rule is INET's unfinished step.** INET quotes RFC 3561 section 6.9 in a
  comment and marks the feature as not implemented. The pasted code implements it. One lost
  HELLO with no other traffic from that neighbour would still cause a false break; none was
  seen.
- **INET's routing table keeps invalidated routes.** AODV invalidates a route in the test
  code's own data, and the table INET holds keeps the old next hop until a new RREP replaces
  it. Both are recorded.
- **First use of the MAC's unicast.** The RREPs are the first traffic in the project that uses
  SMAC's RTS, CTS and acknowledgement exchange.
- **The field.** `FailSensor6` cannot recover on this field because sensor6 is the sink's only
  neighbour.

## Files in the repository

[`harness/v4_aodv/`](../harness/v4_aodv/README.md): `omnetpp.ini` with each configuration, its
prediction and its result; the field; `build.sh`, `run.sh`; `route.mjs`, `fail.mjs`,
`tree_svg.mjs`; `invariants.sh`, `type_check.sh`, `leak_check.sh`; the baseline classes
(`BaselineAodv.*`) and `derive_baseline_net.mjs`; `similarity_aodv.mjs`. The pasted test code and
its paste guide are not in the repository yet.

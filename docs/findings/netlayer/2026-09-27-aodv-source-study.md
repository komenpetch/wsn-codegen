# AODV in source code — MiXiM and INET 4.5, against RTMCS and structure 3

**2026-09-27.** Research pass to prepare the next step of v3 (structure 3), against
primary sources only: the MiXiM source (the two local copies and the upstream
repository), INET 4.5's `src/inet/routing/aodv/`, the raw RTMCS Rodin XML
(`org.eventb.core.*` attributes, never `text_representation`), the PhD thesis, and
this generator's own source. Every claim carries the file, line or URL it came from.
Paths are relative to `Proj/` unless they start with `src/`, which is `wsn-codegen/src/`.

---

## Verdict

1. **MiXiM has no AODV — in any release.** Not in either local copy (v2.2), not in
   upstream `omnetpp-models/mixim` at v2.3. The thesis modelled AODV **in Event-B**
   (RTMCS, M4–M6) and used MiXiM only for the physical environment. So INET 4.5's
   `Aodv` is the one C++ AODV this project has to study. (§1)
2. **INET's AODV is a routing *daemon*, not a network protocol.** It is an
   `IApp` over UDP port 654 that edits IPv4's routing table and intercepts datagrams
   through netfilter hooks; it never forwards a data packet itself. Structure 3 is a
   `NetworkProtocolBase` directly above the MAC with no IP layer, so INET's
   *architecture* cannot be copied — only its *data model and rules*. (§2)
3. **Its data model maps onto RTMCS almost one-to-one, and onto an encoding the
   generator already has.** An INET route (destination, next hop, metric, sequence
   number) is exactly RTMCS's `bwdRouteTbl`/`fwdRouteTbl ∈ ND ↔ ND` with
   `…NextND`/`…HopCnt`/`…SeqNo` typed over it — the **pair-keyed** encoding
   (`src/engine/pairKeyed.ts`). What RTMCS lacks is everything with a clock:
   lifetimes, expiry, TTL rings, timeouts, rate limits, blacklist. (§5)
4. **Four differences matter for v3**, and one of them is the
   `updateNbrs` jam already on record: INET's route update is **create-or-update
   under a freshness rule**, where RTMCS adds a route **once**. (§6)
5. **The generator has most of the common half and none of the unicast half.**
   Per-leaf RREQ/RREP/RRER creating events, the flood, the pair-keyed tables and
   `IRoutingTable` publication all exist. Missing: a **unicast** transmit to a
   route's next hop (every structure-3 transmit is broadcast), **multi-hop** route
   publication, and a way through `routeTableOf`'s refusal of **two** tables. And
   structure 3 **refuses RTMCS outright** today. (§8)

---

## 1. MiXiM: there is no AODV to study

| evidence | source |
|---|---|
| Local MiXiM network layer: `AdaptiveProbabilisticBroadcast`, `ArpHost`, `DummyRoute`, `Flood`, `MintRoute`, `ProbabilisticBroadcast`, `SimpleRoute`, `WiseRoute` — no AODV | `archive/MintRouteProj/mixim/src/modules/netw/` (identical in `Simulation4.3/mixim`) |
| Local copy is **v2.2**; its CHANGELOG never mentions AODV | `archive/MintRouteProj/mixim/CHANGELOG`, first line |
| Upstream network layer: `AdaptiveProbabilisticBroadcast`, `ArpHost`, `DummyRoute`, `Flood`, `ProbabilisticBroadcast`, `WiseRoute` — **no AODV, and no MintRoute or SimpleRoute** | [omnetpp-models/mixim `src/modules/netw`](https://github.com/omnetpp-models/mixim/tree/master/src/modules/netw) |
| Upstream CHANGELOG, newest **v2.3**: no mention of AODV, RREQ or on-demand routing | [omnetpp-models/mixim CHANGELOG](https://github.com/omnetpp-models/mixim/blob/master/CHANGELOG) |
| The repository is marked "deprecated. Use INET 3.x instead!" | [omnetpp-models/mixim](https://github.com/omnetpp-models/mixim) |

- ⚠ **A text search for RREQ/RREP/RERR in MiXiM returns hits, and all are false.**
  `rerr` matches inside `strerror` (st-**rerr**-or) — in the XML library
  (`src/modules/simManager/Markup.cc`, `src/base/connectionManager/Markup1.cc`) and
  in socket error handling (`src/modules/FMInterface/FMInterface.cc:554`).
- **`MintRoute` and `SimpleRoute` in the local copy are the thesis project's own
  additions**, since upstream has neither. Worth knowing when citing "MiXiM's
  MintRoute".
- **How the thesis ran AODV without a C++ AODV:** it modelled the protocol in Event-B
  and co-simulated with MiXiM's environment. The thesis describes AODV's RREQ
  broadcast, RREP unicast along the backward path and RERR
  (`scratch/pdf_extracts/phdThesis.txt` ~6922–6990), layers them into the RTMCS
  refinement — *"Model M4 implements RREQ flooding mechanism before RREP unicasting
  operation and data packet forwarding mechanism via the route are introduce in
  model M5. Finally, RERR transmission is developed in the final refinement model
  (M6)"* (~7092) — and obtains the AODV control packets by partitioning `CONTROL`,
  exactly as MintRoute does for BEACON/ROUTE (~7772–7790).

## 2. INET 4.5's `Aodv`: architecture

- **Class:** `class Aodv : public RoutingProtocolBase, public NetfilterBase::HookBase, public UdpSocket::ICallback, public cListener`
  (`Simulation/inet4.5/src/inet/routing/aodv/Aodv.h`). NED: `simple Aodv like IApp`, `udpPort = default(654)` (`Aodv.ned`).
- **It needs IPv4.** `routingTableModule = default("^.ipv4.routingTable")`,
  `networkProtocolModule = default("^.ipv4.ip")` (`Aodv.ned`). At
  `INITSTAGE_ROUTING_PROTOCOLS` it registers itself as a netfilter hook on the IP
  layer and subscribes to `linkBrokenSignal` (`Aodv.cc:83–86`).
- **It never forwards data.** It installs routes in `IRoutingTable`; IPv4 does the
  forwarding. Data without a route is caught by the hooks
  (`datagramPreRoutingHook`/`datagramLocalOutHook` → `ensureRouteForDatagram`),
  **queued** (`delayDatagram`, `targetAddressToDelayedPackets`) and **reinjected**
  once a route exists (`completeRouteDiscovery`, `networkProtocol->reinjectQueuedDatagram`)
  (`Aodv.cc:186–238, 263–269, 1306–1330`).
- **Routes are INET's own `IRoute`**, created with `routingTable->createRoute()`,
  `setSourceType(IRoute::AODV)`, `setSource(this)`, and AODV's per-route state
  attached as `AodvRouteData` via `setProtocolData` (`Aodv.cc:975–1010`).
- **State it keeps** (`Aodv.h`): own `sequenceNum` and `rreqId`; `rreqsArrivalTime`
  (duplicate detection); `waitForRREPTimers`; `addressToRreqRetries`; `blacklist`;
  rate counters `rreqCount`/`rerrCount`; `targetAddressToDelayedPackets`; and five
  timers — hello, expunge, counter, RREP-ACK, blacklist.

## 3. Packets

From `AodvControlPackets.msg`: every control packet is an `AodvControlPacket extends
FieldsChunk` carrying `packetType` (`RREQ = 1, RREP = 2, RERR = 3, RREPACK = 4`, plus
IPv6 variants 16–19).

| packet | fields |
|---|---|
| `Rreq` | join/repair/gratuitous/destOnly/unknownSeqNum flags, `hopCount`, `rreqId`, `destAddr`, `destSeqNum`, `originatorAddr`, `originatorSeqNum` |
| `Rrep` | repair/ackRequired flags, `prefixSize`, `hopCount`, `destAddr`, `destSeqNum`, `originatorAddr`, `lifeTime` |
| `Rerr` | `noDeleteFlag`, `unreachableNodes[]` of `{addr, seqNum}` |
| `RrepAck` | 2 bytes, no payload |

- **Each type has its own field set.** Structure 3's `PPkt` is one uniform chunk with
  leaf subclasses sharing its fields. That is what the model states — the thesis:
  *"both control packets mentioned earlier have the same structure"* (~6960) — so the
  generator's uniform chunk is right for the model and is simply not INET's layout.
- A HELLO is an `Rrep` with an unspecified originator (`Aodv.cc:556–560`).

## 4. The algorithm, as INET implements it

**Discovery is triggered by data.** `ensureRouteForDatagram`: with an active route,
refresh its lifetime and let the datagram pass; otherwise queue it, and if no
discovery is running, `startRouteDiscovery` (`Aodv.cc:186–238`).

**Creating a RREQ** (`createRREQ`, `Aodv.cc:374–430`): increment the node's own
`sequenceNum` and put it in `originatorSeqNum`; copy the last known destination
sequence number or set `unknownSeqNumFlag`; increment `rreqId`; `hopCount = 0`; and
**record `(self, rreqId)` in `rreqsArrivalTime` before sending**, so the node ignores
its own RREQ when a neighbour rebroadcasts it.
⚠ *That last step is the same thing structure 3 was missing until today's leak fix —
an originator that did not record its own packet as seen (see CLAUDE.md, 2026-09-27).*

**Sending a RREQ** (`sendRREQ`, `Aodv.cc:271–340`): rate limit; expanding-ring TTL
(`ttlStart`, `+ttlIncrement` per retry, `netDiameter` beyond `ttlThreshold`); schedule
a `WaitForRrep` timer; broadcast with jitter. On timeout, `handleWaitForRREP` retries
up to `rreqRetries` times at full TTL, then `cancelRouteDiscovery` (`Aodv.cc:1267–1287`).

**Receiving a RREQ** (`handleRREQ`, `Aodv.cc:772–973`), in order:
1. drop if the previous hop is blacklisted;
2. create-or-update a route to the **previous hop** (metric 1, no valid seq);
3. **duplicate test:** drop if `(originatorAddr, rreqId)` was seen within `pathDiscoveryTime`, else record it;
4. `hopCount + 1`;
5. **reverse route** to the originator via the previous hop: create it, or update it
   only if `originatorSeqNum` is higher, **or** equal with a smaller hop count, **or**
   the sequence number is unknown;
6. **reply** if it is the destination, **or** an intermediate node with an active,
   valid, fresh-enough route and the `D` flag clear (with a loop check, and an
   optional gratuitous RREP);
7. otherwise **rebroadcast** if TTL allows.

**Receiving a RREP** (`handleRREP`, `Aodv.cc:549–707`): route to the previous hop;
`hopCount + 1`; **forward route** to the destination: create it, or update it if the
stored sequence number is invalid, or the RREP's is higher, or equal and the route is
inactive, or equal with a smaller hop count; then, if not the originator, **unicast it
on** along the reverse route, extending that route's lifetime and recording
**precursors**; if it is the originator, complete the discovery (reinject the queued
data).

**Route errors** (`Aodv.cc:1012–1206, 1501–1599`), started in three ways:
(i) a **link break** — the MAC's `linkBrokenSignal` on a data packet;
(ii) data to forward with **no active route** (`datagramForwardHook`);
(iii) a **RERR from a neighbour** that is the next hop of an active route.
Each marks the affected routes inactive (sequence number +1 in (i)/(ii), copied from
the RERR in (iii)), sets `lifeTime = now + deletePeriod`, and broadcasts a RERR with
**TTL 1**. It is a one-hop broadcast, not a flood.

**Expiry** (`expungeRoutes`, `Aodv.cc:1437–1470`): an active route past its lifetime
goes inactive for `deletePeriod`; an inactive one is deleted, unless a discovery for
that destination is still waiting.

## 5. The same concepts in RTMCS (raw XML, `EventB_model/RTMCS_7_4_proof/`)

What each refinement level introduces (variable declarations and invariant
predicates, `M4.bum`–`M6.bum`):

| level | adds | typed as |
|---|---|---|
| **M4** | backward (reverse) table, the pending queue, link/net sequence | `bwdRouteTbl ∈ ND ↔ ND`; `bwdNextND ∈ bwdRouteTbl → ND`; `bwdSeqNo`, `bwdHopCnt ∈ bwdRouteTbl → ℕ`; `updateNbrs ∈ ND ↔ ND`; `netSeqNo ∈ PKT → ℕ`; `linkSeqNo ∈ ND → ℕ` |
| **M5** | forward table, RREP bookkeeping, a per-hop destination address (a node, or `BROADCAST`) | `fwdRouteTbl ∈ ND ↔ ND`; `fwdNextND ∈ fwdRouteTbl → ND`; `fwdSeqNo`, `fwdHopCnt ∈ fwdRouteTbl → ℕ`; `rrepLists ∈ ND ↔ PKT`; `rrepSeqNo ∈ ND → ℕ`; `rrepFlg ∈ ND → BOOL`; `netDestAddr`, `envDestAddr ∈ PKT ⇸ (ND ∪ {BROADCAST})` |
| **M6** | route error | `rrerLists ∈ ND ↔ PKT`; `errND ∈ ND ↔ ND`, `errND ⊆ fwdRouteTbl`; `rrerFlg ∈ ND → BOOL` |

AODV events first appearing at each level include (not exhaustive — the full lists
are the event labels in each `.bum`): M4 `start_fldRREQ`, `reset_fldRREQ`,
`start_tx_rreq`, `add_routeEntry`, `add_routeEntry2`, `add_routeEntry3`; M5
`create_rreq`, `start_fldRREP`, `create_rrep`, `start_tx_rrep`,
`receive_rreqPkt`/`receive_dup_rreqPkt`, `receive_rrepPkt`/`receive_dup_rrepPkt`,
`dest_recv_rreqPkt`, `dest_recv_rrepPkt`, `add_bwdRouteEntry`, `add_fwdrouteEntry`,
`start_tx_dataPkt_fwd`; M6 `start_fldRRER`, `create_rrer`, `start_tx_rrer`,
`receive_rrerPkt`/`receive_dup_rrerPkt`, `dest_recv_rrerpkt`, `invalidate_neighbour`.

**The mapping, concept by concept:**

| concept | INET | RTMCS | note |
|---|---|---|---|
| a route | one `IRoute` | a pair `(node, dest)` in `bwdRouteTbl` or `fwdRouteTbl` | **one** table in INET, **two** in RTMCS |
| next hop | `setNextHop` | `bwdNextND` / `fwdNextND` | ✅ direct |
| hop count | `setMetric` | `bwdHopCnt` / `fwdHopCnt` | ✅ direct |
| destination sequence no. | `AodvRouteData::destSeqNum` | `bwdSeqNo` / `fwdSeqNo` | ✅ direct |
| route valid / active | `AodvRouteData::active` | `(n, d) ∉ errND` (forward routes, M6) | partial |
| lifetime, expiry, `validDestNum`, precursors | `AodvRouteData` | — | ⛔ no clock in the model |
| duplicate RREQ | `rreqsArrivalTime[(originator, rreqId)]`, expires | `pkt ∈ floodTbl(nb)`, permanent | same idea, different key and no expiry |
| pending replies | `waitForRREPTimers`, queued datagrams | `rrepLists` (RREQs a destination owes a reply for), `rrepFlg` | **different concepts**: INET waits at the *originator*, RTMCS queues at the *destination* |
| route error | RERR, TTL 1, from link-break signal or missing route | `start_fldRRER` → `create_rrer` → receive / dup / dest events | RTMCS's RRER **events** have the RREQ flood's shape — but see §6.4 |

- ⚠ **`bwdRouteTbl` is declared at M4, not M5.** `src/engine/routingTable.ts:60`
  says "RTMCS M5 declares BOTH"; true of the *flattened* M5, and the file-level
  correction is already in CLAUDE.md (2026-09-20).

## 6. Where RTMCS and INET's AODV differ — the four that matter for v3

1. **Route update: create-or-update vs one-shot.** INET creates **or updates** a
   route under a freshness rule (§4, steps 5 and the RREP rule). RTMCS's
   `add_bwdRouteEntry` guards `y ↦ s ∉ bwdRouteTbl` — it adds **once** — and that
   is the root of the `updateNbrs` jam measured on 2026-09-20
   (`docs/findings/netlayer/2026-09-20-updatenbrs-drain-research.md`). The
   repeatable twin tested then is INET's "update" half.
2. **Who replies.** INET lets a fresh intermediate node reply; RTMCS replies only at
   the destination (`dest_recv_rreqPkt`). That is INET's `destinationOnlyFlag = true`,
   which is how the project's own INET run was configured (§7).
3. **Time.** Expanding-ring TTL, RREP timeouts and retries, lifetimes, expiry,
   `deletePeriod`, rate limits, blacklist: all INET, none in RTMCS. For the generator
   these are **harness parameters or out of scope**, not rules.
4. **Route error.** INET broadcasts a RERR **one hop** and lets precursors
   propagate it. RTMCS's RRER events are named like the RREQ flood
   (`start_fldRRER`, `receive_dup_rrerPkt`), while the thesis describes RERR as
   *"sent to a source node via backward path"* (~6990) — **which of the two the
   guards implement is not checked here**, and should be before any RRER design.
   ✅ *Checked the same day: unicast.* `start_tx_rrer` (M6) sets
   `nxt = bwdNextND(x ↦ fDes)`, so the thesis is right and the flood names come from
   the phase-flag events RRER refines. See
   [2026-09-27-rreq-rrep-rrer-pattern-study.md](2026-09-27-rreq-rrep-rrer-pattern-study.md).
   INET is triggered by the MAC (`linkBrokenSignal`); RTMCS by the environment's
   link state (`lose_specifc_neighbours`, `errND`).

And one architectural difference that frames everything above: **INET separates
routing (daemon over UDP) from forwarding (IPv4); RTMCS and structure 3 do both in
one module** — `start_tx_dataPkt_fwd` forwards along `fwdNextND` itself.

## 7. What the project already did with INET's AODV

`Simulation/inet4.5/MyWSN/` (2026-06-05) runs INET's AODV on the sensor stack:
`AodvSensorNode extends SensorNode` adds an `aodv: Aodv` wired to the node's `at`
dispatcher (`AodvSensorNode.ned`), with **IPv4 enabled** (`hasIpv4 = true`). Its
`[Config AODV]` (`omnetpp.ini`) sets INET's AODV to **mimic RTMCS**, each line
commented with its reason: `useHelloMessages = false` ("RTMCS has no HELLO (relies
on env wsnLinks)"), `useLocalRepair = false`, `askGratuitousRREP = false`,
`destinationOnlyFlag = true` ("mirrors `dest_recv_rreqPkt`"), `ttlIncrement = 0`
with `ttlStart = ttlThreshold = netDiameter = 35` (no expanding ring),
`activeRouteTimeout = 30s`, rate limits raised to 1000. Results:
`MyWSN/results/AODV-#0.sca`. **This is the nearest thing to an AODV baseline for
RTMCS the project has**, the way INET's MintRoute is for the flood.

## 8. What this means for the next step of v3

**Already in the generator:**
- **Per-leaf RREQ/RREP/RRER creating events.** The derivation is leaf-generic and is
  tested on an RTMCS-shaped split: `tests/controlLeaves.test.ts`, "derives one per
  leaf for an RTMCS-shaped split — three, not two".
- **The RREQ flood**, with `floodTbl` dedup and, since today, the originator
  recording its own packet (§4's `createRREQ` step).
- **The pair-keyed encoding** for `…NextND`/`…HopCnt`/`…SeqNo ∈ R → T` over a node
  relation (`src/engine/pairKeyed.ts`).
- **`IRoutingTable` publication** and **GlobalArp** under module-path addressing
  (`src/engine/routingTable.ts`), which is what makes MAC resolution possible without IP.

**Missing, each checked in the source:**
- **Unicast.** Every structure-3 transmit goes to `MacAddress::BROADCAST_ADDRESS`
  (`src/engine/appTransmit.ts:87`). A RREP, and a forwarded data packet, go to **one
  next hop** read off a route table (`bwdNextND`/`fwdNextND`), whose MAC address
  GlobalArp would have to resolve. This is the largest new capability AODV needs.
- **Multi-hop routes.** `publishOneHopRoutes` publishes each neighbour as its own
  next hop with metric 1 (`src/engine/routingTable.ts:207–208`). An AODV route has
  a destination ≠ next hop and metric = hop count.
- **Two tables.** `routeTableOf` returns `null` when it finds two candidate node
  relations (`src/engine/routingTable.ts:53–64`), and RTMCS has two. INET puts both
  kinds of route in **one** table, which suggests an answer, but the case where the
  same destination sits in both tables with different next hops needs a decision.
- **RTMCS cannot be a structure-3 input today.** The extension requires
  `createdPkts, pktFwdr, pktData, ndBuff, sentUp` (`src/engine/patternExtension.ts:110`),
  and RTMCS declares no `createdPkts` (`grep -c createdPkts M6.bum` = 0). It goes
  through structure 2 (`M6Wsn`).

**Scope, per the project's standing rule** ("communication and sensing are common;
how nodes reach each other is per case study"): the RREQ/RREP/RRER **leaves**, the
flood, the **table data structure** and its **pair-keyed operations** are the common
side, and CLAUDE.md's scope lists "Common RouteTable scaffolding (`destND`, `nextHop`,
`isValid`)" as generated. **When** to reply, **which** route wins an update, and
**when** to invalidate are AODV's routing decisions, which CLAUDE.md assigns to the
case-study work (audience #2) and the 2026-09-20 research ruled protocol-specific.
Unicast sits on the line: *sending to a next hop* is communication, *choosing* the
next hop is routing.

## Open questions this study cannot settle

**Answered by the user the same day** (input not edited, the RREQ/RREP/RRER pattern
studied; unicast stays out; `[Config AODV]` is the baseline) and followed up, with
question 3 answered from the model, in
[2026-09-27-rreq-rrep-rrer-pattern-study.md](2026-09-27-rreq-rrep-rrer-pattern-study.md).

1. **Which model is v3's AODV input?** RTMCS as-is (refused by structure 3 today),
   or the pattern (`C0_project`) with an RREQ/RREP/RRER split, the way ROUTE/BEACON
   is bundled now?
2. **Is unicast in scope for the generator?** It is the one capability every AODV
   step past the RREQ flood depends on.
3. **One table or two?** INET's single table versus RTMCS's `bwd`/`fwd` split, and
   what wins when both hold the same destination.
4. **Is `[Config AODV]` in MyWSN the behavioural baseline** for v3's AODV, as INET's
   MintRoute was for the flood?

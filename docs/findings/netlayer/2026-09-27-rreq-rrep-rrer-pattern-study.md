# The RREQ/RREP/RRER pattern, and what v3 can take of it without unicast

**2026-09-27.** Follow-up to [2026-09-27-aodv-source-study.md](2026-09-27-aodv-source-study.md),
on the user's answers to its four open questions:

| # | question | answer (user, 2026-09-27) |
|---|---|---|
| 1 | v3's AODV input | **the input is not edited**; study the RREQ/RREP/RRER pattern |
| 2 | unicast | **stay inside the scope line, do not cross it yet** |
| 3 | one table or two | *"does it need to have two tables? if yes then we can do it"* — answered below |
| 4 | baseline | **`MyWSN [Config AODV]`** |

Sources: raw RTMCS XML (`EventB_model/RTMCS_7_4_proof/M4–M6.bum`, `C4.buc`, read
through `scripts/event.ts`, which prints what each machine declares, not the
flattened model), INET 4.5 `Aodv.cc`, and a generation probe on a scratch copy.
`Update_wsn/C0_project` was **md5-verified unchanged** afterwards.

---

## Verdict

1. **The three-way split costs the generator nothing.** A copy of `C0_project` given
   `partition(CONTROL, {RREQ}, {RREP}, {RRER})` generates structure 3 with no code
   change: `RreqPkt`/`RrepPkt`/`RrerPkt`, three creating events, three per-leaf
   counters, three broadcast methods, `CONTROL = {1, 2, 3}`, **clang 0 errors**. Diffed
   against the ROUTE/BEACON module with the leaf names normalised, the only difference
   is **exactly one more leaf's worth of code**. Every derivation, the transmit and the
   PRouteTable events included, keys on the control **set**, not on a leaf.
2. **But on its own it is not AODV, and the model says why.** In RTMCS a RREP is created
   only by a destination that owes one, a RRER only after a data packet is lost, and
   **both are unicast** along the reverse route. The per-leaf creating event the pattern
   derives originates every leaf from every sensor on every tick. So under question 2's
   line the faithful part of AODV is **RREQ creation, the RREQ flood, duplicate
   suppression, and a route to the previous hop**.
3. **Question 3: not now.** The forward table is filled only by RREP receptions, and
   the model sends a RREP unicast. Under question 2 a second table would be **declared
   and never filled**, which is the `Dests`/`Destination` defect class already on record.
   It becomes necessary exactly when unicast does, and at that point **two is what the
   model states**. Merging them is a routing decision.
4. **The table structure 3 already has *is* part of INET's AODV.** On every RREQ and
   RREP, `Aodv.cc` creates or updates a route to the **previous hop**, with next hop =
   destination and metric 1 (`Aodv.cc:787–794`, `567–574`). That is what structure 3
   publishes from its neighbour table today (31 routes, one per link).
5. **Open item §6.4 of the source study is now settled: RTMCS's RRER is unicast.**
   `start_tx_rrer` sets `nxt = bwdNextND(x ↦ fDes)`. The thesis's "sent to a source node
   via backward path" is what the guards implement. The events carry flood names
   (`start_fldRRER`, `receive_dup_rrerPkt`) because they refine the flood events'
   phase-flag shape, not because RRER is flooded.

---

## 1. How RTMCS routes each control type (declared per machine)

| | created by | created when | transmitted to | fills |
|---|---|---|---|---|
| **RREQ** | `create_rreq` (M5, refines `create_controlPkt`) | the node's RREQ phase is on (`floodFlg(s) = TRUE`, raised by `start_fldRREQ`) and it owes no RREP (`rrepFlg(s) = FALSE`); not triggered by data | **broadcast** (`netDestAddr ∪ {pkt ↦ BROADCAST}`, M5 @a14) | `bwdRouteTbl` (M4 `add_routeEntry`, refined as `add_bwdRouteEntry`) |
| **RREP** | `create_rrep` (M5) | a destination received a RREQ: `dest_recv_rreqPkt` adds `des ↦ pkt` to `rrepLists`, and `create_rrep` guards `s ↦ rreq ∈ rrepLists` | **one next hop**: `start_tx_rrep` sets `nxt = bwdNextND(x ↦ s)` with `s = finalDestAddr(pkt)` = the RREQ's originator | `fwdRouteTbl` (`add_fwdrouteEntry`, `type(pkt) = RREP`) |
| **RRER** | `create_rrer` (M6) | a **data** packet was lost: `lose_dataPkt` adds `f ↦ pkt` to `rrerLists`, and `create_rrer` needs `s ↦ eND ∈ fwdRouteTbl` | **one next hop**: `start_tx_rrer` sets `nxt = bwdNextND(x ↦ fDes)`, toward the lost packet's originator | `errND` (`invalidate_neighbour`) |

**Delivery is where unicast is enforced.** M5 refines the medium in two branches:
`find_neighbour` for `nxt = BROADCAST`, and `assign_forwarder` for `nxt ≠ BROADCAST`
with **`nb = nxt`**. So only the addressed neighbour receives.

The dependency chain follows from the table:

```
RREQ flood (broadcast) ──► bwdRouteTbl
                               │  bwdNextND: where a RREP goes (unicast)
                               ▼
                     RREP ──► fwdRouteTbl
                               │  fwdNextND: where data goes (unicast)
                               ▼
               data lost ──► RRER (unicast on bwdNextND) ──► errND ⊆ fwdRouteTbl
```

Everything below the first arrow needs unicast. RRER also needs data traffic, which
is the PEnv boundary (`creatingDataPacket -- no binding for data`).

**RTMCS and MintRoute share one structure.** RTMCS keeps `linkSeqNo` for RREQ only
(`start_tx_rreq`, M4) and stamps other control types from an unconstrained
`lsno ∈ ℕ`. MintRoute does the same with BEACON. The bundled extension keeps
`linkSeqNo` on the whole control branch and stamps nothing on the other branch. That
is the recorded B6 decision, and it is why the derivation is leaf-generic.

## 2. The probe: the split, derived

Method: copy `C0_project` to the scratchpad and add one context, `C2_aodv.buc`, that
declares `RREQ`, `RREP`, `RRER ∈ TYPE` and `partition(CONTROL, {RREQ}, {RREP}, {RRER})`.
With the project already split, the bundled ROUTE/BEACON default stands down (its
"already split" guard), which is the same module the bundle would produce if it
carried this split. The two ROUTE/BEACON placements measured on 2026-09-21 showed
this already. Then run `npm run generate -- <copy> <out> --v3` and compile both
modules with the bundled clang against INET 4.5.

| | ROUTE/BEACON (default) | RREQ/RREP/RRER (probe) |
|---|---|---|
| enum / `CONTROL` | `ROUTE=1, BEACON=2`, `{1, 2}` | `RREQ=1, RREP=2, RRER=3`, `{1, 2, 3}` |
| leaf chunks | `RoutePkt`, `BeaconPkt` | `RreqPkt`, `RrepPkt`, `RrerPkt` |
| creating events | `create_routePkt`, `create_beaconPkt` | `create_rreqPkt`, `create_rrepPkt`, `create_rrerPkt` |
| per-leaf counters | `routeSeqNo`, `beaconSeqNo` | `rreqSeqNo`, `rrepSeqNo`, `rrerSeqNo` |
| transmit, flood, `add_newEntry`, `update_nbr` | same | same |
| untranslated | 7 | 8 (the extra line is the third counter's `ND × {0}`, specialised at `INITSTAGE_LAST`) |
| `clang -fsyntax-only` | exit 0, 0 errors | exit 0, 0 errors |
| `.cc` lines | 1219 | 1320 |

A leaf-normalised `diff` of the two `.cc` files shows only the added leaf: one
constructor, one `try_create_<leaf>Pkt`, one scheduler call, one counter initialiser,
one `case` in `transmitPacket`, and one `send<Leaf>Broadcast`.

**What the probe also shows, and it is the point of §3.** The derived
`try_create_rrepPkt` and `try_create_rrerPkt` bind `x` over `ND ∖ Dests`, exactly
like `try_create_rreqPkt`. The pattern cannot know that in RTMCS a RREP waits on
`rrepLists` and a RRER waits on a lost data packet. Those conditions are about who
originates what and when, which is the per-case-study side of the scope rule (the
same finding as B1, MintRoute's sink-only beacon).

**Load, arithmetic only, not measured.** On the nine-node field ROUTE/BEACON doubled
origination and took queue overflow from 0 to 134 (2026-09-21). Three leaves offer
about 3 × 88 originations per minute where the single-leaf flood offers 88, so
overflow would be expected to be worse.

## 3. What question 2's line leaves

| capability | in the model | reachable without unicast |
|---|---|---|
| RREQ type, creation, flood, duplicate test | M4/M5 | ✅ already derived; the probe generates it |
| route to the previous hop (INET `Aodv.cc:787–794`) | ≈ PRouteTable `neighbourTbl` (bundled) | ✅ already published as one-hop `IRoute`s |
| reverse route to the RREQ originator (`bwdRouteTbl` + `bwdNextND`/`bwdSeqNo`/`bwdHopCnt`) | M4 `add_routeEntry` | ⚠ **fillable by the flood alone**, but it needs a hop-count packet field the bundle does not carry (`pktNbHops`, RTMCS M3), and the 2026-09-20 research ruled the event protocol-specific |
| RREP creation at the destination | M5 `dest_recv_rreqPkt` → `rrepLists` → `create_rrep` | ⛔ creation could fire, but its transmit is unicast |
| RREP delivery, forward route | M5 `start_tx_rrep`, `assign_forwarder`, `add_fwdrouteEntry` | ⛔ unicast |
| data forwarding on a route | M5 `start_tx_dataPkt_fwd` | ⛔ unicast, and data is the PEnv boundary |
| RRER | M6 | ⛔ unicast + data + forward table |

**The reverse table sits on the line.** Of the two tables, only `bwdRouteTbl` can be
filled by broadcast alone. Its drain event has the same shape as the bundled
`add_newEntry`: take a pair `x ↦ y` off `updateNbrs`, add an entry to a node relation,
and set pair-keyed attributes on it. The only difference is the key's second
component, the **forwarder** in MintRoute's neighbour table versus the **originator**
in RTMCS's reverse table. That makes the data structure and its drain common, and
the choice of key the per-protocol part.

## 4. Question 3, answered: does it need two tables?

**Not at this step.** Why, from the model:

- `fwdRouteTbl` is written by one event, `add_fwdrouteEntry`, and only for
  `type(pkt) = RREP` (M5 @g11).
- A RREP is delivered only to `nb = nxt` with `nxt = bwdNextND(…)` (M5 `start_tx_rrep`
  @g17, `assign_forwarder` @g13–g14).
- So with no unicast, no RREP arrives the way the model states. A second table would
  be declared, empty and fillable by nothing, the defect class fixed for `Dests` on
  2026-09-21 and for `Destination`/`Actuators` the same day.

**When unicast is taken up, yes, two, because the model says two.** The two tables are
read by different packets: RREP and RRER travel on `bwdNextND`, data on `fwdNextND`,
and `errND ⊆ fwdRouteTbl` invalidates only forward routes. The same key `y ↦ s` can sit
in both with different next hops. That happens when a node has a reverse route to `s`
from `s`'s RREQ and a forward route to `s` from `s`'s RREP. INET keeps one table and
settles that case with its freshness rule (`Aodv.cc:852–875`, `597–638`). That rule is
an AODV routing decision, so a generator that merged the tables would be making it.

**What does need a decision then is publication, not storage.** INET's
`IRoutingTable` is one table. `routeTableOf` refuses two candidates today, and that
refusal is correct until someone decides which table's routes are published, or with
what precedence.

## 5. Question 4: what `[Config AODV]` can be compared on

`Simulation/inet4.5/MyWSN/results/AODV-#0.sca` (2026-06-05, 60 s, `MyWsnSensorNetwork`):
- **4 nodes**, IPv4, SensorApp data: sensors sent 59/60/60 and the sink received **27**.
- **It records no AODV-internal counter.** `Aodv.cc` has no `recordScalar` and no
  `emit`, so RREQ, RREP and RERR counts and the route-table contents are absent.
  Only application, IP, queue and MAC counters are recorded.
- **INET's AODV is on-demand:** a RREQ is sent when a datagram has no route
  (`ensureRouteForDatagram`), and the route is then cached for `activeRouteTimeout = 30s`.
  Structure 3 originates control packets on its timer, and **RTMCS is not on-demand
  either**: flattened, `create_rreq` guards `floodFlg(s) = TRUE` and picks any
  `fDes ∈ ND`, so it fires whenever the node's RREQ phase is on, with no data packet
  involved. **So RREQ rates are not comparable, by design.**

To use it as the baseline, what can be compared under question 2 is **the routes
learned**. Two harness steps are needed first: (i) run `[Config AODV]` on the same
field as v3 (`v3_net` is nine nodes, MyWSN is four), and (ii) make it observable, for
example by dumping `ipv4.routingTable` at `finish()` or counting frames on UDP 654.
Neither step changes INET's AODV.

## 6. Found on the way, recorded, not fixed

- **Structure 2 on RTMCS (`M6Wsn`) delivers a unicast-addressed frame to every
  neighbour.** Its arrival restores `envDestAddr` from the wire and runs `send_up` with
  `nbrs = {myNodeId}` without testing `nxt ∈ {BROADCAST, myNodeId}`. The model's
  `assign_forwarder` delivers only to `nb = nxt`. That comes from reading the emitted
  `handleLowerPacket`; it has not been measured. It is a unicast item, so it waits
  with question 2.
- **The emitted per-type send methods cite MintRoute methods that do not exist.**
  `appTransmit.ts:100` and `mediumBinding.ts:438` write
  `Shaped after MintRoute::send<Leaf>Broadcast`. `MintRoute.h:152–153` declares only
  `sendRouteBroadcast` and `sendBeaconBroadcast`, so `sendDataBroadcast` (in every
  structure-3 module) and `sendRreqBroadcast`/`sendRrepBroadcast`/`sendRrerBroadcast`
  (in this probe) name methods MintRoute does not have. The fix is comment wording
  only.

## 7a. Does RTMCS flood the way MintRoute does? (asked 2026-09-27)

**The base is the same flood, and each model adds one-next-hop sending at M5 by the
same mechanism. The difference is which traffic stays flooded.** Read from each
machine's own declarations:

| | MintRoute | RTMCS |
|---|---|---|
| **M1 flood** | `create_*`, `start_tx`, `indicate_neighbours`, `receive_pkt` (re-queues into `ndBuff`), `receive_dup_pkt`, `floodTbl` dedup | the same flood events; `receive_pkt` is **identical guard for guard** except where the flood stops (`nb ≠ Sink` vs `nb ≠ finalDestAddr(pkt)`). The rest differ in the destination: one `Sink` vs a per-packet `finalDestAddr` (`sink_recv_pkt` vs `dest_recv_pkt`) |
| **control traffic** | BEACON and ROUTE, created with `pktDestAddr = BROADCAST` and never re-addressed, so **both are flooded** | **RREQ flooded**; RREP and RRER re-addressed at every hop to one next hop from `bwdNextND` |
| **data** | broadcast until `completedRoute`, then to the parent `cRouteTree(x)` (`start_tx_dataPkt_bct` / `_fwd`) | broadcast while there is no forward route, then to `fwdNextND(x ↦ s)` (`start_tx_dataPkt_bct` / `_fwd`) |
| **one-next-hop mechanism (M5)** | `pktDestAddr`/`vPktDestAddr`; `find_neighbours` (`dest = BROADCAST`), `assign_forwarder` (`dest ≠ BROADCAST ∧ nb = dest`) | `netDestAddr`/`envDestAddr`; `find_neighbour` (`nxt = BROADCAST`), `assign_forwarder` (`nxt ≠ BROADCAST ∧ nb = nxt`) |
| **what the route is** | a collection tree to one sink, rebuilt from periodic floods | per-destination reverse and forward routes, discovered by the RREQ flood and confirmed by a RREP sent back hop by hop |

So RTMCS is **flood-based route discovery plus next-hop routing**, not a flooding
protocol. MintRoute floods all of its control traffic. ⚠ Recorded 2026-09-07:
INET's hand-written `MintRoute.cc` does not rebroadcast control packets, so the
model's MintRoute is the flooding one.

**For the scope line (q2), when it is revisited:** the one-next-hop *mechanism* is
in **both** case studies at M5, under different names and with the same
`assign_forwarder` guard. How the next hop is *chosen* differs (`cRouteTree` vs
`bwdNextND`/`fwdNextND`). That is the same common/specific split the rest of the
generator follows.

## 7b. User decisions (2026-09-27, second round)

- **d2: RREP and RRER get the generic creating events, flooded like RREQ.** That is
  what the probe already derives. Under an RTMCS split this floods RREP and RRER
  where RTMCS sends them to one next hop, which is the deliberate stand-in until
  unicast is taken up.
- **d3: the reverse table is not taken; it is protocol-specific.** Confirmed:
  `bwdRouteTbl` is declared at RTMCS M4 and in no shared pattern machine, and
  `Pattern_Comparison_Report.md` §8.4 marks `add_bwdRouteEntry` protocol-specific
  (2026-09-20 research).
- **d1: choose the split by detecting the model, with one set of events.** The
  mechanism exists: the tool reads the project's own `partition(CONTROL, …)`, and
  the probe shows RTMCS's split goes through the same events with no duplicate code.
  ⚠ **Open: `C0_project` has nothing to detect.** It declares no `Sink`, leaves
  `CONTROL` unsplit, and its destination vocabulary (`Dests ⊆ ND`, per-packet
  `finalDestAddr`) matches neither case study exactly. Which input carries the
  MintRoute or RTMCS signal was put back to the user.
- **d1, third round: "guess from the input's shape" (user's choice). ⚠ Checked before
  building: the shape clues are in the SHARED pattern, so every input structure 3
  accepts looks the same.** The two signals that separate the case studies are one
  named sink (MintRoute) versus a destination set plus a per-packet destination
  (RTMCS). Both RTMCS-side signals sit in **pM1's own `creatingPkt`**
  (`x ∈ ND ∖ Dests`, `des = ran({pkt} ◁ finalDestAddr)`) and pM1's delivery events
  (`nb ∈ Dests` / `nb ∉ Dests`). They are present in all four pattern-based projects
  on disk: `Update_wsn/C0_project`, `test_input/C0_project`, the `shdecom` fixture and
  `Ex_WSN_Pattern/WSN_Pattern_shDecom6_2`. Structure 3 accepts only projects built on
  pM1 (`REQUIRED_BASE_STATE`), so a naive guess returns RTMCS for every input it could
  ever see. The only thing that would separate a MintRoute-shaped pattern project is
  a destination set pinned to one named node (`Dests = {Sink}`), and no project on disk
  has one. The advisor's flooding study does have `Sink ∈ ND`, but its control set is
  `FLOOD` and structure 3 refuses it (no `createdPkts` past M0).
- **d1, settled and built (user: *"C0_project's are just one example input … our
  tool can generate either flooding or aodv routing"*).** The signal that varies is
  **how the model names its sink**: MintRoute and the flooding study declare
  `Sink ∈ ND` (one sink, everything flows to it); RTMCS declares
  `Sink ∈ Destination` inside `partition(Destination, {Sink}, Actuators)` (one
  destination among several); `C0_project` declares no sink, only `Dests ⊆ ND`.
  `routingStyleOf` reads a constant declared **directly** in `ND` as flooding and
  anything else as AODV. It bundles `C2_ctl.buc` (ROUTE/BEACON) or the new
  `C2_aodv.buc` (RREQ/RREP/RRER), never both, and the events are one derivation.
  Pinned on the corpus (`tests/routingStyle.test.ts`) and on synthetic shapes. ⚠
  The DSR stub also declares `Sink ∈ ND` and reads as flooding; DSR discovers routes
  on demand, but the stub never reaches structure 3.
- ⛔ **Revised later the same day.** User: *"we not try to edit the input,
  everything that we build came from pattern"*. The no-sink default is now
  **flooding** (AODV needs a sink named among the destinations, RTMCS's form), and
  either routing can be chosen on the tool side with `--routing flooding|aodv`, so
  both simulator folders (`Simulation/v3_flood`, `Simulation/v3_aodv`) generate from
  plain `C0_project` with nothing added. The measurements below are unchanged by
  that: the same counters reproduce from the unedited input.
- **Both routings measured, nine-node field, `[Config Sink]`, 60 s:**

  | | flooding (C0_project + `Sink ∈ ND`) | AODV (C0_project as is) |
  |---|---|---|
  | originated per type | ROUTE 88, BEACON 88 | RREQ 88, RREP 88, RRER 88 |
  | `send_down` | 763 | 920 |
  | accepted + duplicates = MAC Rx = `send_up` | 655 + 1022 = 1677 | 741 + 947 = 1688 |
  | `dest_recv_pkt` | 68 | 85 |
  | routes published (`add_newEntry`) | 31 | 31 |
  | queue overflow | 180 | 330 |
  | invariants `[Sink]` / `[SinkBeacon]` | all green / all green | all green / all green |
  | `leak_check.sh` | 0 stuck | 0 stuck |

  The flooding column reproduces the 2026-09-27 leak-fix baseline counter for
  counter, which makes this the third time the `Sink` constant has measured
  inert. The AODV column's extra overflow is the third leaf's load (§2's
  prediction, now measured).

## 7. What follows, for the user to choose

- **How the tool offers the split without editing the input.** A second bundled
  context (`C2_aodv.buc`) plus a named choice (CLI flag and web dropdown) would work,
  with **ROUTE/BEACON staying the default** so every recorded number still reproduces.
  The two contexts cannot both be bundled at once, because two partitions of `CONTROL`
  contradict each other.
- **Whether RREP and RRER should get unconditional creating events** (§2) or only
  declared types, leaving their creation conditions to the case-study layer.
- **Whether the reverse table is taken now** (§3). It is fillable by broadcast, but it
  is protocol-specific by the 2026-09-20 ruling and needs a hop-count field.

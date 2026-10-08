# The Specific layer: what it is, what the sources say, and what blocks it

Study for the step after v3 (2026-10-06). The question: what is the blue
**Specific** row of the 4×4 pattern class matrix, what do the three case studies'
primary sources say it contains, what does the v3 output already offer it, and
what stands between v3 and it. No generator code was changed.

Every Event-B claim is read from the raw Rodin XML (`org.eventb.core.*`
attributes) through `npm run event`, never from `text_representation`. Every
generated-output claim was measured on 2026-10-06 against commit `4668648`.

## Verdict

1. **The project's own documents disagree on where the Specific layer comes
   from.** The 4×4 spec and VERIFICATION_REPORT §F say the student hand-writes
   the bodies inside a skeleton the generator emits. The older
   Pattern_Comparison_Report §11.2 says they are *generated* from M4–M6 with
   extended translation rules. Which one holds is the first decision (§7, Q1).
2. **MintRoute's Event-B parent selection is a whole-network computation; the
   reference implementation's is per node.** M5 builds `cRouteTree` one node at a
   time, over network-wide state. It reads each neighbour's `cpCost` directly and
   restarts only when `dom(cRouteTree) = ND ∖ {Sink}`. INET/MiXiM's
   `chooseParent()` runs on each node from what its neighbours *told it* in ROUTE
   packets. The model and the reference also use **different link-cost formulas**.
   A per-node module cannot execute M5's algorithm as written: it reads state no
   node holds.
3. **Each case study's Specific forwarding ends in a unicast to one next hop.**
   MintRoute sends data to its parent, RTMCS sends RREP/RRER/data along
   `bwdNextND`/`fwdNextND`, and DSR follows a source route. Their discovery traffic
   (ROUTE, RREQ) is still broadcast. v3 has no unicast. That is the line the user
   held on 2026-09-27 (*"don't cross the line yet"*), and the Specific layer cannot
   start without crossing it.
4. **v3 gives a Specific class almost nothing to extend.** It emits one class with
   three `virtual` transmit hooks. The event methods are not virtual, there is no
   `chooseParent`/`onReceive<Type>Pkt` hook, the leaf packet classes carry no fields
   of their own, and routes are published one hop only.
5. **DSR has neither a model nor an implementation.** There is no Event-B M1–M6
   and no DSR in INET 4.5 or in the MiXiM archive. Its Specific layer can only
   be authored from the PDFs, and nothing exists to compare its behaviour against.

## 1. What the Specific layer is, in the project's own documents

| source | what it says |
|---|---|
| 4×4 spec §2 (`docs/superpowers/specs/2026-06-12-four-category-pattern-class-architecture-design.md`) | Specific = blue, *"student-filled for M4–M6 protocol bodies"*; *"The generator still emits the blue skeletons + extension-point markers."* |
| 4×4 spec §4 (the matrix) | Operation: `MintRoute · DSR · AODV` *(stu)*. Packet: `DataPkt·BeaconPkt·RoutePkt·RREQPkt/RREPPkt/RRERPkt` *(gen + stu)*. RouteTable: `MintRouteTable · PairRouteTable · SourceRouteCache` *(gen + stu)*. ENV: `MintRouteNet · AodvNet · DsrNet` *(gen `.ned` + hand `.ini`)*. Inheritance: Specific `--\|>` PClass. |
| 4×4 spec §4.3 | MintRoute's `receiveEst/sentEst/liveliness/cost/cpCost/cRouteTree` *"folds into RouteTable as Specific-category extensions."* |
| VERIFICATION_REPORT §F, lines 261–279 | Three audiences. The generator emits a *"Skeleton class hierarchy and dispatch logic for M4–M6 (`handleRREQ` / `handleRREP` / `handleRRER` / `chooseParent` etc. emitted as marked placeholders)"*. The **project student (audience #2)** fills in DSR `dsrPath` logic and `reverse_path_*`, MintRoute *"ETX parent-selection inside `chooseParent` (`cpCost`, `cRouteTree`)"*, and the RTMCS RREQ/RREP/RRER routing decisions. This is inside Form 01 §6's validation requirement. |
| Pattern_Comparison_Report §8.4, lines 400–411 | Classifies `create_rreq`…`add_fwdrouteEntry`, `invalidate_neighbour`, `reverse_path_*`, `set_DATAPath_*`, `update_RouteCacheTbl_*` as *Protocol-specific* / *DSR-specific*. |
| Pattern_Comparison_Report §11.2, line 588 | *"Generate C++ code from CTL₆ using extended EB2C translation rules"*, i.e. the Specific events **translated**, not hand-written. Older than §F and the 4×4 spec. |
| CLAUDE.md, 2026-09-19 design entry | *"EXTENSION POINTS ARE `protected: virtual`, not comment markers — mirroring `MintRoute.h`"*; *"parent selection is the blue Specific class — `MintRouteTable` overrides the virtual hook."* |

⚠ The 4×4 spec still names `RoutingProtocolBase` for the Operation column's base.
That was superseded on 2026-09-22 by `NetworkProtocolBase`
(`docs/design-base-class-pending.md`), so a Specific operation class extends a
`NetworkProtocolBase` subclass.

## 2. What v3 offers a Specific class today

Measured on `Pm3Wsn.h` generated from `Update_wsn/C0_project` with `--v3`:

- **One class.** `class Pm3Wsn : public NetworkProtocolBase, public INetworkProtocol`.
  The matrix's PComm, PPkt and PRouteTable cells all live inside it; there is no
  separate `PRouteTable` class for a `MintRouteTable` to extend.
- **Three overridable behaviours:** `virtual void sendDataBroadcast / sendRouteBroadcast
  / sendBeaconBroadcast(Node x, PktId pkt)`, plus `setDownControlInfo` and
  `resolveBroadcast`, copied from MintRoute.
- **Event methods are not virtual** (`bool receive_controlPkt(...)`,
  `bool add_newEntry(...)`, …). A subclass cannot replace a reception or a table
  update.
- **No routing hooks.** Nothing like `chooseParent`, `evaluateCost`,
  `onReceiveRoutePkt`, `updateNeighborTable` or `updateEst` is emitted.
  `MintRoute.h:150–168` declares all of them `virtual`; v3 has the two broadcast
  methods of that list and none of the rest.
- **Leaf packets carry no fields of their own.** `RoutePkt`/`BeaconPkt` add
  nothing to `PPkt`. INET's route packet carries `parent`, `cost`, `hopCount` and
  an `estList` of per-neighbour `receiveEst` (`MintRouteHeader.msg:37–59`); those
  are what a neighbour's `chooseParent()` reads.
- **Every transmit is a broadcast**, and **routes are published one hop only**
  (`publishOneHopRoutes`: neighbour = destination = next hop, metric 1).
- **The `.ned` binds the generated class** (`@class(eb_pm3wsn::Pm3Wsn)`), and the
  header says *"Do not edit by hand — regenerate instead."* A Specific subclass
  therefore needs its own files and NED type, or the generator must emit them.

## 3. MintRoute

### 3.1 The reference implementation (INET port of MiXiM)

Per node, timer-driven, with no global knowledge:

- **Route timer:** `updateNeighborTable(); chooseParent(); sendRouteBroadcast();`
  (`MintRoute.cc:119–123`). The beacon timer runs on the sink only.
- **Estimation** every `estimateToRouteRatio` ticks (default 3):
  `newAve = 255·received / max(received+missed, 3)`, then EWMA with `alpha` 0.75.
  `sendEst` halves when `liveliness` hits 0 (`MintRoute.cc:417–454`).
- **Learning `sendEst`:** a neighbour's ROUTE packet lists the `receiveEst` it holds
  for each of *its* neighbours. A node finds its own address in that list and
  takes the value as its `sendEst` to that neighbour (`MintRoute.cc:224–247`). This
  is how one node's receive estimate becomes another node's send estimate.
- **Parent choice:** among valid neighbours that are not its children, with known
  hop and cost and both estimates ≥ `linkQtyThreshold` (25), minimise
  `evaluateCost(cost, sendEst, receiveEst) = 2^24/(sendEst·receiveEst) + (cost<<6)`.
  It keeps the old parent unless the new one is cheaper by `switchThreshold` (384)
  (`MintRoute.cc:456–517`). MiXiM's original has the identical formula
  (`archive/MintRouteProj/mixim/src/modules/netw/MintRoute.cc:1038–1052`).
- **Data forwarding:** unicast to `gpCurrentParent`, MAC resolved through ARP, or
  broadcast when there is no parent yet (`MintRoute.cc:284–307`).
- Defaults (`MintRoute.ned:34–49`): beacon 5 s, route 20 s, `alpha` 0.75,
  `linkQtyThreshold` 25, `estimateToRouteRatio` 3, `switchThreshold` 384.
  `LIVELINESS = 5` (`MintRoute.h:74`).

### 3.2 The Event-B model (M4, M5)

M5 adds 15 variables: `chooseParentTimer`, `nodes`, `completedRoute`, `cpCost`,
`cRouteTree`, `calPCostNDs`, `calPCost`, `calPCostFlg`, `Nbrs`, `pktDestAddr`,
`vPktDestAddr`, `parent`, `cost`, `deadNbrs` and `chosenNDs`. It adds nine new events
(`choose_node`, `cal_PCost_gt`, `cal_PCost_gt_skip`, `cal_PCost_le`, `choose_parent`,
`choose_parent_skip`, `report_routeCompletion`, `reset_routeTimer`, `reset_route`)
and splits `start_tx_dataPkt` into `_bct`/`_fwd`.

Typing (M5 invariants): `cRouteTree ∈ (nodes ∖ {Sink}) → nodes` (inv5_22),
`cpCost ∈ ND → (ℕ ∪ {INFINITY})` (inv5_6), `parent ∈ neighbourTbl → (ND ∪ {BROADCAST})`
(inv5_12), `cost ∈ neighbourTbl → ℕ` (inv5_13), `calPCost ∈ calPCostNDs → ℕ`
(inv5_8). Constants (C4): `Qlow = 30`, `INFINITY = 9999`.

The algorithm, as the events state it:

- `choose_node` takes **any** `x ∈ ND ∖ {Sink}` not yet chosen and loads its
  neighbours into `Nbrs`.
- `cal_PCost_gt` computes `lnkQty = (120−rEst)·(120−sEst)` and adds
  `pCost + lnkQty`, where **`pCost = cpCost(nb)` is the neighbour's own cost**,
  read directly. `cal_PCost_le` drops neighbours below `Qlow`.
- `choose_parent` takes `m = min(ran(calPCost))`, a `p` achieving it with
  `p ∈ nodes ∧ p ∉ des ∪ {x}`, then sets `cRouteTree ∪ {x ↦ p}`, `nodes ∪ {x}` and
  `cpCost(x) ≔ m`.
- `report_routeCompletion` sets `completedRoute ≔ TRUE` when `Nbrs = ∅`.
  ⚠ **Nothing requires the tree to be complete.** Its completeness condition,
  `nodes = ND`, sits in the Rodin file as a **comment** on g2, not as a guard
  (the labels skip from g2 to g4). `r = cRouteTree` only binds `r`. ⚠ **The event
  is enabled at initialisation**: `completedRoute ≔ FALSE` and `Nbrs ≔ ∅` there.
  If it fires before any parent is chosen, `completedRoute = TRUE` with an empty
  tree, and nothing can recover:
  - `choose_node` needs `completedRoute = FALSE` (g6);
  - `reset_route` needs a full tree;
  - `_bct` needs `completedRoute = FALSE`;
  - `_fwd` needs `x ∈ dom(cRouteTree)`.

  So the model admits a run where routing never starts and no data is sent. It is
  the same kind of disabled guard as RTMCS's commented-out `@g4` (2026-09-20).
  `reset_route` clears the tree once `dom(cRouteTree) = ND ∖ {Sink}`.
- **Data is sent to the tree parent:** `start_tx_dataPkt_fwd` guards
  `completedRoute = TRUE ∧ y = cRouteTree(x)` and stamps `pktDestAddr`, and M5's
  `assign_forwarder` delivers only to `nb = dest`.
- Upstream at M4, the same shape appears: `reset_bcastRouTimer` waits for
  `bcastRouNodes = ND` (every node has broadcast), `decrease_liveliness` and
  `exclude_deadNbr` wait for `estNbrs = neighbourTbl`, and
  `update_route` does `sentEst(y ↦ x) ≔ receiveEst(x ↦ y)`, one node's variable
  written from another's.

### 3.3 Where the model and the reference differ

| | INET / MiXiM | Event-B M5 |
|---|---|---|
| who computes | each node, for itself | one computation over the whole network (`nodes`, `cRouteTree`, `cpCost` of every node) |
| a neighbour's cost | learnt from its ROUTE packet (`cost` field) | read directly as `cpCost(nb)` |
| `sendEst` | learnt from the neighbour's `estList` | assigned from the neighbour's `receiveEst` (M4 `update_route`) |
| link cost | `2^24/(sendEst·receiveEst) + cost<<6` | `(120−rEst)·(120−sEst) + cpCost(nb)` |
| quality threshold | 25 | `Qlow = 30` |
| "no route" | `0xffff` | `INFINITY = 9999` |
| parent hysteresis | `switchThreshold` 384 | none |
| loop avoidance | skip neighbours whose parent is me, or with `childLiveliness > 0` | `p ∈ nodes ∧ p ∉ des ∪ {x}` over the tree built so far |
| route-packet fields | `parent`, `cost`, `hopCount`, `estList` | none beyond the common packet fields (the M5 variable list has no per-packet cost or estimate) |
| when it ends | never; it is a periodic re-evaluation | `completedRoute` once `Nbrs = ∅` (the completeness guard is a comment); `reset_route` once every node has a parent |

This is the same class of finding as the 2026-09-07 flooding study (the model and
`MintRoute.cc` implement different control planes) and the 2026-09-07
global-model/per-node finding. M5 describes the tree as an observer sees it, while
the reference describes what a node does.

### 3.4 What the generator does with M5 today

`npm run generate -- MintRoute <out> --machine M5` (structure 2, network branch):

- **56 untranslated clauses; 1 clang error**, the recorded one
  (`r = cRouteTree`: `std::set<std::pair<Data, Data>>` against `std::map<int,int>`).
- **⚠ The first block is the scalar-assignment gap, not parent selection.** Every
  assignment to M5's phase flags is untranslated: `bcastRouTimer ≔ TRUE/FALSE`
  (3), `chooseParentTimer ≔ TRUE/FALSE` (2), `calPCostFlg ≔ TRUE/FALSE` (5) and
  `completedRoute ≔ TRUE/FALSE` (2). These are machine `BOOL`s, and the rule for
  assigning one in an event has been deferred since 2026-07-06 (CLAUDE.md, top
  entry). So no flag can ever change, and the reachability pass correctly
  reports `chooseParent_due`, `reset_routeTimer`, `reset_route` and
  `create_routePkt` as guarding a flag "which nothing ever assigns".
- **The parent-selection events are also unschedulable:** `choose_node` (no binding
  for `x, nb`), `cal_PCost_gt` (`pCost, lnkQty`), `cal_PCost_gt_skip`,
  `choose_parent` (`m, des`), `choose_parent_skip`, `report_routeCompletion`.
  Bound, they would still refuse. Their bodies hold untranslated aggregates
  (`min(ran(calPCost))`, `ran(calPCost) ≠ ∅`, `p ∈ ran(dom(calPCost ▷ {m}))`,
  `dom(cRouteTree) = ND ∖ {Sink}`), arithmetic (`(120−rEst) ∗ (120−sEst)`,
  `(r ∗ 100) ÷ rt`, `mod`), disjunctions, a set-valued scalar (`Nbrs ≔ nb`) and
  `des ⊆ nodes`. `start_tx_dataPkt_fwd` (nothing fills `cRouteTree`) and
  `cal_PCost_le` (nothing fills `chosenNDs`) follow from them.
- **⚠ The neighbour table dies at M5.** M5's `add_newEntry` adds
  `y ↦ x ↦ BROADCAST ∉ parent`, `(y ↦ x ↦ INFINITY ∉ cost)`, `(x ≠ Sink)` and
  `parent ≔ parent ∪ {y ↦ x ↦ BROADCAST}`, all emitted as `// UNTRANSLATED`. So
  the event refuses to fire, and the header reports `update_nbr -- nothing that
  runs ever fills neighbourTbl`. **Two different gaps** cause it:
  - triple maplets over a pair-keyed function;
  - **a conjunct kept in parentheses.** The guard is written
    `(y ↦ x ↦ INFINITY ∉ cost) ∧ (x ≠ Sink)`; splitting it on `∧` leaves each part
    bracketed, and no rule matches a bracketed atom. `add_newEntry_sink`'s
    `(x = Sink)` fails the same way.

  M4's table works; refining to M5 switches it off.
- RTMCS M6 for comparison: 9 untranslated, compiles.

## 4. RTMCS / AODV

From the two 2026-09-27 studies, not re-derived:
[AODV source study](2026-09-27-aodv-source-study.md),
[RREQ/RREP/RRER pattern study](2026-09-27-rreq-rrep-rrer-pattern-study.md).

- **The Specific decisions** are *when* to reply (destination only:
  `dest_recv_rreqPkt`), *which* route wins (RTMCS adds once; INET creates or
  updates under a freshness rule), and *when* to invalidate (`errND`,
  `invalidate_neighbour`). Pattern_Comparison_Report §8.4 and the 2026-09-20 scope
  ruling put all of them on the protocol-specific side.
- **They depend on unicast** (RREP/RRER to `bwdNextND`, data to `fwdNextND`), on
  **two tables** (`bwdRouteTbl` at M4, `fwdRouteTbl` at M5, `errND ⊆ fwdRouteTbl` at
  M6), and on **multi-hop route publication** (destination ≠ next hop, metric =
  hop count). v3 has none of the three; `routeTableOf` refuses two candidate
  tables.
- **RTMCS is not a v3 input** (no `createdPkts`); it goes through structure 2 as
  `M6Wsn`. v3's "AODV" routing is the RREQ/RREP/RRER *split* on the pattern input,
  with every type flooded.
- **The `updateNbrs` jam** (2026-09-20) is RTMCS's own M4–M6 and was ruled
  case-study work. The repeatable backward twin unjams the backward half and does
  nothing for the forward half, because `add_fwdrouteEntry` inherits backward-table
  guards through `extends`.
- **Baseline:** `Simulation/inet4.5/MyWSN [Config AODV]` (INET's `Aodv` set to mimic
  RTMCS). Comparable only on routes learned, since `Aodv.cc` records no scalars of
  its own.

## 5. DSR

- **No Event-B M1–M6** (advisor-confirmed 2026-06-01): only `WBAN_1_0/{M0.bum,
  C0.buc, T01.buc}`.
- **No implementation anywhere:** INET 4.5's `src/inet/routing/` holds `aodv base
  bgpv4 common contract dsdv dymo eigrp gpsr ospf_common ospfv2 ospfv3 pim rip`, and
  no file under `Proj/` matches `*[Dd][Ss][Rr]*.{h,cc,ned,msg}`.
- **What is known** (`scratch/DSR_Source_Discovery_Report.md`): the full text of
  `reverse_path_loop` (ver66 Appendix F, matching Final Report Fig 6.7) with the
  Form C guard `pNd = ran({nIdx}◁ran({pkt}◁dsrPath))`; `dsrPath ∈ PKT → (ℕ → ND)`;
  Final Report Table 6.1 (requirement → refinement) and Table 6.2 (25 events,
  892 LOC); Fig 6.10's `handleLowerMsg` dispatch. `reverse_path_init` is named but
  its body is not transcribed. `routeCache`/`SourceRouteCache` is sketched
  (ver66 Fig 4.4) but not typed in Event-B.
- **Consequence:** DSR's Specific layer is authored from PDFs, and its correctness
  can only be argued from the model fragments, not measured against a reference
  run.

## 6. What blocks the Specific layer, across all three

| # | blocker | where it bites | side of the line |
|---|---|---|---|
| S1 | **No unicast.** Every v3 transmit is `MacAddress::BROADCAST_ADDRESS`. | MintRoute data to parent; RTMCS RREP/RRER/data; DSR source route | Sending to a next hop is communication (generator); *choosing* it is Specific. ✅ Both case studies add it at M5 with the **same mechanism** (`assign_forwarder … nb = dest/nxt`), recorded 2026-09-27. |
| S2 | **The models compute routes over global state.** | MintRoute M5 (`cpCost(nb)`, `nodes`, `cRouteTree`, `bcastRouNodes = ND`, `sentEst ≔ receiveEst`); RTMCS less so | A per-node Specific class must learn this state from packets. The models declare no packet fields for it, so translating M5 per node is not possible without redesign. |
| S3 | **No extension surface.** One class, non-virtual events, no routing hooks, no separate PRouteTable class, `@class` bound to the generated name, "do not edit" header. | all three | Generator. Emitting the hooks is ENC/shell work, not routing. |
| S4 | **One-hop route publication only.** | MintRoute (parent → default route to sink), RTMCS (multi-hop, metric = hop count) | Generator for the publishing mechanism; the route chosen is Specific. |
| S5 | **v3's input is the pattern, not the case studies.** It refuses MintRoute and RTMCS, and `Pm3Wsn` from `C0_project` has no `parent`/`cost`/`cRouteTree` state at all. | which module a `MintRouteTable` extends | Decision (Q2). |
| S6 | **ETX inputs not landed.** `receiveEst`/`sentEst` deferred on 2026-09-20 until the ROUTE path can carry `sentEst`. `LIVELINESS` has no value in C3 (`∈ ℕ1`; INET uses 5); T01 sets `EST_RATIO = 1`. | MintRoute | `receiveEst` is common (M3); `sentEst` needs S2's packet field. |
| S7 | **Three translation gaps under M5.** (a) Pair-keyed triple maplets (`y ↦ x ↦ v ∈ parent`). (b) Bracketed conjuncts (`(x ≠ Sink)`). (a) and (b) together switch off `add_newEntry` at M5. (c) Assignments to scalar flags in events (the deferred rule), which freeze every M4–M5 phase flag. | MintRoute M5 | Generator gaps, not routing. (b) is not specific to M5: splitting `(a) ∧ (b)` keeps each part's brackets, and a bracketed comparison then matches no rule. Shown for `(x ≠ Sink)` by direct test; other bracketed shapes not tested. |
| S8 | **No DSR model and no DSR baseline.** | DSR | Case-study authoring. |

## 7. Decisions for the user

> **Evidence-based answers to all six are in the follow-up,
> [the Specific layer across the case studies](2026-10-06-specific-layer-case-studies.md) §6,**
> from comparing MintRoute, RTMCS and DSR side by side the way v2 and v3 were built.

- **Q1. Is the Specific layer hand-written or translated?** The spec and §F say
  hand-written bodies in a generated skeleton; Pattern_Comparison_Report §11.2 says
  translated. The evidence in §3 weighs on it. M5's parent selection is a
  whole-network algorithm with a different cost formula, so translating it would
  not reproduce MintRoute's per-node behaviour, and it cannot run per node as
  written. DSR has no model to translate at all.
- **Q2. What does a Specific class extend?** The v3 module (`Pm3Wsn`, pattern input,
  which carries no Specific state), or each case study's own structure-2 module
  (`M4Wsn`/`M5Wsn`, `M6Wsn`), or a v3 generated from each case study (which v3
  refuses today).
- **Q3. Cross the unicast line now?** All three case studies need it (S1). The
  mechanism is shared by both models that have a network layer.
- **Q4. What extension surface should the generator emit?** `protected: virtual`
  hooks mirroring `MintRoute.h` (`chooseParent`, `evaluateCost`,
  `onReceive<Type>Pkt`, `updateNeighborTable`, `updateEst`) and per-type fields on
  leaf packets. And where do the student's bodies live: a hand-written subclass
  in its own files (keeping the 3-file contract for generated output and
  surviving regeneration), or inside the three files (the spec's §7 reading)?
- **Q5. Order.** MintRoute first has the most support: a reference implementation,
  a nine-node harness and a flood already running. RTMCS next has INET's `Aodv`
  and `[Config AODV]`. DSR last has neither model nor baseline.
- **Q6. Which behaviour is the target for MintRoute: INET's or M5's?** They choose
  different parents (§3.3), so the choice decides what "correct" means in Phase 4.

## Audit (2026-10-06, same day)

Each claim was re-checked against its source. The errors, with the reason each
was made:

| was | is | why it was wrong |
|---|---|---|
| M5 adds 14 variables | **15**: `Nbrs` (inv5_3, `Nbrs ⊆ ND`) was missing | listed with a grep matching `identifier=`, which hits variables **and** event parameters; `Nbrs` was dropped as a parameter. Re-listed from `<org.eventb.core.variable>` elements only |
| `completedRoute` is set "once every node has a parent" | set whenever `Nbrs = ∅`; the completeness condition `nodes = ND` is a **comment** on g2 | inferred from the event's name and from `reset_route`'s guard, without reading this event's own guard list |
| M5's chain is "cut off behind" the parent-selection events | first cut off by the **scalar-assignment gap** (12 untranslated flag assignments), then by aggregates, arithmetic and `des ⊆ nodes` in the bodies | read the header's "not schedulable" reasons and stopped, without reading the 56 untranslated clauses |
| `add_newEntry` at M5 fails on triple maplets | triple maplets **and** a bracketed conjunct, `(x ≠ Sink)`, which no rule matches | the third untranslated guard was seen and not explained |
| "every Specific behaviour … sends to one next hop" | each case study's **forwarding** ends in a unicast; their discovery traffic is broadcast | over-generalised from the forwarding path to the whole layer |

None of these changes Q1–Q6. Two strengthen them: the M5 chain is blocked by
generator gaps before any routing question arises, and M5's "complete" flag does
not mean complete.

**Second pass (same day).**

| was | is | why it was wrong |
|---|---|---|
| (first pass) data switches to `_fwd` "as soon as one node's neighbour list is processed" | `report_routeCompletion` is enabled **at initialisation** (`completedRoute ≔ FALSE`, `Nbrs ≔ ∅`); firing first strands routing for ever | the first pass reasoned about the event alone, without the INITIALISATION values |

Checked by direct test and holding: the bracketed-conjunct cause (`x ≠ Sink`
translates to `x != Sink`; `(x ≠ Sink)` does not, under the same M5 rules); the 12
untranslated flag assignments; `Aodv.cc` has no `recordScalar` or `emit`; the
`[Config AODV]` baseline and its results exist; RTMCS declares no `createdPkts`.

**Third pass (same day).** One wording overreach corrected: S7 said the bracketed
conjunct gap hits "any model writing `(a) ∧ (b)`". It was shown for a bracketed
comparison, and S7 now says only that. No other change. The third pass's findings
concern the Tier C draft, whose audit section lists them.

# The Specific layer across the case studies: what is shared, what is not

Follow-up to [the Specific-layer study](2026-10-06-specific-layer-study.md),
done the way v2 and v3 were done (user, 2026-10-06: *"do study the case study
first. the same way from v2 and v3. to possible answer the question"*):

1. put the case studies side by side,
2. separate what all of them do from what only one does,
3. let the shared part become pattern (generated) and the rest stay per case study.

v2 took that step for communication and sensing, and v3 for PPkt and PRouteTable
(`design/Pattern_Extension_Draft.md`, the CONTROL-partition table in CLAUDE.md
2026-09-19). This document takes it for the routing layer itself. Every Event-B
claim is read off the raw XML through `npm run event` (as written per machine,
or `--flat`); no generator code changed.

## Verdict

1. **The three case studies share a skeleton inside the Specific layer.** They
   follow the same plan: discover by flooding, learn a route, forward data to one
   next hop, maintain the route. In the two with Event-B source, the
   *forwarding* half is the **same events with the same types under different
   names**. The `_bct`/`_fwd` split, a per-packet next-hop field
   `PKT ⇸ ND ∪ {BROADCAST}` and its wire copy, and delivery only to `nb = next
   hop` all appear in both. In the flattened `start_tx_dataPkt_fwd` of both models,
   every clause inherited from the abstract transmit matches. They differ in the
   route test, in the line that names the next hop, and in MintRoute's extra
   `pkt ∈ dom(pktDestAddr)`.
2. **What differs is how the next hop is chosen and what a control packet
   carries.** MintRoute uses a parent from the ETX tree, RTMCS a per-destination
   reverse/forward table with sequence numbers, and DSR a path carried in the
   packet.
3. **RTMCS's Specific events run on one node; MintRoute's do not.** Every RTMCS
   route event reads only its own node's entries and the packet in hand, apart from
   one inherited `ctlNeighbours = ∅` barrier. MintRoute's M4–M5 route events read
   other nodes' state, and each such read is a field INET's ROUTE packet carries
   (`parent`, `cost`, `estList`). They also wait on network-wide rounds, which INET
   replaces with per-node timers.
4. That gives evidence-based answers to Q1–Q6 (§6).

## 0. Sources

| case study | Event-B | per-node implementation |
|---|---|---|
| **MintRoute** | `EventB_model/WSN_MintRoute_3_2_5_9/…amiCheck` M0–M5 | MiXiM `archive/MintRouteProj/mixim/src/modules/netw/MintRoute.cc` (the thesis's own code), ported to INET 4.5 as `src/inet/networklayer/mintroute/MintRoute.{h,cc}` |
| **RTMCS (AODV)** | `EventB_model/RTMCS_7_4_proof` M0–M6 | none of its own; INET 4.5 `src/inet/routing/aodv/Aodv.{h,cc}`, configured to mimic RTMCS in `MyWSN [Config AODV]` |
| **DSR (WBAN/HCMS)** | M0 only. M4–M6 known from Final Report Tables 6.1/6.2, Fig 6.7/6.10, ver66 Appendix F (`scratch/DSR_Source_Discovery_Report.md`) | none anywhere (INET 4.5 ships no DSR, MiXiM archive has none) |

## 1. The refinement plan, side by side

| | MintRoute | RTMCS | DSR (Final Report Table 6.1) |
|---|---|---|---|
| **flood / discover** | M1–M3: beacon flood, neighbour table, link counters, receive estimates (`update_est`, M3) | M4: RREQ flood (`start_fldRREQ`, `start_tx_rreq`), backward table `bwdRouteTbl` learnt from it (`add_routeEntry`) | M4: *Route Discovery — RREQ Flooding* |
| **learn the route** | M4: ROUTE broadcast, `sentEst` (`update_route`), liveliness | M5: RREP sent back to the originator (`create_rrep`, `start_tx_rrep` to `bwdNextND`), forward table `fwdRouteTbl` (`add_fwdrouteEntry`) | M5: *Route Discovery — RREP Unicasting* (`reverse_path_init/_loop`) |
| **choose / forward** | M5: parent selection (`choose_node` … `choose_parent`), data to `cRouteTree(x)` | M5: data to `fwdNextND(x ↦ s)` | M6: *Data packet … forwarding* |
| **maintain** | M4: `decrease_liveliness`, `exclude_deadNbr`; M5: `reset_route` | M6: RRER on a failed unicast (`lose_dataPkt` → `create_rrer` → `start_tx_rrer` to `bwdNextND` → `invalidate_neighbour` into `errND`) | M6: *… and RRER forwarding* |
| control types | ROUTE, BEACON | RREQ, RREP, RRER | RREQ, RREP, RRER (ver66 §4.1.7) |

RTMCS and DSR follow the same plan level for level. MintRoute reaches the same
four stages through a proactive tree and has no reply packet.

## 2. Roles, side by side

| role | MintRoute | RTMCS | DSR | |
|---|---|---|---|---|
| **per-packet next hop** | `pktDestAddr ∈ PKT ⇸ ND ∪ {BROADCAST}` (M5 inv) | `netDestAddr ∈ PKT ⇸ ND ∪ {BROADCAST}` (M5 inv) | next element of the packet's path (`dsrPath ∈ PKT → (ℕ → ND)`) | ✅ shared idea; ✅ **identical type** in the two models |
| …its wire copy | `vPktDestAddr`, same type | `envDestAddr`, same type | — | ✅ identical |
| …initial value | `BROADCAST`, set in `create_dataPkt`, `create_bconPkt`, `create_routePkt` | `BROADCAST`, set in `create_dataPkt`, `create_rreq`, `create_rrep`, `create_controlPkt` | — | ✅ identical |
| …serialised in `send_down`, read in `send_up` | yes (`vPktDestAddr ∪ {pkt ↦ dest}`) | yes (`envDestAddr ∪ {pkt ↦ nxt}`) | — | ✅ |
| **delivery to one node** | M5 `assign_forwarder`: `dest ≠ BROADCAST ⇒ nb = dest` | M5 `assign_forwarder`: `nxt ≠ BROADCAST ⇒ nb = nxt` | unicast RREP and data (Table 6.1) | ✅ the same three guards (MintRoute reads the wire copy `vPktDestAddr`, RTMCS the field `netDestAddr`) |
| **data transmit split** | `start_tx_dataPkt_bct` (`completedRoute = FALSE`) / `_fwd` | `start_tx_dataPkt_bct` (`ran({x}◁dom(fwdNextND)) = ∅`) / `_fwd` | — | ✅ same split; the "no route" test differs |
| **the next hop chosen** | `y = cRouteTree(x)` | `nxt = fwdNextND(x ↦ s)`, any `s` x has a route to (not tied to the packet's destination) | path element `nIdx` | ⛔ **Specific** |
| **route state** | `neighbourTbl` (M3) + `parent`, `cost ∈ neighbourTbl → …` (M5) + `cRouteTree`, `cpCost` | `bwdRouteTbl`/`fwdRouteTbl ∈ ND ↔ ND` + `…NextND`, `…SeqNo`, `…HopCnt` (M4/M5), `errND` (M6) | `routeCache` (sketched, not typed) | node relation + pair-keyed attributes ✅ shared encoding; contents ⛔ Specific |
| **learning an entry** | `add_newEntry`: drain `x ↦ y` from `updateNbrs`, add `y ↦ x` (forwarder) | `add_routeEntry`: drain `x ↦ y` from `updateNbrs`, add `y ↦ s` (originator), next hop `x` | `update_RouteCacheTbl_*` | ✅ same shape (recorded 2026-09-27); the key differs |
| **per-hop sequence** | `start_tx_bconPkt`: `lsno = linkSeqNo(x)+1`, `netSeqNo(pkt) ≔ lsno` | `start_tx_rreq`: identical clauses | — | ✅ identical (v3 already emits it) |
| **fields only one packet type carries** | none in the model; INET's ROUTE carries `parent`, `cost`, `hopCount`, `estList` | `pktErrND ∈ PKT ⇸ ND`, written **only** by `create_rrer` (the RRER's unreachable node) | `RREQ.path`, `RREP.reversePath`, `RRER.errorNode` | ✅ the shape is shared: a partial packet field written by one leaf's creating event |
| **phase flags** | `floodFlg ∈ ND → BOOL` (one per node), plus `bcastRouTimer`, `chooseParentTimer`, `completedRoute`, `calPCostFlg ∈ BOOL` (one for the whole network) | `floodFlg`, `rrepFlg`, `rrerFlg ∈ ND → BOOL` (one per node) | — | per-node flood flag ✅ shared; MintRoute's route/parent phases are network-wide |
| **failure** | `liveliness` reaching 0 → `sentEst ≔ 1` | failed unicast → RRER → `errND` | RRER (Table 6.1) | ⛔ Specific |

## 3. Can each Specific event run on one node?

A per-node module runs an event on one node. It can only read that node's own
entries (a node-keyed variable at its own index, or a pair-keyed one whose first
component is itself) and the packet in hand. The first component as owner follows
the models' own orientation: `update_nbr` writes `lastSeqno(y ↦ x)` on the receiver
`y` about forwarder `x`.

**A variable not indexed by node** is one value in the model. Per node it is
localisable when it is **scratch for one node's computation in progress**: each
node simply keeps its own copy. It is not localisable when it **aggregates across
nodes**: which nodes are done, whether all of them are, or a round every node
must finish. This rule is applied the same way to all three models below.

### MintRoute

| event | reads another node's state, or a network-wide round | INET's per-node equivalent |
|---|---|---|
| `update_est` (M3) | `estNbrs ≠ neighbourTbl` (round) | `updateNeighborTable()` every `estimateToRouteRatio` ticks |
| `reset_estTimer` (M3) | `estNDs = ND`, `estNbrs = neighbourTbl` (round) | a local tick counter (`gwEstTicks`) |
| `update_route` (M4, refines the ROUTE reception `update_nbr2`) | `sentEst(y ↦ x) ≔ receiveEst(x ↦ y)`: **x's** estimate written into **y's** | `onReceiveRoutePkt`: find my address in the sender's **`estList`** |
| `decrease_liveliness`, `exclude_deadNbr` (M4) | `estNbrs = neighbourTbl` (round) | `updateEst()`: `liveliness--`, `sendEst >>= 1` |
| `reset_bcastRouTimer` (M4) | `bcastRouNodes = ND` (every node has broadcast) | the route timer, rescheduled per node |
| `update_route_1` (M5) | `parent(y ↦ x ↦ par)`, `cost(y ↦ x ↦ cst)` with `par = cRouteTree(x)`, `cst = cpCost(x)`: **x's** parent and cost | the ROUTE packet's **`parent`** and **`cost`** fields |
| `cal_PCost_gt` (M5) | `pCost = cpCost(nb)`: the neighbour's cost, read directly, **although M5 keeps a local copy in `cost(x ↦ nb)`** | `nbr.cost`, stored from the ROUTE packet |
| `choose_node`, `choose_parent`, `report_routeCompletion`, `reset_route`, `reset_routeTimer` (M5) | scratch, localisable: `Nbrs`, `calPCost`, `calPCostNDs`, `calPCostFlg`. **Aggregating, not localisable:** `nodes` (who is in the tree), `chosenNDs` (who has been processed this round), `completedRoute`, `chooseParentTimer`. The tree grows outward from `nodes = {Sink}`; `p ∈ nodes` requires the parent to be in the tree already; the tree restarts at `dom(cRouteTree) = ND ∖ {Sink}` | `chooseParent()` on each route tick; "has a route" = `nbr.cost ≠ ROUTE_INVALID_INT`; loop avoidance = skip neighbours whose parent is me |
| `start_tx_dataPkt_fwd` (M5) | own `cRouteTree(x)` ✅, but gated by the network-wide `completedRoute` | forward to `gpCurrentParent` whenever one exists |
| `deadNbrs` | only ever set to `∅` (INITIALISATION, `chooseParent_due`), so `x ∉ deadNbrs` is always true | — |

**Every cross-node read corresponds to a ROUTE-packet field in the
implementation, and every network-wide round to a per-node timer.** The model
states the protocol as an observer of the whole network would. The implementation
states what one node knows. They also differ in substance (link cost, threshold,
hysteresis; see the first study, §3.3).

### RTMCS

| event | own node | reads |
|---|---|---|
| `add_routeEntry` / `add_bwdRouteEntry` (M4/M5) | receiver `y` | packet fields (`initialSrcAddr`, `pktFwdr`, `netSeqNo`, `pktNbHops`) and `y`'s own table ✅; **`ctlNeighbours = ∅`** is network-wide (the recorded 2026-09-20 jam) |
| `add_fwdrouteEntry` (M5) | `y` | as above, plus the backward-table guards it inherits through `extends` |
| `create_rreq`, `start_fldRREP`, `create_rrep`, `start_tx_rrep` | `s` / `x` | `rrepFlg(s)`, `rrepLists`, `bwdNextND(x ↦ s)` ✅ |
| `start_tx_dataPkt_fwd` | `x` | `fwdNextND(x ↦ s)` ✅ |
| `lose_dataPkt`, `create_rrer`, `start_tx_rrer`, `invalidate_neighbour` (M6) | `f` / `s` / `x` / `y` | `rrerLists`, `fwdRouteTbl`, `bwdNextND(x ↦ fDes)`, `pktErrND` ✅; `invalidate_neighbour` inherits the same barrier |

**RTMCS states its routing per node.** Its flags are per node (`ND → BOOL`), its
tables are keyed by the owning node first, and the packet carries what the
receiver needs. The one network-wide guard is the inherited `ctlNeighbours = ∅`,
already identified as the cause of the 2026-09-20 jam and ruled RTMCS's own
modelling.

### DSR

`reverse_path_loop` (ver66 Appendix F) reads the packet's `dsrPath` and three
machine variables (`reverseIdx`, `nIdx`, `nRPath`). Those are one value in the
model, but they are **scratch** for the reversal in progress, so by the rule above
each node keeps its own and the event is localisable. Nothing else is known.

## 4. What the shared part is, and where it would go

The v3 method puts what every case study does into the pattern. Two things pass
that test here.

1. **The next hop (all three, identical in the two with source).** This covers:
   - a per-packet field `PKT ⇸ ND ∪ {BROADCAST}`, initialised to `BROADCAST` at
     creation, serialised in `send_down` and read back in `send_up`;
   - a data transmit split by "is there a route" into a broadcast branch and a
     forwarding branch that overwrites the field;
   - delivery only to the node the field names.

   In C++ that is a unicast send through ARP (MintRoute's
   `arp->resolveL3Address(nextHop)` then `setDownControlInfo(packet, mac)`,
   `MintRoute.cc:296–307`). Which node goes into the field is the one clause that
   differs. The generator would emit it as a hook. This is v3's Tier C, and the 2026-09-19 framing table
   put "the medium — how they reach each other" on the per-case-study side; the
   evidence here refines that. *Sending to one named node* is the same in both
   models; *naming the node* is not.
2. **Fields one packet type carries.** RTMCS's `pktErrND` is written only by
   `create_rrer`. DSR's path arrays sit on RREQ/RREP, and INET's route fields sit
   on ROUTE. The generator already relocates packet attributes onto the chunk
   (ENC7) and builds one chunk class per leaf. A partial attribute written only by
   one leaf's creating event can go on that leaf's class. That is the *gen* half of
   the matrix's *gen + stu* Packet cell, and it is derivable from the model.

Already shared and already emitted: the per-hop sequence (`linkSeqNo`/`netSeqNo`),
the drain-then-add shape of route learning, the pair-keyed encoding of
per-entry attributes, and the RREQ/RREP/RRER split (v3's AODV routing). That split
is also DSR's lattice.

## 5. What stays Specific, per case study

| | MintRoute | RTMCS | DSR |
|---|---|---|---|
| choosing the next hop | ETX parent: `chooseParent()`, `evaluateCost()` | `fwdNextND(x ↦ s)` lookup; which destination `s` | path element |
| what control packets carry | ROUTE: `parent`, `cost`, `hopCount`, `estList` (absent from the model) | `pktErrND` on RRER (present) | `path`, `reversePath`, `errorNode` |
| learning | `updateEst`, `sentEst` from `estList`, liveliness | backward / forward entries, freshness by `SeqNo`/`HopCnt` | reversing the path, route cache |
| failure | liveliness → `sentEst` decay | RRER chain → `errND` | RRER |
| timing | beacon 5 s, route 20 s, `estimateToRouteRatio` 3 | flags per node; INET adds lifetimes the model lacks | — |

## 6. Answers to the open questions

**Q1. Hand-written or translated?** It differs by case study, and the evidence
says which.
- **RTMCS: translatable.** Its route events are per node (§3). The generator
  already emits RTMCS M6 as structure 2 with 9 untranslated clauses and no
  compile errors. ⚠ Translating reproduces the model faithfully, **including its
  defects**. The `ctlNeighbours = ∅` jam (2026-09-20) and the unchecked `errND`
  (forwarding never tests it) come across with it.
- **MintRoute: hand-written.** M4–M5 read other nodes' state and wait on
  network-wide rounds, so translating them per node would read state no node has.
  Making them translatable would mean adding ROUTE-packet fields to the model and
  replacing `cpCost(nb)` with the local `cost(x ↦ nb)` M5 already keeps. That is a
  change to the advisor's case-study model, not the generator's.
- **DSR: hand-written.** No source exists.

So the generator emits the shared skeleton and hooks for all three. Bodies are
translated where the model is per-node (RTMCS) and hand-written where it is not
(MintRoute, DSR). This matches VERIFICATION_REPORT §F and the 4×4 spec. The
older Pattern_Comparison_Report §11.2 ("generate from CTL₆") holds for RTMCS only.

**Q2. What does a Specific class extend?** The v3 module, extended with §4's
shared part. All three refine the same CommPattern / PPkt / PRouteTable base,
which is exactly what v3 generates. All three add the same next-hop mechanism on
top. v3's two routings already give the two control lattices the case studies need
(ROUTE/BEACON for MintRoute; RREQ/RREP/RRER for RTMCS and DSR).

**Q3. Cross the unicast line?** Yes, for the mechanism. It is identical across the
two models that have a network layer (§2) and named in DSR's requirements, which
is the test v3 used to put something in the pattern. Choosing the next hop stays
Specific.

**Q4. Which hooks?** The roles that recur across MintRoute's own methods
(`MintRoute.h:150–168`), INET's `Aodv.h:136–181` (`handleRREQ/RREP/RERR`,
`sendRREQ/RREP`, `forwardRREQ/RREP`, `createRoute`, `updateRoutingTable`,
`handleLinkBreakSendRERR`) and DSR's dispatch (Final Report Fig 6.10:
`handleLowerMsg` by type, `sendRREQ/sendRREP/sendRRER`):

| hook | MintRoute | AODV | DSR |
|---|---|---|---|
| receive one packet type | `onReceiveRoutePkt`, `onReceiveBeaconPkt` | `handleRREQ`, `handleRREP`, `handleRERR` | `handleLowerMsg` by type |
| send one packet type | `sendRouteBroadcast`, `sendBeaconBroadcast` *(v3 emits these)* | `sendRREQ`, `sendRREP`, `forwardRREQ/RREP` | `sendRREQ/RREP/RRER` |
| choose the next hop | `chooseParent` / `gpCurrentParent` | route lookup | path element |
| learn or update a route | `updateNbrCounters`, `updateEst` | `createRoute`, `updateRoutingTable` | `updateRouteCacheTable` |
| periodic maintenance | route timer: `updateNeighborTable`, `chooseParent` | `expungeRoutes` | — |
| next hop unreachable | liveliness decay | `handleLinkBreakSendRERR` | RRER |

Plus leaf-only packet fields (§4.2). The student's bodies belong in a hand-written
subclass in its own files: the generated header says *"Do not edit by hand —
regenerate instead"*, and the three generated files stay three.

**Q5. Order?** MintRoute first. It needs one next hop per node, which is the
simplest case of the shared mechanism, and one published route (sink via parent).
It has a reference implementation to compare against and runs on the existing
nine-node harness. RTMCS next: its bodies are translatable, but it needs two tables,
multi-hop route publication and a decision about the `ctlNeighbours = ∅` jam. DSR
last: no source and no baseline.

**Q6. MintRoute's target behaviour?** Per node, as MiXiM/INET implement it. The
MiXiM code is the thesis's own simulator implementation. M5's whole-network
formulation cannot run per node as written (§3). What the study cannot settle is
the **link-cost formula**: MiXiM's `2^24/(sendEst·receiveEst) + cost<<6` or
M5's `(120−rEst)·(120−sEst) + pCost`. That decides which parent is "correct" and
is the advisor's call. The study records both. ⚠ **The thesis states both as
well** (checked 2026-10-06). §6.3.7's opening sentence (p. 121) describes the
path cost as the inverse of `receiveEst × sentEst`, MiXiM's form. The thesis's
own model (Appendix A `cal_PCost_gt` g9) uses `(120 − rEst)·(120 − sEst)`, the
Rodin file's form. So "the thesis says" does not settle it either way.

## Audit (2026-10-06, same day)

Each claim was re-checked against its source. The errors, with the reason each
was made:

| was | is | why it was wrong |
|---|---|---|
| verdict 1: forwarding events match "except the one that names the next hop" | they also differ in the route test and MintRoute's `pkt ∈ dom(pktDestAddr)` | compressed from the §0 table of the draft, which had it right |
| §1: MintRoute estimates at M4 | `update_est`/`est_due` are declared at **M3** (`npm run event -- MintRoute M3`) | placed by stage of the plan, not by the machine that declares them |
| §2: MintRoute stamps `BROADCAST` in `create_dataPkt` | also `create_bconPkt` (g18/a11) and `create_routePkt` (g21/a11) | only the data event was printed at the time |
| §2: MintRoute's flags are network-wide scalars | its **flood** flag is per node (`floodFlg ∈ ND → BOOL`), like RTMCS's; only the route/parent phases are scalars | `floodFlg`'s typing was not read |
| §3: MintRoute's machine-level variables were all called network-wide, DSR's were called per node | one rule now covers all three: scratch is localisable, aggregates are not | two models judged by two unstated standards |
| Q6: thesis p. 120 | **p. 121** (page header at extract line 4967) | took the nearest page number seen earlier without checking for a header in between |

The conclusions (Q1–Q6) stand. The one that changed in substance lives in the
draft: see its C6 and §4.

**Second pass (same day):** no further errors in this document. Re-checked and
holding: RTMCS's phase flags are per node with no network-wide guard
(`start_fldRREQ`, `reset_fldRREQ`, `start_fldRREP`, `reset_fldRREP` flattened);
RTMCS declares no `createdPkts`; the bracketed-conjunct gap (direct test). The
second pass's substantive findings concern the draft (§3.3 and §4 item 0) and
M5's completion event (study 1).

**Third pass (same day):** no errors in this document. Its §4 point 1 ("sending
to one named node is the same in both models") was re-confirmed while checking
the draft. What does not yet translate is the *receiver's* side of that rule as
the draft spells it (draft C2, §4 item 8), which is a generator gap, not a
difference between the models.

## Not checked

- Whether M5's whole-network formulation was meant as an abstraction of MiXiM's
  algorithm or as a different algorithm. Neither the model nor the thesis extract
  states it.
- RTMCS data forwarding picks any destination `s` the node has a forward route to,
  not the packet's own destination (`start_tx_dataPkt_fwd`, flattened). Whether
  that is intended (RTMCS data has one destination) was not traced further.
- DSR's M4–M6 beyond `reverse_path_loop`.

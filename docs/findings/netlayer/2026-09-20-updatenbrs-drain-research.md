# `updateNbrs` never drains: where the RTMCS jam actually lives

**2026-09-20.** Research pass against primary sources only — raw Rodin XML
(`org.eventb.core.*` attributes, never `text_representation`), INET 4.5's own
`Aodv.cc`/`Aodv.h`, the PhD thesis PDF, the ECTI-CON 2020 paper and the project's
Final Report. Everything below carries the file and the attribute it came from.

---

## Verdict

**The measured finding is correct and the enumeration is complete — there is no
missed drain.** But three things about it were not known, and each changes what
should be done:

1. **Every clause that touches `updateNbrs` lives in `M4.bum` and nowhere else.**
   The events the harness reports (`receive_rreqPkt`, `dest_recv_rreqPkt`,
   `add_bwdRouteEntry`, `add_fwdrouteEntry`, `invalidate_neighbour`) are
   `extended` refinements that inherit M4's clauses verbatim and add nothing to
   that variable. Six actions, nine guards, all in one file.

2. **The idempotency that jams two of the three drains is added BELOW M4.**
   At M4, `add_routeEntry2` and `add_routeEntry3` are *unguarded* drains — no
   route-table test at all. The `∉ fwdRouteTbl` test is introduced at **M5**
   (`add_fwdrouteEntry` `@g10`) and `∉ errND` at **M6**
   (`invalidate_neighbour` `@g14`). Only the RREQ branch is idempotent at M4.

3. **The shape that works is already in the project — twice.** MintRoute splits
   the job into a one-shot `add_newEntry` that does **not** drain and a
   repeatable `update_nbr` that **does**; INET's own AODV does
   `if (!route) createRoute(...) else updateRoutingTable(...)` and continues in
   both branches; and the generator's **own bundled `pM5.bum`** ships MintRoute's
   split verbatim. RTMCS is the only one of the four that fuses "create the
   entry" and "consume the pending pair" into one event.

**Scope: the fix is out of the generator's scope.** Every primary source — the
thesis, the ECTI-CON paper and the project's own design documents — puts RTMCS
M4–M6 route-table maintenance on the protocol-specific side. See
[Scope verdict](#scope-verdict).

---

## 1. Q1 — every event that touches `updateNbrs`

Exhaustive attribute-level scan of `M0.bum`–`M6.bum`, matching on
`org.eventb.core.assignment` and `org.eventb.core.predicate`. **All matches are in
`M4.bum`. `M0`–`M3`, `M5` and `M6` contain none.**

### Actions

| machine::event | label | `org.eventb.core.assignment` |
|---|---|---|
| `M4::INITIALISATION` | `int4_7` | `updateNbrs ≔ ∅` |
| `M4::receive_controlPkt` | `a5` | `updateNbrs ≔ updateNbrs ∪ {f ↦nb}` |
| `M4::dest_recv_controlPkt` | `a5` | `updateNbrs ≔ updateNbrs ∪ {f↦des}` |
| `M4::add_routeEntry` | `a5` | `updateNbrs ≔ updateNbrs ∖ {x ↦ y}` |
| `M4::add_routeEntry2` | `a1` | `updateNbrs ≔ updateNbrs ∖ {x ↦ y}` |
| `M4::add_routeEntry3` | `a1` | `updateNbrs ≔ updateNbrs ∖ {x ↦ y}` |

### Guards

| machine::event | label | `org.eventb.core.predicate` |
|---|---|---|
| `M4::receive_controlPkt` | `g12` | `f ↦ nb ∉ updateNbrs` |
| `M4::receive_dup_controlPkt` | `g7` | `f ↦ nb ∉ updateNbrs` |
| `M4::dest_recv_controlPkt` | `g15` | `f ↦ des ∉ updateNbrs` |
| `M4::add_routeEntry` | `g1`, `g2` | `updateNbrs ≠ ∅` · `x ∈ ND ∧ y ∈ ND ∧ x ↦ y ∈ updateNbrs` |
| `M4::add_routeEntry2` | `g1`, `g2` | same |
| `M4::add_routeEntry3` | `g1`, `g2` | same |

**Nothing else removes the pair by any other means.** There is no
`updateNbrs ≔ ∅` reset outside INITIALISATION, no domain/range anti-restriction,
and no override.

### The refinement chain — why the harness reports different names

Read from `org.eventb.core.refinesEvent` / `org.eventb.core.target`, with
`org.eventb.core.extended="true"` on every M5/M6 event:

```
M4 add_routeEntry   → M5 add_bwdRouteEntry → M6 add_bwdRouteEntry
M4 add_routeEntry2  → M5 add_fwdrouteEntry → M6 add_fwdrouteEntry
M4 add_routeEntry3  → M5 add_routeEntry3   → M6 invalidate_neighbour

M4 receive_controlPkt     → M5 receive_rreqPkt / receive_rrepPkt / receive_controlPkt
                          → M6 receive_rreqPkt / receive_rrepPkt / receive_rrerPkt
M4 dest_recv_controlPkt   → M5 dest_recv_rreqPkt / dest_recv_rrepPkt
                          → M6 dest_recv_rreqPkt / dest_recv_rrepPkt / dest_recv_rrerpkt
```

So the six fillers and three drains the harness names are exactly M4's three
fillers-and-guards and three drains, renamed and type-split down two refinement
levels. **The measured enumeration is complete.**

### Correction: the fillers are two events, not six

`M4::receive_dup_controlPkt` **guards** `f ↦ nb ∉ updateNbrs` (`@g7`) and has
**no `updateNbrs` action**. RTMCS's duplicate path is therefore *blocked by* a
queued pair while never queueing one and never draining one — it is pure
collateral damage from the jam.

⚠ This is a **difference from MintRoute**, which does fill on the duplicate path:
`MintRoute_3_2_5_9_complete_amiCheck/M3.bum`, `receive_dup_controlPkt` `@a2:
updateNbrs ≔ updateNbrs ∪ {f ↦nb}`.

### The author's own comments say `updateNbrs` is a deferred-work queue

`org.eventb.core.comment` attributes in `RTMCS_7_4_proof/M4.bum` — these are in
the raw XML, not only in the thesis rendering:

| event | element | comment |
|---|---|---|
| `receive_controlPkt` | guard `g12` | *"nb has not considered to update in the neighbour table yet"* |
| `receive_controlPkt` | action `a5` | *"put nb into updateNbrs for update it into the neighbour table later"* |
| `receive_dup_controlPkt` | guard `g7` | *"nb has not considered to update in the neighbour table yet"* |
| `add_routeEntry` | guard `g1` | *"there is some nodes that have to update thier neighbour table"* |
| `add_routeEntry` | guard `g4` | *"in case these new pairs don't appear in the neighbour table"* |

So the intent is explicit: the pair is parked in `updateNbrs` to be folded into
the table **later**. The model provides no path for "later" to happen twice for
the same pair.

### ⚠ A guard was commented out, and it is the one that matters

`add_routeEntry2` and `add_routeEntry3` carry this on guard `g3`
(`org.eventb.core.comment`, verbatim):

> `@g4 y ↦ s   ∉ dest // in case these new pairs don't appear in the neighbour table`

That is a **disabled `g4`** — the author drafted the same idempotency guard
`add_routeEntry` carries, then parked it in a comment rather than declaring it.
Which is why `add_routeEntry2`/`3` are unguarded drains at M4 while
`add_routeEntry` is not. The guard came back at M5 in a different form
(`@g10: y ↦ s ∉ fwdRouteTbl`).

*(I infer "drafted then disabled" from the `@g4 …` syntax inside a comment; the
source does not state why.)*

### `add_routeEntry2` and `add_routeEntry3` are byte-identical at M4

Same six parameters, same eight guards (`g1,g2,g3,g5,g6,g7,g8,g9` — note both
skip `g4`), same single action. The two only diverge at M5, where
`add_fwdrouteEntry` gains the RREP branch and `add_routeEntry3` gains
`type(pkt) ≠ RREQ ∧ type(pkt) ≠ RREP`.

### The full drain guard set, flattened

`add_routeEntry` (M4) → `add_bwdRouteEntry` (M5/M6):

```
g1 : updateNbrs ≠ ∅
g2 : x ∈ ND ∧ y ∈ ND ∧ x ↦ y ∈ updateNbrs
g3 : pkt ∈ dom(initialSrcAddr) ∧ s = initialSrcAddr(pkt)
g4 : y ↦ s   ∉ bwdRouteTbl            ← the binding constraint
g5 : pkt ↦x ∈ pktFwdr
g6 : sNo = netSeqNo(pkt) ∧ y ↦ x ↦ sNo ∉ bwdSeqNo
g7 : hCnt ∈ ℕ ∧ pkt∈dom(pktNbHops) ∧ hCnt = pktNbHops(pkt) + 1 ∧ y ↦ x ↦ hCnt ∉ bwdHopCnt
g8 : ctlNeighbours = ∅                ← the quiescence barrier
g9 : type(pkt) = RREQ
  + M5 g10 : type(pkt) = RREQ
  + M5 g12 : pkt ∈ ran(sentUp)
```

Actions `a1`–`a4` add to `bwdRouteTbl`/`bwdNextND`/`bwdSeqNo`/`bwdHopCnt` with
**`∪`**, never `⊕`. An entry, once created, can never be refreshed.

⚠ **`g6`/`g7` name a different pair from the actions they guard.** The guards test
`y ↦ x ↦ …` (x = the forwarder, from `pkt ↦ x ∈ pktFwdr`); the actions write
`y ↦ s ↦ …` (s = the originator, from `s = initialSrcAddr(pkt)`). The thesis
Appendix C listing shows the same mismatch, so it is in the model, not a
transcription slip. Well-definedness of `bwdSeqNo ∈ bwdRouteTbl → ℕ` is carried
by `g4` alone; `g6`/`g7` are extra gates on an unrelated pair. *(Observation. The
source does not comment on it, and it does not break the discharged invariant
POs.)*

### After M5/M6, no control-packet type has a repeatable drain

| packet type | drain | idempotency guard | declared at |
|---|---|---|---|
| RREQ | `add_bwdRouteEntry` | `y ↦ s ∉ bwdRouteTbl` | **M4** `@g4` |
| RREP | `add_fwdrouteEntry` | `y ↦ s ∉ fwdRouteTbl` | **M5** `@g10` |
| RRER | `invalidate_neighbour` | `y ↦ eND ∉ errND` | **M6** `@g14` |

The three drains partition control traffic by type, and every one of them is
one-shot. **That is the jam, stated completely.**

### `invalidate_neighbour`'s enabling chain — reachable in principle, dead in this run

Traced from the raw XML:

```
lose_dataPkt (M6)        @g12 type(pkt) = DATA
                         @a8  rrerLists ≔ rrerLists ∪ {f↦pkt}
   ↓
start_fldRRER (M6)       @a16 rrerFlg(x) ≔ TRUE
   ↓
create_rrer (M6)         @g23 s ↦ rrer ∈ rrerLists
                         @g25 s ↦ eND ∈ fwdRouteTbl      ← needs a FORWARD route
                         @g27 rrerFlg(s) = TRUE
                         @a16 pktErrND ≔ pktErrND ∪ {pkt ↦ eND}
   ↓
invalidate_neighbour     @g12 pkt ↦ eND ∈ pktErrND
                         @g13 y ↦ eND ∈ fwdRouteTbl
```

and `fwdRouteTbl` is filled only by `add_fwdrouteEntry` (M5 `@a6`), which needs
an RREP, which needs `rrepLists`, which is filled only by `dest_recv_rreqPkt`
(M5 `@a6: rrepLists ≔ rrepLists ∪ {des↦pkt}`) — and **`dest_recv_rreqPkt` is itself
gated on `f ↦ des ∉ updateNbrs`** (inherited M4 `@g15`).

**So the jam closes the chain at step one.** For `invalidate_neighbour` to fire,
`dest_recv_rreqPkt` must fire repeatedly at the RREQ's destination, then
`start_fldRREP` → `create_rrep` → RREP flood → `add_fwdrouteEntry`, then a DATA
packet must be lost and `start_fldRRER` must fire. A node whose `updateNbrs` has
one stuck pair per neighbour never reaches the second step. This is consistent
with the measured `add_bwdRouteEntry` firing exactly once per node.

### ⚠ The model was never proved deadlock-free, and the 100 % proof status does not contradict the jam

`M4.bps` / `M5.bps` / `M6.bps`: **40 / 57 / 27 status entries, zero not fully
discharged.** But `M4.bpo` / `M5.bpo` / `M6.bpo` contain **only `WD` and `INV`
obligations** (M4: 21 WD + 19 INV = 40; M5: 29 + 28; M6: 14 + 13). There is not
one `GRD`, `SIM` or deadlock-freeness sequent in any of the three.

Two reasons, both structural: every M5/M6 event is `org.eventb.core.extended="true"`,
so guard strengthening is syntactic and generates no PO; and Rodin does not emit
deadlock-freedom obligations unless they are stated as invariants. **A fully
discharged RTMCS is entirely compatible with a model that jams.**

---

## 2. Q2 — what INET 4.5's AODV does instead

`Simulation/inet4.5/src/inet/routing/aodv/Aodv.cc`.

### Receiving a RREQ from a neighbour it already has a route to → **(a) update**

`Aodv::handleRREQ`, lines 787–794:

```cpp
IRoute *previousHopRoute = routingTable->findBestMatchingRoute(sourceAddr);

if (!previousHopRoute || previousHopRoute->getSource() != this) {
    // create without valid sequence number
    previousHopRoute = createRoute(sourceAddr, sourceAddr, 1, false, rreq->getOriginatorSeqNum(), true, simTime() + activeRouteTimeout);
}
else
    updateRoutingTable(previousHopRoute, sourceAddr, 1, false, rreq->getOriginatorSeqNum(), true, simTime() + activeRouteTimeout);
```

The comment above it quotes RFC 3561: *"When a node receives a RREQ, it first
creates or updates a route to the previous hop without a valid sequence number"*.
**Create-or-update, and execution continues either way.** There is no branch in
which an already-known neighbour causes the node to stop processing.

The reverse route to the originator is the same shape, lines 849–877:

```cpp
if (!reverseRoute || reverseRoute->getSource() != this) { // create
    reverseRoute = createRoute(rreq->getOriginatorAddr(), sourceAddr, hopCount, true, rreqSeqNum, true, newLifeTime);
}
else {
    ...
    if (rreqSeqNum > routeSeqNum ||
        (rreqSeqNum == routeSeqNum && newHopCount < routeHopCount) ||
        rreq->getUnknownSeqNumFlag())
    {
        updateRoutingTable(reverseRoute, sourceAddr, hopCount, true, newSeqNum, true, newLifeTime);
    }
}
```

**A repeat with an equal sequence number is not ignored** — it is accepted when
the hop count improves. A repeat with a *lower* sequence number leaves the route
alone but the packet keeps being processed.

`Aodv::handleRREP` (lines 567–574) does the identical create-or-update on the
previous hop, then lines 589–623 update the forward route when the stored
sequence number is invalid or the RREP's is greater.

`Aodv::updateRoutingTable` (709–727) is a plain overwrite —
`setNextHop`/`setMetric`/`setLifeTime`/`setDestSeqNum`/`setIsActive` — i.e. the
`⊕` semantics RTMCS's `∪` cannot express.

### AODV's duplicate suppression is (b) drop the packet, and it **expires**

`handleRREQ`, lines 800–808:

```cpp
RreqIdentifier rreqIdentifier(rreq->getOriginatorAddr(), rreq->getRreqId());
auto checkRREQArrivalTime = rreqsArrivalTime.find(rreqIdentifier);
if (checkRREQArrivalTime != rreqsArrivalTime.end() && simTime() - checkRREQArrivalTime->second <= pathDiscoveryTime) {
    EV_WARN << "The same packet has arrived within PATH_DISCOVERY_TIME= " << pathDiscoveryTime << ". Discarding it" << endl;
    return;
}
```

Keyed by **(originator, RREQ id)** and bounded by `pathDiscoveryTime` — it
suppresses *that packet*, not *that neighbour*, and it times out. Crucially it
runs **after** the previous-hop route has already been created or updated.

### (d) block further receptions from that neighbour — the only analogue, and it is not this

`Aodv::handleRREQ` lines 779–782 refuse RREQs from a blacklisted node. The
blacklist is populated only by RREP-ACK timeout
(`Aodv::handleRREPACKTimer`) and is cleared by `handleBlackListTimer`. It is a
link-failure mechanism with an expiry, not a route-table-maintenance queue.

### There is no `updateNbrs` and no `ctlNeighbours = ∅`

Full member list of `Aodv.h` (lines 105–128). The only queues are:

- `std::map<RreqIdentifier, simtime_t, RreqIdentifierCompare> rreqsArrivalTime;` — *"maps RREQ id to its arriving time"*, the duplicate filter above.
- `std::multimap<L3Address, Packet *> targetAddressToDelayedPackets;` — *"queue for the datagrams we have no route for"*, a **data-packet** buffer.
- `std::map<L3Address, WaitForRrep *> waitForRREPTimers;` and `addressToRreqRetries` — route-discovery timers.

**No pending-neighbour-update set exists, and nothing anywhere in `Aodv.cc`
conditions route maintenance on the absence of in-flight deliveries.** Every
route write happens inline, inside the packet handler, on the packet that
triggered it.

`Aodv::handleRERR` (1147–1206) is the same: it walks the routing table inline,
sets `setIsActive(false)` on matching routes, and forwards a new RERR — no queue,
no barrier.

---

## 3. Q3 — what the PhD thesis says

`references/phdThesis_Adisak.pdf`; quotations taken from the text extract at
`scratch/pdf_extracts/phdThesis.txt` and cross-checked against the raw XML where
they overlap (the Appendix C listing matches `M4.bum` clause for clause).

### The six patterns contain no route table

Section 9.6.3, p. 207–208:

> "This comprises the following elements: **PSensingUnit, PPacket, PSend,
> PReceive, PNDBuffer and PDestBuffer.**"

and the per-pattern descriptions that follow — sensing, packet management,
transmit down/up, receive at non-destination and destination, node buffer,
destination buffer. Appendix D enumerates exactly those six
(`D.1.1`–`D.1.6`).

**There is no route-table or neighbour-table pattern in the thesis's pattern set.**
Neither `updateNbrs` nor any "pending neighbour update" concept is discussed in
the pattern chapter; the only occurrences of `updateNbrs` in the whole thesis are
inside the Appendix A (SensorScope) and Appendix C (RTMCS) model listings.

### S1–S6 is the packet process, and route maintenance is not in it

Section 9.6.2, p. 203–204, Figure 9.12. S1 sensing, S2 create packet into a
waiting buffer, S3 select from the buffer (`start tx`), S4 `send down`, S5
`send up`, S6 re-record in the waiting buffer and repeat S4–S6 until the
destination is reached, S7 record in the destination buffer. **No step mentions a
route table, a neighbour table or a pending-update queue.**

### The thesis does say the route add is meant as deferred work

Appendix C, `receive controlPkt`, carries the comment (identical to the XML's
`org.eventb.core.comment`):

> `//put nb into updateNbrs for update it into the route table later`

and on `g12`:

> `//nb has not considered to update in the route table yet`

The SensorScope listing in Appendix A carries the neighbour-table wording of the
same comments.

### ⚠ The thesis does NOT state whether the route add is one-shot or per reception

I looked for it and did not find it. The thesis describes *what* the events do,
not the intended firing multiplicity. **This is not answered by the source.**

### ⚠ The thesis does NOT state a one-delivery-round-at-a-time assumption

There is no statement I could find that justifies `ctlNeighbours = ∅` as a
barrier, and no discussion of it at all. The guard appears in the Appendix C
listing (`g8 : ctlNeighbours = ∅`) without comment. **This is not answered by the
source** — the only supporting evidence for a "quiescent round" reading is the
structural fact that `ctlNeighbours` is a global publication relation drained by
the receive events, which makes the barrier satisfiable only between rounds.
*(That is my inference, not the thesis's claim.)*

### What the thesis DOES say about where M4 sits

Section 9.5.1.2, p. 192–193:

> "Later refinement levels **M4 and M5 layer AODV protocol steps**. Model **M4
> implements RREQ flooding mechanism** before RREP unicasting operation and data
> packet forwarding mechanism via the route are introduce in model M5. Finally,
> RERR transmission is developed in the final refinement model (M6)."

and the chapter's own conclusion, p. 222:

> "the routing protocol of these two case studies is **completely different in
> which they contain the specific functionality to perform the specific routing
> algorithm**."

The corresponding MintRoute headings are section 6.3.5 *"Third Refinement Model
(M3) - neighbour table management and link quality estimation"*, 6.3.6 *"Fourth
Refinement Model (M4) - route broadcast mechanism"*, 6.3.7 *"Fifth Refinement
Model (M5) - parent selection and unicast packet forwarding"*.

⚠ **So the two chains are not aligned by number.** MintRoute's table lives at
**M3**; RTMCS's lives at **M4**. A rule phrased as "the M4/M5 boundary" is a
statement about MintRoute's numbering and does not transfer to RTMCS by
arithmetic.

---

## 4. Q4 — ECTI-CON 2020 and the Final Report

### ECTI-CON 2020 — the same six patterns, and M4–M5 is Part A

`references/A_Pattern-Based_Formal_Modelling_Framework_for_Wireless_Sensor_Networks.pdf`:

> "The former pattern consists of six very simple and common components that can
> be composed to make a basic network communication. These components are (1)
> PSensingUnit … (2) PPacket … (3) PSend … (4) PReceive … (5) PNDBuffer … and (6)
> PDestBuffer …"

> "Part A is for defining the functionality and operation for **the specific
> protocol algorithm**. This part is layered on the top of part B which is for
> defining packet transmission and physical interaction."

> "Network protocol modelling: … **Route discovery including RREQ flooding and
> RREP unicasting** in the DSR protocol **as implemented in M4-M5**. Then we
> include the unicast forwarding packet transmission via route and RRER
> forwarding mechanism in the final network model (M6)."

The paper also records the refinement pattern's provenance: *"It was discovered
from implementation of two WSN systems, SensorScope … and RTMCS"* — so the
RREQ/RREP/RRER placement at M4–M6 is the paper's own reading of the RTMCS chain.

**No route table appears among the common components. Route discovery at M4–M5 is
explicitly Part A — the specific protocol algorithm.**

### Final Report — seven patterns, still no route table

`references/Final_Report_2_PrintedVersion-1.pdf`, appendix *"Event-B Patterns
Version 2.0"* lists `.1 PSensingUnit`, `.2 PPacket`, `.3 PSend`, `.4 PReceive`,
`.5 PNDBuffer`, `.6 PDestBuffer`, `.7 PActivate`. The added seventh is the
actuation pattern, not a route table.

Its refinement table places DSR's *"Route Discovery (RREQ Flooding)"* at M4,
*"Route Discovery (RREP Unicasting)"* at M5 and *"Data packet and RRER
forwarding"* at M6 — the same Part A layering, and it names RTMCS as the source
of the RREQ/RREP/RRER structure.

**Answer to the direct question: the reverse and forward route tables are
described as protocol-specific in every one of the three publications. Neither
the thesis, the paper nor the Final Report describes them as part of the common
pattern.**

---

## 5. Q5 — scope

### Where each name is declared (raw `org.eventb.core.identifier` / `invariant`)

| name | declared in | kind |
|---|---|---|
| `updateNbrs` | **M4** `inv4_7 : updateNbrs ∈ ND ↔ ND` | variable |
| `bwdRouteTbl` | **M4** `inv4_1 : bwdRouteTbl ∈ ND ↔ ND` | variable |
| `bwdNextND` | **M4** `inv4_2 : bwdNextND ∈ bwdRouteTbl → ND` | variable |
| `bwdSeqNo` | **M4** `inv4_3 : bwdSeqNo ∈ bwdRouteTbl → ℕ` | variable |
| `bwdHopCnt` | **M4** `inv4_4 : bwdHopCnt ∈ bwdRouteTbl → ℕ` | variable |
| `fwdRouteTbl` | **M5** `inv4_5 : fwdRouteTbl ∈ ND ↔ ND` | variable |
| `add_routeEntry` / `2` / `3` | **M4** | new events (no `refinesEvent`) |
| `add_bwdRouteEntry` | **M5** (refines M4 `add_routeEntry`) | extended |
| `add_fwdrouteEntry` | **M5** (refines M4 `add_routeEntry2`) | extended |
| `invalidate_neighbour` | **M6** (refines M5 `add_routeEntry3`) | extended |

⚠ Two corrections to things stated elsewhere in the project:

- **`fwdRouteTbl` is declared at M5, not M4** — and `bwdRouteTbl` at M4, so the
  two are not siblings in one machine. (CLAUDE.md's 2026-09-20 code-review entry
  says *"RTMCS M5 declares both `bwdRouteTbl` and `fwdRouteTbl`"*; M5 inherits
  the first and declares only the second.)
- The authoritative identifier really is **`fwdRouteTbl`**, confirmed
  independently here from `org.eventb.core.identifier`; M5's stale
  `text_representation` still says `fwdNeighbourTbl`.

### `updateNbrs` is not in the shared pattern

Grepped `Ex_WSN_Pattern/WSN_Pattern`, `Ex_WSN_Pattern/WSN_Pattern_shDecom6_2`
(`pM1`/`uM2`/`pM3` + the six interface machines) and `Update_wsn/C0_project`:
**zero occurrences.** The only place it appears outside the two case studies is
the generator's own bundled `wsn-codegen/src/assets/pattern-extension/pM5.bum` —
i.e. the project's synthesised PRouteTable tier, not the advisor's pattern.

### What the project's own design documents say

`design/Pattern_Comparison_Report.md` §8.4, the Event-B → C++ classification
table, verbatim rows:

| Event-B Event | Category |
|---|---|
| `receive_rreqPkt / receive_dup_rreqPkt` | **Protocol-specific** |
| `receive_rrepPkt / receive_dup_rrepPkt` | **Protocol-specific** |
| `receive_rrerPkt` | **Protocol-specific** |
| `invalidate_neighbour` | **Protocol-specific** |
| `add_bwdRouteEntry` | **Protocol-specific** |
| `add_fwdrouteEntry` | **Protocol-specific** |

and §11.1: *"The Part A events at M4–M6 are entirely protocol-specific for each
case."*

The 4×4 matrix
(`docs/superpowers/specs/2026-06-12-four-category-pattern-class-architecture-design.md`):

| | Interface 🟢 | Base 🟢 | PClass 🟡 | Specific 🔵 |
|---|---|---|---|---|
| **RouteTable** | `IRoutingTable` + `IRoute` *(INET, reuse)* | `RouteTableBase` *(gen)* | `PRouteTable` *(gen)* — pair-keyed + relational ops + metric maintenance → R2, R5–R9, R11, R17–R20 | `MintRouteTable` · **`PairRouteTable`** · `SourceRouteCache` *(gen + **stu**)* |

with the legend: *"**Specific class** … 🔵 blue … **student-filled** for M4–M6
protocol bodies"* and *"Blue (Specific) = mostly student-filled for the three
case studies' M4–M6 imperative bodies (DSR source-routing, MintRoute ETX,
**AODV/RTMCS RREQ/RREP/RRER**)."*

`design/VERIFICATION_REPORT.md` §F, audience #2:

> "**AODV/RTMCS: RREQ/RREP/RRER routing-decision bodies**" — *"Project student
> fills in for the three case studies (audience #2 — Phase 4 validation)"*.

The amber `PRouteTable` cell holds the **translation rules** (R17/R18 — the
pair-keyed encoding), not the event semantics. RTMCS's `PairRouteTable` is blue.

---

## Scope verdict

**Out of scope for the generator.** `updateNbrs`, `bwdRouteTbl`/`bwdNextND`/
`bwdSeqNo`/`bwdHopCnt` and the three drain events are declared in RTMCS's own
`M4.bum` (with `fwdRouteTbl` at M5 and `invalidate_neighbour` at M6), they appear
in no shared pattern machine, and the thesis, the ECTI-CON paper and the
project's own `Pattern_Comparison_Report.md` §8.4 / 4×4 matrix / `VERIFICATION_REPORT.md`
§F all classify RTMCS M4–M6 route-table maintenance as protocol-specific,
student-filled (blue) work — so fixing the jam is an edit to the RTMCS case
study's own model, not a generator capability gap.

Two qualifications that should travel with that verdict:

1. **The "M4/M5 boundary" phrasing does not decide this, because it is
   MintRoute's numbering.** MintRoute's table is at M3, RTMCS's at M4. If the
   rule is read structurally as *"the first refinement that introduces the
   route/neighbour table is generated"*, then RTMCS M4 lands on the **generated**
   side, symmetrically with MintRoute M3 — which the generator does emit and
   which does fire. Read by machine number it lands on the specific side. The
   sources support the *structural* reading being the ambiguous one and the
   *publication* reading being unambiguous: all three publications say M4–M6
   AODV is Part A. **The verdict above follows the publications.**

2. **The generator is not producing wrong code.** Every clause translates; the
   jam is a property of the model's own guards. Nothing in the rule catalog can
   fix it, and nothing in the rule catalog caused it.

---

## 6. Q6 — the minimal change, if one is made

The sources do support a change, and they agree on its shape. **It is confined to
the RTMCS case study's own machines — it is not an advisor-level change to a
shared pattern machine**, because `updateNbrs` and `add_routeEntry*` exist only in
`RTMCS_7_4_proof/M4.bum`.

### The shape three sources already use

**MintRoute** (`MintRoute_3_2_5_9_complete_amiCheck/M3.bum`) splits the job:

```
add_newEntry                            update_nbr
  g3 : y ↦ x ∉ neighbourTbl               g3 : y ↦ x ∈ neighbourTbl
  a1 : neighbourTbl ≔ … ∪ {y ↦ x}         a1 : received  ≔ received  ⊕ {y↦x ↦ received(y↦x)+1}
  a2..a5 : counters ∪ {y↦x↦0}             a2 : lastSeqno ≔ lastSeqno ⊕ {y↦x ↦ sNo}
                                          a3 : missed    ≔ missed    ⊕ {y↦x ↦ delta}
  (NO updateNbrs action)                  a4 : updateNbrs ≔ updateNbrs ∖ {x ↦ y}
```

plus `update_nbr2` — `g3 : y ↦ x ∈ neighbourTbl`, `g5 : type(pkt) ≠ DATA ∧
type(pkt) ≠ BEACON`, `a1 : updateNbrs ≔ updateNbrs ∖ {x ↦ y}` — the
non-BEACON branch, also repeatable. **The one-shot event does not drain; the
repeatable events do.** And there is no `ctlNeighbours = ∅` guard on any of them.

**INET's AODV** is the same decision in C++: `if (!route) createRoute(...) else
updateRoutingTable(...)`, both branches continuing (`Aodv.cc:789–794`, `849–877`,
`567–574`).

**The generator's own bundled PRouteTable**
(`wsn-codegen/src/assets/pattern-extension/pM5.bum`) already ships MintRoute's
split verbatim — `add_newEntry` with `MRouteTable_add_g3 : y ↦ x ∉ neighbourTbl`
and no drain, `update_nbr` with `MRouteTable_upd_g3 : y ↦ x ∈ neighbourTbl`,
`⊕` overrides and `MRouteTable_upd_a4 : updateNbrs ≔ updateNbrs ∖ {x ↦ y}`.

### The minimal RTMCS change

Split `add_routeEntry` (M4) in two, mirroring MintRoute exactly:

**(i) `add_routeEntry` — keep, but stop draining.** Remove `@a5`. Everything else
unchanged, including `@g4 : y ↦ s ∉ bwdRouteTbl`. It stays the one-shot creator.

**(ii) `update_bwdRoute` — new M4 event, the repeatable twin.** Guards as
`add_routeEntry` with `@g4` **inverted**, and the actions as overrides:

```
@g1 : updateNbrs ≠ ∅
@g2 : x ∈ ND ∧ y ∈ ND ∧ x ↦ y ∈ updateNbrs
@g3 : pkt ∈ dom(initialSrcAddr) ∧ s = initialSrcAddr(pkt)
@g4 : y ↦ s ∈ bwdRouteTbl                       ← inverted: the entry EXISTS
@g5 : pkt ↦ x ∈ pktFwdr
@g6 : sNo = netSeqNo(pkt)
@g7 : hCnt ∈ ℕ ∧ pkt ∈ dom(pktNbHops) ∧ hCnt = pktNbHops(pkt) + 1
@g9 : type(pkt) = RREQ
then
@a1 : bwdNextND  ≔ bwdNextND  ⊕ {y ↦ s ↦ x}     ← ⊕ (U+E103), not ∪
@a2 : bwdSeqNo   ≔ bwdSeqNo   ⊕ {y ↦ s ↦ sNo}
@a3 : bwdHopCnt  ≔ bwdHopCnt  ⊕ {y ↦ s ↦ hCnt}
@a4 : updateNbrs ≔ updateNbrs ∖ {x ↦ y}
```

`@g6`/`@g7` drop their `∉ bwdSeqNo` / `∉ bwdHopCnt` conjuncts, which exist only to
keep `∪` functional and are meaningless under `⊕`. Whether `@g8 : ctlNeighbours = ∅`
is kept is a separate question — the measured counterfactual says it is not the
binding constraint, and MintRoute's equivalent does not have it.

⚠ **`⊕` is relational override, stored by Rodin as U+E103.** It must not be
transcribed as `∖`. This is the same substitution that was a confirmed model
error in `pM1 start_tx`.

⚠ **This refreshes the route on every repeat, where AODV refreshes only on a
better one.** AODV's condition is `rreqSeqNum > routeSeqNum || (rreqSeqNum ==
routeSeqNum && newHopCount < routeHopCount) || rreq->getUnknownSeqNumFlag()`
(`Aodv.cc:871–873`). Adding that as a guard would make the event refuse on a
stale repeat — **and then the pair would not drain**, reintroducing the jam. AODV
avoids this because the queue does not exist: it simply skips the write and
carries on. If AODV's freshness test is wanted in the model, it needs a
companion "stale repeat: drain without writing" event, which is exactly what
MintRoute's `update_nbr2` is for its own non-BEACON case.

**(iii) The RREP and RRER branches need the same treatment** at M5 and M6 —
`add_fwdrouteEntry`'s `@g10 : y ↦ s ∉ fwdRouteTbl` and `invalidate_neighbour`'s
`@g14 : y ↦ eND ∉ errND` each need a repeatable twin, or the corresponding
control type jams the moment its table entry exists.

**No model file was written or modified by this pass.**

---

## What is NOT answered by the sources

- **Whether the route add was intended to be one-shot or per reception.** The
  thesis describes what each event does and never states firing multiplicity. The
  Rodin comments say the pair is queued *"for update it into the route table
  later"* but not how many times "later" may happen.
- **Whether the model assumes one delivery round at a time.** `ctlNeighbours = ∅`
  appears in the Appendix C listing without comment and is discussed nowhere. The
  "quiescent round" reading is my inference from the variable's role, not a
  source claim.
- **Why `add_routeEntry2`/`3`'s `g4` was disabled** rather than declared. The
  comment preserves the guard text; nothing says whether it was dropped
  deliberately or left unfinished.
- **Why `add_routeEntry2` and `add_routeEntry3` are byte-identical at M4.** They
  diverge only at M5. No source explains the duplicate.
- **Why `g6`/`g7` test `y ↦ x` while `a3`/`a4` write `y ↦ s`.** Present in both the
  XML and the thesis listing; uncommented.
- **Whether the project intends the structural or the numeric reading of the
  M4/M5 boundary for RTMCS.** The publications are unambiguous that AODV M4–M6 is
  Part A; the project's own generated/Specific rule was phrased from MintRoute's
  chain and has never been restated for RTMCS. This is a project decision, not a
  source fact.
- **Whether `add_fwdrouteEntry` or `invalidate_neighbour` ever fired in the
  measured run.** The reported counters cover `add_bwdRouteEntry` only; the
  enabling-chain analysis above predicts zero for both, but that is a prediction,
  not a measurement.

---

## Sources opened

- `EventB_model/RTMCS_7_4_proof/{M0..M6}.bum`, `{C0..C4,T01}.buc`, `{M4,M5,M6}.{bps,bpo}` — raw Rodin XML, `org.eventb.core.*` attributes only
- `EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck/{M0..M5}.bum`
- `Ex_WSN_Pattern/WSN_Pattern/*`, `Ex_WSN_Pattern/WSN_Pattern_shDecom6_2/*`, `Update_wsn/C0_project/*`
- `wsn-codegen/src/assets/pattern-extension/{uM4,pM5}.bum`
- `Simulation/inet4.5/src/inet/routing/aodv/{Aodv.cc,Aodv.h}`
- `references/phdThesis_Adisak.pdf` (§9.5.1.2, §9.6.3, §9.7, Appendix A, Appendix C, Appendix D) via `scratch/pdf_extracts/phdThesis.txt`
- `references/A_Pattern-Based_Formal_Modelling_Framework_for_Wireless_Sensor_Networks.pdf` via `scratch/pdf_extracts/ectimcon2020.txt`
- `references/Final_Report_2_PrintedVersion-1.pdf` via `scratch/pdf_extracts/final_report.txt`
- `design/{RouteTable_Design.md, Pattern_Comparison_Report.md, VERIFICATION_REPORT.md}`, `docs/superpowers/specs/2026-06-12-four-category-pattern-class-architecture-design.md`

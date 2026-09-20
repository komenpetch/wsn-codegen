# The `updateNbrs` jam: what it is, and what a repeatable drain does to it

**2026-09-20.** Measured on the RTMCS/AODV harness
(`Simulation/inet4.5/rtmcs_results`, 4-node 200 m line, 60 s, exit 0) against
the generator at commit `924dc19`.

Companion to
[2026-09-20-updatenbrs-drain-research.md](2026-09-20-updatenbrs-drain-research.md),
which answers *what the primary sources say*. This file answers *what happens
when you build the change and run it* — three counterfactuals and two model
variants, every one applied to a **copy** of the model and then reverted.

⚠ **Re-run, do not quote.** Every number here is from a dated run of that
harness and is reproducible from the probes described at the bottom.

---

## Verdict

1. **RTMCS's reception chain deadlocks, and the deadlock is in the model's own
   guards.** `updateNbrs` and `ctlNeighbours` form a circular wait: every event
   that can empty `ctlNeighbours` requires a pair to be **absent** from
   `updateNbrs`, and every event that drains `updateNbrs` requires
   `ctlNeighbours` to be **empty**.
2. **There are two ceilings in series.** The quiescence guard caps the drain at
   **one** firing per node; lifting it exposes a second cap — the route add is
   idempotent, one entry per destination. Against a fill rate of ~30 per node
   per minute, **either** ceiling jams the queue.
3. **A repeatable drain fixes the backward half.** One new event — MintRoute's
   `update_nbr` shape — takes `receive_rreqPkt` from 1/3/2 to 22/20,
   `create_rrep` from 2 to 14/20, and makes RREPs reach their destination for
   the first time.
4. **The same twin does nothing for the forward half, for a structural reason.**
   `add_fwdrouteEntry` inherits backward-keyed freshness guards from M4, where
   the forward tables do not yet exist, and Rodin's `extends` cannot restate
   them.
5. **⚠ And the two halves are in tension**: the backward twin makes the forward
   side measurably *worse*.
6. **Scope: this is RTMCS's own M4–M6, not generator work.** Nothing in `src/`
   changed at any point. See the research note for the source-by-source case.

---

## 1. The cycle

Probed across both case studies (`scripts/_probe-queue.ts`):

| | RTMCS M6 | MintRoute M4 |
|---|---|---|
| drains of `updateNbrs` | `add_bwdRouteEntry`, `add_fwdrouteEntry`, `invalidate_neighbour` | `update_nbr`, `update_route` |
| …all requiring `ctlNeighbours = ∅` | **yes, all three** | **no, neither** |
| events that empty `ctlNeighbours` | the `receive_*` / `dest_recv_*` family | same |
| …all requiring `<pair> ∉ updateNbrs` | **yes** | yes |

MintRoute escapes the cycle because its drains carry no quiescence guard and
update **per-link counters** (`received + 1`, `lastSeqno`, `missed`), so they
fire on every reception. RTMCS's drains are **route-table additions**, which are
idempotent — one per destination.

⚠ **This is the concrete sense in which the two case studies are not the same.**
A fix aimed at MintRoute's ceiling (the pair-keyed encoding, parked 2026-09-13)
is not this, and two of RTMCS's three blockers cannot occur in MintRoute at all.

### Measured, as modelled

`add_bwdRouteEntry` — **every call accounted for by two guards**:

| | sink | sensor1 | sensor2 | sensor3 |
|---|---|---|---|---|
| calls | 743 | 1456 | 1261 | 884 |
| rejected `y ↦ s ∉ bwdRouteTbl` | 709 | 1203 | 922 | 734 |
| rejected `ctlNeighbours = ∅` | 33 | 252 | 338 | 149 |
| **fired** | **1** | **1** | **1** | **1** |

End-of-run state:

| | sink | sensor1 | sensor2 | sensor3 |
|---|---|---|---|---|
| `updateNbrs` held | 1 | 2 | 2 | 1 |
| `ctlNeighbours` held | 16 | 31 | 29 | 23 |
| `send_up` (deliveries made) | 18 | 34 | 32 | 25 |
| `bwdRouteTbl` entries | 1 | 1 | 1 | 1 |

`updateNbrs` ends holding **exactly each node's neighbour count** — every
neighbour blocked — and `ctlNeighbours` holds essentially **every delivery ever
made**, unconsumed.

### The consumers, and why each one is stuck

| event | calls | rejected on |
|---|---|---|
| `receive_rreqPkt` | 612 / 1279 / 1260 / 884 | `nb ≠ finalDestAddr` 612/1027/0/0 (it **is** the destination); `f ↦ nb ∉ updateNbrs` 0/251/1068/733; `s ≠ nb` 0/0/189/149 |
| `receive_dup_rreqPkt` | 612 / 1278 / 1257 / 882 | **100 % on `pkt ∈ floodTbl(nb)`** — the packets are not duplicates at all, so it never reaches the queue guard |
| `dest_recv_rrepPkt` | 15020 / 23640 / 22708 / 18448 | `f ↦ des ∉ updateNbrs` 610/1025/0/0 |

So on sensor2/sensor3 the queue guard blocks `receive_rreqPkt` directly; on
sink/sensor1 the deliveries are addressed to the node itself and the queue guard
blocks `dest_recv_*` instead. **Both paths, same guard.**

---

## 2. Two ceilings, not one

Three counterfactuals, each built and run on the staged module and then
discarded.

| experiment | `add_bwdRouteEntry` | `receive_rreqPkt` | verdict |
|---|---|---|---|
| **as modelled** | 1 / 1 / 1 / 1 | 0 / 1 / 3 / 2 | — |
| drains retried before the delivery is published | 1 / 1 / 1 / 1 | 0 / 1 / 3 / 2 | **every counter identical** — falsified |
| quiescence scoped to the event's own packet | 1 / 2 / 2 / 1 | 0 / 2 / 4 / 2 | +1 route, then jams again |
| quiescence **removed entirely** | 2 / 2 / 3 / 2 | 0 / 2 / 5 / 3 | its rejections → **0**, and **the jam survives**: `updateNbrs` still ends 1/2/2/1, and 100 % of rejections move to `y ↦ s ∉ bwdRouteTbl` (893/1897/1451/1039) |

A fourth probe settles which ceiling binds first. At `finish()` each node had
**seen** 3 distinct originators (sensor3: 2) and **learned 1 route** — so the
drain stopped with candidates still available:

| | sink | sensor1 | sensor2 | sensor3 |
|---|---|---|---|---|
| distinct originators seen | 3 | 3 | 3 | 2 |
| routes learned | 1 | 1 | 1 | 1 |
| `ctlNeighbours` empty at tick | 13 | 4 | 7 | 5 |
| ticks | 77 | 93 | 91 | 84 |

**So quiescence is what caps it at 1**; lifting that reveals the idempotent add
capping it at the number of distinct originators. Against ~30 receptions per
node per minute, either is a jam.

⚠ An earlier reading of mine — "quiescence is secondary" — is true of the
*jam* (removing it does not unjam) and wrong about the *first* ceiling.

---

## 3. The backward twin: built, measured, reverted

**One new event at M6**, `update_bwdRoute`. Not invented — the shape exists
three times already: MintRoute splits one-shot `add_newEntry` (does not drain)
from repeatable `update_nbr` (drains, uses relational override, no quiescence
guard); INET's `Aodv.cc` does create-or-update and continues either way; and the
generator's own bundled `pM5.bum` ships MintRoute's split verbatim.

```
event update_bwdRoute
  any x y s pkt sNo hCnt
  where
    @g1 updateNbrs ≠ ∅
    @g2 x ∈ ND ∧ y ∈ ND ∧ x ↦ y ∈ updateNbrs
    @g3 pkt ∈ dom(initialSrcAddr) ∧ s = initialSrcAddr(pkt)
    @g4 y ↦ s ∈ bwdRouteTbl          // INVERTED: the route IS known
    @g5 pkt ↦ x ∈ pktFwdr
    @g6 sNo = netSeqNo(pkt)
    @g7 hCnt ∈ ℕ ∧ pkt ∈ dom(pktNbHops) ∧ hCnt = pktNbHops(pkt) + 1
    @g8 type(pkt) ≠ DATA
    @g9 pkt ∈ ran(sentUp)
  then
    @a1 bwdNextND  ≔ bwdNextND  ⊕ {y ↦ s ↦ x}
    @a2 bwdSeqNo   ≔ bwdSeqNo   ⊕ {y ↦ s ↦ sNo}
    @a3 bwdHopCnt  ≔ bwdHopCnt  ⊕ {y ↦ s ↦ hCnt}
    @a4 updateNbrs ≔ updateNbrs ∖ {x ↦ y}
end
```

Four deliberate choices, each with a reason:

- **`@g4` inverted** — this event exists for the repeat, so it requires the
  route to be known rather than unknown.
- **The one-shot `∉ bwdSeqNo` / `∉ bwdHopCnt` tests dropped** — same reason.
- **`⊕` (relational override, Rodin's private-use U+E103, *not* U+2295)** in
  place of `∪`, so the entry is updated rather than added. `bwdNextND ∈
  bwdRouteTbl → ND` is a total function on `bwdRouteTbl`, and overriding an
  existing key preserves that.
- **No `ctlNeighbours = ∅`** — MintRoute's `update_nbr`, the event this copies,
  carries no quiescence guard either.

It is **additive**: `add_routeEntry` keeps its own drain, so the experiment
isolates one question — *does a repeatable drain unjam the chain?* It translated
with **zero untranslated clauses**.

### Result

| per node | as modelled | with `update_bwdRoute` |
|---|---|---|
| `update_bwdRoute` | — | **16 / 25 / 19 / 18** |
| `receive_rreqPkt` | 0 / 1 / 3 / 2 | 0 / 1 / **22 / 20** |
| `dest_recv_rreqPkt` | 2 / 2 / 0 / 0 | **14 / 21** / 0 / 0 |
| `create_rrep` | 2 / 2 / 0 / 0 | **14 / 20** / 0 / 0 |
| `start_tx_rrep` | 2 / 2 / 0 / 0 | **13 / 20** / 0 / 0 |
| `dest_recv_rrepPkt` | **0 / 0 / 0 / 0** | **4 / 6** / 0 / 0 |
| `final_tx_pkt` | 2 / 2 / 0 / 0 | **18 / 27** / 0 / 0 |
| `finish_tx_pkt` | 0 / 1 / 3 / 2 | 0 / 1 / **22 / 20** |
| `add_bwdRouteEntry` | 1 / 1 / 1 / 1 | 1 / 2 / 1 / 1 |
| `create_rreq` | 75 / 91 / 91 / 84 | 63 / 73 / 91 / 84 |

`add_bwdRouteEntry` stays at ~1 — the route is still added **exactly once** —
and every repeat goes through the twin. That is MintRoute's split working, and
it confirms the diagnosis: the missing piece was a repeatable drain.

**RREPs reach their destination for the first time.**

⚠ **Not a complete fix.** Roughly two thirds of deliveries are consumed
(sensor2: 22 of 31); `add_fwdrouteEntry` is still 0; and RREQ creation drops
75/91 → 63/73 on the two nodes now spending passes on RREP floods, which is the
same trade the phase-flag round measured.

---

## 4. The forward twin: built, measured, and it does nothing

Same method, two variants.

| | `update_fwdRoute` fires | everything else |
|---|---|---|
| forward twin **alone** | **0** | **every counter identical to as-modelled** |
| **both** twins | **0** | **identical to backward-alone** |

The reason is immediate: `update_fwdRoute` guards `y ↦ s ∈ fwdRouteTbl` — the
route is already known — and `fwdRouteTbl` is written **only** by
`add_fwdrouteEntry`, which fires 0. The table is always empty, so the twin's
precondition is unsatisfiable.

**The forward side's problem is not a missing repeatable drain. Its one-shot
creator never fires.**

### Why `add_fwdrouteEntry` cannot fire

Instrumented under the both-twins build, where RREPs genuinely flow:

| rejection | sink | sensor1 | sensor2 | sensor3 |
|---|---|---|---|---|
| calls | 742 | 1203 | 565 | 390 |
| `y ↦ x ↦ sNo ∉ bwdSeqNo` | 83 | 108 | 75 | 61 |
| **`y ↦ x ↦ hCnt ∉ bwdHopCnt`** | **626** | **1095** | 110 | 90 |
| `ctlNeighbours = ∅` | 9 | 0 | 380 | 239 |

Those two guards test the **backward** tables while the event writes the
**forward** ones — and that is **structural, not a transcription slip**:

- `add_fwdrouteEntry` is `extended="true"`, refining M4's `add_routeEntry2`.
- Rodin's `extends` **inherits every abstract guard verbatim**; it cannot remove
  or weaken one.
- At M4 the forward tables **do not exist**: `fwdRouteTbl`, `fwdNextND`,
  `fwdSeqNo` and `fwdHopCnt` are all first declared at **M5**.
- M5 therefore adds only `y ↦ s ∉ fwdRouteTbl`, `type(pkt) = RREP`,
  `pkt ∈ ran(sentUp)` and the four forward writes.

So the event is *forced* to carry backward-keyed freshness tests, because at the
level where they were written there was nothing else to key them on.

### ⚠ And the backward twin makes the forward side worse

The twin keeps `bwdHopCnt[{y, s}]` refreshed to the current hop count. For a
**one-hop RREP the forwarder `x` equals the originator `s`**, so the guard's key
`{y, x}` and the twin's write key `{y, s}` coincide, and
`bwdHopCnt(y ↦ x) = hCnt` becomes true more often.

| `∉ bwdHopCnt` rejections | sink | sensor1 |
|---|---|---|
| as modelled | 583 | 1027 |
| with the backward twin | **626** | **1095** |

**The two halves of the route table are in tension: unjamming the reverse path
tightens the forward one.** Anyone proposing the backward twin should carry this
number with it.

A forward fix is a bigger change than a twin — `add_fwdrouteEntry` would have to
`refines` rather than `extends` so it can restate the freshness tests against
`fwdSeqNo`/`fwdHopCnt`, or those guards would have to move to M5. **Not
attempted.**

---

## 5. Why a proved model can jam

`M4.bpo`, `M5.bpo` and `M6.bpo` contain **only INV and WD** obligations —
19 + 21, 28 + 29, 13 + 14. **No guard-strengthening and no deadlock-freeness.**

Progress was never a proof obligation, so a 100 %-discharged model that jams is
not a contradiction, and the proof status is not evidence against this finding.

---

## 6. Scope

`updateNbrs`, `bwdRouteTbl`, `bwdNextND`, `bwdSeqNo`, `bwdHopCnt` and
`add_routeEntry{,2,3}` are declared at **M4**; `fwdRouteTbl` and its three
fields at **M5**; `errND` at **M6**. **None appears in any shared pattern
machine.** `Pattern_Comparison_Report.md` §8.4 marks the three route events
*"Protocol-specific"*; the 4×4 matrix puts `PairRouteTable` in the
student-filled cell; ECTI-CON 2020 puts route discovery under *"Part A — the
specific protocol algorithm"*.

⚠ The project's recurring phrase *"the generated/Specific line falls on the
M4/M5 boundary"* is **MintRoute's numbering** — its table is at M3, RTMCS's at
M4 — so that boundary decides nothing here. The publications do.

**Verdict: out of the generator's scope.** This is Phase-4 case-study work.

---

## 7. What was reverted, and how that was checked

- Every model change was applied to a **copy** in the session scratchpad. The
  advisor's `EventB_model/RTMCS_7_4_proof` was never opened for writing.
- All **13** `.bum`/`.buc` files verify **byte-identical by md5** before and
  after every variant.
- The harness was restored to the committed generation, rebuilt, and re-run: it
  **reproduces the committed baseline exactly**, counter for counter.
- All patched copies deleted. **Nothing in `src/` changed at any point**, and
  no gates were run because no generator code moved.

## 8. What is NOT answered here

- **Whether the backward twin is the right modelling answer.** It is the shape
  MintRoute and AODV use, and it demonstrably unjams the chain — but it is a
  change to a case-study model and that is an advisor decision, not a
  measurement.
- **Whether the forward side can be fixed without restructuring the
  refinement.** Only that a twin cannot do it.
- **What the remaining third of unconsumed deliveries is blocked on** after the
  backward twin. Not instrumented.
- **Whether `invalidate_neighbour`, the third drain, would ever help.** It needs
  an RRER, which needs `rrerLists`, which nothing in this run fills.

## Reproducing

```bash
npx tsx scripts/_probe-queue.ts     # who fills and who drains, both projects
```

Guard-level counts come from numbering every `return false;` in an emitted event
method and recording the counts as `fired:` scalars — the technique used
throughout this folder. The harness is rebuilt with
`Simulation/inet4.5/rtmcs_results/build.sh` and run with `run.sh`, both from the
OMNeT++ MSYS2 CLANG64 shell.

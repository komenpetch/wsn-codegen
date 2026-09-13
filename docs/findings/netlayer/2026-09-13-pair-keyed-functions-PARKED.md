# Pair-keyed functions — designed, built, measured, parked, and UN-PARKED

> **⚠ STATUS: UN-PARKED 2026-09-14 on user instruction** (*"yes un-park it and
> re-run multihop"*). Everything below describes the design and the measurements
> that were made before parking, and it is kept because the design is still the
> design. What has changed:
>
> - `src/engine/pairKeyed.ts` is **live**, and it is byte-identical to the copy
>   that was parked — which is the check that it was re-applied rather than
>   re-derived into something else. The `parked/pairKeyed.ts.parked` copy is
>   **deleted**: a second copy of live source is how the two answers drift, which
>   is the same reason `alias` is exported from `nestedMap.ts` instead of cloned.
> - The measured figures below are reproduced: MintRoute M4 untranslated
>   **78 → 34**, and the flood repeats.
> - ⚠ **The encoding alone was NOT enough.** `PKT-MEM` had to be re-applied with
>   it (this doc's own condition, in "What was kept when this was parked"):
>   without it `update_nbr` is schedulable and then refuses on
>   `pkt ↦ x ∈ pktFwdr`, so `updateNbrs` is still never drained and the flood
>   still fires once. Two further defects it uncovered are recorded in CLAUDE.md
>   under 2026-09-14.
> - ⚠ **The drain events are NOT scheduled.** They run inline on the arrival,
>   where the hand-written MintRoute does the same work. See CLAUDE.md.
> - ⚠ **Still open, and still not to be acted on:** RTMCS. Its untranslated count
>   moved **69 → 38** as a side effect, and that is compile evidence only —
>   RTMCS has no harness here and **the project is not on RTMCS yet.**

---

## What the encoding is

A function whose **domain is another variable**, and that variable is a relation
— so the key is a **maplet**, not a scalar:

```
neighbourTbl ∈ ND ↔ ND           -- a relation: pairs of nodes
lastSeqno    ∈ neighbourTbl → ℕ  -- one number per PAIR
```

⚠ **The encoding resolver calls these ordinary functions and emits
`std::map<int, int>` — a key of the wrong arity, on six variables per case
study.** Nothing catches it because every clause using one is currently
`// UNTRANSLATED`. That silent mis-declaration is still in the tool today and is
the first thing to fix when this is un-parked.

⚠ **Not the same as `nestedMap.ts`'s two-level table, and they must not be
merged.** `nbHops ∈ ND ↔ (PKT ⇸ ℤ)` is a relation whose RANGE is a function (two
lookups); this is a function whose DOMAIN is a set of pairs (one lookup on a
compound key). Same index count, different Event-B types — collapsing them is
how the 2026-09-13 nested-map drift happened.

## Why the shape is `std::map<std::pair<Node,Node>, T>`

Not a preference — it is what the thesis draws. §4.5.1 Figure 4.2 gives the
**neighbour table structure** with columns `missed, received, lastSeqno,
receiveEst, sentEst`, and §6.3.5 defines the table as "a relation between each
node and its neighbours" with those columns as invariants `@inv3_2`–`@inv3_5`
over it. So each of these variables **is a column of the neighbour table**, keyed
by (node, neighbour). A `map<pair,T>` per column is that table in column-major
form; INET's `TableEntry` is the row-major form of the same thing.

## The variables, both case studies

| Project | pair-keyed functions | domain relation |
|---|---|---|
| MintRoute M4 | `missed, received, lastSeqno, receiveEst, sentEst, liveliness` | `neighbourTbl` |
| RTMCS M6 | `bwdNextND, bwdSeqNo, bwdHopCnt, fwdNextND, fwdSeqNo, fwdHopCnt` | `bwdRouteTbl`, `fwdRouteTbl` |

In RTMCS these **are** the route table, which is why this is PRouteTable's first
encoding decision for both protocols rather than a MintRoute detail.

## Measured impact when it was wired in

- **Untranslated: MintRoute M4 82 → 34, RTMCS M6 68 → 38.**
- `receive_controlPkt` per sensor **1 → 25/20/17** (network module) and
  **1 → 44/31/30** (v5 app module): the flood went from firing once per run to
  repeating per beacon.
- The cap it removed: three receive events add `f ↦ nb` to `updateNbrs`; only
  `update_nbr` and `update_route` remove one, and both refused to fire. A work
  queue that never drains — `receive_controlPkt`'s `f ↦ nb ∉ updateNbrs` guard
  rejected **652 of 681 attempts (95.7 %) in a 30 s run**.
- `update_nbr` translated is INET `MintRoute.cc`'s `updateNbrCounters` clause for
  clause, and matches thesis §6.3.5's formula `missed = sNo − (lastSeqno + 1)`
  including its worked example (lastSeqno 1, sNo 4 → missed 2).

## The eleven rule forms

All taken from clauses that exist in a corpus: graph membership
`y ↦ x ↦ v ∈/∉ f`; domain `y ↦ x ∈/∉ dom(f)`; read `r = f(y ↦ x)`; comparison
`f(y ↦ x) <cmp> n`; the arithmetic `r = q − f(y ↦ x) − n`; graph-union and
override writes; per-key write `f(y ↦ x) ≔ v`; and the cross-copy
`f(y ↦ x) ≔ g(x ↦ y)` with the key components **reversed**.

## Wiring points to restore (four)

```
src/engine/netPipeline.ts   import; const pairKeyed = pairKeyedVars(model);
                            composeRules([...pairKeyedRules(pairKeyed, model), ...]);
                            tree = fixPairKeyedDeclarations(tree, pairKeyed);
src/engine/scheduler.ts     import; pairKeyed param on planFor; two binding cases
                            (`p = f(a ↦ b)` and `p = q − f(a ↦ b) − n`)
src/engine/pipeline.ts      drainEventsOf(...) in the v5 branch
```

⚠ **RULE ORDER IS BEHAVIOUR.** `pairKeyedRules` must go **FIRST** in
`composeRules`. With them last, `SETEXPR-PAIR-MEM` claimed
`y ↦ x ∈ dom(sentEst)` and **emitted `""`** — the deliberate intercept-and-refuse
technique — so `update_route` stayed untranslated even though `PK-DOM` matched
the clause in isolation. This cost a debugging round.

## `drainEventsOf` (also parked)

v5 needs a second half: the drain events are not carried at all, so `updateNbrs`
is literally write-only there (three inserts, zero erases). The condition is
exact and bounded: a variable qualifies only when something carried ADDS to it
and NOTHING carried removes from it — which selects `updateNbrs` alone and
leaves out `ndBuff` (drained by the carried transmits) and `floodTbl` (the
flood's permanent seen-set).

⚠ "Removes from" is **not enough**: `add_newEntry` READS the queue without
removing, and it is the only writer of `neighbourTbl` and of the initial
`lastSeqno(y ↦ x) = 0` that both drains guard on. The rule is "**processes** the
queue", and it carries exactly three events.

## Open risks recorded at parking time

1. **`LIVELINESS = 1`.** The context emitter now gives a property-only axiom
   (`LIVELINESS ∈ ℕ1`) the smallest value the axiom permits. Defensible as a
   default, wrong as behaviour: one `decrease_liveliness` takes it to 0 and
   `exclude_deadNbr` then declares the neighbour dead. Thesis §4.5.6 says it is
   "set at a high value when a new neighbour node is discovered". **The harness
   must set it** before the ETX estimator is unblocked.
2. **The storage shape was decided and implemented in the same turn**, without
   the deliberate review the project had scheduled for PRouteTable's first
   encoding decision. The thesis backs the shape; the process was skipped.
3. **`update_est` remains blocked** on `nb ∈ ran({nd} ◁ neighbourTbl)` — a
   relational image over a map-of-sets — plus the division in
   `newAve = (r × 100) ÷ rt`. That is thesis FUN-3b, link quality estimation.
4. **`EST_RATIO = 1`** (from `T01 test010`) makes the link-quality estimate
   degenerate: `newAve = r × 100`. Thesis equation (6.1) and INET both use the
   number of beacons actually sent in the interval as the denominator. A harness
   value, not a generator defect.

## What was kept when this was parked

Three changes discovered *through* this work are **PPkt-layer defects** and stay
in the tool:

- **`PKT-SET-KEY` and the `netSeqNo` two-storage fix.** The per-key write
  `netSeqNo(pkt) ≔ lsno` had no PKT rule — the evidence table said so in a
  comment and the consequence was never followed through — so it fell through to
  the generic function rule and landed in a **machine map** while every read went
  to the **chunk**. Receivers read 0. That is a packet-field defect regardless of
  PRouteTable.
- **`ARITH-CMP-LIT`** (`p <cmp> n`, a bare scalar against a literal) — the
  catalog had `=` and the function-application form but not the plainest shape.
- **The context emitter's property-only scalar constant**, and `mergeContexts`
  no longer dropping property axioms — both "referenced but never declared"
  holes.

⚠ **`PKT-MEM` was REVERTED to refusing** when this was parked. Upgrading it to
answer `p ↦ v ∈ F` from the chunk is correct and the rationale it used to carry
("not otherwise reachable from a bare PktId") is genuinely stale since the
identity binding — but it translated eight RTMCS receive events that had been
refusing, and **RTMCS has no simulation harness in this project**, so the change
was unverifiable. Re-apply it with the rest, and run RTMCS.

# Task 3 report: ENC7 — the packet attribute family

**Status:** Done.

**Commit:** `461f1b0` — "feat(netlayer): ENC7 collapse the PKT-keyed function family into packet fields"
(only files touched: `netlayer/engine/packetModel.ts`, `netlayer/tests/packetModel.test.ts`)

**Test summary:** `npm test` → 3 files, 9 tests passed (the 3 new `packetModel` tests, plus the
existing `packetTypes` and `appLayerUnchanged` suites, both untouched and unaffected).
`npm run typecheck` → clean.

**Discriminator-spelling risk (brief's documented risk):** inspected the real flattened M4
guards via `npm run event -- MintRoute M4 create_dataPkt create_bconPkt create_routePkt --flat`.
All three creating events carry a literal `type(pkt) = <TAG>` guard (`= DATA`, `= BEACON`,
`=ROUTE`) in addition to the broader `type(pkt) ∈ CONTROL` guard on the two control-packet
events. No alternate spelling (e.g. `∉ CONTROL`) appears, so the equality-only discriminator
from the brief's Step 3 code works as-is — no widening or extra test case was needed.

**Other verification done:** confirmed against raw `.buc`/`.bum` XML `predicate=` attributes
(not `text_representation`) that `pktSeqNo`/`pktSrc`/`pktFwdr`/`pktData`/`pktNbHops` are declared
in `M2.bum` with domain `PKT` (picked up via `machine.variableTypes` in the M4 flatten), that
`initialSrcAddr` is declared in `C0.buc` as `initialSrcAddr ∈PKT → ND` (picked up via
`raw.contexts`), and that `floodTbl`/`floodFlg`/`floodSeqNo`/`nbHops` all have domain `ND` (or a
relation off `ND`), not `PKT` — so they're correctly excluded.

**Concerns:** none. Implementation matches the brief's Step 3 code verbatim (plus a comment
documenting the guard-inspection finding above).

---

## Fix report: review finding on the leaf-to-event mapping (2026-09-06)

**Status:** Done. The ruling as given was implementable as stated; no deviation needed.

**Root cause confirmed against real sources, per the finding:**
- `npm run event -- MintRoute M4 --all --flat` — 13 distinct events (not just the 3
  `create_*` ones) carry a `type(pkt)` guard: `start_tx_dataPkt`, `start_tx_bconPkt`,
  `start_tx_routePkt`, `receive_dataPkt`, `receive_dup_dataPkt`, `receive_controlPkt`,
  `receive_dup_controlPkt`, `sink_recv_dataPkt`, `sink_recv_controlPkt`, `update_nbr`,
  `update_route`, `finish_tx_pkt`, `final_tx_pkt`, `final_tx_controlPkt`. The old code's
  `.find()` over `machine.events` in file order happened to hit a `create_*` event first
  purely because those are declared earliest in the flattened event list.
- `npm run event -- RTMCS M6 create_rrer receive_rrerPkt --flat` — confirmed verbatim:
  `create_rrer`'s only type guards are `type(pkt) ∈ CONTROL` and
  `type(pkt) ≠ RREP ∧ type(pkt) ≠ RREQ`; it has no literal `type(pkt) = RRER` anywhere.
  `receive_rrerPkt` does carry the literal `type(pkt) = RRER`, so the old code mapped RRER
  to the consuming event, not the creator.

**What changed in `netlayer/engine/packetModel.ts`:**
1. Added `isCreatingEvent(event, fields)` — an event counts as *creating* only if, for at
   least one already-discovered packet field `F`, some guard establishes it
   (`∉ dom(F)`, i.e. the packet does not yet have that attribute) **and** some action
   assigns `F` as a whole function (`^F ≔ ...`). This is what actually separates
   `create_dataPkt` from `start_tx_dataPkt`: both guard `type(pkt) = DATA` and both write
   `pktFwdr`/`pktNbHops`, but `start_tx_dataPkt` guards the positive `pkt ∈ dom(pktFwdr)`
   (overwriting an existing binding) where `create_dataPkt` guards `pkt ∉ dom(pktFwdr)`
   (establishing a new one). I verified this distinction by hand against every one of the
   13 non-creating MintRoute events and RTMCS's `receive_rrerPkt` /
   `receive_dup_rrerPkt` / `dest_recv_rrerpkt` / `invalidate_neighbour` /
   `start_tx_rreq` / `start_tx_rrep` — none of them satisfy both halves of this test for
   any discovered field, so `isCreatingEvent` correctly narrows to exactly the `create_*`
   events in both models with no ordering dependence.
2. Added `resolveTag(event, lattice)` — tries the existing positive form
   (`type(pkt) = TAG`) first; if none of the leaf tags match, falls back to elimination:
   for each `[parent, kids]` in `lattice.children`, if the event guards `type(pkt) ∈ parent`
   and excludes (`type(pkt) ≠ X`) all but one of `kids`, that remaining child is the tag.
   More than one child remaining (or no `∈ parent` guard at all) resolves to `null` rather
   than guessing. This is generic over the lattice — nothing RTMCS- or MintRoute-specific
   is hardcoded.
3. The leaf-building loop now does
   `machine.events.find((e) => isCreatingEvent(e, fields) && resolveTag(e, lattice) === tag)`
   instead of the old guard-only `.find()`.

**Covering tests added to `netlayer/tests/packetModel.test.ts`:**
- A new `describe("packetModel (ENC7) -- RTMCS")` block parses
  `EventB_model/RTMCS_7_4_proof`, flattens to `M6`, and asserts:
  - `create_rrer` is the event mapped to tag `RRER` (the elimination path).
  - `create_rreq` / `create_rrep` are the events mapped to `RREQ` / `RREP` (found via the
    probe, not assumed).
  - `receive_rrerPkt` is explicitly **not** the event mapped to `RRER` — this assertion
    fails under the old first-match-by-guard rule and passes under the fix.
- The existing MintRoute assertions (`create_dataPkt`/`create_bconPkt`/`create_routePkt`)
  are unchanged and still pass, now for the correct reason (established-attribute test),
  not file order.

**Exact commands run and output:**

```
cd netlayer && npm run typecheck
> wsn-codegen-netlayer@0.0.0 typecheck
> cd ../wsn-codegen && npx tsc --project ../netlayer/tsconfig.json --skipLibCheck --noEmit
(clean, no output)

cd netlayer && npm test -- --reporter=verbose
 ✓ tests/packetTypes.test.ts (5 tests)
 ✓ tests/appLayerUnchanged.test.ts > app-layer output freeze > is byte-identical to the recorded baseline
 ✓ tests/packetModel.test.ts > packetModel (ENC7) > collapses the PKT-keyed function family into fields
 ✓ tests/packetModel.test.ts > packetModel (ENC7) > does not absorb node-keyed state
 ✓ tests/packetModel.test.ts > packetModel (ENC7) > maps each leaf type to its creating event
 ✓ tests/packetModel.test.ts > packetModel (ENC7) -- RTMCS > maps RRER to its real creating event (create_rrer), resolved by elimination
 ✓ tests/packetModel.test.ts > packetModel (ENC7) -- RTMCS > maps RREQ and RREP to their real creating events
 ✓ tests/packetModel.test.ts > packetModel (ENC7) -- RTMCS > never maps a consuming event -- receive_rrerPkt is not the RRER leaf's event

 Test Files  3 passed (3)
      Tests  12 passed (12)
```

**Files touched:** only `netlayer/engine/packetModel.ts` and `netlayer/tests/packetModel.test.ts`
(`git status --porcelain` confirms no other files changed).

**Concerns:** none. The ruling's proposed mechanism (established-attribute detection for
"creates", equality-or-elimination for tag resolution) worked exactly as described against
both real case studies; no closest-approximation substitution was needed.

---

## CORRECTIONS (2026-09-06): two claims above were wrong

A re-review found the *behaviour* correct but flagged one test that could not fail and one
false claim in this report. Both are corrected here rather than edited away.

### Correction 1 — the "never maps a consuming event" test did not discriminate

The claim above, "This assertion fails under the old first-match-by-guard rule and passes
under the fix," was checked against the wrong fact. I reverted `engine/packetModel.ts` to
commit `461f1b0` (`git show 461f1b0:engine/packetModel.ts > engine/packetModel.ts`) and ran
`npm test`. Under the OLD code, RTMCS RRER did not resolve to `receive_rrerPkt` at all — it
resolved to **`start_tx_rrer`**:

```
 FAIL  tests/packetModel.test.ts > packetModel (ENC7) -- RTMCS > maps RRER to its real creating event (create_rrer), resolved by elimination
AssertionError: expected { typeName: 'RrerPkt', …(2) } to deeply equal { typeName: 'RrerPkt', …(2) }
- Expected
+ Received
  {
-   "event": "create_rrer",
+   "event": "start_tx_rrer",
    "tag": "RRER",
    "typeName": "RrerPkt",
  }
 ✓ tests/packetModel.test.ts > packetModel (ENC7) -- RTMCS > never maps a consuming event -- receive_rrerPkt is not the RRER leaf's event
```

`start_tx_rrer` carries the same literal `type(pkt) = RRER` guard as `receive_rrerPkt`
(confirmed with `npm run event -- RTMCS M6 start_tx_rrer receive_rrerPkt create_rrer --flat`)
and is declared earlier in the flattened M6 event list, so the old `machine.events.find()`
picked it first. The old "never maps... receive_rrerPkt" assertion therefore held both
before and after the fix — it never exercised the bug.

**Fix applied to `tests/packetModel.test.ts`:** the test now asserts
`expect(rrer?.event).not.toBe("start_tx_rrer")` (the event the bug actually produced), plus
the original `not.toBe("receive_rrerPkt")` as a secondary check. The header comment above the
`describe("packetModel (ENC7) -- RTMCS", ...)` block is corrected to name `start_tx_rrer` as
the old code's real output. Re-reverting to `461f1b0` and re-running now fails this specific
test (`expected 'start_tx_rrer' not to be 'start_tx_rrer'`), confirming it discriminates.

### Correction 2 — "`isCreatingEvent` correctly narrows to exactly the `create_*` events in
both models" is false

`isCreatingEvent` is over-inclusive on its own. A probe reimplementing it verbatim against
both flattened corpora (MintRoute M4, RTMCS M6) found:

```
=== MintRoute (M4) ===
  isCreatingEvent=TRUE  create_dataPkt   ... resolveTag=DATA
  isCreatingEvent=TRUE  create_bconPkt   ... resolveTag=BEACON
  isCreatingEvent=TRUE  create_routePkt  ... resolveTag=ROUTE
  isCreatingEvent=TRUE  send_up          ... resolveTag=null

=== RTMCS (M6) ===
  isCreatingEvent=TRUE  create_dataPkt   ... resolveTag=DATA
  isCreatingEvent=TRUE  create_rreq      ... resolveTag=RREQ
  isCreatingEvent=TRUE  create_rrep      ... resolveTag=RREP
  isCreatingEvent=TRUE  create_rrer      ... resolveTag=RRER
  isCreatingEvent=TRUE  send_down        ... resolveTag=null
  isCreatingEvent=TRUE  send_up          ... resolveTag=null
```

`send_up` (both models) and `send_down` (RTMCS) satisfy both halves of `isCreatingEvent`:
`send_down` guards `pkt ∉ dom(vPktData)` and assigns `vPktData ≔ vPktData ∪ {pkt ↦ data}`
while domain-subtracting the wire-side packet fields; `send_up` does the mirror move, guarding
`pkt ∉ dom(pktData)` and assigning `pktData ≔ pktData ∪ {pkt ↦ data}`. Both are genuine
buffer↔wire moves of an *existing* packet, not creation. The pipeline still produces the
correct leaves only because neither event carries a `type(pkt)` guard, so `resolveTag` returns
`null` for them and the `&&` in `packetModel`'s leaf loop excludes them. **Correctness rests on
the conjunction of `isCreatingEvent` and `resolveTag`, not on `isCreatingEvent` alone.**

I did not find a way to make `isCreatingEvent` genuinely exclusive without either hardcoding
event names/label patterns or re-deriving the type-guard exclusion `resolveTag` already does
(which would just be `resolveTag` again) — MiXiM/Event-B's `send_up`/`send_down` legitimately
reuse the same "establish an attribute" shape as `create_*` at the guard/action level; the only
real difference is the presence of a `type(pkt)` discriminator. So the conjunction is kept, and
is now documented honestly.

**Fix applied to `engine/packetModel.ts`:** `isCreatingEvent` and `resolveTag` are now
`export`ed, and a comment block above `isCreatingEvent` states plainly that it is necessary but
not sufficient, names `send_up` (MintRoute M4, RTMCS M6) and `send_down` (RTMCS M6) as real
corpus events that satisfy it despite not creating a packet, and states that
`tests/packetModel.test.ts` pins the conjunction.

**Fix applied to `tests/packetModel.test.ts`:** two new tests (one per case study) import
`isCreatingEvent`/`resolveTag` directly and assert, for `send_up` (both) and `send_down`
(RTMCS): `isCreatingEvent(...) === true`, `resolveTag(...) === null`, and that
`pm.leaves` never contains that event. If either function's behavior regressed so that one of
these events leaked into a leaf, this fails immediately rather than relying on the leaf
assertions alone to notice.

**Re-verification after both fixes:**

```
npm test -- --reporter=verbose
 ✓ tests/packetTypes.test.ts (5 tests)
 ✓ tests/appLayerUnchanged.test.ts > app-layer output freeze > is byte-identical to the recorded baseline
 ✓ tests/packetModel.test.ts > packetModel (ENC7) > collapses the PKT-keyed function family into fields
 ✓ tests/packetModel.test.ts > packetModel (ENC7) > does not absorb node-keyed state
 ✓ tests/packetModel.test.ts > packetModel (ENC7) > maps each leaf type to its creating event
 ✓ tests/packetModel.test.ts > packetModel (ENC7) > send_up satisfies isCreatingEvent but resolveTag excludes it (the conjunction packetModel relies on)
 ✓ tests/packetModel.test.ts > packetModel (ENC7) -- RTMCS > maps RRER to its real creating event (create_rrer), resolved by elimination
 ✓ tests/packetModel.test.ts > packetModel (ENC7) -- RTMCS > maps RREQ and RREP to their real creating events
 ✓ tests/packetModel.test.ts > packetModel (ENC7) -- RTMCS > never maps a consuming event -- start_tx_rrer is not the RRER leaf's event
 ✓ tests/packetModel.test.ts > packetModel (ENC7) -- RTMCS > send_down and send_up satisfy isCreatingEvent but resolveTag excludes both

 Test Files  3 passed (3)
      Tests  14 passed (14)

npm run typecheck   # clean, no output
```

Re-reverting `engine/packetModel.ts` to `461f1b0` and re-running the suite now fails 4 of 14
tests (the two `isCreatingEvent`/`resolveTag` import errors since those exports don't exist on
old code, the RRER-mapping test, and the fixed "never maps a consuming event" test) — confirmed
by direct re-run, then the working tree was restored to the fixed version and re-verified green
(14/14, typecheck clean) before committing. No reverted file was committed at any point
(`git status --porcelain` / `git diff --stat` checked clean against HEAD at each restore).

**Files touched by this correction:** only `netlayer/engine/packetModel.ts` and
`netlayer/tests/packetModel.test.ts`, plus this report.

**Concerns:** none outstanding. Both findings were real; both are now fixed and the report
corrected rather than quietly edited.

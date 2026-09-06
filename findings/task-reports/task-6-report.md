# Task 6 report

**Status:** Done. Commit `754a948` (on branch `ppkt`, parent `f5133b5`).

**Tests:** 35/35 pass (31 prior + 4 new in `tests/generateNet.test.ts`), including
`tests/appLayerUnchanged.test.ts` (untouched, still green). `npm run typecheck` clean.

**Measured untranslated count — MintRoute M4: 148, vs. the 153 baseline**
(`findings/2026-09-06-gap-baseline.md`, reproduced live via `npm run scan` against
the current `wsn-codegen` tree before implementing, confirming 153 is still accurate).

## What the -5 is, precisely

The drop is exactly the 5 `f ≔ {pkt} ⩤ f` domain-anti-restriction actions in
`send_down` for the ENC7 core fields (`pktSeqNo`, `pktSrc`, `pktFwdr`, `pktData`,
`pktNbHops`). The app-layer `FN4` rule only matches `f ≔ f ∖ {a↦b}` (documented gap
G9), not this anti-restriction spelling; the new `PKT-DEL-*` rules match it exactly.
GET/SET/DOM clauses on the same five fields were already translated by the
pre-existing generic `FN3`/`UNION-pair` rules (they were maps before PPkt); PPkt
changes their emitted C++ (chunk accessor instead of `std::map` access) without
moving the translated/untranslated count, so they don't show up in the delta.

`pktDestAddr`/`vPktDestAddr` aren't in scope yet at M4 — verified against the raw
XML, that pair is first declared in `M5.bum` (`inv5_9`/`inv5_11`). The channel-side
`vPktSeqNo`/`vPktSrc`/`vPktFwdr`/`vPktData`/`vPktNbHops` "wire copy" variables are
typed `∈ ran(channel) ⇸ T` (`M2.bum` `env2_9`), not `∈ PKT ⇸ T`, so `packetModel`
correctly excludes them from PPkt; their own anti-restriction actions (in
`send_up`) remain untranslated for the same pre-existing G9 reason, unrelated to
PPkt. None of this indicated a defect in Tasks 2-5 — the packet rules fired
correctly on everything eligible at M4; M4 just doesn't yet expose most of the
PPkt-shaped surface (that's M5+, out of this task's scope).

Sanity-checked the header: exactly 7 members on `PPkt` (`initialSrcAddr`,
`seqNum`/pktSeqNo, `srcAddr`/pktSrc, `fwdrAddr`/pktFwdr, `data`/pktData,
`nbHops`/pktNbHops, `netSeqNo`) plus `DataPkt`/`RoutePkt`/`BeaconPkt` leaves — no
duplicate or spurious members from the `vPkt*` family.

## One deviation from the brief

The brief's CLI-entry guard, `process.argv[1].endsWith("generate-net.ts")`, never
fires under `npx vite-node generate-net.ts ...`: vite-node's CLI consumes the
script-path argument itself, leaving `argv[1]` pointing at its own `cli.mjs`
(verified empirically — the target script path never appears anywhere in
`process.argv`). Replaced it with `process.env.VITEST !== "true"` — vitest sets
`VITEST=true` in every worker (also verified empirically), which reliably
distinguishes "imported by a test" from "run as a vite-node entry point," the two
call paths this file needs to support, without depending on vite-node's argv
layout.

## Concerns

None blocking. `wsn-codegen/` and `paper2/` untouched; `tests/appLayerUnchanged.test.ts`
and `tests/__baseline__/` untouched.

---

## Addendum (2026-09-06): Critical-finding fix — PKT-DOM ∈/∉ semantic inversion

**Status:** Done, on branch `ppkt`. Separate from the work above (which built
`generate-net.ts`/PPkt itself); this addendum fixes a Critical code-review finding
against the resulting `engine/packetRules.ts`.

**The bug.** `PKT-DOM-*`'s match regex was
`` ^\w+\s*(?:∈|∉)\s*dom\(\s*${F}\s*\)$ `` — a non-capturing group for the operator
— and `emit` unconditionally returned `` `true` `` regardless of which operator
matched. `pkt ∈ dom(F)` → `true` is sound (ENC7 puts the field on the chunk, and a
chunk always carries all its fields). `pkt ∉ dom(F)` → `true` is a silent semantic
inversion: that clause is the "this packet does not exist yet" precondition of
`create_bconPkt`/`create_routePkt`/`create_dataPkt` (and send_up's "not yet
re-populated" precondition), and collapsing it to `true` discarded it invisibly —
no `UNTRANSLATED` marker, nothing a compiler or the untranslated-count metric could
catch.

**Confirmed before fixing.** `npm run gen:net -- MintRoute M4 out-net` (pre-fix)
produced `if (!(true))\n    return false;` at every `dom(pktSeqNo|pktSrc|pktFwdr|
pktData|pktNbHops|pktDestAddr)` guard in `create_bconPkt`/`create_routePkt`/
`create_dataPkt`, exactly as the finding described.

**The fix.** Split the one rule into two, both still generated per-field only when
real evidence exists for that direction (no fabricated evidence, matching this
file's existing discipline):
- `PKT-DOM-{field}`: regex restricted to `∈` only; unchanged emit (`true`).
- `PKT-DOM-NOT-{field}` (new): regex matches `∉` only; `emit` returns `""`.
  `composeRules` puts every `PKT-*` rule ahead of the app-layer catalog (no
  `supersedes`, so both land in the "fresh" bucket), so this rule intercepts the
  clause before the generic app-layer `DOM` rule (`wsn-codegen/src/engine/
  rules.ts`, id `"DOM"`) can reach it — confirmed that generic rule's `match()`
  has no operator restriction either and, left unintercepted, would have emitted
  `` `${F}.count(x) == 0` ``, an uncompilable `std::map` lookup against a member
  ENC7 never declares (the field is a chunk getter/setter pair). `match()` on the
  new rule accepts the `∉` clause (so the generic rule never gets a turn) but
  `emit()` returns `""`; `ruleEngine.ts`'s `translateEvent` (`if (cpp) guards.push
  (cpp); else untranslatedGuards.push(clause)`) treats that falsy emit exactly
  like no rule matching — the clause becomes an `// UNTRANSLATED GUARD` comment
  and the event refuses to fire (`codeEmitter.ts`'s existing "a partially
  translated event must not report success" `refuse` path, unchanged).

**Evidence re-verification (not just re-labeling).** Re-derived the flattened
corpora (`npm run event -- MintRoute M5 --all --flat`, `npm run event -- RTMCS M6
--all --flat` — same machine versions `packetRulesEvidence.test.ts` checks
against) and grepped every real `dom(F)` occurrence for each field the DOM/DOM_NOT
kinds cover, by hand, cross-referencing event boundaries. Findings:
- The pre-fix `DOM` evidence for `pktSeqNo`/`pktSrc`/`pktFwdr`/`pktData`/
  `pktNbHops`/`pktDestAddr` (`create_bconPkt`/`create_routePkt`) was **∉-only** —
  real evidence for what is now `DOM_NOT`, but wrong for the now-∈-restricted
  `DOM` rule. Re-pointed `DOM` at `send_down` (its own `pkt ∈ dom(F) ∧ v = F(pkt)`
  read-back guard, immediately before the `DEL` rule wipes `F` for `pkt`) —
  confirmed present for all six fields.
- Same issue for `vPktDestAddr` and `vPktData`: pre-fix `DOM` evidence
  (`MintRoute.send_down` / `RTMCS.send_down`) was ∉-only (their own creation
  guard). Re-pointed `DOM` (∈) at `MintRoute.find_neighbours` / `RTMCS.send_up` —
  both already cited for `GET`, and both do contain the matching `∈ dom(...)`
  conjunct alongside the field-read conjunct.
- `initialSrcAddr`'s existing `DOM` evidence (`RTMCS.create_rrer`) was already
  genuinely `∈` (`rrer ∈ dom(initialSrcAddr) ∧ fDes = initialSrcAddr(rrer)`) —
  unchanged. Grepped the full corpus: `∉ dom(initialSrcAddr)` never occurs, so
  there is no `DOM_NOT` rule for this field (nothing to be evidence for).
- `envDestAddr` and `pktErrND`: `∉ dom(...)` occurs exactly once each (their own
  creation site, `send_down`/`create_rrer`), and `∈` never occurs anywhere in
  either corpus. So neither field gets a `DOM` (∈) rule at all — there is no real
  clause to cite — only `DOM_NOT`.
- `netDestAddr`: pre-fix evidence (`create_rreq`/`create_rrep`, confirmed ∉) kept
  as `DOM_NOT`; new `DOM` (∈) evidence is `RTMCS.send_down` (`pkt ∈ dom
  (netDestAddr) ∧ nxt=netDestAddr(pkt)`).

`packetRulesEvidence.test.ts` (unmodified) passes against all of this — it checks
`rule.match()` against cited events' clauses, which is exactly what the manual
grep re-verification above establishes.

**Measured impact.**
- MintRoute M4 untranslated count: **148 → 168** (the report above's own 148,
  freshly re-measured — this fix is layered on the same commit). Updated
  `tests/generateNet.test.ts`'s assertion from `< 153` to a pinned `168`, per this
  task's brief: the honest number is allowed to rise, and did.
- Every `if (!(true))` remaining in the generated MintRoute M4 output (16,
  down from wherever the ∉ cases inflated it before) was hand-audited: all trace
  to genuine `∈ dom(F)` clauses in `send_down`/`start_tx_*`/`receive_*`/
  `sink_recv_*` (dead-but-correct code — the guard is vacuously true and the
  event proceeds correctly). None trace to a `∉` clause. Confirmed the same for
  RTMCS M6 (`208` untranslated, `39` `if (!(true))` sites, spot-checked several)
  though that project's assertions aren't pinned in a test (only MintRoute M4
  is, per the existing test file's scope).

**New/changed tests (all pass, `npm test`: 37/37; `npm run typecheck` clean):**
1. `tests/packetRules.test.ts`: fixed the test that encoded the bug itself
   (`"treats domain membership as always-true..."` asserted `apply("pkt ∉ dom
   (pktSeqNo)")` to be `"true"` — literally the defect). Split into an ∈-only
   version of that assertion plus a new regression test asserting the ∉ input is
   `toBeFalsy()` under the file's `apply()` harness (which returns whatever the
   first matching rule's `emit()` produces verbatim, without replicating the
   engine's own falsy-means-untranslated fallback — so `toBeFalsy()`, not a
   specific value, is what actually characterizes "not silently accepted").
2. `tests/generateNet.test.ts`: added a test against the real generated
   MintRoute M4 output that re-derives the flattened model independently of
   `generate-net.ts`, finds every top-level `x ∉ dom(F)` guard conjunct on one of
   `packetModel`'s own fields, and asserts that exact clause text survives into
   the `.cc` as an `UNTRANSLATED GUARD` comment (not silently as `if (!(true))`).
   Also pins the `if (!(true))` count at 16, reasoned in the test's own comment
   (relies on the fact that `PKT-DOM` is the only rule in the combined catalog —
   app-layer + packet — that can ever emit the literal string `"true"`, verified
   by grepping both rule catalogs).

**Other packet rules checked for the same class of bug (non-capturing group or
ignored operator collapsing two different clauses to identical C++).**
- `PKT-GET-{field}` (`y = F(p)` → `y == p->G()`): guard-only spelling (`=`);
  Event-B actions always use `≔`, never `=`, so there is no action/guard
  ambiguity for this rule to conflate. No operator group at all — clean.
- `PKT-SET-{field}`: the operator group `(?:[⊕⊴∪])?` IS optional/
  non-capturing, but deliberately so — it exists to accept the several spellings
  the models use for "assign a fresh singleton mapping" (relational override
  U+E103, and union with a singleton maplet, `⊕`/`⊴`/`∪`, occasionally with no
  visible operator character in the raw text at all). All of these are
  semantically identical FOR THIS SHAPE once the preceding `∉ dom(F)` guard (now
  correctly enforced, see above) establishes the key is fresh — override and
  union agree when inserting a new key. This is not the ∈/∉ class of bug: it is
  one operation (`f := f ∪-or-override {p ↦ v}`) with several surface spellings,
  not two different operations being conflated. Verified none of the models ever
  use this exact `F ≔ F <op> {p↦v}` shape to mean a REMOVAL (that shape is
  `⩤`/`∖`, structurally distinct and owned by `PKT-DEL`) — no overlap.
- `PKT-DEL-{field}` (`F ≔ {p} ⩤ F` → no-op comment): single operator (`⩤`), no
  reading ambiguity. Regex is order-sensitive (`{p} ⩤ F`, not `F ⩤ {p}`), matching
  the one anti-restriction direction that occurs in both corpora. No ∈/∉-style
  dual reading is possible here.
- Conclusion: `PKT-DOM` was the only rule in this file with an operator the
  regex was blind to while the two readings mean opposite things. Nothing else
  in `packetRules.ts` has that shape.

**Cleanup.** Deleted scratch flattened-corpus dumps and the RTMCS sanity-check
output directory used during investigation; working tree is clean apart from the
three modified source/test files and the gitignored `out-net/`.

**Concerns.** None blocking. `envDestAddr` and `pktErrND` now have no `∈`-side
`PKT-DOM` rule at all (correctly — no real `∈ dom(...)` clause exists anywhere in
either corpus for them), so if a future refinement of RTMCS ever adds one, this
file's evidence table will need a genuine new citation before that rule can be
added (by design — this is the same "no fabricated evidence" discipline the file
already documents for `PKT-CMP`).

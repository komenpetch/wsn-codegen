# Task 5 report — Packet-access rules, composed onto the app-layer catalog

## Status: DONE

## What was built

- `netlayer/engine/packetRules.ts` — `NetRule` interface (`Rule` + `tier`/`evidence`/`supersedes`) and
  `packetRules(fields: PacketField[]): NetRule[]`. For each `PacketField`, emits five rules:
  `PKT-GET-*` (getter, `y = f(pkt)` → `y == pkt->getX()`), `PKT-CMP-*` (`f(pkt) = v` → `pkt->getX() == v`),
  `PKT-SET-*` (setter, accepting the override spelling `f ≔ f {p↦v}` with any of `U+E103`/`⊕`/`⊴`, or the
  union spelling `f ≔ f ∪ {p↦v}`), `PKT-DOM-*` (domain membership on a chunk field is vacuously `true`),
  and `PKT-DEL-*` (tier-3 no-op for domain anti-restriction `f ≔ {x} ⩤ f` — the packet is discarded, the
  field goes with it).
- `netlayer/engine/compose.ts` — `composeRules(net: NetRule[]): Rule[]`. Validates every net rule has
  non-empty `evidence` and that any `supersedes` target actually exists in the app-layer `RULES` catalog
  (throwing with the rule id / target name in the message otherwise), then returns fresh (non-superseding)
  net rules prepended to the app-layer catalog with superseded entries replaced in place (same array
  position, so ordering elsewhere in `RULES` is undisturbed).
- `netlayer/tests/packetRules.test.ts`, `netlayer/tests/compose.test.ts` — copied verbatim from the brief.

## Verbatim-fidelity note (not a deviation, just worth recording)

The brief's "override spelling" test fixture (`"pktSeqNo ≔ pktSeqNo {pkt↦sno}"`) contains a literal
invisible `U+E103` character between `pktSeqNo` and `{`. When I first transcribed the brief's test block
by hand, that codepoint silently disappeared (retyping a private-use codepoint through normal text
generation doesn't reliably round-trip it) — the test still would have passed regardless, because the
brief's own regex has `\s*` immediately before the optional `[\uE103⊕⊴∪]` group, so a bare space with zero
override characters matches identically to a space-adjacent `U+E103`. To be faithful to the brief rather
than rely on that coincidence, I extracted all four `ts` code blocks (both test files and both
implementation files) directly out of `task-5-brief.md` by byte offset (via a small Node script, not by
retyping) and used those as the committed file contents. A diff against my hand-typed draft confirmed the
only difference was that one missing `U+E103` byte; `compose.test.ts` was already byte-identical.
`packetRules.ts` and `compose.ts` are therefore committed exactly as given in the brief, including the
private-use codepoint that also appears (as a rendering artifact) inside a `//` comment in `packetRules.ts`
— harmless since it's inside a comment, left as-is rather than "cleaned up."

## Verification

- `npm test -- packetRules compose` — 2 files, 10 tests passed (after confirming they failed on
  "Cannot find module" before the implementation files existed).
- `npm test` (full suite) — 6 files, 29 tests passed, including `tests/appLayerUnchanged.test.ts`
  (untouched, still green) and the 19 pre-existing tests.
- `npm run typecheck` — clean, no output.
- Confirmed `C:/Users/Komen/Desktop/Proj/wsn-codegen/` has only its pre-existing uncommitted changes from
  another author (README.md, scripts/generate.ts, src/engine/flattener.ts, src/engine/pipeline.ts, plus
  untracked docs/scripts) — none touched by this task.
- `git status` in `netlayer/` before commit showed exactly the four new files, nothing else.

## Concerns

None. The implementation is a verbatim transcription of the brief's Step 3 code with no interpretation
required; both test files and both source files match the brief exactly.

---

## Fix report — review finding: "a rule's evidence is factually false" (2026-09-06)

### What was wrong

`packetRules.ts` gave all five rule kinds (`PKT-GET`, `PKT-CMP`, `PKT-SET`, `PKT-DOM`, `PKT-DEL`) for
every field the *same* hardcoded evidence array, `["MintRoute.create_bconPkt", "MintRoute.create_routePkt"]`.
The finding flagged `PKT-DEL` as the confirmed-wrong one. I was told explicitly not to copy the finding's
own suggested replacement list on trust, so I re-derived every evidence value from scratch.

### Verification method

Ran, from `netlayer/`:
```
npm run event -- MintRoute M5 --all --flat
npm run event -- RTMCS M6 --all --flat
```
and cross-checked with a throwaway probe script (`netlayer/scripts/_probe_evidence.ts`, deleted after use,
not committed) that, for each project's *real* `PacketModel` fields (from `packetModel()`, not a
hand-written list), built the exact same five regexes `packetRules.ts` uses and ran them against every
flattened event's guards+actions split into top-level conjuncts via `splitConjuncts` (the same granularity
`wsn-codegen/src/engine/ruleEngine.ts` matches at) — i.e. mechanically reproducing "does this event genuinely
contain a clause this rule's `match()` accepts" for all 20 real (field, kind) combinations across both
corpora, rather than eyeballing individual guards.

### What the verification found (beyond the flagged bug)

1. **The finding's own suggested fix for `PKT-DEL` was itself partly wrong.** `RTMCS.finish_tx_pkt` and
   `RTMCS.final_tx_pkt` do **not** exercise `⩤` on any packet field: `finish_tx_pkt` only does plain set
   difference (`WiMedium ∖ {f↦pkt}`) and `final_tx_pkt` uses **range** anti-restriction (`⩥`, a different
   operator) on `WiMedium`/`sentUp` — neither of which is a `PacketField`. The real `PKT-DEL` evidence is
   `MintRoute.send_down` and, in RTMCS, `send_down` **and** `clear_pkt` (verified per-field: `clear_pkt`
   touches `pktData`/`pktSeqNo`/`pktFwdr`/`pktNbHops`/`netDestAddr`/`finalDestAddr` but never `pktSrc`).
2. **`PKT-GET`'s evidence was also wrong**, not just `PKT-DEL`'s. `create_bconPkt`/`create_routePkt` only
   ever *write* the packet-field family (via the override/union setter spellings) — they never read a
   field back with the `y = f(pkt)` shape `PKT-GET` matches. The genuine evidence is `send_down` (in both
   projects), which reads every field back via exactly that form when handing the packet to the channel.
3. **`PKT-CMP`'s pattern (`f(p) = v`, field-call on the left) never occurs anywhere in either corpus, for
   any field.** Every equality in both models spells it the other way (`v = f(p)`, `PKT-GET`'s form). No
   honest evidence exists for it, so `PKT-CMP` is **dropped** rather than shipped with fabricated evidence.
4. **Evidence is not even uniform across fields of the same kind.** e.g. `netSeqNo` is total from
   `INITIALISATION` (`netSeqNo := PKT × {0}`) in both projects, so it is *never* guarded for domain
   membership, chunk-set, or anti-restricted — only `PKT-GET` genuinely applies to it. `initialSrcAddr` is
   context-sourced and never written/removed at all — only `PKT-GET`/`PKT-DOM` apply, and (surprisingly)
   only *RTMCS* ever guards `dom(initialSrcAddr)` (`create_rrer`, `add_bwdRouteEntry`, ...) — MintRoute
   never does.

### The fix

Replaced the single blanket `evidence` array with a `EVIDENCE: Record<ebName, Partial<Record<Kind,
string[]>>>` lookup table in `packetRules.ts`, hand-verified per (field, kind) pair against both real
corpora (13 fields × up to 4 kinds). `packetRules()` now only pushes a rule for a (field, kind) combination
that has a real entry in the table — a field/kind pair with no genuine evidence in either corpus (e.g.
`PKT-DOM-netSeqNo`, `PKT-DEL-vPktDestAddr`, any `PKT-CMP-*`) is simply not generated, rather than generated
with evidence that cannot be verified. `PKT-CMP` was removed entirely (dead pattern, zero occurrences
anywhere). Evidence for a rule built from one project's fields may legitimately cite the *other* project's
event, since the core packet-attribute family (`pktSeqNo`/`pktSrc`/`pktFwdr`/`pktData`/`pktNbHops`) has an
identical shape in both case studies (e.g. `PKT-DOM-initialSrcAddr`'s only evidence is `RTMCS.create_rrer`,
even though `initialSrcAddr` is also a MintRoute field) — the verification test resolves each evidence
string against *its own* named project's corpus, never the field's project of origin.

`engine/compose.ts` was not touched — its non-empty-evidence and supersedes-exists checks were already
correct; the bug was entirely in what evidence `packetRules.ts` claimed, not in how `compose.ts` validated it.

### The covering test (Part 2)

New file `netlayer/tests/packetRulesEvidence.test.ts`. For each project (MintRoute M5, RTMCS M6): loads the
real `.bum`/`.buc` corpus, builds the real `PacketModel` via `packetModel()` (not a hand-written field list,
per the ruling), runs `packetRules()` on those real fields, and for every resulting rule checks that **at
least one** of its cited `"Project.eventLabel"` evidence strings resolves to a real event whose guards or
actions (split into top-level conjuncts, matching `ruleEngine.ts`'s own granularity) contain a clause that
rule's own `match()` accepts. A cited event/project that doesn't exist is reported distinctly ("does not
name a real Project.eventLabel") from a real event with no matching clause, so a typo and a wrong-but-real
citation are never confused in the failure output.

### Proving it bites

Temporarily replaced `pktSeqNo`'s `DEL` evidence with the finding's own bogus suggestion,
`["RTMCS.finish_tx_pkt", "RTMCS.final_tx_pkt"]`, and ran:
```
npm test -- packetRulesEvidence
```
Failure output (both project sub-tests fail, since `pktSeqNo` is a field shared by both corpora):
```
FAIL  tests/packetRulesEvidence.test.ts > packetRules evidence is real, not just non-empty > every rule built from MintRoute's real PacketModel is backed by a genuine clause in its cited evidence
FAIL  tests/packetRulesEvidence.test.ts > packetRules evidence is real, not just non-empty > every rule built from RTMCS's real PacketModel is backed by a genuine clause in its cited evidence
AssertionError:
PKT-DEL-pktSeqNo: none of its evidence [RTMCS.finish_tx_pkt, RTMCS.final_tx_pkt] contains a clause that PKT-DEL-pktSeqNo's match() accepts: expected [ Array(1) ] to deeply equal []
```
It names the exact rule (`PKT-DEL-pktSeqNo`) and the exact events checked — not a generic assertion
failure. Restored the correct evidence (`["MintRoute.send_down", "RTMCS.send_down", "RTMCS.clear_pkt"]`)
and reran; green again.

### Verification

- `cd netlayer && npm test -- packetRulesEvidence` — 1 file, 2 tests passed (after confirming the induced
  failure above).
- `cd netlayer && npm test` — 7 files, **31 tests** passed (29 pre-existing + 2 new), including the
  untouched `tests/appLayerUnchanged.test.ts`, `tests/__baseline__`, and the original `packetRules.test.ts`
  / `compose.test.ts` (both pass unmodified against the new evidence table — the two fixture fields,
  `pktSeqNo`/`pktNbHops`, both have real `GET`/`SET`/`DOM`/`DEL` evidence, so nothing they exercise was
  dropped).
- `cd netlayer && npm run typecheck` — clean, no output.
- Confirmed `C:/Users/Komen/Desktop/Proj/wsn-codegen/` still shows only the same pre-existing uncommitted
  changes from another author (unchanged); nothing under it was touched.
- `git status` in `netlayer/` shows exactly `engine/packetRules.ts` modified and
  `tests/packetRulesEvidence.test.ts` untracked — no other files touched. `netlayer/engine/compose.ts` and
  `netlayer/tests/compose.test.ts`/`packetRules.test.ts` are unmodified.
- Deleted the two throwaway probe scripts (`scripts/_probe_fields.ts`, `scripts/_probe_evidence.ts`) used
  only to mechanically derive the evidence table above; neither is part of the commit.

### Files changed

- `netlayer/engine/packetRules.ts` — replaced the blanket evidence with a verified per-(field, kind) table;
  removed the unevidenced `PKT-CMP` rule kind; rule generation for a (field, kind) is now conditional on a
  table entry existing.
- `netlayer/tests/packetRulesEvidence.test.ts` — new, mechanical evidence-vs-corpus verification test.

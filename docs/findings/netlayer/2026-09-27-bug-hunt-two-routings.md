# Bug hunt after the two-routing change (flooding / AODV)

**2026-09-27.** User: *"okay does it both routing work right. now diagnosing the tool
to find bugs"*. Every finding is recorded with the evidence. **Fixed the same day**
(*"yes fix all the flags, find reason first. for d2 no telling people to chose on
there side"*) — all but defect 2, which is left as it is by that ruling: which
routing a project gets is the user's side, expressed by the model they bring.
See §4 for each cause and fix.

## 1. Do both routings work right? Yes, as floods, per packet type

`invariants.sh` checks the conservation laws **summed over all control types**, so
a defect in one type could hide inside the sum. A new per-type probe
(`Simulation/v3_net/type_check.sh`, mirrored in `docs/harness/v3_net/`) checks the
same laws **per node and per type**, plus reach (how many distinct originators
each node heard, per type). It is red-capable: a hand-broken `.sca` exits 1 on
exactly the broken counter.

Nine-node field, `[Config Sink]`:

| | flooding, 5 s ticks, 60 s | AODV, 5 s ticks, 60 s | flooding, 20 s ticks, 120 s | AODV, 20 s ticks, 120 s |
|---|---|---|---|---|
| per-type laws | all hold | all hold | all hold | all hold |
| reach, every type | sensors 7/7, sink 8/8 | sensors 7/7, sink 8/8 | 7/7, 8/8 | 7/7, 8/8 |
| accepted per type | 339 / 316 | 278 / 236 / 227 | **320 / 320** | 297 / 292 / 283 |
| delivered to sink per type | 35 / 33 of 88 | 31 / 28 / 26 of 88 | **40 / 40 of 40** | 36 / 36 / 35 of 40 |
| queue overflow | 180 | 330 | **0** | 27 |

- **Every frame is accounted for per type:** frames built = `send_down` =
  `start_tx` − nothing lost, and `accept + dup` = frames received for each type.
- **The first type is favoured at the default load (339 vs 316, 278 vs 236/227),
  and that is queue overflow, not a per-type defect.** Hypothesis: the type
  created first each tick is queued first and survives when the interface queue
  overflows. Test: a quarter of the load. With zero overflow the two flooding
  types come out **identical**, and every node accepts every packet of every other
  originator (the flood is complete; the sink gets 40 of 40 of each type). AODV at
  that load still drops 27 and keeps a small residue of the bias.
- **Ruled out:** a cross-type identity collision. The per-type counters mean RREQ #1
  and RREP #1 from one node carry the same sequence number, but the wire identity
  key includes `getType()` (`localIdFor`, `rememberSentPacket`), so they never
  collide.

## 2. Defects found

Ranked by what they can cost.

1. **An axiom written as a conjunction hides what it declares, and for the new
   routing detection that picks the WRONG routing.** Measured: a copy of
   `C0_project` plus `Sink ∈ ND` and `Sink = 0` as two axioms reads **flooding**; the
   same facts as one axiom, `Sink ∈ ND ∧ Sink = 0`, read **AODV**, and the `Sink`
   constant is silently not emitted. `routingStyleOf` matches whole axioms. ⚠ **So
   does every other axiom reader in the engine**: the context emitter
   (`codeEmitter.ts:22, 43, 244`), `nodeSetsOf`/`sinkConstantOf`
   (`nodeIdentity.ts:63, 115`), `packetTypeLattice` (`packetTypes.ts:31`),
   `packetModel.ts:126, 131`, `aliasEncoding.ts:71`, `setAlias.ts:85`. **Latent, not
   live:** the only top-level-free `∧` in any corpus axiom is inside a quantifier
   (MintRoute `TCL.buc`). ⚠ **The fix must not split a quantified axiom.**
   `splitConjuncts` (ruleEngine.ts) splits at paren depth 0, and
   `∀t·t∈wsnfn∧(∀s·…)⇒…` has an `∧` at depth 0 inside the quantifier's scope, so
   splitting it would produce two false axioms. One normalisation at the
   `RawContext` level, skipping `∀`/`∃` axioms, would cover every reader at once.
2. **The routing the tool guessed is not shown anywhere a user would look.** Neither
   the CLI line (`Generated 3 files (structure v3, …)`) nor the web app says
   "flooding" or "AODV"; the only trace is `(derived from C0, C1, C2_aodv)` in the
   generated header. For a decision that is a guess by design, a user expecting
   flooding can receive AODV silently.
3. **The untranslated count counts clauses another pass realises.** The AODV module
   reports **8**: 6 are node-keyed initialisations (`rreqSeqNo ≔ ND × {0}` …) that
   `bindNodeIdentity` realises at `INITSTAGE_LAST`, 1 is `netSeqNo ≔ PKT × {0}`, which
   the chunk field's `int netSeqNo = 0` realises, and **1** (`data ≥ safetyThreshold`)
   is genuine. The same over-count is in `M4Wsn` (27 markers, at least 8 realised)
   and `M6Wsn` (22, at least 10). Recorded before as "not a new failure" and never
   corrected; it inflates every untranslated figure the project cites.
4. **Generated comments name MintRoute methods that do not exist.** Every per-type
   send method says `Shaped after MintRoute::send<Type>Broadcast`
   (`appTransmit.ts:100`, `mediumBinding.ts:438`), but `MintRoute.h:152–153`
   declares only `sendRouteBroadcast` and `sendBeaconBroadcast`. Every structure-3
   module carries a false `sendDataBroadcast` citation; an AODV module carries three
   more (`sendRreqBroadcast`, `sendRrepBroadcast`, `sendRrerBroadcast`). Comment-only;
   fixing it moves `M4Wsn`/`M6Wsn` comment bytes.
5. **The web app's name placeholder is `Pm3App`** (`App.tsx`), a name the tool stopped
   producing on 2026-09-12; the default is `Pm3Wsn`.
6. **A dead member in every structure-3 module:** `std::map<PktId, int> netSeqNo;` is
   declared and never read or written. Every access goes to the chunk
   (`getNetSeqNo`/`setNetSeqNo`), so this is dead code, **not** a two-storage
   defect. Present before today's change too.
7. **Rodin only, not verified in Rodin:** after the split swap, the in-memory `uM4`
   sees `C2_ctl`/`C2_aodv` while `pM5`, which refines it, still sees only `C1`. Rodin
   is expected to reject a refinement that does not see its abstraction's contexts.
   Nothing writes these machines out, so no output is affected; it matters only
   for the claim that the bundled machines open in Rodin. Pre-existing since
   2026-09-21.

## 3. Checked and not a defect

- A project that declares `Sink ∈ ND` with **no value** reads flooding and generates
  cleanly. The `Sink` constant is not emitted, but nothing in the pattern's events
  reads it, and the identity binding (which needs a value) falls back to module ids.
- The web app reaches the same path (`generateMerged` → `packetSourceFor` →
  `patternExtensionFor`), so it gets the detection, and defect 1 with it.

## 4. Fixed — cause first, then the fix (same day)

| # | cause | fix |
|---|---|---|
| 1 | every axiom reader matches ONE declaration per predicate | the parser splits a conjunction of declarations (`splitDeclaration`, text.ts) for axioms AND invariants — once, for every reader. Left whole: anything with a top-level `∀ ∃ λ · ∣ ⇒ ⇔ ∨ ¬`, and any `∧` inside `()`, `{}`, `[]`. A split part is labelled `axm.1`, `axm.2`; an unsplit one keeps its label, so no corpus output moves |
| 2 | — | **not changed, by ruling** |
| 3 | the emitter marks node-keyed and packet-field initialisations UNTRANSLATED at construction, and the passes that realise them later never said so | `markRealised` (emitted.ts) rewrites the marker into a note naming the realiser; called by `bindNodeIdentity` and `emitWithPacketClasses`; the recount subtracts the same list (`initsRealisedAfterEmit`, netPipeline), so count and markers stay equal. Loud: a realiser with no marker throws |
| 4 | the citation was built as `MintRoute::${broadcastMethodOf(tag)}` | one fixed wording, `BROADCAST_SHAPE` (packetModel.ts), used by both emitters |
| 5 | a literal left from before the 2026-09-12 rename | the placeholder is `defaultName(target)`, what the field is filled with |
| 6 | the dead-map pass (a) counted the name across the WHOLE header, where the PPkt chunk's same-named field and accessors live, and (b) required a `clear()` line to delete alongside | the header check is scoped to the module class; a member with no `clear()` is removed when nothing uses it |
| 7 | the `sees` swap reached `uM4` only | one `seeSplit` helper, applied to `uM4` and `pM5` |

- **Untranslated, now meaning what it says:** structure 3 (AODV and flooding) **1**
  (was 8 / 7; the one is `data ≥ safetyThreshold`), `M4Wsn` **15** (was 27),
  `M6Wsn` **9** (was 22), structure 2 **2** (unchanged). Every rewritten note was
  checked against a real specialisation line or field initialiser.
- **Dead maps removed:** `netSeqNo` from structure 3 and `M4Wsn`; six from `M6Wsn`
  (`finalDestAddr`, `vPktData`, `netSeqNo`, `netDestAddr`, `envDestAddr`, `pktErrND`)
  with their `clear()` lines. ⚠ **Not touched:** a namespace-scope
  `inline std::map<PktId, Node> finalDestAddr;  // not in the supplied context` the
  CONTEXT emitter leaves in `M6Wsn` — also dead, but a different pass, and the
  residue already recorded on 2026-09-19.
- **Blast radius, against the outputs from before this round:** structure 2 and all
  three `.ned` files **byte-identical**; every other changed line is a marker turned
  into a "realised" note, the citation wording, or a dead map and its `clear()`.
  `clang -fsyntax-only` 0 errors on all four modules. **Both routings re-run on the
  nine-node field: every per-type total identical, invariants green, loop green.**
- **Tests:** 495 (14 new). **All eight mutations caught by their own tests**
  (splitter never splits; quantifier guard removed; identity markers kept; chunk
  markers kept; invented citation back; header check unscoped; `clear()` required
  again; `pM5` not swapped). ⚠ **Lint caught a vacuous assertion of mine:** a
  heredoc turned `\s` into `\s`, which a template literal reads as `s`, so the
  `M6Wsn` half of the dead-map test matched nothing and passed. Fixed with the Edit
  tool, then given a positive control so it cannot go vacuous again. #5 has no React
  test harness; it is type-checked and built, not clicked through.

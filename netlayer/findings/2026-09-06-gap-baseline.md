# Network-layer gap baseline

**Measured 2026-09-06** against `wsn-codegen` at commit `07b71a3`, engine
unchanged. Tool gate green at the time of measuring: `tsc -b` clean, 80/80 tests.

Reproduce with `npm run scan` and `npm run shapes`. **Re-run rather than quote** —
these figures are relative to the engine as it stood, and that is exactly how the
stale "83 / 164" survived into a brief written seven weeks later.

---

## 1. How much

Counts are per machine and **cumulative**: generating with machine *M* as target
flattens its whole refines chain, so M6 contains M0–M5. The last column is what
each refinement level adds.

Two independent counts are reported and **agree at every level**: occurrences of
the `UNTRANSLATED` token in the three emitted files (authoritative — counted from
the output), and the engine's own bookkeeping (used only to attach clause text).
Agreement is the evidence that no clause is being dropped without a marker.

### RTMCS / AODV — `EventB_model/RTMCS_7_4_proof`

| machine | events | vars | clauses | translated | untranslated | distinct | new here |
|---|---|---|---|---|---|---|---|
| M0 | 6 | 5 | 29 | 24 | 5 | 5 | 5 |
| M1 | 15 | 14 | 125 | 103 | 22 | 18 | 17 |
| M2 | 22 | 22 | 201 | 168 | 33 | 24 | 11 |
| M3 | 29 | 39 | 388 | 316 | 72 | 52 | 39 |
| M4 | 38 | 46 | 515 | 411 | 104 | 63 | 32 |
| M5 | 50 | 55 | 803 | 623 | 180 | 79 | 76 |
| **M6** | 51 | 59 | 860 | 673 | **187** | **83** | 7 |

### MintRoute — `EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck`

| machine | events | vars | clauses | translated | untranslated | distinct | new here |
|---|---|---|---|---|---|---|---|
| M0 | 5 | 4 | 18 | 17 | 1 | 1 | 1 |
| M1 | 15 | 13 | 124 | 108 | 16 | 14 | 15 |
| M2 | 24 | 36 | 340 | 282 | 58 | 48 | 42 |
| M3 | 36 | 47 | 520 | 399 | 121 | 88 | 63 |
| M4 | 40 | 53 | 606 | 453 | 153 | 109 | 32 |
| **M5** | 53 | 68 | 830 | 580 | **250** | **164** | 97 |

**Clause coverage: 78.3 % (RTMCS M6), 69.9 % (MintRoute M5).**

Two observations the old bare counts could not support:

1. The distinct counts land **exactly** on the 2026-07-06 figures. The catalog
   has not moved the network-layer gap since — consistent with every fix in
   between being app-layer.
2. The gap is **not** concentrated at M4–M6. RTMCS reaches 52 of its 83 distinct
   clauses by M3; MintRoute reaches 88 of 164. Roughly two thirds of the network
   layer's problem is inherited from refinement levels the app-layer work never
   exercised, because the app-layer input stops at pM3 of a *different* chain.

For comparison, the finished app-layer input `Update_wsn/C0_project` leaves
**2** clauses unmatched at pM3: `emergencyAlert ≔ ND × {FALSE}` and
`data ≥ safetyThreshold` — the Cartesian product and the arithmetic comparison
named in the kickoff brief, both belonging to the actuation/threshold component
that ships no interface machine.

---

## 2. What shape

247 distinct clauses across the two leaf machines, grouped by **primary
blocker** — the first thing that stops the clause matching. A clause blocked by
two things is filed under one and its other features are reported separately, so
nothing is hidden by the choice of bucket. `OTHER` is 0 and is printed in full
when non-empty: the classifier is not permitted a silent bucket.

| group | fix | RTMCS | MintRoute | total |
|---|---|---|---|---|
| G0 typing not recognised | **not a gap** | 1 | 2 | 3 |
| G1 normalisation only | **not a gap** | 0 | 2 | 2 |
| G2 nested-maplet container | interface machine | 5 | 5 | 10 |
| G3 pair-keyed table | interface machine | 12 | 58 | **70** |
| G4 nested relational image | structural | 9 | 3 | 12 |
| G5 relational image / range restriction | rule | 1 | 2 | 3 |
| G6 compound operand | structural | 11 | 23 | 34 |
| G7 disjunction / implication | structural | 0 | 3 | 3 |
| G8 cartesian init | rule | 13 | 8 | 21 |
| G9 domain anti-restriction | rule | 13 | 11 | 24 |
| G10 arithmetic | interface machine | 9 | 21 | 30 |
| G11 disequality | rule | 7 | 13 | 20 |
| G12 aggregate | rule | 0 | 1 | 1 |
| G14 set comparison | rule | 1 | 2 | 3 |
| G13 scalar assignment | interface machine | 1 | 10 | 11 |
| OTHER | — | 0 | 0 | 0 |
| **total distinct** | | **83** | **164** | **247** |

By fix kind: **interface machine 121 · rule 72 · structural 49 · not a gap 5.**

### The classifier is itself tested

`shapes.ts --selftest` asserts that every group is reachable from a real clause
*and* that four shapes the catalog already handles (`x ∈ dom(R)`, `S ≔ S ∪ {x}`,
`nbrs ≠ ∅`, `type(pkt) ∈ CONTROL`) are claimed by **no** group. Writing that
selftest caught two real defects in the detectors — G11 was claiming `≠ ∅`,
which SET4 already translates, and the OTHER bucket exposed `a ↦ b ∈ dom(R)`,
a pair-keyed access G3 was missing. A checker that silently checks nothing
reports success.

---

## 3. Missing rule, or missing interface machine?

The kickoff brief's point 2: an induced catalog is bounded by its corpus, and
the fix for a gap is to supply the missing interface machine and re-induce, not
to hand-write cleverer rules. Applying that test group by group:

### Missing interface machine — 121 clauses

The catalog was induced from six interfaces (`ISend`, `IReceive`, `INDBuffer`,
`IDestBuffer`, `ISensingUnit`, `IPacket`) in
`Ex_WSN_Pattern/WSN_Pattern_shDecom6_2/`. All six are **communication**
components. The network layer's own components — the route table, and the metric
that ranks routes — ship no interface machine, so their shapes were never in the
corpus to be induced from.

- **G3 pair-keyed table (70)** is the dominant group and it is one idea: a table
  keyed by a *pair*. `bwdNextND(x↦s)`, `y ↦ x ↦ sNo ∉ bwdSeqNo`,
  `nd ↦ nb ∈ dom(lastSeqno)`, `cost ≔ cost ∪ {y↦x↦INFINITY}`. The encoding
  resolver files these as `function` because the invariant has `→`, and then
  every access rule fails because the key is not a bare identifier. This is the
  `map<pair<int,int>,T>` encoding the brief lists as *implemented but
  unexercised* — the encoding exists; nothing induced the operations on it.
- **G2 nested-maplet container (10)** — `s ↦ {pkt ↦ nbh} ∈ nbHops`, a map from a
  node to a *set of pairs*. A container shape no interface machine holds.
- **G10 arithmetic (30)** — sequence numbers, hop counts, the ETX cost
  arithmetic. No interface machine computes anything; this is the same gap the
  app layer hit once, as `data ≥ safetyThreshold`.
- **G13 scalar assignment (11)** — `bcastRouTimer ≔ FALSE`. ENC1/ENC6 exist but
  no interface machine has scalar state, so no assignment rule was induced.
  MintRoute's four scalar BOOL variables are exactly this.

**Action:** author a RouteTable interface machine (and a metric/timer one) in the
pattern's own style, then re-induce. Do not write these rules by hand — doing so
abandons the property that makes the catalog defensible.

### Catalog vs implementation — 68 clauses, no new justification needed

Four groups are **not** catalog gaps at all. The catalog already states the rule;
the implementation matches a narrower shape than the rule it claims to be.

- **G9 domain anti-restriction (24).** Catalog FN4 is `{x} ⩤ f → f.erase(x)`.
  The implementation only matches the `f ≔ f ∖ {a↦b}` spelling. Every
  `pktSeqNo ≔ {pkt} ⩤ pktSeqNo` in both projects goes untranslated against a
  rule that is written down.
- **G8 cartesian init (21).** Catalog CMP2 is `f ≔ D × {c}`. The implementation
  requires `(A ∖ B) × {c}` with both sides bare identifiers, so the *more
  general* form fails while the special case passes.
- **G11 disequality (20)** and **G14 set comparison (3).** `EQ` covers `a = b`,
  `SET4` covers `≠ ∅`, `SET1` covers `∈` — but `a ≠ b` and `S ⊆ T` have no rule.
  The same `=`/`≠` asymmetry class as the FN4 dispatch bug fixed on 2026-07-21.

**Action:** widen the implementation to the catalog's own stated form. This is
the cheapest 68 clauses available and needs no corpus work.

### Structural — 49 clauses

The catalog matches clause shapes and does not compose them; this is the
documented limitation from the paper's Section 4.3, now quantified.

- **G6 compound operand (34)** — an operator whose operand is an expression:
  `ran(ndBuff ∪ WiMedium)`, `ran(WiMedium) ∖ destBuff(des)`, `ran(calPCost) ≠ ∅`.
- **G4 nested relational image (12)** — `ran({x} ◁ dom(fwdNextND))`. This is the
  two-level image the brief predicted as the first thing a network-layer case
  study would hit, and it is here in RTMCS M5/M6, not only in DSR.
- **G7 disjunction / implication (3)** — `splitConjuncts` splits `∧` only.

**Action:** these do not resolve into rules. They need the matcher to become a
small recursive expression compiler over the operators the catalog already
defines. That is one change that subsumes all three groups, and it should
probably come *after* the container question is settled, because the container
still decides what each operator emits.

### Not a gap — 5 clauses

- **G0 (3)** — `r ∈ ℙ(ℤ × ℤ)`, `nxt ∈ ND ∪ {BROADCAST}`. Typing predicates ST4
  should drop; `isTypingPredicate` only accepts a bare-identifier right-hand
  side. Note `des ⊆ nodes` is *not* one of these — `nodes` is a machine
  variable, so that one is a real subset guard (filed under G14).
- **G1 (2)** — `(x = Sink)` blocked only by its parentheses,
  `x ∈ dom (totalSentBcon)` blocked only by a space before the bracket.

**Action:** fix these first. They are currently inflating the published gap, and
a measurement that counts non-gaps as gaps misdirects everything planned from it.

---

## 4. Suggested order

1. **G0, G1, G8, G9, G11, G14 — 73 of 247 distinct clauses.** No new corpus, no
   new justification, and it cleans the measurement before anything is planned
   from it. Re-measure immediately after.
2. **G3 + G2 + G13 — the RouteTable interface machine.** Author it, re-induce,
   and keep each new rule's evidence the way the existing ones do.
3. **G4, G6, G7 — the recursive matcher.** After the containers are settled.
4. **G10 arithmetic** — with the metric component, alongside step 2 or after it.

Pair whatever lands with an execution run against `MintRoute.cc` as the
reference of the same scope. The app layer's V1 compiled, loaded, ran a full
60 s and exited 0 while transmitting zero packets; compiling is not evidence of
behaviour.

---

## 5. Update 2026-09-06 (task 7) — PPkt is now in the composed catalog

The numbers in sections 1–4 above are the **app-layer-only baseline**
(`npm run scan` / `npm run shapes`, which call wsn-codegen's own pipeline
directly and are unaffected by anything netlayer composes in) — they are
unchanged by this update and still measure MintRoute M4 at 153
emitted-UNTRANSLATED / 109 distinct, same as before.

Task 7 ran `netlayer/scripts/generate-net.ts` (the COMPOSED pipeline: PPkt's
packet-model rules + a handful of task-7 fixes, layered over the same
app-layer catalog) through a real C++ compile gate for the first time, and
that surfaced several real, previously-silent defects (see
`task-7-report.md` for the full account — an `inet::FieldsChunk` include
gap, a context-constant/macro collision, two instances of wsn-codegen's own
rule catalog dispatching on clause SHAPE without checking the variable's
resolved ENCODING, an encodingResolver default that never fires for a
type alias or for a subset-of-a-relation invariant, a builtin-`BOOL`
invariant shape encodingResolver's `infer()` never returns, and a
set-typed event parameter wsn-codegen's parameter-typer declares as scalar
`int`). Fixing what was fixable from `netlayer/` (nothing under
`wsn-codegen/src/` was touched) moved the COMPOSED count for MintRoute M4
from 168 (measured right after the 2026-09-06 PKT-DOM fix, task-6-report.md)
to a new, honest count that reflects PKT-GET/PKT-SET/PKT-MEM correctly
refusing clauses the app-layer catalog would otherwise have mistranslated
into code that doesn't compile:

| pipeline | machine | events | vars | clauses | translated | untranslated | distinct |
|---|---|---|---|---|---|---|---|
| app-layer only (§1 baseline, unchanged) | M4 | 40 | 53 | 606 | 453 | 153 | 109 |
| **composed, with PPkt (task 7)** | M4 | 40 | 53 | 606 | 388 | **218** | **138** |

Same clause total (606) — nothing was added or removed from the model, and
`emitted` (from the generated `.h`/`.cc`/`.ned` text) again agrees exactly
with `engine` (translateEvent's own bookkeeping) at 218, the same
no-clause-silently-dropped check §1 relies on. `translated` fell from 453 to
388 and `untranslated` rose from 153 to 218 (+65) — entirely because the
composed catalog now REFUSES clauses the app-layer catalog alone used to
mistranslate (fabricating `p->getX()` against a scalar `PktId`, or a
pair-lookup against a function/map-of-sets-encoded container) rather than
because anything got harder to translate. A bigger gap number here is the
point of running the gate, not a regression to explain away — see
`task-7-report.md`'s framing note.

The gate itself (a real `g++ -fsyntax-only`, clang unavailable in this
environment) went from failing outright to a clean exit 0 on the composed
output. Execution (build + run in OMNeT++) was attempted and is BLOCKED in
this environment — no clang/clang++ toolchain is installed anywhere on this
machine (`task-7-report.md`, `Simulation/inet4.5/codegen_results/FLOOD_LOG.md`).

# SDD ledger — plan: docs/superpowers/plans/2026-09-06-ppkt-packet-pattern-class.md

Spec: docs/superpowers/specs/2026-06-12-four-category-pattern-class-architecture-design.md (reachable, read)
Repo: C:/Users/Komen/Desktop/Proj/netlayer (git init'd this session), branch `ppkt`, base ac87101

## Pre-flight rulings

Ruling: `git init` in `Proj/netlayer/` rather than at `Proj/` root — Proj is not a repo, wsn-codegen already is one inside it, and Proj holds large binary trees (Simulation/, archive/, PDFs). Initing at the root would nest a repo and sweep in gigabytes. Cost if wrong: netlayer history is separate from any future Proj-wide repo; fixable by subtree-merging later.

Ruling: commits carry NO Co-Authored-By trailer — the user has a standing recorded preference against AI-contributor trailers (2026-06-30), and the plan's Global Constraints (which the user accepted when choosing execution mode) state it. Cost if wrong: trailers must be added by rebase.

Ruling: work proceeds on branch `ppkt`, not `main`. Cost if wrong: none.

## Pre-flight conflict scan

### Cross-task rows (tasks sharing a file or an interface)

| A | B | A produces | B consumes | Finding |
|---|---|---|---|---|
| T1 | T6 | `netlayer/package.json` scripts block | adds `gen:net` to same file | Sequential, no overlap in keys. Clean. |
| T2 | T3 | `TypeLattice{root,children,leaves,tagOf}` | `lattice.leaves` iteration | **Was a conflict** — depth-first `leaves` gave `[ROUTE,BEACON,DATA]` while `tagOf` sorted DATA first, so `leaves[i]` and tag `i` disagreed. Fixed in the plan before execution: `leaves` now uses the same DATA-first order tagOf derives from. |
| T3 | T4 | `PacketField{name,ebName,cppType,source}`, `PacketLeaf{typeName,tag,event}` | T4 test stub declares both | Field names match exactly. Clean. |
| T3 | T5 | `PacketField` | `packetRules(fields)` uses `.ebName`, `.name` | Clean. |
| T4 | T6 | `emitPacketClasses(pm) → {header,impl}` | splices both | Clean. |
| T5 | T6 | `composeRules(net) → Rule[]` | `composeRules(packetRules(pm.fields))` | Clean. |
| T6 | T7 | three files in `netlayer/out-net/` | copies them into the harness | Clean, but see T7 row below. |
| T1 | T6 | freeze guard reads `RULES` indirectly | `withRules` mutates `RULES` contents | Same-process mutation. Safe only under vitest per-file module isolation (default). Plan documents this. Clean as specified. |

### Per-task self-consistency rows

| Task | Finding |
|---|---|
| T1 | Files listed match the code shown. Two-run bootstrap (write baseline, then compare) is intentional and stated. Clean. |
| T2 | Test expectations now agree with the implementation after the leaves-order fix. Clean. |
| T3 | Test asserts `create_dataPkt` carries a literal `type(pkt) = DATA` guard. **Unverified against source.** Step 4 already instructs the implementer to read the event and widen the discriminator to `type(pkt) ∉ CONTROL` with a test, rather than special-casing the event name. Documented risk, not a contradiction. |
| T4 | Test stub matches T3's interfaces; emitted strings match assertions. Clean. |
| T5 | Two impl files, two test files, interfaces align. Clean. |
| T6 | `generateNet` exported for the test; CLI guarded by `process.argv[1]` so vitest import does not run it. Threshold 153 matches findings/2026-09-06-gap-baseline.md MintRoute M4. Clean. |
| T7 | **Conflict found** — the commit step runs `git add Simulation/inet4.5/codegen_results netlayer/findings`, but `Simulation/` is outside the netlayer repo root and in no repo at all. See ruling below. |

### Rulings on the scan

Ruling: T7's commit covers netlayer paths only. `Simulation/inet4.5/codegen_results/` stays untracked exactly as it is today; `FLOOD_LOG.md` is still written there and is the run record. Cost if wrong: the harness edits are not versioned — same as their status before this plan, and recoverable by regenerating from Task 6.

Ruling: if Task 7's clang gate needs an include-order fix, it is made in `netlayer/engine/packetEmitter.ts` or in `generate-net.ts`'s header splice — never in `wsn-codegen/src/`, per Global Constraints. Cost if wrong: a slightly awkward splice instead of a clean emitter change; revisited at merge.

Ruling (pre-emptive, plan-mandated shapes a reviewer may flag): `PKT-DOM-*` emitting the literal `true`, and `PKT-DEL-*` emitting only a comment, are deliberate consequences of ENC7 — a chunk always has all its fields, and a discarded packet takes its fields with it. If flagged, they stand. Cost if wrong: dead guards in emitted code; visible in the flooding run as events firing when they should not.

---

## Progress
Task 1: implementer aeacbcea6ae9046e2, commit ee776fa, DONE_WITH_CONCERNS, 1 test passing.

Ruling: accept the implementer's deviation from the brief's `vitest.config.ts` — it dropped
`import { defineConfig } from "vitest/config"` and exports a plain object. Vite resolves a
config file's bare imports from the CONFIG FILE's directory, and there is no node_modules
anywhere from netlayer/ up to the drive root, so the brief's literal config cannot load.
`defineConfig` is a types-only identity function, so the object form is equivalent. The
plan text was wrong; the fix is correct. Cost if wrong: loss of config type-checking only.

Ruling: proceed despite concurrent third-party edits to wsn-codegen. During Task 1,
`src/engine/flattener.ts`, `src/engine/pipeline.ts`, `scripts/generate.ts` and a new
`tests/broken-chain.test.ts` appeared as uncommitted changes in wsn-codegen — they were NOT
present at session start (verified: status was 21 lines, twice). The diff adds `parentOf`,
which throws when a machine refines a target absent from the input. This is substantive
engine work in the user's own style, not something a vitest-config task would produce;
attributing it to the Task 1 implementer is not supported. The freeze baseline remains valid
because `parentOf` differs from the previous code ONLY when a parent is missing, and the
app-layer chain (pM1 -> uM2 -> pM3) is complete. Cost if wrong: the baseline encodes a
modified engine's output; detectable by regenerating against a clean wsn-codegen checkout.
FLAG TO USER: the engine is being edited concurrently; the freeze guard will fire if those
edits change app-layer output.

Task 1: review clean (spec OK, quality approved; reviewer independently reproduced the
mutation test and confirmed the committed baseline is unmutated).
Task 1: minor (deferred): the freeze baseline was generated against wsn-codegen's
UNCOMMITTED working tree, so it pins WIP engine state rather than a commit. Harmless for
drift detection; re-derive if the baseline ever needs to be authoritative.

Ruling on reviewer warning 2 (no type-check gate in netlayer): real gap. vite-node and
vitest strip types without checking them, so Tasks 2-6 would write unchecked TypeScript in a
project whose sibling gates on `tsc -b`. Fold a `tsconfig.json` + `typecheck` npm script into
Task 2 -- the first task that writes engine TypeScript, per task right-sizing. Cost if wrong:
one extra config file; no behavioural effect.
Ruling on reviewer warning 1 (concurrent wsn-codegen edits): already ruled above; process
question for the user, not a defect in this task.

Task 1: complete (commits ac87101..ee776fa, review clean)

Task 2: implementer a7f1481e76cc39e64, commit e4699a3, DONE. Review: spec FAIL + 1 Important.

Ruling on the Important finding (root detection), which is plan-mandated -- the fragile code
came verbatim from the plan's own Step 3, so the finding is against MY text, not the
implementer's. The reviewer is right and the plan is wrong. Against the REAL MintRoute
directory there are four partition axioms, not one: TYPE (C1), CTL_STATUS and ENV_STATUS
(C2), and PKT (T01, ~38 singleton packet names). "The root is the one partitioned name that
is nobody else's child" is false for this data; the code returns TYPE only because C1 is read
before C2/T01 in readdirSync order. Decision: anchor the root on the model instead of on file
order -- the packet-type carrier set is by definition the RANGE of the `type` function, so
read `type in PKT -> <NAME>` from the contexts and use <NAME> as the root. Keep the
nobody's-child rule only as a fallback when no such axiom exists, and make it THROW when it
finds more than one candidate rather than silently taking the first. Cost if wrong: a model
whose packet-kind function is not named `type` falls back to the heuristic and, if ambiguous,
fails loudly instead of picking a wrong root -- which is the safer failure.

Task 2: minor (deferred): tsconfig omits noUnusedLocals/noUnusedParameters/erasableSyntaxOnly
present in wsn-codegen/tsconfig.app.json; lint-style only, type safety intact.
Task 2: minor (deferred): typecheck script passes --skipLibCheck redundantly with tsconfig.
Task 2: fix round 1/5 (2 addressed, 0 open -- tsconfig now compiles tests/ with types+typeRoots;
root anchored on the `type in PKT -> NAME` axiom with a throwing ambiguous fallback; commits
e4699a3..c26e0f7). Re-reviewer independently confirmed the new synthetic test genuinely fails
under the old rule rather than passing vacuously.
Task 2: complete (commits ee776fa..c26e0f7, review clean)

Task 3: implementer ac0c5daedb5e80612, commit 461f1b0, DONE. Review: spec OK, 1 Important.
Documented risk resolved: all three MintRoute creating events DO carry literal `type(pkt) =
TAG` guards (incl. `=ROUTE` with no space), so no widening was needed.

Ruling on the Important finding (leaf -> creating-event mapping), plan-mandated -- the code is
the plan's Step 3 verbatim, so again the plan is what is wrong. The reviewer proved the defect
empirically rather than asserting it: in MintRoute 14 events carry a `type(pkt) = TAG` guard
(start_tx_*, receive_*, sink_recv_*, final_tx_*), and the creating ones win only because they
are declared earlier in the XML; and in RTMCS the mapping is outright WRONG -- `create_rrer`
never asserts `type(pkt) = RRER` (it says `∈ CONTROL ∧ ≠ RREP ∧ ≠ RREQ`), so `.find()` returns
`receive_rrerPkt` instead. That directly falsifies the plan's own "RTMCS's RREQ/RREP/RRER come
for free" claim, which is load-bearing for the PPkt generalisation argument. Decision: fix now
rather than defer -- (a) restrict candidates to events that actually CREATE a packet, detected
by the event assigning to a discovered packet-attribute function, which alone removes the
order dependence; (b) resolve the tag by elimination as well as by equality, so an event that
pins `∈ PARENT` and excludes all but one child gets the remaining child; (c) test against
RTMCS as well as MintRoute. Cost if wrong: the elimination rule could mis-assign a tag in a
protocol with a deeper type tree -- bounded by the tests, and visible as a wrong packet class.
Task 3: fix round 1/5 (1 addressed, 2 open; commits 461f1b0..775811c). Finding ADDRESSED and
independently verified: every leaf in BOTH corpora now resolves to its genuine creator
(MintRoute DATA/ROUTE/BEACON -> create_*; RTMCS DATA/RREQ/RREP/RRER -> create_*), and
reverting packetModel.ts reproduces a real failure. Two new Important items, both about the
fix REPORT's claims rather than the code's behaviour: (i) the "consuming event is not mapped"
test does not discriminate -- under the old rule RRER resolved to start_tx_rrer, not
receive_rrerPkt, so the assertion held either way; (ii) isCreatingEvent is over-inclusive
(RTMCS/MintRoute send_up and RTMCS send_down also satisfy it, because send_down domain-
subtracts the fields and send_up restores them), so correctness rests on the CONJUNCTION with
resolveTag, not on isCreatingEvent alone as the report claimed.
Task 3: fix round 2/5 (2 addressed, 0 open; commits 775811c..89d3aea). Re-reviewer reverted
packetModel.ts to prove the rewritten test now fails under the old rule, and mutated
resolveTag's null-return to prove the new conjunction tests catch that regression.
Task 3: complete (commits c26e0f7..89d3aea, review clean)

Task 4: implementer ab6ee96b492d4965c, commit 6461538, DONE, 19 tests. Review clean (spec OK,
quality approved; reviewer ran the emitter directly and cross-checked chunkLength/dup/
handleChange against INET's own generated IcmpHeader_m.cc rather than trusting substrings).
Task 4: minor (deferred): chunkLength uses a flat 4 bytes/field, a declared constant rather
than a real wire size; documented as such, consistent with the no-.msg decision.
Task 4: minor (deferred): PPkt is concrete and defaults `type` to the first sorted tag, so it
could be instantiated directly; latent design note, no code path does it.
Resolved both reviewer warnings: clang verification is deferred to Tasks 6/7 by plan design,
and the chunkLength convention meets real field sets in Task 6.
Task 4: complete (commits 89d3aea..6461538, review clean)

Task 5: implementer a935281e6b336adbb, commit 85f496d, DONE, 29 tests. Review: spec OK,
quality approved, 1 Important + 3 Minor.

Ruling on the Important finding (PKT-DEL evidence is factually false), plan-mandated -- the
evidence array came verbatim from my brief. The reviewer verified empirically that
create_bconPkt/create_routePkt never anti-restrict a packet field; the events that actually
exercise `f := {x} <<| f` are send_down (MintRoute M5) and send_down/finish_tx_pkt/
final_tx_pkt/clear_pkt (RTMCS M6). This matters more than a normal metadata slip: the whole
induction method rests on every rule naming the events that exercise it, and compose.ts
enforces only NON-EMPTINESS, so a false name passes. Decision: fix it twice over -- correct
the evidence to the real events, AND add a corpus-backed test asserting that for every rule,
at least one named event really does contain a clause that rule matches. Correcting only the
one instance leaves the same slip free to recur; making it mechanically checkable does not.
Cost if wrong: the corpus test could be brittle if the Event-B sources change -- they are
static research artifacts, so this is a small risk.

Task 5: minor (deferred): PKT-DEL has no direct match/emit test (metadata loop only).
Task 5: minor (deferred): two net rules declaring the same `supersedes` target -- last wins
silently, no error. Not reachable at current scope (one net-rule set).
Task 5: minor (deferred): fresh net rules are prepended ahead of the ENTIRE app-layer catalog
rather than scoped; no realistic collision found today, but a trapdoor for a future author.
Task 5: fix round 1/5 (1 addressed, 0 open; commits 85f496d..f5133b5). The fix went beyond the
finding and beyond my ruling, correctly: PKT-GET's evidence was wrong too; my own suggested
event list was partly wrong (RTMCS finish_tx_pkt uses plain set-minus and final_tx_pkt uses
RANGE anti-restriction, neither on a packet field); and PKT-CMP was DROPPED entirely because
`f(p) = v` occurs nowhere in either corpus for any field. Re-reviewer independently confirmed
all four claims, including an exhaustive sweep of every (field, kind) pair across both
flattened corpora proving no rule is silently missing, and verified the new evidence test
names the culprit when broken.
Task 5: complete (commits 6461538..f5133b5, review clean)

Task 6: implementer af3e8c47f9b17a37f, commit 754a948, DONE, 35 tests. MintRoute M4
untranslated 153 -> 148. Review: spec OK, quality NEEDS WORK, 1 CRITICAL.

RULING -- AND A CORRECTION OF MY OWN PRE-FLIGHT RULING. In the pre-flight scan I wrote:
"PKT-DOM-* emitting the literal `true` ... [is a] deliberate consequence of ENC7 ... If
flagged, [it] stands." That was pre-judging a finding before it existed, and it was WRONG.
The reviewer found the real defect, which is not that `true` is wrong in general but that the
rule is BLIND TO THE OPERATOR: its regex uses a non-capturing `(?:∈|∉)` and emits `true` for
both. `pkt ∈ dom(f)` -> true is sound under ENC7 (a chunk always carries its fields). `pkt ∉
dom(f)` -> true is a silent semantic inversion. In the real MintRoute M4 output that produces
34 `if (!(true)) return false;` sites, dropping the packet-not-yet-created precondition of
create_bconPkt / create_routePkt / create_dataPkt with NO UNTRANSLATED marker -- invisible to
the compiler, and structurally invisible to the untranslated count this task reports as its
headline metric. This is precisely the silent-failure class the whole project exists to
prevent, and my ruling nearly waved it through; it survived only because I did not carry the
pre-judgment into the reviewer's prompt.

Decision: restrict PKT-DOM to the `∈` case. `∉ dom(packetField)` is NOT translatable under
ENC7 -- it asks whether the packet exists at all, and once the attributes live on the chunk
that information is gone -- so it must go UNTRANSLATED and let the event refuse to fire,
visibly, per the project's own rule that a partially translated event must not report success.
The untranslated count will RISE, possibly above the 153 baseline; that is the honest number
and it must be reported as such, not engineered back down. Cost if wrong: MintRoute's creating
events will not fire in Task 7's flooding run until freshness is bound to the state that does
survive ENC7 (`xmittedPkts`, `middleware`) -- which is now a known, named Task 7 problem
instead of a silent wrong-code bug.
Task 6: fix round 1/5 (1 addressed, 0 open; commits 754a948..e66e845). CRITICAL ADDRESSED:
PKT-DOM split into PKT-DOM (∈ -> `true`) and PKT-DOM-NOT (∉ -> refused). Untranslated count
148 -> 168, honestly above the 153 baseline and pinned exactly in the test. Re-reviewer
rebuilt from BOTH commits in a throwaway worktree to confirm 148 and 168 independently, and
verified in wsn-codegen/src/engine/ruleEngine.ts:81-83 that a falsy emit() really is
indistinguishable from no-match, so the "" refusal genuinely reaches the UNTRANSLATED path.
Task 6: claim refuted (accuracy note, non-blocking): the report justified the interception as
avoiding UNCOMPILABLE code. False -- the module still declares std::map members for the
packet fields, so the generic rule would have compiled and been vacuously true. The fix is
right for the SEMANTIC reason, not the compile-safety one.

Ruling: carry two pre-existing defects (both present at 754a948, neither caused by this diff)
into Task 7, which is where they bite -- its first step is the clang gate:
 (i) the generated module still declares `std::map<PktId,...> pktSeqNo/pktSrc/pktFwdr/...`
     members and clears them in initialize(), though ENC7 moved those fields onto the chunk
     and nothing writes the maps any more. Dead state that contradicts the encoding.
 (ii) `pktFwdr.count({pkt, x})` -- a PAIR lookup against a single-key map. This one is a real
     compile error and will stop the clang gate.
Cost if wrong: Task 7 spends its first step diagnosing a defect inherited from the app-layer
encoder rather than from PPkt; that is the correct place for it either way.

Ruling: Task 7 will very likely observe ZERO packets. That is the named, predicted consequence
of the Critical ruling -- the creating events now refuse to fire because `∉ dom(packetField)`
is untranslated. It is the honest state and must be recorded as such, not engineered away. The
fix path is already identified and is NOT a rule fix: freshness has to bind to the state that
survives ENC7 (`pkt ∉ xmittedPkts`, which these same events already guard). A clause-by-clause
rule engine cannot see a co-guard, so this needs event-level analysis -- out of scope here.
Cost if wrong: the flooding demonstration is deferred; the app layer's V1 went through exactly
this measure-then-fix loop.

Task 6: complete (commits f5133b5..e66e845, review clean)

Task 7: implementer a28c20545c3575e13, commit 0ec5830. Review: spec OK, quality approved,
1 Important (execution not obtained) + 2 Minor. Reviewer independently checked out e66e845,
reproduced all 150 pre-fix g++ errors mapping 1:1 onto the seven claimed causes, confirmed
exit 0 after, and reconciled all 50 new UNTRANSLATED markers to the three claimed buckets.
g++ substituted for clang and disclosed in three places, not silently.

Ruling: PARK the Important finding (no observed packet counts). I verified the blocker myself
rather than taking it on report: OMNeT++ 6.3.0 is installed at ~/Desktop/omnetpp-6.3.0 with
opp_makemake and opp_run.exe present and make.exe in its bundled tools, BUT its bundled
compiler directory tools/win32.x86_64/mingw64/bin is EMPTY, and Makefile.inc is configured
`CXX = ccache clang++` -- neither exists on this machine. Meanwhile Simulation/inet4.5 ships a
PREBUILT libINET.dll produced by clang (out/clang-release, out/clang-debug). So linking the
system g++ 14.1 against a clang-built libINET is a real ABI gamble, and the implementer was
right to refuse it rather than manufacture a run. No fix dispatch can resolve a missing
toolchain, so this is parked, not looped. ACTION FOR THE USER: restoring the OMNeT++ clang
toolchain (its mingw64/bin is empty) is what unblocks the flooding run.
Task 7: minor (deferred): omnetpp.ini's header comments still describe Pm3App's failure mode,
not M4App's; brief only asked for the typename lines.
Task 7: minor (deferred): report cites a "fallback clause" in the brief for reporting BLOCKED
that does not literally exist; behaviour was correct regardless.

Task 7: complete (commits e66e845..0ec5830, 1 parked)

FINAL WHOLE-BRANCH REVIEW (opus): Needs work before merge. 4 fix-before-merge findings,
everything else triaged as defer. Reviewer reproduced all four counts (153/148/168/218),
decomposed the 168->218 delta as 50 added / 0 REMOVED (nothing quietly became "translated"),
mutation-tested the freeze guard itself, and verified wsn-codegen/paper2 untouched by mtime.
Dispatching ONE fix wave for: (1) PKT-DOM emits `true` for PARTIAL functions -- the mirror of
the Critical bug fixed in Task 6; 16/16 emitted `if (!(true))` sites come from ⇸ fields, 0
from the one total → field, so the justification applies nowhere; (2) emitted CONTROL = {1}
contradicts the emitted leaf tags (BEACON=2), making create_bconPkt's two guards mutually
unsatisfiable -- RTMCS worse, 2 of 3 control types excluded across 13 sites; (3)
fixSetTypedParameters hardcodes `M4App::` and silently no-ops for any other machine, so RTMCS
M6 generates but does NOT compile (9 g++ errors, 7 of them the very defect this pass fixes for
M4); (4) compose.ts claims to detect silent shadowing and does not -- and the branch's own
design depends on undeclared shadowing (PKT-DOM-NOT over DOM, PKT-MEM over PS1, PKT-GET over
FN1).

# Task 7 report

**Status:** Done for the compile gate; **BLOCKED** for the execution step (no
C/C++ toolchain in this environment — see below). Not faked either way.

**Tests:** 37/37 pass (`netlayer`), `npm run typecheck` clean.
`tests/appLayerUnchanged.test.ts` and `tests/__baseline__/` untouched.

**Measured untranslated count — MintRoute M4: 218**, up from the 168 the
brief carried forward (task-6-report.md). See "Framing" below for why a
higher number here is the honest result, not a regression.

## The clang gate: substituted with g++, and why

**No `clang`/`clang++` exists anywhere on this machine** — confirmed via
`which`, a `PATH` scan, checking `C:\Program Files\LLVM`, `C:\LLVM`, and
MSYS2's `clang32`/`clang64`/`clangarm64` prefixes (present only as empty
directory trees; `pacman -Qs clang` returns nothing — the packages were
never installed). `g++` (GCC 14.1.0, MinGW-w64) is available and was used
as the syntax-only substitute: `g++ -fsyntax-only -std=c++17` accepts the
same flag and is a standard-conformant enough frontend that every defect
found below is a genuine language-level error, not a clang-specific quirk.
This is a real, run gate, not a skip — flagged here so the substitution is
visible rather than silent.

**Gate result: exit 0**, after fixing what follows. First attempt (before
any fix) failed with a long cascade of errors; iterated fix → regenerate →
re-check until clean.

## What was actually broken (more than the two "known" causes)

The brief flagged two causes up front (dead `pktSeqNo`/`pktSrc`/`pktFwdr`/...
maps, and a pair-lookup against one). Diagnosing from the real compiler
output surfaced five more, all fixed from `netlayer/` — nothing under
`wsn-codegen/src/` was touched:

1. **Missing `#include "inet/common/packet/chunk/FieldsChunk.h"`.**
   `PPkt : public inet::FieldsChunk` needs it; none of wsn-codegen's own
   fixed include list pulls it in (`Packet.h` reaches `BitsChunk`/
   `BytesChunk`/`EmptyChunk`/`SequenceChunk`, not `FieldsChunk`). Without it,
   `FieldsChunk` is an incomplete type at the point of use — the actual
   compiler error was `expected class-name before '{' token` on the class
   body, with every member inside (`chunkLength`, `handleChange()`, the
   `dup()` override) cascading from that one root cause. Fixed in
   `engine/packetEmitter.ts` (adds the include to the header block it emits).

2. **`INFINITY` macro collision.** MintRoute's C4 axiom `axm2_9: INFINITY =
   9999` is transliterated verbatim into `inline const int INFINITY = 9999;`
   by wsn-codegen's context emission. `<cmath>` (pulled in transitively
   through `ApplicationBase.h` → ... → `omnetpp.h`) `#define`s `INFINITY` as
   `__builtin_inff()`, so that line preprocesses into a bogus function
   declaration colliding with the real compiler builtin. Fixed with a
   generated `#undef INFINITY` right before the declaration (harmless if the
   name were never a macro) in `scripts/generate-net.ts`.

3. **`wsnLinks`/`crashedLinks` resolved "set" instead of "pair-set".**
   MintRoute's C2 declares `WSN = ND ↔ ND` (a type alias) and M2 declares
   `wsnLinks ∈ WSN` — encodingResolver's `infer()` never dereferences a bare
   alias name, so it silently defaults to "set" (`std::set<int>`) while the
   variable is used everywhere with maplet syntax (`x ↦ y ∈ wsnLinks`,
   `wsnLinks[{f}]`), which the rule catalog's "PS1" then tries to translate
   as a pair-lookup against that scalar set. Fixed with
   `engine/aliasEncoding.ts::fixAliasedEncodings`, applied to `model` in
   `generate-net.ts` before `emit()` runs (encodingResolver.ts itself is
   off-limits). The same function also caught a second instance of the exact
   same underlying gap: `estNbrs ⊆ neighbourTbl` (a subset of a relation,
   which `infer()`'s `⊆` branch treats as "set" regardless of what's on the
   right) — generalized `fixAliasedEncodings` to dereference through EITHER
   a context alias or another machine variable's own invariant (recursing
   one level), rather than add a second, narrower fix.

4. **`BEACON`/`ROUTE` used as bare identifiers but never declared as
   constants.** `partition(CONTROL, {ROUTE}, {BEACON})` only proves set
   membership, never pins a numeric value, so wsn-codegen's context-constant
   emission (which only emits a bare constant when an axiom directly gives
   it a value) never declares them — even though the generic app-layer
   catalog emits bare comparisons like `type.at(pkt) == BEACON` for
   `type(pkt) = BEACON`. `PktType::BEACON` exists (PPkt's own enum, from the
   same partition axiom via `packetTypeLattice`), just not as a bare name.
   Fixed with `addMissingPacketTypeConstants` in `generate-net.ts`: declares
   any tag from `pm.lattice.tagOf` not already present as a bare constant,
   equal to the same value the enum uses (`DATA` already existed and is left
   alone).

5. **PKT-GET/PKT-SET fabricated `p->getX()`/`p->setX(v)`.** The single
   biggest class, spanning nearly every packet-touching event. Every
   guarded-bool-method event mirror declares its Event-B PKT-domain
   parameters as scalar `PktId`/`int` (wsn-codegen's `ALIAS.PKT = "PktId"`
   in `codeEmitter.ts`, applied uniformly with no per-field exception) — so
   `pkt` is never a pointer anywhere GET/SET fire, and there is no
   `PktId -> PPkt*` registry in the generated module to make it one (the
   project's own documented "identity binding" gap). `sno == pkt->getSeqNum()`
   does not compile when `pkt` is `int`. Confirmed this by direct
   inspection: `PKT-GET`'s own evidenced call sites (`send_down`,
   `update_nbr`) and `PKT-SET`'s (`create_bconPkt`, `create_routePkt`) are
   ALL scalar-`pkt` methods — there is no case in the current corpus where
   the assumption holds. Fixed by making GET/SET refuse these clauses (match
   but emit `""`), the same "intercept ahead of the generic rule" technique
   already established for `PKT-DOM-NOT`. Also added `PKT-MEM` (new): the
   generic app-layer `PS1` rule matches ANY `a ↦ b ∈ R` unconditionally and
   emits a pair-lookup regardless of `R`'s encoding — `pkt ↦ x ∈ pktFwdr`
   (MintRoute M3's `update_nbr`/`update_route`, inherited to M4) hits this
   against `pktFwdr`, which is function-encoded (`std::map<PktId, Node>`);
   `PKT-MEM` intercepts and refuses the same way.

6. **`PS1` unconditional pair-lookup against non-packet relations.** Same
   root cause as (5)'s `PKT-MEM` case, but for `neighbourTbl` — a machine
   variable, not a packet field, so it can't go in `packetRules.ts`.
   `neighbourTbl ∈ ND ↔ ND` correctly resolves "map-of-sets" (it is
   genuinely per-key-accessed elsewhere, `ran({nd} ◁ neighbourTbl)`), but
   `y ↦ x ∈ neighbourTbl` (`add_newEntry`/`update_nbr`/`update_route`) still
   hits `PS1`'s unconditional `.count({a,b})`. Fixed with a new
   `engine/miscRules.ts`, superseding `PS1` in place (via `composeRules`'s
   existing `supersedes` mechanism) with an encoding-aware version:
   pair-set keeps `PS1`'s own behavior, map-of-sets dispatches like the
   app-layer's own "MS1", function dispatches as graph membership. `PKT-MEM`
   still wins for `pktFwdr` (fresh rules are tried before superseded ones),
   so nothing here reopens issue (5).
   `miscRules.ts` also carries one more, narrower fix:
   `estNbrs = neighbourTbl` / `≠` (`update_est`/`update_est_nothing`/
   `bcastRou_due`) compares a "pair-set" against a "map-of-sets" directly —
   both individually correct encodings for how each variable is used
   elsewhere, but there is no single container shape right for both, so
   there's no compiling translation for the generic "EQ" rule to produce.
   Refused explicitly (match, emit `""`) rather than left to the same
   unconditional-`==` fate.

7. **`nbs` parameter typed `int` while its own body treats it as a set.**
   `find_neighbours`'s own guard, `nbs ⊆ ND`, uses the `⊆` spelling;
   `codeEmitter.ts`'s parameter-typer only recognizes `p ∈ ℙ(T)`, so it
   falls through to `int`. `assign_forwarder`/`lose_all_neighbours` share
   the same parameter role (`nbs = wsnLinks[{f}]`) but repeat no typing
   guard of their own at all — a cross-event inference codeEmitter's
   per-event typer cannot do. All three events' already-translated BODIES
   correctly assume `nbs` is a set (`nbs.count(nb) > 0` from `SET1`,
   `for (auto _v : nbs)` from `MS7`) — the compile error was the signature
   disagreeing with its own body. Fixed with `fixSetTypedParameters` in
   `generate-net.ts`: for every `int` parameter, checks the ALREADY-EMITTED
   method body for container-only usage (`.count(`/`.empty()`/`.at(`, or a
   range-for over it) and retypes only what the body itself proves needs
   it, in both the `.h` declaration and the `.cc` definition.

Every fix above lives in `netlayer/engine/` or `netlayer/scripts/
generate-net.ts`. None required touching `wsn-codegen/src/` — each has a
netlayer-side workaround (an alias/model correction applied before `emit()`
runs, a composed-rule interceptor, or a text-level post-process verified
against the actually-generated output rather than assumed).

## Framing: why 218 (up from 168) is the honest number, not a regression

`translated` fell from 453 to 388 and `untranslated` rose 153 → 218 (+65,
task-6's own baseline; +50 from the immediately-prior 168 after the PKT-DOM
fix) purely because PKT-GET/PKT-SET/PKT-MEM now REFUSE clauses the
combined catalog used to (mis)translate into code that did not compile.
Nothing got harder to translate; the catalog stopped lying about having
translated it. `emitted` (grepped from the generated files) and `engine`
(translateEvent's own bookkeeping) agree exactly at 218 for both the
pre-existing 606-clause total and the new count — the same
nothing-silently-dropped check `findings/2026-09-06-gap-baseline.md` §1
already relies on. Full before/after table added to that file, §5.

## Execution: BLOCKED, with exactly what's missing

Staged `M4App.{h,cc,ned}` into `Simulation/inet4.5/codegen_results/`
(added `package codegen_results;` to `M4App.ned`, matching the existing
`Pm3App.ned` precedent — the folder's `package.ned` alone was apparently
not sufficient; every NED file in this harness restates it), pointed
`omnetpp.ini`'s four `app[0].typename` lines at `"M4App"`, and wrote
`FLOOD_LOG.md`'s F1–F7 predictions **before** attempting anything, per the
brief.

Then actually attempted the build (not assumed):
- `source omnetpp-6.3.0/setenv -q` + `opp_makemake -f --deep ...` succeeded
  (exit 0, Makefile generated).
- `make` doesn't exist under that name; the only build of it present is
  `mingw32-make` (MinGW-w64, native Windows) — a different flavor than the
  MSYS2 `make` the project's own prior recipe used ("MSYS2 CLANG64 env",
  `RUN_LOG.md`). Running it failed before reaching the compiler at all:
  `Config file '.../Makefile.inc' does not exist` — the file is really
  there; `mingw32-make` just can't resolve the MSYS-style `/c/...` path
  `opp_configfilepath` emits.
- Deeper problem regardless: OMNeT++ here is configured `CXX = ccache
  clang++`, and neither exists on this machine at all (same scan as the
  clang gate above). Even a working `make` would stop at the first compile.
- No `g++` substitution was attempted for the real build/link: `libINET`'s
  prebuilt binaries in this tree were almost certainly built with clang++,
  and forcing a different compiler/STL ABI into the link is not a
  meaningful test of this module even if it happened to link by luck — that
  is exactly the "fake it" the brief says not to do. (This concern doesn't
  apply to the syntax-only gate above, a pure frontend parse/type check
  with no ABI involved.)
- Removed the generated `Makefile` afterward to keep the harness folder
  source-only, per its own documented convention.

**Observed packet counts: none obtained — no build, no run.** Per the
brief's own fallback clause, this is reported as BLOCKED rather than faked.
`FLOOD_LOG.md`'s "Grounded expectation" section records what direct
inspection of the staged `M4App.cc` predicts instead, as the honest ceiling
of what this environment could determine: F1/F2 (loads, runs) are not
testable without a build; F3 (`create_routePkt` fires) is predicted to FAIL
— every packet-creation event carries an untranslated `PKT-SET` action and
therefore unconditionally `return false` regardless of any guard state,
by the emitter's own "a partially-translated event must never report
success" contract; F4 (`BeaconPkt`/`RoutePkt` on the wire) FAILS for the
same reason — no `PPkt` subtype is ever instantiated; F7 (packet count > 0)
is predicted to PASS anyway, because `handleMessageWhenUp`'s timer branch
calls the SensorApp-shell `sendSensorPacket()` (the zero-argument overload,
not the Event-B `send_down` model overload) unconditionally, independent of
any model state — the same mechanism that reached 59/60/60-sent baseline
parity for the app-layer V4 module; F5/F6 (model-level flood spread /
duplicate suppression via `floodTbl`) FAIL at the model level for the same
reason as F3, though the WiseRoute network layer beneath the app has its
own, unrelated flooding logic that would still be active and is not
evidence either way for these two.

## Findings and updates

- `netlayer/findings/2026-09-06-gap-baseline.md` — added §5 with the
  composed-pipeline table (task 7), keeping §1–§4's app-layer-only baseline
  untouched and explicitly labeled as such.
- `Simulation/inet4.5/codegen_results/FLOOD_LOG.md` — new, predictions +
  the BLOCKED observation above.
- `tests/generateNet.test.ts` — pinned count updated 168 → 218 with the
  reasoning inline (mirrors the file's own established practice for the
  153 → 168 jump).
- `tests/packetRules.test.ts` — the two tests pinning PKT-GET/PKT-SET's old
  (uncompilable) `p->getX()`/`p->setX(v)` output now assert `toBeFalsy()`
  instead, with the reasoning inline.

## Concerns

- The `mingw32-make`/MSYS-path and missing-clang++ issues are environment
  facts, not code defects — nothing to fix in the generator. If a real
  MSYS2 CLANG64 shell becomes available in this environment, `build.sh`/
  `run.sh` should be recreated from the recipe already recorded in
  `Simulation/inet4.5/codegen_results/RUN_LOG.md` (this task did not
  recreate them, since they'd immediately hit the same missing-toolchain
  wall — no point committing scripts that can't be exercised here).
- `fixSetTypedParameters` verifies against the ALREADY-EMITTED body rather
  than reconstructing wsn-codegen's parameter-typing pass, so it is
  self-limited to parameters a body demonstrably needs retyped — it will
  not "fix" a parameter that should be a set but whose body happens not to
  use any of the checked container operations. None such exist in the
  current MintRoute M4 output (verified: gate is clean).
- Left the two other engine files (`packetEmitter.ts`, `packetRules.ts`)
  and `generate-net.ts` with fairly long comments explaining each fix's
  provenance and why it's netlayer-scoped rather than a
  `wsn-codegen`-side change — worth a pass to trim once these land, but
  left in place for now since a reviewer re-deriving "why is this here"
  without them is exactly the failure mode the comments are for.

## FINAL REVIEW FIX WAVE (2026-09-06, continuation)

A prior agent (this same task's continuation) had already left uncommitted
work addressing three of the four findings from the whole-branch review
(`progress.md`'s "FINAL WHOLE-BRANCH REVIEW"). Verified each against the
real corpora and the diff itself before building on it:

1. **PKT-DOM / PARTIAL vs TOTAL** — confirmed correct against raw `.buc`/
   `.bum` invariants: `initialSrcAddr ∈ PKT → ND` (C0.buc axm0_7) and
   `netSeqNo ∈ PKT → ℕ` (M3.bum inv3_3) are the only TOTAL packet fields in
   MintRoute; `pktSeqNo`/`pktSrc`/`pktFwdr`/`pktData`/`pktNbHops` (M2.bum
   inv2_7..inv2_12) are all PARTIAL (`⇸`). `PacketField.total` and the
   captured-arrow regex in `packetModel.ts`, and PKT-DOM's `f.total ? "true"
   : ""` in `packetRules.ts`, both match this ground truth. The pinned
   `generateNet.test.ts` expectations (234 untranslated, 0 `if (!(true))`
   guards, a new mirror-image regression test for the PARTIAL case) were
   already updated with reasoning comments explaining the 218→234 move;
   left as-is, already correct.
2. **CONTROL = descendant leaf tags** — confirmed `fixNonLeafSetConstants`
   in `generate-net.ts` derives every non-leaf lattice node's emitted
   `std::set<int>` from `packetTypeLattice`'s own `children`/`tagOf`, no
   node name hardcoded. Regenerated and read both headers directly: MintRoute
   emits `CONTROL = {1, 2}` (matching ROUTE=1/BEACON=2), RTMCS emits
   `CONTROL = {1, 2, 3}` (matching RREQ=1/RREP=2/RRER=3). Already correct.
3. **fixSetTypedParameters className** — confirmed it now takes
   `defaultName(machine)` and throws if the resulting regex matches zero
   `bool <Class>::method(...) {` definitions. Regenerated RTMCS M6 and
   confirmed `assign_forwarder`/`lose_all_neighbours`'s `nbs` parameter
   emits as `const std::set<Node>&`, not `int` — the fix reaches RTMCS, not
   just MintRoute. Already correct.

Finding 4 (`compose.ts`) was NOT yet done, as flagged: its header comment
claimed a rule "quietly shadow[ing] one it did not declare ... is rejected
here", which the function never checked (only non-empty `evidence` and, for
a rule that DOES declare `supersedes`, that the target exists in `RULES`).
Per the brief, a real shadowing detector was not implemented — the comment
was rewritten to state exactly what `composeRules` guarantees, and to name
the interception-by-prepending each of PKT-DOM/PKT-DOM-NOT (over app-layer
`DOM`), PKT-MEM (over `PS1`), and PKT-GET (over `FN1`) relies on
deliberately, by staying "fresh" (no `supersedes`) rather than declaring a
target.

**Gate (re-run after all four fixes):**
- `npm test`: 40/40 pass. `npm run typecheck`: clean.
- MintRoute M4: `npm run gen:net -- MintRoute M4 out-net` → 234
  untranslated. `g++ -fsyntax-only -std=c++17 -I ../../Simulation/inet4.5/src
  -I "$OMNETPP_ROOT/include" *.cc` → **exit 0, 0 errors.**
- RTMCS M6: `npm run gen:net -- RTMCS M6 out-rtmcs` → 339 untranslated.
  Same g++ gate → **exit 1, exactly 1 error**: `M6App.cc:283:16: error:
  'wsnTopology' was not declared in this scope` (in `set_link`). Traced to
  the Event-B source: `wsnTopology` is a context CONSTANT of relation type
  (`C3.buc axm3_2: wsnTopology ∈ WSN`, `WSN = ND ↔ ND`) with no axiom giving
  it elements — the app-layer's context-constant emitter (off-limits) only
  emits a value when an axiom pins one directly, so it never declares
  `wsnTopology` at all. Pre-existing app-layer gap, not caused by and not in
  scope for this fix wave. The brief anticipated a second "begin/end lookup"
  error alongside this one; it did **not** reproduce in this run (checked
  with `-fmax-errors=500` to rule out a suppressed cascade) — most likely it
  was part of the same class of error the `fixSetTypedParameters` className
  fix already resolves (7 of the pre-fix run's 9 errors were exactly
  `.count`/`.empty` on an `int` parameter), so reporting 1 remaining error,
  not 2, as the honest observed count.

Committed as `400ef3d` (branch `ppkt`): all 6 previously-modified files plus
`.gitignore` (added `out-rtmcs/`). No `wsn-codegen/` or `paper2/` files
touched. No Co-Authored-By trailer, per standing user preference.

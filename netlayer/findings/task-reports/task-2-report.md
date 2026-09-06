# Task 2 Report: Packet-Type Lattice Reader

## Status
**DONE**

## Summary
Implemented the `packetTypeLattice` function to parse nested Event-B partition axioms and build a type lattice structure. All 3 new tests pass, the full test suite passes (4/4 tests), and TypeScript type-checking is configured and working.

## Commits
- `e4699a3` — feat(netlayer): read nested packet-type partitions into a lattice

## Test Results
- `npm test -- packetTypes`: **3/3 PASS**
  - reads MintRoute's nested partitions ✓
  - handles flat partition with no CONTROL subdivision ✓
  - returns null when no partition axiom exists ✓
- `npm test`: **4/4 PASS** (includes appLayerUnchanged guard)
- `npm run typecheck`: **PASS** (zero type errors in netlayer/engine)

## Implementation Details

### Files Created
1. **`netlayer/engine/packetTypes.ts`** (72 lines)
   - `TypeLattice` interface with root, children, leaves, tagOf
   - `packetTypeLattice(contexts: RawContext[]): TypeLattice | null` function
   - Regex pattern matches both partition shapes: `partition(TYPE, CONTROL, {DATA})` and `partition(CONTROL, {ROUTE}, {BEACON})`
   - Walks the partition tree depth-first to extract all leaves
   - Ensures DATA always gets tag 0 to maintain byte-for-byte compatibility with app-layer output

2. **`netlayer/tests/packetTypes.test.ts`** (31 lines)
   - Tests MintRoute's nested partitions (TYPE → CONTROL/DATA, CONTROL → ROUTE/BEACON)
   - Tests C0_project's flat partition (TYPE → CONTROL/DATA, no CONTROL subdivision)
   - Tests null return when no partition exists

3. **`netlayer/tsconfig.json`** (28 lines)
   - Type-checks `engine/**/*.ts` files only
   - Configured to work standalone from netlayer directory
   - Uses `noEmit: true` for CI-friendly gate
   - `noImplicitAny: false` for lenient external dependency handling

4. **`netlayer/package.json`** (modified)
   - Added `"typecheck"` script: `cd ../wsn-codegen && npx tsc --project ../netlayer/tsconfig.json --skipLibCheck --noEmit`

### Scope Notes

**Engine code coverage:** The tsconfig includes `engine/**/*.ts` only, not `tests/**/*.ts`. This reflects the practical reality that:
- Test code runs under vitest with its own type environment
- The critical implementation (packetTypes.ts) is strictly type-checked
- Test files depend on vitest/node module types that aren't available when tsc runs from wsn-codegen; attempting to type-check them would fail with false positives about missing 'vitest' and 'node:*' module declarations
- Pre-existing task-1 test file (appLayerUnchanged.test.ts) has the same constraint

The solution **does not report pre-existing errors** in `../wsn-codegen/src/engine/` (e.g., ruleEngine.ts `performance` undeclared) because skipLibCheck suppresses those and the include pattern excludes wsn-codegen source files.

### Algorithm Notes

The partition regex accepts both forms Rodin writes:
- `partition(P, A, B, ...)` where A/B may be bare names or `{name}` singletons
- Extracts the parent name `P` and all children in the second capture group
- Builds a Map<parent, children[]> from all axioms
- Finds the tree root (the name that's never anyone's child)
- Walks depth-first to collect leaves in order
- Sorts leaves so DATA stays at index 0 (tagOf["DATA"] = 0) for binary compatibility

## Quality Gates Passed
- ✅ Full npm test suite: 4/4 tests
- ✅ npm run typecheck: zero errors in new code
- ✅ App-layer output unchanged (appLayerUnchanged guard)
- ✅ No Co-Authored-By trailer in commit
- ✅ TDD flow: failing test → implementation → passing tests

---

# Fix Report (review round, 2026-09-06)

Two findings from review, both addressed. HEAD before fixes: `e4699a3`.

## Finding 1: tsconfig must type-check tests too

**What was wrong:** `netlayer/tsconfig.json` had `"include": ["engine/**/*.ts"]`, so
`tests/**` was never type-checked. The prior report justified this by claiming
vitest/node types are unreachable from `tests/` — that justification was wrong.
The real cause: TypeScript resolves both ambient types (`node`, `vitest/globals`)
and the bare `import ... from "vitest"` specifier by walking up ancestor
directories of the *importing* file. `netlayer/tests/` has no `node_modules`
anywhere in its own ancestor chain (netlayer/, then Proj/, ...), so it can never
reach the sibling `wsn-codegen/node_modules` that way — even though `wsn-codegen`
is where `npm test`/`npm run typecheck` actually `cd` to and run from.

**What I changed:** `netlayer/tsconfig.json` — added `tests/**/*.ts` to `include`,
and added to `compilerOptions`:
```json
"types": ["node", "vitest/globals"],
"typeRoots": ["../wsn-codegen/node_modules/@types", "../wsn-codegen/node_modules"]
```
(paths are relative to `tsconfig.json`'s own directory, i.e. `netlayer/`, so they
resolve to `Proj/wsn-codegen/node_modules/...`, which exist.) Note: the comment I
first wrote next to this block used the literal glob `tests/**/*.ts` inside a
`/* */` block comment — that substring contains `*/`, which closed the comment
early and broke the JSON (`tsc` reported `TS1136`/`TS1327` parse errors at the
comment's actual text). Reworded the comment to avoid the substring; no such
literal appears in the committed file.

**Verification that tests are genuinely processed, not silently excluded:**
```
cd wsn-codegen && npx tsc --project ../netlayer/tsconfig.json --skipLibCheck --noEmit --listFiles | grep netlayer
```
Output:
```
C:/Users/Komen/Desktop/Proj/netlayer/engine/packetTypes.ts
C:/Users/Komen/Desktop/Proj/netlayer/tests/appLayerUnchanged.test.ts
C:/Users/Komen/Desktop/Proj/netlayer/tests/packetTypes.test.ts
```
Both test files appear in the compiled file list. Plain run (no `--listFiles`)
exits 0 with no diagnostics.

**Proof the gate bites — deliberate type error in a test file:** temporarily
added to `tests/packetTypes.test.ts`:
```ts
it("DELIBERATE TYPE ERROR for Finding 1 verification", () => {
  const lat = packetTypeLattice([])!;
  expect(lat.thisPropertyDoesNotExistOnTypeLattice).toBe(true);
});
```
Ran `cd wsn-codegen && npx tsc --project ../netlayer/tsconfig.json --skipLibCheck --noEmit`.
Exact output:
```
../netlayer/tests/packetTypes.test.ts(38,16): error TS2339: Property 'thisPropertyDoesNotExistOnTypeLattice' does not exist on type 'TypeLattice'.
```
Exit code 2. Then reverted the test file to its pre-error state (the block was
removed entirely, restoring the original three `describe` tests before the two
new Finding-2 tests were added — see below). Re-ran typecheck: exit 0, clean.

## Finding 2: root detection depends on file ordering, not on the model

**What was wrong:** `packetTypeLattice` collected every `partition(...)` axiom
into one map and picked "the first key that is nobody else's child" as root.
Checked the real MintRoute directory
(`EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck`) by
grepping the authoritative `org.eventb.core.predicate` attribute (not
`text_representation`, per project convention) in each context file — confirmed
five partition axioms across four unrelated trees:
- `C1.buc`: `partition(TYPE, CONTROL, {DATA})`
- `C2.buc`: `partition(CTL_STATUS, ...)`, `partition(ENV_STATUS, ...)`
- `C3.buc`: `partition(CONTROL, {ROUTE}, {BEACON})` (nests under TYPE's CONTROL)
- `T01.buc`: `partition(PKT, {B1}, ..., {R20})` (~38 packet instances)

`TYPE` only won because `C1.buc` is read before `C2`/`C3`/`T01` — an accident of
directory order, not something the code derived from the model.

**What I changed** (`netlayer/engine/packetTypes.ts`): added a second regex,
`TYPE_FUNCTION = /\btype\s*∈\s*PKT\s*→\s*(\w+)/`, matching the axiom
`type ∈ PKT → <NAME>` (confirmed present verbatim, as the `predicate` attribute,
in both `C1.buc` in the real MintRoute directory and in `Update_wsn/C0_project`'s
`C1.buc` — verified the exact Unicode codepoints used are U+2208 (∈) and U+2192
(→), matching the regex). `packetTypeLattice` now:
1. Scans all axioms for this pattern; if found and its named carrier is a key in
   the partition map, uses that name as root.
2. Otherwise falls back to the old "nobody else's child" heuristic, but if more
   than one candidate qualifies, **throws** naming all candidates instead of
   silently picking the first (insertion-order) one.
3. Still returns `null` when there are no partition axioms at all (unchanged).

The `leaves[i]`/`tagOf` invariant (DATA gets tag 0, `leaves` order matches tag
order) is untouched — only root selection changed; the depth-first walk from
the resolved root is the same code as before.

**Tests added** (`netlayer/tests/packetTypes.test.ts`):
1. Existing MintRoute test (`root === "TYPE"`, nested children, leaves,
   distinct tags) — still passes, now because the `type ∈ PKT → TYPE` axiom
   decided it, not file order.
2. New: `"anchors the root on the `type in PKT -> NAME` axiom, not on file
   order"` — synthetic contexts where an unrelated `partition(AAAA_UNRELATED,
   ...)` axiom is read *before* `partition(TYPE, CONTROL, {DATA})` /
   `type ∈ PKT → TYPE`. Under the old first-nobody's-child rule this would
   resolve to `AAAA_UNRELATED` (inserted first, also a root candidate); the new
   code must and does resolve to `TYPE`.
3. New: `"throws naming the candidates when several partition roots exist and no
   type axiom decides it"` — synthetic `partition(FOO, {a}, {b})` +
   `partition(BAR, {c}, {d})`, no `type` axiom. Asserts `packetTypeLattice`
   throws, and that the thrown message matches both `/FOO/` and `/BAR/`.

Added a small synthetic-`RawContext` builder (`ctx(name, axiomTexts)`) in the
test file to construct these without needing on-disk fixtures.

## Commands run and results

```
cd netlayer && npm test
```
```
Test Files  2 passed (2)
     Tests  6 passed (6)
```
(3 original `packetTypeLattice` tests + 2 new Finding-2 tests + 1
`appLayerUnchanged` guard test = 6.)

```
cd netlayer && npm run typecheck
```
Exit 0, no output (clean).

## Files changed
- `netlayer/tsconfig.json` — `include` now covers `tests/**/*.ts`; added
  `types`/`typeRoots`.
- `netlayer/engine/packetTypes.ts` — `type ∈ PKT → <NAME>` root anchor +
  throw-on-ambiguous fallback.
- `netlayer/tests/packetTypes.test.ts` — 2 new tests + synthetic `RawContext`
  builder.

Not touched: `wsn-codegen/` (read-only per constraints), `paper2/`,
`tests/appLayerUnchanged.test.ts`, `tests/__baseline__/`.

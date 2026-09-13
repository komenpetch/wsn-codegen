# Task 1 Report: Test harness and the app-layer freeze guard

Status: **DONE_WITH_CONCERNS** (one necessary deviation from the brief's literal code — see below)

## What was done

1. Created `netlayer/vitest.config.ts` — absolute, forward-slashed test glob built
   from `import.meta.url`, exactly as specified, **with one deviation** (see
   "Deviation" section below): it does not `import { defineConfig } from
   "vitest/config"`.
2. Created `netlayer/tests/appLayerUnchanged.test.ts` — verbatim from the brief.
   Imports `generateMerged` from `../../wsn-codegen/src/engine/pipeline`
   (read-only import; nothing under `wsn-codegen/` was modified).
3. Modified `netlayer/package.json` — added
   `"test": "cd ../wsn-codegen && npx vitest run --config ../netlayer/vitest.config.ts"`
   to `"scripts"`, following the exact pattern of the existing `scan`/`shapes`/
   `selftest`/`event` scripts (cwd hop into `../wsn-codegen` to borrow its
   installed `vitest`).
4. Ran the record → compare cycle (Step 4), and the mutation test (Step 5), both
   for real (see below).
5. Committed with `git -c user.name="Komen Nitchaphon" -c user.email=... commit`
   and no AI-contributor trailer, per the standing user preference. Commit
   `ee776fa` on branch `ppkt`.

## Deviation from the brief's literal code (why, and why it's safe)

The brief's `vitest.config.ts` as written does:
```ts
import { defineConfig } from "vitest/config";
```
I implemented this literally first and it failed on the very first `npm test`
run, **before any baseline existed**, with:
```
[UNRESOLVED_IMPORT] Could not resolve 'vitest/config' in ../netlayer/vitest.config.ts
...
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest' imported from
C:\Users\Komen\Desktop\Proj\netlayer\vitest.config.ts.timestamp-...mjs
```

Root cause (traced into the installed Vite source,
`wsn-codegen/node_modules/vite/dist/node/chunks/node.js`,
`loadConfigFromBundledFile`): when Vite loads a standalone config file, it
bundles it and writes a temporary `.mjs` file so it can `import()` it. For any
**bare specifier** left inside that file (like `"vitest/config"`), Node's ESM
resolution walks up from the *temp file's own directory* looking for a
`node_modules` folder — Vite tries to place that temp file under the nearest
`node_modules/.vite-temp/` to the **original config file's directory**
(`findNearestNodeModules(path.dirname(configFile))`), falling back to placing
it right next to the config file if no `node_modules` is found anywhere in
that directory's ancestor chain.

`netlayer/` deliberately has no `node_modules` (per this task's brief), and I
confirmed no ancestor directory does either, all the way up to the drive root
(`C:\Users\Komen\Desktop\Proj`, `Desktop`, `Users\Komen` — none have one). So
the temp file lands next to `netlayer/vitest.config.ts`, and Node then tries
to resolve `"vitest/config"` from `netlayer/`'s ancestor chain — which never
finds `wsn-codegen/node_modules/vitest`, because that's a sibling directory,
not an ancestor. This fails **regardless of the process's cwd** (which is
`wsn-codegen/`, per the `test` script) — cwd is irrelevant to this resolution
path; only the config file's own on-disk location matters.

Fix applied: drop the `defineConfig` import and export a plain object
instead:
```ts
export default {
  test: {
    include: [glob("tests/**/*.test.ts")],
    root: HERE,
  },
};
```
`defineConfig` is a type-only identity helper (`(c) => c`) — it exists purely
for editor/type-checking ergonomics and has zero effect on the resolved
configuration at runtime. Dropping it is behaviorally a no-op; every other
line of the brief's config (the `HERE`/`glob` construction the brief
specifically warns not to simplify) is untouched. `netlayer/` has no
`tsconfig.json`, so there is no type-check gate that would have depended on
the `defineConfig` type augmentation either.

I did not ask before making this change because it is a mechanical fix to make
the literally-specified behavior (a working `npm test` in `netlayer/`) actually
occur in this filesystem layout, not a design ambiguity — the glob-building
logic, the two-directory-hop cwd design, and every other instruction in the
brief are followed exactly. Flagging it here per the brief's own spirit
("ask ... rather than guessing" on anything that looks wrong): **please review
this substitution** — if a `node_modules` is later added anywhere between
`netlayer/` and the drive root for unrelated reasons, the original
`defineConfig` form would then start working too, but there is no reason to
revert since the plain-object form is equivalent and more robust to this
exact class of problem recurring.

## Step 4 — record then compare (actually run)

First run (baseline did not yet exist):
```
> cd ../wsn-codegen && npx vitest run --config ../netlayer/vitest.config.ts
 FAIL  tests/appLayerUnchanged.test.ts > app-layer output freeze > is byte-identical to the recorded baseline
Error: Baseline did not exist; it has been written. Re-run to compare.
 Test Files  1 failed (1)
      Tests  1 failed (1)
```
Baseline written to `netlayer/tests/__baseline__/applayer-v4.json` (23,632
bytes; keys `Pm3App.h` / `Pm3App.cc` / `Pm3App.ned`; provenance banner reads
`pM1 → uM2 → pM3`, matching the `Update_wsn/C0_project` refinement chain and
the v4 emitter's context-inlining behavior described in the project's
`CLAUDE.md`).

Second run (baseline now exists):
```
 Test Files  1 passed (1)
      Tests  1 passed (1)
```
Matches the brief's expected outcome exactly.

## Step 5 — mutation test (actually performed, not merely reported)

1. Backed up the freshly-recorded baseline to the scratchpad directory.
2. Mutated exactly one identifier inside one file's content in the baseline
   JSON: `Define_Module(Pm3App);` → `Define_Module(Pm3Apy);` (one character
   changed, inside the `"Pm3App.cc"` value), via
   `sed -i 's/Define_Module(Pm3App);/Define_Module(Pm3Apy);/'` — confirmed a
   single match before and after.
3. Ran `npm test` — **FAIL**, with a real diff:
   ```
   AssertionError: expected { …(3) } to deeply equal { …(3) }
   - Expected
   + Received
   - Define_Module(Pm3Apy);
   + Define_Module(Pm3App);
   ```
4. Restored the baseline from the backup (`cp` back), verified with `diff`
   that it is byte-identical to the original recording (`RESTORED IDENTICAL`).
5. Ran `npm test` again — **PASS**, 1 test.

The guard demonstrably fails on a genuine change and passes on the true,
unmutated baseline.

## Constraint compliance

- Nothing under `wsn-codegen/` was edited. I only used `Read`/`grep` on
  `wsn-codegen/src/engine/pipeline.ts` to confirm `generateMerged`'s exact
  signature (`(files: EbFiles, outputName?: string, version: EmitVersion = 3)`
  — matches the brief's call `generateMerged(files, undefined, 4)`) and
  inspected `wsn-codegen/node_modules/vite` (read-only) to diagnose the
  import-resolution failure above.
- `paper2/` was not touched (it isn't even a git repo at this path — a
  `git status` there returns "not a git repository").
- Commit was made with `git -c user.name="Komen Nitchaphon" -c
  user.email="petzajr104@gmail.com" commit ...` and carries no
  `Co-Authored-By` or AI-contributor trailer, per the standing preference
  surfaced in the task's context.
- `.superpowers/` (containing this brief/report) is gitignored in `netlayer/`
  (`netlayer/.gitignore` already lists it), so it was not staged or committed;
  only `vitest.config.ts`, `tests/`, and `package.json` were, as instructed.

## Incidental observation (not acted on — out of scope for this task)

`wsn-codegen/` (the sibling repo Task 1 reads from) currently has pre-existing
**uncommitted** local modifications, present before I started and untouched by
me: `README.md`, `scripts/generate.ts`, `src/engine/flattener.ts`,
`src/engine/pipeline.ts`, plus several untracked files (`docs/*.md`,
`runs*.ndjson`, various `scripts/*`). I did not inspect these in detail since
they are outside this task's scope and outside the "do not edit
`wsn-codegen/`" boundary applies regardless — flagging only so the working
baseline's provenance is clear: the `pipeline.ts` I imported from, and whose
`generateMerged` signature I verified, is whatever is **currently on disk**
in that repo (working tree, not last commit), since that is what Node actually
loads at import time. If those pending `wsn-codegen` changes are later
committed or reverted and change `generateMerged`'s emitted bytes, this task's
baseline would need re-recording — that is in fact exactly the scenario this
guard exists to catch.

## Files touched

- Created: `C:/Users/Komen/Desktop/Proj/netlayer/vitest.config.ts`
- Created: `C:/Users/Komen/Desktop/Proj/netlayer/tests/appLayerUnchanged.test.ts`
- Created: `C:/Users/Komen/Desktop/Proj/netlayer/tests/__baseline__/applayer-v4.json`
- Modified: `C:/Users/Komen/Desktop/Proj/netlayer/package.json`

Commit: `ee776fa` on branch `ppkt` in the `netlayer/` repo — "test(netlayer):
app-layer output freeze guard and test runner".

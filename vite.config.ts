import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ⚠ Several suites read a case-study Event-B model DIRECTLY off disk, and those
// models are the advisor's research sources, deliberately not published in this
// repo (CLAUDE.md 2026-07-06 (vi)). They sit in sibling folders of this package,
// so on a clean checkout -- CI, or anyone who clones it -- they are absent and
// the suites fail at ENOENT, most of them at IMPORT time, taking the whole run
// down and with it the Pages deployment.
//
// So they are excluded when the sources are not there. This is the pre-merge CI
// coverage restored rather than a new hole: while netlayer/ had its own vitest
// config these six never ran in CI at all, and the merge newly exposed them.
// What IS new is that they run locally, in the same one command, where the
// models exist.
//
// The warning below is deliberate. A suite that vanishes quietly is exactly the
// failure this project has already paid for once -- a hardcoded class-name regex
// that matched nothing, so a test walked every method and checked zero.
const MODELS = ["../EventB_model", "../Update_wsn"].map((d) => resolve(process.cwd(), d));
const haveModels = MODELS.every(existsSync);

// ⚠ DERIVED BY SCANNING, NOT LISTED — and the list going stale is not
// hypothetical, it is what broke the deployment.
//
// This was seven hardcoded filenames. Seven more model-reading suites were
// added afterwards and nobody appended them, so on a clean checkout they failed
// at ENOENT and took the whole run down with them. It went unnoticed for weeks
// because the commits that added them were never pushed, so CI never saw them:
// the first push after that ran straight into 8 errors and a failed Pages
// deploy. A list a human has to remember to update is the defect.
//
// Three spellings reach a sibling model, all of them in use:
//   loadProject(...)        scripts/projects.ts resolves the sibling folders
//   "../EventB_model"       a literal path
//   resolve(HERE, "../..")  the parent, from which a path is then built
const REACHES_OUT = /loadProject|\.\.\/(EventB_model|Update_wsn)|"\.\.\/\.\."/;
const needsModels = readdirSync(resolve(process.cwd(), "tests"))
  .filter((f) => f.endsWith(".test.ts"))
  .filter((f) => REACHES_OUT.test(readFileSync(resolve(process.cwd(), "tests", f), "utf8")))
  .map((f) => `tests/${f}`)
  .sort();

// A scan that matches NOTHING would silently restore the exact breakage above,
// so it is an error rather than an empty exclusion list.
if (needsModels.length === 0)
  throw new Error(
    "vite.config: no suite matched the model-reading scan. Either every such suite was "
    + "removed, or the signals in REACHES_OUT no longer match how they load a model. "
    + "Refusing rather than shipping a config that excludes nothing on a clean checkout.");
if (!haveModels)
  console.warn(
    `\n[vitest] Case-study Event-B models not found beside this repo.\n` +
      `[vitest] SKIPPING ${needsModels.length} suites that read one:\n` +
      needsModels.map((f) => `[vitest]   - ${f}`).join("\n") +
      `\n[vitest] Expected at: ${MODELS.join(", ")}\n`,
  );

export default defineConfig({
  base: "/wsn-codegen/", // GitHub Pages project path (repo name)
  plugins: [react()],
  test: {
    environment: "node",      // engine is pure; node is fastest
    // One suite. Before the netlayer merge this had to name two roots, and
    // while netlayer/ was only in its OWN config `npm test` here reported green
    // while 40 tests never ran -- including the freeze guard whose whole job is
    // to catch an engine change moving the published app-layer output. CI runs
    // this command, so leaving one out meant such a regression deployed.
    include: ["tests/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ...(haveModels ? [] : needsModels)],
  },
});

import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ⚠ Six suites read a case-study Event-B model DIRECTLY off disk, and those
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
const needsModels = [
  "tests/appLayerUnchanged.test.ts",
  "tests/generateNet.test.ts",
  "tests/mediumBinding.test.ts",
  "tests/packetModel.test.ts",
  "tests/packetRulesEvidence.test.ts",
  "tests/packetTypes.test.ts",
  // Reads C0_project and MintRoute to construct the one scenario in which an
  // image-bound parameter is actually reached.
  "tests/imageParamType.test.ts",
];
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

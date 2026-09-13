import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// netPipeline.ts's `withRules` swaps the CONTENTS of the shared `RULES` array
// for the duration of one generation and restores them in a `finally`. That is
// safe only because vitest gives each test FILE its own module registry, so the
// app-layer freeze guard never observes a swapped catalog while a network-layer
// test is running.
//
// The comment on `withRules` names the settings that would break it. Nothing
// enforced them, and the failure would not look like a broken assumption: the
// freeze guard would start FLAPPING, which reads as a flaky test rather than as
// a shared-state race. So the assumption is checked here instead of only
// described there.
describe("the shared-rules swap's isolation assumption", () => {
  const config = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../vite.config.ts"), "utf8");

  it("does not turn off per-file isolation", () => {
    expect(config).not.toMatch(/isolate\s*:\s*false/);
  });

  it("does not select a pool that shares one module registry", () => {
    // vmThreads and vmForks reuse a VM context across files, which is exactly
    // the sharing withRules cannot survive.
    expect(config).not.toMatch(/pool\s*:\s*["'`]vm(Threads|Forks)["'`]/);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateMerged } from "../../src/engine/pipeline";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const BASELINE = resolve(HERE, "__baseline__/applayer-v4.json");

// The finished app layer is published evidence: its emitted bytes back the
// paper's similarity figures. Any network-layer change that moves them is a
// defect in THIS work, not an improvement, and it must fail loudly here.
function emitAppLayer(): Record<string, string> {
  const dir = resolve(ROOT, "Update_wsn/C0_project");
  const files = readdirSync(dir)
    .filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") }));
  return Object.fromEntries(generateMerged(files, undefined, 4).map((f) => [f.path, f.content]));
}

describe("app-layer output freeze", () => {
  it("is byte-identical to the recorded baseline", () => {
    const now = emitAppLayer();
    if (!existsSync(BASELINE)) {
      mkdirSync(dirname(BASELINE), { recursive: true });
      writeFileSync(BASELINE, JSON.stringify(now, null, 2), "utf8");
      throw new Error("Baseline did not exist; it has been written. Re-run to compare.");
    }
    expect(now).toEqual(JSON.parse(readFileSync(BASELINE, "utf8")));
  });
});

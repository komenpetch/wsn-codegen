import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateMerged } from "../src/engine/pipeline";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const BASELINE = resolve(HERE, "__baseline__/applayer-v4.json");

// The finished app layer is published evidence: its emitted bytes back the
// paper's similarity figures. Any network-layer change that moves them is a
// defect in THIS work, not an improvement, and it must fail loudly here.
//
// DELIBERATE BASELINE CHANGE, 2026-09-07 -- the one time it has moved, and the
// reason it is recorded here rather than quietly re-recorded. A partially
// translated event used to run every action it could translate and THEN report
// that it had not fired: the emitter appended its refusal after the actions.
// The app layer has exactly one such event (`activate`, PActivate), whose
// action `emergencyAlert[act] = TRUE;` therefore ran on every call while the
// method returned false. Nothing in the app-layer module calls it, so nothing
// there observed the difference -- the network layer did, catastrophically:
// MintRoute's finish_tx_pkt erased from the very container its caller was
// iterating and then returned false, and the run died with an access violation.
// The refusal now precedes the actions, which are emitted as comments. The only
// bytes that moved in the app layer are those of `activate`.
//
// DELIBERATE BASELINE CHANGE, 2026-09-12 -- the second time, and a rename only.
// The emitted module is now `Pm3Wsn`, not `Pm3App`: with the network layer
// merged into this same generator there is one output and one name for it, and
// "App" described only half of what the generator can put in it. Before
// re-recording, the new output was compared against the old baseline with the
// class name normalised away, and every one of the three files was byte-
// identical -- so nothing about the TRANSLATION moved, only what the class is
// called. That check is the reason this line can be trusted; repeat it if the
// baseline ever has to move again.
//
// DELIBERATE BASELINE CHANGE, 2026-09-13 -- the third, and scaffolding only. The
// module is now wrapped in `namespace eb_pm3wsn { ... }` (and its NED @class
// qualified to match), because two generated modules could not previously be
// linked into one executable: each inlines its Event-B context at namespace
// scope, so the second redefined the first's DATA, CONTROL, FALSE and the rest.
// That blocked the point of the exercise -- the generated sensor application
// running on top of the generated network protocol in one simulation. Before
// re-recording, old and new were compared line by line with the namespace lines
// and blank runs dropped: 131 / 387 / 30 content lines, all identical. The
// paper's coverage figures are unaffected and were re-run to confirm.
//
// This guard is also now the only thing standing between an engine change and
// the paper's similarity figures, so a failure here is a question ("what did I
// change, and did I mean to?"), never a prompt to delete the file and re-record.
function emitAppLayer(): Record<string, string> {
  const dir = resolve(ROOT, "Update_wsn/C0_project");
  const files = readdirSync(dir)
    .filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") }));
  return Object.fromEntries(generateMerged(files, undefined, 2).map((f) => [f.path, f.content]));
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

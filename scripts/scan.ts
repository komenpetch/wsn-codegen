// Network-layer rule-gap scan.
//
//   npm run scan              # summary table
//   npm run scan -- --clauses # + every distinct clause
//
// (or directly: cd ../wsn-codegen && npx vite-node ../netlayer/scripts/scan.ts)
//
// Replaces the stale 2026-07-06 figures (83 RTMCS M6 / 164 MintRoute M5) with
// current ones. Two independent counts are reported per machine and MUST agree:
//
//   emitted  — occurrences of the UNTRANSLATED token in the three emitted files.
//              This is the authoritative number (brief point 5: count from the
//              output, not from the engine's own bookkeeping).
//   engine   — the same clauses as seen by translateEvent, used only to attach
//              clause text + event labels so the gap can be grouped by SHAPE.
//
// Per-machine means: generate with that machine as the target, which flattens
// its whole refines chain, so counts are CUMULATIVE. The delta column is what
// each refinement level adds.
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseModel } from "../../wsn-codegen/src/engine/parser";
import { flatten } from "../../wsn-codegen/src/engine/flattener";
import { resolveEncodings } from "../../wsn-codegen/src/engine/encodingResolver";
import { translateEvent } from "../../wsn-codegen/src/engine/ruleEngine";
import { generate, defaultName } from "../../wsn-codegen/src/engine/pipeline";

// Model paths resolve from THIS FILE, not the working directory: the runner
// invokes vite-node from ../wsn-codegen (that is where the deps live), so a
// cwd-relative path would silently read the wrong tree — or nothing.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const DEFAULTS: Record<string, string> = {
  RTMCS: resolve(ROOT, "EventB_model/RTMCS_7_4_proof"),
  MintRoute: resolve(ROOT, "EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck"),
};
// Extra folders may be named on the command line as label=path (path relative
// to the project root), e.g.
//   npm run scan -- --clauses AppLayer=Update_wsn/C0_project
const extra = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.includes("="))
    .map((a) => a.split("=") as [string, string])
    .map(([k, v]) => [k, resolve(ROOT, v)]),
);
const PROJECTS: Record<string, string> =
  Object.keys(extra).length > 0 ? extra : DEFAULTS;

const loadDir = (dir: string) =>
  readdirSync(dir)
    .filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") }));

const showClauses = process.argv.includes("--clauses");

for (const [proj, dir] of Object.entries(PROJECTS)) {
  const files = loadDir(dir);
  const raw = parseModel(files);
  const machines = raw.machines.map((m) => m.name).sort();
  const shown = dir.slice(ROOT.length + 1).replace(/\\/g, "/");
  console.log(`\n${"=".repeat(78)}\n${proj}  (${shown})\n${"=".repeat(78)}`);
  console.log(
    "machine  events  vars  clauses  translated  emitted-UNTR  engine-UNTR  distinct  delta",
  );

  let prevEmitted = 0;
  const perMachine: Record<string, Map<string, string[]>> = {};

  for (const target of machines) {
    // --- authoritative: count the token in the emitted files ---
    const tree = generate(files, target, defaultName(target), 4);
    const all = tree.map((f) => f.content).join("\n");
    const emitted = (all.match(/UNTRANSLATED/g) ?? []).length;

    // --- bookkeeping: same clauses, with text + provenance ---
    const model = resolveEncodings(flatten(raw, target));
    const distinct = new Map<string, string[]>();
    let engine = 0, clauses = 0, translated = 0;
    for (const ev of model.events) {
      const t = translateEvent(ev, model);
      const untr = [...t.untranslatedGuards, ...t.untranslatedActions];
      engine += untr.length;
      translated += t.guards.length + t.actions.length;
      clauses += t.guards.length + t.actions.length + untr.length;
      for (const u of untr) {
        if (!distinct.has(u)) distinct.set(u, []);
        distinct.get(u)!.push(ev.label);
      }
    }
    perMachine[target] = distinct;

    const flag = emitted === engine ? "" : "   <-- MISMATCH";
    console.log(
      [
        target.padEnd(7),
        String(model.events.length).padStart(6),
        String(model.variables.length).padStart(5),
        String(clauses).padStart(8),
        String(translated).padStart(11),
        String(emitted).padStart(13),
        String(engine).padStart(12),
        String(distinct.size).padStart(9),
        String(emitted - prevEmitted).padStart(6),
      ].join("") + flag,
    );
    prevEmitted = emitted;
  }

  if (showClauses) {
    // Clauses NEW at each level: present here, absent from the parent machine.
    for (let i = 0; i < machines.length; i++) {
      const cur = perMachine[machines[i]];
      const prev = i > 0 ? perMachine[machines[i - 1]] : new Map();
      const fresh = [...cur.keys()].filter((k) => !prev.has(k));
      if (fresh.length === 0) continue;
      console.log(`\n--- ${proj} ${machines[i]}: ${fresh.length} distinct clauses new at this level`);
      for (const k of fresh) console.log(`  [${cur.get(k)!.length}x] ${k}`);
    }
  }
}

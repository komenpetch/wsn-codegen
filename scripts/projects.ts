// Where the case-study Event-B sources live, and how to load one.
//
// These folders sit OUTSIDE this repo (they are the advisor's research models,
// deliberately not published here — see CLAUDE.md 2026-07-06 (vi)), so every
// path is relative to the parent project directory, not to the package.
//
// One copy. Before the netlayer merge the same two paths were spelled out
// separately in scan.ts, shapes.ts and generate-net.ts, which is three places
// to update when a model folder is renamed and three chances to miss one.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { EbFiles } from "../src/engine/pipeline";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const PROJECTS: Record<string, string> = {
  RTMCS: "EventB_model/RTMCS_7_4_proof",
  MintRoute: "EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck",
  // The app-layer chain (pM1 → uM2 → pM3): the working copy, not the pristine
  // export at test_input/. The freeze guard is pinned to this one.
  AppLayer: "Update_wsn/C0_project",
};

// Absolute path of a project: a known label, or a path relative to ROOT.
export const projectDir = (project: string): string =>
  resolve(ROOT, PROJECTS[project] ?? project);

// Read a project's Rodin files. Both .bum and .buc — the contexts carry the
// axioms the emitted Event-B context block is derived from.
export function loadProject(project: string): EbFiles {
  const dir = projectDir(project);
  return readdirSync(dir)
    .filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") }));
}

// A command-line argument that names a project: a label from PROJECTS (resolved
// against the parent project directory, where the Event-B sources live) or a
// path relative to the CURRENT directory, the way this CLI has always taken one.
//
// One place, because there are now two such arguments -- the module's own input
// and v5's --ppkt-from -- and they had drifted immediately: only the first
// checked that the directory exists, so a mistyped --ppkt-from failed later and
// less clearly than a mistyped input.
export function resolveInput(arg: string): string {
  const dir = arg in PROJECTS ? projectDir(arg) : resolve(process.cwd(), arg);
  if (!existsSync(dir)) throw new Error(`No such folder: ${dir}`);
  return dir;
}

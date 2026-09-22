// The generation CLI — one command for both layers.
//
// Parse a folder of Event-B .bum/.buc files, MERGE the whole refinement chain
// into one module (the most-refined machine, flattened, unless --machine names
// another), and write exactly three files. If the target machine has a network
// layer, the same run emits it inside the same module: the packet classes, the
// per-type transmit methods (sendBeaconBroadcast / sendRouteBroadcast / …), the
// flooding scheduler and the medium binding. Nothing selects that — the model
// does (see engine/netPipeline.ts).
//
//   npm run generate                              # tests/fixtures/shdecom → out/
//   npm run generate -- <dir|project> <outDir>
//   npm run generate -- MintRoute out-m4 --machine M4
//   npm run generate -- AppLayer out-v3 --v3          # + the bundled pattern extension
//   npm run generate -- <dir|project> <outDir> --v1     # emitted-structure version
//
// <dir|project> is a path, or one of the labels in scripts/projects.ts
// (MintRoute, RTMCS, AppLayer). Machine names are not fixed — any chain
// (pM1/uM2/pM3/uM4/M0…M6/…) works.
//
// --v1/--v2/--v3 selects the emitted structure for the report's compare table
// (1 = SensorApp shell with the transmit behind an extension point, 2 = the
// default, SensorApp behavioural parity). Structure 3 is 2's shell carrying the
// pattern extension -- PPkt and PRouteTable -- which ships INSIDE the tool, so
// it needs no second project: one project in, one module out.
//
// Run via vite-node so TS + engine imports resolve without a build step.
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { generate, generateMerged, machineNames, leafMachine, defaultName } from "../src/engine/pipeline";
import { loadProject, resolveInput } from "./projects";
import type { EmitVersion } from "../src/engine/codeEmitter";

const argv = process.argv.slice(2);
const flag = argv.find((a) => /^--v[123]$/.test(a));
const version = (flag ? Number(flag.slice(3)) : 2) as EmitVersion;
// Drain the non-creating events to a bounded fixpoint each pass (structure 3).
//
// OFF by default so every recorded measurement stays reproducible: this is the
// fix for the per-pass backlog, and turning it on moves flood numbers, so the
// two want measuring side by side rather than one replacing the other.
const drain = argv.includes("--drain");
const mIdx = argv.indexOf("--machine");
const machine = mIdx >= 0 ? argv[mIdx + 1] : undefined;
// `mIdx + 1` is only a real index to skip when --machine was actually given.
// Without that guard mIdx is -1, mIdx + 1 is 0, and the FIRST positional
// argument silently disappears.
const named = new Set(["--machine"]);
const valueAt = new Set([mIdx].filter((i) => i >= 0).map((i) => i + 1));
// ⚠ REFUSED rather than silently ignored. --drain is wired into structure 3's
// scheduler only; accepting it elsewhere would report success and emit a module
// with no drain in it, which is the "flag that does nothing" failure this
// project has paid for before.
if (drain && version !== 3) {
  console.error("\n--drain applies to structure 3 (--v3); it is not wired into the "
    + "other structures. Re-run with --v3, or drop --drain.\n");
  process.exit(2);
}
// ⚠ `--drain` has to be excluded here too, or it is taken as the INPUT
// directory: the filter drops only the version flags and the named pairs, so an
// unlisted flag silently becomes positional[0].
const positional = argv.filter((a, i) =>
  !/^--v[12345]$/.test(a) && a !== "--drain" && !named.has(a) && !valueAt.has(i));

const input = positional[0] ?? "tests/fixtures/shdecom";
const outDir = positional[1] ?? "out";


// A model the engine refuses is a normal outcome, not a crash: an incomplete refinement
// chain, a refinement cycle, an empty folder. The engine states the problem in the
// message, so print that and stop. Letting it escape buried it under twenty lines of
// vite-node stack frames, which is how the useful sentence gets missed.
function refuse(e: unknown): never {
  console.error(`\nCannot generate from ${input}\n  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}

// `input` is reported as whichever the user typed, so the message names what
// they asked for; resolveInput turns it into a directory and checks it exists.
let files;
try { files = loadProject(resolveInput(input)); } catch (e) { refuse(e); }

mkdirSync(outDir, { recursive: true });
let tree;
try {
  // ⚠ No packet-source flag any more. Structure 3 carries the pattern
  // extension -- PPkt and PRouteTable -- and that extension ships INSIDE the
  // tool (src/assets/pattern-extension), the way the rule catalog does. It used
  // to be `--ppkt-from <project>`, which made the pattern an INPUT the user had
  // to supply: two projects in, and a generator that knew nothing about the
  // pattern it is meant to embody.
  tree = machine
    ? generate(files, machine, defaultName(machine), version, undefined, drain)
    : generateMerged(files, undefined, version, undefined, drain);
} catch (e) { refuse(e); }
for (const f of tree) writeFileSync(resolve(outDir, f.path), f.content, "utf8");

// Structure 1 #includes the shared fixtures, so stage them next to the
// generated code for the compile gate. Structures 2 and 3 inline that content
// into their own header — staging nothing is what makes their output exactly
// the three contracted files.
//
// ⚠ This read `version < 4` and survived the 2026-09-13 renumber unnoticed,
// because with `EmitVersion = 1 | 2 | 3` it is true of EVERY structure: the CLI
// was staging fixture headers beside self-contained output and reporting
// "+ shared headers" for all three. Harmless to the compile gate and a direct
// contradiction of the three-file contract the output claims to satisfy.
if (version < 2) {
  copyFileSync("src/assets/eb_helpers.h", resolve(outDir, "eb_helpers.h"));
  copyFileSync("src/assets/eb_context.h", resolve(outDir, "eb_context.h"));
}

// Whether the network layer is in there is a FACT ABOUT THE OUTPUT, so it is
// read back off the emitted text rather than predicted from a flag. A run that
// silently emitted an app-layer module for a network-layer model would
// otherwise look identical to one that worked.
const all = tree.map((f) => f.content).join("\n");
const hasNet = all.includes(": public NetworkProtocolBase");
const hasPPkt = all.includes("class PPkt : public inet::FieldsChunk");
const untranslated = (all.match(/UNTRANSLATED/g) ?? []).length;

console.log(`Machines (${input}): ${machineNames(files).join(", ")} → ${machine ?? `merged into ${leafMachine(files)}`}`);
console.log(
  `Generated ${tree.length} files (structure v${version}, ` +
    `${hasNet ? "app + network layer" : hasPPkt ? "app layer + PPkt" : "app layer only — this model has no medium"})` +
    (version < 2 ? " + shared headers" : " — self-contained, no shared headers") +
    ` → ${outDir}/  (${untranslated} untranslated)`,
);

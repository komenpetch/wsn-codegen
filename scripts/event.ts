// Print the guards and actions of named events, as the parser sees them.
//
//   npm run event -- <project> <machine> <eventLabel> [<eventLabel> ...]
//   npm run event -- MintRoute M4 create_bconPkt create_routePkt
//   npm run event -- Pattern IPacket --all
//
// Raw, unflattened: exactly what is declared in THAT machine, so a refinement's
// own contribution is visible rather than merged with its ancestors'. Use
// --flat to see the flattened form the generator actually translates.
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseModel } from "../../wsn-codegen/src/engine/parser";
import { flatten } from "../../wsn-codegen/src/engine/flattener";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const PROJECTS: Record<string, string> = {
  RTMCS: "EventB_model/RTMCS_7_4_proof",
  MintRoute: "EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck",
  Pattern: "Ex_WSN_Pattern/WSN_Pattern_shDecom6_2",
  AppLayer: "Update_wsn/C0_project",
};

const argv = process.argv.slice(2);
const flat = argv.includes("--flat");
const all = argv.includes("--all");
const [proj, machine, ...labels] = argv.filter((a) => !a.startsWith("--"));

const dir = resolve(ROOT, PROJECTS[proj] ?? proj);
const files = readdirSync(dir).filter((f) => /\.(bum|buc)$/.test(f))
  .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") }));
const raw = parseModel(files);

if (flat) {
  const m = flatten(raw, machine);
  const evs = m.events.filter((e) => all || labels.includes(e.label));
  console.log(`# ${proj} ${machine} (flattened over ${m.chain.join(" -> ")})\n`);
  for (const e of evs) {
    console.log(`## ${e.label}${e.parameters.length ? "  any " + e.parameters.join(", ") : ""}`);
    for (const g of e.guards) console.log(`   when   ${g}`);
    for (const a of e.actions) console.log(`   then   ${a}`);
    console.log();
  }
} else {
  const m = raw.machines.find((x) => x.name === machine);
  if (!m) throw new Error(`No machine '${machine}' in ${proj}. Have: ${raw.machines.map((x) => x.name).join(", ")}`);
  const evs = m.events.filter((e) => all || labels.includes(e.label));
  console.log(`# ${proj} ${machine}${m.refines ? ` (refines ${m.refines})` : ""} -- declared here only\n`);
  for (const e of evs) {
    const ref = e.refines ? `  [refines ${e.refines}]` : "";
    console.log(`## ${e.label}${ref}${e.extended ? " [extended]" : ""}` +
      (e.parameters.length ? `  any ${e.parameters.join(", ")}` : ""));
    for (const g of e.guards) console.log(`   when   @${g.label}  ${g.text}`);
    for (const a of e.actions) console.log(`   then   @${a.label}  ${a.text}`);
    console.log();
  }
}

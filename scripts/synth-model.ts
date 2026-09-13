// Synthetic Rodin Event-B project generator — measurement input for the
// "isolated algorithmic complexity" experiment.
//
//   npx vite-node scripts/synth-model.ts <outDir> --depth N --events N --vars N --clauses N
//
// Real Event-B models come in fixed sizes, so the scaling study needs valid
// Rodin projects at controlled scales. The output of this script is the INPUT
// of scripts/benchmark.ts: it must therefore be accepted by the real
// parser / flattener / encodingResolver / ruleEngine / codeEmitter and make
// each of them do real work — a project that silently produced zero clauses
// would invalidate the experiment.
//
// Four independently-controllable scale parameters, one per stressed stage:
//
//   depth            → flattener      (length of the refines chain to walk+merge)
//   eventsPerMachine → parser         (input size: machines × events)
//   vars             → encodingResolver (one typing invariant to classify each)
//   clausesPerEvent  → ruleEngine + codeEmitter (guard/action clauses to match)
//
// ── Shape of the generated project ──────────────────────────────────────
// sC0.buc            the context, a copy of the real WSN C0 (carrier PKT,
//                    constants ND/Dests/BROADCAST/initialSrcAddr/finalDestAddr)
// sM1.bum            the BASE machine: declares every variable + its typing
//                    invariant, INITIALISATION, and every event with its full
//                    guard/action payload.
// sM2..sM{depth}     refinements: `refines sM{k-1}`, re-declare the variables
//                    (Rodin convention), and carry the same event labels as
//                    `extended="true"` with empty bodies — exactly the shape of
//                    the real uM2.bum / pM3.bum for inherited events.
//
// Putting the clause payload in the base machine only is deliberate: sweeping
// `depth` then changes the flattener's chain-walk/merge work WITHOUT changing
// the number of clauses the rule engine and emitter see, which is what makes
// the four parameters isolated rather than confounded.
//
// State variables are pair-set relations (`v_i ∈ ND ↔ PKT`), which the real
// encodingResolver classifies as ENC4 "pair-set" (a relation with no per-key
// access), so the emitted clauses exercise the PS rule family (PS1 pair
// membership, PS2 pair insert) and every variable gets a concrete encoding.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface SynthSpec {
  /** number of machines in the refines chain, sM1 … sM{depth} */
  depth: number;
  /** events per machine, in addition to INITIALISATION */
  eventsPerMachine: number;
  /** number of state variables (each gets a typing invariant) */
  vars: number;
  /** guard + action clauses carried by each event of the base machine */
  clausesPerEvent: number;
}

export interface SynthFile { name: string; xml: string }

const EB = "org.eventb.core.";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const attrs = (pairs: [string, string][]): string =>
  pairs.map(([k, v]) => ` ${k}="${esc(v)}"`).join("");

interface Clause { label: string; text: string }
interface EventShape { params: string[]; guards: Clause[]; actions: Clause[] }

function check(spec: SynthSpec): void {
  const { depth, eventsPerMachine, vars, clausesPerEvent } = spec;
  if (!Number.isInteger(depth) || depth < 1) throw new Error("synthProject: depth must be an integer ≥ 1");
  if (!Number.isInteger(eventsPerMachine) || eventsPerMachine < 1)
    throw new Error("synthProject: eventsPerMachine must be an integer ≥ 1");
  if (!Number.isInteger(vars) || vars < 1) throw new Error("synthProject: vars must be an integer ≥ 1");
  // < 2 would leave an event with only its parameter-typing guard, which the
  // rule engine drops — a degenerate, zero-work input.
  if (!Number.isInteger(clausesPerEvent) || clausesPerEvent < 2)
    throw new Error("synthProject: clausesPerEvent must be an integer ≥ 2");
}

// Exactly `clausesPerEvent` clauses per event: guard[0] types the parameters
// (real Event-B requires it; the rule engine recognises and drops it), the rest
// are PS1 pair-membership guards and PS2 pair-insert actions. Indices are
// offset by the event number so different events touch different variables,
// and every clause text within one event is distinct — the flattener dedupes
// by text, so duplicates would silently shrink the requested scale.
function eventShape(evIdx: number, spec: SynthSpec): EventShape {
  const { vars, clausesPerEvent } = spec;
  const gCount = Math.ceil(clausesPerEvent / 2);
  const aCount = clausesPerEvent - gCount;
  const psCount = gCount - 1;
  // Enough packet parameters that all (variable, packet, operator) triples used
  // below are distinct: actions need vars×K combinations, guards vars×K×2.
  const K = Math.max(1, Math.ceil(aCount / vars), Math.ceil(psCount / (2 * vars)));
  const pkts = Array.from({ length: K }, (_, i) => `p${i}`);

  const guards: Clause[] = [{
    label: "typing_g1",
    text: `x ∈ ND ∧ ${pkts.map((p) => `${p} ∈ PKT`).join(" ∧ ")}`,
  }];
  for (let i = 0; i < psCount; i++) {
    const v = `v${(i + evIdx) % vars}`;
    const p = pkts[Math.floor(i / vars) % K];
    const op = Math.floor(i / (vars * K)) % 2 === 0 ? "∈" : "∉";
    guards.push({ label: `mem_g${i + 2}`, text: `x ↦ ${p} ${op} ${v}` });
  }

  const actions: Clause[] = [];
  for (let i = 0; i < aCount; i++) {
    const v = `v${(i + evIdx) % vars}`;
    const p = pkts[Math.floor(i / vars) % K];
    actions.push({ label: `ins_a${i + 1}`, text: `${v} ≔ ${v} ∪ {x ↦ ${p}}` });
  }

  return { params: ["x", ...pkts], guards, actions };
}

function eventXml(
  idx: number,
  label: string,
  shape: EventShape | undefined,
  refines: string | undefined,
): string {
  const head = `   <${EB}event${attrs([
    ["name", `evt${idx}`],
    [`${EB}convergence`, "0"],
    [`${EB}extended`, shape ? "false" : "true"],
    [`${EB}label`, label],
  ])}>`;
  if (!shape) return `${head}\n   </${EB}event>`;
  const body: string[] = [];
  if (refines)
    body.push(`      <${EB}refinesEvent${attrs([["name", "ref1"], [`${EB}target`, refines]])}/>`);
  shape.params.forEach((p, i) =>
    body.push(`      <${EB}parameter${attrs([["name", `prm${i}`], [`${EB}identifier`, p]])}/>`));
  shape.guards.forEach((g, i) =>
    body.push(`      <${EB}guard${attrs([
      ["name", `grd${i}`], [`${EB}label`, g.label],
      [`${EB}predicate`, g.text], [`${EB}theorem`, "false"],
    ])}/>`));
  shape.actions.forEach((a, i) =>
    body.push(`      <${EB}action${attrs([
      ["name", `act${i}`], [`${EB}label`, a.label], [`${EB}assignment`, a.text],
    ])}/>`));
  return [head, ...body, `   </${EB}event>`].join("\n");
}

function machineXml(level: number, spec: SynthSpec): string {
  const isBase = level === 1;
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<${EB}machineFile${attrs([[`${EB}configuration`, "org.eventb.core.fwd"], ["version", "5"]])}>`,
    `   <${EB}seesContext${attrs([["name", "sees1"], [`${EB}target`, "sC0"]])}/>`,
  ];
  if (!isBase)
    lines.push(`   <${EB}refinesMachine${attrs([["name", "ref1"], [`${EB}target`, `sM${level - 1}`]])}/>`);

  // Every machine re-declares the variables it retains, as Rodin requires.
  for (let i = 0; i < spec.vars; i++)
    lines.push(`   <${EB}variable${attrs([["name", `var${i}`], [`${EB}identifier`, `v${i}`]])}/>`);

  // Typing invariants live in the base machine (the refinements inherit them),
  // matching the real uM2.bum / pM3.bum, which declare no invariants.
  if (isBase)
    for (let i = 0; i < spec.vars; i++)
      lines.push(`   <${EB}invariant${attrs([
        ["name", `inv${i}`], [`${EB}label`, `typ_v${i}`],
        [`${EB}predicate`, `v${i} ∈ ND ↔ PKT`], [`${EB}theorem`, "false"],
      ])}/>`);

  const initShape: EventShape | undefined = isBase
    ? {
        params: [],
        guards: [],
        actions: Array.from({ length: spec.vars }, (_, i) => ({
          label: `init_v${i}`, text: `v${i} ≔ ∅`,
        })),
      }
    : undefined;
  lines.push(eventXml(0, "INITIALISATION", initShape, undefined));

  for (let n = 1; n <= spec.eventsPerMachine; n++)
    lines.push(eventXml(n, `ev${n}`, isBase ? eventShape(n, spec) : undefined, undefined));

  lines.push(`</${EB}machineFile>`);
  return lines.join("\n") + "\n";
}

// A copy of the project's real C0.buc, so contextBlock() in the emitter does
// the same work it does on a real model (pinned scalars, opaque carriers,
// constant functions) rather than falling through to its defaults.
function contextXml(): string {
  const sets = [["set0", "PKT"]];
  const constants = [
    ["cst0", "Dests"], ["cst1", "ND"], ["cst2", "BROADCAST"],
    ["cst3", "initialSrcAddr"], ["cst4", "finalDestAddr"],
  ];
  const axioms: [string, string][] = [
    ["axm0_1", "ND ⊆ ℕ"],
    ["axm0_2", "finite(ND)"],
    ["axm0_3", "Dests ⊆ ND"],
    ["axm0_6", "finite(PKT)"],
    ["axm0_7", "initialSrcAddr ∈ PKT → ND"],
    ["axm0_71", "BROADCAST = −1"],
    ["axm0_8", "finalDestAddr ∈ PKT → ND ∪ {BROADCAST}"],
  ];
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<${EB}contextFile${attrs([[`${EB}configuration`, "org.eventb.core.fwd"], ["version", "3"]])}>`,
    ...sets.map(([n, id]) =>
      `   <${EB}carrierSet${attrs([["name", n], [`${EB}identifier`, id]])}/>`),
    ...constants.map(([n, id]) =>
      `   <${EB}constant${attrs([["name", n], [`${EB}identifier`, id]])}/>`),
    ...axioms.map(([label, pred], i) =>
      `   <${EB}axiom${attrs([
        ["name", `axm${i}`], [`${EB}label`, label],
        [`${EB}predicate`, pred], [`${EB}theorem`, "false"],
      ])}/>`),
    `</${EB}contextFile>`,
  ];
  return lines.join("\n") + "\n";
}

export function synthProject(spec: SynthSpec): SynthFile[] {
  check(spec);
  const files: SynthFile[] = [{ name: "sC0.buc", xml: contextXml() }];
  for (let level = 1; level <= spec.depth; level++)
    files.push({ name: `sM${level}.bum`, xml: machineXml(level, spec) });
  return files;
}

/** Name of the most-refined machine — the flatten/benchmark target. */
export function leafMachineName(spec: SynthSpec): string {
  return `sM${spec.depth}`;
}

// ── CLI ─────────────────────────────────────────────────────────────────
function main(argv: string[]): void {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const outDir = positional[0];
  if (!outDir) {
    console.error(
      "usage: vite-node scripts/synth-model.ts <outDir> " +
        "[--depth N] [--events N] [--vars N] [--clauses N]",
    );
    process.exit(2);
  }
  const num = (flag: string, dflt: number): number => {
    const i = argv.indexOf(flag);
    if (i < 0) return dflt;
    const v = Number(argv[i + 1]);
    if (!Number.isFinite(v)) throw new Error(`${flag} needs a number`);
    return v;
  };
  const spec: SynthSpec = {
    depth: num("--depth", 3),
    eventsPerMachine: num("--events", 5),
    vars: num("--vars", 8),
    clausesPerEvent: num("--clauses", 6),
  };
  const files = synthProject(spec);
  mkdirSync(outDir, { recursive: true });
  for (const f of files) writeFileSync(resolve(outDir, f.name), f.xml, "utf8");
  const payloadClauses = spec.eventsPerMachine * spec.clausesPerEvent + spec.vars;
  console.log(
    `Wrote ${files.length} files → ${outDir}/  ` +
      `(depth=${spec.depth}, events=${spec.eventsPerMachine}, vars=${spec.vars}, ` +
      `clauses/event=${spec.clausesPerEvent}; leaf=${leafMachineName(spec)}, ` +
      `flattened clauses=${payloadClauses})`,
  );
}

// Only run the CLI when this file is the process entry point, so importing it
// from tests/synth.test.ts does nothing. vite-node strips the script name from
// argv, leaving its own cli.mjs at argv[1]; a vitest worker leaves forks.js
// there and sets VITEST — hence both checks.
const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
const launchedAsScript =
  /\/vite-node\/dist\/cli\.mjs$/.test(entry) || /\/synth-model\.ts$/.test(entry);
if (launchedAsScript && !process.env.VITEST) main(process.argv.slice(2));

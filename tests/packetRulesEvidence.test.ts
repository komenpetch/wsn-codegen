// Mechanical guard against the bug fixed in this file's sibling change: a
// rule whose `evidence` array names events that do not actually exercise it.
// packetRules.test.ts pins BEHAVIOUR against a two-field hand-written fixture;
// this file pins TRUTH against the real corpora -- for every rule produced
// from each project's own real PacketModel, at least one of the events it
// cites as evidence must contain a clause that rule's own `match()` accepts.
// A rule whose evidence is wrong, or whose evidence names an event/project
// that does not exist, fails here by construction -- no hand-picked field
// list to hide behind.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseModel } from "../src/engine/parser";
import { flatten } from "../src/engine/flattener";
import { resolveEncodings } from "../src/engine/encodingResolver";
import { splitConjuncts } from "../src/engine/ruleEngine";
import type { EncodedMachine } from "../src/engine/types";
import { packetTypeLattice } from "../src/engine/packetTypes";
import { packetModel } from "../src/engine/packetModel";
import { packetRules } from "../src/engine/packetRules";
import { mediumRules } from "../src/engine/mediumRules";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Evidence is a "Project.eventLabel" string, and a rule built from ONE
// project's fields may legitimately cite an event from the OTHER project --
// the core packet-attribute family (pktSeqNo, pktSrc, pktFwdr, pktData,
// pktNbHops) has the same shape in both case studies, and e.g. PKT-DEL-
// pktSeqNo's real evidence spans both MintRoute.send_down and RTMCS.send_down
// and RTMCS.clear_pkt. So every project a rule might reference must be loaded
// up front, independent of which project's fields we are currently checking.
const PROJECT_DIRS: Record<string, [string, string]> = {
  MintRoute: ["EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck", "M5"],
  RTMCS: ["EventB_model/RTMCS_7_4_proof", "M6"],
  // ⚠ AN EVIDENCE CORPUS, NOT AN AUDITED PROJECT -- see AUDITED below. The
  // CommPattern chain the tool is built around, and the only corpus that
  // spells a packet-field read as a relational image (`des = ran({pkt} ◁
  // finalDestAddr)`); the two case studies spell the same read
  // `des = finalDestAddr(pkt)`. Without it PKT-IMG could cite no real clause,
  // and this catalog does not carry rules on fabricated evidence.
  AppLayer: ["Update_wsn/C0_project", "pM3"],
};

// Whose RULE SET is audited below. Evidence resolves against every corpus
// above; only these two are checked rule by rule.
//
// ⚠ The distinction is not bookkeeping. This test asks "does each rule's cited
// evidence contain a clause the rule matches", and evidence is corpus-wide by
// design -- PKT-DEL-pktSeqNo's spans both case studies. Auditing a third
// project asks a STRICTER question: that every rule built from that project's
// model is exercised by a clause somewhere. Lattice-specific rules fail it
// honestly -- TYPE-CMP built from the pattern's DATA/CONTROL lattice cannot be
// matched by `type(pkt) = BEACON`, the MintRoute clause it cites, and the
// pattern's own events use the set form `type(pkt) ∈ CONTROL` instead. That is
// a rule offered for a shape this model does not use, which is not a defect.
const AUDITED = ["MintRoute", "RTMCS"] as const;

function loadRaw(rel: string) {
  const dir = resolve(ROOT, rel);
  return parseModel(readdirSync(dir).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") })));
}

const MACHINES: Record<string, EncodedMachine> = {};
for (const [proj, [rel, leaf]] of Object.entries(PROJECT_DIRS))
  MACHINES[proj] = resolveEncodings(flatten(loadRaw(rel), leaf));

// Every guard and action of one named event, split into top-level conjuncts
// -- exactly the granularity the real rule engine matches at (ruleEngine's
// own translateEvent runs splitConjuncts before trying each rule). Returns
// undefined (not an empty array) when "Project" or "eventLabel" itself is not
// recognised, so the caller can report THAT distinctly from "recognised
// event, but no clause of it matches" -- both are evidence bugs, but a typo'd
// event name and a wrong-but-real one are different mistakes to report.
function clausesOf(evidenceRef: string): string[] | undefined {
  const [proj, label] = evidenceRef.split(".");
  const machine = MACHINES[proj];
  const event = machine?.events.find((e) => e.label === label);
  if (!event) return undefined;
  return [...event.guards.flatMap(splitConjuncts), ...event.actions.flatMap(splitConjuncts)]
    .map((c) => c.trim());
}

describe("packetRules evidence is real, not just non-empty", () => {
  for (const proj of AUDITED) {
    const [rel, leaf] = PROJECT_DIRS[proj];
    it(`every rule built from ${proj}'s real PacketModel is backed by a genuine clause in its cited evidence`, () => {
      const raw = loadRaw(rel);
      const lattice = packetTypeLattice(raw.contexts)!;
      const machine = resolveEncodings(flatten(raw, leaf));
      const pm = packetModel(raw, machine, lattice);
      const rules = [...packetRules(pm.fields), ...mediumRules(lattice)];

      // A vacuous pass (zero rules) would defeat the whole point of this
      // test -- packetModel must have found a non-trivial field set.
      expect(rules.length).toBeGreaterThan(0);

      const failures: string[] = [];
      for (const rule of rules) {
        let hit = false;
        const uncheckable: string[] = [];
        for (const evidenceRef of rule.evidence) {
          const clauses = clausesOf(evidenceRef);
          if (clauses === undefined) { uncheckable.push(evidenceRef); continue; }
          if (clauses.some((c) => rule.match(c))) { hit = true; break; }
        }
        if (hit) continue;
        failures.push(
          uncheckable.length === rule.evidence.length
            ? `${rule.id}: every cited event is unresolvable -- [${rule.evidence.join(", ")}] does not name a real Project.eventLabel`
            : `${rule.id}: none of its evidence [${rule.evidence.join(", ")}] contains a clause that ${rule.id}'s match() accepts`
        );
      }
      expect(failures, `\n${failures.join("\n")}`).toEqual([]);
    });
  }
});

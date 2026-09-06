import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateNet } from "../scripts/generate-net";
import { parseModel } from "../../wsn-codegen/src/engine/parser";
import { flatten } from "../../wsn-codegen/src/engine/flattener";
import { resolveEncodings } from "../../wsn-codegen/src/engine/encodingResolver";
import { splitConjuncts } from "../../wsn-codegen/src/engine/ruleEngine";
import { packetTypeLattice } from "../engine/packetTypes";
import { packetModel } from "../engine/packetModel";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MINT = "EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck";

describe("generateNet for MintRoute M4", () => {
  const tree = generateNet("MintRoute", "M4");
  const byExt = (e: string) => tree.find((f) => f.path.endsWith(e))!.content;

  it("emits exactly three files", () => {
    expect(tree.map((f) => f.path.split(".").pop()).sort()).toEqual(["cc", "h", "ned"]);
  });

  it("declares ROUTE and BEACON", () => {
    const h = byExt(".h");
    expect(h).toContain("ROUTE");
    expect(h).toContain("BEACON");
    expect(h).toContain("class BeaconPkt : public PPkt");
    expect(h).toContain("class RoutePkt : public PPkt");
  });

  // The 153 baseline (findings/2026-09-06-gap-baseline.md) was measured
  // BEFORE the 2026-09-06 PKT-DOM fix (task-6-report.md). That fix makes
  // `pkt ∉ dom(packetField)` -- the "this packet does not exist yet"
  // precondition of create_bconPkt/create_routePkt/create_dataPkt and the
  // "not yet re-populated" precondition of send_up -- fall through to
  // UNTRANSLATED instead of silently emitting `true`. That is a real
  // increase in the honestly-reported gap, not a regression: the old, lower
  // number was wrong. 168 was the count after that fix.
  //
  // 218 is the count after task 7's compile-gate fixes (task-7-report.md):
  // running the generated MintRoute M4 module through a real C++ compiler
  // for the first time surfaced PKT-GET/PKT-SET fabricating `p->getX()`/
  // `p->setX(v)` calls against event parameters that are always plain
  // `PktId`/int (wsn-codegen's own uniform PKT-domain parameter typing,
  // off-limits) -- code that does not compile because no PktId -> PPkt*
  // registry exists anywhere to make `p` a pointer. GET/SET now refuse those
  // clauses (see packetRules.ts, 215), and a new PKT-MEM rule refuses the
  // matching `p ↦ v ∈ pktFwdr` maplet-membership shape for the same reason.
  // 3 more (218) come from miscRules.ts's MISC-ESTNBRS-NEIGHBOURTBL-EQ:
  // `estNbrs = neighbourTbl` / `≠` in update_est/update_est_nothing/
  // bcastRou_due compares a "pair-set"-encoded variable against a
  // "map-of-sets"-encoded one (both individually correct encodings for how
  // each variable is used elsewhere), which the generic app-layer "EQ" rule
  // cannot compile. Every one of these newly-refused clauses is a real,
  // previously-silent compile hazard, not a weakened guard -- this is the
  // honest number. Pinned exactly (not `<`) so a future change to either
  // number is a deliberate, reviewed edit to this test, not a silent drift
  // in either direction.
  it("translates more of MintRoute than the app-layer catalog alone", () => {
    const all = tree.map((f) => f.content).join("\n");
    const after = (all.match(/UNTRANSLATED/g) ?? []).length;
    expect(after).toBe(218);
  });

  it("keeps the flooding events translatable", () => {
    const cc = byExt(".cc");
    for (const ev of ["start_flooding", "reset_flooding"])
      expect(cc).toContain(ev);
  });

  // Regression for the Critical finding fixed 2026-09-06 (task-6-report.md):
  // PKT-DOM used to match both `∈` and `∉ dom(F)` and emit `true` for both,
  // silently discarding the "packet does not exist yet" precondition of the
  // create_* events (and send_up's "not yet re-populated" precondition).
  // `true` is now the ONLY literal a rule in the whole combined catalog
  // (app-layer RULES + this project's packet rules) can emit -- grep the
  // catalogs, nothing else does -- so PROVING every `if (!(true))` in the
  // generated output traces to a real `∈ dom(F)` clause is equivalent to
  // proving none of them silently swallowed a `∉` guard. This test does
  // that directly against the real generated MintRoute M4 output: it
  // re-derives the flattened model independently of generate-net.ts, finds
  // every top-level `x ∉ dom(F)` guard conjunct on one of the packet
  // model's own fields, and asserts that EXACT clause text survives into
  // the .cc as an `// UNTRANSLATED GUARD` comment -- the honest outcome --
  // rather than having silently become `if (!(true))`.
  it("never collapses a ∉ dom(packetField) guard to if (!(true))", () => {
    const cc = byExt(".cc");
    const dir = resolve(ROOT, MINT);
    const raw = parseModel(readdirSync(dir).filter((f) => /\.(bum|buc)$/.test(f))
      .map((f) => ({ name: f, xml: readFileSync(resolve(dir, f), "utf8") })));
    const lattice = packetTypeLattice(raw.contexts)!;
    const model = resolveEncodings(flatten(raw, "M4"));
    const pm = packetModel(raw, model, lattice);
    const fieldNames = new Set(pm.fields.map((f) => f.ebName));

    let sawNotDomClause = false;
    for (const ev of model.events)
      for (const g of ev.guards)
        for (const clause of splitConjuncts(g)) {
          const m = /^\w+\s*∉\s*dom\(\s*(\w+)\s*\)$/.exec(clause);
          if (!m || !fieldNames.has(m[1])) continue;
          sawNotDomClause = true;
          expect(cc).toContain(clause);   // must show up verbatim as an UNTRANSLATED GUARD comment
        }
    // Sanity: M4 really does contain this shape (create_bconPkt et al.) --
    // otherwise the loop above would vacuously pass no matter what the
    // emitter did.
    expect(sawNotDomClause).toBe(true);

    // The inverse is expected and fine: an `∈ dom(F)` guard correctly and
    // vacuously translates to `true` under ENC7 (a chunk always carries all
    // its fields), producing dead-but-correct code (e.g. send_down's own
    // `pkt ∈ dom(pktSeqNo)` read-back guard, right before the DEL rule wipes
    // it). 16 is the exact, hand-audited count for MintRoute M4 as of this
    // fix (task-6-report.md) -- every occurrence traces to a genuine `∈
    // dom(pktFwdr|pktNbHops|pktSeqNo|pktSrc|pktData|pktDestAddr)` clause in
    // start_tx_*/send_down/receive_*/sink_recv_*. Pinned exactly so a rule
    // change that starts (or stops) matching ∈ differently is caught.
    const trueGuards = (cc.match(/if \(!\(true\)\)/g) ?? []).length;
    expect(trueGuards).toBe(16);
  });
});

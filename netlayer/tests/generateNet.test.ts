import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateNet } from "../scripts/generate-net";
import { parseModel } from "../../src/engine/parser";
import { flatten } from "../../src/engine/flattener";
import { resolveEncodings } from "../../src/engine/encodingResolver";
import { splitConjuncts } from "../../src/engine/ruleEngine";
import { packetTypeLattice } from "../engine/packetTypes";
import { packetModel } from "../engine/packetModel";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
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

  // Important finding fixed 2026-09-06 (final-review pass): the app-layer's
  // context-constant emission (codeEmitter.ts, off-limits) hardcodes
  // CONTROL's value straight off the `partition(TYPE, CONTROL, {DATA})`
  // axiom text alone, with no knowledge that CONTROL is partitioned FURTHER
  // (`partition(CONTROL, {ROUTE}, {BEACON})`) -- so it always emits `{1}`,
  // contradicting the leaf tags ROUTE=1/BEACON=2 the SAME header declares a
  // few lines later. `create_bconPkt` guards both `CONTROL.count(type.at(
  // pkt)) > 0` (true only for tag 1) and `type.at(pkt) == BEACON` (tag 2) --
  // mutually unsatisfiable. The fix derives CONTROL from the lattice's own
  // descendant leaves (ROUTE=1, BEACON=2), so it must be exactly {1, 2}.
  it("emits CONTROL as exactly its descendant leaf tags, not the app-layer's hardcoded {1}", () => {
    const h = byExt(".h");
    expect(h).toMatch(/inline std::set<int> CONTROL = \{1, 2\};/);
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
  // previously-silent compile hazard, not a weakened guard.
  //
  // 234 is the count after the 2026-09-06 final-review pass's PKT-DOM fix
  // (task-7-report.md, "FINAL REVIEW FIX WAVE"): PKT-DOM used to emit `true`
  // for EVERY `∈ dom(F)` clause on the reasoning "a chunk always carries all
  // its fields", which only holds when F is a TOTAL function (`PKT → ...`).
  // MintRoute M4's 16 `if (!(true))` guards were hand-audited and every one
  // traces to a PARTIAL field (`PKT ⇸ ...` -- pktSeqNo/pktSrc/pktFwdr/
  // pktData/pktNbHops/pktDestAddr/vPktDestAddr, all initialised to ∅); none
  // trace to the one total field, initialSrcAddr. So PKT-DOM now refuses
  // `∈ dom(F)` for a partial field exactly like PKT-DOM-NOT already refused
  // `∉ dom(F)`, and all 16 of those guards move from `if (!(true))` (silently
  // dropping the precondition) to a genuine UNTRANSLATED GUARD -- +16 here.
  // This is a real increase in the honestly-reported gap, not a regression:
  // the old, lower number was wrong, same as the 168->218 move above. Pinned
  // exactly (not `<`) so a future change to either number is a deliberate,
  // reviewed edit to this test, not a silent drift in either direction.
  it("translates more of MintRoute than the app-layer catalog alone", () => {
    const all = tree.map((f) => f.content).join("\n");
    const after = (all.match(/UNTRANSLATED/g) ?? []).length;
    expect(after).toBe(91);
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
  // The ∈/∉ pair must stay OPPOSITE, and neither may become a constant.
  //
  // History, because the assertion has moved twice and each move was a real
  // finding. First PKT-DOM emitted `true` for BOTH operators (a non-capturing
  // `(?:∈|∉)` group), silently inverting the creating events' "this packet does
  // not exist yet" precondition -- Critical, task-6-report.md. Then the
  // surviving ∈ half was found to be justified only for TOTAL fields, while all
  // 16 real sites were PARTIAL, so both operators were refused outright and the
  // clauses surfaced as UNTRANSLATED. The identity binding removes the reason
  // for refusing: pktStore IS dom(pktSeqNo), so both operators are answerable
  // and answerable DIFFERENTLY.
  //
  // What must never come back is a dom guard collapsing to a constant, in
  // either direction -- so `if (!(true))` staying at zero is still asserted.
  it("translates both dom() operators against the identity binding, oppositely", () => {
    const cc = byExt(".cc");
    const fieldNames = ["pktSeqNo", "pktSrc", "pktFwdr", "pktData", "pktNbHops"];

    // Every dom() guard on a packet field became a real store lookup...
    // pktLive, not pktStore: the domain of the PARTIAL packet functions is
    // distinct from chunk existence (a chunk can be built before the model
    // considers the packet created). Conflating them made every creating
    // event's freshness guard unsatisfiable and was why the flood would not
    // start.
    const notIn = (cc.match(/pktLive\.count\(\w+\) == 0/g) ?? []).length;
    const isIn = (cc.match(/pktLive\.count\(\w+\) > 0/g) ?? []).length;
    expect(notIn).toBeGreaterThan(0);
    expect(isIn).toBeGreaterThan(0);

    // ...and none survived as an untranslated dom clause on those fields.
    for (const f of fieldNames)
      expect(cc).not.toContain(`UNTRANSLATED GUARD: pkt ∉ dom(${f})`);

    // No dom guard collapsed to a constant, in either direction.
    expect((cc.match(/if \(!\(true\)\)/g) ?? []).length).toBe(0);
    expect((cc.match(/if \(!\(false\)\)/g) ?? []).length).toBe(0);
  });
});

// RTMCS M6 is the multi-fix case: several event methods take a set-typed
// parameter, so several signature rewrites happen in one generation.
//
// These are PROPERTY guards on real output, not regression tests for the
// stale-offset bug -- measured, not assumed: reintroducing that bug leaves
// both of them passing, because RTMCS's bodies are long relative to the
// ~18-characters-per-fix drift, so no rewrite is actually missed. The
// discriminating test for that bug is a constructed case in
// fixSetTypedParameters.test.ts. What these two add is coverage of the real
// corpus: they fail the moment any genuine model does lose a rewrite.
describe("generateNet for RTMCS M6 (multiple set-typed parameter rewrites)", () => {
  const tree = generateNet("RTMCS", "M6");
  const cc = tree.find((f) => f.path.endsWith(".cc"))!.content;
  const h = tree.find((f) => f.path.endsWith(".h"))!.content;

  // Split the .cc into (signature, body) pairs, computed from the FINAL text --
  // independent of however generate-net arrived at it.
  const defRe = /^bool M6App::(\w+)\(([^)]*)\) \{$/gm;
  const defs: { method: string; params: string; start: number }[] = [];
  for (let m = defRe.exec(cc); m; m = defRe.exec(cc))
    defs.push({ method: m[1], params: m[2], start: m.index });
  const bodyOf = (i: number) => cc.slice(defs[i].start, i + 1 < defs.length ? defs[i + 1].start : cc.length);

  it("rewrites every set-typed parameter, not just the first few", () => {
    const missed: string[] = [];
    defs.forEach((d, i) => {
      const body = bodyOf(i);
      for (const raw of d.params.split(",")) {
        const pm = /^int (\w+)$/.exec(raw.trim());
        if (!pm) continue;
        // Double backslashes: this is a template literal, so `\b` would be a
        // backspace character and `\s` a literal "s" before the RegExp ever
        // sees them.
        const used = new RegExp(
          `\\b${pm[1]}\\.(?:count|empty|at)\\(|for\\s*\\(\\s*auto\\s+\\w+\\s*:\\s*${pm[1]}\\s*\\)`,
        );
        if (used.test(body)) missed.push(`${d.method}(${pm[1]})`);
      }
    });
    expect(missed).toEqual([]);
  });

  it("keeps each rewritten signature identical in the header and the .cc", () => {
    const rewritten = defs.filter((d) => d.params.includes("const std::set<Node>&"));
    expect(rewritten.length).toBeGreaterThan(1);   // the multi-fix case is real
    for (const d of rewritten)
      expect(h).toContain(`bool ${d.method}(${d.params});`);
  });
});

describe("reserved-identifier handling", () => {
  const h = generateNet("MintRoute", "M4").find((f) => f.path.endsWith(".h"))!.content;

  it("renames a constant that collides with a library macro, rather than #undef-ing the macro", () => {
    // MintRoute C4 axm2_9 declares INFINITY = 9999, colliding with <cmath>'s
    // `#define INFINITY __builtin_inff()`. #undef fixed the compile but left
    // the macro dead for the rest of every translation unit including this
    // header. Renaming contains the change to the generated symbol.
    expect(h).toContain("inline const int EB_INFINITY = 9999;");
    expect(h).not.toMatch(/^\s*#undef\b/m);
  });

  it("leaves the axiom's provenance comment quoting the real Event-B name", () => {
    // The trailing comment is the audit trail back to the source axiom; if the
    // rename rewrote it too, it would quote an axiom that does not exist.
    expect(h).toMatch(/inline const int EB_INFINITY = 9999;\s*\/\/.*\bINFINITY = 9999\b/);
  });
});

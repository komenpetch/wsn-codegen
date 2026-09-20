import { describe, it, expect } from "vitest";
import { generate, defaultName } from "../src/engine/pipeline";
import { loadProject } from "../scripts/projects";
import { parseModel } from "../src/engine/parser";
import { flatten } from "../src/engine/flattener";
import { resolveEncodings } from "../src/engine/encodingResolver";
import { packetModelOf } from "../src/engine/packetModel";
import { senderFieldOf, transmitEventsOf } from "../src/engine/packetOps";
import type { GeneratedTree } from "../src/engine/types";

// Through the ONE public entry point. `generate` takes the network branch by
// itself when the target machine has a medium, so these assertions also prove
// that detection works — a regression that stopped detecting it would show up
// here as a missing PPkt, not as a silently app-layer module.
const gen = (project: string, machine: string): GeneratedTree =>
  generate(loadProject(project), machine, defaultName(machine), 2);

describe("generate (network branch) for MintRoute M4", () => {
  const tree = gen("MintRoute", "M4");
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
  // 88 -> 82 with the medium binding (2026-09-07). Six clauses, all on the
  // receiving side of a transmission and all invisible until something was
  // actually received: send_up's five `{pkt} ⩤ vPkt*` domain subtractions
  // (DOMSUB-SINGLETON) and its `ran({pkt} ◁ envNeighbours) ∈ (ℙ(ND) ∪
  // {{FAILED_XMIT}})` well-typedness guard (IMG-NO-MIX). The other fixes of
  // that round do not move this number because they replace a translation
  // that was already there and already compiled -- and was always false
  // (`type.count(pkt)` against the map ENC7 replaced, `pktNbHops.at(pkt)`
  // against a map nothing writes). That is the point worth remembering here:
  // this count measures what is VISIBLY missing, and the receive path's real
  // problem was a guard that looked translated.
  // 2026-09-13: 82 -> 78. Two shapes the catalog was missing: `delta ≥ 0` (a
  // bare scalar against a literal, ARITH-CMP-LIT) and the per-key chunk write
  // `netSeqNo(pkt) ≔ lsno` (PKT-SET-KEY).
  //
  // 2026-09-14: 78 -> 34, the pair-keyed function encoding UN-PARKED. The 44
  // clauses are the ones keyed by a maplet -- `lastSeqno(y ↦ x)` and the five
  // others over `neighbourTbl` -- which the generic function rule could only
  // refuse, since `std::map<Node, T>` has nowhere to put a pair. 34 is the
  // figure the parked design measured before it was parked, reached again from
  // the module it kept verbatim, which is the check that it was re-applied
  // rather than re-derived into something else.
  // 2026-09-14: 34 -> 33. `bcastRouTimer ≔ FALSE` in INITIALISATION is realised
  // by the member initialiser now (`bool bcastRouTimer = false;`), which is
  // what a member initialiser MEANS, so reporting it as untranslated was false.
  // ⚠ The same assignment inside an EVENT is still untranslated and still
  // counted -- a declaration cannot express a state change.
  // 2026-09-20: 33 -> 30. A set LITERAL is a leaf of a set expression now
  // (setExpr.ts), so the three `x ∈ ND ∖{Sink}` guards translate -- the
  // set-difference gap this file's own history recorded. ⚠ MEASURED TO BE
  // BEHAVIOUR-NEUTRAL, not assumed: all three live in `sensing`,
  // `start_sensing` and `create_dataPkt`, which are the PEnv boundary --
  // `not schedulable ... no binding for sd`, no `try_` method, zero call
  // sites -- and the emitted `.h` is byte-identical across the change, which
  // is what the next assertion pins.
  it("translates more of MintRoute than the app-layer catalog alone", () => {
    const all = tree.map((f) => f.content).join("\n");
    const after = (all.match(/UNTRANSLATED/g) ?? []).length;
    expect(after).toBe(30);
  });

  // The guard on the claim above: the three newly translated bodies belong to
  // events nothing can schedule, so translating them cannot move the flood.
  // If a future change makes one of them schedulable, this fails and says so
  // rather than letting PEnv traffic appear in a measured run unannounced.
  it("and the three it gained are all PEnv events nothing schedules", () => {
    const h = tree.find((f) => f.path.endsWith(".h"))!.content;
    for (const ev of ["sensing", "start_sensing", "create_dataPkt"]) {
      expect(h).toContain(`// not schedulable: ${ev} --`);
      expect(h).not.toContain(`bool try_${ev}();`);
    }
  });

  // ⚠ THE ORDER OF THE NET RULES IN netPipeline.ts IS BEHAVIOUR, NOT STYLE,
  // and this is the test that says so.
  //
  // `SETEXPR-PAIR-MEM` matches `a ↦ b ∈ dom(F)` for any pair-shaped F and
  // deliberately emits "" for the shapes it cannot answer — the
  // intercept-and-refuse technique several rules rely on. A pair-keyed
  // function is one of those shapes, so whichever rule set is offered FIRST
  // wins the clause, and only `pairKeyedRules` can actually translate it.
  //
  // Measured, by moving pairKeyedRules to the end of that array: MintRoute M4
  // goes 34 → 45 untranslated and exactly these nine guards stop translating —
  // `nd ↦ nb ∈ dom(lastSeqno)`, the same over missed / receiveEst / received /
  // sentEst, and three over liveliness.
  //
  // The untranslated COUNT above would also catch a reorder, but it catches it
  // as a bare number: someone who reorders sees `expected 45 to be 34` and can
  // "fix" it by editing that number. This one names the constraint, so the
  // failure says what was broken.
  it("lets the pair-keyed rules claim a domain test before the set-expression rules", () => {
    const h = byExt(".h"), cc = byExt(".cc");
    // The pair-keyed variables, read off the emitted header rather than listed
    // here — a hardcoded name would test a constant, and this set is exactly
    // what fixPairKeyedDeclarations rewrote.
    const pairKeyed = new Set(
      [...h.matchAll(/std::map<std::pair<[^>]*>,[^>]*>\s+(\w+);/g)].map((m) => m[1]));
    expect(pairKeyed.size).toBeGreaterThan(0);

    const refused = [...cc.matchAll(/UNTRANSLATED GUARD: [^\n]*?dom\((\w+)\)/g)]
      .map((m) => m[1]).filter((v) => pairKeyed.has(v));
    expect(refused).toEqual([]);
  });

  it("leaves no scalar member uninitialised", () => {
    // ⚠ `bool bcastRouTimer;` was emitted with no initialiser and read by three
    // guards before anything assigned it. Reading it is undefined behaviour; it
    // happened to read false, which is why create_routePkt never fired — a real
    // defect wearing the costume of correct behaviour, since the same source on
    // another toolchain may read true and start broadcasting route packets.
    //
    // Containers are exempt and must stay exempt: std::set and std::map
    // default-construct empty, which is exactly what the model's `v ≔ ∅` says,
    // and demanding `= {}` there would be noise.
    const h = byExt(".h");
    const state = h.slice(h.indexOf("── Event-B machine state ──"));
    const uninitialised = [...state.matchAll(/^\s+(bool|int|Node|Data|PktId|long)\s+(\w+);$/gm)]
      .map((m) => `${m[1]} ${m[2]}`);
    expect(uninitialised).toEqual([]);
  });

  it("stops reporting an initialisation the declaration realises", () => {
    expect(byExt(".h")).toContain("bool bcastRouTimer = false;");
    // ⚠ Only the INITIALISATION clause. The event-level assignments to the same
    // variable are a state change a declaration cannot express, so they are
    // still counted — the gap stays visible.
    expect(byExt(".cc")).toContain("UNTRANSLATED ACTION: bcastRouTimer ≔ TRUE");
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
describe("generate (network branch) for RTMCS M6 (multiple set-typed parameter rewrites)", () => {
  const tree = gen("RTMCS", "M6");
  const cc = tree.find((f) => f.path.endsWith(".cc"))!.content;
  const h = tree.find((f) => f.path.endsWith(".h"))!.content;

  // Split the .cc into (signature, body) pairs, computed from the FINAL text --
  // independent of however generate-net arrived at it.
  // The class name is read off the emitted file, not written in. Hardcoding it
  // was silently self-defeating: after the rename to M6Net this regex matched
  // nothing, `defs` was empty, and the first of these two tests passed while
  // checking zero methods. Only the second one -- which asserts it found
  // something -- failed. Deriving it removes the trap.
  const cls = tree.find((f) => f.path.endsWith(".cc"))!.path.replace(/\.cc$/, "");
  const defRe = new RegExp(String.raw`^bool ${cls}::(\w+)\(([^)]*)\) \{$`, "gm");
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
  const h = gen("MintRoute", "M4").find((f) => f.path.endsWith(".h"))!.content;

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

// v5: the app layer's SensorApp shell carrying the packet pattern class.
//
// The point of the version is that PPkt is a PATTERN, not a possession of the
// protocol it was read off: the module is generated from the app-layer chain and
// the packet classes come from MintRoute's partition. v4 must not move, because
// it is the compare table's frozen artifact.
describe("v5 = SensorApp shell + PPkt from another project", () => {
  const tree = generate(loadProject("AppLayer"), "pM3", "Pm3Wsn", 3,
    { files: loadProject("MintRoute"), machine: "M4" });
  const h = tree.find((f) => f.path.endsWith(".h"))!.content;

  it("keeps the app layer's shell, not the network protocol's", () => {
    expect(h).toContain("class Pm3Wsn : public ApplicationBase, public INetworkSocket::ICallback {");
    expect(h).not.toContain("NetworkProtocolBase");
  });

  it("carries the packet source's leaf classes, not its own", () => {
    // The app-layer chain's own partition yields DATA/CONTROL and one leaf; the
    // three below are MintRoute's, which is the whole point of --ppkt-from.
    for (const c of ["class DataPkt : public PPkt", "class RoutePkt : public PPkt",
                     "class BeaconPkt : public PPkt"]) expect(h).toContain(c);
  });

  it("reconciles CONTROL with the packet source's lattice", () => {
    // The app-layer context alone emits `CONTROL = {1}` off its own partition
    // axiom. Carrying MintRoute's PPkt makes CONTROL the parent of ROUTE(1) and
    // BEACON(2), so the constant has to agree with the enum it now sits beside
    // -- otherwise a `CONTROL.count(type)` guard and a `type == BEACON` guard in
    // the same event are mutually unsatisfiable.
    expect(h).toContain("inline std::set<int> CONTROL = {1, 2};");
    expect(h).toContain("inline const int ROUTE = 1;");
    expect(h).toContain("inline const int BEACON = 2;");
  });

  it("is namespaced, so it can link beside another generated module", () => {
    expect(h).toContain("namespace eb_pm3wsn {");
  });

  // ⚠ This used to refuse: "structure 3 needs a packet source". The pattern was
  // an INPUT then — handed in through `--ppkt-from`, so the user supplied two
  // projects and the generator knew nothing about the pattern it embodies. It
  // now ships inside the tool, and one project is enough.
  it("needs no second project: the bundled extension is the default", () => {
    const t = generate(loadProject("AppLayer"), "pM3", "Pm3Wsn", 3);
    const h = t.find((f) => f.path.endsWith(".h"))!.content;
    // PPkt is carried: the chunk, and the sequence number the extension adds.
    expect(h).toContain("class PPkt : public inet::FieldsChunk");
    expect(h).toMatch(/int seqNum = 0;\s*\/\/ Event-B: pktSeqNo/);
    // ⚠ AND NO CONTROL LEAF IS INVENTED. This used to assert RoutePkt and
    // BeaconPkt, because the extension bundled MintRoute's
    // `partition(CONTROL, {ROUTE}, {BEACON})`. The leaves come from the
    // uploaded project now, and this one declares no control split at all —
    // so a model that draws no distinction between control subtypes correctly
    // gets none invented for it. controlLeaves.test.ts covers the projects
    // that do declare one.
    expect(h).not.toContain("class RoutePkt");
    expect(h).not.toContain("class BeaconPkt");
    expect(h).toContain("class DataPkt : public PPkt");
  });
});

// ⚠ Structure 3 pairs TWO projects, and the pairing can be incoherent. Until
// these two refusals existed the generator accepted both combinations below,
// emitted a module, and reported success -- the failure surfaced only when the
// user compiled it in OMNeT++. Both were measured against INET 4.5 with the
// bundled clang: 13 errors and 1 error respectively.
describe("v3 refuses an incoherent pairing instead of emitting a module that cannot compile", () => {
  it("refuses a packet source whose lattice lacks a type the base model uses", () => {
    // The slots are not interchangeable. MintRoute's events guard on BEACON and
    // ROUTE; the AppLayer partition declares only DATA/CONTROL, so the emitted
    // module said `PktType::BEACON` against an enum with no such member and
    // redefined CONTROL as `const int` beside the base context's `std::set<int>`.
    const run = () => generate(loadProject("MintRoute"), "M4", "M4Wsn", 3,
      { files: loadProject("AppLayer"), machine: "pM3" });
    expect(run).toThrow(/BEACON/);
    expect(run).toThrow(/ROUTE/);
    // ⚠ And it must name ONLY the packet types. The lattice tracks every
    // partition in the contexts, so a naive walk of its children reported
    // CTL_STATUS, ENV_STATUS, PKT and raw axiom text as "missing packet types" --
    // a message that buries the two names that matter in forty that do not.
    expect(run).not.toThrow(/CTL_STATUS|ENV_STATUS/);
  });

  it("refuses a base model whose delivery event is not the CommPattern shape", () => {
    // The arrival binds `send_up(x, pkt, nbrs)` -- the abstract CommPattern
    // delivery. MintRoute's own send_up takes the wire fields as parameters
    // because it IS the deserialiser, so the emitted call passed 3 arguments to
    // a method declaring 8. A model with its own medium belongs in structure 2,
    // which gives it the network-protocol shell rather than the app shell.
    expect(() => generate(loadProject("MintRoute"), "M4", "M4Wsn", 3,
      { files: loadProject("MintRoute"), machine: "M4" }))
      .toThrow(/send_up/);
  });

  it("does not schedule an event nothing can enable, and says why", () => {
    // ⚠ 18 try_ methods were emitted and 7 ever fired. The other 11 are not a
    // translation gap -- each needs something no runnable code produces:
    //
    //   create_routePkt      guards `bcastRouTimer = TRUE`; that variable is
    //                        assigned NOWHERE in the module.
    //   start_tx_routePkt    needs a ROUTE packet, which only create_routePkt makes.
    //   dest_recv_pkt        }  all guard `recvBuff`, which is written only by
    //   fwdr_receive_pkt     }  `receive` -- an event a carried refinement
    //   clear_recvdBuff      }  supersedes, so it never runs.
    //   *_dataPkt (4)        need a DATA packet; create_dataPkt is unschedulable
    //                        (no binding for `sd` -- the PEnv sensing boundary).
    //
    // The analysis reads the EMITTED module, not the model: WiMedium is filled
    // by the ARRIVAL rather than by any scheduled event, so a model-only
    // producer scan would call receive_controlPkt unreachable and kill the flood.
    const t = generate(loadProject("AppLayer"), "pM3", "Pm3Wsn", 3,
      { files: loadProject("MintRoute"), machine: "M4" });
    const cc = t.find((f) => f.path.endsWith(".cc"))!.content;
    const h = t.find((f) => f.path.endsWith(".h"))!.content;

    for (const dead of ["create_routePkt", "start_tx_routePkt", "dest_recv_pkt",
                        "fwdr_receive_pkt", "clear_recvdBuff", "receive_dataPkt",
                        "receive_dup_dataPkt", "sink_recv_dataPkt", "start_tx_dataPkt"])
      expect(cc).not.toContain(`bool Pm3Wsn::try_${dead}(`);

    // ⚠ And the flood must survive. These are the seven that actually fired.
    for (const live of ["start_flooding", "create_bconPkt", "start_tx_bconPkt",
                        "send_down", "receive_controlPkt", "receive_dup_controlPkt",
                        "finish_tx_pkt"])
      expect(cc).toContain(`bool Pm3Wsn::try_${live}(`);

    // A dropped event states its reason, like every other exclusion.
    expect(h).toMatch(/not scheduled: create_routePkt -- .*bcastRouTimer/);
    expect(h).toMatch(/not scheduled: dest_recv_pkt -- .*recvBuff/);
  });

  it("runs the drain events on the arrival, not on the timer", () => {
    // The hand-written MintRoute calls updateNbrCounters() at the top of
    // onReceiveBeaconPkt -- the neighbour counters are updated BY the reception.
    // The model says the same thing as `add_newEntry` / `update_nbr`, the events
    // that drain what the receive events fill, so they are emitted at the
    // arrival. Giving them try_ methods would put a second, timer-driven
    // account of one reception into the module.
    const t = generate(loadProject("AppLayer"), "pM3", "Pm3Wsn", 3,
      { files: loadProject("MintRoute"), machine: "M4" });
    const cc = t.find((f) => f.path.endsWith(".cc"))!.content;
    const body = (fn: string) =>
      cc.slice(cc.indexOf(`bool Pm3Wsn::${fn}()`)).split("\n}")[0];

    for (const drain of ["add_newEntry", "update_nbr"]) {
      expect(cc).not.toContain(`bool Pm3Wsn::try_${drain}(`);
      expect(body("runDeliveryEvents")).toContain(`${drain}(`);
      expect(body("runEnabledEvents")).not.toContain(drain);
    }
    // ⚠ And after the receive events, never before: they are what fills the
    // state the drains consume.
    const d = body("runDeliveryEvents");
    expect(d.indexOf("receive_controlPkt")).toBeLessThan(d.indexOf("update_nbr"));
  });

  it("mints a packet only for an event that creates one", () => {
    // ⚠ A `∉` guard alone does not mean "this event creates the packet".
    // `final_tx_controlPkt` guards `pkt ∈ middleware` AND `pkt ∉ sensedPkts`,
    // and reading only the second minted a fresh ROUTE packet every tick for an
    // event whose job is to retire one that exists -- which then fooled the
    // reachability pass into scheduling start_tx_routePkt, because a minted and
    // stamped packet looks exactly like a produced one.
    const t = generate(loadProject("AppLayer"), "pM3", "Pm3Wsn", 3,
      { files: loadProject("MintRoute"), machine: "M4" });
    const cc = t.find((f) => f.path.endsWith(".cc"))!.content;
    // ⚠ `/^creat/`, not `/^create_/`. The property is "only a CREATING event
    // mints", and the two models spell that differently: MintRoute's are
    // `create_bconPkt`/`create_routePkt`, the CommPattern's abstract one is
    // `creatingControlPacket`. The narrower pattern passed only while
    // `creatingControlPacket` was being dropped by the reachability pass for a
    // reason that turned out to be false (`nothing fills Dests`, when the guard
    // `x ∈ ND ∖ Dests` wants x OUTSIDE it) -- so the test was resting on a bug.
    for (const m of cc.matchAll(/bool Pm3Wsn::try_(\w+)\(\)\n\{([\s\S]*?)\n\}/g))
      if (m[2].includes("newPktId()")) expect(m[1]).toMatch(/^creat/);
    // ⚠ And the arrival mints nothing at all. The drain events are emitted
    // inline there rather than as try_ methods, so scanning only try_ methods
    // would have missed final_tx_controlPkt -- the event this narrowing is
    // about. A reception that creates a packet is the zero-time loop.
    expect(cc.slice(cc.indexOf("bool Pm3Wsn::runDeliveryEvents()")).split("\n}")[0])
      .not.toContain("newPktId()");
    // The creating events must still mint -- the narrowing above retired
    // create_bconPkt once, and took the whole flood with it.
    expect(cc).toContain("bool Pm3Wsn::try_create_bconPkt()");
    expect(cc.slice(cc.indexOf("bool Pm3Wsn::try_create_bconPkt()")))
      .toContain("newPktId()");
  });

  it("answers a maplet over a packet field from the chunk", () => {
    // `pkt ↦ x ∈ pktFwdr` is a function's graph tested by maplet membership,
    // which is legal Event-B because a function IS its graph. Refusing it left
    // update_nbr schedulable and permanently declining, so `updateNbrs` was
    // never drained and each node accepted one packet per forwarder for ever.
    const t = generate(loadProject("AppLayer"), "pM3", "Pm3Wsn", 3,
      { files: loadProject("MintRoute"), machine: "M4" });
    const cc = t.find((f) => f.path.endsWith(".cc"))!.content;
    const upd = cc.slice(cc.indexOf("bool Pm3Wsn::update_nbr(")).split("\n}")[0];
    expect(upd).toContain("getFwdrAddr() ==");
    expect(upd).not.toContain("UNTRANSLATED");
    // It reaches its actions, which is the whole point: the erase is the drain.
    expect(upd).toContain("updateNbrs.erase(");
  });

  it("still accepts the coherent pairing", () => {
    // The guard rails must not block the configuration that works: the AppLayer
    // chain as the base with MintRoute supplying the packet class.
    expect(() => generate(loadProject("AppLayer"), "pM3", "Pm3Wsn", 3,
      { files: loadProject("MintRoute"), machine: "M4" })).not.toThrow();
  });
});

// v5 carrying the pattern's OPERATIONS, not just its types.
describe("v5 carries the packet pattern's operations", () => {
  const tree = generate(loadProject("AppLayer"), "pM3", "Pm3Wsn", 3,
    { files: loadProject("MintRoute"), machine: "M4" });
  const h = tree.find((f) => f.path.endsWith(".h"))!.content;
  const cc = tree.find((f) => f.path.endsWith(".cc"))!.content;

  it("carries the events that CREATE each leaf class", () => {
    // Without these the leaf classes are declared and never constructed: the
    // event that creates a beacon is a MintRoute machine event.
    for (const e of ["create_dataPkt", "create_bconPkt", "create_routePkt"])
      expect(cc).toContain(`bool Pm3Wsn::${e}(`);
  });

  it("carries the state those events need, from the packet source", () => {
    // 18 of MintRoute's variables come across with them; an event without its
    // state does not translate.
    for (const v of ["floodTbl", "floodSeqNo", "xmittedPkts", "middleware"])
      expect(h).toContain(` ${v};`);
  });

  it("declares the packet source's context constants, deduplicated", () => {
    // create_bconPkt guards `s = Sink`, and Sink is a MintRoute T01 constant.
    expect(h).toContain("inline const int Sink = 0;");
    // Both projects declare DATA; emitting it twice is a redefinition.
    const dataDecls = h.match(/^inline const int DATA\b/gm) ?? [];
    expect(dataDecls.length).toBe(1);
  });

  it("carries the TRANSMIT events, derived from what send_down observes", () => {
    // send_down has no actions -- it observes `x ↦ pkt ∈ sentDown`. The transmit
    // events are the ones whose actions feed that variable; nothing matches on
    // the string "start_tx".
    for (const e of ["start_tx_dataPkt", "start_tx_bconPkt", "start_tx_routePkt"])
      expect(cc).toContain(`bool Pm3Wsn::${e}(`);
  });

  it("emits one transmit method per packet type, named as MintRoute names its own", () => {
    for (const m of ["sendDataBroadcast", "sendRouteBroadcast", "sendBeaconBroadcast"]) {
      expect(cc).toContain(`void Pm3Wsn::${m}(Node x, PktId pkt)`);
      expect(h).toContain(`virtual void ${m}(Node x, PktId pkt);`);
    }
  });

  it("sends through the socket, since an application has no sendDown", () => {
    const fn = cc.slice(cc.indexOf("void Pm3Wsn::sendBeaconBroadcast"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("socket->send(packet);");
    expect(body).not.toContain("sendDown(");
    // Broadcast, because that is what the model means by a transmit.
    expect(body).toContain("setDestAddress(broadcastAddress())");
  });

  it("sends the model's own packet, not the placeholder payload", () => {
    // The CommPattern merge put SensorApp's ByteCountChunk transmit inside
    // send_down, addressed to the sink. That was right while the model had no
    // packet of its own; now it has one.
    const fn = cc.slice(cc.indexOf("bool Pm3Wsn::sendSensorPacket(Node x, PktId pkt)"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    // ⚠ WITH THE SENDER. The transmit pins the wire copy from send_down's own
    // `x` rather than reading it back off the shared local chunk, which an
    // arrival of the same packet can overwrite between the stamp and the send.
    expect(body).toContain("transmitPacket(x, pkt);");
    // The CONSTRUCTION, not the word -- the comment left behind names what was
    // replaced, and asserting on the word matched that instead.
    expect(body).not.toContain("makeShared<ByteCountChunk>");
    // the event's own guard survives the rewrite
    expect(body).toContain("sentDown.count({x, pkt}) > 0");
  });
});

// A scheduler bail-out must undo what it synthesised.
//
// Found by instrumenting a running simulation: pktStore grew by one per declined
// creating event per tick on every node whose floodSeqNo had no entry for Sink.
// The rollback sat only at the bottom of the method, so any earlier bail-out
// returned past it. The leak was not only memory -- try_receive iterates
// pktStore, so the phantom packets made `receive` fire on nodes that had
// received nothing, which is how it was noticed.
describe("the scheduler rolls back on every failure path", () => {
  const tree = generate(loadProject("MintRoute"), "M4", "M4Wsn", 2);
  const cc = tree.find((f) => f.path.endsWith(".cc"))!.content;

  it("undoes a minted packet when a later precondition bails", () => {
    const fn = cc.slice(cc.indexOf("bool M4Wsn::try_create_bconPkt()"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    // The mint comes first, then a precondition on a LATER parameter.
    expect(body).toContain("PktId pkt = newPktId();");
    expect(body).toContain("if (floodSeqNo.count(s) == 0) { pktStore.erase(pkt); return false; }");
  });

  it("leaves no bail-out after a mint without a rollback", () => {
    for (const m of cc.matchAll(/^bool M4Wsn::try_(\w+)\(\)\n\{\n([\s\S]*?)\n\}/gm)) {
      const [, name, body] = m;
      const mintAt = body.indexOf("newPktId()");
      if (mintAt < 0) continue;                       // nothing synthesised
      const lines = body.slice(mintAt).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/\b(return false|continue);/.test(line)) continue;
        if (line.includes("firedCount")) continue;    // the success path
        // Either the rollback is inline with the bail, or it is the statement
        // immediately before it (the method's final failure path).
        const rolled = /pktStore\.erase/.test(line) || /pktStore\.erase/.test(lines[i - 1] ?? "");
        expect(rolled, `try_${name}: bail-out without a rollback -> ${line.trim()}`).toBe(true);
      }
    }
  });
});

// The four defects that stood between "v5 transmits" and "v5 floods", each
// found by instrumenting a running simulation rather than by reading the code.
describe("v5 arrival: the four fixes that made the flood propagate", () => {
  const tree = generate(loadProject("AppLayer"), "pM3", "Pm3Wsn", 3,
    { files: loadProject("MintRoute"), machine: "M4" });
  const h = tree.find((f) => f.path.endsWith(".h"))!.content;
  const cc = tree.find((f) => f.path.endsWith(".cc"))!.content;
  const arrival = cc.slice(cc.indexOf("void Pm3Wsn::socketDataArrived(INetworkSocket"));
  const body = arrival.slice(0, arrival.indexOf("\n}"));

  it("undoes the staged medium state when the delivery declines", () => {
    // Stage, fail, don't roll back -- the same defect as the scheduler's
    // bail-out leak. Every declined arrival used to leave its pair in sentDown,
    // which nothing removes, so the forwarding event's `pkt not-in ran(sentDown)`
    // guard could never be true again.
    for (const v of ["sentDown", "WiMedium"]) {
      expect(body).toContain(`bool _st_${v} = ${v}.insert({_f, _pkt}).second;`);
      expect(body).toContain(`if (_st_${v}) ${v}.erase({_f, _pkt});`);
    }
    // The opposite polarity: send_up guards `x |-> pkt not-in sentUp`, so the
    // arrival ERASES and must put back what it erased.
    expect(body).toContain("bool _st_sentUp = sentUp.erase({_f, _pkt}) > 0;");
    expect(body).toContain("if (_st_sentUp) sentUp.insert({_f, _pkt});");
    // `.second` / `> 0`, not a bare insert: undoing a membership the set
    // already held would delete state the MODEL owns.
    expect(body).not.toMatch(/^\s*sentDown\.insert\(\{_f, _pkt\}\);\s*$/m);
  });

  it("tests an echo against every address the node answers to, not one", () => {
    // An IP stack loops a limited broadcast back with the LOOPBACK source
    // address: measured `me=10.0.0.1 src=127.0.0.1`, so `src == myNetwAddr` was
    // false and the node accepted and re-stamped its own beacon.
    expect(body).toContain("isOwnAddress(_srcInd->getSrcAddress())");
    expect(body).not.toContain("_srcInd->getSrcAddress() == myNetwAddr");
    expect(cc).toContain("findInterfaceTableOf(getContainingNode(this))");
    expect(cc).toContain("ift->findInterfaceByAddress(addr) != nullptr");
  });

  it("retires the base events the carried ones supersede", () => {
    // Two kinds of evidence, and both must fire. DECLARED: Rodin records that
    // start_tx_bconPkt refines start_tx, and the base start_tx re-stamped
    // pktFwdr with a node it enumerated, putting another node's id on the wire.
    // UNGUARDED CONSUMPTION: the app chain's `receive` removes from the
    // delivery publication without guarding membership in it, which is what an
    // abstraction of the carried receive events looks like across two projects.
    for (const label of ["start_tx", "receive"]) {
      expect(h).toContain(`// not scheduled: ${label} -- a carried event supersedes it`);
      expect(cc).not.toContain(`try_${label}()`);
    }
    // ...and it must not take the CONCRETE ones with it.
    expect(cc).toContain("try_receive_controlPkt()");
    expect(cc).toContain("try_start_tx_bconPkt()");
  });

  it("realises each transmission once, because the model's send_down cannot", () => {
    // send_down is an OBSERVATION with no actions, and nothing clears the pair
    // it observes on the SENDER -- sentDown is cleared by send_up, which here
    // runs on the receiver. So the guard stays true and the scheduler re-fires
    // it every tick. Measured before the fix: 57 frames on the air for one
    // start_tx_bconPkt. Re-firing the EVENT is legal (no actions, idempotent);
    // realising it is not, because the realisation is a transmission.
    const tx = cc.slice(cc.indexOf("bool Pm3Wsn::sendSensorPacket(Node"));
    const txBody = tx.slice(0, tx.indexOf("\n}"));
    expect(txBody).toContain("if (!txRealised.insert({x, pkt}).second)");
    expect(h).toContain("std::set<std::pair<Node, PktId>> txRealised;");
    // ...and the record is consulted only AFTER the socket check, so a bail-out
    // does not mark a transmission that never happened.
    expect(txBody.indexOf("socket == nullptr")).toBeLessThan(txBody.indexOf("txRealised"));
  });

  it("deserialises the packet's fields, because this delivery event does not", () => {
    // `pkt in dom(pktNbHops)` is how the model says "this node knows this
    // packet". The packet source's own delivery event restores the fields; the
    // base chain's abstract one does not, and this module runs that one.
    expect(body).toContain("PPkt *_local = ensurePkt(_pkt);");
    expect(body).toContain("_local->setNbHops(_wire->getNbHops());");
    expect(body).toContain("pktLive.insert(_pkt);");
  });
});

// The one PPkt-layer defect the (now parked) pair-keyed work uncovered.
describe("a packet field writes to its chunk, not to a machine map", () => {
  const tree = gen("MintRoute", "M4");
  const cc = tree.find((f) => f.path.endsWith(".cc"))!.content;

  it("writes netSeqNo to the chunk, not to a machine map", () => {
    // Two storages for one variable: the per-key write `netSeqNo(pkt) ≔ lsno`
    // had no PKT rule -- the evidence table said so in a comment and the
    // consequence was never followed through -- so it fell through to the
    // generic function rule and landed in a machine map while every read went
    // to the chunk (`pktOf(pkt)->getNetSeqNo()`). Receivers read 0 for every
    // packet. Same silent shape as the 2026-09-08 `type(pkt)` defect, and it
    // does NOT move the untranslated count: the clause was translated all
    // along, just to the wrong place.
    expect(cc).toContain("ensurePkt(pkt)->setNetSeqNo(lsno);");
    expect(cc).not.toContain("netSeqNo[pkt] = lsno;");
  });
});

// Two reporting defects the 2026-09-13 audit found in structure 3. Neither
// changed what the module DOES; both made it describe itself wrongly, which
// this project treats as a defect in its own right.
describe("structure 3 reports its own state accurately", () => {
  const tree = generate(loadProject("AppLayer"), "pM3", "Pm3Wsn", 3,
    { files: loadProject("MintRoute"), machine: "M4" });
  const h = tree.find((f) => f.path.endsWith(".h"))!.content;
  const cc = tree.find((f) => f.path.endsWith(".cc"))!.content;

  it("does not report send_up as an unbound gap — the arrival realises it", () => {
    // It read `not schedulable: send_up -- no binding for nbrs`, which looks
    // like a translation gap. The socket callback binds nbrs to this node and
    // calls the event on every real reception, exactly as the network module's
    // medium binding does for its own.
    expect(h).not.toContain("not schedulable: send_up");
    expect(h).toMatch(/not scheduled: send_up -- .*arrival realises it/);
    // ...and it must still be CALLED, or the label would be a lie too.
    expect(cc).toMatch(/if \(socketDataArrived\(_f, _pkt, _nbrs\)\)/);
  });

  it("derives the sender field instead of naming pktFwdr", () => {
    // The transmit event files the packet into a pair-set under a node AND
    // stamps a chunk field with that same node; that equality is the model
    // saying a frame carries its sender. Naming the field meant a packet source
    // that called it anything else lost the WHOLE receive binding silently.
    expect(cc).toContain("Node _f = _wire->getFwdrAddr();");
  });

  it("returns nothing when no transmit event stamps a sender, so the caller can refuse", () => {
    // The negative case is the seam worth testing: with no transmit event to
    // read, there is no field that carries the sender, and the pipeline throws
    // rather than emitting a module that compiles, runs and never receives.
    // (A packet source whose own transmit DOES stamp one is fine — the app
    // chain is its own valid packet source, since its `start_tx` files into
    // `sentDown` and stamps `pktFwdr` with the same node.)
    const pRaw = parseModel(loadProject("MintRoute"));
    const pModel = resolveEncodings(flatten(pRaw, "M4"));
    const pm = packetModelOf(pRaw, "M4")!;
    expect(senderFieldOf(pModel, pm, [])).toBeUndefined();
    // ...and it finds the field, without anything naming it.
    expect(senderFieldOf(pModel, pm, transmitEventsOf(
      resolveEncodings(flatten(parseModel(loadProject("AppLayer")), "pM3")), pModel))?.ebName)
      .toBe("pktFwdr");
  });
});

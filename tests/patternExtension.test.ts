import { describe, it, expect } from "vitest";
import { patternExtensionFor, PATTERN_EXTENSION_LEAF, routingStyleOf } from "../src/engine/patternExtension";
import { parseModel } from "../src/engine/parser";
import type { EbFiles } from "../src/engine/pipeline";

// Structure 3 is V2's shell carrying PPkt and PRouteTable, and the pattern it
// carries SHIPS INSIDE THE TOOL -- the way the rule catalog does. One project
// goes in; there is no second upload slot.
//
// Until this existed the extension was an INPUT: it had to be handed to the
// generator through `--ppkt-from`, so the user supplied two projects and the
// tool knew nothing about the pattern it is supposed to embody.

const machine = (name: string, refines: string | null, vars: string[]) => ({
  name: `${name}.bum`,
  xml: `<?xml version="1.0" encoding="UTF-8"?>
<org.eventb.core.machineFile org.eventb.core.configuration="org.eventb.core.fwd" version="5">
${refines ? `   <org.eventb.core.refinesMachine name="r1" org.eventb.core.target="${refines}"/>` : ""}
${vars.map((v, i) => `   <org.eventb.core.variable name="v${i}" org.eventb.core.identifier="${v}"/>`).join("\n")}
   <org.eventb.core.event name="e0" org.eventb.core.convergence="0" org.eventb.core.extended="false" org.eventb.core.label="INITIALISATION"/>
</org.eventb.core.machineFile>`,
});

// Everything the extension's own events read or write in the base.
const COMM = ["pktFwdr", "pktData", "createdPkts", "ndBuff", "sentUp"];

// A machine whose abstract creating event guards `type(pkt) ∈ <set>` — which
// is how a project says what a control packet IS, and what the default split
// is matched against.
const withCtlSet = (set: string) => ({
  name: "pM3.bum",
  xml: `<?xml version="1.0" encoding="UTF-8"?>
<org.eventb.core.machineFile org.eventb.core.configuration="org.eventb.core.fwd" version="5">
${COMM.map((v, i) => `   <org.eventb.core.variable name="v${i}" org.eventb.core.identifier="${v}"/>`).join("\n")}
   <org.eventb.core.event name="e0" org.eventb.core.convergence="0" org.eventb.core.extended="false" org.eventb.core.label="INITIALISATION"/>
   <org.eventb.core.event name="e1" org.eventb.core.convergence="0" org.eventb.core.extended="false" org.eventb.core.label="creatingControlPacket">
      <org.eventb.core.guard name="g0" org.eventb.core.label="g1" org.eventb.core.predicate="type(pkt) ∈ ${set}"/>
   </org.eventb.core.event>
</org.eventb.core.machineFile>`,
});

const ctx = (name: string, axioms: string[], constants: string[]) => ({
  name: `${name}.buc`,
  xml: `<?xml version="1.0" encoding="UTF-8"?>
<org.eventb.core.contextFile org.eventb.core.configuration="org.eventb.core.fwd" version="3">
   <org.eventb.core.carrierSet name="s0" org.eventb.core.identifier="TYPE"/>
${constants.map((c, i) => `   <org.eventb.core.constant name="c${i}" org.eventb.core.identifier="${c}"/>`).join("\n")}
${axioms.map((a, i) => `   <org.eventb.core.axiom name="a${i}" org.eventb.core.label="axm${i}" org.eventb.core.predicate="${a}" org.eventb.core.theorem="false"/>`).join("\n")}
</org.eventb.core.contextFile>`,
});

// ⚠ THE BUNDLED DEFAULT CONTROL SPLIT — the part of option A that was revised
// on 2026-09-21 rather than kept.
//
// Structure 3's job is to flood control subtypes, and the pattern declares
// none. For a few hours the split was added to the advisor's own input to get
// them; that was reverted, and the tool supplies them instead. Option A had
// deleted the bundled context because two partitions of one set are
// CONTRADICTORY in Event-B and RTMCS declares its own — so the default may only
// apply where that cannot happen, and these three pin exactly when.
// ⚠ AND SINCE 2026-09-27 THERE ARE TWO, chosen by the project's shape
// (routingStyleOf): RTMCS's RREQ/RREP/RRER for a project that names a sink as ONE
// OF its destinations, MintRoute's ROUTE/BEACON for anything else — flooding is
// the default (user ruling, 2026-09-27). The C1 below is the pattern's own; only
// the sink context differs.
const C1_PATTERN = ctx("C1", ["partition(TYPE, CONTROL, {DATA})"], ["DATA", "CONTROL", "type"]);
const C0_SINK = ctx("C0", ["Sink ∈ ND", "Sink = 0"], ["Sink"]);
const C0_DESTS = ctx("C0", ["Dests ⊆ ND"], ["Dests"]);   // no sink: the default
const C0_SINK_IN_DESTS = ctx("C0", ["Dests ⊆ ND", "Sink ∈ Dests", "Sink = 0"], ["Dests", "Sink"]);

describe("the bundled control split", () => {
  it("gives a project that names one sink node MintRoute's flooding split", () => {
    const src = patternExtensionFor([withCtlSet("CONTROL"), C0_SINK, C1_PATTERN], "pM3");
    const names = src.files.map((f) => f.name);
    expect(names).toContain("C2_ctl.buc");
    expect(names).not.toContain("C2_aodv.buc");
    // And the derived per-leaf events come from it — the context alone would
    // be two dead constants, because every derivation reads a parsed model and
    // the upload does not contain the bundle.
    const uM4 = src.files.find((f) => f.name === "uM4.bum")!.xml;
    expect(uM4.match(/label="create_\w+"/g)).toEqual(
      ['label="create_routePkt"', 'label="create_beaconPkt"']);
    expect(uM4.match(/predicate="type\(pkt\) = (\w+)"/g)).toEqual(
      ['predicate="type(pkt) = ROUTE"', 'predicate="type(pkt) = BEACON"']);
    // uM4 must SEE the context that declares the leaves its guards name, or the
    // machine does not open in Rodin.
    expect(uM4).toContain('org.eventb.core.target="C2_ctl"');
  });

  it("gives a project that names a sink among its destinations RTMCS's AODV split", () => {
    const src = patternExtensionFor([withCtlSet("CONTROL"), C0_SINK_IN_DESTS, C1_PATTERN], "pM3");
    const names = src.files.map((f) => f.name);
    expect(names).toContain("C2_aodv.buc");
    expect(names).not.toContain("C2_ctl.buc");
    const uM4 = src.files.find((f) => f.name === "uM4.bum")!.xml;
    // The SAME derivation as the flooding branch — only the leaves differ.
    expect(uM4.match(/label="create_\w+"/g)).toEqual(
      ['label="create_rreqPkt"', 'label="create_rrepPkt"', 'label="create_rrerPkt"']);
    expect(uM4.match(/predicate="type\(pkt\) = (\w+)"/g)).toEqual(
      ['predicate="type(pkt) = RREQ"', 'predicate="type(pkt) = RREP"', 'predicate="type(pkt) = RRER"']);
    expect(uM4).toContain('org.eventb.core.target="C2_aodv"');
  });

  it("never bundles both — the two partition CONTROL differently and would contradict", () => {
    for (const c0 of [C0_SINK, C0_DESTS, C0_SINK_IN_DESTS]) {
      const names = patternExtensionFor([withCtlSet("CONTROL"), c0, C1_PATTERN], "pM3").files.map((f) => f.name);
      expect(names.filter((n) => n === "C2_ctl.buc" || n === "C2_aodv.buc")).toHaveLength(1);
    }
  });

  it("STANDS DOWN for a project that splits the control set itself", () => {
    // RTMCS's shape. Adding ours beside it is not additive — it is a second,
    // contradictory partition of one set.
    const src = patternExtensionFor(
      [withCtlSet("CONTROL"),
        ctx("C1", ["partition(TYPE, CONTROL, {DATA})", "partition(CONTROL, {RREQ}, {RREP})"],
          ["DATA", "CONTROL", "RREQ", "RREP", "type"])],
      "pM3");
    expect(src.files.map((f) => f.name)).not.toContain("C2_ctl.buc");
    expect(src.files.map((f) => f.name)).not.toContain("C2_aodv.buc");
    const uM4 = src.files.find((f) => f.name === "uM4.bum")!.xml;
    // ⚠ SCOPED TO THE DERIVED GUARDS, not searched as a bare word. `uM4.bum`'s
    // own prose cites MintRoute's BEACON as the worked example, so
    // `not.toContain("BEACON")` matches a COMMENT and fails on correct output —
    // the identical mistake this project recorded on 2026-09-20 and fixed the
    // same way.
    expect(uM4.match(/predicate="type\(pkt\) = (\w+)"/g)).toEqual(
      ['predicate="type(pkt) = RREQ"', 'predicate="type(pkt) = RREP"']);
  });

  it("STANDS DOWN for a control set of another name, which it does not split", () => {
    // The advisor's flooding study calls it FLOOD. The bundled file splits
    // CONTROL, so applying it here would declare a partition of a set this
    // project never mentions.
    const src = patternExtensionFor(
      [withCtlSet("FLOOD"), ctx("C1", ["partition(TYPE, FLOOD, {DATA})"], ["DATA", "FLOOD", "type"])],
      "pM3");
    expect(src.files.map((f) => f.name)).not.toContain("C2_ctl.buc");
    expect(src.files.map((f) => f.name)).not.toContain("C2_aodv.buc");
    expect(src.files.find((f) => f.name === "uM4.bum")!.xml).not.toContain("ROUTE");
    expect(src.files.find((f) => f.name === "uM4.bum")!.xml).not.toContain("RREQ");
  });
});

describe("patternExtensionFor", () => {
  it("adds the bundled files to the uploaded project rather than replacing them", () => {
    const base: EbFiles = [machine("pM3", null, COMM)];
    const src = patternExtensionFor(base, "pM3");
    const names = src.files.map((f) => f.name);
    expect(names).toContain("pM3.bum");
    expect(names).toContain("uM4.bum");
    expect(names).toContain("pM5.bum");
    // ⚠ AND NOT `C2_ctl.buc` HERE, THOUGH IT IS BUNDLED AGAIN SINCE 2026-09-21
    // — so the reason matters, because the old one no longer holds.
    //
    // It is not that the default was deleted; it is that this project does not
    // qualify for it. The default splits CONTROL, and `machine("pM3", null, …)`
    // declares no control set at all, so applying it would hand the project a
    // partition of a set it never declares. The bundled-in case is covered by
    // controlLeaves.test.ts, and the stand-down-for-a-project-that-splits case
    // beside it.
    expect(names).not.toContain("C2_ctl.buc");
    expect(names).not.toContain("C2_aodv.buc");
  });

  it("targets the extension's own leaf, so the table machine is what is read", () => {
    const src = patternExtensionFor([machine("pM3", null, COMM)], "pM3");
    expect(src.machine).toBe(PATTERN_EXTENSION_LEAF);
    expect(PATTERN_EXTENSION_LEAF).toBe("pM5");
  });

  it("retargets the extension onto whatever the uploaded project's leaf is called", () => {
    // The bundled uM4 is authored as `refines pM3`. A project whose leaf has
    // another name would leave that dangling, so the target is rewritten.
    const base: EbFiles = [machine("mA", null, COMM), machine("mB", "mA", COMM)];
    const src = patternExtensionFor(base, "mB");
    const uM4 = src.files.find((f) => f.name === "uM4.bum")!;
    expect(uM4.xml).toContain('org.eventb.core.target="mB"');
    expect(uM4.xml).not.toContain('org.eventb.core.target="pM3"');
  });

  it("leaves the bundled text alone when the leaf is already what it refines", () => {
    const src = patternExtensionFor([machine("pM3", null, COMM)], "pM3");
    const uM4 = src.files.find((f) => f.name === "uM4.bum")!;
    expect(uM4.xml).toContain('org.eventb.core.target="pM3"');
  });

  it("refuses a project that does not provide the CommPattern state it extends, naming what is missing", () => {
    // Applying the app-layer pattern extension to a model that is not built on
    // that pattern would emit events reading variables that do not exist. The
    // refusal has to name them: "it did not work" is not actionable.
    const base: EbFiles = [machine("mA", null, ["pktFwdr", "ndBuff"])];
    expect(() => patternExtensionFor(base, "mA")).toThrow(/pktData/);
    expect(() => patternExtensionFor(base, "mA")).toThrow(/createdPkts/);
    // and it must not complain about the ones that ARE there
    expect(() => patternExtensionFor(base, "mA")).not.toThrow(/\bndBuff\b/);
  });

  it("does not mutate the caller's file list", () => {
    const base: EbFiles = [machine("pM3", null, COMM)];
    const before = base.length;
    patternExtensionFor(base, "pM3");
    expect(base).toHaveLength(before);
  });
});

// Which routing the project's shape points to. Synthetic here so it runs on a
// clean checkout; the four real projects are pinned in routingStyle.test.ts.
describe("routingStyleOf", () => {
  const style = (...files: ReturnType<typeof ctx>[]) => routingStyleOf(parseModel(files).contexts);

  it("reads one sink node declared directly in ND as flooding (MintRoute's shape)", () => {
    expect(style(C0_SINK)).toBe("flooding");
  });

  it("reads a project that names no sink as flooding — the default, by ruling", () => {
    // C0_project's own shape. The destination set and the per-packet destination
    // are in pM1, so every input has them; they cannot tell two inputs apart.
    expect(style(C0_DESTS)).toBe("flooding");
  });

  it("reads a sink named among the destinations as AODV", () => {
    expect(style(C0_SINK_IN_DESTS)).toBe("aodv");
  });

  it("reads a sink that is ONE OF a destination set as AODV (RTMCS's shape)", () => {
    // RTMCS C2: `Sink ∈ Destination`, `partition(Destination, {Sink}, Actuators)`.
    // A sink that is one destination among several is not a collection root.
    expect(style(ctx("C0", ["Destination ⊆ ND"], ["Destination"]),
      ctx("C2", ["Sink ∈ Destination", "Actuators ⊆ Destination", "partition(Destination, {Sink}, Actuators)"],
        ["Sink", "Actuators"]))).toBe("aodv");
  });

  it("does not count a destination member the context never declares as a constant", () => {
    // A membership axiom about something that is not a constant (a typo, or a
    // variable's name reused) is not the model naming a sink.
    expect(style(ctx("C0", ["Dests ⊆ ND", "Sink ∈ Dests"], ["Dests"]))).toBe("flooding");
  });
});

// ⚠ pM5 REFINES uM4, so it must see what uM4 sees. The split swap used to touch
// uM4 alone, leaving pM5 on `C1` while its abstraction saw `C2_ctl`/`C2_aodv` —
// a refinement that does not see its abstraction's contexts, which Rodin's
// static checker rejects (2026-09-27 bug hunt). Nothing writes these machines
// out, so no C++ moved; the claim that they open in Rodin did.
describe("the bundled machines see the same context", () => {
  const sees = (xml: string) => [...xml.matchAll(/seesContext [^>]*target="(\w+)"/g)].map((m) => m[1]);
  it.each([["flooding", C0_DESTS, "C2_ctl"], ["aodv", C0_SINK_IN_DESTS, "C2_aodv"]] as const)(
    "%s: uM4 and pM5 both see the bundled split", (_s, c0, split) => {
      const src = patternExtensionFor([withCtlSet("CONTROL"), c0, C1_PATTERN], "pM3");
      const xml = (n: string) => src.files.find((f) => f.name === n)!.xml;
      expect(sees(xml("uM4.bum"))).toEqual([split]);
      expect(sees(xml("pM5.bum"))).toEqual([split]);
    });
  it("both stay on C1 when no split is bundled", () => {
    const src = patternExtensionFor([withCtlSet("FLOOD"), ctx("C1", ["partition(TYPE, FLOOD, {DATA})"], ["DATA", "FLOOD", "type"])], "pM3");
    const xml = (n: string) => src.files.find((f) => f.name === n)!.xml;
    expect(sees(xml("uM4.bum"))).toEqual(["C1"]);
    expect(sees(xml("pM5.bum"))).toEqual(["C1"]);
  });
});

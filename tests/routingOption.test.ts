import { describe, it, expect } from "vitest";
import { patternExtensionFor } from "../src/engine/patternExtension";

// `routing` / the CLI's `--routing`: choose which of the TOOL's two control
// splits structure 3 applies, on an input that is never edited to say which
// (user, 2026-09-27: "we not try to edit the input, everything that we build
// came from pattern"). Synthetic, so it runs on a clean checkout; the real
// C0_project is exercised in generateNet.test.ts.

const COMM = ["pktFwdr", "pktData", "createdPkts", "ndBuff", "sentUp"];
const machine = (set: string) => ({
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
// C0_project's shape: a destination set, no sink — the default reads flooding.
const project = [
  machine("CONTROL"),
  ctx("C0", ["Dests ⊆ ND"], ["Dests"]),
  ctx("C1", ["partition(TYPE, CONTROL, {DATA})"], ["DATA", "CONTROL", "type"]),
];
const bundled = (files: { name: string }[]) =>
  files.map((f) => f.name).filter((n) => n === "C2_ctl.buc" || n === "C2_aodv.buc");

describe("routing: choosing the bundled split without editing the input", () => {
  it("defaults to flooding for a project that names no sink", () => {
    expect(bundled(patternExtensionFor(project, "pM3").files)).toEqual(["C2_ctl.buc"]);
  });

  it("gives the SAME project the AODV split when asked", () => {
    const src = patternExtensionFor(project, "pM3", "aodv");
    expect(bundled(src.files)).toEqual(["C2_aodv.buc"]);
    const uM4 = src.files.find((f) => f.name === "uM4.bum")!.xml;
    expect(uM4.match(/label="create_\w+"/g)).toEqual(
      ['label="create_rreqPkt"', 'label="create_rrepPkt"', 'label="create_rrerPkt"']);
  });

  it("gives the flooding split when asked, whatever the shape says", () => {
    const aodvShaped = [...project, ctx("C2", ["Sink ∈ Dests", "Sink = 0"], ["Sink"])];
    expect(bundled(patternExtensionFor(aodvShaped, "pM3").files)).toEqual(["C2_aodv.buc"]);
    expect(bundled(patternExtensionFor(aodvShaped, "pM3", "flooding").files)).toEqual(["C2_ctl.buc"]);
  });

  it("does not edit the input: the project's own files come back unchanged", () => {
    const src = patternExtensionFor(project, "pM3", "aodv");
    for (const f of project) expect(src.files.find((g) => g.name === f.name)).toEqual(f);
  });

  it("refuses a project that declares its own split, rather than ignoring the choice", () => {
    const ownSplit = [...project, ctx("C2", ["partition(CONTROL, {ROUTE}, {BEACON})"], ["ROUTE", "BEACON"])];
    expect(() => patternExtensionFor(ownSplit, "pM3", "aodv")).toThrow(/declares its own \(ROUTE, BEACON\)/);
  });

  it("refuses a project whose control set the bundled splits do not partition", () => {
    const flood = [machine("FLOOD"), ctx("C1", ["partition(TYPE, FLOOD, {DATA})"], ["DATA", "FLOOD", "type"])];
    expect(() => patternExtensionFor(flood, "pM3", "flooding")).toThrow(/control set is FLOOD/);
  });
});

import { describe, it, expect } from "vitest";
import { patternExtensionFor, PATTERN_EXTENSION_LEAF } from "../src/engine/patternExtension";
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

describe("patternExtensionFor", () => {
  it("adds the bundled files to the uploaded project rather than replacing them", () => {
    const base: EbFiles = [machine("pM3", null, COMM)];
    const src = patternExtensionFor(base, "pM3");
    const names = src.files.map((f) => f.name);
    expect(names).toContain("pM3.bum");
    expect(names).toContain("uM4.bum");
    expect(names).toContain("pM5.bum");
    // ⚠ And NOT a context declaring a control split. There used to be a
    // `C2_ctl.buc` holding `partition(CONTROL, {ROUTE}, {BEACON})` — MintRoute's
    // split, which contradicts RTMCS's rather than extending it. The leaves come
    // from the uploaded project now; see controlLeaves.test.ts.
    expect(names).not.toContain("C2_ctl.buc");
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

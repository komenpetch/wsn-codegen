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
describe("the bundled default control split", () => {
  it("applies to a project whose control set is CONTROL and which does not split it", () => {
    const src = patternExtensionFor(
      [withCtlSet("CONTROL"), ctx("C1", ["partition(TYPE, CONTROL, {DATA})"], ["DATA", "CONTROL", "type"])],
      "pM3");
    expect(src.files.map((f) => f.name)).toContain("C2_ctl.buc");
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

  it("STANDS DOWN for a project that splits the control set itself", () => {
    // RTMCS's shape. Adding ours beside it is not additive — it is a second,
    // contradictory partition of one set.
    const src = patternExtensionFor(
      [withCtlSet("CONTROL"),
        ctx("C1", ["partition(TYPE, CONTROL, {DATA})", "partition(CONTROL, {RREQ}, {RREP})"],
          ["DATA", "CONTROL", "RREQ", "RREP", "type"])],
      "pM3");
    expect(src.files.map((f) => f.name)).not.toContain("C2_ctl.buc");
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
    expect(src.files.find((f) => f.name === "uM4.bum")!.xml).not.toContain("ROUTE");
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

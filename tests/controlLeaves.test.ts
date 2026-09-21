import { describe, it, expect } from "vitest";
import { patternExtensionFor } from "../src/engine/patternExtension";
import type { EbFiles } from "../src/engine/pipeline";

// WHICH control subtypes exist is per case study, not part of the shared
// pattern: MintRoute splits CONTROL into {ROUTE, BEACON} to build a collection
// tree, RTMCS into {RREQ, RREP, RRER} for on-demand discovery, and the pattern
// itself splits it not at all. Those are three different answers to "how do
// nodes reach each other", which is the side of the scope rule that is allowed
// to differ.
//
// So the extension bundles the RULE and the project brings the leaves:
//
//   for each leaf of the control set's partition, a creating event refining
//   creatingControlPacket, strengthening `type(pkt) ∈ <SET>` to
//   `type(pkt) = <LEAF>`, with its own per-node sequence counter.
//
// ⚠ It used to bundle MintRoute's split and MintRoute's two event names
// outright, which no project with RREQ/RREP/RRER could have used -- two
// partitions of one set are contradictory in Event-B, not additive.

const COMM = ["pktFwdr", "pktData", "createdPkts", "ndBuff", "sentUp"];

const ctx = (name: string, partitions: string[], constants: string[]) => ({
  name: `${name}.buc`,
  xml: `<?xml version="1.0" encoding="UTF-8"?>
<org.eventb.core.contextFile org.eventb.core.configuration="org.eventb.core.fwd" version="3">
   <org.eventb.core.carrierSet name="s1" org.eventb.core.identifier="TYPE"/>
${constants.map((c, i) => `   <org.eventb.core.constant name="c${i}" org.eventb.core.identifier="${c}"/>`).join("\n")}
   <org.eventb.core.axiom name="a0" org.eventb.core.label="t" org.eventb.core.predicate="type ∈ PKT → TYPE" org.eventb.core.theorem="false"/>
${partitions.map((p, i) => `   <org.eventb.core.axiom name="ap${i}" org.eventb.core.label="p${i}" org.eventb.core.predicate="${p}" org.eventb.core.theorem="false"/>`).join("\n")}
</org.eventb.core.contextFile>`,
});

// A base machine carrying the CommPattern state and the abstract creating event.
const machine = (name: string, controlSet: string) => ({
  name: `${name}.bum`,
  xml: `<?xml version="1.0" encoding="UTF-8"?>
<org.eventb.core.machineFile org.eventb.core.configuration="org.eventb.core.fwd" version="5">
${COMM.map((v, i) => `   <org.eventb.core.variable name="v${i}" org.eventb.core.identifier="${v}"/>`).join("\n")}
   <org.eventb.core.event name="e0" org.eventb.core.convergence="0" org.eventb.core.extended="false" org.eventb.core.label="INITIALISATION"/>
   <org.eventb.core.event name="e1" org.eventb.core.convergence="0" org.eventb.core.extended="false" org.eventb.core.label="creatingControlPacket">
      <org.eventb.core.parameter name="p1" org.eventb.core.identifier="pkt"/>
      <org.eventb.core.guard name="g1" org.eventb.core.label="ctl" org.eventb.core.predicate="type(pkt) ∈ ${controlSet}" org.eventb.core.theorem="false"/>
   </org.eventb.core.event>
</org.eventb.core.machineFile>`,
});

const uM4Of = (files: EbFiles) => {
  const src = patternExtensionFor(files, "pM3");
  return src.files.find((f) => f.name === "uM4.bum")!.xml;
};

describe("per-leaf creating events are derived from the project's own split", () => {
  it("derives one per leaf for a MintRoute-shaped split", () => {
    const x = uM4Of([
      machine("pM3", "CONTROL"),
      ctx("C1", ["partition(TYPE, CONTROL, {DATA})", "partition(CONTROL, {ROUTE}, {BEACON})"],
        ["DATA", "CONTROL", "ROUTE", "BEACON", "type"]),
    ]);
    expect(x).toContain('org.eventb.core.label="create_routePkt"');
    expect(x).toContain('org.eventb.core.label="create_beaconPkt"');
    expect(x).toContain('predicate="type(pkt) = ROUTE"');
    expect(x).toContain('predicate="type(pkt) = BEACON"');
  });

  it("derives one per leaf for an RTMCS-shaped split — three, not two", () => {
    // The case the bundled MintRoute split could never have served.
    const x = uM4Of([
      machine("pM3", "CONTROL"),
      ctx("C1", ["partition(TYPE, CONTROL, {DATA})", "partition(CONTROL, {RREQ}, {RREP}, {RRER})"],
        ["DATA", "CONTROL", "RREQ", "RREP", "RRER", "type"]),
    ]);
    for (const leaf of ["RREQ", "RREP", "RRER"]) expect(x).toContain(`predicate="type(pkt) = ${leaf}"`);
    // ⚠ Scoped to the derived TYPE GUARDS. A blanket "does not contain BEACON"
    // was too broad and started failing on PROSE: the transmit derivation cites
    // MintRoute's own `start_tx_bconPkt` in its comment. What must not appear is
    // a guard pinning a leaf this project does not declare.
    expect(x.match(/predicate="type\(pkt\) = (\w+)"/g))
      .toEqual(['predicate="type(pkt) = RREQ"', 'predicate="type(pkt) = RREP"',
        'predicate="type(pkt) = RRER"']);
  });

  it("treats an UNSPLIT control set as its own single target", () => {
    // C0_project's own shape, and ⚠ THIS ASSERTION IS THE REVERSE OF WHAT IT
    // FIRST SAID. "A project that splits nothing gets nothing derived" sounded
    // like the whole of option A, and it left Tier A with DEAD STATE: `pktSeqNo`
    // is stamped only by a derived creating event, so with none derived nothing
    // stamped it, `update_nbr` guarded `pkt ∈ dom(pktSeqNo)` and fired zero
    // times, `updateNbrs` never drained, and every node accepted exactly one
    // packet for a whole sixty-second run.
    //
    // The obligation belongs to "a control packet is created", not to "a control
    // SUBTYPE is created". So an unsplit set is its own leaf — the same reading
    // the type stamp and resolveTag both use — and the guard stays the
    // MEMBERSHIP the model actually states rather than becoming an equality
    // against a set.
    //
    // ✅ Nothing is invented: no packet subtype appears that the project does
    // not declare, and MintRoute's own M1 calls this event `create_controlPkt`
    // before its C3 splits CONTROL at all.
    // ⚠ THE CONTROL SET HERE IS `FLOOD`, AND IT USED TO BE `CONTROL`. Since
    // 2026-09-21 the extension bundles a DEFAULT split — `partition(CONTROL,
    // {ROUTE}, {BEACON})` — for a project whose control set is CONTROL and
    // which does not split it, which is exactly the shape this test used to
    // build. The rule below is unchanged and still reachable: the default
    // declares a split of CONTROL specifically, so a project whose control set
    // is named otherwise correctly declines it and lands on this branch.
    //
    // ✅ It is a better witness for that reason. It exercises the single-target
    // rule AND the "read the set off the guard rather than naming it" property
    // in one go, so a regression in either shows up here.
    const x = uM4Of([
      machine("pM3", "FLOOD"),
      ctx("C1", ["partition(TYPE, FLOOD, {DATA})"], ["DATA", "FLOOD", "type"]),
    ]);
    expect(x).toContain('label="create_floodPkt"');
    expect(x).toContain('predicate="type(pkt) ∈ FLOOD"');
    expect(x).not.toContain('predicate="type(pkt) = FLOOD"');
    // And exactly one, not one per packet type in the lattice.
    expect(x.match(/label="create_\w+"/g)).toEqual(['label="create_floodPkt"']);
  });

  it("still derives one per leaf when the project DOES split, and pins by equality", () => {
    // The split case must not drift to membership: `type(pkt) = BEACON` is what
    // a genuine leaf pins, and the two spellings are not interchangeable.
    const x = uM4Of([
      machine("pM3", "CONTROL"),
      ctx("C1", ["partition(TYPE, CONTROL, {DATA})", "partition(CONTROL, {ROUTE}, {BEACON})"],
        ["DATA", "CONTROL", "ROUTE", "BEACON", "type"]),
    ]);
    expect(x.match(/label="create_\w+"/g))
      .toEqual(['label="create_routePkt"', 'label="create_beaconPkt"']);
    expect(x).toContain('predicate="type(pkt) = ROUTE"');
    // ⚠ Scoped to the CREATING event's own type guard. A blanket "no membership
    // anywhere" assertion is wrong and was caught being wrong: the flood events
    // guard `type(pkt) ∈ CONTROL` deliberately, because which control subtypes
    // exist is per case study and the flood says only that a control packet is
    // what floods.
    const creating = x.match(/label="User_defined_guard_g2" org\.eventb\.core\.predicate="[^"]*"/g);
    expect(creating).toEqual([
      'label="User_defined_guard_g2" org.eventb.core.predicate="type(pkt) = ROUTE"',
      'label="User_defined_guard_g2" org.eventb.core.predicate="type(pkt) = BEACON"',
    ]);
  });

  it("reads the control set off the abstract event, so a differently NAMED one works", () => {
    // The advisor's flooding case study calls it FLOOD, not CONTROL.
    const x = uM4Of([
      machine("pM3", "FLOOD"),
      ctx("C1", ["partition(TYPE, FLOOD, {DATA})", "partition(FLOOD, {ADVERT})"],
        ["DATA", "FLOOD", "ADVERT", "type"]),
    ]);
    expect(x).toContain('predicate="type(pkt) = ADVERT"');
  });

  it("walks to the LEAVES of a nested split, not to the intermediate groups", () => {
    // The nesting shape: a case study could group its control types
    // (`partition(CONTROL, DISCOVERY, MAINTENANCE)`) and split each group
    // further. Only the leaves carry a packet type, so DISCOVERY and
    // MAINTENANCE must NOT get creating events of their own — taking every
    // child would emit `create_discoveryPkt` against a set that has no tag.
    const x = uM4Of([
      machine("pM3", "CONTROL"),
      ctx("C1", [
        "partition(TYPE, CONTROL, {DATA})",
        "partition(CONTROL, DISCOVERY, MAINTENANCE)",
        "partition(DISCOVERY, {RREQ}, {RREP})",
        "partition(MAINTENANCE, {RRER})",
      ], ["DATA", "CONTROL", "DISCOVERY", "MAINTENANCE", "RREQ", "RREP", "RRER", "type"]),
    ]);
    for (const leaf of ["RREQ", "RREP", "RRER"]) expect(x).toContain(`predicate="type(pkt) = ${leaf}"`);
    expect(x).not.toContain("create_discoveryPkt");
    expect(x).not.toContain("create_maintenancePkt");
  });

  it("gives each leaf its own per-node counter, which is what makes delta a loss count", () => {
    // B6: `sno ∈ ℕ` had no witness and no monotonicity. A shared counter would
    // leave gaps in each leaf's own sequence wherever another leaf consumed a
    // number, inflating the missed count — MintRoute keeps floodSeqNo,
    // routeSeqNo, dataSeqNo and linkSeqNo apart for exactly that reason.
    const x = uM4Of([
      machine("pM3", "CONTROL"),
      ctx("C1", ["partition(TYPE, CONTROL, {DATA})", "partition(CONTROL, {ROUTE}, {BEACON})"],
        ["DATA", "CONTROL", "ROUTE", "BEACON", "type"]),
    ]);
    expect(x).toContain('identifier="routeSeqNo"');
    expect(x).toContain('identifier="beaconSeqNo"');
    expect(x).toContain("routeSeqNo ∈ ND → ℕ");
    expect(x).toContain("sno = routeSeqNo(x) + 1");
    expect(x).toContain("sno = beaconSeqNo(x) + 1");
  });

  it("makes each derived event a refinement, not a new event", () => {
    const x = uM4Of([
      machine("pM3", "CONTROL"),
      ctx("C1", ["partition(TYPE, CONTROL, {DATA})", "partition(CONTROL, {ROUTE}, {BEACON})"],
        ["DATA", "CONTROL", "ROUTE", "BEACON", "type"]),
    ]);
    expect((x.match(/org\.eventb\.core\.target="creatingControlPacket"/g) ?? [])).toHaveLength(2);
  });
});

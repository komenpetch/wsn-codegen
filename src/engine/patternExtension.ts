// `import type` on purpose: pipeline imports THIS module, so a value import
// would close a runtime cycle and `parsedMachines is not a function` at load.
// A type-only import is erased.
import type { EbFiles } from "./pipeline";
import type { RawModel } from "./types";
import { parseModel } from "./parser";
import { packetTypeLattice } from "./packetTypes";
import uM4 from "../assets/pattern-extension/uM4.bum?raw";
import pM5 from "../assets/pattern-extension/pM5.bum?raw";

// The pattern extension — PPkt and PRouteTable — SHIPPED INSIDE THE TOOL.
//
// Structure 3 is V2's shell carrying these two, and the whole point is that the
// user uploads ONE project: the pattern is the generator's, the way the rule
// catalog is. Before this, the extension was an INPUT handed in through
// `--ppkt-from`, so the tool knew nothing about the pattern it is meant to
// embody and the user had to supply the second project themselves.
//
// The two files are real Rodin sources rather than strings embedded here, so
// they open in Rodin for proof and review, and there is one copy of each.
//
//   uM4.bum      Tier A — the per-packet sequence number, plus the per-leaf
//                creating events DERIVED into it (see deriveControlEvents)
//   pM5.bum      Tier B — the neighbour table and its pair-keyed metrics
//
// ⚠ They EXTEND the uploaded chain rather than standing beside it: `uM4 refines
// <the project's leaf>` and `pM5 refines uM4`. That is why only these files are
// bundled — bundling a copy of the base chain as well would make the tool carry
// a second, drifting copy of the user's own model.
//
// ⚠ AND THE CONTROL SPLIT IS NOT BUNDLED, which is the whole of option A.
// There used to be a third file declaring `partition(CONTROL, {ROUTE},
// {BEACON})` with two hardcoded creating events beside it. That is MintRoute's
// split: RTMCS declares `partition(CONTROL, {RREQ}, {RREP}, {RRER})` and the
// pattern itself declares no split at all. Two partitions of one set are
// CONTRADICTORY in Event-B rather than additive, so a bundled split does not
// merely fail to serve those models — it makes them inconsistent. Which control
// subtypes exist is "how nodes reach each other", the per-case-study side of
// the project's own scope rule. What IS common is the rule, and that is what
// the tool now applies.
export const PATTERN_EXTENSION_LEAF = "pM5";

// The machine `uM4` is authored against the app-layer pattern's own leaf name.
const AUTHORED_AGAINST = "pM3";

// What the extension's events actually read and write in the base. Derived by
// reading uM4/pM5: the creating events rebuild the abstract event's actions
// (createdPkts, pktFwdr, pktData, ndBuff) and `update_nbr` reads `pktFwdr` and
// `sentUp`. A project without these is not built on the CommPattern, so the
// extension cannot refine it and says so rather than emitting events that read
// variables which do not exist.
const REQUIRED_BASE_STATE = ["createdPkts", "pktFwdr", "pktData", "ndBuff", "sentUp"] as const;

const BUNDLED = [
  { name: "uM4.bum", xml: uM4 },
  { name: "pM5.bum", xml: pM5 },
];

// WHICH set is the control set, read off the model rather than named.
//
// `creatingControlPacket` guards `type(pkt) ∈ <SET>`, and that is the model
// saying what a control packet is. MintRoute and the pattern call it CONTROL;
// the advisor's flooding case study calls the same thing FLOOD. Reading the
// guard works for both, and for a fourth name nobody has written yet.
function controlSetOf(raw: RawModel): string | null {
  for (const m of raw.machines)
    for (const e of m.events)
      for (const g of e.guards) {
        const hit = /^\s*type\s*\(\s*\w+\s*\)\s*∈\s*(\w+)\s*$/.exec(g.text);
        if (hit) return hit[1];
      }
  return null;
}

// The leaves of the control set's own partition, in declaration order.
// Empty when the project does not split it — which is not a gap: a model that
// draws no distinction between control subtypes does not get subtype events
// invented for it, and the abstract `creatingControlPacket` is what runs.
function controlLeavesOf(raw: RawModel): string[] {
  const set = controlSetOf(raw);
  if (!set) return [];
  const lattice = packetTypeLattice(raw.contexts);
  const kids = lattice?.children.get(set);
  if (!kids) return [];
  // Only leaves: a child that is itself partitioned is an intermediate group,
  // and its own leaves are what carry a packet type.
  const out: string[] = [];
  const walk = (n: string) => {
    const c = lattice!.children.get(n);
    if (c) c.forEach(walk); else out.push(n);
  };
  kids.forEach(walk);
  return out;
}

const camel = (s: string) => s.toLowerCase();

/**
 * One creating event per control leaf, plus the per-node counter each one needs.
 *
 * The rule is the pattern's and is uniform; only the leaves differ. Every guard
 * and action below except `@grd7`/`@grd8`/`@act5`/`@act6` is the abstract
 * `creatingControlPacket` verbatim — `@grd7` strengthens `type(pkt) ∈ <SET>` to
 * `= <LEAF>`, which is valid because the partition puts the leaf inside the set.
 *
 * ⚠ ONE COUNTER PER LEAF, not one shared (B6). `delta = sNo − lastSeqno − 1` in
 * `update_nbr` is only a LOSS COUNT if the sequence a receiver sees is
 * contiguous. A shared counter leaves a gap wherever another leaf consumed a
 * number, inflating the count. MintRoute keeps floodSeqNo, routeSeqNo,
 * dataSeqNo and linkSeqNo apart for exactly this reason.
 */
function deriveControlEvents(raw: RawModel): { vars: string; invs: string; inits: string; events: string } {
  const leaves = controlLeavesOf(raw);
  const vars: string[] = [], invs: string[] = [], inits: string[] = [], events: string[] = [];

  leaves.forEach((leaf, i) => {
    const ctr = `${camel(leaf)}SeqNo`;
    vars.push(`   <org.eventb.core.variable name="varc${i}" org.eventb.core.identifier="${ctr}"/>`);
    invs.push(`   <org.eventb.core.invariant name="invc${i}" org.eventb.core.label="MPacket_${ctr}_inv" `
      + `org.eventb.core.predicate="${ctr} ∈ ND → ℕ" `
      + `org.eventb.core.comment="per-node sequence counter for ${leaf}; one per leaf so each leaf's own sequence is contiguous" `
      + `org.eventb.core.theorem="false"/>`);
    inits.push(`      <org.eventb.core.action name="actc${i}" org.eventb.core.label="MPacket_${ctr}_int" `
      + `org.eventb.core.assignment="${ctr} ≔ ND × {0}"/>`);
    events.push(`   <org.eventb.core.event name="evtc${i}" org.eventb.core.convergence="0" `
      + `org.eventb.core.extended="false" org.eventb.core.label="create_${camel(leaf)}Pkt" `
      + `org.eventb.core.comment="Tier A, DERIVED from partition(&lt;control set&gt;, ... {${leaf}} ...). `
      + `Guards 1-6 and actions 1-4 are the abstract creatingControlPacket verbatim.">
      <org.eventb.core.refinesEvent name="refc${i}" org.eventb.core.target="creatingControlPacket"/>
      <org.eventb.core.parameter name="prm01" org.eventb.core.identifier="x"/>
      <org.eventb.core.parameter name="prm02" org.eventb.core.identifier="des"/>
      <org.eventb.core.parameter name="prm03" org.eventb.core.identifier="pkt"/>
      <org.eventb.core.parameter name="prm04" org.eventb.core.identifier="data"/>
      <org.eventb.core.parameter name="prm05" org.eventb.core.identifier="sno"/>
      <org.eventb.core.guard name="grd01" org.eventb.core.label="MPacket_creating_pkt_g1" org.eventb.core.predicate="x ∈ ND ∖ Dests ∧ pkt ∈ PKT ∧ data ∈ ℤ" org.eventb.core.theorem="false"/>
      <org.eventb.core.guard name="grd02" org.eventb.core.label="MPacket_creating_pkt_g2" org.eventb.core.predicate="x = initialSrcAddr(pkt) ∧ des = ran({pkt} ◁ finalDestAddr)" org.eventb.core.theorem="false"/>
      <org.eventb.core.guard name="grd03" org.eventb.core.label="MPacket_creating_pkt_g3" org.eventb.core.predicate="pkt ∉ dom(pktFwdr)" org.eventb.core.theorem="false"/>
      <org.eventb.core.guard name="grd04" org.eventb.core.label="MPacket_creating_pkt_g4" org.eventb.core.predicate="pkt ∉ dom(pktData)" org.eventb.core.theorem="false"/>
      <org.eventb.core.guard name="grd05" org.eventb.core.label="MNDbuffMgt_record_ndBuff_g1" org.eventb.core.predicate="x ↦ pkt ∉ ndBuff" org.eventb.core.theorem="false"/>
      <org.eventb.core.guard name="grd06" org.eventb.core.label="User_defined_guard_g1" org.eventb.core.predicate="data = CTL_VAL" org.eventb.core.theorem="false"/>
      <org.eventb.core.guard name="grd07" org.eventb.core.label="User_defined_guard_g2" org.eventb.core.predicate="type(pkt) = ${leaf}" org.eventb.core.theorem="false"/>
      <org.eventb.core.guard name="grd08" org.eventb.core.label="MPacket_${ctr}_g" org.eventb.core.predicate="pkt ∉ dom(pktSeqNo) ∧ x ∈ dom(${ctr}) ∧ sno = ${ctr}(x) + 1" org.eventb.core.theorem="false"/>
      <org.eventb.core.action name="act01" org.eventb.core.label="MPacket_creating_pkt_a1" org.eventb.core.assignment="createdPkts ≔ createdPkts ∪ {pkt}"/>
      <org.eventb.core.action name="act02" org.eventb.core.label="MPacket_creating_pkt_a2" org.eventb.core.assignment="pktFwdr ≔ pktFwdr ∪ {pkt ↦ x}"/>
      <org.eventb.core.action name="act03" org.eventb.core.label="MPacket_creating_pkt_a3" org.eventb.core.assignment="pktData ≔ pktData ∪ {pkt ↦ data}"/>
      <org.eventb.core.action name="act04" org.eventb.core.label="MNDbuffMgt_record_ndBuff_a1" org.eventb.core.assignment="ndBuff ≔ ndBuff ∪ {x ↦ pkt}"/>
      <org.eventb.core.action name="act05" org.eventb.core.label="MPacket_pktSeqNo_a1" org.eventb.core.assignment="pktSeqNo ≔ pktSeqNo ∪ {pkt ↦ sno}"/>
      <org.eventb.core.action name="act06" org.eventb.core.label="MPacket_${ctr}_a" org.eventb.core.assignment="${ctr} ≔ ${ctr} ⊕ {x ↦ sno}"/>
   </org.eventb.core.event>`);
  });

  return {
    vars: vars.join("\n"), invs: invs.join("\n"),
    inits: inits.join("\n"), events: events.join("\n"),
  };
}

// Splice the derived parts into the bundled uM4. Each anchor is the last line of
// its kind, so the additions land in a well-formed place; a missing anchor is an
// error rather than a silent no-op -- this file is ours, so it drifting is a bug.
function instantiate(xml: string, raw: RawModel): string {
  const { vars, invs, inits, events } = deriveControlEvents(raw);
  if (!vars && !events) return xml;      // no split declared: nothing to add
  const at = (anchor: string, add: string, what: string) => {
    if (!xml.includes(anchor))
      throw new Error(`patternExtension: uM4.bum no longer contains the ${what} anchor `
        + `(${anchor.trim().slice(0, 48)}…), so the derived control events cannot be spliced in.`);
    xml = xml.replace(anchor, `${anchor}\n${add}`);
  };
  at(`   <org.eventb.core.variable name="var13" org.eventb.core.identifier="pktSeqNo"/>`, vars, "variable");
  at(`org.eventb.core.predicate="pktSeqNo ∈ PKT ⇸ ℕ" `
    + `org.eventb.core.comment="per-packet sequence number: serves duplicate detection and the missed count, both communication concerns" `
    + `org.eventb.core.theorem="false"/>`, invs, "invariant");
  at(`      <org.eventb.core.action name="act01" org.eventb.core.label="MPacket_pktSeqNo_int_1" `
    + `org.eventb.core.assignment="pktSeqNo ≔ ∅"/>`, inits, "INITIALISATION");
  return xml.replace("</org.eventb.core.machineFile>", `${events}\n</org.eventb.core.machineFile>`);
}

/**
 * The uploaded project, extended by the bundled pattern.
 *
 * Returns the shape the emitter already consumes for structure 3, so the
 * carrying machinery is unchanged — what changed is only where the second
 * model comes from. The base of the pair stays the uploaded project alone;
 * this is that same project plus the extension, which is what makes the new
 * events (create_routePkt, create_bconPkt, add_newEntry, update_nbr) the
 * difference between the two.
 */
export function patternExtensionFor(files: EbFiles, base: string): { files: EbFiles; machine: string } {
  const raw = parseModel(files);

  const declared = new Set(raw.machines.flatMap((m) => m.variables));
  const missing = REQUIRED_BASE_STATE.filter((v) => !declared.has(v));
  if (missing.length > 0)
    throw new Error(
      `The pattern extension (PPkt + PRouteTable) refines the CommPattern, and this project does `
      + `not declare ${missing.join(", ")}. Structure 3 carries that extension, so it only applies `
      + `to a project built on the pattern; use structure 2 for a model that is not.`);

  // Retarget onto the machine being generated from, and instantiate the
  // per-leaf creating events from THIS project's own control split. `uM4` is
  // authored against the pattern's own `pM3`, and a project whose machine has
  // another name would leave that refinement dangling.
  const retarget = (f: { name: string; xml: string }) => {
    if (f.name !== "uM4.bum") return f;
    const xml = base === AUTHORED_AGAINST ? f.xml : f.xml.replace(
      `<org.eventb.core.refinesMachine name="ref1" org.eventb.core.target="${AUTHORED_AGAINST}"/>`,
      `<org.eventb.core.refinesMachine name="ref1" org.eventb.core.target="${base}"/>`);
    return { ...f, xml: instantiate(xml, raw) };
  };

  // A new array: the caller's list is theirs.
  return { files: [...files, ...BUNDLED.map(retarget)], machine: PATTERN_EXTENSION_LEAF };
}

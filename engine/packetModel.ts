import type { RawModel, EncodedMachine, FlatEvent } from "../../wsn-codegen/src/engine/types";
import type { TypeLattice } from "./packetTypes";

export interface PacketField { name: string; ebName: string; cppType: "int" | "Node"; source: "context" | "variable"; }
export interface PacketLeaf { typeName: string; tag: string; event: string; }
export interface PacketModel { fields: PacketField[]; leaves: PacketLeaf[]; lattice: TypeLattice; }

// ENC7. Event-B keeps packet attributes as a FAMILY of functions keyed by the
// packet: pktSeqNo in PKT +-> N, pktSrc, pktFwdr, ... Each is a separate map in
// the app-layer encoding, which is faithful but wrong for a simulator: the
// attributes travel WITH the packet. One chunk class with one field per family
// member is the same information with the ownership the network layer needs.
//
// The family is exactly the functions whose DOMAIN is the packet carrier.
// Rodin's own spacing is inconsistent ("initialSrcAddr ∈PKT → ND",
// "pktSrc ∈  PKT⇸ ND"), so whitespace around ∈ and the arrow is optional.
const PKT_DOMAIN = /^\s*\w+\s*∈\s*PKT\s*(?:→|⇸)/;

// A field's C++ type: a node-valued attribute is a Node, everything else an int.
const nodeValued = (inv: string) => /(?:→|⇸)\s*ND\b/.test(inv);

// "pktSeqNo" -> "seqNum" to match the class diagram's PacketBase field names;
// anything unrecognised keeps its Event-B name so nothing is invented silently.
const FIELD_NAME: Record<string, string> = {
  pktSeqNo: "seqNum", pktSrc: "srcAddr", pktFwdr: "fwdrAddr",
  pktData: "data", pktNbHops: "nbHops",
  initialSrcAddr: "initialSrcAddr", finalDestAddr: "finalDestAddr",
};

export function packetModel(raw: RawModel, machine: EncodedMachine, lattice: TypeLattice): PacketModel {
  const fields: PacketField[] = [];
  const seen = new Set<string>();
  const add = (ebName: string, inv: string, source: "context" | "variable") => {
    if (ebName === "type" || seen.has(ebName)) return;   // `type` is the discriminator
    seen.add(ebName);
    fields.push({ name: FIELD_NAME[ebName] ?? ebName, ebName, cppType: nodeValued(inv) ? "Node" : "int", source });
  };

  for (const c of raw.contexts)
    for (const a of c.axioms)
      if (PKT_DOMAIN.test(a.text)) add(a.text.split(/\s*∈\s*/)[0].trim(), a.text, "context");

  for (const [id, inv] of machine.variableTypes)
    if (PKT_DOMAIN.test(inv)) add(id, inv, "variable");

  const leaves: PacketLeaf[] = [];
  for (const tag of lattice.leaves) {
    const ev = machine.events.find((e) => isCreatingEvent(e, fields) && resolveTag(e, lattice) === tag);
    if (ev) leaves.push({ typeName: leafClassName(tag), tag, event: ev.label });
  }
  return { fields, leaves, lattice };
}

// A packet-typed event that merely CONSUMES a packet (receive_*, update_*,
// finish_tx_*, ...) can carry the very same `type(pkt) = TAG` guard as the
// event that CREATED it -- MintRoute has 14 such events, not 3, and one of
// them (RTMCS's receive_rrerPkt) carries a literal `type(pkt) = RRER` guard
// while the real creator (create_rrer) does not (see resolveTag below). So
// the discriminator guard alone cannot identify "creates" -- only the
// packet's OWN attributes can: an event creates the packet when it
// ESTABLISHES one of the attribute functions already discovered above, i.e.
// some guard requires the packet is not yet in that function's domain
// (`pkt ∉ dom(pktFwdr)`) and some action then assigns that function. This is
// what actually distinguishes create_dataPkt from start_tx_dataPkt: both
// guard `type(pkt) = DATA` and both write `pktFwdr`/`pktNbHops`, but
// start_tx_dataPkt's guard is the positive `pkt ∈ dom(pktFwdr)` (the packet
// already has a forwarder; this event is overwriting it, not creating it).
function isCreatingEvent(event: FlatEvent, fields: PacketField[]): boolean {
  return fields.some((f) => {
    const notYetInDomain = new RegExp(`∉\\s*dom\\(\\s*${f.ebName}\\s*\\)`);
    const assignsWholeFunction = new RegExp(`^\\s*${f.ebName}\\s*≔`);
    return event.guards.some((g) => notYetInDomain.test(g)) &&
      event.actions.some((a) => assignsWholeFunction.test(a));
  });
}

// The discriminator tag, read off a (already-confirmed-creating) event's own
// guards -- never off the event's label or file position. Two spellings:
//   1. Positive: `type(pkt) = TAG` -- e.g. MintRoute's create_dataPkt,
//      create_bconPkt, create_routePkt, and RTMCS's create_dataPkt,
//      create_rreq, create_rrep.
//   2. By elimination: `type(pkt) ∈ PARENT` plus `type(pkt) ≠ X` for every
//      child of PARENT except one -- e.g. RTMCS's create_rrer, which pins
//      `type(pkt) ∈ CONTROL` and excludes RREQ and RREP, leaving RRER (the
//      lattice's own `children` map supplies CONTROL's full child list, so
//      nothing here is hardcoded to RTMCS). Ambiguous elimination (more than
//      one child left) resolves to nothing rather than guessing.
function resolveTag(event: FlatEvent, lattice: TypeLattice): string | null {
  for (const tag of lattice.leaves) {
    const pin = new RegExp(`type\\s*\\(\\s*\\w+\\s*\\)\\s*=\\s*${tag}\\b`);
    if (event.guards.some((g) => pin.test(g))) return tag;
  }
  for (const [parent, kids] of lattice.children) {
    const pinsParent = new RegExp(`type\\s*\\(\\s*\\w+\\s*\\)\\s*∈\\s*${parent}\\b`);
    if (!event.guards.some((g) => pinsParent.test(g))) continue;
    const remaining = kids.filter((kid) => {
      const excludes = new RegExp(`type\\s*\\(\\s*\\w+\\s*\\)\\s*≠\\s*${kid}\\b`);
      return !event.guards.some((g) => excludes.test(g));
    });
    if (remaining.length === 1) return remaining[0];
  }
  return null;
}

// BEACON -> BeaconPkt, ROUTE -> RoutePkt, DATA -> DataPkt, RREQ -> RreqPkt.
function leafClassName(tag: string): string {
  return tag.charAt(0) + tag.slice(1).toLowerCase() + "Pkt";
}

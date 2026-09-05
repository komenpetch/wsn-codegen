import type { RawModel, EncodedMachine } from "../../wsn-codegen/src/engine/types";
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

  // A leaf type's creating event is the one whose guards pin `type(pkt)` to
  // that tag. Reading the discriminator from the guard, rather than from the
  // event's name, is what makes this work for RTMCS's RREQ/RREP/RRER too.
  // Verified against the real MintRoute M4 guards (npm run event -- MintRoute
  // M4 create_dataPkt create_bconPkt create_routePkt --flat): all three
  // creating events carry a literal `type(pkt) = <TAG>` guard alongside the
  // broader `type(pkt) ∈ CONTROL` guard (create_bconPkt/create_routePkt), so
  // the equality form alone is sufficient here -- no widening needed.
  const leaves: PacketLeaf[] = [];
  for (const tag of lattice.leaves) {
    const pin = new RegExp(`type\\s*\\(\\s*\\w+\\s*\\)\\s*=\\s*${tag}\\b`);
    const ev = machine.events.find((e) => e.guards.some((g) => pin.test(g)));
    if (ev) leaves.push({ typeName: leafClassName(tag), tag, event: ev.label });
  }
  return { fields, leaves, lattice };
}

// BEACON -> BeaconPkt, ROUTE -> RoutePkt, DATA -> DataPkt, RREQ -> RreqPkt.
function leafClassName(tag: string): string {
  return tag.charAt(0) + tag.slice(1).toLowerCase() + "Pkt";
}

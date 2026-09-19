import type { RawModel, EncodedMachine, FlatEvent } from "./types";
import type { TypeLattice } from "./packetTypes";
import { packetTypeLattice } from "./packetTypes";
import { flatten } from "./flattener";
import { resolveEncodings } from "./encodingResolver";
import { cap, capTag } from "./text";

export interface PacketField { name: string; ebName: string; cppType: "int" | "Node"; source: "context" | "variable"; total: boolean; }

// The accessor names PPkt exposes for a field. ONE definition, beside the field
// it describes.
//
// packetEmitter DECLARES these methods on the chunk; packetRules, mediumBinding
// and the scheduler all EMIT CALLS to them. Each of the four used to rebuild the
// name itself, so the declaration and its three sets of callers agreed only by
// coincidence: any change to how a name is formed -- a field already
// capitalised, an acronym, a name needing a suffix to avoid a clash -- had to be
// made in four places, and making it in three emits calls to methods that do not
// exist.
export const getterOf = (f: PacketField): string => `get${cap(f.name)}`;
export const setterOf = (f: PacketField): string => `set${cap(f.name)}`;

// The transmit method for one packet type, named as MintRoute names its own:
// BEACON -> sendBeaconBroadcast, ROUTE -> sendRouteBroadcast. Every packet the
// model transmits goes out as a broadcast, because the model's medium names no
// destination -- it delivers to whoever is in range.
//
// Shared, because two shells emit these now: the network protocol ends them in
// sendDown(packet), the application in socket->send(packet). The NAME is the
// same question in both, and the advisor named these methods specifically.
export const broadcastMethodOf = (tag: string): string => `send${capTag(tag)}Broadcast`;
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
// The arrow itself is now CAPTURED -- → (total) vs ⇸ (partial) is not
// cosmetic: see PacketField.total and PKT-DOM in packetRules.ts. A total
// function's domain is the whole carrier (`pkt ∈ dom(F)` is vacuously true
// once the chunk exists); a partial one's is not (`∈ dom(F)` is a real
// "has this attribute been set yet" precondition).
const PKT_DOMAIN = /^\s*\w+\s*∈\s*PKT\s*(→|⇸)/;

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
  const add = (ebName: string, inv: string, source: "context" | "variable", total: boolean) => {
    if (ebName === "type" || seen.has(ebName)) return;   // `type` is the discriminator
    seen.add(ebName);
    fields.push({ name: FIELD_NAME[ebName] ?? ebName, ebName, cppType: nodeValued(inv) ? "Node" : "int", source, total });
  };

  for (const c of raw.contexts)
    for (const a of c.axioms) {
      const m = PKT_DOMAIN.exec(a.text);
      if (m) add(a.text.split(/\s*∈\s*/)[0].trim(), a.text, "context", m[1] === "→");
    }

  for (const [id, inv] of machine.variableTypes) {
    const m = PKT_DOMAIN.exec(inv);
    if (m) add(id, inv, "variable", m[1] === "→");
  }

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
//
// ⚠ NECESSARY, NOT SUFFICIENT. This predicate is over-inclusive on its own --
// verified against both real corpora with a probe reimplementing this exact
// function (see git history of this file / the 2026-09-06 fix-report in
// task-3-report.md): `send_up` (MintRoute M4 AND RTMCS M6) and `send_down`
// (RTMCS M6) also satisfy BOTH halves. `send_down` domain-subtracts the
// packet-field family off the wire copy while restoring it onto the buffer
// copy (`vPktData ≔ vPktData ∪ {pkt ↦ data}` alongside `pkt ∉ dom(vPktData)`),
// and `send_up` does the reverse (`pkt ∉ dom(pktData)` guard +
// `pktData ≔ pktData ∪ {pkt ↦ data}` action) -- both are legitimate
// establishing assignments by this test's letter, but neither event CREATES
// a packet; they move an existing one between the buffer and the wire.
// The only reason `packetModel`'s leaf-mapping loop below still gets the
// right answer is that `send_up`/`send_down` carry no `type(pkt)` guard at
// all, so `resolveTag` returns `null` for them and the `&&` in the caller
// excludes them. Correctness here rests on the CONJUNCTION of
// `isCreatingEvent` and `resolveTag`, not on `isCreatingEvent` being sound by
// itself -- do not reuse this predicate alone to answer "does this event
// create a packet?" for anything else without re-deriving `resolveTag`'s
// exclusion alongside it. `tests/packetModel.test.ts` pins this dependency.
export function isCreatingEvent(event: FlatEvent, fields: PacketField[]): boolean {
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
export function resolveTag(event: FlatEvent, lattice: TypeLattice): string | null {
  for (const tag of lattice.leaves) {
    // Two spellings of the SAME pin, and the second is not a special case.
    // A name that is a lattice leaf has no children, so its partition part is a
    // one-element set -- it is simultaneously a set by its axiom and a leaf by
    // having nothing under it, which is the dual nature the unsplit CONTROL has
    // in the pattern. Membership in a one-element set determines the value, so
    // `type(pkt) ∈ CONTROL` pins CONTROL exactly as `type(pkt) = BEACON` pins
    // BEACON. ⚠ It stays inside this loop over LEAVES on purpose: for a name
    // with children, membership says "one of several" and pins nothing, which
    // is what the elimination branch below is for.
    //
    // Same reading as the scheduler's type stamp and the extension's creating
    // targets. Without it a project that declares no control split had its
    // creating event resolve to no leaf at all, so nothing carried it and the
    // module could not originate a control packet.
    const pin = new RegExp(`type\\s*\\(\\s*\\w+\\s*\\)\\s*[=∈]\\s*${tag}\\b`);
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

// A project's packet pattern class, from its raw model and a target machine --
// the three steps that turn a parsed project into a PacketModel, in one place.
//
// Both callers need exactly this and used to spell it out themselves: the
// network pipeline for the module it is generating, and the v5 path for a
// packet source that is a DIFFERENT project. They react differently to a model
// with no packet-type partition (one falls back to the app layer, the other
// refuses), so the absence is reported as `null` and the decision stays with
// the caller -- but the derivation itself is one behaviour.
export function packetModelOf(raw: RawModel, machine: string): PacketModel | null {
  const lattice = packetTypeLattice(raw.contexts);
  if (!lattice) return null;
  return packetModel(raw, resolveEncodings(flatten(raw, machine)), lattice);
}

// Same question asked of a model the caller has ALREADY flattened and encoded,
// so it is not built a second time.
export function packetModelFor(raw: RawModel, model: EncodedMachine): PacketModel | null {
  const lattice = packetTypeLattice(raw.contexts);
  return lattice ? packetModel(raw, model, lattice) : null;
}

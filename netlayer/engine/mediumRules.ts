import type { RuleMatch } from "../../src/engine/rules";
import type { NetRule } from "./packetRules";
import type { TypeLattice } from "./packetTypes";

// Rules the medium path needs, and nothing else needed.
//
// Every clause below blocks an event on the RECEIVING side of a transmission.
// They were invisible while nothing was ever received: a guard that reads a map
// only the creating node ever wrote looks fine until a packet arrives from
// somewhere else, and then it is simply never satisfiable. That is the same
// silent-failure shape as the `∈`/`∉` conflation, and it is why the three
// receive events stayed dead after the identity bindings landed.

const re = (p: RegExp) => (expr: string): RuleMatch | null => {
  const g = p.exec(expr.trim());
  return g ? { captures: g.groups ?? {} } : null;
};

// A chunk read, written the same way PKT-GET writes one: through the registry,
// null-checked. `pktOf` returns nullptr for an id this node does not hold, and
// a guard is exactly where that happens -- the id may have come from another
// node's map. Dereferencing it unchecked is the `std::out_of_range` hazard in a
// different costume.
const typeOf = (p: string) => `pktOf(${p})->getType()`;
const held = (p: string) => `pktOf(${p}) != nullptr`;

export function mediumRules(lattice: TypeLattice): NetRule[] {
  const out: NetRule[] = [];

  // ── `type(p)`: the packet-type discriminator ───────────────────────────
  //
  // ENC7 puts the discriminator on the chunk (`PktType type`, packetEmitter),
  // but `type` is a CONTEXT constant (`type ∈ PKT → TYPE`), so the app-layer
  // context emission also declares `inline std::map<PktId, int> type` and the
  // generic catalog reads clauses through it. Both storages then exist, and
  // only one is ever written on the node that CREATED the packet -- the map,
  // by the scheduler's own fresh-packet construction. A packet that arrives
  // over the medium has a chunk and no map entry, so every `type(pkt)` guard
  // on the receiving side is unsatisfiable: `type.count(pkt) > 0` is false and
  // the event silently never fires. That is what kept receive_controlPkt,
  // receive_dup_controlPkt and sink_recv_controlPkt dead, and it would have
  // kept the rebroadcast dead too (`start_tx_bconPkt` guards `type(pkt) =
  // BEACON`).
  //
  // These rules intercept ahead of the generic catalog and read the chunk --
  // the single storage ENC7 actually chose. The enum's values are kept equal
  // to the int tags (addMissingPacketTypeConstants), so a set-membership test
  // against a `std::set<int>` constant still works through one cast.
  const tags = [...lattice.tagOf.keys()].join("|");
  if (tags.length > 0) {
    out.push({
      id: "TYPE-CMP", tier: 1,
      evidence: ["MintRoute.start_tx_bconPkt", "MintRoute.create_bconPkt", "RTMCS.create_rreq"],
      match: re(new RegExp(`^type\\s*\\(\\s*(?<p>\\w+)\\s*\\)\\s*(?<op>=|≠)\\s*(?<tag>${tags})$`)),
      emit: (m) => {
        const { p, op, tag } = m.captures;
        const cmp = op === "=" ? "==" : "!=";
        return `(${held(p)} && ${typeOf(p)} ${cmp} PktType::${tag})`;
      },
    });
    out.push({
      id: "TYPE-MEM", tier: 1,
      evidence: ["MintRoute.receive_controlPkt", "RTMCS.create_rrer"],
      match: re(/^type\s*\(\s*(?<p>\w+)\s*\)\s*(?<op>∈|∉)\s*(?<S>\w+)$/),
      emit: (m) => {
        const { p, op, S } = m.captures;
        const test = `${S}.count(static_cast<int>(${typeOf(p)})) > 0`;
        return op === "∈" ? `(${held(p)} && ${test})` : `(${held(p)} && !(${test}))`;
      },
    });
  }

  // ── `f ≔ {k} ⩤ f`: domain subtraction by a singleton ────────────────────
  //
  // "Forget this key." send_up's last five actions are exactly this, on the
  // staging copies of the packet's attributes it has just restored:
  // `vPktSeqNo ≔ {pkt} ⩤ vPktSeqNo`. Untranslated, send_up refuses to fire --
  // and send_up is the event that delivers, so nothing downstream of it can
  // run either.
  //
  // The equivalent shape on a PACKET field is already handled (PKT-DEL, "the
  // packet is discarded and the field travels with it"). This is the other
  // half: an ordinary machine variable, whose storage is a real map.
  //
  // Encoding-dispatched, not assumed. On a `function` or `map-of-sets` the key
  // IS the map key, so one erase does it. On a `pair-set` the same operator
  // means "drop every pair whose first component is k" -- a different
  // operation on a different container -- and no clause in either corpus
  // spells it that way, so rather than emit a guess it is refused (empty emit
  // -> UNTRANSLATED, visible).
  out.push({
    id: "DOMSUB-SINGLETON", tier: 1,
    evidence: ["MintRoute.send_up", "RTMCS.send_up"],
    match: re(/^(?<f>\w+)\s*≔\s*\{\s*(?<k>\w+)\s*\}\s*⩤\s*(?<g>\w+)$/),
    emit: (m, enc) => {
      const { f, k, g } = m.captures;
      if (f !== g) return "";                       // `f ≔ {k} ⩤ h` is not this rule
      const e = enc(f);
      return e === "function" || e === "map-of-sets" ? `${f}.erase(${k});` : "";
    },
  });

  // ── `ran({p} ◁ V) ∈ (ℙ(C) ∪ {{K}})` ────────────────────────────────────
  //
  // send_up's well-typedness guard on the set of receivers: the delivery set
  // is either real recipients or the single failure marker, never a mix. It
  // reads as noise next to the guard below it that actually computes `nbrs`,
  // but it is the one that says a half-failed transmission is not a state the
  // model admits, and dropping it silently would drop that.
  //
  // `⊆ C` is not tested elementwise: C is a carrier set, and in a per-node
  // module the carrier holds this node only (see nodeIdentity.ts), so an
  // elementwise test against it would be false for every real receiver. What
  // the clause constrains that is checkable here is the non-mixing, so that is
  // what is emitted -- and nothing more.
  out.push({
    id: "IMG-NO-MIX", tier: 1,
    evidence: ["MintRoute.send_up"],
    match: re(/^ran\s*\(\s*\{\s*(?<p>\w+)\s*\}\s*◁\s*(?<V>\w+)\s*\)\s*∈\s*\(\s*ℙ\(\s*\w+\s*\)\s*∪\s*\{\s*\{\s*(?<K>\w+)\s*\}\s*\}\s*\)$/),
    emit: (m, enc) => {
      const { p, V, K } = m.captures;
      if (enc(V) !== "map-of-sets") return "";
      return `(${V}.count(${p}) == 0 || ${V}.at(${p}).count(${K}) == 0` +
        ` || ${V}.at(${p}).size() == 1)`;
    },
  });

  return out;
}

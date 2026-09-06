import type { Rule, RuleMatch } from "../../wsn-codegen/src/engine/rules";
import type { PacketField } from "./packetModel";

export interface NetRule extends Rule { tier: 1 | 2 | 3; evidence: string[]; supersedes?: string; }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const re = (p: RegExp) => (expr: string): RuleMatch | null => {
  const g = p.exec(expr.trim());
  return g ? { captures: g.groups ?? {} } : null;
};

// Per-(ebName, kind) evidence -- VERIFIED 2026-09-06 against the real flattened
// corpora (MintRoute M5, RTMCS M6: `npm run event -- <Project> <machine> --all
// --flat`, cross-checked with a probe that ran each rule's own `match` regex
// against every event's split conjuncts; see task-5-report.md for the
// transcript). A (field, kind) pair that is not listed here has NO clause in
// EITHER corpus that the corresponding rule's `match` accepts -- rather than
// ship a rule with fabricated evidence (the bug this table replaces: every
// kind used to cite the same two MintRoute events regardless of whether they
// actually exercised it), the rule for that (field, kind) is simply not
// generated. Two corrections this uncovered beyond the flagged PKT-DEL bug:
//   - PKT-GET's true evidence is `send_down` (it reads the field back via
//     `y = f(pkt)` when handing the packet to the channel), not
//     create_bconPkt/create_routePkt, which only ever WRITE these fields.
//   - The `f(p) = v` spelling (field-call on the left) that PKT-CMP was meant
//     to match never occurs anywhere in either corpus -- every equality in
//     both models spells it `v = f(p)` (GET's form) -- so PKT-CMP is dropped
//     entirely rather than kept with evidence that cannot be found.
// initialSrcAddr's DOM evidence is a RTMCS event (MintRoute never guards
// `dom(initialSrcAddr)`); that is fine -- the field has the same name and
// shape in both models, and `composeRules`/the evidence check verify each
// cited event against ITS OWN project's corpus, not the field's origin.
type Kind = "GET" | "SET" | "DOM" | "DEL";
const EVIDENCE: Record<string, Partial<Record<Kind, string[]>>> = {
  // Context-sourced: a fixed per-packet identity, never written or removed.
  initialSrcAddr: {
    GET: ["MintRoute.create_dataPkt", "RTMCS.create_dataPkt"],
    DOM: ["RTMCS.create_rrer"],
  },
  // The core attribute family every case study carries (pM1's ENC7 chunk
  // fields): established by the create_* events, read back and handed off
  // the wire by send_down, and (RTMCS only) swept out again by clear_pkt.
  pktSeqNo: {
    GET: ["MintRoute.send_down", "RTMCS.send_down"],
    SET: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DOM: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DEL: ["MintRoute.send_down", "RTMCS.send_down", "RTMCS.clear_pkt"],
  },
  pktSrc: {
    GET: ["MintRoute.send_down", "RTMCS.send_down"],
    SET: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DOM: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DEL: ["MintRoute.send_down", "RTMCS.send_down"],   // RTMCS.clear_pkt never touches pktSrc
  },
  pktFwdr: {
    GET: ["MintRoute.send_down", "RTMCS.send_down"],
    SET: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DOM: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DEL: ["MintRoute.send_down", "RTMCS.send_down", "RTMCS.clear_pkt"],
  },
  pktData: {
    GET: ["MintRoute.send_down", "RTMCS.send_down"],
    SET: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DOM: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DEL: ["MintRoute.send_down", "RTMCS.send_down", "RTMCS.clear_pkt"],
  },
  pktNbHops: {
    GET: ["MintRoute.send_down", "RTMCS.send_down"],
    SET: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DOM: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DEL: ["MintRoute.send_down", "RTMCS.send_down", "RTMCS.clear_pkt"],
  },
  // Total from INITIALISATION (`netSeqNo := PKT x {0}`) in both projects, so
  // it is never guarded for domain membership, never chunk-set via the
  // union/override spelling (only ever `netSeqNo(pkt) := v`, a different
  // shape this catalog has no rule for), and never anti-restricted.
  netSeqNo: {
    GET: ["MintRoute.update_nbr", "RTMCS.add_bwdRouteEntry"],
  },
  // MintRoute-only: the channel's own destination-address bookkeeping.
  vPktDestAddr: {
    GET: ["MintRoute.find_neighbours"],
    SET: ["MintRoute.send_down"],
    DOM: ["MintRoute.send_down"],
  },
  pktDestAddr: {
    GET: ["MintRoute.send_down"],
    SET: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DOM: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
    DEL: ["MintRoute.send_down"],
  },
  // RTMCS-only: its analogue of MintRoute's pktDestAddr/vPktDestAddr pair,
  // plus the RREQ/RREP/RRER-specific fields.
  vPktData: {
    GET: ["RTMCS.send_up"],
    SET: ["RTMCS.send_down"],
    DOM: ["RTMCS.send_down"],
    DEL: ["RTMCS.send_up"],
  },
  netDestAddr: {
    GET: ["RTMCS.send_down"],
    SET: ["RTMCS.create_rreq", "RTMCS.create_rrep"],
    DOM: ["RTMCS.create_rreq", "RTMCS.create_rrep"],
    DEL: ["RTMCS.clear_pkt"],
  },
  envDestAddr: {
    SET: ["RTMCS.send_down"],
    DOM: ["RTMCS.send_down"],
  },
  pktErrND: {
    SET: ["RTMCS.create_rrer"],
    DOM: ["RTMCS.create_rrer"],
  },
};

// Once ENC7 has put an attribute on the chunk, every operation on it changes:
// the map is gone, so `f(k)` is a getter, `f := f (+) {k|->v}` is a setter, and
// `k in dom(f)` is vacuously true because a chunk always has all its fields.
// That last one matters -- left untranslated it would make every creation event
// refuse to fire.
export function packetRules(fields: PacketField[]): NetRule[] {
  const out: NetRule[] = [];
  for (const f of fields) {
    const F = esc(f.ebName), G = `get${cap(f.name)}`, S = `set${cap(f.name)}`;
    const ev = EVIDENCE[f.ebName] ?? {};

    if (ev.GET) out.push({
      id: `PKT-GET-${f.ebName}`, tier: 1, evidence: ev.GET,
      match: re(new RegExp(`^(?<y>\\w+)\\s*=\\s*${F}\\(\\s*(?<p>\\w+)\\s*\\)$`)),
      emit: (m) => `${m.captures.y} == ${m.captures.p}->${G}()`,
    });
    // Both write spellings the models use: relational override (U+E103 / U+2295
    // / U+22B4) and union with a maplet. No `u` flag: in unicode mode `\{` is an
    // invalid identity escape and the RegExp constructor throws. U+E103 is in
    // the BMP, so the plain `` escape reaches it without that flag.
    if (ev.SET) out.push({
      id: `PKT-SET-${f.ebName}`, tier: 1, evidence: ev.SET,
      match: re(new RegExp(
        `^${F}\\s*≔\\s*${F}\\s*(?:[\\uE103⊕⊴∪]\\s*)?\\{\\s*(?<p>\\w+)\\s*↦\\s*(?<v>\\w+)\\s*\\}$`)),
      emit: (m) => `${m.captures.p}->${S}(${m.captures.v});`,
    });
    if (ev.DOM) out.push({
      id: `PKT-DOM-${f.ebName}`, tier: 1, evidence: ev.DOM,
      match: re(new RegExp(`^\\w+\\s*(?:∈|∉)\\s*dom\\(\\s*${F}\\s*\\)$`)),
      emit: () => `true`,
    });
    // Domain anti-restriction on a chunk field is a no-op: the packet is being
    // discarded, and the field goes with it.
    if (ev.DEL) out.push({
      id: `PKT-DEL-${f.ebName}`, tier: 3, evidence: ev.DEL,
      match: re(new RegExp(`^${F}\\s*≔\\s*\\{\\s*\\w+\\s*\\}\\s*⩤\\s*${F}$`)),
      emit: () => `/* packet discarded; field travels with it */`,
    });
  }
  return out;
}

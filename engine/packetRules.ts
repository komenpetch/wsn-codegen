import type { Rule, RuleMatch } from "../../wsn-codegen/src/engine/rules";
import type { PacketField } from "./packetModel";

export interface NetRule extends Rule { tier: 1 | 2 | 3; evidence: string[]; supersedes?: string; }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const re = (p: RegExp) => (expr: string): RuleMatch | null => {
  const g = p.exec(expr.trim());
  return g ? { captures: g.groups ?? {} } : null;
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
    const ev = [`MintRoute.create_bconPkt`, `MintRoute.create_routePkt`];

    out.push({
      id: `PKT-GET-${f.ebName}`, tier: 1, evidence: ev,
      match: re(new RegExp(`^(?<y>\\w+)\\s*=\\s*${F}\\(\\s*(?<p>\\w+)\\s*\\)$`)),
      emit: (m) => `${m.captures.y} == ${m.captures.p}->${G}()`,
    });
    out.push({
      id: `PKT-CMP-${f.ebName}`, tier: 1, evidence: ev,
      match: re(new RegExp(`^${F}\\(\\s*(?<p>\\w+)\\s*\\)\\s*=\\s*(?<v>\\w+)$`)),
      emit: (m) => `${m.captures.p}->${G}() == ${m.captures.v}`,
    });
    // Both write spellings the models use: relational override (U+E103 / U+2295
    // / U+22B4) and union with a maplet. No `u` flag: in unicode mode `\{` is an
    // invalid identity escape and the RegExp constructor throws. U+E103 is in
    // the BMP, so the plain `` escape reaches it without that flag.
    out.push({
      id: `PKT-SET-${f.ebName}`, tier: 1, evidence: ev,
      match: re(new RegExp(
        `^${F}\\s*≔\\s*${F}\\s*(?:[\\uE103⊕⊴∪]\\s*)?\\{\\s*(?<p>\\w+)\\s*↦\\s*(?<v>\\w+)\\s*\\}$`)),
      emit: (m) => `${m.captures.p}->${S}(${m.captures.v});`,
    });
    out.push({
      id: `PKT-DOM-${f.ebName}`, tier: 1, evidence: ev,
      match: re(new RegExp(`^\\w+\\s*(?:∈|∉)\\s*dom\\(\\s*${F}\\s*\\)$`)),
      emit: () => `true`,
    });
    // Domain anti-restriction on a chunk field is a no-op: the packet is being
    // discarded, and the field goes with it.
    out.push({
      id: `PKT-DEL-${f.ebName}`, tier: 3, evidence: ev,
      match: re(new RegExp(`^${F}\\s*≔\\s*\\{\\s*\\w+\\s*\\}\\s*⩤\\s*${F}$`)),
      emit: () => `/* packet discarded; field travels with it */`,
    });
  }
  return out;
}

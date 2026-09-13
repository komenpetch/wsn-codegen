import { redeclareMembers } from "./emitted";
import type { EncodedMachine, GeneratedTree } from "./types";
import type { NetRule } from "./packetRules";
import type { RuleMatch } from "./rules";
import { esc } from "./text";

// Two-level tables: a variable whose RANGE is itself a function.
//
// MintRoute declares `nbHops ∈ ND ↔ (PKT ⇸ ℤ)` -- for each node, a partial map
// from packet to hop count. The app-layer encoding resolver sees the outer `↔`,
// classifies it as a flat relation, and emits `std::map<Node, PktId>`, which
// loses the inner function entirely: the hop count has nowhere to live.
//
// Gap-baseline group G2, and the last thing standing between MintRoute's
// packet-creating events and firing. Every one of them guards
// `s ↦ {pkt ↦ nbh} ∉ nbHops` and then acts `nbHops ≔ nbHops ∪ {s ↦ {pkt ↦ nbh}}`.
//
// The model only ever tests, adds and removes SINGLETON inner maplets, so a
// nested map is a faithful and simple store:
//
//     s ↦ {pkt ↦ nbh} ∈ nbHops  ->  nbHops.count(s) && nbHops.at(s).count(pkt)
//                                   && nbHops.at(s).at(pkt) == nbh
//     nbHops ≔ nbHops ∪ {s↦{pkt↦nbh}}  ->  nbHops[s][pkt] = nbh;
//     nbHops ≔ nbHops ∖ {x↦{pkt↦nbh}}  ->  nbHops[x].erase(pkt);

// Event-B type token -> the C++ type a declaration uses.
export const ALIAS: Record<string, string> = { ND: "Node", PKT: "PktId", "ℤ": "Data", BOOL: "bool" };
// Exported because pairKeyed.ts asks the same question -- what C++ type does
// this Event-B carrier become -- and a second copy is how the two answers drift.
export const alias = (t: string) => ALIAS[t] ?? "int";
const re = (p: RegExp) => (expr: string): RuleMatch | null => {
  const g = p.exec(expr.trim());
  return g ? { captures: g.groups ?? {} } : null;
};

// `X ∈ A ↔ (B ⇸ C)` and its ↔/→/⇸ variants, in either position.
const NESTED = /^\s*\w+\s*∈\s*(\w+|ℤ)\s*(?:↔|→|⇸)\s*\(\s*(\w+|ℤ)\s*(?:↔|→|⇸)\s*(\w+|ℤ)\s*\)\s*$/;

export interface NestedMapVar { name: string; outer: string; inner: string; value: string; }

export function nestedMapVars(model: EncodedMachine): NestedMapVar[] {
  const out: NestedMapVar[] = [];
  for (const [name, inv] of model.variableTypes) {
    const m = NESTED.exec(inv);
    if (m) out.push({ name, outer: alias(m[1]), inner: alias(m[2]), value: alias(m[3]) });
  }
  return out;
}

// Rewrite the emitted member declaration to the nested type. Done as a
// post-emit pass because EncodingForm has no two-level form to select, and
// wsn-codegen/src is not this project's to change.
export function fixNestedMapDeclarations(tree: GeneratedTree, vars: NestedMapVar[]): GeneratedTree {
  return redeclareMembers(tree, vars.map((v) => ({
    name: v.name,
    cppType: `std::map<${v.outer}, std::map<${v.inner}, ${v.value}>>`,
    note: `${v.name} ∈ … ↔ (… ⇸ …)`,
  })));
}

export function nestedMapRules(vars: NestedMapVar[]): NetRule[] {
  const out: NetRule[] = [];
  for (const v of vars) {
    const N = esc(v.name);
    // Only nbHops carries genuine corpus evidence today; a variable of this
    // shape with no clause in either model produces no rule, per the evidence
    // discipline the catalog is checked against.
    const ev = v.name === "nbHops"
      ? ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"]
      : null;
    if (!ev) continue;

    out.push({
      id: `NEST-MEM-${v.name}`, tier: 1, evidence: ev,
      match: re(new RegExp(
        `^(?<o>\\w+)\\s*↦\\s*\\{\\s*(?<i>\\w+)\\s*↦\\s*(?<val>\\w+)\\s*\\}\\s*(?<op>∈|∉)\\s*${N}$`)),
      emit: (m) => {
        const { o, i, val, op } = m.captures;
        const has = `(${v.name}.count(${o}) > 0 && ${v.name}.at(${o}).count(${i}) > 0` +
                    ` && ${v.name}.at(${o}).at(${i}) == ${val})`;
        return op === "∈" ? has : `!${has}`;
      },
    });
    out.push({
      id: `NEST-ADD-${v.name}`, tier: 1, evidence: ev,
      match: re(new RegExp(
        `^${N}\\s*≔\\s*${N}\\s*∪\\s*\\{\\s*(?<o>\\w+)\\s*↦\\s*\\{\\s*(?<i>\\w+)\\s*↦\\s*(?<val>\\w+)\\s*\\}\\s*\\}$`)),
      emit: (m) => `${v.name}[${m.captures.o}][${m.captures.i}] = ${m.captures.val};`,
    });
    out.push({
      id: `NEST-DEL-${v.name}`, tier: 1,
      evidence: ["MintRoute.receive_dataPkt", "MintRoute.receive_controlPkt"],
      match: re(new RegExp(
        `^${N}\\s*≔\\s*${N}\\s*∖\\s*\\{\\s*(?<o>\\w+)\\s*↦\\s*\\{\\s*(?<i>\\w+)\\s*↦\\s*(?<val>\\w+)\\s*\\}\\s*\\}$`)),
      // Erases the inner entry only; the outer key survives with its remaining
      // packets, which is what set-minus of one maplet means.
      emit: (m) => `${v.name}[${m.captures.o}].erase(${m.captures.i});`,
    });
  }
  return out;
}

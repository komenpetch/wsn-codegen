import { RULES } from "../../wsn-codegen/src/engine/rules";
import type { Rule } from "../../wsn-codegen/src/engine/rules";
import type { NetRule } from "./packetRules";

// The engine takes the FIRST matching rule, so order is behaviour. A network
// rule either goes in front of the whole catalog (new shape) or replaces a
// named app-layer rule IN PLACE (wider form of the same idea). Anything else --
// a rule that quietly shadows one it did not declare -- is the kind of bug that
// shows up as a wrong emission three tasks later, so it is rejected here.
export function composeRules(net: NetRule[]): Rule[] {
  for (const r of net) {
    if (r.evidence.length === 0)
      throw new Error(`Rule ${r.id} has no evidence. Every rule names the events that exercise it.`);
    if (r.supersedes && !RULES.some((b) => b.id === r.supersedes))
      throw new Error(`Rule ${r.id} claims to supersede '${r.supersedes}', which is not in the app-layer catalog.`);
  }
  const replacing = new Map(net.filter((r) => r.supersedes).map((r) => [r.supersedes!, r]));
  const fresh = net.filter((r) => !r.supersedes);
  const base = RULES.map((b) => replacing.get(b.id) ?? b);
  return [...fresh, ...base];
}

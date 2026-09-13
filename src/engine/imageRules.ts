import type { RuleMatch } from "./rules";
import type { GeneratedTree } from "./types";
import type { NetRule } from "./packetRules";

// Relational image, `R[{x}]` -- gap-baseline group G5.
//
// `nbs = wsnLinks[{f}]` reads "nbs is the set of nodes linked to f", i.e. f's
// neighbours. It is what MintRoute's find_neighbours and assign_forwarder are
// blocked on, and therefore what stands between a flood that leaves the sink
// and a flood that reaches anyone.
//
// Scope note, since it matters for the report: this is NOT PPkt. `wsnLinks` is
// the network TOPOLOGY, maintained by the environment events add_link /
// disconnect_link / recover_link, and the two events that need it are PComm
// delivery events. It is added here because the flood cannot propagate without
// it, and because the relational image is a general set-theoretic operator --
// it crosses nothing into PRouteTable, which is the boundary the pattern-class
// sequence actually protects.
//
// Unlike membership, an image cannot be pushed down to a boolean: the model
// compares the whole set (`nbs = …`) and later iterates it. So this one does
// build the set, via a helper emitted beside the existing inDom/inRan.

const re = (p: RegExp) => (expr: string): RuleMatch | null => {
  const g = p.exec(expr.trim());
  return g ? { captures: g.groups ?? {} } : null;
};

export function imageRules(): NetRule[] {
  return [
    {
      id: "REL-IMAGE", tier: 1,
      evidence: ["MintRoute.find_neighbours", "MintRoute.assign_forwarder"],
      match: re(/^(?<y>\w+)\s*=\s*(?<R>\w+)\s*\[\s*\{\s*(?<x>\w+)\s*\}\s*\]$/),
      emit: (m) => `${m.captures.y} == relImage(${m.captures.R}, ${m.captures.x})`,
    },
  ];
}

// The helper, emitted next to the ones the app layer already inlines. Placed by
// anchoring on inRan rather than at a fixed offset, so it survives changes to
// the surrounding block.
export function insertImageHelper(tree: GeneratedTree): GeneratedTree {
  const ANCHOR = "template<class R> bool inRan(const R& r, PktId y) {";
  const helper = [
    "// The relational image R[{x}]: every value x is related to. Returns the set,",
    "// because the model compares it whole and then iterates it.",
    "template<class R> std::set<Node> relImage(const R& r, Node x) {",
    "  std::set<Node> out;",
    "  for (const auto& p : r) if (p.first == x) out.insert(p.second);",
    "  return out;",
    "}",
    ANCHOR,
  ].join("\n");
  return tree.map((f) =>
    f.path.endsWith(".h") && f.content.includes(ANCHOR)
      ? { ...f, content: f.content.replace(ANCHOR, helper) }
      : f);
}

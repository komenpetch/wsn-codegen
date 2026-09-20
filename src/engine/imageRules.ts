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
    // `e ∈ ran({k} ◁ R)` -- MEMBERSHIP in an image, which is not a set
    // comparison at all: it is `k ↦ e ∈ R` written the long way, so it needs no
    // helper and builds no set. The optional outer parentheses are RTMCS's own
    // spelling, `des ∈ ( ran({pkt} ◁ ctlNeighbours) )`.
    //
    // ⚠ THIS IS THE DELIVERY PUBLICATION TEST, and untranslated it made all four
    // `dest_recv_*` events REFUSE TO FIRE -- so an RREQ could never be delivered
    // to its destination, `ctlNeighbours` was never drained by them, and the
    // whole reception chain stalled behind it.
    {
      id: "IMAGE-MEM", tier: 1,
      evidence: ["RTMCS.dest_recv_rreqPkt", "MintRoute.update_route"],
      match: re(/^(?<e>\w+)\s*∈\s*\(?\s*ran\s*\(\s*\{\s*(?<k>\w+)\s*\}\s*◁\s*(?<R>\w+)\s*\)\s*\)?$/),
      emit: (m, enc) => {
        const { e, k, R } = m.captures;
        switch (enc(R)) {
          case "map-of-sets": return `(${R}.count(${k}) > 0 && ${R}.at(${k}).count(${e}) > 0)`;
          case "pair-set":    return `${R}.count({${k}, ${e}}) > 0`;
          case "function":    return `(${R}.count(${k}) > 0 && ${R}.at(${k}) == ${e})`;
          default:            return "";     // refuse rather than guess a shape
        }
      },
    },
    // `ran({k} ◁ R) = {c}` / `≠ {c}` -- the image is EXACTLY one named value.
    //
    // RTMCS asks this of `ctlNeighbours` to tell a delivery from a loss: the
    // image being exactly `{FAILED_XMIT}` means nobody received it. Size AND
    // membership, because `{c} ⊆ image` is a weaker statement than equality --
    // a packet delivered to one node AND marked failed would pass the weaker
    // test and is not what the model says.
    //
    // ⚠ An ABSENT key is the empty image, which is not `{c}` -- so `≠` is TRUE
    // there and `=` is FALSE. Writing `R.at(k)` first would throw instead.
    {
      id: "IMAGE-EQ-SINGLETON", tier: 1,
      evidence: ["RTMCS.dest_recv_rreqPkt", "RTMCS.lose_controlPkt", "MintRoute.lose_pkt"],
      match: re(/^ran\s*\(\s*\{\s*(?<k>\w+)\s*\}\s*◁\s*(?<R>\w+)\s*\)\s*(?<op>=|≠)\s*\{\s*(?<c>\w+)\s*\}$/),
      emit: (m, enc) => {
        const { k, R, op, c } = m.captures;
        const is = enc(R) === "map-of-sets"
          ? `(${R}.count(${k}) > 0 && ${R}.at(${k}).size() == 1 && ${R}.at(${k}).count(${c}) > 0)`
          : enc(R) === "function"
            ? `(${R}.count(${k}) > 0 && ${R}.at(${k}) == ${c})`
            : "";                            // a pair-set needs a scan: refuse
        return is === "" ? "" : (op === "=" ? is : `!${is}`);
      },
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

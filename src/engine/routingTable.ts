// PRouteTable → INET's own routing table: the neighbour table published as
// ONE-HOP ROUTES, every neighbour a destination whose next hop is itself.
//
// WHY THIS IS A BINDING AND NOT A RULE. The model says `(me ↦ nb) ∈
// neighbourTbl` — that nb is a neighbour. It does NOT say that a neighbour is
// reachable in one hop with itself as the next hop; that is what being a
// neighbour MEANS, stated nowhere in the Event-B. So publishing it to
// `IRoutingTable` is the same kind of step as the medium binding: the model's
// own state, handed to the simulator in the form the simulator understands.
// The pair-keyed maps stay exactly as the translation rules emit them — this
// pass adds a view, it does not replace the storage.
//
// ⚠ PRECEDENT. `MintRoute.cc` uses no routing table at all (zero occurrences
// of IRoutingTable/IRoute/addRoute — it keeps its own std::map), which is why
// the 2026-09-19 design recorded this choice as having none. It does have one:
// INET's `Aodv.cc` holds `ModuleRefByPar<IRoutingTable> routingTable`, builds
// entries with `routingTable->createRoute()` and tags them `IRoute::AODV`.
// This pass is shaped after that one.
//
// ⚠ WE ARE NOT AODV, so the routes are tagged `IRoute::MANET` ("managed by
// manet, search exact address") rather than borrowing `IRoute::AODV`. Claiming
// AODV for a module generated from some other model would put a false
// provenance on every route, the same objection that made the module register
// its own protocol id instead of borrowing MintRoute's.
import type { EncodedMachine, GeneratedTree } from "./types";
import { pairKeyedVars } from "./pairKeyed";
import { headerOf, implOf, mustFind, mustReplace } from "./emitted";

/**
 * WHICH variable is the route table — read off the model, never named.
 *
 * The discriminator is that a route table is a relation over nodes that
 * CARRIES PER-ENTRY DATA: the model declares `lastSeqno ∈ neighbourTbl → ℕ`,
 * so `neighbourTbl` is the domain of a pair-keyed function. `pairKeyedVars`
 * already computes exactly that relationship, so this asks it rather than
 * growing a second answer.
 *
 * It separates the table from its look-alikes for the right reason:
 *
 *   neighbourTbl ∈ ND ↔ ND   + lastSeqno/missed/received over it   → a table
 *   updateNbrs   ∈ ND ↔ ND   + nothing keyed over it               → a queue
 *
 * and it generalises off the corpus rather than off one project: RTMCS
 * declares `bwdRouteTbl ∈ ND ↔ ND` with `bwdNextND ∈ bwdRouteTbl → ND`,
 * `bwdSeqNo`/`bwdHopCnt` likewise, so the same rule finds its table too.
 *
 * Both ends must be node sets: a relation keyed by packets is not a route
 * table however much per-entry data hangs off it.
 */
export function routeTableOf(model: EncodedMachine, nodeSets: ReadonlySet<string>): string | null {
  const keyed = pairKeyedVars(model);
  const candidates = new Set<string>();
  for (const v of keyed) {
    const inv = model.variableTypes.get(v.domain);
    if (!inv) continue;
    const m = new RegExp(`^\\s*${v.domain}\\s*∈\\s*(\\w+)\\s*↔\\s*(\\w+)\\s*$`).exec(inv);
    if (m && nodeSets.has(m[1]) && nodeSets.has(m[2])) candidates.add(v.domain);
  }
  // ⚠ Two candidates is a refusal, not a coin toss. RTMCS M5 declares BOTH
  // `bwdRouteTbl` and `fwdRouteTbl`, and which of them INET's single routing
  // table should hold is a modelling question this pass must not answer by
  // picking the first one it happened to see.
  return candidates.size === 1 ? [...candidates][0] : null;
}

/**
 * Emit the binding: learn each neighbour's L3 address at the arrival, and
 * reconcile the model's table into INET's after every delivery.
 *
 * ⚠ THE THIRD IDENTITY BINDING, and it is why this could not be a rule. The
 * model's ND is bound to module ids (`myNodeId`), but a route needs an
 * `L3Address`. The arrival is the one place that holds both at once — it
 * already reads `L3AddressInd` for the echo test and the forwarder off the
 * wire for `deliveredBy` — so that is where the correspondence is learnt,
 * exactly as `deliveredBy` learns the forwarder from the delivery rather than
 * from the packet.
 */
export function bindRoutingTable(tree: GeneratedTree, cls: string, table: string): GeneratedTree {
  const h = headerOf(tree), cc = implOf(tree);
  if (!h || !cc) return tree;

  const PASS = "bindRoutingTable";

  // ── header: the module reference, the learnt addresses, the publisher ──
  const stateAnchor = "    // ── Event-B machine state ──";
  mustFind(h.content, stateAnchor, `${PASS} (state anchor)`);
  const decls = [
    "    // ── PRouteTable → INET (one-hop routes) ──",
    "    inet::ModuleRefByPar<inet::IRoutingTable> routingTable;",
    "    // Learnt at the arrival: the model's node id ↔ the address INET knows",
    "    // it by. Nothing in the Event-B says what a node's address is, so the",
    "    // correspondence has to be observed rather than translated.",
    "    std::map<Node, inet::L3Address> nodeAddress;",
    "    void publishOneHopRoutes();",
    stateAnchor,
  ].join("\n");

  const includes = [
    '#include "inet/common/ModuleRefByPar.h"',
    '#include "inet/networklayer/contract/IRoute.h"',
    '#include "inet/networklayer/contract/IRoutingTable.h"',
  ].join("\n");

  let hContent = h.content.replace(stateAnchor, decls);
  hContent = mustReplace(hContent, '#include "inet/common/Protocol.h"',
    `${includes}\n#include "inet/common/Protocol.h"`, `${PASS} (includes)`);

  // ── source: resolve the table, learn addresses, publish ──
  let ccContent = cc.content;

  // The reference is REQUIRED (`true`): a model that reached this pass has a
  // route table, so a host without a routing table is a harness error worth a
  // loud failure at init rather than silently unrouted traffic.
  ccContent = mustReplace(ccContent, "    if (stage == INITSTAGE_LOCAL) {",
    '    if (stage == INITSTAGE_LOCAL) {\n'
    + '        routingTable.reference(this, "routingTableModule", true);',
    `${PASS} (init stage)`);

  // Published where the table has just changed: the arrival is the only thing
  // that runs `add_newEntry`, so reconciling anywhere else would either lag a
  // delivery behind or run on a timer that knows nothing about receptions.
  ccContent = mustReplace(ccContent, "    runDeliveryEvents();",
    "    runDeliveryEvents();\n    publishOneHopRoutes();", `${PASS} (publish call)`);

  ccContent = mustReplace(ccContent, "    deliveredBy[_pkt] = _f;",
    "    deliveredBy[_pkt] = _f;\n"
    + "    if (_srcInd != nullptr)\n"
    + "        nodeAddress[_f] = _srcInd->getSrcAddress();   // ND ↦ L3Address, observed",
    `${PASS} (address learning)`);

  ccContent += `
void ${cls}::publishOneHopRoutes() {
    // ⚠ The interface is resolved here, not held as a member: this shell is an
    // ApplicationBase and has no \`networkInterface\` -- that belongs to
    // NetworkProtocolBase, which AODV's shape would have suggested. The app
    // shell already reaches the interface table this way for isOwnAddress().
    inet::IInterfaceTable *ift =
        inet::L3AddressResolver().findInterfaceTableOf(inet::getContainingNode(this));
    if (ift == nullptr) return;
    inet::NetworkInterface *out = nullptr;
    for (int i = 0; i < ift->getNumInterfaces() && out == nullptr; i++)
        if (!ift->getInterface(i)->isLoopback()) out = ift->getInterface(i);

    // Every entry of the model's table is (me ↦ neighbour): \`add_newEntry\`
    // takes the pending pair (forwarder ↦ me) and files it flipped, which is
    // the case studies' own convention. So the second half is the neighbour,
    // and a neighbour is a destination exactly one hop away reached through
    // itself.
    for (const auto& e : ${table}) {
        if (e.first != myNodeId) continue;
        auto known = nodeAddress.find(e.second);
        if (known == nodeAddress.end()) continue;   // not heard from directly yet
        const inet::L3Address& dest = known->second;

        // Reconcile rather than re-add: this runs after every delivery, and
        // IRoutingTable does not de-duplicate for us.
        bool have = false;
        for (int i = 0; i < routingTable->getNumRoutes(); i++) {
            inet::IRoute *r = routingTable->getRoute(i);
            if (r->getSource() == this && r->getDestinationAsGeneric() == dest) { have = true; break; }
        }
        if (have) continue;

        inet::IRoute *route = routingTable->createRoute();
        route->setDestination(dest);
        route->setPrefixLength(dest.getAddressType()->getMaxPrefixLength());
        route->setNextHop(dest);                     // one hop: the neighbour itself
        route->setMetric(1);
        if (out != nullptr) route->setInterface(out);
        route->setSourceType(inet::IRoute::MANET);
        route->setSource(this);
        routingTable->addRoute(route);
        EV_INFO << "one-hop route to " << dest << " via itself" << endl;
    }
}
`;

  return tree.map((f) => {
    if (f.path === h.path) return { ...f, content: hContent };
    if (f.path === cc.path) return { ...f, content: ccContent };
    if (!f.path.endsWith(".ned")) return f;
    // The parameter the reference resolves through, spelled as AODV.ned spells
    // it. `^` is the containing host, so it reads the same from an app as from
    // a network-layer module.
    return {
      ...f,
      content: mustReplace(f.content, "    parameters:",
        '    parameters:\n        string routingTableModule = default("^.ipv4.routingTable");',
        `${PASS} (NED parameter)`),
    };
  });
}

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
import { netLayerName } from "./netProtocolShell";
import { broadcastMethodOf } from "./packetModel";
import { variablesUsedBy } from "./packetOps";

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
    "    // MAC → L3, for the shell that has no IP layer to tag an arrival's",
    "    // source. Held exactly as MintRoute holds its own.",
    "    inet::ModuleRefByPar<inet::IArp> arp;",
    "    void publishOneHopRoutes();",
    stateAnchor,
  ].join("\n");

  const includes = [
    '#include "inet/common/ModuleRefByPar.h"',
    '#include "inet/linklayer/common/MacAddressTag_m.h"',
    '#include "inet/networklayer/contract/IArp.h"',
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
    + '        routingTable.reference(this, "routingTableModule", true);\n'
    // OPTIONAL (`false`): the ARP path is the fallback for a shell with no IP
    // layer, and a host that has neither an arpModule nor an L3AddressInd
    // simply learns no addresses. Making it required would refuse to start a
    // module that is otherwise perfectly able to flood.
    + '        arp.reference(this, "arpModule", false);',
    `${PASS} (init stage)`);

  // Published where the table has just changed: the arrival is the only thing
  // that runs `add_newEntry`, so reconciling anywhere else would either lag a
  // delivery behind or run on a timer that knows nothing about receptions.
  ccContent = mustReplace(ccContent, "    runDeliveryEvents();",
    "    runDeliveryEvents();\n    publishOneHopRoutes();", `${PASS} (publish call)`);

  // ⚠ TWO WAYS TO LEARN IT, BECAUSE ONE OF THEM DOES NOT EXIST ON THIS SHELL.
  //
  // `L3AddressInd` is attached by an IP layer. Structure 3 ran as an
  // ApplicationBase over full IPv4 until 2026-09-21 and the tag was always
  // there; as a NetworkProtocolBase it sits directly ABOVE THE MAC and nothing
  // attaches one. Measured: `nodeAddress` stayed empty for a whole 60 s run,
  // every candidate hit `known == nodeAddress.end()`, and the module published
  // ZERO routes while flooding correctly and reporting no error at all.
  //
  // The MAC does supply the sender's MacAddress, and mapping that to an
  // L3Address is exactly what ARP is for. The wrapper already hands this
  // module an `arpModule` parameter (MintRoute holds the same
  // `ModuleRefByPar<IArp>` for the same reason) and nothing was reading it.
  //
  // Both paths are kept rather than one being chosen here: the tag is the
  // better answer when it is present, ARP is the answer when it is not, and
  // which shell this module is in is not something this pass should have to
  // know. An address that resolves to neither is left unlearnt and its
  // neighbour simply gets no route, which is what the `.end()` check below
  // already means.
  ccContent = mustReplace(ccContent, "    deliveredBy[_pkt] = _f;",
    "    deliveredBy[_pkt] = _f;\n"
    + "    if (_srcInd != nullptr)\n"
    + "        nodeAddress[_f] = _srcInd->getSrcAddress();   // ND ↦ L3Address, observed\n"
    + "    else if (auto _macInd = arp ? packet->findTag<inet::MacAddressInd>() : nullptr) {\n"
    + "        // No IP layer above the MAC to tag the source, so ask ARP what\n"
    + "        // L3 address that MAC belongs to.\n"
    + "        inet::L3Address _viaArp = arp->getL3AddressFor(_macInd->getSrcAddress());\n"
    + "        if (!_viaArp.isUnspecified())\n"
    + "            nodeAddress[_f] = _viaArp;\n"
    + "    }",
    `${PASS} (address learning)`);

  ccContent += `
void ${cls}::publishOneHopRoutes() {
    // The outgoing interface, from the one NetworkProtocolBase already holds.
    //
    // ⚠ This used to resolve the interface table through L3AddressResolver and
    // walk it by hand, under a comment saying "this shell is an ApplicationBase
    // and has no \`networkInterface\`". Both halves were wrong once structure 3
    // became a network protocol: the shell is NOT an ApplicationBase, and what
    // NetworkProtocolBase declares is \`interfaceTable\`, not \`networkInterface\`.
    // The line below is MintRoute.cc's own (\`interfaceTable->
    // findFirstNonLoopbackInterface()\`), which is what the hand-written loop
    // was reimplementing.
    inet::NetworkInterface *out =
        interfaceTable ? interfaceTable->findFirstNonLoopbackInterface() : nullptr;

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

    // ⚠ THE MODULE THAT PUBLISHES ROUTES MUST HAVE A TABLE TO PUBLISH INTO,
    // AND ON THIS SHELL NOTHING ELSE PROVIDES ONE.
    //
    // The default used to be `^.ipv4.routingTable`, which is AODV's spelling
    // and was right while this was an application running over a full IPv4
    // stack. Structure 3 is a network protocol now: it sits directly above the
    // MAC, the harness runs `**.hasIpv4 = false`, and there is no
    // `ipv4.routingTable` anywhere in the node. Measured -- the run died at
    // setup with "Module not found on path '^.ipv4.routingTable'".
    //
    // The fix is INET's own, from NextHopNetworkLayer.ned: the wrapper carries
    // a `routingTable: NextHopRoutingTable` and points every submodule's
    // `routingTableModule` at it with absPath. MintRouteNetworkLayer has no
    // such submodule, which is why this shell did not start with one -- and
    // that is consistent rather than an oversight, because MintRoute publishes
    // no routes at all (zero occurrences of IRoutingTable in MintRoute.cc); it
    // keeps its own std::map. A module that DOES publish needs the table.
    //
    // ⚠ ANCHORED ON THE SIMPLE MODULE'S OWN DECLARATION, not on the first
    // "    parameters:" in the file. This .ned holds TWO modules -- the simple
    // one and the <Name>NetworkLayer wrapper -- and the bare anchor found the
    // right one only because `simple` happens to be emitted first. That is the
    // defect a21dbdf fixed for the membership splice; the same reasoning
    // applies here, and mustReplace cannot tell a wrong match from a right one.
    const simpleAt = mustFind(f.content, `simple ${cls} `, `${PASS} (simple module)`);
    const head = f.content.slice(0, simpleAt);
    const rest = mustReplace(f.content.slice(simpleAt), "    parameters:",
      '    parameters:\n        string routingTableModule;',
      `${PASS} (NED parameter)`);

    // And the wrapper gains the table itself. Keyed on the wrapper's own
    // declaration so a tree without one (there is none today, but the shell is
    // what decides) is left alone rather than silently half-wired.
    const wrapper = `module ${netLayerName(cls)} `;
    if (!rest.includes(wrapper)) return { ...f, content: head + rest };
    const wired = mustReplace(rest,
      "        *.interfaceTableModule = default(absPath(this.interfaceTableModule));",
      "        *.interfaceTableModule = default(absPath(this.interfaceTableModule));\n"
      + "        // Every submodule resolves the table through this, exactly as\n"
      + "        // NextHopNetworkLayer.ned wires its own.\n"
      + '        *.routingTableModule = default(absPath(".routingTable"));',
      `${PASS} (wrapper parameter)`);
    const withTable = mustReplace(wired, "    submodules:",
      "    submodules:\n"
      + "        // The one-hop routes the model derives from its neighbour table are\n"
      + "        // published here. NextHop rather than Ipv4 because this layer runs\n"
      + "        // with no IP stack under it.\n"
      + "        routingTable: NextHopRoutingTable {\n"
      + '            parameters:\n                @display("p=100,100");\n'
      + "        }",
      `${PASS} (wrapper submodule)`);
    // ⚠ The import goes in the HEAD, not in `rest`: the .ned's import block
    // sits ABOVE the simple module, so it is on the other side of the slice
    // that scopes everything else here to the right module.
    const imported = mustReplace(head,
      "import inet.networklayer.contract.INetworkLayer;",
      "import inet.networklayer.contract.INetworkLayer;\n"
      + "import inet.networklayer.nexthop.NextHopRoutingTable;",
      `${PASS} (wrapper import)`);
    return { ...f, content: imported + withTable };
  });
}

// ── Structure 4: route entries as well as neighbours (step 3d) ────────────────

export interface RouteTables {
  /** The neighbour table: published as one-hop routes, as structure 3 does. */
  neighbours: string;
  /** The route entries, and the function giving each entry's next hop. */
  routes: string;
  nextHop: string;
}

/**
 * Structure 4's two tables, read off the model as routeTableOf reads one: node
 * relations with per-entry data. What tells them apart is the data. The route
 * table is the one whose entries carry a NODE -- `nextHop ∈ routeTbl → ND`, the
 * neighbour to send through -- and the neighbour table is the other, whose
 * entries carry counters (`lastSeqno ∈ neighbourTbl → ℕ`).
 *
 * Exactly one of each, or null: RTMCS declares two route tables
 * (`fwdRouteTbl`/`fwdNextND`, `bwdRouteTbl`/`bwdNextND`), and which one INET's
 * table shows is the RTMCS round's question, not this pass's.
 */
export function routeTablesOf(model: EncodedMachine, nodeSets: ReadonlySet<string>): RouteTables | null {
  const keyed = pairKeyedVars(model);
  const isNodeRelation = (r: string): boolean => {
    const m = new RegExp(`^\\s*${r}\\s*∈\\s*(\\w+)\\s*↔\\s*(\\w+)\\s*$`).exec(model.variableTypes.get(r) ?? "");
    return m !== null && nodeSets.has(m[1]) && nodeSets.has(m[2]);
  };
  // ⚠ The value type off the invariant itself: PairKeyedVar.value is the C++
  // alias, which maps every non-ND set to `int` and so cannot tell a node
  // subset from a counter.
  const valueSet = (v: string) => /(\S+)\s*$/.exec(model.variableTypes.get(v) ?? "")?.[1] ?? "";
  const relations = [...new Set(keyed.map((v) => v.domain).filter(isNodeRelation))];
  const routing = keyed.filter((v) => relations.includes(v.domain) && nodeSets.has(valueSet(v.name)));
  const others = relations.filter((r) => !routing.some((v) => v.domain === r));
  if (routing.length !== 1 || others.length !== 1) return null;
  return { neighbours: others[0], routes: routing[0].domain, nextHop: routing[0].name };
}

/**
 * D5 for structure 4, applied over what bindRoutingTable wired for the neighbour
 * table (the table reference, the learnt addresses, the NED). Three changes:
 *
 * - the publisher becomes `publishRoutes()`: each route entry (me ↦ d) as "d via
 *   nextHop(me ↦ d)", in place of a one-hop route to d where there is one, and
 *   each other neighbour as a one-hop route. Reconciled on destination and next
 *   hop: a published route whose next hop changed is updated in place, as INET's
 *   AODV updates its own (`Aodv.cc:709`); nothing is withdrawn, since no entry is
 *   ever removed (D15). Metric 1 for a one-hop route, which is exact, and 2 for a
 *   route through another node, the fewest hops it can be (user, 2026-10-12, Q2 =
 *   b): the model holds no hop count.
 * - `addressOfNode(n)`: a destination this node has never heard is addressed
 *   through its node module (a node id is its node module's id), the form
 *   GlobalArp maps (D5). In a model with a Sink constant the sink's id is that
 *   constant, so the sink is `sinkAddress`.
 * - the reconcile runs once, at the end of `runDeliveryEvents()` (Q1 = a): after
 *   every arrival, and on every timer after it creates -- on the route timer
 *   that is after `chooseParent()`, so a next hop `addEntry` changes there is
 *   published in the same event. And ARP becomes required, as in the baseline
 *   (`MintRoute.cc:39`): the unicast branch needs it.
 */
export function bindRouteEntries(tree: GeneratedTree, cls: string, t: RouteTables,
  sink: string | null): GeneratedTree {
  const PASS = "bindRouteEntries";
  const h = headerOf(tree), cc = implOf(tree);
  if (!h || !cc) throw new Error(`${PASS}: the module is missing a .h or .cc.`);

  let hText = mustReplace(h.content, "    // ── PRouteTable → INET (one-hop routes) ──\n",
    "    // ── PRouteTable → INET (route entries, and one-hop routes to neighbours) ──\n",
    `${PASS} (.h comment)`);
  hText = mustReplace(hText, "    void publishOneHopRoutes();\n",
    "    inet::L3Address addressOfNode(Node n);\n"
    + "    void installRoute(cObject *source, inet::NetworkInterface *out,\n"
    + "                      const inet::L3Address& dest, const inet::L3Address& nextHop, int metric);\n"
    + "    void publishRoutes();\n", `${PASS} (.h publisher)`);

  let ccText = mustReplace(cc.content, '        arp.reference(this, "arpModule", false);',
    '        arp.reference(this, "arpModule", true);', `${PASS} (ARP required)`);
  // In a model with a Sink constant the sink's node id is that constant, not its
  // node module's id, so addressOfNode cannot find it through the module. Its
  // address is known by name instead, and recorded beside the learnt ones (user,
  // 2026-10-12, Q3 = a), so the lookup needs no special case.
  if (sink)
    ccText = mustReplace(ccText, "            sinkAddress = addressResolver.resolve(sinkStr);\n",
      "            sinkAddress = addressResolver.resolve(sinkStr);\n"
      + `        // The sink's node id is the model's ${sink}, not its module id, so its\n`
      + "        // address is known by name rather than looked up through the module.\n"
      + "        if (!sinkAddress.isUnspecified())\n"
      + `            nodeAddress[${sink}] = sinkAddress;\n`,
      `${PASS} (the sink's address)`);
  ccText = mustReplace(ccText, "    runDeliveryEvents();\n    publishOneHopRoutes();\n",
    "    runDeliveryEvents();\n", `${PASS} (arrival call)`);
  const drainAt = mustFind(ccText, `bool ${cls}::runDeliveryEvents()\n{`, `${PASS} (runDeliveryEvents)`);
  const ret = ccText.indexOf("    return fired;\n}\n", drainAt);
  if (ret < 0) throw new Error(`${PASS}: runDeliveryEvents() does not end in \`return fired;\`.`);
  ccText = ccText.slice(0, ret)
    + "    // INET's table follows the model's (D5): after every arrival, and after\n"
    + "    // every timer's own events, the route timer's chooseParent() included.\n"
    + "    publishRoutes();\n" + ccText.slice(ret);

  const start = mustFind(ccText, `\nvoid ${cls}::publishOneHopRoutes() {`, `${PASS} (old publisher)`);
  const end = ccText.indexOf("\n}\n", start + 1);
  if (end < 0) throw new Error(`${PASS}: publishOneHopRoutes() has no end.`);
  ccText = ccText.slice(0, start) + `
// A node id as INET addresses it (D5). Learnt at an arrival when this node has
// heard it (or, for a model's Sink, known by name from initialisation); otherwise
// through its node module, since a node id is its node module's id, as the
// module-path address GlobalArp maps -- so the two agree.
inet::L3Address ${cls}::addressOfNode(Node n) {
    auto known = nodeAddress.find(n);
    if (known != nodeAddress.end()) return known->second;
    cModule *host = getSimulation()->getModule(n);
    if (host == nullptr) return inet::L3Address();
    return inet::L3AddressResolver().addressOf(host, inet::L3AddressResolver::ADDR_MODULEPATH);
}

// What INET's routing table shows (D5): every route entry of this node as
// "d via ${t.nextHop}", in place of a one-hop route to d, and every other neighbour
// as a one-hop route. Reconciled on destination and next hop.
void ${cls}::publishRoutes() {
    inet::NetworkInterface *out =
        interfaceTable ? interfaceTable->findFirstNonLoopbackInterface() : nullptr;

    std::map<Node, Node> via;   // destination -> next hop, route entries first
    for (const auto& e : ${t.routes})
        if (e.first == myNodeId && ${t.nextHop}.count(e) > 0) via[e.second] = ${t.nextHop}.at(e);
    for (const auto& e : ${t.neighbours})
        if (e.first == myNodeId && via.count(e.second) == 0) via[e.second] = e.second;

    for (const auto& dv : via) {
        inet::L3Address dest = addressOfNode(dv.first), gw = addressOfNode(dv.second);
        if (dest.isUnspecified() || gw.isUnspecified()) continue;
        // 1 for a neighbour, which is exact; 2 for a route through another node,
        // the fewest hops it can be. The model holds no hop count.
        int metric = dv.second == dv.first ? 1 : 2;
        installRoute(this, out, dest, gw, metric);
    }
}

// One route in INET's table, created or brought up to date (D5). Matched on the
// source and the destination; a changed next hop is updated in place, as
// Aodv.cc:709 does. No entry is ever removed (D15), so nothing is withdrawn.
void ${cls}::installRoute(cObject *source, inet::NetworkInterface *out,
                         const inet::L3Address& dest, const inet::L3Address& nextHop, int metric) {
    for (int i = 0; i < routingTable->getNumRoutes(); i++) {
        inet::IRoute *r = routingTable->getRoute(i);
        if (r->getSource() != source || r->getDestinationAsGeneric() != dest) continue;
        if (r->getNextHopAsGeneric() != nextHop) {
            r->setNextHop(nextHop);
            r->setMetric(metric);
            EV_INFO << "route to " << dest << " now via " << nextHop << endl;
        }
        return;
    }
    inet::IRoute *route = routingTable->createRoute();
    route->setDestination(dest);
    route->setPrefixLength(dest.getAddressType()->getMaxPrefixLength());
    route->setNextHop(nextHop);
    route->setMetric(metric);
    if (out != nullptr) route->setInterface(out);
    route->setSourceType(inet::IRoute::MANET);
    route->setSource(source);
    routingTable->addRoute(route);
    if (nextHop == dest)
        EV_INFO << "one-hop route to " << dest << " via itself" << endl;
    else
        EV_INFO << "route to " << dest << " via " << nextHop << endl;` + ccText.slice(end);

  if (/publishOneHopRoutes/.test(hText + ccText))
    throw new Error(`${PASS}: something still names publishOneHopRoutes after it was replaced.`);
  return tree.map((f) => (f === h ? { ...f, content: hText } : f === cc ? { ...f, content: ccText } : f));
}

/**
 * §6 item 1 (user, 2026-10-12, Q3 = a): the data packet's send unicasts to its
 * packet next hop, as MintRoute.cc:296-306 forwards a sensing packet -- the next
 * hop's MAC through ARP, and a hop it cannot resolve throws. Only the data send:
 * only the data transmit (`_fwd`) stamps a next hop, and control packets stay
 * broadcast (D8). `pktNextHop` is partial, so a packet outside its domain has no
 * next hop and goes out as a broadcast. Compiled and never run in v4: nothing
 * creates a data packet (D10).
 */
export function installUnicast(tree: GeneratedTree, cls: string, dataType: string): GeneratedTree {
  const PASS = "installUnicast";
  const cc = implOf(tree);
  if (!cc) throw new Error(`${PASS}: the module has no .cc.`);
  const sig = `void ${cls}::${broadcastMethodOf(dataType)}(Node x, PktId pkt) {`;
  const at = mustFind(cc.content, sig, `${PASS} (${broadcastMethodOf(dataType)})`);
  const end = cc.content.indexOf("\n}\n", at);
  const body = mustReplace(cc.content.slice(at, end),
    "    setDownControlInfo(packet, MacAddress::BROADCAST_ADDRESS);\n",
    "    // The packet next hop (D6): BROADCAST, or the one neighbour a route chose,\n"
    + "    // unicast to its MAC address as MintRoute.cc:296-306 forwards a packet.\n"
    + "    MacAddress nextHopMac = MacAddress::BROADCAST_ADDRESS;\n"
    + "    if (live_pktNextHop.count(pkt) > 0 && chunk->getPktNextHop() != BROADCAST) {\n"
    + "        nextHopMac = arp->resolveL3Address(addressOfNode(chunk->getPktNextHop()), nullptr);\n"
    + "        if (nextHopMac.isUnspecified())\n"
    + `            throw cRuntimeError("${cls}: cannot resolve MAC for next hop %d -- configure GlobalArp", chunk->getPktNextHop());\n`
    + "    }\n"
    + "    setDownControlInfo(packet, nextHopMac);\n",
    `${PASS} (MAC address)`);
  const out = cc.content.slice(0, at) + body + cc.content.slice(end);
  return tree.map((f) => (f === cc ? { ...f, content: out } : f));
}

// ── Structure 4: the Route Table column's own classes (D2, step 3e) ──────────

/**
 * PRouteTable's members, derived (D2): the two node relations, the functions
 * keyed over them, and any declared subset of one (none since D15). In that
 * order, which is the order the class declares them.
 */
export function routeTableMembersOf(model: EncodedMachine, t: RouteTables): string[] {
  const relations = [t.neighbours, t.routes];
  const functions = pairKeyedVars(model).filter((v) => relations.includes(v.domain)).map((v) => v.name);
  const subsets = [...model.variableTypes].filter(([, ty]) =>
    relations.some((r) => new RegExp(`^\\s*\\w+\\s*⊆\\s*${r}\\s*$`).test(ty))).map(([v]) => v);
  return [...relations, ...functions, ...subsets];
}

/**
 * The route-table operations (D2): the events whose every variable, read or
 * written, is a PRouteTable member. ⚠ Reads count, which is what keeps
 * `add_newEntry` out: it writes only table members but reads the `updateNbrs`
 * queue. On structure 4's model this is `addEntry` alone (D15).
 */
export function routeTableOperationsOf(model: EncodedMachine, t: RouteTables): string[] {
  const members = new Set(routeTableMembersOf(model, t));
  return model.events.filter((e) => e.label !== "INITIALISATION").filter((e) => {
    const used = variablesUsedBy(e, model.variableTypes);
    return used.length > 0 && used.every((v) => members.has(v));
  }).map((e) => e.label);
}

/**
 * D2 for structure 4 (user, 2026-10-12, Q1 = a, Q2 = a): the Route Table column
 * gets its own classes, in the 4×4 spec's order, Specific → PRouteTable →
 * RouteTableBase → INET's IRoutingTable.
 *
 * - `RouteTableBase`: the INET binding -- the routing table, the learnt
 *   addresses, `addressOfNode` and `installRoute` (D4's name; `purgeRoutes` is
 *   not emitted, since nothing is withdrawn after D15).
 * - `PRouteTable : RouteTableBase`: the derived members and operations.
 * - The module inherits PRouteTable, so every event that uses a member reaches it
 *   by inheritance and its translated body does not change. What needs the module
 *   itself stays there: `publishRoutes()` (node id, interface, the module as each
 *   route's source) and `arp` (the arrival and the transmit).
 *
 * Moves only: every declaration and definition already exists, and each is
 * matched exactly once or the pass refuses.
 */
export function installRouteTableClasses(tree: GeneratedTree, cls: string, members: string[],
  ops: string[]): GeneratedTree {
  const PASS = "installRouteTableClasses";
  const h = headerOf(tree), cc = implOf(tree);
  if (!h || !cc) throw new Error(`${PASS}: the module is missing a .h or .cc.`);
  let hText = h.content;

  // Take one declaration out of the module class, verbatim; exactly one match.
  const take = (pattern: RegExp, what: string): string => {
    const all = [...hText.matchAll(new RegExp(pattern.source, "gm"))];
    if (all.length !== 1)
      throw new Error(`${PASS}: expected one declaration of ${what} in the header, found ${all.length}.`);
    hText = hText.replace(all[0][0], "");
    return all[0][0];
  };
  const decl = (name: string) => new RegExp(`^ {4}(?!\\/\\/)[^\\n(]*[\\s>]${name};[^\\n]*\\n`);
  const memberDecls = members.map((m) => take(decl(m), m));
  const opDecls = ops.map((op) => take(new RegExp(`^ {4}bool ${op}\\([^)]*\\);[^\\n]*\\n`), op));
  const baseDecls = [
    take(decl("routingTable"), "routingTable"),
    take(/^ {4}\/\/ Learnt at the arrival[^\n]*\n(?: {4}\/\/[^\n]*\n)*/, "nodeAddress's comment"),
    take(decl("nodeAddress"), "nodeAddress"),
    take(/^ {4}inet::L3Address addressOfNode\(Node n\);\n/, "addressOfNode"),
    take(/^ {4}void installRoute\([^;]*;\n/, "installRoute"),
  ];
  hText = mustReplace(hText,
    "    // ── PRouteTable → INET (route entries, and one-hop routes to neighbours) ──\n",
    "    // ── publishing PRouteTable into INET (D5): what needs the module itself ──\n",
    `${PASS} (.h comment)`);

  const classes = [
    "// ── The Route Table column (D2): RouteTableBase -> PRouteTable -> the module ──",
    "//",
    "// RouteTableBase is the INET binding: how the simulator sees the model's table.",
    "class RouteTableBase {",
    "  protected:",
    ...baseDecls.map((d) => d.replace(/\n$/, "")),
    "",
    "  public:",
    "    virtual ~RouteTableBase() = default;",
    "};",
    "",
    "// PRouteTable is the model's table: the node relations with a function keyed",
    "// over them, those functions, and the route-table operations, all derived (D2).",
    "// A Specific class changes route entries only through the operations (D1).",
    "class PRouteTable : public RouteTableBase {",
    "  protected:",
    ...memberDecls.map((d) => d.replace(/\n$/, "")),
    ...opDecls.map((d) => d.replace(/\n$/, "")),
    "};",
    "",
    "",
  ].join("\n");
  const moduleClass = `class ${cls} : public NetworkProtocolBase, public INetworkProtocol {`;
  hText = mustReplace(hText, moduleClass,
    classes + `class ${cls} : public NetworkProtocolBase, public INetworkProtocol, public PRouteTable {`,
    `${PASS} (module class)`);

  let ccText = cc.content;
  for (const op of ops)
    ccText = mustReplace(ccText, `bool ${cls}::${op}(`,
      `// Event-B: ${op} — the route-table operation (D1, D2): never scheduled; a Specific\n`
      + `// class calls it.\nbool PRouteTable::${op}(`, `${PASS} (${op})`);
  ccText = mustReplace(ccText, `inet::L3Address ${cls}::addressOfNode(`,
    "inet::L3Address RouteTableBase::addressOfNode(", `${PASS} (addressOfNode)`);
  ccText = mustReplace(ccText, `void ${cls}::installRoute(`, "void RouteTableBase::installRoute(",
    `${PASS} (installRoute)`);

  return tree.map((f) => (f === h ? { ...f, content: hText } : f === cc ? { ...f, content: ccText } : f));
}

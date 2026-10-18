import { describe, it, expect } from "vitest";
import { loadProject } from "../scripts/projects";
import { generateMerged } from "../src/engine/pipeline";
import { parseModel } from "../src/engine/parser";
import { flatten } from "../src/engine/flattener";
import { resolveEncodings } from "../src/engine/encodingResolver";
import { packetModelOf } from "../src/engine/packetModel";
import { patternExtensionFor } from "../src/engine/patternExtension";
import { networkRules, withRules } from "../src/engine/netPipeline";
import { translateEvent } from "../src/engine/ruleEngine";
import { carrierSetsOf } from "../src/engine/text";
import { MINTROUTE_LEAVES } from "../src/engine/baselineShell";

// Structure 4 = structure 3 plus the next-hop design (design/NextHop_Extension_Draft.md,
// user 2026-10-09: "name it v4"). Structures 1-3 stay frozen; everything the
// draft scoped to "structure 3 only" (O1) applies to structure 4 only.
//
// Each step of that design is pinned here as the EXACT difference it makes to
// structure 3's module, method by method, so a step that moves anything else
// fails.
//
// Step 3a (D9): the two data receptions. Step 3b (with D15): the packet next hop
// on the chunk, the route entries (`routeTbl`, `nextHop`), the data transmit split
// into `_bct`/`_fwd`, and the BROADCAST stamp on every creating event. The one
// route-table operation, `addEntry`, is NOT in the module: structure 4 carries
// events by role (creating, transmit, receive, enabling, drain), and an operation
// has none, so it enters with the table classes (§6 item 2).
const files = () => loadProject("AppLayer");
const byPath = (tree: { path: string; content: string }[]) =>
  Object.fromEntries(tree.map((f) => [f.path, f.content]));

// Each EbWsn method's body, overloads joined, keyed by name. A method ends at
// the first `}` in column 0, the emitter's own layout. ⚠ The destructor is left
// out on purpose: it is one line (`EbWsn::~EbWsn() { … }`), so a body read to
// the next column-0 `}` would swallow the method after it.
const methods = (cc: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const m of cc.matchAll(/^(?:[^\s#/][^\n]*?\s)?EbWsn::(\w+)\([^\n]*\n([\s\S]*?\n)\}\n/gm))
    out.set(m[1], [out.get(m[1]), m[2]].filter(Boolean).join("\n// overload\n"));
  return out;
};
// One method of another class in the module's .cc (the Route Table column's,
// step 3e), read the same way.
const classMethod = (cc: string, cls: string, name: string): string | undefined =>
  new RegExp(`^[^\\n]*\\b${cls}::${name}\\([^\\n]*\\n([\\s\\S]*?\\n)\\}\\n`, "m").exec(cc)?.[1];
const lines = (s: string) => new Set(s.split("\n"));
const added = (a: string, b: string) => [...lines(b)].filter((l) => !lines(a).has(l));
const removed = (a: string, b: string) => added(b, a);

const DATA_RECEPTIONS = ["receive_dataPkt", "receive_dup_dataPkt"];
const STAMP = [
  "    if (!(live_pktNextHop.count(pkt) == 0))",
  "    ensurePkt(pkt)->setPktNextHop(BROADCAST); live_pktNextHop.insert(pkt);",
];

describe("structure 4", () => {
  for (const routing of [undefined, "aodv"] as const) {
    describe(`routing: ${routing ?? "default (flooding)"}`, () => {
      const v3 = byPath(generateMerged(files(), undefined, 3, undefined, true, routing));
      const v4 = byPath(generateMerged(files(), undefined, 4, undefined, true, routing));
      const m3 = methods(v3["EbWsn.cc"]), m4 = methods(v4["EbWsn.cc"]);
      // The control creating events, named by this routing's leaves.
      const controlCreating = [...m4.keys()].filter((n) => /^create_\w+Pkt$/.test(n) && n !== "create_dataPkt");
      // This routing's control leaves (flooding: ROUTE, BEACON; AODV: RREQ, RREP,
      // RRER), each with its send method.
      const tags = controlCreating.map((n) => /^create_(\w+)Pkt$/.exec(n)![1].toUpperCase());
      const sendOf = (tag: string) => `send${tag[0]}${tag.slice(1).toLowerCase()}Broadcast`;
      const onReceiveOf = (tag: string) => `onReceive${tag[0]}${tag.slice(1).toLowerCase()}Pkt`;
      // D16: the baseline's leaves this routing has (flooding: BEACON, ROUTE;
      // AODV: none).
      const baselineLeaves = Object.entries(MINTROUTE_LEAVES)
        .filter(([tag]) => tags.includes(tag))
        .map(([tag, b]) => ({ ...b, send: sendOf(tag) }));
      // The order the shell lists the timed types in (timers, dispatch): the
      // table's first, in MintRoute's order, then the rest as the model has them.
      const order = [...Object.keys(MINTROUTE_LEAVES).filter((t) => tags.includes(t)),
        ...tags.filter((t) => !(t in MINTROUTE_LEAVES))];

      it("generates the same three files as structure 3", () => {
        expect(Object.keys(v4).sort()).toEqual(["EbWsn.cc", "EbWsn.h", "EbWsn.ned"]);
      });

      it("differs from structure 3 by exactly these methods", () => {
        expect(controlCreating.length).toBeGreaterThan(0);
        // add_newEntry and update_nbr leave under their Event-B names and come
        // back under MintRoute's (D16 piece 3).
        expect([...m3.keys()].filter((n) => !m4.has(n)).sort()).toEqual(
          ["add_newEntry", "publishOneHopRoutes", "runEnabledEvents", "start_tx_otherPkt",
            "try_start_tx_otherPkt", "update_nbr"]);
        expect([...m4.keys()].filter((n) => !m3.has(n)).sort()).toEqual(
          ["create_dataPkt", ...DATA_RECEPTIONS, "findOrCreateEntry", "newEntry",
            ...tags.map(onReceiveOf), "publishRoutes", "start_tx_dataPkt_bct", "start_tx_dataPkt_fwd",
            "try_start_tx_dataPkt_bct", "try_start_tx_dataPkt_fwd", "updateNbrCounters"].sort());
        // Every control leaf's send gains a no-argument overload (D16 piece 2);
        // finish changes only where the table has the routing's leaves (piece 1).
        expect([...m4.keys()].filter((n) => m3.has(n) && m3.get(n) !== m4.get(n)).sort()).toEqual(
          ["EbWsn", "handleLowerPacket", "handleSelfMessage", "initialize", "runDeliveryEvents",
            "sendDataBroadcast", ...controlCreating, ...tags.map(sendOf),
            ...(baselineLeaves.length ? ["finish"] : [])].sort());
      });

      // 2026-10-18 (user: "q1 a"): a reception is counted before the rebroadcast
      // re-stamps the packet. Appended after every delivery event, update_nbr ran
      // after start_tx, which overwrites the forwarder and link sequence number it
      // reads, so a neighbour's first frame was never counted (measured: first
      // counted sequence number 2 on 28 of 28 links). See drainSlotOf.
      it("counts a reception before the rebroadcast: the drains right after the receive events", () => {
        const at = (body: string, s: string) => {
          const i = body.indexOf(s);
          expect(i, s).toBeGreaterThanOrEqual(0);
          return i;
        };
        const r4 = m4.get("runDeliveryEvents")!, r3 = m3.get("runDeliveryEvents")!;
        const add4 = at(r4, "// add_newEntry -- run by the reception");
        const upd4 = at(r4, "// update_nbr -- run by the reception");
        expect(at(r4, "if (try_receive_dup_controlPkt()) _any = true;")).toBeLessThan(add4);
        expect(add4).toBeLessThan(upd4);
        for (const later of ["try_send_down()", "try_fwdr_receive_pkt()", "try_final_tx_pkt()",
          "try_start_tx_controlPkt()"])
          expect(at(r4, later), later).toBeGreaterThan(upd4);
        // Structure 3 keeps its round as measured (O1): the drains last.
        expect(at(r3, "// update_nbr -- run by the reception")).toBeGreaterThan(at(r3, "try_start_tx_controlPkt()"));
        // The move is the whole change: the same lines, in another order.
        expect(r4.split("\n").filter((l) => /^\s+if \(try_\w+\(\)\) _any = true;$/.test(l)).sort())
          .toEqual(r3.split("\n").filter((l) => /^\s+if \(try_\w+\(\)\) _any = true;$/.test(l))
            .map((l) => l.replace("try_start_tx_otherPkt", "try_start_tx_dataPkt_bct")).concat(
              ["        if (try_start_tx_dataPkt_fwd()) _any = true;"]).sort());
      });

      // D16 piece 2 (user, 2026-10-12, Q1 = a, Q2 = a): one timer per packet
      // type, every node arming every one, handleSelfMessage in MintRoute's shape
      // (MintRoute.cc:113-128), the hooks and the route first fire from the table.
      it("D16: one timer per packet type, armed on every node, in the baseline's handleSelfMessage", () => {
        const lt = (t: string) => t.toLowerCase();
        expect(order.length).toBe(tags.length);
        for (const t of order) {
          expect(v4["EbWsn.h"]).toContain(`    double ${lt(t)}FloodsInterval = 0.0;`);
          expect(v4["EbWsn.h"]).toContain(`    cMessage *${lt(t)}FloodTimer = nullptr;`);
          expect(v4["EbWsn.ned"]).toContain(`        double ${lt(t)}FloodsInterval @unit(s) = default(5s);`);
          // The timer's send: the model creates, the delivery events transmit.
          expect(m4.get(sendOf(t))).toContain(`    try_create_${lt(t)}Pkt();\n    runDeliveryEvents();\n`);
          expect(m4.get("initialize")).toContain(MINTROUTE_LEAVES[t]?.sinkFirst
            ? "            simtime_t firstRoute = uniform(0.000003, 0.000009) + (myNetwAddr == sinkAddress ? 1.0 : 5.0);\n"
              + `            scheduleAfter(firstRoute, ${lt(t)}FloodTimer);\n`
            : `        if (${lt(t)}FloodsInterval > 0)\n`
              + `            scheduleAfter(uniform(0.1, 0.9) + ${lt(t)}FloodsInterval, ${lt(t)}FloodTimer);\n`);
        }
        expect(m4.get("handleSelfMessage")).toBe(
          order.map((t, i) => `    ${i ? "else if" : "if"} (msg->getKind() == SEND_${t}_FLOOD_TIMER) {\n`
            + (MINTROUTE_LEAVES[t]?.hooks ? "        updateNeighborTable();\n        chooseParent();\n" : "")
            + `        ${sendOf(t)}();\n        scheduleAfter(${lt(t)}FloodsInterval, ${lt(t)}FloodTimer);\n    }\n`)
            .join("")
          + "    else {\n        EV_WARN << \"EbWsn: unexpected self message kind \" << msg->getKind() << endl;\n"
          + "        delete msg;\n    }\n");
        // The hooks exist only where the table puts them (flooding's ROUTE).
        const hooks = order.some((t) => MINTROUTE_LEAVES[t]?.hooks);
        for (const decl of ["    virtual void updateNeighborTable() {}", "    virtual void chooseParent() {}"])
          expect(v4["EbWsn.h"].includes(decl)).toBe(hooks);
        // The single model timer is gone, and so is the scheduler only it called.
        for (const f of Object.values(v4))
          for (const gone of ["modelTimer", "tickInterval", "MODEL_TICK", "runEnabledEvents"])
            expect(f).not.toContain(gone);
        expect(removed(m3.get("initialize")!, m4.get("initialize")!)
          .filter((l) => !/routingTable|arp\.reference/.test(l)).sort()).toEqual([
          "        tickInterval = par(\"tickInterval\");",
          "        modelTimer = new cMessage(\"eb-model-tick\", MODEL_TICK);",
          "        // Spread the first tick so every node does not transmit at once,",
          "        // exactly as MintRoute spreads its first beacon flood.",
          "        scheduleAfter(uniform(0.1, 0.9) + tickInterval, modelTimer);",
        ].sort());
      });

      // D16 piece 1 (user, 2026-10-12): the baseline's control counters, reset
      // and recorded as MintRoute does (MintRoute.cc:48, 62-63, 150, 193, 614-619).
      it("D16: the baseline's counters, incremented after each send and recorded under `stats`", () => {
        if (baselineLeaves.length === 0) {
          // No leaf of this routing is in the table: nothing is added at all.
          for (const t of [v4["EbWsn.h"], v4["EbWsn.cc"], v4["EbWsn.ned"]]) expect(t).not.toMatch(/\bstats\b/);
          expect(m4.get("finish")).toBe(m3.get("finish"));
          return;
        }
        expect(baselineLeaves.map((b) => b.sent)).toEqual(["nbBeaconsSent", "nbRouteFloodsSent"]);
        // Every counter, in MintRoute's finish() order (:618-620).
        const counters = baselineLeaves.flatMap((b) => (b.received ? [b.sent, b.received] : [b.sent]));
        expect(counters).toEqual(["nbBeaconsSent", "nbRouteFloodsSent", "nbRouteFloodsReceived"]);
        expect(added(v3["EbWsn.h"], v4["EbWsn.h"])).toEqual(expect.arrayContaining(
          ["    bool stats = true;", ...counters.map((c) => `    long ${c} = 0;`)]));
        expect(added(m3.get("initialize")!, m4.get("initialize")!)).toEqual(expect.arrayContaining(
          ["        stats = par(\"stats\");", ...counters.map((c) => `        ${c} = 0;`)]));
        for (const b of baselineLeaves) {
          // Beside the no-argument overload (piece 2) and the length in bits
          // (pinned in its own test below), the transmit gains only the count.
          expect(added(m3.get(b.send)!, m4.get(b.send)!)
            .filter((l) => !/try_create_|runDeliveryEvents|overload|setChunkLength/.test(l)))
            .toEqual([`    ${b.sent}++;`]);
          expect(m4.get(b.send)).toContain(`    sendDown(packet);\n    ${b.sent}++;\n`);
        }
        expect(added(m3.get("finish")!, m4.get("finish")!)).toEqual([
          "    if (stats) {",
          ...counters.map((c) => `        recordScalar("${c}", ${c});`),
          "    }"]);
        expect(added(v3["EbWsn.ned"], v4["EbWsn.ned"])).toContain("        bool stats = default(true);");
      });

      // D16 piece 3 (user, 2026-10-12, Q1 = a, Q2 = a): the receive side under
      // MintRoute's names (MintRoute.cc:196-247, 373, 552, 568), the drains still
      // inside the delivery fixpoint (the 2026-09-27 leak fix).
      it("D16: the receive side, dispatched by type, with the drains under MintRoute's names", () => {
        // A rename and nothing else: each body is the Event-B event's, unchanged.
        expect(m4.get("newEntry")).toBe(m3.get("add_newEntry"));
        expect(m4.get("updateNbrCounters")).toBe(m3.get("update_nbr"));
        expect(v4["EbWsn.cc"]).toContain(
          "// Event-B: add_newEntry — emitted under MintRoute's name for it (MintRoute.cc:568).\n"
          + "bool EbWsn::newEntry(Node x, Node y) {");
        expect(v4["EbWsn.cc"]).toContain(
          "// Event-B: update_nbr — emitted under MintRoute's name for it (MintRoute.cc:373).\n"
          + "bool EbWsn::updateNbrCounters(");
        // The binding loop, lifted out of the fixpoint and called from it.
        expect(m4.get("findOrCreateEntry")).toContain(
          "    if (newEntry(x, y)) { firedCount[\"add_newEntry\"]++; return true; }\n");
        const drain = m4.get("runDeliveryEvents")!;
        expect(drain).toContain("        if (findOrCreateEntry()) _any = true;\n");
        expect(drain).toContain("if (updateNbrCounters(x, y, sNo, delta, pkt)) { firedCount[\"update_nbr\"]++;");
        expect(drain).not.toMatch(/\b(add_newEntry|update_nbr)\(/);
        // The arrival ends in MintRoute's dispatch: one case per timed type.
        expect(m4.get("handleLowerPacket")).toContain(
          "    switch (_wire->getType()) {\n"
          + order.map((t) => `        case PktType::${t}:\n            ${onReceiveOf(t)}(packet, _wire);\n`
            + "            break;\n").join("")
          + "        default:\n            runDeliveryEvents();\n            delete packet;\n            break;\n    }\n");
        for (const t of tags) {
          const received = MINTROUTE_LEAVES[t]?.received;
          expect(m4.get(onReceiveOf(t))).toBe(
            "    runDeliveryEvents();\n" + (received ? `    ${received}++;\n` : "") + "    delete packet;\n");
        }
      });

      it("§4.1: each control creating event gains exactly the BROADCAST stamp", () => {
        for (const n of controlCreating) {
          expect(added(m3.get(n)!, m4.get(n)!)).toEqual(STAMP);
          expect(removed(m3.get(n)!, m4.get(n)!)).toEqual([]);
        }
      });

      it("D15: the route entries are a set of node pairs with a next hop per entry, cleared at construction", () => {
        expect(v4["EbWsn.h"]).toContain("    std::set<std::pair<Node, Node>> routeTbl;");
        expect(v4["EbWsn.h"]).toMatch(/^ {4}std::map<std::pair<Node, Node>, Node> nextHop;/m);
        expect(added(m3.get("EbWsn")!, m4.get("EbWsn")!)).toEqual(
          ["    routeTbl.clear();", "    nextHop.clear();"]);
        expect(v4["EbWsn.h"]).not.toContain("validRoutes");
      });

      it("D15: the data transmit splits on routeTbl, and _fwd is scheduled once addEntry can fill it", () => {
        const bct = m4.get("start_tx_dataPkt_bct")!, fwd = m4.get("start_tx_dataPkt_fwd")!;
        expect(bct).toContain("if (!(routeTbl.count({x, d}) == 0))");
        expect(bct).toContain("ensurePkt(pkt)->setPktNextHop(BROADCAST); live_pktNextHop.insert(pkt);");
        expect(fwd).toContain("if (!(routeTbl.count({x, d}) > 0))");
        expect(fwd).toContain("(nextHop.count({x, d}) > 0 && nh == nextHop.at({x, d}))");
        expect(fwd).toContain("ensurePkt(pkt)->setPktNextHop(nh); live_pktNextHop.insert(pkt);");
        // addEntry is in the module from step 3e and counts as running (§6 item
        // 2), so routeTbl has a filler and _fwd is scheduled. It never fires in
        // v4: no data packet exists (D10).
        expect(v4["EbWsn.h"]).not.toContain("// not scheduled: start_tx_dataPkt_fwd");
        expect(m4.get("runDeliveryEvents")).toContain("if (try_start_tx_dataPkt_fwd()) _any = true;");
      });

      it("D9: both data receptions are emitted and reported as not scheduled until DATA exists", () => {
        for (const m of DATA_RECEPTIONS)
          expect(v4["EbWsn.h"]).toContain(
            `// not scheduled: ${m} -- nothing that runs ever creates a DATA packet`);
      });

      it("the arrival carries the packet next hop off the wire", () => {
        const a = added(m3.get("handleLowerPacket")!, m4.get("handleLowerPacket")!);
        expect(a).toContain("    _local->setPktNextHop(_wire->getPktNextHop());");
        expect(a).toContain("    live_pktNextHop.insert(_pkt);");
      });

      // D5 (step 3d, user 2026-10-12: Q1 = a, Q2 = b): structure 4 publishes its
      // route entries and its neighbours. Until 3d routeTableOf saw two tables and
      // refused, so structure 4 published nothing.
      it("D5: publishes route entries over one-hop routes, reconciled at the end of the delivery events", () => {
        // The table wiring is structure 3's, with ARP now required, as in the
        // baseline (MintRoute.cc:39): the unicast branch needs it.
        expect(v4["EbWsn.h"]).toContain("    inet::ModuleRefByPar<inet::IRoutingTable> routingTable;");
        expect(m4.get("initialize")).toContain("        routingTable.reference(this, \"routingTableModule\", true);");
        expect(m4.get("initialize")).toContain("        arp.reference(this, \"arpModule\", true);");
        expect(m3.get("initialize")).toContain("        arp.reference(this, \"arpModule\", false);");
        // The .ned is structure 3's, table included, plus D16's lines.
        expect(added(v3["EbWsn.ned"], v4["EbWsn.ned"])
          .filter((l) => !/\bstats\b|FloodsInterval|^\s*\/\//.test(l))).toEqual([]);
        expect(removed(v3["EbWsn.ned"], v4["EbWsn.ned"])
          .filter((l) => !/tickInterval|^\s*\/\//.test(l))).toEqual([]);
        // One publisher for both tables, called once: at the end of the delivery
        // events, which every arrival and every timer runs (Q1 = a).
        expect(v4["EbWsn.cc"]).not.toContain("publishOneHopRoutes");
        expect(m4.get("runDeliveryEvents")).toMatch(/ {4}publishRoutes\(\);\n {4}return fired;\n$/);
        expect(v4["EbWsn.cc"].match(/publishRoutes\(\);/g)).toHaveLength(1);
        const pub = m4.get("publishRoutes")!;
        // Route entries first, so an entry takes the place of a one-hop route to
        // the same destination.
        expect(pub.indexOf("for (const auto& e : routeTbl)"))
          .toBeLessThan(pub.indexOf("for (const auto& e : neighbourTbl)"));
        expect(pub).toContain("if (e.first == myNodeId && nextHop.count(e) > 0) via[e.second] = nextHop.at(e);");
        expect(pub).toContain("if (e.first == myNodeId && via.count(e.second) == 0) via[e.second] = e.second;");
        expect(pub).toContain("int metric = dv.second == dv.first ? 1 : 2;");   // Q2 = b
        expect(pub).toContain("        installRoute(this, out, dest, gw, metric);\n");
        // One route, created or brought up to date (RouteTableBase since 3e): a
        // changed next hop is updated in place; nothing is withdrawn (D15).
        const install = classMethod(v4["EbWsn.cc"], "RouteTableBase", "installRoute")!;
        expect(install).toContain("            r->setNextHop(nextHop);\n");
        expect(install).not.toMatch(/deleteRoute|removeRoute/);
        // An unheard destination is addressed through its node module, with no
        // special case for a sink (Q3 = a: a model's Sink is known by name).
        const addressOf = classMethod(v4["EbWsn.cc"], "RouteTableBase", "addressOfNode")!;
        expect(addressOf).toContain(
          "    return inet::L3AddressResolver().addressOf(host, inet::L3AddressResolver::ADDR_MODULEPATH);\n");
        expect(addressOf).not.toContain("sinkAddress");
      });

      // D2 (step 3e, user 2026-10-12: Q1 = a, Q2 = a): the Route Table column's
      // own classes, RouteTableBase -> PRouteTable -> the module.
      it("D2: PRouteTable holds the derived members and addEntry, RouteTableBase the INET binding", () => {
        const h = v4["EbWsn.h"];
        const base = h.slice(h.indexOf("class RouteTableBase {"), h.indexOf("class PRouteTable "));
        const table = h.slice(h.indexOf("class PRouteTable "), h.indexOf("class EbWsn "));
        const module = h.slice(h.indexOf("class EbWsn "));
        expect(h).toContain("class PRouteTable : public RouteTableBase {");
        // Virtually (Q14 = b, 2026-10-13): a Specific class's own table class that
        // also inherits PRouteTable virtually shares this one table. A plain base
        // gives the Specific module two tables, one never filled.
        expect(h).toContain(
          "class EbWsn : public NetworkProtocolBase, public INetworkProtocol, public virtual PRouteTable {");
        expect(h).not.toMatch(/public PRouteTable \{/);
        // The members D2 derives, and only there.
        for (const m of ["neighbourTbl", "routeTbl", "nextHop", "lastSeqno", "missed", "received"]) {
          expect(table).toMatch(new RegExp(`^ {4}[^\\n(]*[\\s>]${m};`, "m"));
          expect(module).not.toMatch(new RegExp(`^ {4}[^\\n(/]*[\\s>]${m};`, "m"));
        }
        expect(table).toContain("    bool addEntry(Node x, Node d, Node nh);");
        // The INET binding; no purgeRoutes, since nothing is withdrawn (Q2 = a).
        for (const d of ["inet::ModuleRefByPar<inet::IRoutingTable> routingTable;",
          "std::map<Node, inet::L3Address> nodeAddress;", "inet::L3Address addressOfNode(Node n);",
          "void installRoute(cObject *source, inet::NetworkInterface *out,"])
          expect(base).toContain(d);
        expect(h + v4["EbWsn.cc"]).not.toContain("purgeRoutes");
        // What needs the module stays there: arp, and publishRoutes.
        expect(module).toContain("inet::ModuleRefByPar<inet::IArp> arp;");
        expect(module).toContain("    void publishRoutes();");
        // addEntry: carried by D2's rule, translated, never scheduled (D1).
        expect(classMethod(v4["EbWsn.cc"], "PRouteTable", "addEntry")).toBe(
          "    if (!(neighbourTbl.count({x, nh}) > 0))\n        return false;\n"
          + "    routeTbl.insert({x, d});\n    nextHop[{x, d}] = nh;\n    return true;\n");
        expect(h).toContain(
          "// not scheduled: addEntry -- a route-table operation: never scheduled, a Specific class calls it (D1)");
        expect(v4["EbWsn.cc"]).not.toContain("try_addEntry");
        // The events that use the tables but read the queue stay in the module.
        for (const m of ["newEntry", "updateNbrCounters"]) expect(m4.has(m)).toBe(true);
      });

      // §6 item 1 (Q3 = a): the data send unicasts to the packet next hop; the
      // control sends stay broadcast (D8). Compiled, never run: no DATA (D10).
      it("§6 item 1: only the data send can unicast, to its next hop's MAC through ARP", () => {
        const data = m4.get("sendDataBroadcast")!;
        expect(data).toContain(
          "    if (live_pktNextHop.count(pkt) > 0 && chunk->getPktNextHop() != BROADCAST) {\n"
          + "        nextHopMac = arp->resolveL3Address(addressOfNode(chunk->getPktNextHop()), nullptr);\n");
        expect(data).toContain("    setDownControlInfo(packet, nextHopMac);\n");
        expect(data).not.toContain("setDownControlInfo(packet, MacAddress::BROADCAST_ADDRESS);");
        for (const t of tags)
          expect(m4.get(sendOf(t))).toContain("setDownControlInfo(packet, MacAddress::BROADCAST_ADDRESS);");
      });

      // The frame size (user, 2026-10-13, Q1 = a): the shell declares
      // `headerLength @unit(b)`, and structure 4 applies it in bits, as INET's
      // Flooding does. Structure 3 keeps the baseline's bytes (O1), so a
      // configured 80b is a 10-byte frame here and an 80-byte frame there.
      it("applies the frame length in the unit the shell declares, bits; structure 3 keeps bytes", () => {
        expect(v4["EbWsn.ned"]).toContain("        int headerLength @unit(b) = default(96b);");
        const sends = ["sendDataBroadcast", ...tags.map(sendOf)];
        for (const s of sends) {
          expect(m4.get(s)).toContain("    chunk->setChunkLength(b(headerLength));\n");
          expect(m3.get(s)).toContain("    chunk->setChunkLength(B(headerLength));\n");
          // The length is the one line a control send loses; the data send also
          // lost its broadcast address in step 3d (§6 item 1).
          const gone = removed(m3.get(s)!, m4.get(s)!);
          expect(s === "sendDataBroadcast" ? gone.filter((l) => /setChunkLength/.test(l)) : gone)
            .toEqual(["    chunk->setChunkLength(B(headerLength));"]);
        }
        // Every length in the module, and only those.
        expect(v4["EbWsn.cc"].match(/setChunkLength\(b\(headerLength\)\)/g)?.length).toBe(sends.length);
        expect(v4["EbWsn.cc"]).not.toContain("B(headerLength)");
      });

      it("adds no untranslated clause, and only the one route-table operation D15 kept", () => {
        const untranslated = (t: Record<string, string>) =>
          (Object.values(t).join("\n").match(/UNTRANSLATED/g) ?? []).length;
        expect(untranslated(v4)).toBe(untranslated(v3));
        // addEntry since step 3e, in PRouteTable; the two D15 dropped, nowhere.
        expect(v4["EbWsn.cc"]).toContain("bool PRouteTable::addEntry(");
        for (const op of ["invalidateEntry", "removeEntry"])
          expect(v4["EbWsn.h"] + v4["EbWsn.cc"]).not.toContain(op);
      });
    });
  }

  // addEntry is not in the module (see the top of this file), so its translation
  // is checked directly: the bundled uM6 flattened, with the module's own rule list.
  it("D15: addEntry translates fully, as create-or-update", () => {
    const base = loadProject("AppLayer");
    const ext = patternExtensionFor(base, "pM3", undefined, true);
    const pRaw = parseModel(ext.files);
    const model = resolveEncodings(flatten(pRaw, ext.machine));
    const pm = packetModelOf(pRaw, ext.machine)!;
    const rules = networkRules(model, pm, carrierSetsOf(parseModel(base), pRaw));
    const add = model.events.find((e) => e.label === "addEntry")!;
    const t = withRules(rules, () => translateEvent(add, model));
    expect(t.parameters).toEqual(["x", "d", "nh"]);
    expect(t.guards).toEqual(["neighbourTbl.count({x, nh}) > 0"]);
    // One assignment on the pair key: a second call for the same x ↦ d changes
    // the next hop rather than adding a second one.
    expect(t.actions).toEqual(["routeTbl.insert({x, d});", "nextHop[{x, d}] = nh;"]);
    expect(t.untranslatedGuards).toEqual([]);
    expect(t.untranslatedActions).toEqual([]);
  });

  // Q3 = a (step 3e, user 2026-10-12): in a model with a Sink constant the sink's
  // node id is that constant, not its module id, so addressOfNode could not find
  // it through the module (getModule(0) is nullptr; another value would find an
  // unrelated module). Its address is recorded by name at initialisation instead.
  // No project on disk that reaches structure 4 has a Sink, so this one feeds
  // C0_project one more context declaring it, as v3_flood's C2_sink.buc once did.
  it("Q3: a model's Sink is known by name at initialisation, so addressOfNode has no special case", () => {
    const sinkCtx = {
      name: "C2_sink.buc",
      xml: '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<org.eventb.core.contextFile org.eventb.core.configuration="org.eventb.core.fwd" version="3">\n'
        + '   <org.eventb.core.extendsContext name="ext1" org.eventb.core.target="C0"/>\n'
        + '   <org.eventb.core.constant name="cst1" org.eventb.core.identifier="Sink"/>\n'
        + '   <org.eventb.core.axiom name="axm1" org.eventb.core.label="axm_sink_1" org.eventb.core.predicate="Sink ∈ ND" org.eventb.core.theorem="false"/>\n'
        + '   <org.eventb.core.axiom name="axm2" org.eventb.core.label="axm_sink_2" org.eventb.core.predicate="Sink = 0" org.eventb.core.theorem="false"/>\n'
        + '</org.eventb.core.contextFile>\n',
    };
    const v4 = byPath(generateMerged([...files(), sinkCtx], undefined, 4));
    const init = methods(v4["EbWsn.cc"]).get("initialize")!;
    // The binding that makes it necessary, and the record that answers it.
    expect(init).toContain("myNodeId = isSink ? Sink : getContainingNode(this)->getId();");
    expect(init).toContain(
      "            sinkAddress = addressResolver.resolve(sinkStr);\n"
      + "        // The sink's node id is the model's Sink, not its module id, so its\n"
      + "        // address is known by name rather than looked up through the module.\n"
      + "        if (!sinkAddress.isUnspecified())\n"
      + "            nodeAddress[Sink] = sinkAddress;\n");
    expect(classMethod(v4["EbWsn.cc"], "RouteTableBase", "addressOfNode")).not.toContain("sinkAddress");
    // And without a Sink there is no such record.
    expect(byPath(generateMerged(files(), undefined, 4))["EbWsn.cc"]).not.toContain("nodeAddress[Sink]");
  });

  it("still refuses a routing outside the structures that carry the pattern", () => {
    expect(() => generateMerged(files(), undefined, 2, undefined, true, "aodv"))
      .toThrow(/structure 3 or 4/);
  });
});

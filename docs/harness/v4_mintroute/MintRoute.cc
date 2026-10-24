// MintRoute -- see MintRoute.h. HAND-WRITTEN case-study code.
//
// Each function is MintRoute.cc's of the same name (this project's INET port),
// with its line numbers, changed only where structure 4 differs:
//   - node ids (ints) where the baseline has L3Addresses, BROADCAST for "none";
//   - the link counts are the model's (PRouteTable's received / lastSeqno,
//     read, never reset; Q5 = a), where the baseline counts its own;
//   - the parent also goes into the model's route table (addEntry, Q11 = a).

#include "MintRoute.h"

#include <cmath>
#include <filesystem>
#include <fstream>
#include <sstream>

#include "inet/common/geometry/common/CanvasProjection.h"
#include "inet/mobility/contract/IMobility.h"

Define_Module(MintRoute);

using eb_ebwsn::Node;
using eb_ebwsn::PktId;
using eb_ebwsn::PPkt;
using eb_ebwsn::BROADCAST;

void MintRoute::initialize(int stage)
{
    EbWsn::initialize(stage);

    if (stage == INITSTAGE_LOCAL) {
        // MintRoute.cc:43-46, 54-57
        alpha                = par("alpha");
        linkQtyThreshold     = par("linkQtyThreshold");
        estimateToRouteRatio = par("estimateToRouteRatio");
        switchThreshold      = par("switchThreshold");

        gbCurrentHopCount    = ROUTE_INVALID_INT;
        gbCurrentCost        = ROUTE_INVALID_INT;
        gwEstTicks           = 0;
        gpCurrentParent      = BROADCAST;
    }
    else if (stage == INITSTAGE_NETWORK_LAYER) {
        // EbWsn's own NETWORK_LAYER stage has run: myNetwAddr, sinkAddress and
        // myNodeId are set. The baseline requires a sink (MintRoute.ned:28).
        const char *sinkName = par("sinkAddress");
        if (!sinkName || !sinkName[0])
            throw cRuntimeError("MintRoute: sinkAddress is required");
        cModule *sinkHost = getContainingNode(this)->getParentModule()->getSubmodule(sinkName);
        if (sinkHost == nullptr)
            throw cRuntimeError("MintRoute: no node named '%s'", sinkName);
        sinkNode = sinkHost->getId();   // a node id is its node module's id
        isSink = myNetwAddr == sinkAddress;

        // The sink is its own root (MintRoute.cc:93-103).
        if (myNetwAddr == sinkAddress) {
            gpCurrentParent   = myNodeId;
            gbCurrentHopCount = 0;
            gbCurrentCost     = 0;
            TableEntry& base = neighborTbl[myNodeId];
            base.id = myNodeId;
            base.parent = myNodeId;
            base.flags = NBRFLAG_VALID;
            base.hop = 0;
        }
    }
}

// MintRoute.cc:417-426
void MintRoute::updateNeighborTable()
{
    gwEstTicks = (gwEstTicks + 1) % estimateToRouteRatio;
    if (gwEstTicks != 0) return;

    for (auto& kv : neighborTbl) {
        if (kv.second.flags & NBRFLAG_VALID)
            updateEst(kv.second);
    }
}

// MintRoute.cc:428-454. The baseline counts frames in the entry and zeroes the
// counts here; structure 4's model counts them (update_nbr, emitted as
// updateNbrCounters): received = frames heard from the neighbour, lastSeqno =
// the neighbour's link sequence number on the last one. Their growth since the
// last estimate is this window's received, and received + missed (Q5 = a).
void MintRoute::updateEst(TableEntry& nbr)
{
    std::pair<Node, Node> link{myNodeId, nbr.id};   // PRouteTable's key: me ↦ nb
    int rcvd = received.count(link) > 0 ? received.at(link) : 0;
    int seq  = lastSeqno.count(link) > 0 ? lastSeqno.at(link) : 0;
    nbr.received = rcvd - nbr.receivedAtEst;
    nbr.missed = (seq - nbr.lastSeqnoAtEst) - nbr.received;
    nbr.receivedAtEst = rcvd;
    nbr.lastSeqnoAtEst = seq;

    int usExpTotal = estimateToRouteRatio;
    int usActTotal = nbr.received + nbr.missed;
    if (usActTotal < usExpTotal) usActTotal = usExpTotal;

    int newAve = (255 * nbr.received) / usActTotal;

    if (nbr.liveliness == 0)
        nbr.sendEst >>= 1;
    else
        nbr.liveliness--;

    if (nbr.flags & NBRFLAG_EST_INIT) {
        int blended = (int)((double)nbr.receiveEst * (1.0 - alpha) + (double)newAve * alpha);
        nbr.receiveEst = blended;
    }
    else {
        nbr.receiveEst = newAve;
        nbr.flags |= NBRFLAG_EST_INIT;
    }

    if (nbr.childLiveliness > 0) nbr.childLiveliness--;
}

// MintRoute.cc:456-507, then the parent into the model's route table (Q11).
void MintRoute::chooseParent()
{
    if (myNetwAddr == sinkAddress) return;

    TableEntry *pNewParent = nullptr;
    TableEntry *pOldParent = nullptr;
    int ulMinTotalCost = ROUTE_INVALID_INT;
    int oldParentCost = ROUTE_INVALID_INT;

    for (auto& kv : neighborTbl) {
        TableEntry& nbr = kv.second;
        if (!(nbr.flags & NBRFLAG_VALID)) continue;
        if (nbr.parent == myNodeId) continue;
        if (nbr.hop == ROUTE_INVALID_INT) continue;
        if (nbr.cost == ROUTE_INVALID_INT) continue;
        if (nbr.sendEst < linkQtyThreshold || nbr.receiveEst < linkQtyThreshold) continue;
        if (nbr.childLiveliness > 0) continue;

        int totalCost = evaluateCost(nbr.cost, nbr.sendEst, nbr.receiveEst);

        if (gpCurrentParent != BROADCAST && nbr.id == gpCurrentParent) {
            pOldParent = &nbr;
            oldParentCost = totalCost;
            continue;
        }

        if (totalCost < ulMinTotalCost) {
            ulMinTotalCost = totalCost;
            pNewParent = &nbr;
        }
    }

    if (pNewParent == nullptr) {
        pNewParent = pOldParent;
        ulMinTotalCost = oldParentCost;
    }
    else if (pOldParent != nullptr && oldParentCost < switchThreshold + ulMinTotalCost) {
        pNewParent = pOldParent;
        ulMinTotalCost = oldParentCost;
    }

    Node before = gpCurrentParent;
    if (pNewParent != nullptr) {
        gpCurrentParent   = pNewParent->id;
        gbCurrentHopCount = pNewParent->hop + 1;
        gbCurrentCost     = ulMinTotalCost >> 6;
    }
    else {
        gpCurrentParent   = BROADCAST;
        gbCurrentHopCount = ROUTE_INVALID_INT;
        gbCurrentCost     = ROUTE_INVALID_INT;
    }

    if (gpCurrentParent != before) {
        if (before != BROADCAST && gpCurrentParent != BROADCAST) parentChanges++;
        if (firstParentAt < SIMTIME_ZERO && gpCurrentParent != BROADCAST) firstParentAt = simTime();
        cModule *p = gpCurrentParent == BROADCAST ? nullptr : getSimulation()->getModule(gpCurrentParent);
        EV_INFO << "MintRoute: parent of " << getContainingNode(this)->getFullName() << " -> "
                << (p ? p->getFullName() : "none") << " (cost " << gbCurrentCost
                << ", hop " << gbCurrentHopCount << ")" << endl;
        drawParentArrow();
    }
    // The route to the sink is through the parent: the model's own route-table
    // operation records it (create or update in place, D15), and publishRoutes
    // shows it in INET's table at the end of this timer's delivery round.
    if (gpCurrentParent != BROADCAST) {
        addEntryCalls++;
        if (!addEntry(myNodeId, sinkNode, gpCurrentParent))
            addEntryRefused++;
    }
}

// MintRoute.cc:509-517
int MintRoute::evaluateCost(int cost, int sendEst, int receiveEst) const
{
    int transEst = sendEst * receiveEst;
    int immed = (1 << 24);
    if (transEst == 0) return (1 << 16);
    immed = immed / transEst;
    immed += (cost << 6);
    return immed;
}

// The generated EbWsn::sendRouteBroadcast(Node, PktId), copied (Q2 = a), with the
// route fields MintRoute.cc:163-188 puts on its ROUTE packet. ⚠ loop.sh refuses to
// build if the generated body differs from this one apart from the chunk's class
// and the block marked [MintRoute].
void MintRoute::sendRouteBroadcast(Node x, PktId pkt)
{
    PPkt *held = pktOf(pkt);
    if (held == nullptr) return;
    auto chunk = makeShared<MintRoutePkt>(*held);
    chunk->setFwdrAddr(x);
    chunk->setChunkLength(b(headerLength));
    // ---- [MintRoute] the route fields (MintRoute.cc:163, :169-188) ----
    chunk->setHopCount(gbCurrentHopCount);
    chunk->setParent(gpCurrentParent);
    chunk->setCost(gbCurrentCost);
    int j = 0;
    for (auto& kv : neighborTbl) {
        if (j >= MintRoutePkt::MAX_RPESTENTRIES) break;
        const TableEntry& e = kv.second;
        if ((e.flags & NBRFLAG_VALID) && e.receiveEst > 30) {
            RPEstEntry rpe;
            rpe.id = e.id;
            rpe.receiveEst = e.receiveEst;
            chunk->setEstList(j, rpe);
            j++;
        }
    }
    chunk->setEstEntries(j);
    // ---- [MintRoute] end ----
    Packet *packet = new Packet("eb-route", chunk);
    setDownControlInfo(packet, MacAddress::BROADCAST_ADDRESS);
    emit(packetSentSignal, packet);
    sendDown(packet);
    nbRouteFloodsSent++;
    sentCount++;
}

// MintRoute.cc:224-247: the sender's fields into its entry, then the generated
// reception (the model counts the link, floods the packet, deletes it). The
// sender is the frame's forwarder: every frame is pinned to its transmitter.
void MintRoute::onReceiveRoutePkt(Packet *packet, const Ptr<const PPkt>& wire)
{
    if (auto header = dynamicPtrCast<const MintRoutePkt>(wire)) {
        routeFieldsRead++;
        Node senderID = header->getFwdrAddr();
        TableEntry *nbr = &entryOf(senderID);
        nbr->parent = header->getParent();
        nbr->hop    = header->getHopCount();
        nbr->cost   = header->getCost();
        if (nbr->childLiveliness > 0 && header->getParent() != myNodeId)
            nbr->childLiveliness = 0;
        // Look for my own id in the sender's estList -- that gives my sendEst.
        for (size_t i = 0; i < header->getEstListArraySize() && (int)i < header->getEstEntries(); i++) {
            const auto& rpe = header->getEstList(i);
            if (rpe.id == myNodeId) {
                nbr->sendEst = rpe.receiveEst;
                nbr->liveliness = LIVELINESS;
                break;
            }
        }
    }
    else {
        routeFieldsMissing++;   // a ROUTE frame without MintRoute's fields
    }
    EbWsn::onReceiveRoutePkt(packet, wire);
}

// MintRoute.cc:216-222: a beacon's sender gets an entry (updateNbrCounters ->
// findOrCreateEntry, :219, :376); the model counts the link.
void MintRoute::onReceiveBeaconPkt(Packet *packet, const Ptr<const PPkt>& header)
{
    entryOf(header->getFwdrAddr());
    EbWsn::onReceiveBeaconPkt(packet, header);
}

void MintRoute::finish()
{
    EbWsn::finish();

    // The run test's facts (Q12). Node ids are module ids, so each node also
    // records its own, and loop.sh maps ids to names with it.
    recordScalar("mrt:myId", myNodeId);
    recordScalar("mrt:isSink", isSink);
    recordScalar("mrt:parent", gpCurrentParent);
    recordScalar("mrt:hasParent", !isSink && gpCurrentParent != BROADCAST);
    recordScalar("mrt:hop", gbCurrentHopCount);
    recordScalar("mrt:cost", gbCurrentCost);
    recordScalar("mrt:firstParentAt", firstParentAt < SIMTIME_ZERO ? -1.0 : firstParentAt.dbl());
    recordScalar("mrt:parentChanges", parentChanges);
    recordScalar("mrt:addEntryCalls", addEntryCalls);
    recordScalar("mrt:addEntryRefused", addEntryRefused);
    recordScalar("mrt:routeFieldsRead", routeFieldsRead);
    recordScalar("mrt:routeFieldsMissing", routeFieldsMissing);

    // Is the parent a neighbour the model has heard?
    bool parentHeard = gpCurrentParent != BROADCAST && neighbourTbl.count({myNodeId, gpCurrentParent}) > 0;
    recordScalar("mrt:parentHeard", isSink || parentHeard);

    // INET's table: exactly one route to the sink, via the parent. Addresses
    // resolved from node NAMES, not through the generated addressOfNode.
    if (!isSink && gpCurrentParent != BROADCAST) {
        cModule *sinkHost = getSimulation()->getModule(sinkNode);
        cModule *parentHost = getSimulation()->getModule(gpCurrentParent);
        // By name, as StaticRoutes resolves them (3f: 8 of 8 routes matched).
        std::string dest = inet::L3AddressResolver().resolve(sinkHost->getFullName(),
            inet::L3AddressResolver::ADDR_MODULEPATH).str();
        std::string gw = inet::L3AddressResolver().resolve(parentHost->getFullName(),
            inet::L3AddressResolver::ADDR_MODULEPATH).str();
        int toSink = 0, viaParent = 0;
        for (int i = 0; i < routingTable->getNumRoutes(); i++) {
            inet::IRoute *r = routingTable->getRoute(i);
            if (r->getDestinationAsGeneric().str() != dest) continue;
            toSink++;
            if (r->getNextHopAsGeneric().str() == gw) viaParent++;
        }
        recordScalar("mrt:inetRouteOk", toSink == 1 && viaParent == 1);
    }

    // What the node heard, and its estimates (reported, and the shortest-path
    // comparison's graph).
    for (const auto& e : neighbourTbl)
        if (e.first == myNodeId)
            recordScalar(("mrt:heard:" + std::to_string(e.second)).c_str(), 1);
    for (const auto& kv : neighborTbl) {
        if (kv.first == myNodeId) continue;
        recordScalar(("mrt:receiveEst:" + std::to_string(kv.first)).c_str(), kv.second.receiveEst);
        recordScalar(("mrt:sendEst:" + std::to_string(kv.first)).c_str(), kv.second.sendEst);
    }

    // One picture of the whole tree per run, written once, by the sink.
    if (isSink)
        writeTreeSvg();
}

// ---------------------------------------------------------------------------
// The tree, drawn. Positions are the nodes' mobility positions; on the Qtenv
// canvas they go through INET's canvas projection, as INET's visualizers draw.
// ---------------------------------------------------------------------------

static const char *TREE_BLUE = "#2a78d6";

// Qtenv only: one arrow per sensor, from it to its parent, hidden while it has
// none. Called whenever chooseParent() changes the parent.
void MintRoute::drawParentArrow()
{
    if (!getEnvir()->isGUI() || isSink)
        return;
    cModule *node = getContainingNode(this);
    cCanvas *canvas = node->getParentModule()->getCanvas();
    if (parentArrow == nullptr) {
        parentArrow = new cLineFigure("mintrouteParent");
        parentArrow->setLineColor(cFigure::Color(TREE_BLUE));
        parentArrow->setLineWidth(3);
        parentArrow->setEndArrowhead(cFigure::ARROW_BARBED);
        parentArrow->setZIndex(5);
        canvas->addFigure(parentArrow);   // the canvas owns it from here
    }
    cModule *parent = gpCurrentParent == BROADCAST ? nullptr : getSimulation()->getModule(gpCurrentParent);
    if (parent == nullptr) {
        parentArrow->setVisible(false);
        return;
    }
    auto *projection = inet::CanvasProjection::getCanvasProjection(canvas);
    auto at = [&](cModule *m) {
        return projection->computeCanvasPoint(
            check_and_cast<inet::IMobility *>(m->getSubmodule("mobility"))->getCurrentPosition());
    };
    cFigure::Point a = at(node), b = at(parent);
    double d = std::hypot(b.x - a.x, b.y - a.y);
    if (d <= 0) {
        parentArrow->setVisible(false);
        return;
    }
    double ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;   // clear of both icons
    parentArrow->setStart(cFigure::Point(a.x + ux * 12, a.y + uy * 12));
    parentArrow->setEnd(cFigure::Point(b.x - ux * 18, b.y - uy * 18));
    parentArrow->setTooltip((std::string(node->getFullName()) + " -> " + parent->getFullName()).c_str());
    parentArrow->setVisible(true);
}

// The whole tree as <resultdir>/<config>-#<run>-tree.svg: every node at its
// position, the links each one heard (grey dashes), an arrow to each parent
// (blue; red where the chain of parents never reaches the sink), and its hop
// count inside it. Run by the sink only; reads every MintRoute in the network.
void MintRoute::writeTreeSvg()
{
    struct N { std::string name; Node id; double x, y; bool sink; Node parent; int hop; std::vector<Node> heard; };
    std::vector<N> nodes;
    cModule *network = getContainingNode(this)->getParentModule();
    for (cModule::SubmoduleIterator it(network); !it.end(); ++it) {
        cModule *m = *it;
        auto *mr = dynamic_cast<MintRoute *>(m->findModuleByPath(".generic.np"));
        auto *mob = dynamic_cast<inet::IMobility *>(m->getSubmodule("mobility"));
        if (!mr || !mob)
            continue;
        const inet::Coord& c = mob->getCurrentPosition();
        N n{m->getFullName(), mr->myNodeId, c.x, c.y, mr->isSink,
            mr->isSink ? mr->myNodeId : mr->gpCurrentParent, mr->isSink ? 0 : mr->gbCurrentHopCount, {}};
        for (const auto& e : mr->neighbourTbl)
            if (e.first == mr->myNodeId)
                n.heard.push_back(e.second);
        nodes.push_back(n);
    }
    if (nodes.empty())
        return;

    std::map<Node, const N *> byId;
    for (const N& n : nodes) byId[n.id] = &n;
    auto hasParent = [&](const N& n) { return !n.sink && n.parent != BROADCAST && byId.count(n.parent); };
    auto reachesSink = [&](const N& n) {
        std::set<Node> seen;
        for (const N *cur = &n; cur; ) {
            if (cur->sink) return true;
            if (!seen.insert(cur->id).second || !hasParent(*cur)) return false;
            cur = byId[cur->parent];
        }
        return false;
    };

    // Metres to pixels: the field fitted into 700 px, a margin round it.
    double minX = nodes[0].x, maxX = minX, minY = nodes[0].y, maxY = minY;
    for (const N& n : nodes) {
        minX = std::min(minX, n.x); maxX = std::max(maxX, n.x);
        minY = std::min(minY, n.y); maxY = std::max(maxY, n.y);
    }
    const double M = 70, TOP = 80, R = 12;
    double s = 700 / std::max(1.0, std::max(maxX - minX, maxY - minY));
    double W = (maxX - minX) * s + 2 * M, H = (maxY - minY) * s + TOP + M + 60;
    auto px = [&](const N& n) { return M + (n.x - minX) * s; };
    auto py = [&](const N& n) { return TOP + (n.y - minY) * s; };

    cConfigurationEx *cfg = getEnvir()->getConfigEx();
    int withParent = 0, inLoop = 0;
    for (const N& n : nodes)
        if (hasParent(n)) { withParent++; if (!reachesSink(n)) inLoop++; }

    std::ostringstream o;
    o << "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" << W << "\" height=\"" << H
      << "\" viewBox=\"0 0 " << W << " " << H << "\" font-family=\"Segoe UI, Arial, sans-serif\">\n";
    for (const char *id : {"arrow", "arrowLoop"})
        o << "<defs><marker id=\"" << id << "\" viewBox=\"0 0 10 10\" refX=\"8\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">"
          << "<path d=\"M0,0 L10,5 L0,10 z\" fill=\"" << (std::string(id) == "arrow" ? TREE_BLUE : "#e34948") << "\"/></marker></defs>\n";
    o << "<rect width=\"" << W << "\" height=\"" << H << "\" fill=\"#fcfcfb\"/>\n";
    o << "<text x=\"" << M << "\" y=\"30\" font-size=\"18\" font-weight=\"600\" fill=\"#0b0b0b\">Route tree at t = "
      << simTime().dbl() << " s: " << cfg->getActiveConfigName() << " run #" << cfg->getActiveRunNumber()
      << " (seed set " << cfg->getVariable(CFGVAR_SEEDSET) << ")</text>\n";
    o << "<text x=\"" << M << "\" y=\"50\" font-size=\"13\" fill=\"#52514e\">sensors with a parent: " << withParent
      << " of " << nodes.size() - 1 << (inLoop ? " (" + std::to_string(inLoop) + " in a loop)" : std::string())
      << " · the number in a node is its hop count</text>\n";

    std::set<std::pair<Node, Node>> drawn;   // each heard link once
    for (const N& n : nodes)
        for (Node h : n.heard) {
            if (!byId.count(h) || drawn.count({std::min(n.id, h), std::max(n.id, h)})) continue;
            drawn.insert({std::min(n.id, h), std::max(n.id, h)});
            const N& m = *byId[h];
            o << "<line x1=\"" << px(n) << "\" y1=\"" << py(n) << "\" x2=\"" << px(m) << "\" y2=\"" << py(m)
              << "\" stroke=\"#c3c2b7\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\"/>\n";
        }
    for (const N& n : nodes) {
        if (!hasParent(n)) continue;
        const N& p = *byId[n.parent];
        double x1 = px(n), y1 = py(n), x2 = px(p), y2 = py(p), d = std::hypot(x2 - x1, y2 - y1);
        if (d <= 0) continue;
        double ux = (x2 - x1) / d, uy = (y2 - y1) / d;
        bool ok = reachesSink(n);
        o << "<line x1=\"" << x1 + ux * R << "\" y1=\"" << y1 + uy * R << "\" x2=\"" << x2 - ux * (R + 3)
          << "\" y2=\"" << y2 - uy * (R + 3) << "\" stroke=\"" << (ok ? TREE_BLUE : "#e34948")
          << "\" stroke-width=\"3\" marker-end=\"url(#" << (ok ? "arrow" : "arrowLoop") << ")\"/>\n";
    }
    for (const N& n : nodes) {
        double x = px(n), y = py(n);
        // The name goes on the side away from the node's own parent arrow.
        double lx = 0, ly = -1;
        if (hasParent(n)) {
            const N& p = *byId[n.parent];
            double d = std::hypot(px(p) - x, py(p) - y);
            if (d > 0) { lx = -(px(p) - x) / d; ly = -(py(p) - y) / d; }
        }
        if (n.sink)
            o << "<rect x=\"" << x - R << "\" y=\"" << y - R << "\" width=\"" << 2 * R << "\" height=\"" << 2 * R
              << "\" rx=\"3\" fill=\"#0b0b0b\"/>\n";
        else
            o << "<circle cx=\"" << x << "\" cy=\"" << y << "\" r=\"" << R
              << "\" fill=\"#ffffff\" stroke=\"#0b0b0b\" stroke-width=\"2\"/>\n";
        o << "<text x=\"" << x << "\" y=\"" << y + 4 << "\" font-size=\"12\" font-weight=\"600\" text-anchor=\"middle\" fill=\""
          << (n.sink ? "#ffffff" : "#0b0b0b") << "\">" << (n.sink ? "0" : hasParent(n) ? std::to_string(n.hop) : "-") << "</text>\n";
        // Beside the node when the free side is left or right, else below or above.
        double tx = x, ty;
        const char *anchor = "middle";
        if (std::fabs(lx) > std::fabs(ly)) {
            anchor = lx > 0 ? "start" : "end";
            tx = x + (lx > 0 ? 1 : -1) * (R + 6);
            ty = y + 5;
        }
        else
            ty = ly > 0 ? y + R + 17 : y - R - 7;
        o << "<text x=\"" << tx << "\" y=\"" << ty << "\" font-size=\"13\" font-weight=\"600\" text-anchor=\"" << anchor
          << "\" fill=\"#0b0b0b\">" << n.name << "</text>\n";
    }
    double ly = H - 22;
    o << "<line x1=\"" << M << "\" y1=\"" << ly << "\" x2=\"" << M + 40 << "\" y2=\"" << ly << "\" stroke=\"" << TREE_BLUE
      << "\" stroke-width=\"3\" marker-end=\"url(#arrow)\"/><text x=\"" << M + 50 << "\" y=\"" << ly + 4
      << "\" font-size=\"12\" fill=\"#52514e\">child to parent</text>\n";
    o << "<line x1=\"" << M + 170 << "\" y1=\"" << ly << "\" x2=\"" << M + 210 << "\" y2=\"" << ly
      << "\" stroke=\"#c3c2b7\" stroke-width=\"1.5\" stroke-dasharray=\"4 4\"/><text x=\"" << M + 220 << "\" y=\"" << ly + 4
      << "\" font-size=\"12\" fill=\"#52514e\">radio link heard</text>\n";
    o << "<line x1=\"" << M + 350 << "\" y1=\"" << ly << "\" x2=\"" << M + 390 << "\" y2=\"" << ly << "\" stroke=\"#e34948\""
      << " stroke-width=\"3\" marker-end=\"url(#arrowLoop)\"/><text x=\"" << M + 400 << "\" y=\"" << ly + 4
      << "\" font-size=\"12\" fill=\"#52514e\">a chain of parents that never reaches the sink</text>\n";
    o << "</svg>\n";

    std::string dir = cfg->getVariable(CFGVAR_RESULTDIR);
    std::filesystem::create_directories(dir);
    std::string file = dir + "/" + cfg->getActiveConfigName() + "-#" + std::to_string(cfg->getActiveRunNumber()) + "-tree.svg";
    std::ofstream(file) << o.str();
    EV_INFO << "MintRoute: route tree written to " << file << endl;
}

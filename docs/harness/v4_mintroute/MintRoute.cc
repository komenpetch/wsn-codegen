// MintRoute -- see MintRoute.h. HAND-WRITTEN case-study code.
//
// Each function is MintRoute.cc's of the same name (this project's INET port),
// with its line numbers, changed only where structure 4 differs:
//   - node ids (ints) where the baseline has L3Addresses, BROADCAST for "none";
//   - the link counts are the model's (PRouteTable's received / lastSeqno,
//     read, never reset; Q5 = a), where the baseline counts its own;
//   - the parent also goes into the model's route table (addEntry, Q11 = a).

#include "MintRoute.h"

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
    chunk->setChunkLength(B(headerLength));
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
}

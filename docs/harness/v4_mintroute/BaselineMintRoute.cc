// See BaselineMintRoute.h.
#include "BaselineMintRoute.h"

#include "inet/common/ModuleAccess.h"
#include "inet/networklayer/common/L3AddressResolver.h"

using namespace inet;

Define_Module(BaselineMintRoute);

void BaselineMintRoute::initialize(int stage)
{
    inet::MintRoute::initialize(stage);
    if (stage == INITSTAGE_LOCAL)
        restoreMiximOrder = par("restoreMiximOrder");
}

void BaselineMintRoute::onReceiveSensingPkt(Packet *packet, const Ptr<const MintRouteHeader>& header)
{
    // MiXiM's order: count the frame, then check for a duplicate. The port's
    // body below counts a frame that is not a duplicate itself, after its check,
    // so each frame is counted exactly once either way.
    if (restoreMiximOrder
        && isDuplicate(header->getInitialSrcAddr(), header->getSourceAddress(),
                       header->getData(), SENSING_PACKET)) {
        TableEntry *nbr = nullptr;
        updateNbrCounters(header->getSourceAddress(), SENSING_PACKET,
                          header->getSeqNum(), header->getHopCount(), &nbr);
        countedDuplicates++;
    }
    inet::MintRoute::onReceiveSensingPkt(packet, header);
}

void BaselineMintRoute::chooseParent()
{
    inet::MintRoute::chooseParent();
    if (gpCurrentParent != lastParent) {
        parentChanges++;
        if (firstParentAt < SIMTIME_ZERO && !gpCurrentParent.isUnspecified()
            && myNetwAddr != sinkAddress)
            firstParentAt = simTime();
        EV_INFO << "BaselineMintRoute: parent of " << myNetwAddr << " -> "
                << (gpCurrentParent.isUnspecified() ? std::string("none") : gpCurrentParent.str())
                << " cost " << gbCurrentCost << " hop " << gbCurrentHopCount << endl;
        // The entry of the parent just left, so the log shows which of
        // chooseParent's filters it failed (MintRoute.cc:467-472). Log only.
        auto it = lastParent.isUnspecified() ? neighborTbl.end() : neighborTbl.find(lastParent);
        if (it != neighborTbl.end()) {
            const TableEntry& o = it->second;
            EV_INFO << "BaselineMintRoute: left " << o.id << ": valid " << ((o.flags & NBRFLAG_VALID) != 0)
                    << " itsParentIsMe " << (o.parent == myNetwAddr) << " hop " << o.hop
                    << " cost " << o.cost << " sendEst " << o.sendEst << " receiveEst " << o.receiveEst
                    << " childLiveliness " << o.childLiveliness << endl;
        }
        lastParent = gpCurrentParent;
    }
}

// The node an address belongs to, by its module id (the id v4's mrt:* use too);
// -1 for no address.
int BaselineMintRoute::nodeIdOf(const L3Address& addr)
{
    if (addr.isUnspecified())
        return -1;
    cModule *host = L3AddressResolver().findHostWithAddress(addr);
    return host ? host->getId() : -1;
}

void BaselineMintRoute::finish()
{
    inet::MintRoute::finish();
    bool isSink = myNetwAddr == sinkAddress;
    recordScalar("bl:myId", getContainingNode(this)->getId());
    recordScalar("bl:isSink", isSink);
    recordScalar("bl:restoreMiximOrder", restoreMiximOrder);
    recordScalar("bl:parent", nodeIdOf(gpCurrentParent));
    recordScalar("bl:hasParent", !isSink && !gpCurrentParent.isUnspecified());
    recordScalar("bl:hop", gbCurrentHopCount);
    recordScalar("bl:cost", gbCurrentCost);
    recordScalar("bl:firstParentAt", firstParentAt < SIMTIME_ZERO ? -1.0 : firstParentAt.dbl());
    recordScalar("bl:parentChanges", parentChanges);
    recordScalar("bl:countedDuplicates", countedDuplicates);
    for (const auto& kv : neighborTbl) {
        const TableEntry& e = kv.second;
        if (e.id == myNetwAddr)
            continue;
        int id = nodeIdOf(e.id);
        if (id < 0)
            continue;
        std::string n = std::to_string(id);
        recordScalar(("bl:heard:" + n).c_str(), 1);
        recordScalar(("bl:receiveEst:" + n).c_str(), e.receiveEst);
        recordScalar(("bl:sendEst:" + n).c_str(), e.sendEst);
    }
}

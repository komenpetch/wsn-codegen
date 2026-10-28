//
// The DSR baseline: see DSRRoute.h and design/V4_DSR_Plan.md section 13.
// "Fig n" marks a statement printed in the Final Report; "Q n" a decision of
// the plan; "port" a line taken from this project's MintRoute port
// (src/inet/networklayer/mintroute/MintRoute.cc) for the INET side.
//

#include "DSRRoute.h"

#include <cstdlib>
#include <string>

#include "inet/common/ModuleAccess.h"
#include "inet/common/ProtocolGroup.h"
#include "inet/common/ProtocolTag_m.h"
#include "inet/linklayer/common/MacAddress.h"
#include "inet/linklayer/common/MacAddressTag_m.h"
#include "inet/networklayer/common/L3AddressResolver.h"
#include "inet/networklayer/common/L3AddressTag_m.h"
#include "inet/networklayer/common/NetworkInterface.h"
#include "inet/networklayer/contract/IL3AddressType.h"

namespace dsrbaseline {

Define_Module(DSRRoute);

// In INET's non-standard ethertype block, beside the generated eventb (0x86FB)
// and mintRoute (0x86FC); free in ProtocolGroup.cc.
static const int DSR_ETHERTYPE = 0x86FA;

const Protocol *DSRRoute::dsrProtocol()
{
    ProtocolGroup *group = ProtocolGroup::getEthertypeProtocolGroup();
    const Protocol *p = group->findProtocol(DSR_ETHERTYPE);
    if (p == nullptr) {
        p = new Protocol("dsrroute", "DSR baseline (Final Report DSRRoute)");
        group->addProtocol(DSR_ETHERTYPE, p);
    }
    return p;
}

void DSRRoute::initialize(int stage)
{
    NetworkProtocolBase::initialize(stage);

    if (stage == INITSTAGE_LOCAL) {
        dsrProtocol();   // registered before SensorApp looks it up by name
        arp.reference(this, "arpModule", true);
        headerLength = par("headerLength");
        stats = par("stats");
    }
    else if (stage == INITSTAGE_NETWORK_INTERFACE_CONFIGURATION) {
        // port
        for (int i = 0; i < interfaceTable->getNumInterfaces(); i++)
            interfaceTable->getInterface(i)->setHasModulePathAddress(true);
    }
    else if (stage == INITSTAGE_NETWORK_LAYER) {
        // port
        L3AddressResolver addressResolver;
        sinkAddress = addressResolver.resolve(par("sinkAddress"));
        if (auto ie = interfaceTable->findFirstNonLoopbackInterface())
            myNetwAddr = ie->getNetworkAddress();
        else
            throw cRuntimeError("DSRRoute: no non-loopback interface found");
        ctl6.init(myNetwAddr, sinkAddress);
    }
}

// Fig 6.9, statement by statement. The data packet is sent along the cached
// path (start_tx_dataPkt_fwd); with no path it is broadcast and an RREQ is
// flooded (start_tx_dataPkt_bct, FUN-3a, Q9).
void DSRRoute::handleUpperMsg(Packet *msg)
{
    L3Address finalDestAddr = sinkAddress;
    if (auto addrTag = msg->findTag<L3AddressReq>())
        finalDestAddr = addrTag->getDestAddress();
    auto cached = ctl6.routeCache.find(finalDestAddr);
    bool isFlood = cached == ctl6.routeCache.end();
    double data = 0.0;   // port: SensorApp's payload carries no value

    auto pkt = makeShared<DSRPkt>();                      // DSRPkt* pkt = new DSRPkt(msg->getName(), DATA);
    ctl6.pkt = pkt;
    pkt->setChunkLength(B(headerLength));                 // pkt->setByteLength(headerLength);
    pkt->setInitialSrcAddr(myNetwAddr);                   // pkt->setInitialSrcAddr(myNetwAddr);
    pkt->setFinalDestAddr(finalDestAddr);                 // pkt->setFinalDestAddr(finalDestAddr);
    pkt->setNbHops(0);                                    // pkt->setNbHops(0);
    pkt->setIsFlood(isFlood);                             // pkt->setIsFlood(isFlood);
    ctl6.create_dataPkt();                                // pkt->setSeqNum(seqNum);
    pkt->setPayloadType(SENSING_PACKET);                  // pkt->setPayloadType(SENSING_PACKET);
    pkt->setData(data);                                   // pkt->setData(data);
    pkt->setSrcAddr(myNetwAddr);
    pkt->setProtocolId(static_cast<IpProtocolId>(ProtocolGroup::getIpProtocolGroup()->getProtocolNumber(msg->getTag<PacketProtocolTag>()->getProtocol())));
    pkt->setPayloadLengthField(msg->getDataLength());

    L3Address nextRoute;
    if (!isFlood) {
        const std::vector<L3Address>& path = cached->second;
        ctl6.set_DATAPath_init();
        for (int i = 0; i < (int)path.size(); i++)
            ctl6.set_DATAPath_loop(i, path[i]);
        nextRoute = selectRoute(myNetwAddr, path);        // int nextRoute = selectRoute(myNetwAddr, path);
        ctl6.start_tx_dataPkt_fwd();
    }
    else {
        nextRoute = resolveBroadcast();
        ctl6.start_tx_dataPkt_bct();
    }
    msg->clearTags();
    sendToNextHop(msg, pkt, nextRoute);                   // macAddr = arp->getMacAddr(nextRoute); ... sendDown(pkt);

    if (isFlood)
        sendRREQ(finalDestAddr);                          // FUN-3a: no route, so a route request
}

// Fig 6.10. The packet is handed to ctl6 at the top (Q12), where the figure
// elides it after check_and_cast.
void DSRRoute::handleLowerMsg(Packet *msg)
{
    auto pkt = msg->removeAtFront<DSRPkt>();              // DSRPkt* pkt = check_and_cast<DSRPkt*>(msg);
    ctl6.pkt = pkt;
    L3Address finalDestAddr = pkt->getFinalDestAddr();
    L3Address initialSrcAddr = pkt->getInitialSrcAddr();

    switch (pkt->getPayloadType()) {
        case SENSING_PACKET:
            if (ctl6.isDuplicated()) {
                ctl6.duplicatesDropped++;
                delete msg;
            }
            else {
                if (finalDestAddr == myNetwAddr) {
                    ctl6.dest_recv_dataPkt();
                    decapsulate(msg, pkt);
                    sendUp(msg);
                }
                else {
                    ctl6.receive_dataPkt();
                    L3Address next = pkt->getIsFlood() ? resolveBroadcast() : selectRoute(myNetwAddr, pathOf(pkt));
                    if (next.isUnspecified()) {
                        ctl6.notOnPath++;
                        delete msg;
                    }
                    else {
                        msg->clearTags();
                        sendToNextHop(msg, pkt, next);   // sendDown(pkt);
                    }
                }
            }
            break;

        case RREQ_PACKET:
            if (ctl6.isDuplicated()) {
                ctl6.duplicatesDropped++;
                delete msg;
            }
            else {
                if (finalDestAddr == myNetwAddr) {
                    if (ctl6.dest_recv_rreqPkt()) {
                        std::vector<L3Address> path = pathOf(pkt);
                        sendRREP(initialSrcAddr, reverseRoute(path, (int)path.size() - 1));
                    }
                    delete msg;
                }
                else {
                    if (ctl6.receive_rreqPkt()) {
                        msg->clearTags();
                        sendToNextHop(msg, pkt, resolveBroadcast());   // sendDown(pkt);
                    }
                    else
                        delete msg;
                }
            }
            break;

        case RREP_PACKET:
            if (ctl6.isDuplicated()) {
                ctl6.duplicatesDropped++;
                delete msg;
            }
            else {
                if (finalDestAddr == myNetwAddr) {
                    ctl6.dest_recv_rrepPkt();
                    std::vector<L3Address> path = pathOf(pkt);
                    // §6.3 step 7: the originator reverses the route the RREP carries
                    updateRouteCacheTable(initialSrcAddr, reverseRoute(path, (int)path.size() - 1), (int)path.size() - 1);
                    delete msg;
                }
                else {
                    ctl6.receive_rrepPkt();
                    L3Address next = selectRoute(myNetwAddr, pathOf(pkt));
                    if (next.isUnspecified()) {
                        ctl6.notOnPath++;
                        delete msg;
                    }
                    else {
                        msg->clearTags();
                        sendToNextHop(msg, pkt, next);   // sendDown(pkt);
                    }
                }
            }
            break;

        default:
            EV_WARN << "DSRRoute: unknown payload type " << pkt->getPayloadType() << endl;
            delete msg;
            break;
    }
}

// Fig 6.8: create_rreq || start_tx_rreq. FUN-3a: flooded, carrying the route
// record that starts with the originator.
void DSRRoute::sendRREQ(const L3Address& finalDestAddr)
{
    auto pkt = makeShared<DSRPkt>();
    ctl6.pkt = pkt;
    pkt->setChunkLength(B(headerLength));
    pkt->setInitialSrcAddr(myNetwAddr);
    pkt->setFinalDestAddr(finalDestAddr);
    pkt->setSrcAddr(myNetwAddr);
    pkt->setPayloadType(RREQ_PACKET);
    ctl6.create_rreq();
    ctl6.start_tx_rreq();
    Packet *msg = new Packet("dsr-rreq");
    sendToNextHop(msg, pkt, resolveBroadcast());
}

// Fig 6.8: create_rrep || set_RREPPath_init/loop || start_tx_rrep. FUN-3b:
// back along the recorded route, which `path` holds reversed (destination
// first); sent to the entry after this node's own (Q16).
void DSRRoute::sendRREP(const L3Address& initialSrcAddr, const std::vector<L3Address>& path)
{
    auto pkt = makeShared<DSRPkt>();
    ctl6.pkt = pkt;
    pkt->setChunkLength(B(headerLength));
    pkt->setInitialSrcAddr(myNetwAddr);
    pkt->setSrcAddr(myNetwAddr);
    pkt->setPayloadType(RREP_PACKET);
    ctl6.create_rrep(initialSrcAddr);
    ctl6.set_RREPPath_init();
    for (int i = 0; i < (int)path.size(); i++)
        ctl6.set_RREPPath_loop(i, path[i]);
    ctl6.start_tx_rrep();
    Packet *msg = new Packet("dsr-rrep");
    sendToNextHop(msg, pkt, selectRoute(myNetwAddr, path));
}

// Fig 6.11: `for (int i = 0, j = lastIndex; i < PATHLEN; i++) { ctl6.
// reverse_path_loop(oldpath[j], lastIndex); j--; }`. ⚠ As printed the loop
// runs PATHLEN times and reads oldpath[-1] onwards once j passes 0, and the
// int* function returns nothing; here it stops after entry 0 and returns the
// path reverse_path_loop built.
std::vector<L3Address> DSRRoute::reverseRoute(const std::vector<L3Address>& oldpath, int lastIndex)
{
    ctl6.reverse_path_init();
    for (int i = 0, j = lastIndex; i <= lastIndex; i++) {
        ctl6.reverse_path_loop(oldpath[j], lastIndex);
        j--;
    }
    return ctl6.reversePath;
}

// Fig 6.8: update_RouteCacheTbl_init || update_RouteCacheTbl_loop, with the
// printed signature (origin, path, hopCount). The first path is kept (Q16).
void DSRRoute::updateRouteCacheTable(const CTL6::tRouteCache::key_type& origin, const std::vector<L3Address>& path, int hopCount)
{
    if (!ctl6.update_RouteCacheTbl_init(origin))
        return;
    for (int i = 0; i <= hopCount; i++)
        ctl6.update_RouteCacheTbl_loop(origin, path[i]);
    if (origin == sinkAddress && firstRouteAt < SIMTIME_ZERO)
        firstRouteAt = simTime();
}

// Fig 6.9: selectRoute(myNetwAddr, path). Q16: the next hop is the entry
// after this node's own; unspecified when the node is not on the path or is
// its last entry.
L3Address DSRRoute::selectRoute(const L3Address& src, const std::vector<L3Address>& path) const
{
    for (size_t i = 0; i + 1 < path.size(); i++)
        if (path[i] == src)
            return path[i + 1];
    return L3Address();
}

// Fig 6.9's last four statements: macAddr = arp->getMacAddr(nextRoute);
// pkt->setDestAddr(macAddr); setDownControlInfo(pkt, macAddr); sendDown(pkt);
void DSRRoute::sendToNextHop(Packet *packet, const Ptr<DSRPkt>& pkt, const L3Address& nextHop)
{
    pkt->setDestAddr(nextHop);
    packet->insertAtFront(pkt);
    MacAddress macAddr;
    if (nextHop.isBroadcast() || nextHop == resolveBroadcast())
        macAddr = MacAddress::BROADCAST_ADDRESS;
    else {
        macAddr = arp->resolveL3Address(nextHop, nullptr);   // port
        if (macAddr.isUnspecified())
            throw cRuntimeError("DSRRoute: cannot resolve the MAC address of %s", nextHop.str().c_str());
    }
    setDownControlInfo(packet, macAddr);
    sendDown(packet);
}

// port: decapsulate, the header already removed
void DSRRoute::decapsulate(Packet *packet, const Ptr<const DSRPkt>& pkt)
{
    auto payloadLength = pkt->getPayloadLengthField();
    if (packet->getDataLength() < payloadLength)
        throw cRuntimeError("DSRRoute: illegal payload length");
    if (packet->getDataLength() > payloadLength)
        packet->setBackOffset(packet->getFrontOffset() + payloadLength);
    auto payloadProtocol = pkt->getProtocol();
    packet->clearTags();
    packet->addTagIfAbsent<NetworkProtocolInd>()->setProtocol(&getProtocol());
    packet->addTagIfAbsent<NetworkProtocolInd>()->setNetworkProtocolHeader(pkt);
    packet->addTagIfAbsent<DispatchProtocolReq>()->setProtocol(payloadProtocol);
    packet->addTagIfAbsent<PacketProtocolTag>()->setProtocol(payloadProtocol);
    packet->addTagIfAbsent<L3AddressInd>()->setSrcAddress(pkt->getInitialSrcAddr());
}

// port
void DSRRoute::setDownControlInfo(Packet *packet, const MacAddress& macAddr)
{
    packet->addTagIfAbsent<MacAddressReq>()->setDestAddress(macAddr);
    packet->addTagIfAbsent<PacketProtocolTag>()->setProtocol(&getProtocol());
    packet->addTagIfAbsent<DispatchProtocolInd>()->setProtocol(&getProtocol());
}

// port
L3Address DSRRoute::resolveBroadcast() const
{
    return myNetwAddr.getAddressType()->getBroadcastAddress();
}

// the path's used entries: up to the last specified one
std::vector<L3Address> DSRRoute::pathOf(const Ptr<const DSRPkt>& pkt)
{
    std::vector<L3Address> path;
    for (int i = 0; i < MAX_PATHLEN && !pkt->getPath(i).isUnspecified(); i++)
        path.push_back(pkt->getPath(i));
    return path;
}

// sink = 0, sensorN = N: the field's node names, as the v4 harnesses number them
int DSRRoute::nodeIndexOf(const L3Address& addr)
{
    cModule *host = L3AddressResolver().findHostWithAddress(addr);
    if (host == nullptr)
        throw cRuntimeError("DSRRoute: no node has address %s", addr.str().c_str());
    std::string name = host->getFullName();
    if (name == "sink")
        return 0;
    if (name.rfind("sensor", 0) == 0)
        return std::atoi(name.c_str() + 6);
    throw cRuntimeError("DSRRoute: unexpected node name %s", name.c_str());
}

void DSRRoute::finish()
{
    if (!stats)
        return;
    bool isSink = myNetwAddr == sinkAddress;
    recordScalar("bl:node", nodeIndexOf(myNetwAddr));
    recordScalar("bl:isSink", isSink);
    auto cached = ctl6.routeCache.find(sinkAddress);
    bool hasRoute = !isSink && cached != ctl6.routeCache.end();
    recordScalar("bl:hasRoute", hasRoute);
    if (hasRoute) {
        const std::vector<L3Address>& path = cached->second;
        recordScalar("bl:hopCount", (double)path.size() - 1);
        recordScalar("bl:nextHop", nodeIndexOf(path[1]));
        for (size_t i = 0; i < path.size(); i++)
            recordScalar(("bl:path:" + std::to_string(i)).c_str(), nodeIndexOf(path[i]));
    }
    recordScalar("bl:firstRouteAt", firstRouteAt < SIMTIME_ZERO ? -1.0 : firstRouteAt.dbl());
    recordScalar("bl:dataCreated", ctl6.dataCreated);
    recordScalar("bl:dataSentPath", ctl6.dataSentPath);
    recordScalar("bl:dataSentFlood", ctl6.dataSentFlood);
    recordScalar("bl:dataForwarded", ctl6.dataForwarded);
    recordScalar("bl:dataReceivedPath", ctl6.dataReceivedPath);
    recordScalar("bl:dataReceivedFlood", ctl6.dataReceivedFlood);
    for (const auto& e : ctl6.dataReceivedFrom)
        recordScalar(("bl:dataFrom:" + std::to_string(nodeIndexOf(e.first))).c_str(), e.second);
    recordScalar("bl:rreqOriginated", ctl6.rreqOriginated);
    recordScalar("bl:rreqForwarded", ctl6.rreqForwarded);
    recordScalar("bl:rreqAnswered", ctl6.rreqAnswered);
    recordScalar("bl:rrepSent", ctl6.rrepSent);
    recordScalar("bl:rrepForwarded", ctl6.rrepForwarded);
    recordScalar("bl:rrepReceived", ctl6.rrepReceived);
    recordScalar("bl:duplicatesDropped", ctl6.duplicatesDropped);
    recordScalar("bl:hopLimitDrops", ctl6.hopLimitDrops);
    recordScalar("bl:notOnPath", ctl6.notOnPath);
}

} // namespace dsrbaseline

#include "BaselineAodv.h"

#include "inet/common/Simsignals.h"
#include "inet/networklayer/common/L3AddressResolver.h"
#include "inet/routing/aodv/AodvControlPackets_m.h"
#include "inet/routing/aodv/AodvRouteData.h"

using namespace omnetpp;
using namespace inet;
using namespace inet::aodv;

Define_Module(BaselineAodv);

void BaselineAodv::initialize(int stage)
{
    Aodv::initialize(stage);
    // Aodv sets `host` at INITSTAGE_LOCAL (Aodv.cc:45); the routing table emits
    // these when a route is added or a field of it changes, and the signals
    // reach the host.
    if (stage == INITSTAGE_LOCAL) {
        host->subscribe(routeAddedSignal, this);
        host->subscribe(routeChangedSignal, this);
    }
}

const L3Address& BaselineAodv::sink()
{
    if (sinkAddr.isUnspecified())
        sinkAddr = L3AddressResolver().resolve(par("sinkAddress").stringValue());
    return sinkAddr;
}

// A route this AODV module owns, to the sink, and active.
bool BaselineAodv::isAodvRouteToSink(const IRoute *route)
{
    if (route->getSource() != this)
        return false;
    if (route->getDestinationAsGeneric() != sink())
        return false;
    auto data = dynamic_cast<AodvRouteData *>(route->getProtocolData());
    return data != nullptr && data->isActive();
}

void BaselineAodv::receiveSignal(cComponent *source, simsignal_t signalID, cObject *obj, cObject *details)
{
    if (signalID == routeAddedSignal || signalID == routeChangedSignal) {
        Enter_Method_Silent("route signal");
        auto route = check_and_cast<const IRoute *>(obj);
        if (firstRouteAt < SIMTIME_ZERO && isAodvRouteToSink(route))
            firstRouteAt = simTime();
        return;
    }
    Aodv::receiveSignal(source, signalID, obj, details);
}

void BaselineAodv::socketDataArrived(UdpSocket *socket, Packet *packet)
{
    // Aodv::processPacket pops the same chunk (Aodv.cc processPacket).
    received[packet->peekAtFront<AodvControlPacket>()->getPacketType()]++;
    Aodv::socketDataArrived(socket, packet);
}

void BaselineAodv::finish()
{
    recordScalar("bl:myId", host->getId());
    bool isSink = getSelfIPAddress() == sink();
    recordScalar("bl:isSink", isSink);

    // The AODV route to the sink, if any (one per destination in INET's table).
    IRoute *toSink = nullptr;
    int routes = 0;
    for (int i = 0; i < routingTable->getNumRoutes(); i++) {
        IRoute *r = routingTable->getRoute(i);
        if (r->getSource() != this)
            continue;
        routes++;
        if (r->getDestinationAsGeneric() == sink())
            toSink = r;
    }
    auto data = toSink ? dynamic_cast<AodvRouteData *>(toSink->getProtocolData()) : nullptr;
    bool active = data != nullptr && data->isActive();
    cModule *nextHop = toSink ? L3AddressResolver().findHostWithAddress(toSink->getNextHopAsGeneric()) : nullptr;
    recordScalar("bl:routeFound", toSink != nullptr);
    recordScalar("bl:hasRoute", !isSink && active);
    recordScalar("bl:nextHop", active && nextHop ? nextHop->getId() : -1);
    recordScalar("bl:hopCount", active ? (double)toSink->getMetric() : -1.0);  // AODV keeps the hop count in the metric (Aodv.cc createRoute)
    recordScalar("bl:destSeqNum", active ? (double)data->getDestSeqNum() : -1.0);
    recordScalar("bl:firstRouteAt", firstRouteAt < SIMTIME_ZERO ? -1.0 : firstRouteAt.dbl());
    recordScalar("bl:routes", routes);
    recordScalar("bl:sequenceNum", sequenceNum);
    recordScalar("bl:rreqOriginated", rreqId);  // incremented for every RREQ this node creates (Aodv.cc:411)
    recordScalar("bl:rreqReceived", received[RREQ]);
    recordScalar("bl:rrepReceived", received[RREP]);
    recordScalar("bl:rerrReceived", received[RERR]);
}

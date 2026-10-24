// The baseline's AODV: INET's own inet::aodv::Aodv, unchanged, plus what it does
// not record (Aodv.cc has no recordScalar and no emit): each node's route to the
// sink at the end and when it first had an active one, the RREQs it created and
// the AODV packets it received. A subclass, so libINET stays as it is -- as
// ../v4_mintroute's BaselineMintRoute does for INET's MintRoute. Harness code,
// not generator output (v4 AODV plan, Q11 / step 3).
#ifndef BASELINEAODV_H
#define BASELINEAODV_H

#include <map>

#include "inet/routing/aodv/Aodv.h"

class BaselineAodv : public inet::aodv::Aodv
{
  protected:
    omnetpp::simtime_t firstRouteAt = -1;  // first active AODV route to the sink
    std::map<int, long> received;          // AODV packets received, by packetType
    inet::L3Address sinkAddr;              // resolved on first use (addresses are assigned at init)

    virtual void initialize(int stage) override;
    using inet::aodv::Aodv::receiveSignal;
    virtual void receiveSignal(omnetpp::cComponent *source, omnetpp::simsignal_t signalID,
                               omnetpp::cObject *obj, omnetpp::cObject *details) override;
    virtual void socketDataArrived(inet::UdpSocket *socket, inet::Packet *packet) override;
    virtual void finish() override;

    const inet::L3Address& sink();
    bool isAodvRouteToSink(const inet::IRoute *route);
};

#endif

// MintRoute -- MintRoute's Specific class for structure 4 (step 3g;
// design/NextHop_Extension_Draft.md D12, D14, D16; settled with the user
// 2026-10-13). HAND-WRITTEN case-study code, not generated.
//
// The pattern class diagram's «student-filled» MintRoute
// (design/figures/pattern_class_diagram(1).drawio:115, "ETX parent selection"):
// the generated module plus MintRoute's parent choice, ported from this
// project's INET MintRoute (src/inet/networklayer/mintroute/MintRoute.cc) under
// its own names and constants (D16, Q1 = a):
//   updateNeighborTable / updateEst  the link estimates, every
//                                    estimateToRouteRatio route timers (:417-454)
//   chooseParent / evaluateCost      the ETX parent and its cost (:456-517)
//   sendRouteBroadcast               the route fields on every ROUTE frame this
//                                    node sends (:153-194), Q2 = a
//   onReceiveRoutePkt / onReceiveBeaconPkt
//                                    a neighbour's fields read off its frame
//                                    (:216-247)
// The state lives in MintRouteTable, the fields in MintRoutePkt. The generated
// route timer calls updateNeighborTable() then chooseParent() before it creates
// (MintRoute.cc:120-121). The chosen parent goes into the model's route table
// through its own operation, addEntry(me, sink, parent) (D1, D15; Q11 = a).
//
// The global ::MintRoute coexists with libINET's inet::MintRoute, which
// [Config Baseline] runs in this same executable: Define_Module keys on the
// type name ("MintRoute" vs "inet::MintRoute"), and the wrapper has its own
// name, EbMintRouteNetworkLayer (derive_wrapper.mjs).
#pragma once

#include "EbWsn.h"
#include "MintRoutePkt.h"
#include "MintRouteTable.h"

class MintRoute : public eb_ebwsn::EbWsn, public MintRouteTable
{
  protected:
    // MintRoute.h:115-118, read as MintRoute.cc:43-46 reads them.
    double alpha = 0.75;
    int    linkQtyThreshold = 25;
    int    estimateToRouteRatio = 3;
    int    switchThreshold = 384;

    // The sink's node id: addEntry's destination (Q11).
    eb_ebwsn::Node sinkNode = -1;
    bool isSink = false;

    // What the run test reads (Q12), recorded as mrt:* scalars in finish().
    simtime_t firstParentAt = -1;
    long parentChanges = 0, addEntryCalls = 0, addEntryRefused = 0;
    long routeFieldsRead = 0, routeFieldsMissing = 0;

  public:
    void initialize(int stage) override;
    void finish() override;

  protected:
    void updateNeighborTable() override;
    virtual void updateEst(TableEntry& nbr);
    void chooseParent() override;
    virtual int evaluateCost(int cost, int sendEst, int receiveEst) const;

    // The timer's no-argument overload stays the generated one.
    using eb_ebwsn::EbWsn::sendRouteBroadcast;
    void sendRouteBroadcast(eb_ebwsn::Node x, eb_ebwsn::PktId pkt) override;
    void onReceiveRoutePkt(inet::Packet *packet, const inet::Ptr<const eb_ebwsn::PPkt>& header) override;
    void onReceiveBeaconPkt(inet::Packet *packet, const inet::Ptr<const eb_ebwsn::PPkt>& header) override;
};

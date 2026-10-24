// The baseline -- INET's MintRoute port, compiled into libINET and untouched --
// as a harness subclass, so the baseline can run WITH DATA and its tree can be
// compared with v4's. User, 2026-10-17: Q1 b, Q3 a.
//
// restoreMiximOrder (NED parameter):
//   true  -- a received DATA frame updates the link counters BEFORE the duplicate
//            check, as MiXiM's MintRoute does
//            (archive/MintRouteProj/mixim/src/modules/netw/MintRoute.cc:468-476).
//   false -- the port exactly as it is.
// Why it matters: the port checks for a duplicate first and returns
// (MintRoute.cc:257-266). Its duplicate key is (originator, data, type), with no
// sequence number (:533-544), and it sends every DATA packet with data 0.0
// (:353). So at every node, every DATA packet after a sensor's first is a
// "duplicate" for the rest of the run and never reaches updateNbrCounters.
// Measured on this field, 360 s, port as is: 1 of 8 sensors chose a parent.
//
// Only the ORDER is restored, nothing else: a duplicate is counted and then
// dropped exactly as the port drops it; a frame that is not a duplicate is
// counted by the port's own body, once. The duplicate key, the data value and
// which frames the port counts (MiXiM counts only broadcast DATA; the port
// counts every DATA frame it receives) are left as the port has them.
//
// finish() records bl:* -- the same meanings as MintRoute's mrt:* in v4 -- so
// baseline_tree.mjs and draw_trees.mjs can read the tree.
#pragma once
#include "inet/networklayer/mintroute/MintRoute.h"

class BaselineMintRoute : public inet::MintRoute
{
  protected:
    bool restoreMiximOrder = true;
    inet::L3Address lastParent;
    long parentChanges = 0;
    long countedDuplicates = 0;
    omnetpp::simtime_t firstParentAt = -1;

    virtual void initialize(int stage) override;
    virtual void chooseParent() override;
    virtual void onReceiveSensingPkt(inet::Packet *packet,
                                     const inet::Ptr<const inet::MintRouteHeader>& header) override;
    int nodeIdOf(const inet::L3Address& addr);

  public:
    virtual void finish() override;
};

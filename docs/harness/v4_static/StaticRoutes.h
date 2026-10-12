// StaticRoutes -- the Specific class of step 3f's run test
// (design/NextHop_Extension_Draft.md D12, D13, §7). HAND-WRITTEN HARNESS CODE,
// not generated.
//
// It holds no routing logic. In chooseParent(), the hook the generated module's
// route timer calls just before it creates a ROUTE packet (as MintRoute.cc:120-121
// calls its own), it hands a FIXED list of route entries, read from the ini, to
// the generated route-table operation addEntry until each is accepted. Once, at
// a set time, it gives one entry another next hop (D15). So a failure belongs to
// the generated code.
//
// It is also the test's probe. What it measures is recorded as `static:*`
// scalars, which loop.sh gates on:
//   condition 1  each addEntry result against whether a frame from that next hop
//                has arrived. "Heard" is read off nodeAddress, the arrival's own
//                record (binding code), not off the model's neighbourTbl, which
//                is what addEntry itself tests.
//   condition 2  INET's routing table at finish(): one route to each accepted
//                entry's destination, via its next hop, metric 2; and at least
//                one of them replaced a one-hop route (D5).
//   condition 3  INET's table just before the update and at finish(): the
//                updated destination moved to the new next hop, nothing else
//                changed.
// Expected addresses are resolved from the node's NAME through
// L3AddressResolver, not through the generated addressOfNode (by module id).
#pragma once

#include <map>
#include <string>
#include <utility>
#include <vector>

#include "EbWsn.h"

class StaticRoutes : public eb_ebwsn::EbWsn
{
  protected:
    struct Entry {
        std::string destName, nhName;
        eb_ebwsn::Node dest = -1, nh = -1;
        bool accepted = false;
    };
    std::vector<Entry> entries;

    // The one update (D15).
    std::string updateDestName, updateNhName, oldNhName;
    eb_ebwsn::Node updateNh = -1;
    simtime_t updateAt = -1;
    bool updateApplied = false;

    // INET's table, destination -> every (next hop, metric) routed to it.
    using Table = std::map<std::string, std::vector<std::pair<std::string, int>>>;
    Table beforeUpdate;

    // Probe counters (condition 1, and the D5 branch of condition 2).
    long calls = 0, accepted = 0, refused = 0, mismatch = 0, overrodeOneHop = 0;

    eb_ebwsn::Node nodeIdOf(const std::string& name);
    std::string addressOf(const std::string& name);
    Table tableNow();
    static void parseSpec(const std::string& spec, std::string& dest, std::string& nh);

  public:
    void initialize(int stage) override;
    void finish() override;

  protected:
    void chooseParent() override;
};

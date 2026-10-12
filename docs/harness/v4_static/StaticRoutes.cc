// StaticRoutes -- see StaticRoutes.h. HAND-WRITTEN HARNESS CODE.

#include "StaticRoutes.h"

#include <sstream>

Define_Module(StaticRoutes);

using eb_ebwsn::Node;

void StaticRoutes::parseSpec(const std::string& spec, std::string& dest, std::string& nh)
{
    auto colon = spec.find(':');
    if (colon == std::string::npos || colon == 0 || colon + 1 == spec.size())
        throw cRuntimeError("StaticRoutes: route entry '%s' is not destination:nextHop", spec.c_str());
    dest = spec.substr(0, colon);
    nh = spec.substr(colon + 1);
}

// A node id is its node module's id (the generated module binds ND that way).
Node StaticRoutes::nodeIdOf(const std::string& name)
{
    cModule *node = getContainingNode(this)->getParentModule()->getSubmodule(name.c_str());
    if (node == nullptr)
        throw cRuntimeError("StaticRoutes: no node named '%s' in the network", name.c_str());
    return node->getId();
}

std::string StaticRoutes::addressOf(const std::string& name)
{
    return inet::L3AddressResolver().resolve(name.c_str(), inet::L3AddressResolver::ADDR_MODULEPATH).str();
}

StaticRoutes::Table StaticRoutes::tableNow()
{
    Table t;
    for (int i = 0; i < routingTable->getNumRoutes(); i++) {
        inet::IRoute *r = routingTable->getRoute(i);
        t[r->getDestinationAsGeneric().str()].push_back({r->getNextHopAsGeneric().str(), r->getMetric()});
    }
    return t;
}

void StaticRoutes::initialize(int stage)
{
    EbWsn::initialize(stage);
    if (stage != INITSTAGE_LOCAL)
        return;
    std::istringstream in(par("routes").stdstringValue());
    for (std::string spec; in >> spec;) {
        Entry e;
        parseSpec(spec, e.destName, e.nhName);
        e.dest = nodeIdOf(e.destName);
        e.nh = nodeIdOf(e.nhName);
        entries.push_back(e);
    }
    std::string update = par("update").stdstringValue();
    if (!update.empty()) {
        parseSpec(update, updateDestName, updateNhName);
        updateNh = nodeIdOf(updateNhName);
        updateAt = par("updateAt");
        bool found = false;
        for (const auto& e : entries)
            found = found || e.destName == updateDestName;
        if (!found || updateAt < SIMTIME_ZERO)
            throw cRuntimeError("StaticRoutes: update '%s' needs an entry for that destination and updateAt >= 0",
                                update.c_str());
    }
}

void StaticRoutes::chooseParent()
{
    Table before = tableNow();   // what INET's table holds as this timer fires

    if (!updateDestName.empty() && !updateApplied && simTime() >= updateAt) {
        for (auto& e : entries) {
            if (e.destName != updateDestName)
                continue;
            oldNhName = e.nhName;
            e.nhName = updateNhName;
            e.nh = updateNh;
            e.accepted = false;
        }
        beforeUpdate = before;
        updateApplied = true;
        EV_INFO << "StaticRoutes: update at " << simTime() << ": " << updateDestName
                << " via " << oldNhName << " -> via " << updateNhName << endl;
    }

    for (auto& e : entries) {
        if (e.accepted)
            continue;
        bool heard = nodeAddress.count(e.nh) > 0;
        bool ok = addEntry(myNodeId, e.dest, e.nh);
        calls++;
        if (ok)
            accepted++;
        else
            refused++;
        if (ok != heard) {
            mismatch++;
            EV_WARN << "StaticRoutes: addEntry(" << e.destName << " via " << e.nhName << ") "
                    << (ok ? "accepted" : "refused") << " but the next hop was "
                    << (heard ? "heard" : "not heard") << endl;
        }
        if (ok) {
            // A one-hop route to this destination, about to be replaced (D5).
            auto it = before.find(addressOf(e.destName));
            if (it != before.end() && it->second.size() == 1 && it->second[0].first == it->first)
                overrodeOneHop++;
        }
        e.accepted = ok;
        EV_INFO << "StaticRoutes: addEntry(" << e.destName << " via " << e.nhName << ") "
                << (ok ? "accepted" : "refused") << (heard ? ", heard" : ", not heard") << endl;
    }
}

void StaticRoutes::finish()
{
    EbWsn::finish();
    Table now = tableNow();

    long entriesAccepted = 0, routesWrong = 0;
    for (const auto& e : entries) {
        if (!e.accepted)
            continue;
        entriesAccepted++;
        std::string dest = addressOf(e.destName), gw = addressOf(e.nhName);
        int metric = e.dest == e.nh ? 1 : 2;
        auto it = now.find(dest);
        bool ok = it != now.end() && it->second.size() == 1
                  && it->second[0].first == gw && it->second[0].second == metric;
        if (!ok) {
            routesWrong++;
            EV_WARN << "StaticRoutes: INET's table does not hold " << e.destName << " via " << e.nhName
                    << " (metric " << metric << ")" << endl;
        }
    }
    recordScalar("static:entries", (double)entries.size());
    recordScalar("static:entriesAccepted", entriesAccepted);
    recordScalar("static:calls", calls);
    recordScalar("static:accepted", accepted);
    recordScalar("static:refused", refused);
    recordScalar("static:mismatch", mismatch);
    recordScalar("static:overrodeOneHop", overrodeOneHop);
    recordScalar("static:routesChecked", entriesAccepted);
    recordScalar("static:routesWrong", routesWrong);

    if (!updateDestName.empty()) {
        std::string dest = addressOf(updateDestName);
        auto only = [](const Table& t, const std::string& d, const std::string& gw) {
            auto it = t.find(d);
            return it != t.end() && it->second.size() == 1 && it->second[0].first == gw;
        };
        bool oldInstalled = updateApplied && only(beforeUpdate, dest, addressOf(oldNhName));
        bool newInstalled = updateApplied && only(now, dest, addressOf(updateNhName));
        long othersChanged = 0;
        for (const auto& r : beforeUpdate) {
            if (r.first == dest)
                continue;
            auto it = now.find(r.first);
            if (it == now.end() || it->second != r.second)
                othersChanged++;
        }
        recordScalar("static:updateApplied", updateApplied);
        recordScalar("static:updateOldInstalled", oldInstalled);
        recordScalar("static:updateNewInstalled", newInstalled);
        recordScalar("static:updateOthersChanged", othersChanged);
    }
}

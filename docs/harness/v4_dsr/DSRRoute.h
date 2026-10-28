//
// The DSR baseline (design/V4_DSR_Plan.md section 13): an INET 4.5 network
// protocol shaped on the Final Report's MiXiM DSRRoute (Fig 6.8-6.12, printed
// p.47-51), in the style of this project's INET port of MiXiM MintRoute
// (src/inet/networklayer/mintroute). Its functions carry the printed names;
// the printed bodies (handleUpperMsg Fig 6.9, handleLowerMsg Fig 6.10,
// reverseRoute Fig 6.11) are kept statement by statement where INET allows,
// and every other part says where it comes from.
//
// ⚠ Not an independent baseline: no DSR code exists (advisor, 2026-06-01), so
// this is written from the same sources as the v4 DSR test code. A score
// against it shows how far two readings of those sources agree; only the
// printed statements are the case study's own.
//
// Harness code: not generated, not part of wsn-codegen, libINET untouched.
//

#ifndef __V4_DSR_DSRROUTE_H
#define __V4_DSR_DSRROUTE_H

#include <vector>

#include "inet/common/packet/Packet.h"
#include "inet/networklayer/base/NetworkProtocolBase.h"
#include "inet/networklayer/common/L3Address.h"
#include "inet/networklayer/contract/IArp.h"
#include "inet/networklayer/contract/INetworkProtocol.h"
#include "CTL6.h"
#include "DSRPkt_m.h"

namespace dsrbaseline {

using namespace inet;

class DSRRoute : public NetworkProtocolBase, public INetworkProtocol
{
  public:
    virtual ~DSRRoute() {}

    virtual int numInitStages() const override { return NUM_INIT_STAGES; }
    virtual void initialize(int stage) override;
    virtual void finish() override;

    // The baseline's own protocol, looked up in the current network's group on
    // every call (the generated EbWsn's ebProtocol(), 0d8ad7d): INET deletes a
    // dynamically added protocol with the network.
    static const Protocol *dsrProtocol();
    const Protocol& getProtocol() const override { return *dsrProtocol(); }

    // OperationalBase:
    virtual void handleStartOperation(LifecycleOperation *operation) override {}
    virtual void handleStopOperation(LifecycleOperation *operation) override {}
    virtual void handleCrashOperation(LifecycleOperation *operation) override {}

  protected:
    int headerLength = 0;   // bytes (Fig 6.9: pkt->setByteLength(headerLength))
    ModuleRefByPar<IArp> arp;
    L3Address myNetwAddr;
    L3Address sinkAddress;
    bool stats = true;

    CTL6 ctl6;   // Fig 6.10, 6.11 (Q8)
    simtime_t firstRouteAt = -1;

    // INET entry points, each handing over to the printed function
    virtual void handleUpperPacket(Packet *packet) override { handleUpperMsg(packet); }
    virtual void handleLowerPacket(Packet *packet) override { handleLowerMsg(packet); }

    // the Final Report's DSRRoute (Fig 6.8)
    virtual void handleUpperMsg(Packet *msg);
    virtual void handleLowerMsg(Packet *msg);
    virtual void sendRREQ(const L3Address& finalDestAddr);
    virtual void sendRREP(const L3Address& initialSrcAddr, const std::vector<L3Address>& path);
    virtual std::vector<L3Address> reverseRoute(const std::vector<L3Address>& oldpath, int lastIndex);
    virtual void updateRouteCacheTable(const CTL6::tRouteCache::key_type& origin, const std::vector<L3Address>& path, int hopCount);
    virtual L3Address selectRoute(const L3Address& src, const std::vector<L3Address>& path) const;

    // INET helpers, as the MintRoute port has them
    void sendToNextHop(Packet *packet, const Ptr<DSRPkt>& pkt, const L3Address& nextHop);
    void decapsulate(Packet *packet, const Ptr<const DSRPkt>& pkt);
    void setDownControlInfo(Packet *packet, const MacAddress& macAddr);
    L3Address resolveBroadcast() const;
    static std::vector<L3Address> pathOf(const Ptr<const DSRPkt>& pkt);
    int nodeIndexOf(const L3Address& addr);
};

} // namespace dsrbaseline

#endif

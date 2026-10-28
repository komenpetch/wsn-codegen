//
// The DSR baseline's packet (design/V4_DSR_Plan.md section 13, Q11). Harness
// code, package-less like the rest of this folder.
//
// The Final Report's MiXiM packet (Fig 6.12, printed p.51): `DSRPkt extends
// NetwPkt`, NetwPkt holding destAddr, srcAddr and seqNum, DSRPkt adding
// initialSrcAddr, finalDestAddr, nbHops, path[MAX_PATHLEN], data and
// payloadType. Addresses are L3Address (Q6), as this project's INET port of
// MiXiM MintRoute converted them. Translated to INET 4.5 as that port's
// MintRouteHeader.msg is: a NetworkHeaderBase, plus the payload's protocol and
// length so the data can be handed up to the application.
//
// Not in Fig 6.12 but set by Fig 6.9: isFlood (`pkt->setIsFlood(isFlood)`).
// The path's unused entries are unspecified addresses; MiXiM passes the last
// used index alongside (Fig 6.8, reverseRoute(oldpath, lastIndex)).
//

import inet.common.INETDefs;
import inet.common.Units;
import inet.networklayer.common.L3Address;
import inet.networklayer.common.IpProtocolId;
import inet.networklayer.contract.NetworkHeaderBase;

cplusplus {{
#include "inet/common/ProtocolGroup.h"
}}

// Its own namespace: INET's MintRouteHeader.msg already declares an
// inet::SENSING_PACKET, and the generated accessors use INET names (B,
// unit2string, cValue) unqualified.
namespace dsrbaseline;

cplusplus {{
using namespace inet;
}}

enum DSRPayloadType {
    SENSING_PACKET = 1;
    RREQ_PACKET    = 2;
    RREP_PACKET    = 3;
};

// MAX_PATHLEN = 20: ver66 section 4.1.7, the only value on disk.
enum DSRSizes {
    MAX_PATHLEN = 20;
};

class DSRPkt extends inet::NetworkHeaderBase
{
    // NetwPkt (Fig 6.12)
    inet::L3Address destAddr;
    inet::L3Address srcAddr;
    unsigned long seqNum = 0;
    // DSRPkt (Fig 6.12)
    inet::L3Address initialSrcAddr;
    inet::L3Address finalDestAddr;
    int nbHops = 0;
    inet::L3Address path[MAX_PATHLEN];
    double data = 0.0;
    int payloadType = SENSING_PACKET @enum(DSRPayloadType);
    // set by Fig 6.9, not listed in Fig 6.12
    int isFlood = 0;
    // INET: the payload's protocol and length (MintRouteHeader.msg)
    inet::IpProtocolId protocolId;
    inet::B payloadLengthField;
}

cplusplus(DSRPkt) {{
  public:
    virtual inet::L3Address getSourceAddress() const override { return getSrcAddr(); }
    virtual void setSourceAddress(const inet::L3Address& address) override { setSrcAddr(address); }
    virtual inet::L3Address getDestinationAddress() const override { return getDestAddr(); }
    virtual void setDestinationAddress(const inet::L3Address& address) override { setDestAddr(address); }
    virtual const inet::Protocol *getProtocol() const override { return inet::ProtocolGroup::getIpProtocolGroup()->findProtocol(getProtocolId()); }
    virtual void setProtocol(const inet::Protocol *protocol) override { setProtocolId(static_cast<inet::IpProtocolId>(inet::ProtocolGroup::getIpProtocolGroup()->getProtocolNumber(protocol))); }
    virtual bool isFragment() const override { return false; }
}}

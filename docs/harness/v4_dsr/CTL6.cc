//
// The DSR baseline's controller: see CTL6.h. Each event names its source:
// "RTMCS" = the RTMCS M6 event of the same name (flattened), with its route
// tables replaced by the path and the route cache (plan section 13, Q3);
// "Fig n" = the Final Report figure; "Q16" = a choice of the plan where no
// source decides.
//

#include "CTL6.h"

namespace dsrbaseline {

static bool isData(int payloadType) { return payloadType == SENSING_PACKET; }

// RTMCS receive_dup_*: the packet is in floodTbl
bool CTL6::isDuplicated() const
{
    return floodTbl.count(std::make_tuple(pkt->getInitialSrcAddr(), isData(pkt->getPayloadType()), pkt->getSeqNum())) > 0;
}

void CTL6::recordSeen()
{
    floodTbl.insert(std::make_tuple(pkt->getInitialSrcAddr(), isData(pkt->getPayloadType()), pkt->getSeqNum()));
}

// RTMCS create_dataPkt: a new number from dataSeqNo; the creator has seen it
void CTL6::create_dataPkt()
{
    pkt->setSeqNum(++dataSeqNo);
    recordSeen();
    dataCreated++;
}

// DSR only (Fig 6.8): the cached path copied into the packet
void CTL6::set_DATAPath_init()
{
    for (int i = 0; i < MAX_PATHLEN; i++)
        pkt->setPath(i, L3Address());
}

void CTL6::set_DATAPath_loop(int i, const L3Address& entry)
{
    pkt->setPath(i, entry);
}

// RTMCS start_tx_dataPkt_bct: no route, sent by broadcast
void CTL6::start_tx_dataPkt_bct()
{
    pkt->setIsFlood(1);
    dataSentFlood++;
}

// RTMCS start_tx_dataPkt_fwd: sent to the next hop of the route
void CTL6::start_tx_dataPkt_fwd()
{
    pkt->setIsFlood(0);
    dataSentPath++;
}

// RTMCS create_rreq: a new number from floodSeqNo; FUN-3a: the route record
// starts with the originator
void CTL6::create_rreq()
{
    pkt->setSeqNum(++floodSeqNo);
    for (int i = 0; i < MAX_PATHLEN; i++)
        pkt->setPath(i, L3Address());
    pkt->setPath(0, myNetwAddr);
    pkt->setNbHops(0);
    recordSeen();
    rreqOriginated++;
}

void CTL6::start_tx_rreq()
{
}

// RTMCS create_rrep: the destination mints its own packet with its own number
// from floodSeqNo (Q16: an RREP is recognised by the sink and that number)
void CTL6::create_rrep(const L3Address& initialSrcAddr)
{
    pkt->setSeqNum(++floodSeqNo);
    pkt->setFinalDestAddr(initialSrcAddr);
    pkt->setNbHops(0);
    recordSeen();
    rrepSent++;
}

// DSR only (Fig 6.8): the RREP carries the reversed route record
void CTL6::set_RREPPath_init()
{
    for (int i = 0; i < MAX_PATHLEN; i++)
        pkt->setPath(i, L3Address());
}

void CTL6::set_RREPPath_loop(int i, const L3Address& entry)
{
    pkt->setPath(i, entry);
}

void CTL6::start_tx_rrep()
{
}

// RTMCS receive_dataPkt: seen, and passed on by this node
void CTL6::receive_dataPkt()
{
    recordSeen();
    pkt->setSrcAddr(myNetwAddr);
    pkt->setNbHops(pkt->getNbHops() + 1);
    dataForwarded++;
}

// RTMCS dest_recv_dataPkt: seen, and delivered here
void CTL6::dest_recv_dataPkt()
{
    recordSeen();
    if (pkt->getIsFlood())
        dataReceivedFlood++;
    else
        dataReceivedPath++;
    dataReceivedFrom[pkt->getInitialSrcAddr()]++;
}

// RTMCS receive_rreqPkt: seen, hop count + 1; FUN-3a: this node appends
// itself to the route record, and the flood stops at the maximum hop count
// (Q16: MAX_PATHLEN, a full record is not forwarded)
bool CTL6::receive_rreqPkt()
{
    recordSeen();
    int next = pkt->getNbHops() + 1;
    if (next >= MAX_PATHLEN) {
        hopLimitDrops++;
        return false;
    }
    pkt->setPath(next, myNetwAddr);
    pkt->setNbHops(next);
    pkt->setSrcAddr(myNetwAddr);
    rreqForwarded++;
    return true;
}

// RTMCS dest_recv_rreqPkt: seen; FUN-3a: the destination appends itself too,
// so the reversed record starts at it. False when the record is full (Q16).
bool CTL6::dest_recv_rreqPkt()
{
    recordSeen();
    int next = pkt->getNbHops() + 1;
    if (next >= MAX_PATHLEN) {
        hopLimitDrops++;
        return false;
    }
    pkt->setPath(next, myNetwAddr);
    pkt->setNbHops(next);
    rreqAnswered++;
    return true;
}

// RTMCS receive_rrepPkt: seen, and passed on along its route
void CTL6::receive_rrepPkt()
{
    recordSeen();
    pkt->setSrcAddr(myNetwAddr);
    pkt->setNbHops(pkt->getNbHops() + 1);
    rrepForwarded++;
}

// RTMCS dest_recv_rrepPkt: seen, and taken by the originator
void CTL6::dest_recv_rrepPkt()
{
    recordSeen();
    rrepReceived++;
}

// Fig 6.7
void CTL6::reverse_path_init()
{
    reversePath.clear();
}

void CTL6::reverse_path_loop(const L3Address& entry, int lastIndex)
{
    reversePath.push_back(entry);
}

// RTMCS add_fwdrouteEntry: a route is added only when none exists
// (y |-> s not in fwdRouteTbl); Q16: the first cached path is kept
bool CTL6::update_RouteCacheTbl_init(const L3Address& origin)
{
    if (routeCache.count(origin) > 0)
        return false;
    routeCache[origin].clear();
    return true;
}

void CTL6::update_RouteCacheTbl_loop(const L3Address& origin, const L3Address& entry)
{
    routeCache[origin].push_back(entry);
}

} // namespace dsrbaseline

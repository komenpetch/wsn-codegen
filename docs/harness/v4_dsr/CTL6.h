//
// The DSR baseline's controller (design/V4_DSR_Plan.md section 13, Q8): the
// object the Final Report's MiXiM DSRRoute holds as `ctl6` and calls by event
// name (Fig 6.10: ctl6.isDuplicated(), ctl6.receive_rreqPkt(), ...; Fig 6.11:
// ctl6.reverse_path_loop(oldpath[j], lastIndex)). In the Final Report it is
// CTL6, generated from M6 (Fig 6.6); only reverse_path_loop of it is printed
// (Fig 6.7). The other events are written from RTMCS M6's events of the same
// name with the route tables replaced by the path and the route cache (Q3),
// and from the choices of Q16. Each event says where it comes from.
//
// Harness code: not generated, not part of wsn-codegen.
//

#ifndef __V4_DSR_CTL6_H
#define __V4_DSR_CTL6_H

#include <map>
#include <set>
#include <tuple>
#include <vector>

#include "inet/common/Ptr.h"
#include "inet/networklayer/common/L3Address.h"
#include "DSRPkt_m.h"

namespace dsrbaseline {

using inet::L3Address;
using inet::Ptr;

class CTL6
{
  public:
    // Q12: handleLowerMsg hands the packet to ctl6 at its top, and the events
    // read and change it there. The shell sets it before every event call.
    Ptr<DSRPkt> pkt;

    // the route cache: destination -> whole path, originator first (Q10, Q16)
    typedef std::map<L3Address, std::vector<L3Address>> tRouteCache;
    tRouteCache routeCache;

    // reverse_path_init / reverse_path_loop build this (Fig 6.7, 6.11)
    std::vector<L3Address> reversePath;

    // counters, recorded as bl:* scalars by the shell
    long dataCreated = 0, dataSentFlood = 0, dataSentPath = 0, dataForwarded = 0;
    long dataReceivedPath = 0, dataReceivedFlood = 0;
    std::map<L3Address, long> dataReceivedFrom;
    long rreqOriginated = 0, rreqForwarded = 0, rreqAnswered = 0;
    long rrepSent = 0, rrepForwarded = 0, rrepReceived = 0;
    long duplicatesDropped = 0, hopLimitDrops = 0, notOnPath = 0;

    void init(const L3Address& me, const L3Address& sink) { myNetwAddr = me; sinkAddress = sink; }

    // the duplicate test (Fig 6.10)
    bool isDuplicated() const;

    // handleUpperMsg (Fig 6.8): create_dataPkt || set_DATAPath_init ||
    // set_DATAPath_loop || start_tx_dataPkt_bct || start_tx_dataPkt_fwd
    void create_dataPkt();
    void set_DATAPath_init();
    void set_DATAPath_loop(int i, const L3Address& entry);
    void start_tx_dataPkt_bct();
    void start_tx_dataPkt_fwd();

    // sendRREQ (Fig 6.8): create_rreq || start_tx_rreq
    void create_rreq();
    void start_tx_rreq();

    // sendRREP (Fig 6.8): create_rrep || set_RREPPath_init/loop || start_tx_rrep
    void create_rrep(const L3Address& initialSrcAddr);
    void set_RREPPath_init();
    void set_RREPPath_loop(int i, const L3Address& entry);
    void start_tx_rrep();

    // handleLowerMsg (Fig 6.8, 6.10)
    void receive_dataPkt();
    void dest_recv_dataPkt();
    bool receive_rreqPkt();
    bool dest_recv_rreqPkt();
    void receive_rrepPkt();
    void dest_recv_rrepPkt();

    // reverseRoute (Fig 6.8, 6.11): reverse_path_init || reverse_path_loop
    void reverse_path_init();
    void reverse_path_loop(const L3Address& entry, int lastIndex);

    // updateRouteCacheTable (Fig 6.8): update_RouteCacheTbl_init || _loop
    bool update_RouteCacheTbl_init(const L3Address& origin);
    void update_RouteCacheTbl_loop(const L3Address& origin, const L3Address& entry);

  protected:
    L3Address myNetwAddr;
    L3Address sinkAddress;
    unsigned long floodSeqNo = 0;   // RREQ and RREP (RTMCS floodSeqNo, Q16)
    unsigned long dataSeqNo = 0;    // data (RTMCS dataSeqNo, Q16)

    // packets seen: RTMCS floodTbl, one per node; a packet is its originator,
    // its counter (control or data) and its number
    std::set<std::tuple<L3Address, bool, unsigned long>> floodTbl;
    void recordSeen();
};

} // namespace dsrbaseline

#endif

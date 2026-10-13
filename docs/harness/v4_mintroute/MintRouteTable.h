// MintRouteTable -- MintRoute's ETX state (step 3g; user 2026-10-13, Q10 = b,
// Q14 = b). HAND-WRITTEN Specific class of the Route Table column, not generated.
//
// The pattern class diagram's «ETX state» MintRouteTable
// (design/figures/pattern_class_diagram(1).drawio:149: parent, cost, receiveEst,
// sendEst, liveliness). It sits UNDER the generated PRouteTable, virtually, as the
// generated module does, so the two share ONE table: the neighbour set and the
// counters the model keeps (neighbourTbl, received, lastSeqno) are read from
// PRouteTable, never copied here.
//
// What is here is the rest of INET MintRoute's TableEntry (MintRoute.h:78-91) --
// the per-neighbour state MintRoute works out from those counts -- and this
// node's own route (MintRoute.h:123-129). TableEntry's received and missed are
// the last estimate window's, worked out from the model's counters, so each entry
// also keeps those counters as they stood at its last estimate (Q5 = a; Q13 = a:
// 0 before the first): generated state is read, never written outside an event
// (D1). The baseline counts them itself and zeroes them at every estimate
// (MintRoute.cc:436-437).
//
// ⚠ Two names one letter apart: PRouteTable's neighbourTbl is the MODEL's
// neighbour set (Event-B), this neighborTbl is MintRoute's per-neighbour table
// (MintRoute.h:104). Both kept, each under its own source's name.
#pragma once

#include <map>

#include "EbWsn.h"

class MintRouteTable : public virtual eb_ebwsn::PRouteTable
{
  protected:
    // MintRoute.h:65-76
    enum NbrFlags {
        NBRFLAG_VALID    = 0x0001,
        NBRFLAG_NEW      = 0x0002,
        NBRFLAG_EST_INIT = 0x0004
    };
    enum {
        LIVELINESS = 5,
        ROUTE_INVALID_INT = 0xffff
    };

    struct TableEntry {
        eb_ebwsn::Node id = -1;
        eb_ebwsn::Node parent = eb_ebwsn::BROADCAST;
        int       cost = ROUTE_INVALID_INT;
        int       childLiveliness = 0;
        int       missed = 0;      // the last window's (updateEst)
        int       received = 0;    // the last window's (updateEst)
        int       flags = 0;
        int       liveliness = 0;
        int       hop = ROUTE_INVALID_INT;
        int       receiveEst = 0;
        int       sendEst = 0;
        // The model's counters for this link at the last estimate (Q5, Q13).
        int       receivedAtEst = 0;
        int       lastSeqnoAtEst = 0;
    };

    typedef std::map<eb_ebwsn::Node, TableEntry> NeighborTable;
    NeighborTable neighborTbl;

    // This node's route. BROADCAST (-1) is "no parent yet", where the baseline
    // uses an unspecified L3Address (MintRoute.h:122).
    eb_ebwsn::Node gpCurrentParent = eb_ebwsn::BROADCAST;
    int gbCurrentHopCount = ROUTE_INVALID_INT;
    int gbCurrentCost = ROUTE_INVALID_INT;
    int gwEstTicks = 0;

    // MintRoute's findOrCreateEntry + newEntry (MintRoute.cc:552-582). Not under
    // those names: the generated module already has findOrCreateEntry() and
    // newEntry(Node, Node) -- the model's add_newEntry under MintRoute's names
    // (D16) -- and the same name in two bases is ambiguous in MintRoute.
    TableEntry& entryOf(eb_ebwsn::Node id)
    {
        auto it = neighborTbl.find(id);
        if (it != neighborTbl.end())
            return it->second;
        TableEntry& e = neighborTbl[id];
        e.id              = id;
        e.flags           = NBRFLAG_VALID | NBRFLAG_NEW;
        e.liveliness      = 0;
        e.parent          = eb_ebwsn::BROADCAST;
        e.cost            = 0;
        e.childLiveliness = 0;
        e.hop             = 0;
        e.missed          = 0;
        e.received        = 0;
        e.receiveEst      = 0;
        e.sendEst         = 0;
        return e;
    }
};

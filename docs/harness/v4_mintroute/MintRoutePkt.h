// MintRoutePkt -- MintRoute's ROUTE packet (step 3g; user 2026-10-13, Q7 = a,
// Q15 = b). HAND-WRITTEN Specific class of the Packet column, not generated.
//
// The generated RoutePkt (the ROUTE leaf of the model's packet types, under
// PPkt) plus the fields MintRoute's route broadcast carries and the model does
// not (design/NextHop_Extension_Draft.md §8): this node's hop count, parent and
// cost, and its estimate list. Name and fields are MiXiM MintRoute's own
// (archive/MintRouteProj/mixim/src/modules/messages/MintRoutePkt.msg:24-28,
// :45, :54-57); ids are node ids, ints, as MiXiM's are. They travel inside the
// one chunk, whose length the transmit sets, as INET's port keeps them inside
// its one fixed-length header (MintRoute.cc:157, :163-188).
#pragma once

#include "EbWsn.h"

struct RPEstEntry
{
    eb_ebwsn::Node id = -1;   // a neighbour of the sender
    int receiveEst = 0;       // how well the sender hears that neighbour (0-255)
};

class MintRoutePkt : public eb_ebwsn::RoutePkt
{
  public:
    static const int MAX_RPESTENTRIES = 10;   // MintRoutePkt.msg:34

  protected:
    int hopCount = 0;
    eb_ebwsn::Node parent = eb_ebwsn::BROADCAST;
    int cost = 0;
    int estEntries = 0;
    RPEstEntry estList[MAX_RPESTENTRIES];

  public:
    MintRoutePkt() = default;
    MintRoutePkt(const MintRoutePkt& other) = default;
    // From the packet the model made: its fields, set one by one through PPkt's
    // own setters. ⚠ NOT by assigning the PPkt part: inet::Chunk declares no
    // assignment, so the implicit one would copy the chunk's id and flags and
    // FieldsChunk's serializedBytes pointer, which INET's copy constructor
    // deliberately does not (Chunk.cc:22-27, FieldsChunk.cc:22-26). loop.sh
    // refuses to build if PPkt has a setter this does not call.
    explicit MintRoutePkt(const eb_ebwsn::PPkt& held)
    {
        setType(held.getType());
        setInitialSrcAddr(held.getInitialSrcAddr());
        setFinalDestAddr(held.getFinalDestAddr());
        setFwdrAddr(held.getFwdrAddr());
        setData(held.getData());
        setSeqNum(held.getSeqNum());
        setNetSeqNo(held.getNetSeqNo());
        setPktNextHop(held.getPktNextHop());
    }
    virtual MintRoutePkt *dup() const override { return new MintRoutePkt(*this); }

    int getHopCount() const { return hopCount; }
    void setHopCount(int v) { handleChange(); hopCount = v; }
    eb_ebwsn::Node getParent() const { return parent; }
    void setParent(eb_ebwsn::Node v) { handleChange(); parent = v; }
    int getCost() const { return cost; }
    void setCost(int v) { handleChange(); cost = v; }
    int getEstEntries() const { return estEntries; }
    void setEstEntries(int v) { handleChange(); estEntries = v; }
    // The array accessors as the message compiler names them for MintRouteHeader,
    // which the baseline's reading loop uses (MintRoute.cc:236).
    size_t getEstListArraySize() const { return MAX_RPESTENTRIES; }
    const RPEstEntry& getEstList(size_t i) const { return estList[i]; }
    void setEstList(size_t i, const RPEstEntry& e) { handleChange(); estList[i] = e; }
};

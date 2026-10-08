# wsn-codegen

Generates OMNeT++/INET network modules from pattern-based Event-B models of
wireless sensor networks. The terms below are the ones the 4×4 pattern class
diagram uses, as settled in design sessions.

## Language

### Pattern classes

**PRouteTable**:
The generated route-table class of the pattern class diagram. It holds both the
neighbour table and the route entries.
_Avoid_: using PRouteTable for the neighbour table alone; "Tier B", "Tier C"

**RouteTableBase**:
The generated class beneath PRouteTable that publishes route entries into INET's
own routing table. PRouteTable is the table the model reasons about; RouteTableBase
is how the simulator sees it.
_Avoid_: routing table (alone), IRoutingTable (that is INET's interface)

**Specific class**:
The hand-written class for one case study (MintRoute, AODV/RTMCS, DSR) that
decides which routes exist. It extends the generated classes and never replaces them.
_Avoid_: student code, protocol class

**Route-table operation**:
A generated operation of PRouteTable that adds, invalidates or removes a route
entry. A Specific class changes route entries only through these.
_Avoid_: route update; installRoute (that is RouteTableBase publishing an entry
into INET's table, not a change to the entry)

### Routes and addressing

**Neighbour table**:
The nodes this node has heard from, with the counters kept per link.
_Avoid_: route table, routing table

**Route entry**:
A final destination this node knows how to reach, with the next hop to send through
and whether the entry is still valid.
_Avoid_: route (alone), parent

**Next hop**:
The neighbour a route entry sends through.
_Avoid_: parent (MintRoute's word for one particular choice of next hop)

**Packet next hop**:
The node a packet in flight is addressed to for its current hop, or BROADCAST when
it has none.
_Avoid_: destination address (MintRoute's `pktDestAddr` and RTMCS's `netDestAddr`
both hold a packet next hop, not a final destination)

**Final destination**:
The node a data packet is ultimately meant for.
_Avoid_: dest, destination address

# The model is one machine for the whole network; the module is one node

**Found 2026-09-07**, by running rather than by reading — after the sink's
complete send chain fired and still reached nobody.

This is not a missing rule. Nothing about it is fixed by translating another
clause. It is a question about how a global Event-B machine is realised across
distributed simulation modules, and it decides what the generator can claim.

---

## 1. What the run shows

With the identity bindings, the scheduler and G5 in place, MintRoute M4 runs 60 s
and the **sink** executes its entire send chain:

```
sink   start_flooding      1
       create_bconPkt     60
       start_tx_bconPkt   60
       send_down          60
       find_neighbours     1
       assign_forwarder   60
```

Every sensor, meanwhile, fires only the environment events:

```
sensor1/2/3   add_link 12   disconnect_link ~60   recover_link ~60
              start_flooding 1
```

No sensor ever executes `receive_controlPkt`. Sixty beacon packets are created
and pushed all the way to the point of delivery, and none is received.

## 2. Why — the shape of the model

Every state variable in the model is indexed by node. These are the medium and
buffer variables the delivery chain moves a packet through:

```
WiMedium      ∈ ND ↔ PKT
ndBuff        ∈ ND ↔ PKT
sentUp        ∈ ND ↔ PKT
sentDown      ∈ ND ↔ PKT
ctlNeighbours ∈ PKT ↔ (ND ∪ {FAILED_XMIT})
```

`ndBuff` is not "this node's buffer". It is **every node's buffer**, as one
relation, with the node as the first component. The machine describes the whole
network as a single state space, and node identity is an index into it. That is
completely normal for an Event-B model — it is what makes the invariants
expressible.

The generated module is one C++ class **per node**, and the emitter makes each
variable a member. So every node instance carries its own private copy of a
structure that was meant to be the network's.

The sink's `assign_forwarder` writes the sink's `ctlNeighbours`. Sensor1's
`receive_controlPkt` reads sensor1's `ctlNeighbours`, which is empty and always
will be. The two nodes are running the same machine over disjoint state.

**No translation rule can bridge that.** The clause translated correctly; the
state it names simply is not shared.

## 3. Which variables are which

The distinction that matters is not global-vs-local in general, but which
variables model the **medium** and which model **a node's own memory**:

| kind | variables | who should own them |
|---|---|---|
| medium / in flight | `WiMedium`, `channel`, `ctlNeighbours`, `sentUp`, `sentDown` | the simulator's radio and sockets |
| node memory | `floodTbl`, `floodFlg`, `floodSeqNo`, `nbHops`, `ndBuff` | the module, per node — as now |

The medium variables are the ones INET **already implements**, in far more
detail than the model does (propagation, interference, collisions). Keeping a
private copy of them per module is not merely unshared, it is redundant with the
simulator.

## 4. The options

**(a) One module owns the whole machine.** Emit a single network-wide module
holding the state and running every node's events. Maximally faithful to the
model, and worthless as a network layer: it is not a protocol implementation,
cannot be deployed per host, and cannot use the simulator's radio at all.

**(b) Per-node modules, medium realised by the simulator.** Keep node memory in
the module. Realise the medium variables through INET: a transmit event hands
the chunk to the socket, and an arriving packet is mapped back into the
receiving node's model state, which then enables its receive events. The
`EXTENSION POINT`s already in the emitted code are exactly this seam.

**(c) Share the medium variables as process-global state.** File-scope instead
of members. It would make the flood propagate today, in one process, and it
would be a lie: nothing is transmitted, no radio is involved, range and
collisions do not exist, and it could never run distributed. It would also
produce a very convincing green run — which is the failure mode this project
exists to avoid.

**(b) is the only honest answer**, and it is already the shape of the app layer:
`sendSensorPacket → socket → socketDataArrived` is precisely a medium variable
realised by the simulator rather than by a member.

## 5. What this means for the claim

The generator can say, with evidence, that it translates a network-layer
Event-B machine into a module that compiles, loads, runs, and **executes the
model's own events** — 21 of 40 schedulable, the sink's full create-to-deliver
chain firing 60 times over 60 s.

It cannot yet say the protocol runs, because the medium is not bound. Between
those two statements sits one design decision, not a backlog of rules.

The remaining work is also now bounded and nameable: bind the medium. That is
the third and last of the identity bindings this layer needed — after
`PktId → PPkt` (packet identity) and `ND → simulation nodes` (node identity),
the medium binding maps `WiMedium`/`ctlNeighbours` to INET's radio and sockets.
Each of the first two turned a documented "remaining hand step" into generator
capability; this is the same kind of step, and the last one in the chain.

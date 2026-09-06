# How flooding works in MintRoute — the C++ source, and the Event-B model

**Studied 2026-09-07**, before wiring a driver, to settle how a node learns its
own identity and which node is the sink. It settled that — and turned up
something more important.

Sources read in full: `Simulation/inet4.5/src/inet/networklayer/mintroute/MintRoute.cc`
(625 lines) and the flattened Event-B events of `MintRoute_3_2_5_9_complete_amiCheck`
M4 (`npm run event -- MintRoute M4 <label> --flat`).

---

## 1. The question I went in with: node identity and the sink

Answered, and my working assumption was **wrong**.

```cpp
// INITSTAGE_NETWORK_LAYER
sinkAddress = L3AddressResolver().resolve(par("sinkAddress"));
if (auto ie = interfaceTable->findFirstNonLoopbackInterface())
    myNetwAddr = ie->getNetworkAddress();
else
    throw cRuntimeError("MintRoute: no non-loopback interface found");
...
if (myNetwAddr == sinkAddress) { /* I am the root */ }
```

- A node's identity is **its first non-loopback interface's network address**,
  resolved at `INITSTAGE_NETWORK_LAYER` — not a module index, not a NED index.
- The sink test is a genuine **address comparison**, `myNetwAddr == sinkAddress`,
  with `sinkAddress` resolved from a NED parameter every node carries.

I had assumed the harness convention "`sinkAddress = ""` means I am the sink".
That is not how the reference does it, and building it into the generator would
have baked a harness quirk into a pattern-based tool.

## 2. What MintRoute.cc actually does

Two independent periodic broadcasts, both driven from `handleSelfMessage`:

```cpp
SEND_BEACON_FLOOD_TIMER -> sendBeaconBroadcast();  reschedule
SEND_ROUTE_FLOOD_TIMER  -> updateNeighborTable(); chooseParent();
                           sendRouteBroadcast();  reschedule
```

- **Beacon flood — sink only.** Scheduled only when
  `beaconFloodsInterval > 0 && myNetwAddr == sinkAddress`. Neighbours use it for
  link estimation.
- **Route broadcast — every node.** Scheduled whenever `routeFloodsInterval > 0`,
  the sink going first (`+1.0s`) and everyone else later (`+5.0s`). Carries
  `parent`, `hopCount`, `cost`, and a list of per-neighbour `receiveEst`.

**Neither control packet is ever rebroadcast.** Both receive handlers end the
same way:

```cpp
void MintRoute::onReceiveRoutePkt(...)  { ...updateNbrCounters...; delete packet; }
void MintRoute::onReceiveBeaconPkt(...) { updateNbrCounters(...);   delete packet; }
```

The routing tree does not form by a packet travelling outward. It forms because
every node *re-advertises its own summary every period*, so an improved
`hopCount` propagates one hop per round. That is a periodic distance-vector
advertisement, not a flood.

The only thing MintRoute.cc forwards is DATA (`onReceiveSensingPkt`): if
`finalDest == myNetwAddr` it goes up, otherwise it is re-headed toward the
current parent, with duplicate suppression by `isDuplicate` over `rcvedPktTbl`.

## 3. What the Event-B model does — and it is NOT the same

The model implements a textbook flood with per-node duplicate suppression.
`floodTbl(nb)` is the "already seen at node nb" set, and it splits reception in
two:

```
receive_controlPkt        when  nb ∈ dom(floodTbl) ∧ pkt ∉ floodTbl(nb)
                          then  floodTbl(nb) ≔ floodTbl(nb) ∪ {pkt}
                                ndBuff ≔ ndBuff ∪ {nb ↦ pkt}      ← re-queued!
receive_dup_controlPkt    when  nb ∈ dom(floodTbl) ∧ pkt ∈ floodTbl(nb)
                          then  ctlNeighbours ≔ ctlNeighbours ∖ {pkt ↦ nb}
                                                                   ← dropped
```

`ndBuff` is exactly what enables `start_tx_bconPkt` / `start_tx_routePkt`
(`x ↦ pkt ∈ ndBuff`). So in the model a freshly-seen control packet **is
retransmitted by the receiving node**, and a repeat is swallowed. Multi-hop
flooding, terminated by `floodTbl`.

## 4. The two disagree, and that is the finding

| | Event-B model (M4) | INET MintRoute.cc |
|---|---|---|
| control-plane strategy | multi-hop flood | periodic one-hop advertisement |
| receiver rebroadcasts? | **yes**, via `ndBuff` | **no**, `delete packet` |
| duplicate suppression | `floodTbl(nb)`, per node | `rcvedPktTbl`, DATA only |
| what carries the tree | the flooded packet | repeated own-summary broadcasts |

This is not a defect in either. They are two designs for the same goal, and the
model is closer to WiseRoute (which does keep a `floodTable` and rebroadcast)
than to the C++ MintRoute it is named after.

### Consequences

1. **The generator must follow the model, not MintRoute.cc.** The generated
   module's job is to be the model. A flood run is therefore the right thing to
   aim for, and `floodTbl` earns its place.

2. **MintRoute.cc is not a behavioural baseline for the control plane.** I
   previously offered it as "the reference of the same scope", the network-layer
   counterpart of `SensorApp.cc` — the thing to compare packet counts against.
   That holds for DATA forwarding. For beacons and route packets it does not:
   comparing counts would be comparing two different algorithms and reading the
   difference as a generator defect. Corrected here.

3. **The node identity binding should follow §1** — interface address plus an
   address comparison against a resolved `sinkAddress` — because that is how a
   real INET network-layer module does it, and it needs no harness convention.

4. **The driver is the timer.** MintRoute.cc's whole control plane is two
   scheduled self-messages. The generated scheduler already runs off the existing
   periodic timer, so the shape matches; what it still lacks is a populated `ND`.

## 5. What this does not tell us

Whether the model's flood terminates in a network of this size and radio
model — `floodTbl` bounds it per node, but the run itself has not happened yet.
That is the measurement to make once node identity is bound, and it is the point
at which the model's strategy, not MintRoute.cc's, is what gets checked.

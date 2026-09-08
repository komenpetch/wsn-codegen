# The generated module becomes a network protocol

**2026-09-08**, on advisor direction: shape the generated module after INET's
MintRoute — its `sendBeaconBroadcast()` / `sendRouteBroadcast()` methods
included — and now that the work is in the network layer, import
`NetworkProtocolBase` rather than staying an application. AODV was named as a
second reference and explicitly not the one to follow: it is written in a
different style.

The behaviour did not change — the flood still reaches sensor3 in three hops —
but the stack under it got shorter and two workarounds disappeared.

---

## 1. Which base class, and why the class diagram was wrong

The 4-category class diagram says `RoutingProtocolBase`. INET 4.5's own two
implementations of the two shapes disagree, and that disagreement is the answer:

```
MintRoute : NetworkProtocolBase, INetworkProtocol
    A protocol module IN the stack. Packets arrive at handleLowerPacket, leave
    through sendDown, and the module carries data itself.

Aodv      : RoutingProtocolBase, NetfilterBase::HookBase, UdpSocket::ICallback
    A routing DAEMON over UDP. It edits a routing table through netfilter hooks
    and never carries a data packet.
```

The machines hold packets in `ndBuff`, put them on a medium, receive other
nodes' packets and decide whether to forward them. They forward packets; a
routing daemon does not. `NetworkProtocolBase` — which is also what the advisor
directed, and what this project's own MintRoute port uses.

This closes a conflict the notes had carried since 2026-06-12, and it is why the
earlier rounds could say "PPkt dodged it; PRouteTable cannot".

## 2. What is mirrored from MintRoute

Structure, method for method:

| MintRoute | the generated shell |
|---|---|
| three init stages: LOCAL (parameters, timers), NETWORK_INTERFACE_CONFIGURATION (module-path addresses), NETWORK_LAYER (resolve addresses, start timers) | the same three, for the same reasons |
| `beaconFloodTimer` / `routeFloodTimer` self-messages | one `modelTimer`, driving `runEnabledEvents()` |
| `handleUpperPacket` / `handleLowerPacket` | the same two, with the medium binding filling the lower one |
| `sendBeaconBroadcast()` / `sendRouteBroadcast()` | one method per packet type, named the same way |
| `setDownControlInfo(packet, MacAddress::BROADCAST_ADDRESS)` then `sendDown` | verbatim in shape |
| `resolveBroadcast()` off `myNetwAddr.getAddressType()` | verbatim |
| `MintRouteNetworkLayer.ned` wrapper (ARP + dispatcher) | `<Name>NetworkLayer`, in the same .ned — the output contract is three files |

The per-type method names are derived, not listed: the packet-type lattice gives
the leaves, so MintRoute's model produces `sendBeaconBroadcast` /
`sendRouteBroadcast` / `sendDataBroadcast`, and RTMCS's produces
`sendRreqBroadcast` / `sendRrepBroadcast` / `sendRrerBroadcast` from its own
partition. Which one runs is decided by the packet's own type at transmit time.

## 3. What the harness stops needing

The app-layer route needed IPv4 underneath, `limitedBroadcast = true` to stop
Ipv4 silently dropping the model's broadcasts, and a deliberate choice not to
use WiseRoute because it re-floods broadcasts itself and the model's flood would
have been riding on it. As a network protocol the module sits directly above the
MAC. None of that applies: no IPv4, no workaround, no other protocol in the
path, and `numApps = 0` because the machine creates its own packets.

That is worth stating plainly: the previous round's harness was three
configuration decisions deep in workarounds for being in the wrong layer.

## 4. Two defects found by running it

**`Unknown protocol: id = 56, name = manet`**, from SMAC. The MAC carries the
network protocol as an ETHERTYPE in both directions (`Smac.cc` uses the ethertype
group to encode on send and decode on receive), and INET's generic `manet`
protocol has an IP protocol number but no ethertype. The module now carries its
own identity — `eventb`, ethertype 0x86FB, in INET's own non-standard block
beside mintRoute (0x86FC) and wiseRoute (0x86FE) — registered through
`ProtocolGroup::addProtocol`, a public API, so no INET table is edited.
Borrowing `Protocol::mintRoute` was rejected: it would put a false protocol
identity on the wire for every model that is not MintRoute.

**Heap corruption at teardown** (exit 0xC0000374) — after the run had finished
and written its results, which is the kind of failure that is easy to wave off.
`ProtocolGroup::addProtocol` takes OWNERSHIP; its own comment says "assume it
was dynamically allocated" and `~ProtocolGroup` deletes what it was given. The
Protocol had been a static member, so INET deleted a non-heap object at exit.
Now heap-allocated and registered on first use.

## 5. Result

60 s, exit 0, and the same flood as the round before:

| metric | sink | sensor1 | sensor2 | sensor3 |
|---|---:|---:|---:|---:|
| fired:create_bconPkt | 60 | – | – | – |
| fired:start_tx_bconPkt | 60 | 1 | 1 | 1 |
| fired:send_down | 60 | 1 | 1 | 1 |
| fired:send_up | 1 | 50 | 2 | 1 |
| fired:receive_controlPkt | – | 1 | 1 | 1 |
| fired:receive_dup_controlPkt | – | – | 1 | – |
| MAC nbRxDataPackets | 1 | 50 | 2 | 1 |

sensor3's radio received one frame in sixty seconds and cannot hear the sink, so
that frame is sensor2's rebroadcast of a beacon sensor2 received from sensor1.

Both case studies compile at 0 errors under the new shell, and the ceiling is
still the model's own `updateNbrs` handshake — PRouteTable's problem, not the
shell's.

## 6. One thing deliberately not done

The emitted class is still called `M4App`, which is now a misleading name for a
`NetworkProtocolBase`. The name comes from the app layer's `defaultName`, and
changing it touches the frozen app-layer naming, the harness and every test at
once. It is a rename, not a design question, and it belongs with the merge of
the two layers rather than in the middle of a base-class pivot.

# Target INET base class for the network layer

**Established 2026-09-06** from INET 4.5 source in
`Simulation/inet4.5/src/inet/`, not from memory. The kickoff brief asks for this
before any rule is written, because the base class fixes what the emitted module
must provide.

**Answer: `inet::NetworkProtocolBase`** — not `RoutingProtocolBase`.

---

## Why not RoutingProtocolBase

`routing/base/RoutingProtocolBase.h` is header-only over `OperationalBase` and
does nothing but pin three lifecycle stages to `…_ROUTING_PROTOCOLS`. Its users
are routing **daemons**, not forwarders. INET's own AODV — the closest thing in
the tree to the RTMCS case study — is:

```cpp
class INET_API Aodv : public RoutingProtocolBase, public NetfilterBase::HookBase,
                      public UdpSocket::ICallback, public cListener
```

with `ModuleRefByPar<IRoutingTable> routingTable;` and `UdpSocket socket;`. It
exchanges RREQ/RREP as UDP datagrams and writes routes into the routing table;
`Ipv4` does the forwarding. The Event-B M4–M6 machines do **both** — they
discover routes *and* move data packets (`sentDown`, `sentUp`, `ndBuff`,
`destBuff`) — so a daemon that never forwards is the wrong shape.

This also corrects the 2026-06-12 pivot recorded in `CLAUDE.md`, which chose
`RoutingProtocolBase` while the emitted module was app-layer. That choice was
never exercised at the network layer; the v4 emitter ships an `ApplicationBase`
subclass.

## Why NetworkProtocolBase

Both WSN network-layer protocols in this tree are declared the same way:

```cpp
class INET_API WiseRoute : public NetworkProtocolBase, public INetworkProtocol
class INET_API MintRoute : public NetworkProtocolBase, public INetworkProtocol
```

The module *is* the network layer: it owns its route table, handles packets from
above and below, and forwards. `NetworkProtocolBase` derives from
`LayeredProtocolBase` (which derives from `OperationalBase`) and supplies
`sendUp` / `sendDown`, socket bookkeeping, the interface table reference, and the
`INITSTAGE_NETWORK_LAYER` staging.

### Obligations on a generated subclass

| obligation | source |
|---|---|
| `const Protocol& getProtocol() const override` | **pure virtual** in `NetworkProtocolBase` |
| `bool isUpperMessage` / `isLowerMessage` | pure virtual in `LayeredProtocolBase`; supplied by `NetworkProtocolBase` |
| `handleUpperPacket(Packet*)` / `handleLowerPacket(Packet*)` | `LayeredProtocolBase`; where forwarding lives |
| `handleSelfMessage(cMessage*)` | timers (route floods, beacons) |
| `initialize(int stage)` + `numInitStages()` | staged init |
| `handleStartOperation` / `Stop` / `Crash` | `OperationalBase` |
| a registered `Protocol` object | `Protocol::wiseRoute` / `Protocol::mintRoute` exist in `common/Protocol.cc`; a generated protocol needs its own |

### NED form

```
simple <Name> extends NetworkProtocolBase like INetworkProtocol
{
    parameters:
        string interfaceTableModule;   // inherited
        string arpModule;              // if the protocol resolves addresses
        @class(<Name>);
}
```

Gates (`transportIn/Out`, `queueIn/Out`) come from `NetworkProtocolBase.ned` and
must not be redeclared.

## Deployment — one detail that matters for the Phase-4 harness

`WiseRouteNetworkLayer.ned` and `MintRouteNetworkLayer.ned` declare their
protocol submodule with a **concrete type** (`np: WiseRoute { … }`), so
`*.generic.np.typename` cannot retype them.

`networklayer/common/SimpleNetworkLayer.ned` declares `np: <> like
INetworkProtocol`. So the drop-in is:

```
*.sensor*.generic.typename    = "SimpleNetworkLayer"
*.sensor*.generic.np.typename = "<Generated>"
```

with no compound module to emit — the generated output stays three files, as at
the app layer. The current harness
(`Simulation/inet4.5/codegen_results/omnetpp.ini`) runs the WiseRoute stack at
exactly this slot, so it is a two-line change, not a new harness.

## Reference of the same scope

The app layer measured against `SensorApp.cc` (238 lines) and caught a silent
zero-packet defect by comparing packet counts. The network layer has the
equivalent already in the tree:

| | lines |
|---|---|
| `networklayer/mintroute/MintRoute.{h,cc}` | 178 + 625 |
| `networklayer/wiseroute/WiseRoute.{h,cc}` | 205 + 405 |
| `routing/aodv/Aodv.{h,cc}` | 219 + 1709 |

`MintRoute.cc` is the direct counterpart for the MintRoute case study — same
protocol, same scope, same base class, and its `TableEntry` carries `cost`,
`missed`, `received`, `lastSeqno`, `receiveEst`, `sendEst`, matching the Event-B
M3–M5 variables one for one. It is both the behavioural reference and a check on
whether the generated encodings are the right ones.

`Aodv.cc` is the RTMCS counterpart but at a **different scope** (daemon, not
forwarder), so it is a reference for the discovery logic only, not for
packet-count parity.

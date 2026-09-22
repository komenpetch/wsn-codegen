import type { GeneratedTree } from "./types";
import { esc } from "./text";

// The network-layer shell: NetworkProtocolBase, shaped after INET's MintRoute.
//
// The app layer's shell was an `ApplicationBase` shaped after INET's SensorApp,
// because that is what the M0–M3 machines describe: a node that senses and hands
// a payload to whatever is below it. The M4–M6 machines describe something else.
// They hold packets in `ndBuff`, put them on a medium, receive other nodes'
// packets and decide whether to forward them. That is a network protocol, and
// INET has a base class for exactly it.
//
// Which base class -- settled from source, not from the class diagram
// -----------------------------------------------------------------
// The 4-category class diagram says `RoutingProtocolBase`. INET 4.5's own two
// implementations of the two shapes disagree with each other, and the
// disagreement is the answer:
//
//   MintRoute : NetworkProtocolBase, INetworkProtocol
//       -- a protocol module in the stack. Packets arrive at handleLowerPacket,
//          leave through sendDown, and the module itself carries data.
//   Aodv      : RoutingProtocolBase, NetfilterBase::HookBase, UdpSocket::ICallback
//       -- a routing DAEMON over UDP. It manipulates a routing table through
//          netfilter hooks; it never carries a data packet itself.
//
// The machines forward packets. A routing daemon does not. So
// `NetworkProtocolBase`, which is also what the advisor directed (2026-09-08)
// and what this project's own MintRoute port uses.
//
// What is mirrored from MintRoute.cc
// ----------------------------------
// The structure, method for method: three init stages (LOCAL reads parameters
// and makes the timers, NETWORK_INTERFACE_CONFIGURATION enables module-path
// addresses, NETWORK_LAYER resolves addresses and starts the timers), a
// self-message timer driving the periodic work, `handleUpperPacket` /
// `handleLowerPacket` for the two packet directions, and the two send helpers
// `setDownControlInfo` / `resolveBroadcast`. The per-packet-type transmit
// methods (`sendBeaconBroadcast`, `sendRouteBroadcast`) are MintRoute's too, and
// the medium binding emits them -- see mediumBinding.ts.
//
// Emitted here rather than as a codeEmitter version, for now. codeEmitter.ts
// carries the app layer's shells as EmitVersion 1–4 and its v4 output is frozen
// published evidence; this is the same kind of thing and belongs beside them as
// a v5 when the two layers merge. Until then it stays a netlayer pass, like
// every other network-layer step.

// The name of the compound module that holds the protocol, derived from the
// protocol's own name so the pair reads the way INET's do (MintRoute /
// MintRouteNetworkLayer): `M4Wsn` and `M4WsnNetworkLayer`.
//
// There is no second name function here any more. This pass briefly had one
// (`netName`, producing "M4Net") next to the pipeline's `defaultName`, which
// meant one generator emitting one module under two names depending on which
// half of it ran. `defaultName` is now the only source of the name and it is
// layer-neutral ("M4Wsn"), so nothing has to be renamed when a model turns out
// to have a network layer.
// Exported because the routing-table binding has to find this same wrapper in
// the emitted .ned to put the route table inside it. One spelling, one place:
// two copies of a name derivation is how the two drift.
export const netLayerName = (cls: string): string =>
  cls ? `${cls}NetworkLayer` : "NetworkLayer";

// The app layer's class doc comment, verbatim from codeEmitter.ts, and what
// replaces it here. Matched as one exact string so that an edit to the emitter's
// wording fails loudly (see installNetProtocolShell) rather than silently
// leaving the app-layer description on a network protocol.
const APP_CLASS_DOC = [
  "// Module shell modelled on INET's SensorApp (inet/applications/sensorapp).",
  "// The model's CommPattern pair is emitted under SensorApp's names (thesis",
  "// S4/S5): Event-B send_down → sendSensorPacket(...) carrying the transmit",
  "// structure, Event-B send_up → a socketDataArrived(...) model overload",
  "// carrying the receive accounting; every other event keeps its Event-B name",
  "// and pure translation-rules body. A model without the pair gets SensorApp's",
  "// own sendSensorPacket() instead. Binding the model identities (which",
  "// node/packet a simulation message is) happens at the marked extension points",
  "// in handleMessageWhenUp() and the socket-callback socketDataArrived().",
].join("\n");

const NET_CLASS_DOC = [
  "// Module shell modelled on INET's MintRoute (inet/networklayer/mintroute):",
  "// a network protocol in the stack, not an application over a socket. This",
  "// model has a medium -- it serialises packets, hands them to a shared",
  "// relation and delivers them to whoever is in range -- so the generator",
  "// emitted its network layer here too: the PPkt chunk classes above, one",
  "// send<Type>Broadcast method per packet type, the event scheduler, and the",
  "// medium binding in handleLowerPacket.",
  "//",
  "// The model's CommPattern pair is emitted under INET's own names for it at",
  "// this layer (thesis S4/S5), the way the app-layer shell used SensorApp's:",
  "// Event-B send_down → a bool sendDown(...) overload beside",
  "// NetworkProtocolBase::sendDown, and Event-B send_up → a bool",
  "// handleLowerPacket(...) overload beside the Packet* one.",
  "//",
  "// send_up is NOT sendUp, and the difference is real: sendUp() delivers to",
  "// upper-layer sockets on THIS node, while the model's send_up is the medium",
  "// handing a packet to a DIFFERENT node -- a call this module receives rather",
  "// than makes, which is why its counterpart is the arrival.",
  "//",
  "// Every other event keeps its Event-B name and pure translation-rules body,",
  "// and each renamed method carries its Event-B label as provenance. Both are",
  "// driven by the module itself -- send_down hands the packet to mediumSend,",
  "// and an arrival runs send_up -- so there are no unbound extension points",
  "// left in this shell.",
].join("\n");

const SHELL_MEMBERS_START = "    // ── SensorApp shell: parameters (read in initialize / openSocket) ──";
const SHELL_MEMBERS_END = "    static simsignal_t packetReceivedSignal;";
const SHELL_METHODS_START = "    void initialize(int stage) override;";
const SHELL_METHODS_END = "    void socketClosed(INetworkSocket *socket) override;";

const APP_INCLUDES = [
  '#include "inet/applications/base/ApplicationBase.h"',
  '#include "inet/networklayer/contract/INetworkSocket.h"',
];

const NET_INCLUDES = [
  '#include "inet/common/ModuleAccess.h"',
  '#include "inet/common/Protocol.h"',
  '#include "inet/common/ProtocolGroup.h"',
  '#include "inet/common/ProtocolTag_m.h"',
  '#include "inet/common/lifecycle/LifecycleOperation.h"',
  '#include "inet/common/packet/Packet.h"',
  '#include "inet/linklayer/common/MacAddress.h"',
  '#include "inet/linklayer/common/MacAddressTag_m.h"',
  '#include "inet/networklayer/base/NetworkProtocolBase.h"',
  '#include "inet/networklayer/common/L3Address.h"',
  '#include "inet/networklayer/common/L3AddressResolver.h"',
  '#include "inet/networklayer/common/L3AddressTag_m.h"',
  '#include "inet/networklayer/contract/IL3AddressType.h"',
  '#include "inet/networklayer/contract/INetworkProtocol.h"',
];

function header(): string {
  return [
    "    // ── Network-layer shell: parameters ──",
    "    int headerLength = 0;",
    "    simtime_t tickInterval;",
    "    L3Address myNetwAddr;",
    "    L3Address sinkAddress;",
    "",
    "    // ── Network-layer shell: state ──",
    "    // One self-message drives the model, the way MintRoute's own beacon and",
    "    // route timers drive its periodic work.",
    "    cMessage *modelTimer = nullptr;",
    "    long sentCount = 0;",
    "    long receivedCount = 0;",
    "",
    "    // ── statistics ──",
    "    static simsignal_t packetSentSignal;",
    "    static simsignal_t packetReceivedSignal;",
    "",
    "  public:",
    // No destructor declared here: the emitter already declares one beside the
    // INITIALISATION constructor. Only its DEFINITION is ours, and the region
    // this pass replaces in the .cc starts at that definition.
    "    int numInitStages() const override { return NUM_INIT_STAGES; }",
    "    void initialize(int stage) override;",
    "    void finish() override;",
    "    // The protocol this module speaks. A module generated from an Event-B",
    "    // machine is not any of INET's named protocols, so it carries its own",
    "    // identity rather than borrowing one -- claiming to be `mintRoute` on the",
    "    // wire would be false for every other model.",
    "    //",
    "    // It needs an ETHERTYPE, not just a name: the MAC carries the network",
    "    // protocol as one in both directions (Smac.cc uses the ethertype group to",
    "    // encode on send and to decode on receive), and INET's generic `manet`",
    "    // protocol has an IP protocol number but no ethertype. The number is",
    "    // registered at runtime through ProtocolGroup's own public API, so no",
    "    // INET table is edited: 0x86FB sits in INET's own non-standard block",
    "    // beside mintRoute (0x86FC) and wiseRoute (0x86FE), and is unassigned.",
    "    //",
    "    // Heap-allocated and never freed, because ProtocolGroup::addProtocol takes",
    "    // OWNERSHIP -- its own comment says \"assume it was dynamically allocated\",",
    "    // and ~ProtocolGroup deletes what it was given. Handing it the address of a",
    "    // static member made INET delete a non-heap object at teardown: the run",
    "    // finished, wrote its results, and then died of heap corruption.",
    "    static const Protocol *ebProtocol();",
    "    static const int EB_ETHERTYPE = 0x86FB;",
    "    const Protocol& getProtocol() const override { return *ebProtocol(); }",
    "",
    "    // OperationalBase -- nothing to start or stop beyond the timer, which",
    "    // initialize/destructor own (MintRoute's are empty for the same reason).",
    "    void handleStartOperation(LifecycleOperation *operation) override {}",
    "    void handleStopOperation(LifecycleOperation *operation) override {}",
    "    void handleCrashOperation(LifecycleOperation *operation) override {}",
    "",
    "  protected:",
    "    enum messageKinds { MODEL_TICK = 301 };",
    "    void handleUpperPacket(Packet *packet) override;",
    "    void handleLowerPacket(Packet *packet) override;",
    "    void handleSelfMessage(cMessage *msg) override;",
    "    void refreshDisplay() const override;",
    "",
    "    // INET send-side utilities, verbatim in shape from MintRoute.",
    "    virtual void setDownControlInfo(Packet *packet, const MacAddress& macAddr);",
    "    virtual L3Address resolveBroadcast() const;",
  ].join("\n");
}

function impl(cls: string): string {
  return [
    "// Registered on first use, so there is no separate init step to forget and",
    "// no chance of registering twice.",
    `const Protocol *${cls}::ebProtocol() {`,
    "    static const Protocol *p = nullptr;",
    "    if (p == nullptr) {",
    "        p = new Protocol(\"eventb\", \"Event-B generated network protocol\");",
    "        ProtocolGroup::getEthertypeProtocolGroup()->addProtocol(EB_ETHERTYPE, p);",
    "    }",
    "    return p;",
    "}",
    "",
    `${cls}::~${cls}() { cancelAndDelete(modelTimer); }`,
    "",
    "// Three stages, the same three MintRoute uses and for the same reasons:",
    "// parameters and timers are local, module-path addressing has to be enabled",
    "// before addresses are read, and an address can only be resolved once every",
    "// node has one.",
    `void ${cls}::initialize(int stage) {`,
    "    NetworkProtocolBase::initialize(stage);",
    "",
    "    if (stage == INITSTAGE_LOCAL) {",
    "        ebProtocol();   // registers this protocol's ethertype, once",
    "        headerLength = par(\"headerLength\");",
    "        tickInterval = par(\"tickInterval\");",
    "        sentCount = 0;",
    "        receivedCount = 0;",
    "        WATCH(sentCount);",
    "        WATCH(receivedCount);",
    "        modelTimer = new cMessage(\"eb-model-tick\", MODEL_TICK);",
    "    }",
    "    else if (stage == INITSTAGE_NETWORK_INTERFACE_CONFIGURATION) {",
    "        for (int i = 0; i < interfaceTable->getNumInterfaces(); i++)",
    "            interfaceTable->getInterface(i)->setHasModulePathAddress(true);",
    "    }",
    "    else if (stage == INITSTAGE_NETWORK_LAYER) {",
    "        L3AddressResolver addressResolver;",
    "        const char *sinkStr = par(\"sinkAddress\");",
    "        if (sinkStr && sinkStr[0])",
    "            sinkAddress = addressResolver.resolve(sinkStr);",
    "        if (auto ie = interfaceTable->findFirstNonLoopbackInterface())",
    "            myNetwAddr = ie->getNetworkAddress();",
    "        else",
    `            throw cRuntimeError("${cls}: no non-loopback interface found");`,
    "        // Spread the first tick so every node does not transmit at once,",
    "        // exactly as MintRoute spreads its first beacon flood.",
    "        scheduleAfter(uniform(0.1, 0.9) + tickInterval, modelTimer);",
    "    }",
    "}",
    "",
    "// The model's clock. Event-B says an event fires when its guards hold; this",
    "// is when the module asks whether any of them do.",
    `void ${cls}::handleSelfMessage(cMessage *msg) {`,
    "    if (msg == modelTimer) {",
    "        runEnabledEvents();",
    "        scheduleAfter(tickInterval, modelTimer);",
    "    }",
    "    else {",
    `        EV_WARN << "${cls}: unexpected self message kind " << msg->getKind() << endl;`,
    "        delete msg;",
    "    }",
    "}",
    "",
    "// Nothing above sends: the machine creates its own packets (the create_*",
    "// events), so a packet from an upper layer is not something the model",
    "// describes. Refused loudly rather than silently encapsulated.",
    `void ${cls}::handleUpperPacket(Packet *packet) {`,
    `    EV_WARN << "${cls}: no upper-layer packet path in this model, dropping "`,
    "            << packet->getName() << endl;",
    "    delete packet;",
    "}",
    "",
    "// Filled in by the medium binding; without it a packet off the air has",
    "// nowhere in the model to go.",
    `void ${cls}::handleLowerPacket(Packet *packet) {`,
    "    delete packet;",
    "}",
    "",
    "// Verbatim in shape from MintRoute::setDownControlInfo.",
    `void ${cls}::setDownControlInfo(Packet *packet, const MacAddress& macAddr) {`,
    "    packet->addTagIfAbsent<MacAddressReq>()->setDestAddress(macAddr);",
    "    packet->addTagIfAbsent<PacketProtocolTag>()->setProtocol(&getProtocol());",
    "    packet->addTagIfAbsent<DispatchProtocolInd>()->setProtocol(&getProtocol());",
    "}",
    "",
    `L3Address ${cls}::resolveBroadcast() const {`,
    "    return myNetwAddr.getAddressType()->getBroadcastAddress();",
    "}",
    "",
    `void ${cls}::refreshDisplay() const {`,
    "    char buf[48];",
    "    snprintf(buf, sizeof(buf), \"sent: %ld\\nrcvd: %ld\", sentCount, receivedCount);",
    "    getDisplayString().setTagArg(\"t\", 0, buf);",
    "}",
    "",
    `void ${cls}::finish() {`,
    "    recordScalar(\"packets sent\", sentCount);",
    "    recordScalar(\"packets received\", receivedCount);",
    "}",
  ].join("\n");
}

// The NED carries BOTH the protocol module and the network-layer compound module
// that holds it, in one file -- the 3-file contract (.h/.cc/.ned) is a spec
// constraint, and a network protocol is not usable without the wrapper that
// gives it an ARP module and a dispatcher. MintRoute ships exactly this pair
// (MintRoute.ned + MintRouteNetworkLayer.ned); here they share a file.
function ned(cls: string, machine: string): string {
  return [
    `// Generated by wsn-codegen from ${machine}. Do not edit by hand — regenerate instead.`,
    "//",
    "// Shaped after inet/networklayer/mintroute/MintRoute.ned and",
    "// MintRouteNetworkLayer.ned: a network protocol, plus the compound module",
    "// that slots it into a node's `generic` network-layer position.",
    "",
    "import inet.common.MessageDispatcher;",
    "import inet.networklayer.arp.ipv4.GlobalArp;",
    "import inet.networklayer.base.NetworkProtocolBase;",
    "import inet.networklayer.common.EchoProtocol;",
    "import inet.networklayer.contract.INetworkLayer;",
    "import inet.networklayer.contract.INetworkProtocol;",
    "",
    `simple ${cls} extends NetworkProtocolBase like INetworkProtocol`,
    "{",
    "    parameters:",
    "        int headerLength @unit(b) = default(96b);",
    "        // The node the model calls Sink, resolved the way every INET",
    "        // protocol resolves a named node.",
    "        string sinkAddress = default(\"\");",
    "        // How often the module asks the model which events are enabled.",
    "        double tickInterval @unit(s) = default(1s);",
    "        // No interfaceTableModule here: NetworkProtocolBase declares it, and",
    "        // re-declaring it is an 'It already exists' error during network setup.",
    "        string arpModule;",
    "        @display(\"i=block/fork\");",
    `        @class(${cls});`,
    "}",
    "",
    `module ${netLayerName(cls)} like INetworkLayer`,
    "{",
    "    parameters:",
    "        string interfaceTableModule;",
    "        *.interfaceTableModule = default(absPath(this.interfaceTableModule));",
    "        @display(\"i=block/fork\");",
    "",
    "    gates:",
    "        input ifIn @labels(INetworkHeader);",
    "        output ifOut @labels(INetworkHeader);",
    "        input transportIn @labels(ITransportPacket/down);",
    "        output transportOut @labels(ITransportPacket/up);",
    "",
    "    submodules:",
    "        arp: GlobalArp {",
    "            parameters:",
    "                // ⚠ MODULEPATH, NOT GlobalArp's OWN DEFAULT OF \"ipv4\".",
    "                //",
    "                // This shell calls setHasModulePathAddress(true) on every",
    "                // interface at INITSTAGE_NETWORK_INTERFACE_CONFIGURATION, so",
    "                // every address in the network -- and every key in ARP's own",
    "                // globalArpCache -- is a ModulePathAddress. GlobalArp switches",
    "                // on addressType: left at \"ipv4\" its getL3AddressFor() scans the",
    "                // cache for entries of type L3Address::IPv4, finds none, and",
    "                // returns UNSPECIFIED. Measured before this: unspecified on 100%",
    "                // of lookups on every node, so the module published ZERO routes",
    "                // while flooding correctly and reporting no error at all.",
    "                //",
    "                // These are two things this generator emits, and they have to",
    "                // agree: an ARP configured for a different address family than",
    "                // the layer it serves is misconfigured whether or not anything",
    "                // happens to query it.",
    "                addressType = \"modulepath\";",
    "                @display(\"p=100,300\");",
    "        }",
    `        np: ${cls} {`,
    "            parameters:",
    "                arpModule = \"^.arp\";",
    "                @display(\"p=250,300;q=queue\");",
    "        }",
    "        echo: EchoProtocol {",
    "            parameters:",
    "                @display(\"p=400,100\");",
    "        }",
    "        dp: MessageDispatcher {",
    "            parameters:",
    "                @display(\"p=250,200;b=400,5\");",
    "        }",
    "",
    "    connections allowunconnected:",
    "        dp.out++ --> { @display(\"m=n\"); } --> transportOut;",
    "        dp.in++ <-- { @display(\"m=n\"); } <-- transportIn;",
    "",
    "        np.transportOut --> dp.in++;",
    "        np.transportIn <-- dp.out++;",
    "",
    "        dp.out++ --> echo.ipIn;",
    "        dp.in++ <-- echo.ipOut;",
    "",
    "        ifIn --> { @display(\"m=s\"); } --> np.queueIn;",
    "        np.queueOut --> { @display(\"m=s\"); } --> ifOut;",
    "}",
  ].join("\n");
}

// Cut a region delimited by two anchors, inclusive, and fail loudly if either
// anchor is gone: a shell replacement that silently matched nothing would leave
// an ApplicationBase module wearing a network protocol's methods.
function cut(text: string, from: string, to: string, what: string): [string, string] {
  const a = text.indexOf(from);
  if (a < 0) throw new Error(`netProtocolShell: anchor not found (${what} start): ${from}`);
  const b = text.indexOf(to, a);
  if (b < 0) throw new Error(`netProtocolShell: anchor not found (${what} end): ${to}`);
  return [text.slice(0, a), text.slice(b + to.length)];
}

export function installNetProtocolShell(tree: GeneratedTree, cls: string, machine: string): GeneratedTree {
  return tree.map((f) => {
    if (f.path.endsWith(".ned")) return { ...f, content: ned(cls, machine) + "\n" };

    if (f.path.endsWith(".h")) {
      let h = f.content;
      // The doc comment above the class, too. It described a SensorApp shell
      // with unbound extension points in handleMessageWhenUp(), and it survived
      // into the network-layer header where the class has no such method, no
      // socket and no extension points -- every sentence of it false, sitting
      // directly above `class M4Wsn : public NetworkProtocolBase`. A stale
      // comment on generated code is worse than none: the reader cannot tell
      // which of the two the generator actually meant.
      if (!h.includes(APP_CLASS_DOC))
        throw new Error("netProtocolShell: the app-layer class doc comment did not match; it would be left stale.");
      h = h.replace(APP_CLASS_DOC, NET_CLASS_DOC);
      for (const inc of APP_INCLUDES) h = h.replace(inc + "\n", "");
      const anchor = '#include "inet/common/packet/Packet.h"';
      const at = h.indexOf(anchor);
      if (at < 0) throw new Error("netProtocolShell: no include block found in the header.");
      h = h.slice(0, at) + NET_INCLUDES.join("\n") + h.slice(at + anchor.length);
      h = h.replace(
        new RegExp(`^class ${cls} : public ApplicationBase, public INetworkSocket::ICallback \\{$`, "m"),
        `class ${cls} : public NetworkProtocolBase, public INetworkProtocol {`);
      if (!h.includes("public NetworkProtocolBase"))
        throw new Error("netProtocolShell: the emitted class declaration did not match the app-layer shape.");

      // BOTH cuts come out of the original text, before anything is inserted.
      // The replacement block itself declares `void initialize(int stage)
      // override;`, so inserting first made the second cut start inside the NEW
      // block and swallow the rest of it: every declaration after
      // numInitStages vanished and the class was left abstract.
      const [beforeMembers, afterMembers] = cut(h, SHELL_MEMBERS_START, SHELL_MEMBERS_END, "members");
      const [between, afterMethods] = cut(afterMembers, SHELL_METHODS_START, SHELL_METHODS_END, "methods");
      // What sat between the two regions is the emitter's `protected:` label,
      // which the replacement block supplies for itself.
      h = beforeMembers + header() + between.replace(/\n\n  protected:\n$/, "\n") + afterMethods;
      return { ...f, content: h };
    }

    if (f.path.endsWith(".cc")) {
      let cc = f.content;
      // Starts at the emitter's own destructor, not at initialize: that
      // destructor cancels the app shell's timer and deletes its socket,
      // neither of which exists any more.
      const start = `${cls}::~${cls}() {`;
      const end = `void ${cls}::finish() {`;
      const a = cc.indexOf(start);
      if (a < 0) throw new Error("netProtocolShell: initialize() not found in the emitted .cc.");
      const b = cc.indexOf(end, a);
      if (b < 0) throw new Error("netProtocolShell: finish() not found in the emitted .cc.");
      const endOfFinish = cc.indexOf("\n}", b);
      if (endOfFinish < 0) throw new Error("netProtocolShell: finish() has no closing brace.");
      cc = cc.slice(0, a) + impl(cls) + cc.slice(endOfFinish + 2);
      return { ...f, content: cc };
    }
    return f;
  });
}

// ── The CommPattern pair, under the network layer's own names ───────────────
//
// The app-layer shell emits Event-B `send_down`/`send_up` under SensorApp's
// names, because SensorApp is the module it is shaped like. This shell is
// shaped like MintRoute, so the pair takes MintRoute's -- that is, INET's
// NetworkProtocolBase's -- names instead. The Event-B label stays in the
// provenance comment either way, and both the medium binding and the scheduler
// read the method name back OUT of that comment, so nothing downstream has to
// be told about the change.
//
// send_down -> sendDown is exact. INET's `NetworkProtocolBase::sendDown(cMessage
// *, int)` tags the frame and does `send(msg, "queueOut")`: it hands the packet
// to the interface below, which is what the model's send_down says.
//
// send_up -> handleLowerPacket, NOT sendUp, and the difference matters.
// `NetworkProtocolBase::sendUp(cMessage *)` delivers a packet to the registered
// upper-layer SOCKETS ON THIS NODE (network -> transport); with no app
// registered it logs "Transport protocol not connected, discarding packet" and
// deletes it. The model's send_up is the medium handing a packet to a DIFFERENT
// node -- a call this module RECEIVES, not one it makes. Its INET counterpart is
// therefore the arrival, `handleLowerPacket`, which is exactly where the medium
// binding already runs it.
//
// The rule underneath is the same one the app layer follows, which is why the
// two columns line up: send_down is the module's own downward call
// (sendSensorPacket / sendDown), send_up is the module's own handler for an
// arrival from below (socketDataArrived / handleLowerPacket). The app layer's
// `socketDataArrived` is a callback too -- the callee side -- not an upward send.
const PAIR_RENAMES: { from: string; to: string; label: string }[] = [
  { from: "sendSensorPacket", to: "sendDown", label: "send_down" },
  { from: "socketDataArrived", to: "handleLowerPacket", label: "send_up" },
];

// Base-class methods the renamed pair would HIDE. `bool sendDown(int, int, …)`
// hides `void sendDown(cMessage *, int)`, and the generated per-type transmit
// methods call exactly that one -- without the using-declaration the module
// stops compiling at its own `sendDown(packet)`. handleLowerPacket needs no
// entry: this class declares the `void handleLowerPacket(Packet *) override`
// itself, so both overloads are already in scope together.
const PAIR_USING = ["sendDown"];

export function renameCommPatternPair(tree: GeneratedTree, cls: string): GeneratedTree {
  // ⚠ The provenance comment this matches on is written by codeEmitter, and the
  // regex below pins its exact WORDING. If that wording drifts, every
  // `def.test(text)` is simply false: nothing renames, nothing raises, and the
  // network module keeps the application layer's `sendSensorPacket` /
  // `socketDataArrived` on a NetworkProtocolBase. The `throw` further down
  // guards a different and less likely case (a missing `.h` anchor), so it
  // never fired for this one — only tests/mediumBinding.test.ts did, which puts
  // the guard in the test rather than in the code.
  //
  // Every model that reaches here has the CommPattern pair: modelHasMedium is
  // what selects this shell, and it is derived from send_down/send_up. So "no
  // rename happened anywhere" is a precondition failure, not a valid outcome.
  let renamedSomewhere = false;
  const out = tree.map((f) => {
    if (f.path.endsWith(".ned")) return f;
    let text = f.content;
    let renamedAny = false;

    for (const { from, to, label } of PAIR_RENAMES) {
      // The .cc definition, together with the provenance comment above it. Both
      // are rewritten in one match so a rename can never leave the comment
      // pointing at a method name that no longer exists -- that comment is what
      // mediumBinding and scheduler look the method up by.
      const def = new RegExp(
        `^// Event-B: ${label} — emitted under its SensorApp name \\(thesis ([^)]*)\\)\\.\\nbool ${esc(cls)}::${from}\\(`,
        "m");
      if (def.test(text)) {
        text = text.replace(def,
          `// Event-B: ${label} — emitted under INET's own name for it at this layer (thesis $1).\n` +
          `bool ${cls}::${to}(`);
        renamedAny = true;
      }
      // The .h declaration.
      const decl = new RegExp(`^(\\s*)bool ${from}\\(([^)]*)\\);(\\s*// Event-B: ${label})$`, "m");
      if (decl.test(text)) {
        text = text.replace(decl, `$1bool ${to}($2);$3`);
        renamedAny = true;
      }
    }

    if (renamedAny && f.path.endsWith(".h")) {
      const anchor = "    // Event-B events, one guarded bool method each";
      if (!text.includes(anchor))
        throw new Error("renameCommPatternPair: no event block found to place the using-declarations before.");
      text = text.replace(anchor, [
        "    // The CommPattern pair is emitted under NetworkProtocolBase's own",
        "    // names, which its bool overloads would otherwise HIDE. Re-expose the",
        "    // base versions -- the per-type transmit methods below call",
        "    // sendDown(packet), and overload resolution still picks the right one.",
        ...PAIR_USING.map((n) => `    using NetworkProtocolBase::${n};`),
        "",
        anchor,
      ].join("\n"));
    }
    if (renamedAny) renamedSomewhere = true;
    return { ...f, content: text };
  });

  if (!renamedSomewhere)
    throw new Error(
      "renameCommPatternPair: renamed nothing. The CommPattern pair is what selects "
      + "this shell, so its provenance comments must be present — codeEmitter's wording "
      + "for them has drifted from the pattern this pass matches on.");
  return out;
}

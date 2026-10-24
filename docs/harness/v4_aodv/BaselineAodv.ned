// The baseline's AODV and the node that carries it (v4 AODV plan, Q11 / step 3).
// Harness code, package-less like the rest of this folder.
//
// BaselineAodv is INET's Aodv, unchanged, plus the recording in BaselineAodv.cc.
// It extends INET's module by its full name, as ../v4_mintroute's
// BaselineMintRoute.ned does.
//
// BaselineAodvSensorNode is MyWSN's AodvSensorNode (inet4.5/MyWSN/
// AodvSensorNode.ned): INET's SensorNode plus AODV wired to the UDP transport
// dispatcher `at`, here with the recording AODV. MyWSN's own node is in package
// MyWSN, which this harness's NED path does not include.

import inet.node.inet.SensorNode;

simple BaselineAodv extends inet.routing.aodv.Aodv
{
    parameters:
        @class(BaselineAodv);
        string sinkAddress = default("sink");  // whose route is recorded at the end
}

module BaselineAodvSensorNode extends SensorNode
{
    parameters:
        // IP forwarding on, as INET's own AODV node has it (AodvRouter extends
        // AdhocHost, which sets forwarding = default(true), AdhocHost.ned:29).
        // NetworkLayerNodeBase defaults it to false, and MyWSN's AodvSensorNode
        // (extends SensorNode) never set it: measured 2026-10-19 at 250 kbps,
        // routes formed on every sensor while the relays dropped every datagram
        // they should forward (ipv4.ip packetDropForwardingDisabled 40 / 109 / 108
        // at sensor2 / sensor5 / sensor6) and the sink received only 36 of 288.
        forwarding = true;
    submodules:
        aodv: BaselineAodv {
            @display("p=825,226");
        }
    connections:
        aodv.socketOut --> at.in++;
        aodv.socketIn <-- at.out++;
}

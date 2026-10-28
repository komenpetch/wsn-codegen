//
// The DSR baseline (design/V4_DSR_Plan.md section 13): DSRRoute.h says what it
// is. Package-less, like the rest of this folder; INET modules are named in
// full. The wrapper follows INET's MintRouteNetworkLayer, with GlobalArp on the
// module-path addresses the protocol installs (as the generated EbWsn's own
// wrapper sets it: GlobalArp's default "ipv4" finds no entry here).
//

import inet.common.MessageDispatcher;
import inet.networklayer.arp.ipv4.GlobalArp;
import inet.networklayer.base.NetworkProtocolBase;
import inet.networklayer.common.EchoProtocol;
import inet.networklayer.contract.INetworkLayer;
import inet.networklayer.contract.INetworkProtocol;

simple DSRRoute extends NetworkProtocolBase like INetworkProtocol
{
    parameters:
        // Q15: 116 B, the sum of Fig 6.12's fields (four addresses 16 B,
        // seqNum/nbHops/payloadType 12 B, path[20] 80 B, data 8 B); every
        // frame carries it (Fig 6.9: pkt->setByteLength(headerLength))
        int headerLength @unit(B) = default(116B);
        string sinkAddress;
        string arpModule;
        bool stats = default(true);
        @display("i=block/fork");
        @class(dsrbaseline::DSRRoute);
}

module DSRRouteNetworkLayer like INetworkLayer
{
    parameters:
        string interfaceTableModule;
        *.interfaceTableModule = default(absPath(this.interfaceTableModule));
        @display("i=block/fork");

    gates:
        input ifIn @labels(INetworkHeader);
        output ifOut @labels(INetworkHeader);
        input transportIn @labels(ITransportPacket/down);
        output transportOut @labels(ITransportPacket/up);

    submodules:
        arp: GlobalArp {
            parameters:
                addressType = "modulepath";
                @display("p=100,300");
        }
        np: DSRRoute {
            parameters:
                arpModule = "^.arp";
                @display("p=250,300;q=queue");
        }
        echo: EchoProtocol {
            parameters:
                @display("p=400,100");
        }
        dp: MessageDispatcher {
            parameters:
                @display("p=250,200;b=400,5");
        }

    connections allowunconnected:
        dp.out++ --> { @display("m=n"); } --> transportOut;
        dp.in++ <-- { @display("m=n"); } <-- transportIn;

        np.transportOut --> dp.in++;
        np.transportIn <-- dp.out++;

        dp.out++ --> echo.ipIn;
        dp.in++ <-- echo.ipOut;

        ifIn --> { @display("m=s"); } --> np.queueIn;
        np.queueOut --> { @display("m=s"); } --> ifOut;
}

// The baseline as a harness subclass of INET's MintRoute (libINET untouched); see
// BaselineMintRoute.h. Package-less, like every .ned in this folder. MintRoute is
// named by its full name: this folder's own MintRoute.ned declares a different
// MintRoute (the Specific class on v4).
import inet.common.MessageDispatcher;
import inet.networklayer.arp.ipv4.GlobalArp;
import inet.networklayer.common.EchoProtocol;
import inet.networklayer.contract.INetworkLayer;

simple BaselineMintRoute extends inet.networklayer.mintroute.MintRoute
{
    parameters:
        @class(BaselineMintRoute);
        // true: count a received DATA frame before the duplicate check (MiXiM's
        // order); false: the port exactly as it is.
        bool restoreMiximOrder = default(true);
}

// inet.networklayer.mintroute.MintRouteNetworkLayer with np: BaselineMintRoute.
module BaselineMintRouteNetworkLayer like INetworkLayer
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
                @display("p=100,300");
        }
        np: BaselineMintRoute {
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

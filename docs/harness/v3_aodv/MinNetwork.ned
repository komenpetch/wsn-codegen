//
// MinNetwork -- ONE node, for minimising the "no model events fire" repro.
//
// The symptom appears on the first timer tick of every node independently, so
// if it still reproduces here then the radio, the MAC, the propagation model,
// the topology and every other node are not load-bearing and can be struck
// from the hypothesis space.
//
import inet.networklayer.configurator.ipv4.Ipv4NetworkConfigurator;
import inet.node.inet.SensorNode;
import inet.physicallayer.wireless.apsk.packetlevel.ApskScalarRadioMedium;

network MinNetwork
{
    @display("bgb=300,200");
    submodules:
        configurator: Ipv4NetworkConfigurator { @display("p=50,50"); }
        radioMedium: ApskScalarRadioMedium { @display("p=50,110"); }
        sink: SensorNode { @display("p=200,80"); }
}

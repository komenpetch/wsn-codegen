//
// SensorScopeNetwork -- a multi-hop deployment for the generated Pm3Wsn.
//
// WHY A SECOND NETWORK. CodegenNetwork puts one sink and three sensors inside
// ~130 m of each other, and at the configured sensitivity the radio reaches
// 1458 m, so every node hears every other node. The model floods correctly
// there -- each sensor receives once, rebroadcasts once and suppresses the
// duplicates -- but the propagation depth is ONE hop. Nothing in that run
// distinguishes "the flood propagated" from "everyone heard the sink".
// This network separates the two.
//
// SHAPE TAKEN FROM paper2 figures/fig-network.tex, which is itself drawn after
// Figure 3.5 of phdThesis_Adisak (SensorScope): an irregular field of stations
// rather than a symmetric arrangement, and the sink at the EDGE of the field
// rather than the middle of it. Eight sensing stations, one sink. The paper
// says node positions are illustrative; what is not illustrative is the
// connectivity they produce, which is the point of this file.
//
// GEOMETRY. The figure's coordinates are scaled by 136 m per figure unit --
// chosen by searching the scale factor that maximises the link margin while
// keeping the field connected. The y axis is flipped because NED's canvas y
// grows downward and the figure's grows upward.
//
// RANGE. Free-space at 2.45 GHz, 2.24 mW, gives -85 dBm at 259 m:
//     Pr = Pt (lambda / 4 pi d)^2
// That model was validated against a run of CodegenNetwork: it predicts
// 21.2686 pW at 100 m and the simulator reported 21.2392 pW. omnetpp.ini's
// [Config MultiHop] sets sensitivity to -85dBm to obtain that 259 m range.
//
// ⚠ THE MARGIN IS 14 m AND THAT IS DELIBERATE, NOT SLOPPY. The closest
// non-link is 273 m and the longest link is 227 m (sensor1--sensor4). The gap
// is narrow because the figure's own geometry is, and 136 is the scale that
// makes it widest. It is safe here only because the propagation model is
// DETERMINISTIC -- free-space, no fading, no shadowing -- so a link either
// exists on every packet or on none. Add a stochastic path-loss model and
// these margins stop meaning anything.
//
// RESULTING FLOOD DEPTH -- 4 hops, with the sink having exactly ONE neighbour:
//     hop 0  sink
//     hop 1  sensor6                      (199 m from the sink)
//     hop 2  sensor3, sensor5, sensor8
//     hop 3  sensor2, sensor4, sensor7
//     hop 4  sensor1
// sensor1 is 661 m from the sink and cannot hear it under any circumstance, so
// a beacon arriving there has been rebroadcast four times by the model itself.
//
// CONFIRMED BY THE RUN. The sink's beacon reaches sensor1's radio at 0.485777 pW
// (-93.1 dBm), 8.1 dB below the -85 dBm sensitivity, so it is never decoded --
// and the predicted figure was 0.486449 pW, which is how closely the free-space
// model tracks this simulator. Every node's MAC nbRxDataPackets came out equal
// to its neighbour count in the table above: sink 1, sensor1 2, sensor5 6.
//
// No package declaration -- see CodegenNetwork.ned for why.

import inet.networklayer.configurator.ipv4.Ipv4NetworkConfigurator;
import inet.node.inet.SensorNode;
import inet.physicallayer.wireless.apsk.packetlevel.ApskScalarRadioMedium;
import inet.visualizer.common.IntegratedVisualizer;

network SensorScopeNetwork
{
    @display("bgb=820,480");
    submodules:
        // The three infrastructure modules carry no radio, so their positions
        // are cosmetic. They sit in the empty top-left corner of the field.
        configurator: Ipv4NetworkConfigurator {
            @display("p=40,40");
        }
        visualizer: IntegratedVisualizer {
            @display("p=40,90");
        }
        radioMedium: ApskScalarRadioMedium {
            @display("p=40,140");
        }

        // ⚠ p= IS the physical position, not just the icon location: INET's
        // StationaryMobility reads it from the display string. Moving a node
        // here changes what it can hear.
        sink: SensorNode {
            @display("p=740,244;i=misc/sensorgateway");
        }
        sensor1: SensorNode {        // hop 4 -- the far corner, 780 m from the sink
            @display("p=101,74;i=misc/sensor2");
        }
        sensor2: SensorNode {        // hop 3
            @display("p=271,155;i=misc/sensor2");
        }
        sensor3: SensorNode {        // hop 2
            @display("p=441,60;i=misc/sensor2");
        }
        sensor4: SensorNode {        // hop 3
            @display("p=169,291;i=misc/sensor2");
        }
        sensor5: SensorNode {        // hop 2 -- the best-connected station, 6 neighbours
            @display("p=359,250;i=misc/sensor2");
        }
        sensor6: SensorNode {        // hop 1 -- the ONLY station the sink can reach
            @display("p=556,169;i=misc/sensor2");
        }
        sensor7: SensorNode {        // hop 3
            @display("p=291,400;i=misc/sensor2");
        }
        sensor8: SensorNode {        // hop 2
            @display("p=495,366;i=misc/sensor2");
        }
}

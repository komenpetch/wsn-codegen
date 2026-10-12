//
// StaticRoutes -- the Specific class of step 3f's run test
// (design/NextHop_Extension_Draft.md D12, D13, §7). HAND-WRITTEN HARNESS CODE.
//
// It extends the generated module and holds no routing logic: its routes are
// the fixed list below, handed to the generated route-table operation addEntry
// (see StaticRoutes.h). The generated wrapper fixes `np: EbWsn`, and NED does
// not let a derived module change an inherited submodule's type, so loop.sh
// derives StaticRoutesNetworkLayer.ned from the staged EbWsn.ned (D12, Q6).
//
// Node names are the network's own submodule names ("sink", "sensor6").
//
simple StaticRoutes extends EbWsn
{
    parameters:
        // Route entries "destination:nextHop", space-separated.
        string routes = default("");
        // One entry's next hop changed once (D15): "destination:nextHop",
        // applied at the first route timer at or after updateAt.
        string update = default("");
        double updateAt @unit(s) = default(-1s);
        @class(StaticRoutes);
}

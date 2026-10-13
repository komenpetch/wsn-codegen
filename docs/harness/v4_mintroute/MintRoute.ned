//
// MintRoute -- MintRoute's Specific class for structure 4 (step 3g).
// HAND-WRITTEN case-study code; see MintRoute.h.
//
// It extends the generated module with MintRoute's parent choice. The generated
// wrapper fixes `np: EbWsn`, and NED does not let a derived module change an
// inherited submodule's type, so loop.sh derives EbMintRouteNetworkLayer.ned
// from the staged EbWsn.ned (as v4_static does for StaticRoutes). Its own name,
// because [Config Baseline] runs INET's MintRouteNetworkLayer in this same
// executable.
//
// sinkAddress (inherited) is required here, as MintRoute.ned:28 requires it.
//
simple MintRoute extends EbWsn
{
    parameters:
        // MintRoute.ned:39-49, the baseline's defaults.
        double alpha = default(0.75);
        int linkQtyThreshold = default(25);
        int estimateToRouteRatio = default(3);
        int switchThreshold = default(384);
        @class(MintRoute);
}

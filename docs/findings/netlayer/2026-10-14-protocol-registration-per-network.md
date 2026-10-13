# A second run in one process used a freed protocol (2026-10-14)

## Symptom

Reported from the OMNeT++ IDE: structure 4's V4 run worked in Qtenv, and running
it again in the same window stopped with

    <!> Unknown protocol: id = 0, name =  -- in module (inet::Smac)
    SensorScopeNetwork.sensor3.wlan[0].mac (id=184), at t=5.003512509978s, event #258

## Cause

The network shell gives the module its own protocol, `eventb` (ethertype 0x86FB),
because SMAC carries the network protocol as an ethertype. `ebProtocol()` created
it once and kept it in a function-local `static`.

INET 4.5 keeps the ethertype `ProtocolGroup` per network, not per process:

- `ProtocolGroup::getEthertypeProtocolGroup()` returns a shared variable
  (`ProtocolGroup.cc:170–173`);
- INET's `SharedDataManager` (OMNeT++ 6 has no `cSimulation::getSharedVariable`)
  clears every shared variable at `LF_POST_NETWORK_DELETE` (`Compat.cc:97–100`);
- `~ProtocolGroup` deletes every protocol added with `addProtocol`
  (`ProtocolGroup.cc:25–29`).

So when the network is deleted and rebuilt in the same process (Qtenv's run
again, or several runs in one Cmdenv), the protocol is freed, the `static` still
points at it, and the new group never gets it. SMAC's `getProtocolNumber` then
reports the freed object: `id = 0`, an empty name.

The 2026-09-08 fix ("heap-allocated, registered on first use") was right that the
group takes ownership, and assumed the group lives for the whole process.

## Fix

`ebProtocol()` looks the protocol up in the current group on every call
(`findProtocol(EB_ETHERTYPE)`) and creates and adds it only when that group lacks
it; nothing is kept across networks. Re-creating `eventb` per network is safe:
INET's `Protocol` constructor overwrites its own name and id maps and does not
reject a repeated name (`Protocol.cc:24–34`).

Emitted by `src/engine/netProtocolShell.ts`, so it applies to every network-layer
output: MintRoute's `M4Wsn`, RTMCS's `M6Wsn`, structure 3 and structure 4. The
app-layer output (structures 1–2) has no such function.

## Evidence

- **Reproduced** on a scratch build of the five-file structure-4 folder,
  `-c V4 --repeat=2 --seed-set=0` in one process: run #0 ended at event #36346,
  run #1 crashed at event #0 (segmentation fault).
- **Generated output:** the app layer byte-identical; each of the six network
  outputs (M4, M6, structure 3 and 4 with both routings) changes by the same
  lines: this function and its comments in `.cc` and `.h`; every `.ned`
  identical. clang 0 errors on all six.
- **Test:** `tests/protocolRegistration.test.ts` reads the emitted `ebProtocol()`
  from all four outputs. The old static form and a lookup that never registers
  each fail all four cases.
- **Single runs unchanged:** structure 3 flooding and AODV, the old staged module
  against the fixed one, 655 / 663 scalars identical; `v4_mintroute` V4, Parent,
  ParentPlain and `v4_static` Plain, Static identical to the runs measured the
  same day (682 / 901 / 680 / 682 / 767).
- **Two runs in one process now work:** structure 3 flooding (#38364 twice),
  AODV (#38983 twice), structure 4 Parent (#78440 twice, `tree.mjs` GREEN on the
  second run), each run identical to the single run.

Every result recorded before this fix is a single run in a fresh process, so none
is affected.

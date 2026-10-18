# A second config in one process kept the first one's node sets (2026-10-18)

## Symptom

Reported from the OMNeT++ IDE: in one Qtenv window the user ran structure 4's
V4, then Parent360 (MintRoute's parent choice, pasted test code). Parent360 drew
no tree: "sensors with a parent: 0 of 8". Its `.sca` showed the sink with
`nbBeaconsSent 0` and `fired:dest_recv_pkt 144`, which happen only when the sink
is a destination, and in Parent360 it is not one.

## Cause

`ND` and the node subsets the harness fills (`Dests`; RTMCS's `Destination` and
`Actuators`) are emitted at namespace scope, `inline std::set<int> ND;`: one set
per program, shared by every module. `bindNodeIdentity` (`nodeIdentity.ts`)
emits each node's `ND.insert(myNodeId)` and, where its NED parameter says so,
`Dests.insert(myNodeId)`. Nothing took an id out again.

OMNeT++ 6.3's `cSimulation::deleteNetwork()` deletes every module
(`csimulation.cc:521`) and then sets `lastComponentId = 0` (`:536`), so the next
network gets the same module ids. In the same process the sink was therefore
id 5 again and still in `Dests` from V4: `ND ∖ Dests` left it out of the
creating events, so it never beaconed, no link estimates formed, and no sensor
chose a parent.

Same family as the protocol kept across networks (0d8ad7d,
`2026-10-14-protocol-registration-per-network.md`): state that lives per
process while the network lives per run. Running one config several times in
one process was never affected (the sets get the same members again), which is
why the 2026-10-14 two-runs-in-one-process checks passed.

## Fix

`releaseNodeIdentity` (`nodeIdentity.ts`) adds, to the module's destructor, one
`<set>.erase(myNodeId);` per namespace-scope set the emitted `.cc` inserts
`myNodeId` into. The destructor is the one place that runs for every module,
including after a run that ended in an error (`finish()` does not), and it runs
before the next network is set up. The sets are read off the emitted code, so
the inserts and the erases cannot disagree; a set that is the module's own
member is left alone, since it goes with the module.

It is called once, at the pipeline's single exit (`emitOne`), after every pass
that shapes the destructor: structure 4's timer pass (`baselineShell.ts`)
replaces the one-line destructor by its exact text, so editing it earlier would
break that pass. An output that inserts into no shared set (structures 1 and 2)
is returned unchanged; one that inserts and has no destructor is refused.

## Evidence

- **Reproduced** (scratch build of the structure-4 test files): a config whose
  run 0 puts the sink in `Dests` and whose run 1 is Parent360, in one process,
  gives a run 1 ending at event #61386 that equals the user's Qtenv Parent360 on
  all 839 scalars; run 1 alone ends at #92074, the tested Parent360 #0.
- **Generated output:** structures 1 and 2 byte-identical; the six network
  outputs (M4, M6, structure 3 and 4 with both routings) change only in the
  destructor of the `.cc` (7 to 11 lines); every `.h` and `.ned` identical.
  clang `-fsyntax-only` 0 errors on all six.
- **Tests:** `tests/nodeSetRelease.test.ts`, 13 cases: per network output the
  destructor erases exactly the sets `initialize` inserts into (pinned: ND; ND,
  Dests; ND, Actuators, Destination), structures 1 and 2 erase nothing, and
  unit cases for both destructor shapes, a member set, no inserts, and no
  destructor. 5 of 5 mutations caught (never called; member sets released too;
  only the first set; no destructor skipped silently; the destructor's own
  statements dropped).
- **Structure 4, the user's sequence:** V4 then Parent360 #0 in one process
  (a scratch config whose run 0 is V4 and run 1 Parent360 #0). Before the fix
  run 1 ends at #61386, 0 of 8 parents, 349 scalars different from Parent360 #0
  alone; after it, #92074, all 858 scalars equal, the tree picture the same
  apart from its title. Run 0 equals V4 alone (652 scalars) both times.
- **Structure 3 (flooding):** SinkBeacon (sensors in `Dests`) then Sink in one
  process. Before the fix run 1 ends at #3740 instead of #38364 (281 scalars
  different); after it, #38364 with all 624 scalars equal to Sink alone.
- **Single runs unchanged:** structure 4's V4, Baseline, Parent360 #0–#4,
  FailSensor5 and FailSensor6, every scalar equal to the tested runs and every
  tree picture byte-identical; structure 3's Sink and SinkBeacon, before against
  after, 624 and 524 scalars equal.

Every result recorded before this fix is a single run, or repeats of one config,
in a fresh process, so none is affected. M4Wsn and M6Wsn were checked by
generation, tests and compile only (no run).

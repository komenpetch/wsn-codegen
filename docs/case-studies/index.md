# Case studies

Four case studies show what the generator produces and where the hand-written part begins.
Each page follows the same order: what the case study is, what is generated and what is
pasted, how to run it, what was measured, how it compares with its baseline, and what it does
not show.

| Case study | Structure | Baseline | Page |
|---|---|---|---|
| SensorApp (application layer) | 2 | INET's `SensorApp` | [SensorApp](sensorapp.md) |
| MintRoute (tree collection) | 4, flooding split | INET's MintRoute port | [MintRoute](mintroute.md) |
| AODV (on-demand routing) | 4, AODV split | INET's `Aodv` | [AODV](aodv.md) |
| DSR (source routing) | 4, DSR split | a protocol written from the Final Report's printed code | [DSR](dsr.md) |

## What the three network case studies share

**One input.** All three are generated from the same pattern project, and only the routing
option and the pasted test code differ. Structure 4 refuses the MintRoute and RTMCS projects
(neither declares the packet state the bundled extension builds on), and no DSR Event-B model
exists beyond an abstract stub. So these runs show the pattern layer carrying three different
protocols, not three protocol models being translated.

**The same shape of experiment.**

1. Generate the module (`--v4 --routing flooding|aodv|dsr`).
2. Paste the protocol's test code into it. Every pasted line is marked and switched by a NED
   parameter.
3. Run it on a nine-node field with a fixed seed, and check the result against what the
   field allows (shortest paths, heard links, the route the simulator's own table holds).
4. Run the baseline on the same field and compare.
5. Break the field (a node fails) and check that routes recover.

**Predictions first.** Every configuration in the harness inis carries its prediction and what
would falsify it, written before the first run. Where a prediction failed, the ini and the
page say so.

## The nine-node field

The harness field is nine nodes, one sink and eight sensors, with positions taken from the
network figure in the paper (itself drawn after the SensorScope deployment) and scaled by
136 m per figure unit. Free-space propagation at 2.45 GHz and 2.24 mW gives a range of 259 m
at the −85 dBm sensitivity.

- **Links:** 16. The sink has exactly one neighbour, sensor6.
- **Shortest hops to the sink:** sensor6 1; sensor3, sensor5, sensor8 2; sensor2, sensor4,
  sensor7 3; sensor1 4.
- **Link margin:** the longest link is 245.8 m (sensor2 to sensor7) and the closest pair that
  is not a link is 273.7 m (sink to sensor8). Against the 259.2 m range that leaves a margin of
  13 to 15 m on each side, which is safe only because the free-space model is deterministic.
- **Three links the paper's figure does not draw** (sensor3 to sensor5, sensor1 to sensor4,
  sensor2 to sensor7) and one it does draw that falls just outside the range (sink to
  sensor8). A second field, `SensorScopeFigureNetwork`, moves each node by 17 to 54 m so that
  the links are exactly the figure's 14. MintRoute was also run on it.

| Setting | MintRoute harness | AODV and DSR harnesses |
|---|---|---|
| link rate (radio and SMAC) | 19.2 kbps | 250 kbps |
| MAC | SMAC, 0.3 s listen | SMAC, 0.3 s listen |
| queue | drop-tail, 20 frames | drop-tail, 20 frames |
| control frame | 10 bytes | 10 bytes (DSR adds 4 bytes per path entry) |

AODV and DSR run at 250 kbps because INET's own AODV frames are 52 bytes against 10, and at
19.2 kbps the baseline collapses on this field and leaves almost no routes to compare.

## How to read a result

- **An event number** such as `#35308` is the index of the last event of the run. It is a
  fingerprint: a run that ends at a different event is a different run. Two runs with the same
  event number and the same scalars are the same run.
- **`fired:<event>` scalars** count how often each Event-B event fired on each node. They are
  how the model's behaviour is checked, since a run that executes no model event looks the same
  in the log as one that does.
- **GREEN** is a checker verdict. The checker either passes the run, fails it with the failing
  condition, or refuses it when the run is not what it is being read as (wrong configuration,
  wrong sensitivity, wrong link rate).
- **Red-capable** means the checker was shown to fail on a deliberately broken copy. A checker
  that cannot go red proves nothing.

## What is in the repository

The harness sources for each case study are under [`harness/`](../harness/README.md):
the configurations, the field, the build and run scripts, the checkers and the readme with
each measured result. The generated module itself is reproduced with
`npm run generate`, so it is not stored. The pasted test code, with its step-by-step paste
guide, is not part of the repository yet.

# Case studies

Four case studies show what the generator produces and where the hand-written part begins.
Every page follows the same order, so they can be read side by side: **what it is**, **input**,
**what is generated and what is pasted**, **how to run it**, **the expected result**, **how it
compares with its baseline**, and **what it does not show**.

| Case study | Structure | Baseline | Page |
|---|---|---|---|
| SensorApp (application layer) | 2 | INET's `SensorApp` | [SensorApp](sensorapp.md) |
| MintRoute (tree collection) | 4, flooding split | INET's MintRoute port | [MintRoute](mintroute.md) |
| AODV (on-demand routing) | 4, AODV split | INET's `Aodv` | [AODV](aodv.md) |
| DSR (source routing) | 4, DSR split | `DSRRoute` and `CTL6`, written for this project from the Final Report | [DSR](dsr.md) |

## Results at a glance

Two kinds of figure appear in this project, and they are not interchangeable. The first
compares the generated code with a hand-written reference on the same function. The second
runs the module in a simulator and checks what it does. Every similarity figure is paired with
a run.

**Similarity**, by longest common subsequence over normalised statements, against each
baseline:

| Case study | Baseline | Functions scored | Precision | Recall | F-measure |
|---|---|---|---|---|---|
| SensorApp V2 | INET `SensorApp` | 15 of 15 | 100 % | 100 % | 100 % |
| MintRoute | INET's MintRoute port | 18 | 37.23 % | 43.21 % | 40.00 % |
| AODV | INET's `Aodv` | 21 | 31.89 % | 25.56 % | 28.37 % |
| DSR | `DSRRoute` and `CTL6`, written for this project | 22 | 3.55 % | 3.47 % | 3.51 % |

**Behaviour**, one line per case study:

| Case study | What the run checks | Result |
|---|---|---|
| SensorApp | packets sent and received over 60 s, against `SensorApp` | 59 / 60 / 60 sent and 6 received, identical to the baseline on every node |
| MintRoute | the parent tree on the nine-node field, against shortest paths and the baseline's own rules | all eight sensors choose a parent; every hop is the shortest path; 0 disagreements in 1,156 replayed decisions |
| AODV | every sensor holds a route to the sink, and rebuilds it when a node fails | green on five seeds and the failure runs; the baseline is plain INET AODV |
| DSR | every sensor caches a path to the sink through real links | green on all runs; the baseline is not independent (see below) |

How to read the similarity table:

- **The scored version is the generated code plus the protocol's own logic**, with the
  measurement support (tree drawing, node-failure switch, result scalars) removed. Behaviour
  was checked to be unchanged by that removal: the same event counts and the same routes.
- **The function sets are the functions the structure needs**, not every function the baseline
  has. MintRoute's 18 are its 25 functions minus the 7 that only the data path uses; AODV's 21
  are the functions the structure needs out of 51; DSR's 22 are 6 `DSRRoute` functions
  plus 16 of the controller's `CTL6` functions. Each page lists them.
- **The figures are not a ranking across rows.** The baselines differ in kind: a module that
  shares `SensorApp`'s structure, a module that shares MintRoute's shell, a routing daemon over
  UDP and IP (AODV), and a protocol written for this project from a fragment printed in a report (DSR).
- **DSR's figures carry little weight.** Of its six matching statements, all are `else {` or
  `break;`. Its baseline is written from the same sources as the test code, so it is not an
  independent check. The route tests, not the similarity score, are the DSR evidence.

## What the case studies do not show

Stated plainly, because a generator that overstates its reach is worse than one that does less.

- **The protocol-specific logic is not generated.** MintRoute's parent choice, AODV's route
  discovery and DSR's path handling are hand-written test code, ported from the baselines and
  pasted into the generated module. The generator supplies the common part around them.
- **The three protocols run from one pattern project, not from their own models.** Structure 4
  refuses the MintRoute and RTMCS projects (neither declares the packet state the extension
  builds on), and no DSR Event-B model exists beyond an abstract stub. These runs show the
  pattern layer carrying three different protocols, not three protocol models being translated.
- **No case study sends data.** The sensed value belongs to the environment, so the model's
  data path has no binding. Routes are built and checked; data forwarding is not exercised.
- **The catalog matches shapes and does not nest relational forms.** The DSR reverse-path guard
  is untranslated.
- **A scalar assignment inside an event has no rule.** Initialisation is handled; an event that
  sets a flag is not.
- **The bundled extension files have not been opened in Rodin.** They follow Event-B's
  refinement rules and have not been machine-checked by Rodin's provers.
- **Behavioural equivalence is demonstrated, not proved.** Identical counters and routes are
  evidence of equivalent behaviour, not a refinement argument relating the generated C++ to the
  Event-B model.

## What the three network case studies share

**One input.** All three are generated from the same pattern project; only the routing option
and the pasted test code differ.

**The same shape of experiment.**

1. Generate the module (`--v4 --routing flooding|aodv|dsr`).
2. Paste the protocol's test code into it. Every pasted line is marked and switched by a NED
   parameter.
3. Run it on a nine-node field with a fixed seed, and check the result against what the field
   allows (shortest paths, heard links, the route the simulator's own table holds).
4. Run the baseline on the same field and compare.
5. Break the field (a node fails) and check that routes recover.

**Predictions first.** Every configuration in the harness inis carries its prediction and what
would falsify it, written before the first run. Where a prediction failed, the ini and the page
say so.

## The nine-node field

One sink and eight sensors, with positions taken from the network figure in the paper (itself
drawn after the SensorScope deployment) and scaled by 136 m per figure unit. Free-space
propagation at 2.45 GHz and 2.24 mW gives a range of 259 m at the −85 dBm sensitivity.

- **Links:** 16. The sink has exactly one neighbour, sensor6.
- **Shortest hops to the sink:** sensor6 1; sensor3, sensor5, sensor8 2; sensor2, sensor4,
  sensor7 3; sensor1 4.
- **Link margin:** the longest link is 245.8 m (sensor2 to sensor7) and the closest pair that is
  not a link is 273.7 m (sink to sensor8). Against the 259.2 m range that leaves a margin of 13
  to 15 m on each side, which is safe only because the free-space model is deterministic.
- **Three links the paper's figure does not draw** (sensor3 to sensor5, sensor1 to sensor4,
  sensor2 to sensor7) and one it does draw that falls just outside the range (sink to sensor8).
  A second field, `SensorScopeFigureNetwork`, moves each node by 17 to 54 m so that the links are
  exactly the figure's 14. MintRoute was also run on it.

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

The harness sources for each case study are under [`harness/`](../harness/README.md): the
configurations, the field, the build and run scripts, the checkers, and the readme with each
measured result in full. Which inputs and generated files are published is on the
[About](../about.md#availability) page.

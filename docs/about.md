# About

WSN-CodeGen is the prototype of an automatic code generation framework from pattern-based
Event-B models for wireless sensor networks, developed in the Digital Engineering programme
of the College of Computing, Prince of Songkla University, Phuket Campus.

It extends the pattern-based formal modelling framework of Intana et al., which packages
WSN modelling reuse as seven event component patterns and a refinement pattern. That
framework delivers verified, reusable models; WSN-CodeGen takes the step after it, turning
such a model into code that compiles and runs in a simulator.

---

## What has been measured

Two kinds of figure appear in this project, and they are not interchangeable. The first
compares the generated code with a hand-written reference on the same function. The second
runs the module in a simulator and checks what it does. Every similarity figure here is paired
with a run.

### The application layer

Measured on one Event-B project, **WSN-App**: 3 machines, 14 events, 101 clauses, 36.2 kB of
Rodin XML, 606 emitted lines. The comparison is between emitted *versions* of that model, not
between models.

**Accuracy**, against INET's hand-written `SensorApp` as a reference, by longest common
subsequence over normalised statements:

| Scope | Version | Precision | Recall | F-measure |
|---|---|---|---|---|
| Shell functions (15) | V1 | 79.52 % | 65.35 % | 71.74 % |
| Shell functions (15) | V2 | 100 % | 100 % | 100 % |

**Execution**, over 60 simulated seconds with one sink and three sensor nodes:

| | packets sent | received |
|---|---|---|
| `SensorApp` (reference) | 59 / 60 / 60 | 6 |
| V1 | 0 / 0 / 0 | 0 |
| V2 | 59 / 60 / 60 | 6 |

V1 compiled, ran to completion and exited normally while transmitting nothing. No static
check reported it; only the packet-count comparison exposed it. That is the reason this
project pairs every similarity measurement with a simulation run.

**Rule coverage.** 2 of the 101 clauses are unmatched, a gap of 2.0 %. Both belong to
`PActivate`, the one pattern of the seven with no interface machine in the library the
catalog was induced from, so no rule was induced from it. The catalog's reach follows its
provenance exactly.

**Generation cost.** Under 3 ms for the case study; parse time linear in input bytes and
generation time linear in clause count over controlled scale sweeps.

### The network layer

Three protocols were run on structure 4, each against a baseline. Each one has a page with
its configurations and results: [MintRoute](case-studies/mintroute.md),
[AODV](case-studies/aodv.md), [DSR](case-studies/dsr.md).

| Case study | Baseline | Functions scored | Precision | Recall | F-measure |
|---|---|---|---|---|---|
| SensorApp V2 (reference row) | INET `SensorApp` | 15 of 15 | 100 % | 100 % | 100 % |
| MintRoute | INET's MintRoute port | 18 | 37.23 % | 43.21 % | 40.00 % |
| AODV | INET's `Aodv` | 21 | 31.89 % | 25.56 % | 28.37 % |
| DSR | the Final Report's printed `DSRRoute` | 22 | 3.55 % | 3.47 % | 3.51 % |

How to read it:

- **The scored version is the generated code plus the protocol's own logic**, with the
  measurement support (tree drawing, node-failure switch, result scalars) removed. Behaviour
  was checked to be unchanged by that removal: the same event counts and the same routes.
- **The function sets are the functions the structure needs**, not every function the
  baseline has. MintRoute's 18 are its 25 functions minus the 7 that only the data path uses;
  AODV's 21 are the functions the structure needs out of 51; DSR's 22 are 6 printed
  `DSRRoute` functions plus 16 of the controller's `CTL6` functions (its 7 data events are left
  out). The page for each case study lists them.
- **The figures are not comparable across rows as a ranking.** The baselines differ in kind: a
  module that shares `SensorApp`'s structure, a module that shares MintRoute's shell, a routing
  daemon over UDP and IP (AODV), and a fragment printed in a report (DSR).
- **DSR's figures carry little weight.** Of its six matching statements, all are `else {` or
  `break;`. Its baseline is written from the same sources as the test code, so it is not an
  independent check. The route tests, not the similarity score, are the DSR evidence.

## What it does not do

Stated plainly, because a generator that overstates its reach is worse than one that does
less:

- **The protocol-specific logic is not generated.** MintRoute's parent choice, AODV's route
  discovery and DSR's path handling are hand-written test code, ported from the baselines and
  pasted into the generated module. The generator supplies the common part around them.
- **The three protocols run from one pattern project, not from their own models.** Structure
  4 refuses the MintRoute and RTMCS projects (neither declares the packet state the extension
  builds on), and no DSR Event-B model exists beyond an abstract stub. The pattern project is
  the input for all three.
- **No case study sends data.** The sensed value belongs to the environment, so the model's
  data path has no binding. Routes are built and checked; data forwarding is not exercised.
- **The catalog matches shapes and does not nest relational forms.** The DSR reverse-path
  guard is untranslated.
- **A scalar assignment inside an event has no rule.** Initialisation is handled; an event
  that sets a flag is not.
- **The bundled extension files have not been opened in Rodin.** They are written to follow
  Event-B's refinement rules and have not been machine-checked by Rodin's provers.
- **Behavioural equivalence is demonstrated, not proved.** Identical counters and routes are
  evidence of equivalent behaviour, not a refinement argument relating the generated C++ to
  the Event-B model.

## Availability

- **Tool:** <https://komenpetch.github.io/wsn-codegen/>
- **Source:** <https://github.com/komenpetch/wsn-codegen>, MIT licence
- **Rule catalog:** [TRANSLATION_RULES.md](TRANSLATION_RULES.md), all 38 rules, with the
  Event-B shape, the C++ produced, the storage form assumed, and the pattern events that
  evidence each one
- **Rule map:** [rule-map.md](rule-map.md), which source rule implements which catalog rule,
  generated from the rule source so it cannot drift
- **Harnesses:** [harness/](harness/README.md), the simulation setups behind every measured
  number
- **Findings:** [findings/netlayer/](findings/netlayer/README.md), the dated studies and defect
  reports

The advisor's Event-B case-study models are not part of the repository. The repository holds
the engine, the bundled pattern extension, one application-layer fixture and the harness
sources.

The prototype is TypeScript, React and Vite, deployed as a static site; the engine carries
629 tests.

**How to cite.** Cite the paper that describes the tool. Until it is published, cite the
repository URL together with the commit hash of the version used.

## Acknowledgements

Dr. Thammarsat Visutarrom supervised the project. Asst. Prof. Dr. Adisak Intana provided the
pattern-based Event-B modelling framework this work extends and the WSN models it consumes.

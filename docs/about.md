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

Every figure below is measured on one Event-B project, **WSN-App** — 3 machines, 14 events,
101 clauses, 36.2 kB of Rodin XML, 606 emitted lines. The comparison is between emitted
*versions* of that model, not between models.

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

V1 compiled, ran to completion and exited normally while transmitting nothing — a silent
functional defect that no static check reported and only the packet-count comparison
exposed. That is the reason this project pairs every similarity measurement with a
simulation run.

**Rule coverage.** 2 of the 101 clauses are unmatched, a gap of 2.0 %. Both belong to
`PActivate`, the one pattern of the seven with no interface machine in the library the
catalog was induced from — so no rule was induced from it. The catalog's reach follows its
provenance exactly.

**Generation cost.** Under 3 ms for the case study; parse time linear in input bytes and
generation time linear in clause count over controlled scale sweeps.

## What it does not do

Stated plainly, because a generator that overstates its reach is worse than one that does
less:

- **One model has been validated end to end.** Nothing here shows how the figures move on a
  second project.
- **The focus is the basic communication layer** (M0–M3). The network layer above it —
  route discovery and forwarding — is not taken here: neither generated nor evaluated.
- **The model's events are generated but not driven.** The module reproduces the reference
  traffic through the shell's transmit path; binding simulation objects to model identities
  is still a hand step.
- **The catalog matches shapes and does not nest.** A construct handled at one level is not
  handled inside another.
- **Behavioural equivalence is demonstrated, not proved.** Identical packet counts are
  evidence of equivalent behaviour, not a refinement argument relating the generated C++ to
  the Event-B model.

## Availability

- **Tool:** <https://komenpetch.github.io/wsn-codegen/>
- **Source:** <https://github.com/komenpetch/wsn-codegen>
- **Rule catalog:** [TRANSLATION_RULES.md](TRANSLATION_RULES.md) — all 38 rules, with the
  Event-B shape, the C++ produced, the storage form assumed, and the pattern events that
  evidence each one
- **Rule map:** [rule-map.md](rule-map.md) — which source rule implements which catalog
  rule, generated from the rule source so it cannot drift

The prototype is TypeScript, React and Vite, deployed as a static site; the engine carries
80 unit and snapshot tests.

## Acknowledgements

Dr. Thammarsat Visutarrom supervised the project. Asst. Prof. Dr. Adisak Intana provided the
pattern-based Event-B modelling framework this work extends and the WSN models it consumes.

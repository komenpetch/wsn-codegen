# About

WSN-CodeGen is the prototype of an automatic code generation framework from pattern-based
Event-B models for wireless sensor networks. It was developed in the Digital Engineering
programme of the College of Computing, Prince of Songkla University, Phuket Campus.

It extends the pattern-based formal modelling framework of Intana et al., which packages WSN
modelling reuse as seven event component patterns and a refinement pattern. That framework
delivers verified, reusable models; WSN-CodeGen takes the step after it, turning such a model
into code that compiles and runs in a simulator.

The measured results are on the [case studies](case-studies/index.md#results-at-a-glance) page,
with their limits beside them.

---

## Researchers and developers

| Name | Role |
|---|---|
| Komen Nitchaphon | developer of the tool |
| Dr. Thammarsat Visutarrom | project supervisor |
| Asst. Prof. Dr. Adisak Intana | author of the pattern-based Event-B modelling framework this work extends, and of the WSN models it consumes |

All three are with the Digital Engineering programme, College of Computing, Prince of Songkla
University, Phuket Campus. To reach the project, open an issue in the
[repository](https://github.com/komenpetch/wsn-codegen/issues).

## Availability

**Published**

- **Tool:** <https://komenpetch.github.io/wsn-codegen/>
- **Source:** <https://github.com/komenpetch/wsn-codegen>, MIT licence: the engine, the bundled
  pattern extension, the tests, one application-layer example project and the harness sources
- **Example project and its generated files:** on the [home page](index.md#try-it), built from
  the repository's own fixture each time the site is built
- **Rule catalog:** [Translation rules](TRANSLATION_RULES.md), all 38 rules, with the Event-B
  shape, the C++ produced, the storage form assumed, and the pattern events that evidence each
  one; [Rule map](rule-map.md) says which source rule implements which, and is generated from
  the rule source so it cannot drift
- **Harnesses:** [harness/](harness/README.md), the simulation setups and checkers behind every
  measured number
- **Findings:** [findings/netlayer/](findings/netlayer/README.md), the dated studies and defect
  reports

**Not published yet**

- the Event-B case-study models, which belong to the advisor's research;
- the module generated from them for each protocol; and
- the protocol test code that is pasted into those modules, with its paste guides.

The case-study pages describe each of these, and the harness sources let the measurements be
read; the three items above are what is needed to repeat a protocol run from the start.

## How to cite

Cite the paper that describes the tool. Until it is published, cite the repository URL together
with the commit hash of the version used. The footer of every page names the commit the site was
built from.

## Acknowledgements

Dr. Thammarsat Visutarrom supervised the project. Asst. Prof. Dr. Adisak Intana provided the
pattern-based Event-B modelling framework this work extends and the WSN models it consumes.

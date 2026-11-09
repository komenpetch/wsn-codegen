# WSN-CodeGen

**Automatic code generation from pattern-based Event-B models for wireless sensor networks.**

WSN-CodeGen is a free web application that translates a Rodin Event-B project into a
compilable OMNeT++/INET module. It runs entirely in the browser: the model is parsed and
the code generated on your own machine, and nothing is uploaded to a server.

- **Tool:** <https://komenpetch.github.io/wsn-codegen/>
- **Source:** <https://github.com/komenpetch/wsn-codegen> (MIT licence)

The paper describes the application layer in detail. These pages hold what the paper has no
room for: the network layer, the three protocol case studies, the run configurations and
the measured results.

---

## What it does

Give it a Rodin project (the `.bum` machines and `.buc` contexts as Rodin writes them, with
no annotation added) and it returns **three self-contained files** that drop into an
OMNeT++/INET 4.5 simulation:

| File | Contents |
|---|---|
| `<Name>.h` | the class, its state members, and the inlined Event-B context |
| `<Name>.cc` | one guarded `bool` method per event, plus the simulator-facing shell |
| `<Name>.ned` | the NED interface the simulator needs to instantiate the module |

The default module name is `EbWsn`. The generated `.cc` compiles against real INET 4.5
headers with only those three files present.

## Four emitted structures

The same engine can emit four module structures. The first two are the ones the paper
compares as V1 and V2; the other two add the network layer.

| Flag | Structure | What it is |
|---|---|---|
| `--v1` | 1 | an application module shaped like INET's `SensorApp`, with the transmit call left behind an extension point (the paper's V1) |
| `--v2` | 2 | the same module with the transmit bound and the context inlined, so it matches `SensorApp` (the paper's V2). This is the CLI default |
| `--v3` | 3 | a network protocol module (`NetworkProtocolBase`) that carries the packet classes and the neighbour table from the bundled pattern extension. The web app emits this one |
| `--v4` | 4 | structure 3 plus the next-hop design: a route-table operation, unicast data send, routes published into INET's routing table, and one timer per packet type |

[Documentation](documentation.md) describes each one.

## Highlights

- **Set-theoretic guards are translated, not simplified by hand.** Relational image,
  domain restriction and membership over relations are covered by a
  [38-rule catalog](TRANSLATION_RULES.md) induced from the WSN event component patterns
  themselves, not enumerated from the Event-B language.
- **The whole refinement chain becomes one module.** The most-refined machine, flattened
  over its ancestors, carries every level's state and events, which matches how the
  simulator consumes the result: an INET module is one C++ class.
- **Containers are chosen, not assumed.** Every state variable gets a C++ storage form from
  its Event-B type and its observed usage. A relation used only by whole pairs becomes
  `std::set<std::pair<A,B>>`; one accessed per key becomes `std::map<A,std::set<B>>`.
- **Nothing is dropped silently.** A clause no rule matches is emitted as an explicit
  `// UNTRANSLATED` comment, and the event it belongs to refuses to fire.
- **Each result comes with a run.** Every similarity figure is paired with a simulation
  that checks the module's behaviour, because a module can compile, run and still do
  nothing.

## Scope

The generated part is the common part of a WSN node: sensing, packet creation, the
neighbour and destination buffers, the send and receive path, the packet type classes
(`PPkt`) and the neighbour table (`PRouteTable`).

The protocol-specific part is not generated. MintRoute's parent selection, AODV's route
discovery and DSR's path handling are hand-written test code, pasted into the generated
module and marked line by line. The [case studies](case-studies/index.md) say exactly where
the line falls for each protocol.

## Where to go next

| Page | For |
|---|---|
| [Documentation](documentation.md) | how the framework works: the pipeline, the input format, the four structures, the output contract |
| [Case studies](case-studies/index.md) | SensorApp, MintRoute, AODV and DSR: what is generated, what is pasted, how to run it, what was measured |
| [Translation rules](TRANSLATION_RULES.md) | the complete 38-rule catalog, with the Event-B shape and the C++ each rule produces |
| [Rule map](rule-map.md) | which source rule implements which catalog rule |
| [Interface mapping](INTERFACE_MAPPING.md) | the per-interface Event-B to C++ mapping the catalog was induced from |
| [Usage](usage.md) | running the tool in the browser and from the command line, and putting the module into OMNeT++ |
| [About](about.md) | the project, the evaluation results, the limits, and how to cite it |
| [Harness](harness/README.md) | the simulation harnesses every measured number came from |
| [Findings](findings/netlayer/README.md) | the dated studies and defect reports behind the network-layer work |

---

<small>Documentation current as of generator commit `d129116` (2026-10-29), 629 tests.
Prince of Songkla University, Phuket Campus, College of Computing.</small>

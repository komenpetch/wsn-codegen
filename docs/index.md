# WSN-CodeGen

**Automatic code generation from pattern-based Event-B models for wireless sensor networks.**

WSN-CodeGen is a free web application that translates a Rodin Event-B project into a
compilable OMNeT++/INET application module. It runs entirely in the browser: the model is
parsed and the code generated on your own machine, and nothing is uploaded to a server.

- **Tool:** <https://komenpetch.github.io/wsn-codegen/>
- **Source:** <https://github.com/komenpetch/wsn-codegen>

---

## What it does

Give it a Rodin project — the `.bum` machines and `.buc` contexts as Rodin writes them,
with no annotation added — and it returns **three self-contained files** that drop into an
OMNeT++/INET 4.5 simulation:

| File | Contents |
|---|---|
| `<Name>.h` | the class, its state members, and the inlined Event-B context |
| `<Name>.cc` | one guarded `bool` method per event, plus the simulator-facing shell |
| `<Name>.ned` | the NED interface the simulator needs to instantiate the module |

Nothing else is required. The generated `.cc` compiles against real INET 4.5 headers with
only those three files present.

## Highlights

- **Set-theoretic guards are translated, not simplified by hand.** Relational image,
  domain restriction and membership over relations are covered by a
  [38-rule catalog](TRANSLATION_RULES.md) induced from the WSN event component patterns
  themselves, rather than enumerated from the Event-B language.
- **The whole refinement chain becomes one module.** The most-refined machine, flattened
  over its ancestors, already carries every level's state and events — which matches how
  the simulator consumes the result, since an INET module is one C++ class.
- **Containers are chosen, not assumed.** Every state variable gets a C++ storage form from
  its Event-B type *and* its observed usage — a relation used only by whole pairs becomes
  `std::set<std::pair<A,B>>`, one accessed per key becomes `std::map<A,std::set<B>>`.
- **Nothing is dropped silently.** A clause no rule matches is emitted as an explicit
  `// UNTRANSLATED` comment, and the event it belongs to refuses to fire rather than
  reporting a transition that did not fully happen.

## Scope

The target is the **basic sensing-and-communication capability** of a WSN node: sensing,
packet creation, the neighbour and destination buffers, and the send/receive path. That is
what the seven event component patterns compose, and what machines M0–M3 of the refinement
pattern contain.

Generating a complete WSN protocol stack is **not** attempted. Route discovery and
forwarding live in the network-layer refinements above this one; that layer is not taken
here, and the [About](about.md) page states what that leaves open.

## Where to go next

| Page | For |
|---|---|
| [Documentation](documentation.md) | how the framework works: the pipeline, the input format, the output contract |
| [Translation rules](TRANSLATION_RULES.md) | the complete 38-rule catalog, with the Event-B shape and the C++ each rule produces |
| [Rule map](rule-map.md) | which source rule implements which catalog rule |
| [Interface mapping](INTERFACE_MAPPING.md) | the per-interface Event-B → C++ mapping the catalog was induced from — the evidence behind the rules |
| [Usage](usage.md) | running the tool, in the browser and from the command line |
| [About](about.md) | the project, the evaluation results, and how to cite it |

---

<small>Prince of Songkla University, Phuket Campus — College of Computing.</small>

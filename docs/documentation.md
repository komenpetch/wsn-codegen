# Documentation

How WSN-CodeGen turns a Rodin project into an OMNeT++/INET module. For the rules
themselves see [Translation rules](TRANSLATION_RULES.md); for how to run the tool see
[Usage](usage.md).

---

## 1. The pipeline

Six stages, in order. The first three run once each; the last three are interleaved,
because the rule engine is called by the emitter clause by clause as the module is
assembled.

| # | Stage | Source | Responsibility |
|---|---|---|---|
| 1 | Parser | `src/engine/parser.ts` | reads the Rodin XML, taking identifiers, predicates and assignments from the authoritative attributes |
| 2 | Flattener | `src/engine/flattener.ts` | computes refinement depth, finds the most-refined machine, flattens the chain into one model |
| 3 | Encoding resolver | `src/engine/encodingResolver.ts` | gives every state variable a C++ storage form, from its type *and* its usage |
| 4 | Rules | `src/engine/rules.ts` | the catalog: guard and action shapes keyed by storage form |
| 5 | Rule engine | `src/engine/ruleEngine.ts` | applies the catalog clause by clause; an unmatched clause becomes `// UNTRANSLATED` |
| 6 | Code emitter | `src/engine/codeEmitter.ts` | assembles state, methods, the simulator shell and the `.ned` |

**Why one module and not one per machine.** The most-refined machine, flattened over its
chain, already subsumes the state and events of every abstraction level. Generating from it
yields a single compilable class, which is what the simulator wants: an INET module is one
C++ class, not a chain of them. The flattener is name-agnostic — any `pM1 → uM2 → pM3`
style chain works, and the entry point is discovered from the files rather than configured.

---

## 2. Input: the Rodin project

The input is a Rodin project directory: one `.bum` per machine, one `.buc` per context,
both XML, exactly as Rodin writes them. No annotation is added to the model.

| XML element | Attribute read | What it becomes |
|---|---|---|
| `machineFile` | — | one translation unit; the most-refined machine becomes the module |
| `refinesMachine` | `target` | the refinement edge, from which the chain and its depth are computed |
| `seesContext` | `target` | the context whose axioms supply carrier sets and constants |
| `variable` | `identifier` | a member of the generated class |
| `invariant` | `predicate` | the variable's **type**, and hence its storage form |
| `event` | `label` | one guarded `bool` method, named after the label |
| `parameter` | `identifier` | a method parameter, typed from its typing guard |
| `guard` | `predicate` | an early `return false` test, one per guard |
| `action` | `assignment` | a statement in the method body, in declared order |

Two properties of that structure decide the whole translation.

**A variable's type is not on the variable.** The `variable` element carries only an
identifier; the type is stated separately as an invariant over it. Reading `pktFwdr`'s
container means finding `pktFwdr ∈ PKT ⇸ ND` and interpreting it — which is why encoding
selection is a stage rather than a lookup.

**Predicates come from the authoritative attributes**, `org.eventb.core.predicate` and
`org.eventb.core.assignment`, not from the `text_representation` rendering Rodin also
stores. That rendering is a cache and can be stale.

> **The override glyph.** Because the authoritative attributes are used, relational
> override arrives as the private-use codepoint **U+E103**, not as a printable `⩤`-style
> character. A parser matching the printable glyph drops those actions silently. If you
> extend the rule set, match U+E103.

---

## 3. Encoding selection

The C++ form of an operator depends on how its variable is stored: `x ∈ S` is
`S.count(x) > 0` for a plain set, but `a ↦ b ∈ R` is `R.count({a,b}) > 0` for a set of
pairs, and different again for a map of sets. Six rules decide, by type **and** observed
usage, never by the variable's name.

| ID | Event-B type / usage | C++ container |
|---|---|---|
| ENC1 | element of a carrier set used by identity, or of a constrained integer set | `int`, aliased `Node`, `PktId`, `Data` |
| ENC2 | `S ⊆ T` or `ℙ(T)` | `std::set<T>` |
| ENC3 | `f ∈ A → B` or `A ⇸ B` | `std::map<A,B>` |
| ENC4 | `R ∈ A ↔ B` used only by whole pairs, never indexed | `std::set<std::pair<A,B>>` |
| ENC5 | `M ∈ A → ℙ(B)`, or a relation accessed per key | `std::map<A,std::set<B>>` |
| ENC6 | `BOOL`, or a finite tag carrier set | `bool`; `enum class` |

**ENC4 versus ENC5 is the one that matters in practice.** Both apply to relations, and the
type declaration alone does not separate them — only the usage does. A buffer that is only
ever tested and updated by whole pairs is exactly a set of pairs. A neighbour table whose
value-set is added to and removed from per packet is exactly a map of sets; storing it as a
set of pairs would force a linear scan on every access.

---

## 4. Translation

Each guard and each action is one clause. `translateEvent` tries every rule in
`src/engine/rules.ts` once per clause, in order, and takes the first that matches.

- **Typing guards are dropped** (`x ∈ ND ∧ pkt ∈ PKT`): the C++ types already enforce them.
- **Guards become early returns**, in declared order, then the actions follow.
- **An unmatched clause becomes `// UNTRANSLATED`** rather than disappearing, which is what
  makes the rule gap a figure you can read off the output.
- **An event with any unmatched clause refuses to fire** — it is closed with `return false`
  and a comment saying why, because returning `true` would report a transition that did not
  fully happen.

> **The matcher does not recurse.** A rule is a pattern over one clause; the engine does not
> descend into subexpressions. A construct handled at one level is therefore not handled
> inside another: `MS6` translates `ran({k} ◁ M)` for a stored variable `M`, but not the
> two-level `ran({nIdx} ◁ ran({pkt} ◁ dsrPath))`, whose inner term is itself an expression.
> Nested forms do not occur in the layer this tool targets; they do occur in network-layer
> models, so a recursive matcher is prerequisite to going further.

See [Translation rules](TRANSLATION_RULES.md) for all 38, and [Rule map](rule-map.md) for
which source rule implements which.

> **The two numberings differ.** The catalog has 38 rules; `src/engine/rules.ts` has **25**
> matcher entries, and their ids are not the catalog's names. One matcher can realise
> several catalog rules — `UNION-pair` matches `R ≔ R ∪ {a ↦ b}` and dispatches on the
> container, so it is `PS2` for a pair-set, `FN3` for a function, `MS2` for a map-of-sets —
> and one catalog rule can need several matchers, since Event-B spells some updates more
> than one way. `ENC1`–`ENC6` and `ST1`–`ST5` are not in that file at all: the first six
> choose containers in `encodingResolver.ts`, the last five are structural and applied by
> `codeEmitter.ts`. [Rule map](rule-map.md) gives the correspondence, generated from the
> rule source so it cannot drift.

---

## 5. Output: the three-file contract

| File | What is in it |
|---|---|
| `<Name>.h` | class declaration, state members in their chosen containers, the inlined Event-B context (carrier sets and constants taken from the `.buc` axioms), and the helper templates the rules emit calls to |
| `<Name>.cc` | one guarded `bool` method per event; `INITIALISATION` becomes the constructor; plus the simulator-facing shell |
| `<Name>.ned` | a `simple <Name> like IApp` bound by `@class`, with the parameters, gates and signals the shell uses |

The header is self-contained on purpose: earlier versions `#include`d fixture headers that
only the command-line interface staged, so a module downloaded from the web app referenced
files that were not there. Everything the module needs is now inside the three files.

**The simulator shell.** The generated class derives from INET's `ApplicationBase` and is
shaped like INET's own `SensorApp`: a dispatcher in `handleMessageWhenUp`, a sensing timer,
socket lifecycle handlers. Where the model supplies the communication pattern pair, those
two events are emitted under `SensorApp`'s names — Event-B `send_down` becomes
`bool sendSensorPacket(Node, PktId)` and `send_up` becomes
`bool socketDataArrived(Node, PktId, set<Node>)`, each carrying an `// Event-B: <label>`
provenance comment. Every other event keeps its Event-B name.

> **What is still a hand step.** The model's own event methods are emitted with their guards
> intact but are not driven by the simulation: doing that needs a binding between simulation
> objects and model identities, and a populated Event-B context, since the axioms constrain
> the carrier sets without naming their elements. The generated module reproduces the
> reference traffic through the shell's transmit path, not through the model's events. The
> two `EXTENSION POINT` markers in the emitted `.cc` are where that binding goes.

import { describe, it, expect } from "vitest";
import { bindNodeIdentity, nodeSetsOf } from "../src/engine/nodeIdentity";
import type { EncodedMachine, GeneratedTree, RawContext } from "../src/engine/types";

// A `V ≔ C × {v}` INITIALISATION is specialised to THIS node -- but only when
// `C` actually holds nodes.
//
// ⚠ The carrier used to be an uncaptured `\w+`, so every such action counted.
// Both MintRoute and the bundled pattern extension declare
// `netSeqNo ∈ PKT → ℕ` and initialise it `netSeqNo ≔ PKT × {0}`, and that
// emitted
//
//     netSeqNo[myNodeId] = 0;   // netSeqNo ≔ ND × {…}
//
// into a `std::map<PktId, int>` -- a NODE id used as a PACKET key, which
// compiled only because both are `int` typedefs -- under a comment that said
// ND where the model had said PKT. The wrong comment was the visible half of
// the matcher being too loose; the wrong key was the half that mattered.
//
// The discriminator is not a new one: `nodeSetsOf` is the same ND-plus-subsets
// fixpoint `sinkConstantOf` already used, extracted so both callers share one
// answer rather than growing a second.

const ctx = (over: Partial<RawContext>): RawContext => ({
  name: "C", sets: [], constants: [], axioms: [], ...over,
});
const ax = (...texts: string[]) => texts.map((text, i) => ({ label: `a${i}`, text }));

const modelWith = (...actions: string[]) => ({
  events: [{ label: "INITIALISATION", guards: [], actions, parameters: [] }],
  variables: [], variableTypes: new Map(),
} as unknown as EncodedMachine);

const tree = (): GeneratedTree => [
  { path: "X.h", content: "    // ── Event-B machine state ──\n" },
  { path: "X.cc", content: "void X::initialize(int stage) {\n    base();\n}\n" },
];
const cc = (t: GeneratedTree) => t.find((f) => f.path.endsWith(".cc"))!.content;
const bind = (model: EncodedMachine, contexts: RawContext[]) =>
  cc(bindNodeIdentity(tree(), model, contexts, "X"));

describe("a cartesian INITIALISATION is specialised only over a NODE carrier", () => {
  const nodeCtx = ctx({ constants: [], axioms: ax("Dests ⊆ ND") });

  it("specialises an ND-keyed variable", () => {
    expect(bind(modelWith("linkSeqNo ≔ ND × {0}"), [nodeCtx]))
      .toContain("linkSeqNo[myNodeId] = 0;");
  });

  it("does NOT specialise a PKT-keyed variable -- the defect this exists for", () => {
    const out = bind(modelWith("netSeqNo ≔ PKT × {0}"), [nodeCtx]);
    expect(out).not.toContain("netSeqNo[myNodeId]");
    // and specifically not with a comment claiming the model said ND
    expect(out).not.toContain("netSeqNo ≔ ND");
  });

  it("keeps the node-keyed one and drops the packet-keyed one in the same model", () => {
    // Exactly the bundled extension's own INITIALISATION, which is where this
    // was found: the two sit side by side and only one is about nodes.
    const out = bind(modelWith("linkSeqNo ≔ ND × {0}", "netSeqNo ≔ PKT × {0}"), [nodeCtx]);
    expect(out).toContain("linkSeqNo[myNodeId] = 0;");
    expect(out).not.toContain("netSeqNo[myNodeId]");
  });

  it("reports the carrier the MODEL named, not a hardcoded ND", () => {
    // RTMCS reaches ND through `Destination ⊆ ND`, so a subset is a node
    // carrier too -- and the comment must say which one was matched.
    const out = bind(modelWith("bwdSeqNo ≔ Destination × {0}"),
      [ctx({ axioms: ax("Destination ⊆ ND") })]);
    expect(out).toContain("bwdSeqNo[myNodeId] = 0;   // bwdSeqNo ≔ Destination × {…}");
  });

  it("still handles the excluded-node form over a node carrier", () => {
    const out = bind(modelWith("cost ≔ (ND ∖ {Sink}) × {0}"),
      [ctx({ constants: ["Sink"], axioms: ax("Sink ∈ ND", "Sink = 0") })]);
    expect(out).toContain("if (myNodeId != Sink) cost[myNodeId] = 0;");
  });

  it("and refuses the excluded form when the carrier is NOT nodes", () => {
    expect(bind(modelWith("f ≔ (PKT ∖ {Q0}) × {0}"),
      [ctx({ constants: ["Q0"], axioms: ax("Q0 ∈ PKT") })]))
      .not.toContain("f[myNodeId]");
  });
});

describe("nodeSetsOf is the shared answer, not a second one", () => {
  it("is ND plus its subsets, to a fixpoint regardless of axiom order", () => {
    // Stated inner-first, so a single pass in file order would miss Inner.
    const s = nodeSetsOf([ctx({ axioms: ax("Inner ⊆ Outer", "Outer ⊆ ND") })]);
    expect([...s].sort()).toEqual(["Inner", "ND", "Outer"]);
  });

  it("does not swallow a carrier that is merely mentioned", () => {
    expect(nodeSetsOf([ctx({ axioms: ax("type ∈ PKT → TYPE", "PKT ⊆ MSG") })]))
      .toEqual(new Set(["ND"]));
  });
});

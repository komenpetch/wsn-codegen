import { describe, it, expect } from "vitest";
import { sinkConstantOf, bindNodeIdentity } from "../src/engine/nodeIdentity";
import type { EncodedMachine, GeneratedTree, RawContext } from "../src/engine/types";

// WHICH constant names the distinguished node used to be the literal `Sink`.
// That is MintRoute's and RTMCS's name for it, and those were the only two
// models that had ever reached this binding -- so the first model without one
// emitted `myNodeId = isSink ? Sink : ...` against an undeclared identifier and
// did not compile (found 2026-09-19 by the minimal-medium spike, which is the
// first model to select the network shell without being MintRoute-derived).
//
// The replacement is derived, and the discriminator was MEASURED on the corpus
// rather than chosen: the sink is the only constant carrying BOTH a value axiom
// and membership in the node set. The cases below are the three real shapes.

const ctx = (over: Partial<RawContext>): RawContext => ({
  name: "C", sets: [], constants: [], axioms: [], ...over,
});
const ax = (...texts: string[]) => texts.map((text, i) => ({ label: `a${i}`, text }));

describe("sinkConstantOf", () => {
  it("finds MintRoute's Sink: pinned to a value AND a member of ND", () => {
    expect(sinkConstantOf([ctx({
      constants: ["Sink", "INFINITY"],
      axioms: ax("Sink ∈ ND", "Sink = 0", "INFINITY = 9999"),
    })])).toBe("Sink");
  });

  it("finds RTMCS's Sink through a SUBSET of ND, not ND itself", () => {
    // `Sink ∈ Destination` with `Destination ⊆ ND`. Requiring membership in ND
    // literally would miss it, and RTMCS is half the corpus.
    expect(sinkConstantOf([ctx({
      constants: ["Sink"],
      axioms: ax("Destination ⊆ ND", "Sink ∈ Destination", "Sink = 0"),
    })])).toBe("Sink");
  });

  it("resolves the node sets to a FIXPOINT, so order cannot decide the answer", () => {
    // `Inner ⊆ Outer` is stated BEFORE `Outer ⊆ ND`. A single pass in file order
    // would not yet know Outer was a node set when it read the first axiom.
    expect(sinkConstantOf([ctx({
      constants: ["Root"],
      axioms: ax("Inner ⊆ Outer", "Outer ⊆ ND", "Root ∈ Inner", "Root = 0"),
    })])).toBe("Root");
  });

  it("returns null for the app-layer pattern, whose vocabulary is a SET of destinations", () => {
    // Exactly C0_project: `CTL_VAL = 0` is pinned but is not a node, and
    // `DATA ∈ TYPE` is typed but has no value. Neither half alone qualifies,
    // which is what makes the two-part rule discriminating rather than lucky.
    expect(sinkConstantOf([ctx({
      constants: ["DATA", "CONTROL", "CTL_VAL"],
      axioms: ax("DATA ∈ TYPE", "CONTROL ⊆ TYPE", "CTL_VAL = 0", "Dests ⊆ ND"),
    })])).toBeNull();
  });

  it("rejects a pinned constant typed into a set that is NOT a node set", () => {
    // Without the node-set requirement this would be read as the sink, and the
    // module would adopt a threshold's value as a node id. Nothing else in the
    // suite fails if that requirement is dropped, so this is the test that
    // holds it: `pinned AND typed` alone is not the rule.
    expect(sinkConstantOf([ctx({
      constants: ["safetyThreshold"],
      axioms: ax("QThreshold ⊆ ℕ", "safetyThreshold ∈ QThreshold", "safetyThreshold = 1001"),
    })])).toBeNull();
  });

  it("rejects a pinned constant that is not declared", () => {
    expect(sinkConstantOf([ctx({ constants: [], axioms: ax("Sink ∈ ND", "Sink = 0") })])).toBeNull();
  });

  it("refuses two distinguished nodes rather than letting context order pick", () => {
    expect(() => sinkConstantOf([ctx({
      constants: ["Sink", "Root"],
      axioms: ax("Sink ∈ ND", "Sink = 0", "Root ∈ ND", "Root = 1"),
    })])).toThrow(/ambiguous/);
  });
});

// The emitted consequence. `sinkConstantOf` returning null is a legitimate
// answer, not a failure, so what matters is that the emitted module then has no
// reference to a constant nothing declares -- and still assigns myNodeId.
describe("bindNodeIdentity without a distinguished node", () => {
  const model = { events: [], variables: [], variableTypes: new Map() } as unknown as EncodedMachine;
  const tree = (): GeneratedTree => [
    { path: "X.h", content: "    // ── Event-B machine state ──\n" },
    { path: "X.cc", content: "void X::initialize(int stage) {\n    base();\n}\n" },
  ];
  const cc = (t: GeneratedTree) => t.find((f) => f.path.endsWith(".cc"))!.content;

  it("emits no sink reference and no sink test, but still assigns myNodeId", () => {
    const out = cc(bindNodeIdentity(tree(), model, [ctx({
      constants: ["CTL_VAL"], axioms: ax("CTL_VAL = 0"),
    })], "X"));
    expect(out).not.toMatch(/\bisSink\b/);
    expect(out).toContain("myNodeId = getContainingNode(this)->getId();");
    expect(out).toContain("ND.insert(myNodeId);");
  });

  it("still emits the address comparison when the model DOES name one", () => {
    const out = cc(bindNodeIdentity(tree(), model, [ctx({
      constants: ["Sink"], axioms: ax("Sink ∈ ND", "Sink = 0"),
    })], "X"));
    expect(out).toContain("myNodeId = isSink ? Sink : getContainingNode(this)->getId();");
  });
});

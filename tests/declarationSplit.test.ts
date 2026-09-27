import { describe, it, expect } from "vitest";
import { splitDeclaration } from "../src/engine/text";
import { parseModel } from "../src/engine/parser";
import { routingStyleOf } from "../src/engine/patternExtension";
import { sinkConstantOf } from "../src/engine/nodeIdentity";

// ⚠ AN AXIOM WRITTEN AS A CONJUNCTION HID WHAT IT DECLARED (2026-09-27 bug hunt).
// Every reader of context axioms — the context emitter, the node-set closure,
// the sink and routing detection, the packet-type lattice — matches ONE axiom
// against ONE shape, so `Sink ∈ ND ∧ Sink = 0` matched none of them: the routing
// read AODV where the same facts as two axioms read flooding, and the `Sink`
// constant was silently not emitted. A conjunction of declarations means the
// same thing as the declarations one by one, so the parser splits it — once,
// for every reader.
//
// ⚠ AND IT MUST NOT SPLIT WHAT IS NOT A CONJUNCTION OF DECLARATIONS. MintRoute's
// own TCL.buc has `∀t·t∈wsnfn∧(…)⇒…`: an `∧` at paren depth 0 INSIDE a
// quantifier whose scope runs to the end. Cutting it there makes two false
// axioms. Every case below that stays whole is one of those.

describe("splitDeclaration", () => {
  it("splits a conjunction of declarations into its conjuncts", () => {
    expect(splitDeclaration("Sink ∈ ND ∧ Sink = 0")).toEqual(["Sink ∈ ND", "Sink = 0"]);
    expect(splitDeclaration("a ⊆ ND ∧ b ⊆ a ∧ c ∈ b")).toEqual(["a ⊆ ND", "b ⊆ a", "c ∈ b"]);
  });

  it("leaves a single predicate alone", () => {
    expect(splitDeclaration("Dests ⊆ ND")).toEqual(["Dests ⊆ ND"]);
  });

  it("keeps a bracketed conjunct whole", () => {
    expect(splitDeclaration("(a ∈ S ∧ b ∈ T) ∧ c ∈ U")).toEqual(["(a ∈ S ∧ b ∈ T)", "c ∈ U"]);
    // braces too: `∧` inside a set comprehension is not a top-level conjunction
    expect(splitDeclaration("S = {x · x ∈ T ∧ x > 0} ∧ c ∈ ND")).toEqual(["S = {x · x ∈ T ∧ x > 0}", "c ∈ ND"]);
  });

  it("does not split a quantified axiom — MintRoute TCL.buc's, verbatim", () => {
    const tcl = "∀t·t∈wsnfn∧(∀s·s⊆t∼[s]⇒s=∅)⇒tcl(t)∩(ND ◁ id)=∅";
    expect(splitDeclaration(tcl)).toEqual([tcl]);
    const later = "a ∈ ND ∧ ∀x·x ∈ S ∧ x ∈ T";   // the quantifier's scope runs to the end
    expect(splitDeclaration(later)).toEqual([later]);
  });

  it("does not split where ∧ is not the top-level connective", () => {
    for (const p of ["a ∈ S ∧ b ∈ T ⇒ c ∈ U", "a ∈ S ∧ b ∈ T ⇔ c ∈ U", "¬ a ∈ S ∧ b ∈ T"])
      expect(splitDeclaration(p)).toEqual([p]);
  });
});

const ctxFile = (name: string, constants: string[], axioms: string[]) => ({
  name: `${name}.buc`,
  xml: `<?xml version="1.0" encoding="UTF-8"?>
<org.eventb.core.contextFile org.eventb.core.configuration="org.eventb.core.fwd" version="3">
${constants.map((c, i) => `   <org.eventb.core.constant name="c${i}" org.eventb.core.identifier="${c}"/>`).join("\n")}
${axioms.map((a, i) => `   <org.eventb.core.axiom name="a${i}" org.eventb.core.label="axm${i}" org.eventb.core.predicate="${a}" org.eventb.core.theorem="false"/>`).join("\n")}
</org.eventb.core.contextFile>`,
});

describe("the parser splits a conjunction axiom, so every reader sees each declaration", () => {
  const two = parseModel([ctxFile("C0", ["Sink"], ["Sink ∈ ND", "Sink = 0"])]).contexts;
  const one = parseModel([ctxFile("C0", ["Sink"], ["Sink ∈ ND ∧ Sink = 0"])]).contexts;

  // ⚠ On the AODV signal, not the flooding one: flooding is the DEFAULT, so an
  // input the reader failed to see would read flooding anyway and a flooding
  // assertion here would pass whether the split works or not.
  it("reads the same routing either way", () => {
    const sinkIn = (ax: string[]) => parseModel([ctxFile("C0", ["Dests", "Sink"], ax)]).contexts;
    expect(routingStyleOf(sinkIn(["Dests ⊆ ND", "Sink ∈ Dests", "Sink = 0"]))).toBe("aodv");
    expect(routingStyleOf(sinkIn(["Dests ⊆ ND", "Sink ∈ Dests ∧ Sink = 0"]))).toBe("aodv");
  });

  it("finds the same sink constant either way", () => {
    expect(sinkConstantOf(two)).toBe("Sink");
    expect(sinkConstantOf(one)).toBe("Sink");
  });

  it("labels each part after the axiom it came from", () => {
    expect(one[0].axioms).toEqual([
      { label: "axm0.1", text: "Sink ∈ ND" },
      { label: "axm0.2", text: "Sink = 0" },
    ]);
    // an axiom with nothing to split keeps its label exactly
    expect(two[0].axioms.map((a) => a.label)).toEqual(["axm0", "axm1"]);
  });
});

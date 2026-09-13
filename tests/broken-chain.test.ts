import { describe, it, expect } from "vitest";
import { generateMerged, leafMachine, machineNames } from "../src/engine/pipeline";

// A machine that declares a refines target which is not among the files given has an
// INCOMPLETE chain, and the engine must refuse rather than guess.
//
// It used to guess, and badly. `m.refines ? byName.get(m.refines) : undefined` gives
// undefined both for "refines nothing" and for "refines something absent", so a machine
// with a missing parent scored depth 1, tied with the real base machine, lost the tie on
// parse order, and was dropped from the output entirely. The generator then emitted the
// BASE machine and reported success: "M0, M5 -> merged into M0", with none of M5's state
// or events present and no warning. That is a silent wrong answer of exactly the kind
// this project exists to make impossible.
//
// Reproduction case on disk: test_input/lift (M5 refines M4; M4 absent).

const machine = (name: string, refines?: string, variable = "x") =>
  ({
    name: `${name}.bum`,
    xml:
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<org.eventb.core.machineFile org.eventb.core.configuration="org.eventb.core.fwd">' +
      (refines
        ? `<org.eventb.core.refinesMachine name="r" org.eventb.core.target="${refines}"/>`
        : "") +
      `<org.eventb.core.variable name="v" org.eventb.core.identifier="${variable}"/>` +
      '<org.eventb.core.invariant name="i" org.eventb.core.label="inv1"' +
      ` org.eventb.core.predicate="${variable} ⊆ ND"/>` +
      "</org.eventb.core.machineFile>",
  });

describe("incomplete refinement chain", () => {
  const broken = [machine("M0"), machine("M5", "M4", "liftButton")];

  it("refuses to generate, naming the machine and the missing parent", () => {
    expect(() => generateMerged(broken)).toThrow(/M5.*refines.*M4/);
  });

  it("refuses in leaf detection too, not only when flattening", () => {
    // The drop happened HERE, before flatten was ever reached: the leaf was chosen as M0.
    expect(() => leafMachine(broken)).toThrow(/M5.*refines.*M4/);
    expect(() => machineNames(broken)).toThrow(/M5.*refines.*M4/);
  });

  it("does not silently emit the base machine instead", () => {
    let emitted: string | null = null;
    try { emitted = generateMerged(broken)[0].path; } catch { /* expected */ }
    expect(emitted).toBeNull();
  });

  it("a complete chain still generates, and merges into the leaf", () => {
    const whole = [machine("M0"), machine("M5", "M0", "liftButton")];
    expect(leafMachine(whole)).toBe("M5");
    expect(machineNames(whole)).toEqual(["M0", "M5"]);
    const tree = generateMerged(whole);
    expect(tree.length).toBe(3);
    // the leaf's own state reaches the output -- the thing that vanished before
    expect(tree.map((f) => f.content).join("\n")).toContain("liftButton");
  });

  it("a lone base machine is still fine: refining nothing is not a broken chain", () => {
    expect(leafMachine([machine("M0")])).toBe("M0");
  });
});

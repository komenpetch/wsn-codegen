import { describe, it, expect } from "vitest";
import { derivedSetEqualities, substituteEqualNames } from "../src/engine/setAlias";
import type { RawContext, RawModel } from "../src/engine/types";

// `Update_wsn/C0_project/C1.buc` — the user's input — and
// `Ex_WSN_Pattern/WSN_Pattern/C1.buc` — the pattern the tool bundles — declare
// the SAME concept under two names. Every axiom matches except the one naming
// it. The 2026-05-17 verification against raw XML settled `CONTROL` as the
// authoritative name.
const ctx = (name: string, sets: string[], constants: string[], axioms: string[]): RawContext => ({
  name, sets, constants,
  axioms: axioms.map((text, i) => ({ label: `axm${i + 1}`, text })),
});

const projectCtl = () => ctx("C1", ["TYPE"], ["DATA", "CONTROL", "type"], [
  "DATA ∈ TYPE",
  "CONTROL ⊆ TYPE",
  "partition(TYPE, CONTROL, {DATA})",
  "type ∈ PKT → TYPE",
]);

const patternFlood = () => ctx("C1", ["TYPE"], ["DATA", "FLOOD", "type"], [
  "DATA ∈ TYPE",
  "FLOOD ⊆ TYPE",
  "partition(TYPE, FLOOD, {DATA})",
  "type ∈ PKT → TYPE",
]);

const eqs = (project: RawContext[], bundledPattern: RawContext[]) =>
  derivedSetEqualities({ project, bundledPattern });
const pairs = (project: RawContext[], bundledPattern: RawContext[]) =>
  eqs(project, bundledPattern).map((e) => [e.bundledName, e.projectName]);

// ─────────────────────────────────────────────────────────────────────────
// The warrant. `partition(S, P₁, …, Pₙ)` means `S = ⋃Pᵢ` with the parts
// pairwise disjoint, so:
//
//     base:    S = A ⊎ R        pattern: S = X ⊎ R
//     ⟹ A = S ∖ R = X
//
// valid for any arity ≥ 2, and requiring (a) the same S and (b) the rest
// identical AS A SET OF PARTS. ⚠ The parts are unordered: `partition(S, A, B)`
// and `partition(S, B, A)` are the same predicate.
// ─────────────────────────────────────────────────────────────────────────
describe("derivedSetEqualities — the truth table", () => {
  it("row 1: one part differs, rest identical → equality derivable", () => {
    expect(pairs([projectCtl()], [patternFlood()])).toEqual([["FLOOD", "CONTROL"]]);
  });

  it("⚠ row 2: the SAME parts written in the other order still yields the equality", () => {
    // partition is unordered, so this is the same shape as row 1. Comparing
    // positions rather than sets would call this two differing positions and
    // refuse a rename that follows from the axioms.
    const reordered = ctx("C1", ["TYPE"], ["DATA", "FLOOD"], [
      "partition(TYPE, {DATA}, FLOOD)",
    ]);
    expect(pairs([projectCtl()], [reordered])).toEqual([["FLOOD", "CONTROL"]]);
  });

  it("⚠ row 3: an identical partition written in the other order yields nothing", () => {
    const reordered = ctx("C1", ["TYPE"], ["DATA", "CONTROL"], [
      "partition(TYPE, {DATA}, CONTROL)",
    ]);
    expect(eqs([projectCtl()], [reordered])).toEqual([]);
  });

  it("row 4: two genuinely different parts → NOT derivable, refuse", () => {
    // All that follows is CONTROL ∪ {DATA} = FLOOD ∪ {INFO}. Which name means
    // which is a choice nobody has made.
    const twoDiffer = ctx("C1", ["TYPE"], ["INFO", "FLOOD"], [
      "partition(TYPE, FLOOD, {INFO})",
    ]);
    expect(() => eqs([projectCtl()], [twoDiffer])).toThrow(/FLOOD|INFO/);
  });

  it("row 5: arity 3, one part differs → equality derivable", () => {
    const base = ctx("C3", ["S"], ["A", "B", "C"], ["partition(S, A, B, C)"]);
    const pat = ctx("C3", ["S"], ["A", "B", "X"], ["partition(S, A, B, X)"]);
    expect(pairs([base], [pat])).toEqual([["X", "C"]]);
  });

  it("⚠ row 6: arity 3, reordered AND renamed → still derivable", () => {
    const base = ctx("C3", ["S"], ["A", "B", "C"], ["partition(S, A, B, C)"]);
    const pat = ctx("C3", ["S"], ["A", "B", "X"], ["partition(S, X, B, A)"]);
    expect(pairs([base], [pat])).toEqual([["X", "C"]]);
  });

  it("⚠ row 7: nothing follows when the project does not DECLARE the parent", () => {
    // The derivation needs the same S. Across two projects the parent is only a
    // NAME, and it is the merge that identifies names — so the rule may only be
    // applied where the merge genuinely will identify them: the parent has to be
    // declared on the project side too.
    //
    // ⚠ Note what this test has to do to be worth anything. The parent NAME must
    // match — otherwise the parent/arity filter rejects the pair first and the
    // test passes without the precondition ever running. An earlier version of
    // this test used a different parent name and was inert: it passed with the
    // precondition deleted.
    const projectNoDecl = ctx("C1", [], ["CONTROL", "DATA"], [
      "partition(TYPE, CONTROL, {DATA})",
    ]);
    const pat = ctx("C1", ["TYPE"], ["DATA", "FLOOD"], [
      "partition(TYPE, FLOOD, {DATA})",
    ]);
    expect(eqs([projectNoDecl], [pat])).toEqual([]);
  });

  it("row 7 (converse): the same shapes DO reconcile once the project declares the parent", () => {
    // The pair only differs from the test above by `TYPE` being declared, which
    // is what makes that test about the precondition and not about the filter.
    const projectDecl = ctx("C1", ["TYPE"], ["CONTROL", "DATA"], [
      "partition(TYPE, CONTROL, {DATA})",
    ]);
    const pat = ctx("C1", ["TYPE"], ["DATA", "FLOOD"], [
      "partition(TYPE, FLOOD, {DATA})",
    ]);
    expect(pairs([projectDecl], [pat])).toEqual([["FLOOD", "CONTROL"]]);
  });

  it("finds nothing when both sides already agree", () => {
    expect(eqs([projectCtl()], [projectCtl()])).toEqual([]);
  });

  it("finds nothing across partitions of different arity", () => {
    const other = ctx("C3", ["TYPE"], ["ROUTE"], ["partition(TYPE, CONTROL, {DATA}, {ROUTE})"]);
    expect(eqs([projectCtl()], [other])).toEqual([]);
  });
});

describe("derivedSetEqualities — direction, warrant and conflicts", () => {
  it("maps the BUNDLED name onto the PROJECT name, never the reverse", () => {
    const [e] = eqs([projectCtl()], [patternFlood()]);
    expect(e.bundledName).toBe("FLOOD");
    expect(e.projectName).toBe("CONTROL");
  });

  it("⚠ takes its two sides by NAME, so they cannot be swapped by position", () => {
    expect(derivedSetEqualities.length).toBe(1);
  });

  it("carries the WARRANT — the two axioms the equality was read off", () => {
    // Without this the equality is an assertion. With it, a reader can check the
    // derivation, and the emitted code can say why two names are one storage.
    const [e] = eqs([projectCtl()], [patternFlood()]);
    expect(e.warrant.project).toBe("partition(TYPE, CONTROL, {DATA})");
    expect(e.warrant.bundled).toBe("partition(TYPE, FLOOD, {DATA})");
  });

  it("⚠ REFUSES when two bundled sets would collapse onto one project name", () => {
    const twoOntoOne = ctx("C1", ["TYPE"], ["DATA", "FLOOD", "SIGNAL"], [
      "partition(TYPE, FLOOD, {DATA})",
      "partition(TYPE, SIGNAL, {DATA})",
    ]);
    expect(() => eqs([projectCtl()], [twoOntoOne]))
      .toThrow(/FLOOD[\s\S]*SIGNAL|SIGNAL[\s\S]*FLOOD/);
  });

  it("⚠ REFUSES when one bundled set would equal two different project names", () => {
    const project = [ctx("C1", ["TYPE", "KIND"], ["DATA", "CONTROL", "SIGNAL"], [
      "partition(TYPE, CONTROL, {DATA})",
      "partition(KIND, SIGNAL, {DATA})",
    ])];
    const pattern = [ctx("C1", ["TYPE", "KIND"], ["DATA", "FLOOD"], [
      "partition(TYPE, FLOOD, {DATA})",
      "partition(KIND, FLOOD, {DATA})",
    ])];
    expect(() => eqs(project, pattern)).toThrow(/FLOOD/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ⚠ Substitution is a SEPARATE DECISION from the equality, and a lossy one.
// These tests pin that it is opt-in and that it is labelled for what it is.
// ─────────────────────────────────────────────────────────────────────────
describe("substituteEqualNames", () => {
  const model = (): RawModel => ({
    contexts: [patternFlood()],
    machines: [{
      name: "M2",
      sees: ["C1"],
      variables: ["floodedPkts"],
      invariants: [{ label: "inv1", text: "floodedPkts ⊆ FLOOD" }],
      events: [{
        label: "node_create_floodPkt",
        extended: false,
        parameters: ["pkt"],
        guards: [{ label: "grd1", text: "type(pkt) ∈ FLOOD" }],
        actions: [{ label: "act1", text: "floodedPkts ≔ floodedPkts ∪ {pkt}" }],
      }],
    }],
  });

  const equalities = () => eqs([projectCtl()], [patternFlood()]);

  it("renames the constant where it is DECLARED", () => {
    const out = substituteEqualNames(model(), equalities());
    expect(out.contexts[0].constants).toContain("CONTROL");
    expect(out.contexts[0].constants).not.toContain("FLOOD");
  });

  it("renames it inside guards, actions and invariants, not only the context", () => {
    // A context-only rename leaves every event guarding on a name nothing
    // declares — a compile error at best, a silently-false guard at worst.
    const out = substituteEqualNames(model(), equalities());
    expect(out.machines[0].invariants[0].text).toBe("floodedPkts ⊆ CONTROL");
    expect(out.machines[0].events[0].guards[0].text).toBe("type(pkt) ∈ CONTROL");
  });

  it("matches whole identifiers only", () => {
    const m = model();
    m.machines[0].events[0].guards = [{ label: "grd1", text: "FLOODED ∪ FLOOD ∪ preFLOOD" }];
    const out = substituteEqualNames(m, equalities());
    expect(out.machines[0].events[0].guards[0].text).toBe("FLOODED ∪ CONTROL ∪ preFLOOD");
  });

  it("is a no-op with no equalities", () => {
    const before = model();
    expect(substituteEqualNames(before, [])).toEqual(before);
  });

  it("does not mutate its input", () => {
    const before = model();
    substituteEqualNames(before, equalities());
    expect(before.machines[0].events[0].guards[0].text).toBe("type(pkt) ∈ FLOOD");
  });
});

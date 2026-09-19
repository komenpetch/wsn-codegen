import { describe, it, expect } from "vitest";
import { setAliasesOf, applyAliases } from "../src/engine/setAlias";
import type { RawContext, RawModel } from "../src/engine/types";

// The two real contexts, transcribed from the projects they come from.
//
// `Update_wsn/C0_project/C1.buc` — the user's input — and
// `Ex_WSN_Pattern/WSN_Pattern/C1.buc` — the pattern the tool bundles — declare
// the SAME concept under two names. Every axiom matches except the one naming
// it. The 2026-05-17 verification against raw XML settled `CONTROL` as the
// authoritative name, so the pattern's `FLOOD` is what gets renamed.
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

const aliasesFor = (project: RawContext[], bundledPattern: RawContext[]) =>
  setAliasesOf({ project, bundledPattern });

describe("setAliasesOf", () => {
  it("reads FLOOD ≡ CONTROL off two partitions that differ in one position", () => {
    expect(aliasesFor([projectCtl()], [patternFlood()]).get("FLOOD")).toBe("CONTROL");
  });

  it("maps the BUNDLED name onto the PROJECT name, never the reverse", () => {
    // Direction is load-bearing: the project is the user's input and its events
    // guard on `CONTROL`. Renaming the other way would rewrite the user's own
    // model to match a bundled fixture.
    const aliases = aliasesFor([projectCtl()], [patternFlood()]);
    expect(aliases.has("CONTROL")).toBe(false);
    expect([...aliases]).toEqual([["FLOOD", "CONTROL"]]);
  });

  it("⚠ takes its two sides by NAME, so they cannot be swapped by position", () => {
    // The two sides are both RawContext[]. Passing them positionally would let a
    // caller swap them and have it type-check, which would point the rename at
    // the user's own model. Structure 3's packet-source slots were swappable in
    // exactly this way and it cost 13 clang errors that named nothing useful.
    expect(setAliasesOf.length).toBe(1);
    const swapped = setAliasesOf({ project: [patternFlood()], bundledPattern: [projectCtl()] });
    expect([...swapped]).toEqual([["CONTROL", "FLOOD"]]);
  });

  it("finds nothing when both sides already agree on the name", () => {
    expect(aliasesFor([projectCtl()], [projectCtl()]).size).toBe(0);
  });

  it("finds nothing when the partitions have different arity", () => {
    // `partition(CONTROL, {ROUTE}, {BEACON})` is a DIFFERENT partition from
    // `partition(TYPE, CONTROL, {DATA})`, not the same one renamed. Matching on
    // parent alone would pair them and invent an alias.
    const other = ctx("C3", [], ["ROUTE", "BEACON"], [
      "partition(TYPE, CONTROL, {DATA}, {EXTRA})",
    ]);
    expect(aliasesFor([projectCtl()], [other]).size).toBe(0);
  });

  it("⚠ REFUSES rather than guessing when two positions differ", () => {
    // One differing position is a rename. Two is a different partition wearing
    // similar clothes, and picking a pairing would be a coin toss that compiles.
    const twoDiffer = ctx("C1", ["TYPE"], ["INFO", "FLOOD", "type"], [
      "partition(TYPE, FLOOD, {INFO})",
    ]);
    expect(() => aliasesFor([projectCtl()], [twoDiffer])).toThrow(/FLOOD|INFO/);
  });

  it("names both partitions in the refusal, because the pairing is the question", () => {
    const twoDiffer = ctx("C1", ["TYPE"], ["INFO", "FLOOD", "type"], [
      "partition(TYPE, FLOOD, {INFO})",
    ]);
    let message = "";
    try { aliasesFor([projectCtl()], [twoDiffer]); } catch (e) { message = String(e); }
    expect(message).toContain("partition(TYPE, CONTROL, {DATA})");
    expect(message).toContain("partition(TYPE, FLOOD, {INFO})");
  });

  it("⚠ REFUSES when two bundled sets would collapse onto one project name", () => {
    // FLOOD and SIGNAL are distinct sets in the pattern. Both sit one position
    // from the project's CONTROL, so recording both would merge two sets the
    // pattern keeps apart — and every guard over SIGNAL would silently become a
    // guard over CONTROL.
    const twoOntoOne = ctx("C1", ["TYPE"], ["DATA", "FLOOD", "SIGNAL"], [
      "partition(TYPE, FLOOD, {DATA})",
      "partition(TYPE, SIGNAL, {DATA})",
    ]);
    expect(() => aliasesFor([projectCtl()], [twoOntoOne]))
      .toThrow(/FLOOD[\s\S]*SIGNAL|SIGNAL[\s\S]*FLOOD/);
  });

  it("⚠ REFUSES when one bundled set would map to two different project names", () => {
    // Two parents, so two independent candidate sets, each one position away.
    // Last-write-wins would silently pick whichever came second.
    const project = [ctx("C1", ["TYPE", "KIND"], ["DATA", "CONTROL", "SIGNAL"], [
      "partition(TYPE, CONTROL, {DATA})",
      "partition(KIND, SIGNAL, {DATA})",
    ])];
    const pattern = [ctx("C1", ["TYPE", "KIND"], ["DATA", "FLOOD"], [
      "partition(TYPE, FLOOD, {DATA})",
      "partition(KIND, FLOOD, {DATA})",
    ])];
    expect(() => aliasesFor(project, pattern)).toThrow(/FLOOD/);
  });
});

describe("applyAliases", () => {
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

  const aliases = new Map([["FLOOD", "CONTROL"]]);

  it("renames the constant where it is DECLARED", () => {
    const out = applyAliases(model(), aliases);
    expect(out.contexts[0].constants).toContain("CONTROL");
    expect(out.contexts[0].constants).not.toContain("FLOOD");
  });

  it("renames it inside axiom text", () => {
    const out = applyAliases(model(), aliases);
    const texts = out.contexts[0].axioms.map((a) => a.text);
    expect(texts).toContain("partition(TYPE, CONTROL, {DATA})");
    expect(texts.some((t) => t.includes("FLOOD"))).toBe(false);
  });

  it("renames it inside guards, actions and invariants", () => {
    // ⚠ The rename must reach the MACHINE, not only the context. A context-only
    // rename leaves every event guarding on a name nothing declares, which is a
    // compile error at best and a silently-false guard at worst.
    const out = applyAliases(model(), aliases);
    const m = out.machines[0];
    expect(m.invariants[0].text).toBe("floodedPkts ⊆ CONTROL");
    expect(m.events[0].guards[0].text).toBe("type(pkt) ∈ CONTROL");
  });

  it("matches whole identifiers only", () => {
    // `FLOODED` and `preFLOOD` are different names. A substring replace would
    // corrupt them into `CONTROLED` / `preCONTROL`.
    const m = model();
    m.machines[0].events[0].guards = [{ label: "grd1", text: "FLOODED ∪ FLOOD ∪ preFLOOD" }];
    const out = applyAliases(m, aliases);
    expect(out.machines[0].events[0].guards[0].text).toBe("FLOODED ∪ CONTROL ∪ preFLOOD");
  });

  it("leaves the model untouched when there are no aliases", () => {
    const before = model();
    expect(applyAliases(before, new Map())).toEqual(before);
  });

  it("does not mutate its input", () => {
    const before = model();
    applyAliases(before, aliases);
    expect(before.machines[0].events[0].guards[0].text).toBe("type(pkt) ∈ FLOOD");
  });
});

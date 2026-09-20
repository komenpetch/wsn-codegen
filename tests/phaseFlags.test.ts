import { describe, it, expect } from "vitest";
import { orderByPhase, isPhaseTerminator, flagUseOf, booleanFlagsOf } from "../src/engine/phaseFlags";
import type { EncodedMachine, FlatEvent } from "../src/engine/types";

// The batch order is BEHAVIOUR: `runEnabledEvents()` attempts each event once
// per tick in this order, and each attempt sees what the earlier ones left.
//
// Two shapes starve an event for ever under a fixed order, both measured on
// RTMCS before anything here was written:
//
//   * a strictly more specific CONTENDER for the same flag is dead by
//     construction -- it is enabled only when the weaker one is, and the weaker
//     one is tried first and falsifies it;
//   * a PHASE TERMINATOR tried before the phase's own events empties the phase.

const ev = (label: string, guards: string[], actions: string[]): FlatEvent =>
  ({ label, parameters: ["x"], guards, actions });

const machine = (events: FlatEvent[], types: [string, string][]): EncodedMachine => ({
  name: "M", chain: ["M"], variables: types.map(([v]) => v),
  variableTypes: new Map(types), events, encodings: new Map(),
});

// The RTMCS phase machine, reduced to what the ordering depends on. Guard and
// action text is the model's own, so a change of spelling there fails here.
const FLAGS: [string, string][] = [["floodFlg", "floodFlg ∈ ND → BOOL"],
  ["rrepFlg", "rrepFlg ∈ ND → BOOL"]];

const startRREQ = ev("start_fldRREQ", ["x ∈ ND", "floodFlg(x) = FALSE"],
  ["floodFlg(x) ≔ TRUE"]);
const startRREP = ev("start_fldRREP",
  ["x ∈ ND", "floodFlg(x) = FALSE", "x ∈ dom(rrepLists)", "rrepFlg(x) = FALSE"],
  ["floodFlg(x) ≔ TRUE", "rrepFlg(x) ≔ TRUE"]);
const resetRREQ = ev("reset_fldRREQ", ["x ∈ dom(floodFlg)", "floodFlg(x) = TRUE"],
  ["floodFlg(x) ≔ FALSE"]);
const createRREQ = ev("create_rreq", ["floodFlg(x) = TRUE", "rrepFlg(x) = FALSE"],
  ["ndBuff ≔ ndBuff ∪ {x ↦ pkt}"]);

describe("orderByPhase", () => {
  it("tries the strictly more specific contender first", () => {
    // Model order is RREQ then RREP. Left alone, start_fldRREP can NEVER fire:
    // every state that enables it enables start_fldRREQ, which is tried first
    // and takes the flag. Measured on the real model as 308/372/364/336 calls
    // and the same number of rejections on that one guard.
    const m = machine([startRREQ, startRREP], FLAGS);
    expect(orderByPhase(m, ["start_fldRREQ", "start_fldRREP"]))
      .toEqual(["start_fldRREP", "start_fldRREQ"]);
  });

  it("leaves incomparable contenders in model order", () => {
    // start_fldRRER guards rrerFlg where start_fldRREP guards rrepFlg: neither
    // clause set contains the other, so there is no reason to prefer either and
    // the model's own order stands.
    const startRRER = ev("start_fldRRER",
      ["x ∈ ND", "floodFlg(x) = FALSE", "rrerFlg(x) = FALSE"],
      ["floodFlg(x) ≔ TRUE", "rrerFlg(x) ≔ TRUE"]);
    const m = machine([startRREP, startRRER],
      [...FLAGS, ["rrerFlg", "rrerFlg ∈ ND → BOOL"]]);
    expect(orderByPhase(m, ["start_fldRREP", "start_fldRRER"]))
      .toEqual(["start_fldRREP", "start_fldRRER"]);
  });

  it("moves a phase terminator after the events its phase enables", () => {
    // Model order is start(8), reset(9), create(10) -- in BOTH case studies --
    // so the flag is raised and lowered before the creating event is tried and
    // it sees FALSE. Nothing would ever be created.
    const m = machine([startRREQ, resetRREQ, createRREQ], FLAGS);
    expect(orderByPhase(m, ["start_fldRREQ", "reset_fldRREQ", "create_rreq"]))
      .toEqual(["start_fldRREQ", "create_rreq", "reset_fldRREQ"]);
  });

  it("orders the terminators among themselves by specificity too", () => {
    // reset_fldRREQ's guard is `floodFlg = TRUE` and nothing else, so it
    // releases a lock the RREP phase took. Tried first it would end that phase
    // before reset_fldRREP could lower rrepFlg, leaving rrepFlg raised for ever
    // and create_rreq (which needs it LOW) blocked from then on.
    const resetRREP = ev("reset_fldRREP",
      ["x ∈ dom(floodFlg)", "floodFlg(x) = TRUE", "rrepFlg(x) = TRUE"],
      ["floodFlg(x) ≔ FALSE", "rrepFlg(x) ≔ FALSE"]);
    const m = machine([resetRREQ, resetRREP], FLAGS);
    expect(orderByPhase(m, ["reset_fldRREQ", "reset_fldRREP"]))
      .toEqual(["reset_fldRREP", "reset_fldRREQ"]);
  });

  it("is the identity on a model with no boolean flags", () => {
    // The app-layer chain writes no boolean at all, which is why structure 3
    // comes out byte-identical. Asserted so that stops being a coincidence.
    const m = machine([ev("a", ["x ∈ ND"], ["s ≔ s ∪ {x}"])], []);
    expect(orderByPhase(m, ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("does not reorder an event that contends on two flags at once", () => {
    // `both` belongs to two contended groups, so it has two anchors and no
    // reason to prefer either -- whichever group happened to be processed last
    // would win, i.e. the answer would come from Map iteration order. Model
    // order stands instead.
    //
    // ⚠ The positions are chosen so this test can FAIL: with the guard removed
    // the second group's anchor hoists `both` above `second`, giving
    // first/both/second. An earlier version of this test used positions where
    // both answers coincided and it passed with the guard disabled -- i.e. it
    // proved nothing, which a mutation run is what catches.
    const second = ev("second", ["f2(x) = FALSE"], ["f2(x) ≔ TRUE"]);
    const first = ev("first", ["f1(x) = FALSE"], ["f1(x) ≔ TRUE"]);
    const both = ev("both", ["f1(x) = FALSE", "f2(x) = FALSE"],
      ["f1(x) ≔ TRUE", "f2(x) ≔ TRUE"]);
    const m = machine([second, first, both],
      [["f1", "f1 ∈ ND → BOOL"], ["f2", "f2 ∈ ND → BOOL"]]);
    expect(orderByPhase(m, ["second", "first", "both"]))
      .toEqual(["second", "first", "both"]);
  });
});

describe("isPhaseTerminator", () => {
  const flags = new Set(["floodFlg", "ctlSensedFlg", "envSensedFlg"]);

  it("accepts an event that only lowers a flag it guards as raised", () => {
    expect(isPhaseTerminator(flagUseOf(resetRREQ, flags))).toBe(true);
  });

  it("refuses an event that carries state of its own", () => {
    // finish_sensing lowers two flags AND clears sensingNDs. It is not a pure
    // "this phase is over", so it stays exactly where the model put it --
    // moving it would move an action that is not about the flag.
    const finishSensing = ev("finish_sensing",
      ["sensingNDs = {x}", "envSensedFlg(x) = TRUE", "ctlSensedFlg(x) = TRUE"],
      ["sensingNDs ≔ ∅", "ctlSensedFlg(x) ≔ FALSE", "envSensedFlg(x) ≔ FALSE"]);
    expect(isPhaseTerminator(flagUseOf(finishSensing, flags))).toBe(false);
  });

  it("refuses an event that RAISES a flag", () => {
    expect(isPhaseTerminator(flagUseOf(startRREQ, flags))).toBe(false);
  });

  it("refuses lowering a flag the event does not guard as raised", () => {
    // Without the read side this would match any event whose only action sets a
    // boolean false, including one that is not ending its own phase.
    const blind = ev("blind", ["x ∈ ND"], ["floodFlg(x) ≔ FALSE"]);
    expect(isPhaseTerminator(flagUseOf(blind, flags))).toBe(false);
  });
});

describe("booleanFlagsOf", () => {
  it("takes the flags from the declared type, not from how they are used", () => {
    const m = machine([], [["floodFlg", "floodFlg ∈ ND → BOOL"],
      ["bcastRouTimer", "bcastRouTimer ∈ BOOL"],
      ["floodTbl", "floodTbl ∈ ND → ℙ(PKT)"]]);
    expect(booleanFlagsOf(m)).toEqual(new Set(["floodFlg", "bcastRouTimer"]));
  });
});

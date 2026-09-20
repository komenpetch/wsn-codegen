import { describe, it, expect } from "vitest";
import { openNodeSubsetsOf, membershipParam } from "../src/engine/nodeIdentity";
import type { RawContext } from "../src/engine/types";

// Which node subsets must a HARNESS populate? The ones the axioms declare and
// leave open. `Dests ⊆ ND` is the case that mattered: declared, never filled,
// so `ND ∖ Dests` admitted every node and `dest_recv_pkt`'s `nb ∈ Dests` could
// never hold — the flood had no destination at all.
//
// ⚠ IT MUST BE A SHAPE, NOT A NAME. A rule keyed on "Dests" would be a special
// case for one project; keyed on the axioms it picks out exactly the sets that
// need supplying and leaves both case studies alone. These tests pin the three
// corpus shapes, so a widening that pulls in RTMCS or MintRoute fails here.

const ctx = (axioms: string[], constants: string[] = []): RawContext[] => [
  { name: "C", sets: [], constants, axioms: axioms.map((text, i) => ({ label: `a${i}`, text })) },
];

describe("openNodeSubsetsOf", () => {
  it("claims a node subset whose members no axiom fixes (AppLayer's Dests)", () => {
    expect(openNodeSubsetsOf(ctx(["ND ⊆ ℕ", "Dests ⊆ ND"]))).toEqual(["Dests"]);
  });

  it("leaves ND alone — this same pass binds it to the simulation's nodes", () => {
    expect(openNodeSubsetsOf(ctx(["ND ⊆ ℕ"]))).toEqual([]);
  });

  // ⚠ THESE TWO ASSERTED THE OPPOSITE UNTIL 2026-09-21, AND THEY WERE WRONG.
  // An enumeration does not close a node subset, for the same reason `ND` is
  // emitted empty: node identity is bound at RUNTIME. Those enumerations live
  // in `T01.buc`, the test/animation context, and the measurement that settled
  // it is that the RTMCS harness assigns sink=0, sensor1=6, sensor2=7,
  // sensor3=8 — so `Actuators = {1,8,9}` names two nodes that do not exist.
  // Excluding them was not neutral: it left them declared, empty and fillable
  // by nothing, so RTMCS had no destinations at all.
  it("claims a node subset even when an axiom enumerates it (RTMCS's Actuators)", () => {
    expect(openNodeSubsetsOf(ctx(["Actuators ⊆ ND", "Actuators = {1,8,9}"]))).toEqual(["Actuators"]);
  });

  it("claims a node subset even when a partition names its parts (RTMCS's Destination)", () => {
    // `partition(Destination, {Sink}, Actuators)` reduces it to ANOTHER unfixed
    // set, so it never grounded the membership in anything the runtime can use.
    expect(openNodeSubsetsOf(ctx([
      "Destination ⊆ ND",
      "partition(Destination, {Sink}, Actuators)",
    ]))).toEqual(["Destination"]);
  });

  it("follows the subset chain, so an indirect node subset still counts", () => {
    // `Actuators ⊆ Destination ⊆ ND` — a node subset two steps down.
    expect(openNodeSubsetsOf(ctx([
      "ND ⊆ ℕ", "Destination ⊆ ND", "Actuators ⊆ Destination",
    ]))).toEqual(["Actuators", "Destination"]);
  });

  it("claims nothing when the model declares no node subset (MintRoute)", () => {
    expect(openNodeSubsetsOf(ctx(["ND ⊆ ℕ", "Sink ∈ ND", "Sink = 0"]))).toEqual([]);
  });

  it("names the parameter after the constant, so the two cannot drift", () => {
    expect(membershipParam("Dests")).toBe("inDests");
  });
});

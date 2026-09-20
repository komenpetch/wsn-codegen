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

  it("leaves a subset the axioms enumerate (RTMCS's `Actuators = {1,8,9}`)", () => {
    expect(openNodeSubsetsOf(ctx(["Actuators ⊆ ND", "Actuators = {1,8,9}"]))).toEqual([]);
  });

  it("leaves a subset a partition fixes (RTMCS's Destination)", () => {
    // `partition(Destination, {Sink}, Actuators)` says exactly who is in it.
    expect(openNodeSubsetsOf(ctx([
      "Destination ⊆ ND",
      "partition(Destination, {Sink}, Actuators)",
    ]))).toEqual([]);
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

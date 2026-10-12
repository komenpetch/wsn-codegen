import { describe, it, expect } from "vitest";
import { routeTableOf, routeTablesOf } from "../src/engine/routingTable";
import type { EncodedMachine } from "../src/engine/types";

// WHICH variable is the route table, read off the model rather than named.
//
// A route table is a relation over NODES that carries PER-ENTRY DATA: the
// extension declares `lastSeqno ∈ neighbourTbl → ℕ`, so `neighbourTbl` is the
// domain of a pair-keyed function. That is the whole discriminator, and it is
// the one that separates the table from its look-alike: `updateNbrs` has the
// identical type `ND ↔ ND` and is a QUEUE, and nothing is keyed over it.
//
// ⚠ Naming it `neighbourTbl` would have worked for exactly one project. RTMCS
// calls its own `bwdRouteTbl` and hangs `bwdNextND`/`bwdSeqNo`/`bwdHopCnt` off
// it -- the same shape under a different name, which is the case the
// derivation exists for.

const model = (types: Record<string, string>) => ({
  variableTypes: new Map(Object.entries(types)), events: [], variables: [],
} as unknown as EncodedMachine);

const ND = new Set(["ND"]);

describe("routeTableOf", () => {
  it("finds the extension's table by the metrics keyed over it", () => {
    expect(routeTableOf(model({
      neighbourTbl: "neighbourTbl ∈ ND ↔ ND",
      lastSeqno: "lastSeqno ∈ neighbourTbl → ℕ",
      missed: "missed ∈ neighbourTbl → ℕ",
      received: "received ∈ neighbourTbl → ℕ",
    }), ND)).toBe("neighbourTbl");
  });

  it("finds RTMCS's differently-named table by the same rule", () => {
    expect(routeTableOf(model({
      bwdRouteTbl: "bwdRouteTbl ∈ ND ↔ ND",
      bwdNextND: "bwdNextND ∈ bwdRouteTbl → ND",
      bwdSeqNo: "bwdSeqNo ∈ bwdRouteTbl → ℕ",
      bwdHopCnt: "bwdHopCnt ∈ bwdRouteTbl → ℕ",
    }), ND)).toBe("bwdRouteTbl");
  });

  it("does NOT mistake the pending-pair QUEUE for the table", () => {
    // `updateNbrs ∈ ND ↔ ND` is the same type and is not a table. Both are
    // present in the real model, so a rule that looked only at the type would
    // have two answers and no way to choose.
    expect(routeTableOf(model({
      updateNbrs: "updateNbrs ∈ ND ↔ ND",
      neighbourTbl: "neighbourTbl ∈ ND ↔ ND",
      lastSeqno: "lastSeqno ∈ neighbourTbl → ℕ",
    }), ND)).toBe("neighbourTbl");
  });

  it("refuses a relation over something that is not nodes", () => {
    // Per-entry data over a PACKET relation is not a routing table, whatever
    // else it is.
    expect(routeTableOf(model({
      pktLinks: "pktLinks ∈ PKT ↔ PKT",
      pktCost: "pktCost ∈ pktLinks → ℕ",
    }), ND)).toBeNull();
  });

  it("REFUSES when the model declares two tables, rather than picking one", () => {
    // RTMCS M5 declares both the forward and the backward route. INET has ONE
    // routing table, and which of them it should hold is a modelling decision
    // this pass must not make by iteration order.
    expect(routeTableOf(model({
      bwdRouteTbl: "bwdRouteTbl ∈ ND ↔ ND",
      bwdNextND: "bwdNextND ∈ bwdRouteTbl → ND",
      fwdRouteTbl: "fwdRouteTbl ∈ ND ↔ ND",
      fwdNextND: "fwdNextND ∈ fwdRouteTbl → ND",
    }), ND)).toBeNull();
  });

  it("returns null for a model with no table at all", () => {
    expect(routeTableOf(model({ ndBuff: "ndBuff ∈ ND ↔ PKT" }), ND)).toBeNull();
  });

  it("accepts a node SUBSET as a node end, the way RTMCS reaches ND", () => {
    expect(routeTableOf(model({
      tbl: "tbl ∈ Destination ↔ ND",
      hop: "hop ∈ tbl → ℕ",
    }), new Set(["ND", "Destination"]))).toBe("tbl");
  });
});

// Structure 4 (step 3d): two tables, told apart by what their entries carry. The
// route table's entries carry a NODE (the next hop); the neighbour table's carry
// counters. Exactly one of each, or a refusal.
describe("routeTablesOf", () => {
  const STRUCTURE_4 = {
    updateNbrs: "updateNbrs ∈ ND ↔ ND",
    neighbourTbl: "neighbourTbl ∈ ND ↔ ND",
    lastSeqno: "lastSeqno ∈ neighbourTbl → ℕ",
    missed: "missed ∈ neighbourTbl → ℕ",
    received: "received ∈ neighbourTbl → ℕ",
    routeTbl: "routeTbl ∈ ND ↔ ND",
    nextHop: "nextHop ∈ routeTbl → ND",
  };

  it("finds structure 4's route table by its next hop, and the neighbour table beside it", () => {
    expect(routeTablesOf(model(STRUCTURE_4), ND))
      .toEqual({ neighbours: "neighbourTbl", routes: "routeTbl", nextHop: "nextHop" });
    // routeTableOf, structure 3's, sees two candidates here and refuses: the
    // reason structure 4 has its own.
    expect(routeTableOf(model(STRUCTURE_4), ND)).toBeNull();
  });

  it("reads a next hop typed by a node SUBSET as a node", () => {
    // PairKeyedVar.value is the C++ alias, `int` for every set but ND, so the
    // value set has to come off the invariant itself.
    expect(routeTablesOf(model({ ...STRUCTURE_4, nextHop: "nextHop ∈ routeTbl → Dests" }),
      new Set(["ND", "Dests"]))?.routes).toBe("routeTbl");
  });

  it("refuses two route tables (RTMCS's forward and backward)", () => {
    expect(routeTablesOf(model({
      fwdRouteTbl: "fwdRouteTbl ∈ ND ↔ ND",
      fwdNextND: "fwdNextND ∈ fwdRouteTbl → ND",
      bwdRouteTbl: "bwdRouteTbl ∈ ND ↔ ND",
      bwdNextND: "bwdNextND ∈ bwdRouteTbl → ND",
    }), ND)).toBeNull();
  });

  it("refuses a model with no route table, or no neighbour table", () => {
    const neighboursOnly = Object.fromEntries(
      Object.entries(STRUCTURE_4).filter(([v]) => v !== "routeTbl" && v !== "nextHop"));
    expect(routeTablesOf(model(neighboursOnly), ND)).toBeNull();
    expect(routeTablesOf(model({
      routeTbl: "routeTbl ∈ ND ↔ ND", nextHop: "nextHop ∈ routeTbl → ND",
    }), ND)).toBeNull();
  });
});

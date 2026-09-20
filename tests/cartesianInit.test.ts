import { describe, it, expect } from "vitest";
import { cartesianInitLine, NODE_ROOT } from "../src/engine/nodeIdentity";
import type { CartesianInit } from "../src/engine/nodeIdentity";

// `V ≔ C × {v}` from INITIALISATION cannot run at construction time — ND is
// empty then — so it is specialised to THIS node once its id exists.
//
// ⚠ AND THE CARRIER DECIDES WHETHER A MEMBERSHIP TEST IS NEEDED. Over the ROOT
// no test is right: `ND.insert(myNodeId)` puts every node in it by construction.
// Over a PROPER SUBSET it is required, and it used to be absent — the emitter
// asked "is there an exclusion?" and never "root or proper subset?". RTMCS's
// `recvedData ≔ Destination × {∅}` and `emergencyAlert ≔ Actuators × {FALSE}`
// therefore gave EVERY node an entry, making both domains all of ND.
//
// ⚠ THE CORPUS BARELY EXERCISES THIS. Of the 19 cartesian initialisations the
// generator emits, 17 are over ND or ND ∖ {Sink} and only 2 use a proper subset
// — both in one model. So these live here as unit tests rather than resting on
// the end-to-end suite, which is why the function is exported at all.

const init = (o: Partial<CartesianInit>): CartesianInit =>
  ({ target: "v", carrier: NODE_ROOT, excluded: null, value: "", ...o });

describe("cartesianInitLine", () => {
  it("emits no test over the root — every node is in it by construction", () => {
    expect(cartesianInitLine(init({ target: "floodTbl" })))
      .toBe("        floodTbl[myNodeId];   // floodTbl ≔ ND × {…}");
  });

  it("carries the value when the model assigns one", () => {
    expect(cartesianInitLine(init({ target: "floodFlg", value: "false" })))
      .toBe("        floodFlg[myNodeId] = false;   // floodFlg ≔ ND × {…}");
  });

  it("honours an exclusion over the root, in the spelling it already used", () => {
    // Byte-for-byte the previous output: 4 sites across the corpus depend on it.
    expect(cartesianInitLine(init({ target: "cost", excluded: "Sink", value: "0" })))
      .toBe("        if (myNodeId != Sink) cost[myNodeId] = 0;   // over ND ∖ {Sink}");
  });

  it("⚠ TESTS MEMBERSHIP over a proper subset (RTMCS's recvedData)", () => {
    expect(cartesianInitLine(init({ target: "recvedData", carrier: "Destination" })))
      .toBe("        if (Destination.count(myNodeId) > 0) recvedData[myNodeId];"
          + "   // recvedData ≔ Destination × {…}");
  });

  it("⚠ TESTS MEMBERSHIP over a proper subset with a value (emergencyAlert)", () => {
    expect(cartesianInitLine(init({ target: "emergencyAlert", carrier: "Actuators", value: "false" })))
      .toBe("        if (Actuators.count(myNodeId) > 0) emergencyAlert[myNodeId] = false;"
          + "   // emergencyAlert ≔ Actuators × {…}");
  });

  it("combines both tests, and names the carrier rather than hardcoding ND", () => {
    // Not in the corpus today. The old comment spelled `over ND ∖ {…}` with ND
    // hardcoded, which would have been a lie here.
    expect(cartesianInitLine(init({ target: "v", carrier: "Destination", excluded: "Sink" })))
      .toBe("        if (Destination.count(myNodeId) > 0 && myNodeId != Sink) v[myNodeId];"
          + "   // v ≔ Destination ∖ {Sink} × {…}");
  });
});

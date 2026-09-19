import { describe, it, expect } from "vitest";
import { unreachableEvents } from "../src/engine/emitted";

// An event is dropped when a guard REQUIRES a container to be non-empty and
// nothing any method runs ever fills it. The requirement has to be read off the
// guard's POSITIVE occurrences only: a container named inside a negation is one
// the guard wants the parameter to be OUTSIDE of, which says nothing about
// whether it has members.
//
// `requiredBy` skipped a negation only when the WHOLE expression began with
// `!`, then scanned the whole expression for `X.count(..) > 0` regardless. So
// the CommPattern's own originator guard
//
//     x ∈ ND ∖ Dests   ->   (ND.count(x) > 0 && !(Dests.count(x) > 0))
//
// recorded `Dests` as required non-empty, and every creating event was dropped
// for a reason that is false. Nothing fills `Dests` — it is a context constant
// the harness populates — and the guard does not need anything to.

const cc = (guard: string) => `
// Event-B: doSomething
bool M::doSomething(Node x) {
    if (!(${guard}))
        return false;
    ND.insert(x);
    return true;
}
`;

const why = (guard: string) =>
  unreachableEvents(cc(guard), "M", ["doSomething"], new Set()).get("doSomething");

describe("unreachableEvents reads requirements from positive positions only", () => {
  it("does not require a container that appears only inside a nested negation", () => {
    // The shape that mattered: a conjunction whose second term is negated.
    expect(why("ND.count(x) > 0 && !(Dests.count(x) > 0)")).toBeUndefined();
  });

  it("still requires a container that appears positively", () => {
    // `floodTbl` is positive and nothing fills it, so the event is still dropped.
    expect(why("floodTbl.count(x) > 0")).toMatch(/floodTbl/);
  });

  it("requires the positive one even when a negated one sits beside it", () => {
    // Both present: the positive requirement must survive the stripping.
    expect(why("floodTbl.count(x) > 0 && !(Dests.count(x) > 0)")).toMatch(/floodTbl/);
    expect(why("floodTbl.count(x) > 0 && !(Dests.count(x) > 0)")).not.toMatch(/Dests/);
  });

  it("keeps honouring a whole-expression negation", () => {
    // The case the original `startsWith("!")` handled; it must not regress.
    expect(why("!(Dests.count(x) > 0)")).toBeUndefined();
  });

  it("handles a negation that is not the last term", () => {
    expect(why("!(Dests.count(x) > 0) && floodTbl.count(x) > 0")).toMatch(/floodTbl/);
  });

  it("does not let a nested negation hide a positive requirement inside it", () => {
    // `!(a && b)` is an absence claim about the conjunction; neither `a` nor
    // `b` is required, so nothing inside is a requirement. Stripping the whole
    // group is the conservative reading — under-removing leaves a dead method,
    // over-removing breaks behaviour.
    expect(why("!(floodTbl.count(x) > 0 && Dests.count(x) > 0)")).toBeUndefined();
  });
});

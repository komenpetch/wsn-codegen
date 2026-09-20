import { describe, it, expect } from "vitest";
import { parseSetExpr, memberTest } from "../src/engine/setExpr";
import type { EncodingForm } from "../src/engine/types";

// A SET WRITTEN OUT is a leaf of a set expression.
//
// The recursive translator pushes membership down to the leaves, and every leaf
// it knew was a NAME: `ran`, `dom`, an identifier, a map application. A set the
// model writes out -- `{BROADCAST}`, `{Sink}` -- had no token at all, so
// tokenize() gave up on the whole string and `x ∈ ND ∪ {BROADCAST}` came out
// UNTRANSLATED.
//
// That one gap gated RTMCS's entire transmit path: its `send_down` types the
// next hop `nxt ∈ ND ∪ {BROADCAST}`, so the event refused to fire, the medium
// binding was never wired into it (the emitter only wires a transmit that can
// fire), and the module put nothing on the air. MintRoute has the same shape
// with the other operator -- `x ∈ ND ∖ {Sink}` -- which this file's neighbour
// `setDifferenceEnum.test.ts` covers on the BINDING side while the guard itself
// stayed untranslated.
//
// Membership in a written-out set is equality against its elements. There is no
// container to look in, which is exactly why the leaf needed its own case
// rather than falling through to `.count()` against a name that is declared
// nowhere.
const enc = (m: Record<string, EncodingForm>) => (id: string) => m[id];
const scalar = (x: string, rhs: string, e: Record<string, EncodingForm> = { ND: "set" }) => {
  const parsed = parseSetExpr(rhs);
  return parsed === null ? null : memberTest({ kind: "scalar", x }, parsed, enc(e));
};

describe("a set literal is a leaf of a set expression", () => {
  it("translates the RTMCS guard that gated its transmit path", () => {
    expect(scalar("nxt", "ND ∪ {BROADCAST}"))
      .toBe("(ND.count(nxt) > 0 || nxt == BROADCAST)");
  });

  it("translates the MintRoute guard with the other operator", () => {
    // `∖ {Sink}` -- the set-difference gap, three occurrences in MintRoute M4.
    expect(scalar("x", "ND ∖{Sink}"))
      .toBe("(ND.count(x) > 0 && !(x == Sink))");
  });

  it("is a disjunction over several elements", () => {
    expect(scalar("x", "ND ∪ {A, B}"))
      .toBe("(ND.count(x) > 0 || (x == A || x == B))");
  });

  it("emits equality, never a lookup — there is no container to look in", () => {
    // The mutation this catches: reusing memberOfLeaf for a literal, which
    // would emit `{BROADCAST}.count(nxt) > 0` against nothing that exists.
    expect(scalar("nxt", "ND ∪ {BROADCAST}")).not.toContain("{BROADCAST}");
    expect(scalar("nxt", "ND ∪ {BROADCAST}")).toContain("nxt == BROADCAST");
  });

  it("normalises Event-B's MINUS SIGN in a numeric element", () => {
    // U+2212, which is what Rodin stores in `BROADCAST = −1`, is not C++.
    expect(scalar("x", "ND ∪ {−1}")).toBe("(ND.count(x) > 0 || x == -1)");
  });

  it("refuses a PAIR literal instead of inventing an equality for it", () => {
    // A pair set has no scalar equality test. `↦` is not a token, so the whole
    // expression fails to parse -- which is the outcome we want, reached
    // structurally rather than by a special case that could be forgotten.
    expect(parseSetExpr("sentDown ∪ {x ↦ pkt}")).toBeNull();
  });

  it("refuses a malformed literal rather than guessing where it ends", () => {
    expect(parseSetExpr("ND ∪ {A B}")).toBeNull();
    expect(parseSetExpr("ND ∪ {A,}")).toBeNull();
    expect(parseSetExpr("ND ∪ {}")).toBeNull();
  });

  it("refuses ran/dom of a literal — a set of scalars has no range", () => {
    expect(scalar("x", "ran({A}) ∪ ND")).toBeNull();
  });

  it("still refuses a PAIR element shape against a literal", () => {
    const e = parseSetExpr("ND ∪ {BROADCAST}")!;
    expect(memberTest({ kind: "pair", a: "x", b: "y" }, e, enc({ ND: "pair-set" }))).toBeNull();
  });

  it("leaves a bare name alone — the old leaves still work", () => {
    // Guards against a tokenizer change that broke the cases that already
    // passed. `ran(A ∪ B)` distributes; a plain union does not change shape.
    expect(scalar("p", "ndBuff ∪ WiMedium", { ndBuff: "pair-set", WiMedium: "pair-set" }))
      .toBeNull();   // a scalar is not a member of a set of pairs
    expect(scalar("p", "ran(ndBuff ∪ WiMedium)", { ndBuff: "pair-set", WiMedium: "pair-set" }))
      .toBe("(inRan(ndBuff, p) || inRan(WiMedium, p))");
  });
});

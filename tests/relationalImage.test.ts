import { describe, it, expect } from "vitest";
import { relationalImageOf } from "../src/engine/scheduler";

// A relational image has TWO spellings in the corpus and they denote the same
// set. `R[{x}]` is the direct one; `ran({x} ◁ R)` — the range of a domain
// restriction — is the identity `R[{x}] = ran({x} ◁ R)`, and it is the spelling
// the CommPattern itself uses:
//
//     des = ran({pkt} ◁ finalDestAddr)      (creatingControlPacket, uM2)
//
// The scheduler recognised only the first, so `des` was reported "no binding"
// on every model carrying the pattern's creating events, although it is fully
// DETERMINED by `pkt` — a lookup, not a search.
describe("relationalImageOf", () => {
  it("recognises the direct spelling R[{x}]", () => {
    expect(relationalImageOf("nbs = wsnLinks[{f}]", "nbs")).toEqual({ R: "wsnLinks", x: "f" });
  });

  it("recognises ran({x} ◁ R), which denotes the same set", () => {
    expect(relationalImageOf("des = ran({pkt} ◁ finalDestAddr)", "des"))
      .toEqual({ R: "finalDestAddr", x: "pkt" });
  });

  it("tolerates the whitespace Rodin actually emits", () => {
    expect(relationalImageOf("des=ran( { pkt } ◁ finalDestAddr )", "des"))
      .toEqual({ R: "finalDestAddr", x: "pkt" });
  });

  it("is anchored to the parameter being resolved", () => {
    // Belongs to `other`, so asking about `des` must not claim it.
    expect(relationalImageOf("other = ran({pkt} ◁ finalDestAddr)", "des")).toBeNull();
  });

  it("does not claim a range over something that is not a domain restriction", () => {
    // `ran(R)` is the whole range, not an image at a point — a different set,
    // and not computable from one known parameter.
    expect(relationalImageOf("des = ran(finalDestAddr)", "des")).toBeNull();
  });

  it("does not claim a domain restriction by a SET that is not a singleton", () => {
    // `ran(S ◁ R)` with S a set variable is an image over many points; the
    // emitted relImage(R, x) takes one.
    expect(relationalImageOf("des = ran(someSet ◁ finalDestAddr)", "des")).toBeNull();
  });

  it("does not mistake a range-restriction ▷ for a domain restriction ◁", () => {
    // `ran({pkt} ▷ R)` restricts the RANGE, so it is not R[{pkt}].
    expect(relationalImageOf("des = ran({pkt} ▷ finalDestAddr)", "des")).toBeNull();
  });
});

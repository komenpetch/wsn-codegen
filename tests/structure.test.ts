import { describe, it, expect } from "vitest";
import { structureProfile } from "../src/engine/structure";

// The structure profiles (structure.ts): what structure 4 adds over 3. The
// outputs themselves are frozen by scripts/check-output-unchanged.sh; this pins
// the two facts a profile edit could break without moving any of today's bytes.

describe("structure profiles", () => {
  it("leaves structure 3 as it was measured: every field off (O1)", () => {
    const p = structureProfile(3);
    expect(Object.values(p).every((v) => v === false)).toBe(true);
  });

  it("gives structure 4 every decision", () => {
    expect(structureProfile(4)).toEqual({
      nextHop: true, baselineShell: true, frameLengthInBits: true, countOnArrival: true,
    });
  });

  it("has no profile for structures 1 and 2, which carry no pattern", () => {
    for (const v of [1, 2] as const)
      expect(() => structureProfile(v)).toThrow(`structure ${v} carries no pattern`);
  });
});

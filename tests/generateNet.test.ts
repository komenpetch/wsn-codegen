import { describe, it, expect } from "vitest";
import { generateNet } from "../scripts/generate-net";

describe("generateNet for MintRoute M4", () => {
  const tree = generateNet("MintRoute", "M4");
  const byExt = (e: string) => tree.find((f) => f.path.endsWith(e))!.content;

  it("emits exactly three files", () => {
    expect(tree.map((f) => f.path.split(".").pop()).sort()).toEqual(["cc", "h", "ned"]);
  });

  it("declares ROUTE and BEACON", () => {
    const h = byExt(".h");
    expect(h).toContain("ROUTE");
    expect(h).toContain("BEACON");
    expect(h).toContain("class BeaconPkt : public PPkt");
    expect(h).toContain("class RoutePkt : public PPkt");
  });

  it("translates more of MintRoute than the app-layer catalog alone", () => {
    const all = tree.map((f) => f.content).join("\n");
    const after = (all.match(/UNTRANSLATED/g) ?? []).length;
    expect(after).toBeLessThan(153);   // M4 baseline, findings/2026-09-06-gap-baseline.md
  });

  it("keeps the flooding events translatable", () => {
    const cc = byExt(".cc");
    for (const ev of ["start_flooding", "reset_flooding"])
      expect(cc).toContain(ev);
  });
});

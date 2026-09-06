import { describe, it, expect } from "vitest";
import { composeRules } from "../engine/compose";
import { RULES } from "../../wsn-codegen/src/engine/rules";
import type { NetRule } from "../engine/packetRules";

const stub = (id: string, extra: Partial<NetRule> = {}): NetRule => ({
  id, tier: 1, evidence: ["MintRoute.create_bconPkt"],
  match: (e) => (e === "SENTINEL" ? { captures: {} } : null),
  emit: () => "sentinel;",
  ...extra,
} as NetRule);

describe("composeRules", () => {
  it("puts network rules ahead of the app-layer catalog", () => {
    const out = composeRules([stub("NET1")]);
    expect(out[0].id).toBe("NET1");
    expect(out.length).toBe(RULES.length + 1);
  });

  it("replaces a superseded rule in place rather than duplicating it", () => {
    const out = composeRules([stub("NET-CMP2", { supersedes: "CMP2" })]);
    expect(out.filter((r) => r.id === "CMP2")).toHaveLength(0);
    expect(out.filter((r) => r.id === "NET-CMP2")).toHaveLength(1);
    expect(out.length).toBe(RULES.length);
  });

  it("refuses to supersede a rule that does not exist", () => {
    expect(() => composeRules([stub("NET-X", { supersedes: "NOSUCH" })]))
      .toThrow(/NOSUCH/);
  });

  it("refuses a rule with no evidence", () => {
    expect(() => composeRules([stub("NET2", { evidence: [] })])).toThrow(/evidence/);
  });
});

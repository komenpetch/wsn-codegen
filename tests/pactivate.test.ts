import { describe, it, expect } from "vitest";
import { loadProject } from "../scripts/projects";
import { generate, generateMerged, MODULE_NAME } from "../src/engine/pipeline";
import { RULES } from "../src/engine/rules";
import type { EncodingForm } from "../src/engine/types";

// PActivate, the actuation pattern (user, 2026-11-17: "can we add PActivate since
// it also one of interface but at first we not translate because we don't have the
// source yet"). Its source is the pattern project's own `activate` event in pM3
// (labels MPActivate_activate_*); no interface machine was ever shipped for it,
// which is why the 38-rule catalog, induced from the interface machines, had no
// rule for its two clauses:
//
//   MPActivate_activate_int_1  emergencyAlert ≔ ND × {FALSE}
//   MPActivate_activate_g3     data ≥ safetyThreshold
//
// RTMCS M2's `actuating` / `no_actuating` use the same guard shape
// (`data ≥ safetyThreshold`, `data < safetyThreshold`) and RTMCS's C2 declares the
// constant (`safetyThreshold ∈ ℤ`, `safetyThreshold = 1001`). The pattern project
// uses the constant and declares it nowhere, so the tool bundles its declaration
// (src/assets/pattern-extension/CActivate.buc, type only).
//
// Decisions (user, 2026-11-17): the rules apply to every structure; the bundled
// context is read by every structure; structures 1-2 carry the value as a fixed
// constant (1001, RTMCS's), so V2's `initialize` stays statement-identical to
// SensorApp's; structures 3-4 read it from a NED parameter with that default;
// CMP2's `D × {c}` form is translated in structures 1-2 (where the constructor
// loop runs before ND is filled, as CMP2 already does for ctlSensedFlg), and in
// structures 3-4 and the network modules the node-identity binding keeps
// realising node-keyed products per node.

const E = (m: Record<string, EncodingForm>) => (id: string) => m[id];
function emit(expr: string, enc: (id: string) => EncodingForm | undefined): string | null {
  for (const r of RULES) { const h = r.match(expr); if (h) return r.emit(h, enc); }
  return null;
}
const enc = E({ emergencyAlert: "function", ctlSensedFlg: "function", recvedData: "map-of-sets" });
const byPath = (tree: { path: string; content: string }[]) =>
  Object.fromEntries(tree.map((f) => [f.path.replace(/^.*[\\/]/, ""), f.content]));
const method = (cc: string, name: string) => {
  const m = new RegExp(`^bool ${MODULE_NAME}::${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, "m").exec(cc);
  if (!m) throw new Error(`no method ${name}`);
  return m[0];
};
const markers = (text: string) => (text.match(/\/\/ UNTRANSLATED/g) ?? []).length;

describe("CMP3: a scalar compared with a declared name", () => {
  it("translates the four orderings", () => {
    expect(emit("data ≥ safetyThreshold", enc)).toBe("data >= safetyThreshold");
    expect(emit("data < safetyThreshold", enc)).toBe("data < safetyThreshold");
    expect(emit("data ≤ safetyThreshold", enc)).toBe("data <= safetyThreshold");
    expect(emit("data > safetyThreshold", enc)).toBe("data > safetyThreshold");
  });
  it("tolerates Rodin's irregular spacing", () => {
    expect(emit("data≥safetyThreshold", enc)).toBe("data >= safetyThreshold");
  });
  it("does not claim a function application or an expression", () => {
    expect(emit("f(x) ≥ 0", enc)).toBeNull();
    expect(emit("x ≥ y + 1", enc)).toBeNull();
  });
});

describe("CMP2 also covers the plain product D × {c}", () => {
  it("fills every element of D", () => {
    expect(emit("emergencyAlert ≔ ND × {FALSE}", enc))
      .toBe("for (int _n : ND) emergencyAlert[_n] = FALSE;");
    expect(emit("emergencyAlert ≔  Actuators × {FALSE}", enc))
      .toBe("for (int _n : Actuators) emergencyAlert[_n] = FALSE;");
    expect(emit("recvedData ≔ Destination × {∅}", enc))
      .toBe("for (int _n : Destination) recvedData[_n] = {};");
  });
  it("leaves the set-difference form exactly as it was", () => {
    expect(emit("ctlSensedFlg ≔ (ND ∖ Dests) × {FALSE}", enc))
      .toBe("for (int _n : ND) if (Dests.count(_n) == 0) ctlSensedFlg[_n] = FALSE;");
  });
});

describe("PActivate in the pattern project, every structure", () => {
  for (const v of [1, 2] as const) {
    it(`structure ${v}: both clauses translate, safetyThreshold is the fixed 1001`, () => {
      const out = byPath(generateMerged(loadProject("AppLayer"), MODULE_NAME, v));
      const all = Object.values(out).join("\n");
      expect(markers(all)).toBe(0);
      expect(method(out["EbWsn.cc"], "activate")).toContain("data >= safetyThreshold");
      expect(out["EbWsn.cc"]).toContain("for (int _n : ND) emergencyAlert[_n] = FALSE;");
      expect(out["EbWsn.h"]).toMatch(/inline (const )?int safetyThreshold = 1001;/);
      // no NED parameter, so `initialize` is untouched (V2's shell match)
      expect(out["EbWsn.ned"]).not.toContain("safetyThreshold");
      expect(out["EbWsn.cc"]).not.toContain('par("safetyThreshold")');
    });
  }
  for (const routing of ["flooding", "aodv", "dsr"] as const) {
    it(`structure 4 (${routing}): the guard translates, the value is a NED parameter`, () => {
      const out = byPath(generateMerged(loadProject("AppLayer"), MODULE_NAME, 4, undefined, true, routing));
      expect(markers(Object.values(out).join("\n"))).toBe(0);
      expect(method(out["EbWsn.cc"], "activate")).toContain("data >= safetyThreshold");
      // the NED declares it on the simple module, not on the wrapper
      const ned = out["EbWsn.ned"];
      const simple = ned.indexOf(`simple ${MODULE_NAME}`);
      const wrapper = ned.indexOf(`module ${MODULE_NAME}NetworkLayer`);
      const at = ned.indexOf("int safetyThreshold = default(1001);");
      expect(at).toBeGreaterThan(simple);
      expect(wrapper < 0 || at < wrapper).toBe(true);
      expect(out["EbWsn.cc"]).toContain('safetyThreshold = par("safetyThreshold").intValue();');
      // node-keyed products stay with the identity binding, per node
      expect(out["EbWsn.cc"]).not.toContain("for (int _n : ND) emergencyAlert[_n]");
      expect(out["EbWsn.cc"]).toMatch(/realised per node at INITSTAGE_LAST \(node identity binding\): emergencyAlert ≔ ND × \{FALSE\}/);
    });
  }
});

describe("the bundled declaration is added only where it is needed", () => {
  it("RTMCS declares safetyThreshold itself: its own fixed value, no NED parameter", () => {
    const out = byPath(generate(loadProject("RTMCS"), "M6", MODULE_NAME, 2));
    expect(out["EbWsn.h"]).toContain("inline const int safetyThreshold = 1001;  // C2 axm2_5");
    expect(out["EbWsn.ned"]).not.toContain("safetyThreshold");
    expect(method(out["EbWsn.cc"], "actuating")).toContain("data >= safetyThreshold");
    expect(method(out["EbWsn.cc"], "no_actuating")).toContain("data < safetyThreshold");
  });
  it("MintRoute does not use it: nothing is added", () => {
    const out = byPath(generate(loadProject("MintRoute"), "M4", MODULE_NAME, 2));
    expect(Object.values(out).join("\n")).not.toContain("safetyThreshold");
  });
});

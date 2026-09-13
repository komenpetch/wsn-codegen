import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The order the net rule sets are handed to composeRules is BEHAVIOUR.
//
// `SETEXPR-PAIR-MEM` matches `a ↦ b ∈ dom(F)` for any pair-shaped F and
// deliberately refuses the shapes it cannot answer — the intercept-and-refuse
// technique several rules rely on. A pair-keyed function is one of those
// shapes, so whichever set is offered FIRST wins the clause, and only
// pairKeyedRules can actually translate it. Measured: moving pairKeyedRules to
// the end takes MintRoute M4 from 34 to 45 untranslated and stops nine guards
// translating.
//
// ⚠ WHY THIS TEST EXISTS SEPARATELY FROM THE ONE THAT MEASURES THAT.
// The measuring test lives in generateNet.test.ts, which reads the advisor's
// Event-B models off disk — and those are deliberately not in this repo, so
// vite.config.ts drops that whole suite on a clean checkout. CI therefore never
// ran the guard on the constraint most likely to be broken by a refactor.
//
// This one reads the SOURCE, needs no model, and so runs everywhere. It is the
// weaker of the two — it pins the call, not the consequence — which is why both
// exist: this one fails in CI, the other explains why when you have the models.
describe("the net rule order in netPipeline.ts", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/engine/netPipeline.ts"), "utf8");

  const composeCall = (): string => {
    const at = source.indexOf("composeRules([");
    expect(at, "netPipeline.ts no longer calls composeRules([...]) — this guard "
      + "is pinned to a call site that has moved").toBeGreaterThan(-1);
    return source.slice(at, source.indexOf("]);", at));
  };

  it("offers pairKeyedRules before every other rule set", () => {
    const call = composeCall();
    const sets = [...call.matchAll(/\.\.\.(\w+)\(/g)].map((m) => m[1]);
    expect(sets.length).toBeGreaterThan(1);
    expect(sets[0]).toBe("pairKeyedRules");
  });

  it("still offers the sets whose order was measured", () => {
    // If one of these disappears the guard above could pass vacuously — a rule
    // set that is no longer composed cannot be out of order.
    const sets = [...composeCall().matchAll(/\.\.\.(\w+)\(/g)].map((m) => m[1]);
    for (const required of ["pairKeyedRules", "packetRules", "nestedMapRules"])
      expect(sets).toContain(required);
  });
});

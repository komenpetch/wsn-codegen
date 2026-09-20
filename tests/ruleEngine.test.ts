import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseModel } from "../src/engine/parser";
import { flatten } from "../src/engine/flattener";
import { resolveEncodings } from "../src/engine/encodingResolver";
import { translateEvent, isTypingPredicate } from "../src/engine/ruleEngine";

const load = (n: string) =>
  ({ name: `${n}.bum`, xml: readFileSync(`tests/fixtures/shdecom/${n}.bum`, "utf8") });

describe("translateEvent", () => {
  const enc = resolveEncodings(flatten(parseModel([load("pM1")]), "pM1"));
  const evOf = (label: string) => enc.events.find((e) => e.label === label)!;

  it("drops typing guards and translates state guards (start_tx)", () => {
    const t = translateEvent(evOf("start_tx"), enc);
    expect(t.guards).toContain("sentDown.count({x, pkt}) == 0");
    expect(t.guards).toContain("pktFwdr.count(pkt) > 0");
    expect(t.guards.some((g) => g.includes("∈ ND"))).toBe(false);   // typing dropped
  });

  it("emits ordered action statements (send_up)", () => {
    const t = translateEvent(evOf("send_up"), enc);
    expect(t.actions).toEqual([
      "for (auto _v : nbrs) ctlNeighbours[pkt].insert(_v);",
      "sentDown.erase({x, pkt});",
      "sentUp.insert({x, pkt});",
    ]);
  });

  it("keeps membership in a set-typed PARAMETER as a semantic guard (not typing)", () => {
    // RTMCS/MintRoute assign_forwarder: `nb ∈ nbs` with nbs an event parameter.
    const t = translateEvent(
      { label: "assign_forwarder", parameters: ["nb", "nbs"],
        guards: ["nb ∈ ND", "nb ∈ nbs"], actions: [] },
      enc,
    );
    expect(t.guards).toEqual(["nbs.count(nb) > 0"]);   // nb ∈ ND dropped (typing), nb ∈ nbs kept
    expect(t.untranslatedGuards).toEqual([]);
  });

  it("reports unmatched clauses as untranslated instead of dropping them", () => {
    const t = translateEvent(
      { label: "synthetic", parameters: ["x"],
        guards: ["sentUp ∩ sentDown = ∅"],           // no ∩ rule exists
        actions: ["sentUp ≔ sentUp ∪ sentDown"] },   // no whole-set-union rule
      enc,
    );
    expect(t.guards).toEqual([]);
    expect(t.untranslatedGuards).toEqual(["sentUp ∩ sentDown = ∅"]);
    expect(t.untranslatedActions).toEqual(["sentUp ≔ sentUp ∪ sentDown"]);
  });

  it("recognizes ℤ/𝔹/BOOL typing predicates (built-in carriers outside \\w)", () => {
    const none = new Set<string>();
    expect(isTypingPredicate("data ∈ ℤ", none)).toBe(true);
    expect(isTypingPredicate("sf ∈BOOL", none)).toBe(true);
    expect(isTypingPredicate("cnt ∈ ℕ", none)).toBe(true);
    expect(isTypingPredicate("x ∈ ND ∖Dests", none)).toBe(false);   // CMP1, kept
  });

  // ⚠ A DROPPED GUARD IS SILENT -- it never reaches `// UNTRANSLATED`, so the
  // event looks fully translated and fires in states the model forbids. This is
  // the shape that bit: `dest_recv_pkt` guards `nb ∈ Dests`, `Dests` is a
  // context name, so the clause counted as a TYPE and vanished. Measured with
  // `Dests` EMPTY -- where the guard is unsatisfiable -- the event still fired.
  describe("a context name declared as a SUBSET is not a type", () => {
    const ctx = new Set(["Dests", "ND", "WSN", "PKT"]);        // all context names
    const subsets = new Set(["Dests"]);                        // `Dests ⊆ ND`

    it("keeps `nb ∈ Dests`, because `Dests ⊆ ND` makes it a restriction", () => {
      expect(isTypingPredicate("nb ∈ Dests", ctx, subsets)).toBe(false);
    });

    it("still drops `l ∈ WSN`, because `WSN = ND ↔ ND` DEFINES a type", () => {
      expect(isTypingPredicate("l ∈ WSN", ctx, subsets)).toBe(true);
    });

    it("still drops the builtins, which have no rule and would refuse the event", () => {
      // Widening this to "anything that is not a carrier set" would restore
      // `p ∈ ℤ` / `p ∈ ℕ`, which no rule matches -- so create_rreq,
      // add_bwdRouteEntry and start_tx_rrep would become UNTRANSLATED and
      // REFUSE TO FIRE. Checked against the catalog before the change.
      expect(isTypingPredicate("data ∈ ℤ", ctx, subsets)).toBe(true);
      expect(isTypingPredicate("lsno ∈ ℕ", ctx, subsets)).toBe(true);
    });

    it("still drops `pkt ∈ PKT`, a genuine carrier set", () => {
      expect(isTypingPredicate("pkt ∈ PKT", ctx, subsets)).toBe(true);
    });

    it("leaves ⊆ alone: that is how a SET-valued parameter is typed", () => {
      // `nbs ⊆ ND` in find_neighbours declares nbs as a set of nodes. There is
      // no ⊆ rule, so restoring it would only make that event refuse.
      expect(isTypingPredicate("nbs ⊆ ND", ctx, subsets)).toBe(true);
      expect(isTypingPredicate("s ⊆ Dests", ctx, subsets)).toBe(true);
    });

    it("is inert when the caller passes no subsets, so old callers are unchanged", () => {
      expect(isTypingPredicate("nb ∈ Dests", ctx)).toBe(true);
    });
  });

  it("flags an action-less event as a predicate (send_down)", () => {
    const t = translateEvent(evOf("send_down"), enc);
    expect(t.actions.length).toBe(0);
    expect(t.guards).toContain("sentDown.count({x, pkt}) > 0");
  });
});

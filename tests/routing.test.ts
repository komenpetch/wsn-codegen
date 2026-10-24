import { describe, it, expect } from "vitest";
import { ROUTINGS, routingProfile, checkRoutingStructure } from "../src/engine/routing";
import { TAG_NAMES, DSR_NAMES } from "../src/engine/baselineShell";

// The routing profiles (routing.ts): what a routing value selects, in one
// place. Synthetic, so it runs on a clean checkout; the outputs each routing
// produces are frozen by scripts/check-output-unchanged.sh.

describe("routing profiles", () => {
  it("lists the three routings the CLI accepts, in its order", () => {
    expect(ROUTINGS).toEqual(["flooding", "aodv", "dsr"]);
  });

  it("bundles each routing's own split, every one a partition of CONTROL", () => {
    expect(ROUTINGS.map((r) => routingProfile(r).split.file))
      .toEqual(["C2_ctl.buc", "C2_aodv.buc", "C2_dsr.buc"]);
    for (const r of ROUTINGS) {
      const s = routingProfile(r).split;
      expect(s.splits).toBe("CONTROL");
      expect(s.ctx).toBe(s.file.replace(".buc", ""));
    }
  });

  it("gives DSR its own names and flooding and AODV the names keyed by tag", () => {
    expect(routingProfile("flooding").names).toBe(TAG_NAMES);
    expect(routingProfile("aodv").names).toBe(TAG_NAMES);
    expect(routingProfile("dsr").names).toBe(DSR_NAMES);
    // DSR takes none of INET AODV's event names: create_rreqPkt stays.
    expect(DSR_NAMES.events.map((t) => t.who)).toEqual(["MintRoute"]);
  });

  it("refuses a name that is not a routing, including an inherited key", () => {
    for (const bad of ["dymo", "toString", ""])
      expect(() => routingProfile(bad)).toThrow(`The routing "${bad}" is not one of flooding, aodv, dsr.`);
  });
});

describe("which structures a routing applies to", () => {
  it("allows flooding and aodv on structures 3 and 4, dsr on 4 only", () => {
    for (const r of ["flooding", "aodv"])
      for (const v of [3, 4] as const) expect(() => checkRoutingStructure(r, v)).not.toThrow();
    expect(() => checkRoutingStructure("dsr", 4)).not.toThrow();
  });

  it("refuses the rest, saying why", () => {
    expect(() => checkRoutingStructure("dsr", 3))
      .toThrow("The dsr routing applies to structure 4 only (its baseline shell carries DSR's names); this is structure 3.");
    expect(() => checkRoutingStructure("aodv", 2))
      .toThrow("The aodv routing applies to structure 3 or 4 only (only those carry the pattern extension); this is structure 2.");
  });
});

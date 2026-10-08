import { describe, it, expect } from "vitest";
import { loadProject } from "../scripts/projects";
import { generateMerged } from "../src/engine/pipeline";

// Structure 4 = structure 3 plus the next-hop design (design/NextHop_Extension_Draft.md,
// user 2026-10-09: "name it v4"). Structures 1-3 stay frozen; everything the
// draft scoped to "structure 3 only" (O1) applies to structure 4 only.
//
// This file starts at the SCAFFOLD: before any next-hop change lands, structure 4
// must take exactly structure 3's path, so every later change is measured against
// a v4 that is known to equal v3. As each change lands, the byte-identity below is
// replaced by what that change is meant to add.
const files = () => loadProject("AppLayer");
const asMap = (tree: { path: string; content: string }[]) =>
  Object.fromEntries(tree.map((f) => [f.path, f.content]));

describe("structure 4 (scaffold)", () => {
  it("generates the same three files as structure 3", () => {
    const v3 = asMap(generateMerged(files(), undefined, 3));
    const v4 = asMap(generateMerged(files(), undefined, 4));
    expect(Object.keys(v4).sort()).toEqual(["EbWsn.cc", "EbWsn.h", "EbWsn.ned"]);
    expect(v4).toEqual(v3);
  });

  it("takes a routing, as structure 3 does", () => {
    const v3 = asMap(generateMerged(files(), undefined, 3, undefined, true, "aodv"));
    const v4 = asMap(generateMerged(files(), undefined, 4, undefined, true, "aodv"));
    expect(v4).toEqual(v3);
  });

  it("still refuses a routing outside the structures that carry the pattern", () => {
    expect(() => generateMerged(files(), undefined, 2, undefined, true, "aodv"))
      .toThrow(/structure 3 or 4/);
  });
});

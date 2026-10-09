import { describe, it, expect } from "vitest";
import { loadProject } from "../scripts/projects";
import { generateMerged } from "../src/engine/pipeline";

// Structure 4 = structure 3 plus the next-hop design (design/NextHop_Extension_Draft.md,
// user 2026-10-09: "name it v4"). Structures 1-3 stay frozen; everything the
// draft scoped to "structure 3 only" (O1) applies to structure 4 only.
//
// Each step of that design is pinned here as the EXACT difference it makes to
// structure 3's module, so a step that moves anything else fails. The scaffold
// started this file at "v4 == v3".
//
// Step 3a (D9, §6 item 9): the bundle drops the generic start_tx/receive where
// they are split, which the generated C++ never shows (supersession already
// retired them), and derives the two data receptions. So the module gains
// exactly receive_dataPkt and receive_dup_dataPkt: two declarations, two
// methods, and two "not scheduled" lines, since nothing creates a DATA packet
// until §6 items 5, 12 and 13 land.
const files = () => loadProject("AppLayer");
const byPath = (tree: { path: string; content: string }[]) =>
  Object.fromEntries(tree.map((f) => [f.path, f.content]));

const DATA_RECEPTIONS = ["receive_dataPkt", "receive_dup_dataPkt"];

// Structure 4's module with the data receptions taken back out: every line
// naming one goes from the header, and each method body goes from the source.
// A method ends at the first `}` in column 0, the emitter's own layout.
const withoutDataReceptions = (v4: Record<string, string>) => {
  let cc = v4["EbWsn.cc"];
  for (const m of DATA_RECEPTIONS) {
    const body = new RegExp(`bool EbWsn::${m}\\([^\\n]*\\) \\{\\n[^]*?\\n\\}\\n\\n`);
    expect(cc).toMatch(body);           // each is there to take out
    cc = cc.replace(body, "");
  }
  const h = v4["EbWsn.h"].split("\n")
    .filter((l) => !DATA_RECEPTIONS.some((m) => new RegExp(`\\b${m}\\b`).test(l))).join("\n");
  return { "EbWsn.cc": cc, "EbWsn.h": h, "EbWsn.ned": v4["EbWsn.ned"] };
};

describe("structure 4", () => {
  for (const routing of [undefined, "aodv"] as const) {
    describe(`routing: ${routing ?? "default (flooding)"}`, () => {
      const v3 = byPath(generateMerged(files(), undefined, 3, undefined, true, routing));
      const v4 = byPath(generateMerged(files(), undefined, 4, undefined, true, routing));

      it("generates the same three files as structure 3", () => {
        expect(Object.keys(v4).sort()).toEqual(["EbWsn.cc", "EbWsn.h", "EbWsn.ned"]);
      });

      it("is structure 3 plus the two data receptions, and nothing else", () => {
        expect(withoutDataReceptions(v4)).toEqual(v3);
      });

      it("emits both receptions, reported as not scheduled until DATA exists", () => {
        for (const m of DATA_RECEPTIONS) {
          expect(v4["EbWsn.cc"]).toMatch(new RegExp(`bool EbWsn::${m}\\(`));
          expect(v4["EbWsn.h"]).toContain(
            `// not scheduled: ${m} -- nothing that runs ever creates a DATA packet`);
          expect(v3["EbWsn.cc"]).not.toContain(`EbWsn::${m}(`);
        }
        // Both translate fully; structure 3's one untranslated clause is still the only one.
        const untranslated = (t: Record<string, string>) =>
          (Object.values(t).join("\n").match(/UNTRANSLATED/g) ?? []).length;
        expect(untranslated(v4)).toBe(untranslated(v3));
      });
    });
  }

  it("still refuses a routing outside the structures that carry the pattern", () => {
    expect(() => generateMerged(files(), undefined, 2, undefined, true, "aodv"))
      .toThrow(/structure 3 or 4/);
  });
});

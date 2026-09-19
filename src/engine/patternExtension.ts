// `import type` on purpose: pipeline imports THIS module, so a value import
// would close a runtime cycle and `parsedMachines is not a function` at load.
// A type-only import is erased.
import type { EbFiles } from "./pipeline";
import { parseModel } from "./parser";
import C2_ctl from "../assets/pattern-extension/C2_ctl.buc?raw";
import uM4 from "../assets/pattern-extension/uM4.bum?raw";
import pM5 from "../assets/pattern-extension/pM5.bum?raw";

// The pattern extension — PPkt and PRouteTable — SHIPPED INSIDE THE TOOL.
//
// Structure 3 is V2's shell carrying these two, and the whole point is that the
// user uploads ONE project: the pattern is the generator's, the way the rule
// catalog is. Before this, the extension was an INPUT handed in through
// `--ppkt-from`, so the tool knew nothing about the pattern it is meant to
// embody and the user had to supply the second project themselves.
//
// The three files are real Rodin sources rather than strings embedded here, so
// they open in Rodin for proof and review, and there is one copy of each.
//
//   C2_ctl.buc   Tier A context — partition(CONTROL, {ROUTE}, {BEACON})
//   uM4.bum      Tier A — per-leaf creating events + the per-packet sequence number
//   pM5.bum      Tier B — the neighbour table and its pair-keyed metrics
//
// ⚠ They EXTEND the uploaded chain rather than standing beside it: `uM4 refines
// <the project's leaf>` and `pM5 refines uM4`. That is why only the three new
// files are bundled — bundling a copy of the base chain as well would make the
// tool carry a second, drifting copy of the user's own model.
export const PATTERN_EXTENSION_LEAF = "pM5";

// The machine `uM4` is authored against the app-layer pattern's own leaf name.
const AUTHORED_AGAINST = "pM3";

// What the extension's events actually read and write in the base. Derived by
// reading uM4/pM5: the creating events rebuild the abstract event's actions
// (createdPkts, pktFwdr, pktData, ndBuff) and `update_nbr` reads `pktFwdr` and
// `sentUp`. A project without these is not built on the CommPattern, so the
// extension cannot refine it and says so rather than emitting events that read
// variables which do not exist.
const REQUIRED_BASE_STATE = ["createdPkts", "pktFwdr", "pktData", "ndBuff", "sentUp"] as const;

const BUNDLED = [
  { name: "C2_ctl.buc", xml: C2_ctl },
  { name: "uM4.bum", xml: uM4 },
  { name: "pM5.bum", xml: pM5 },
];

/**
 * The uploaded project, extended by the bundled pattern.
 *
 * Returns the shape the emitter already consumes for structure 3, so the
 * carrying machinery is unchanged — what changed is only where the second
 * model comes from. The base of the pair stays the uploaded project alone;
 * this is that same project plus the extension, which is what makes the new
 * events (create_routePkt, create_bconPkt, add_newEntry, update_nbr) the
 * difference between the two.
 */
export function patternExtensionFor(files: EbFiles, base: string): { files: EbFiles; machine: string } {
  const raw = parseModel(files);

  const declared = new Set(raw.machines.flatMap((m) => m.variables));
  const missing = REQUIRED_BASE_STATE.filter((v) => !declared.has(v));
  if (missing.length > 0)
    throw new Error(
      `The pattern extension (PPkt + PRouteTable) refines the CommPattern, and this project does `
      + `not declare ${missing.join(", ")}. Structure 3 carries that extension, so it only applies `
      + `to a project built on the pattern; use structure 2 for a model that is not.`);

  // Retarget onto the machine being generated from. `uM4` is authored against
  // the pattern's own `pM3`, and a project whose machine has another name would
  // leave that refinement dangling.
  const retarget = (f: { name: string; xml: string }) =>
    f.name === "uM4.bum" && base !== AUTHORED_AGAINST
      ? { ...f, xml: f.xml.replace(
          `<org.eventb.core.refinesMachine name="ref1" org.eventb.core.target="${AUTHORED_AGAINST}"/>`,
          `<org.eventb.core.refinesMachine name="ref1" org.eventb.core.target="${base}"/>`) }
      : f;

  // A new array: the caller's list is theirs.
  return { files: [...files, ...BUNDLED.map(retarget)], machine: PATTERN_EXTENSION_LEAF };
}

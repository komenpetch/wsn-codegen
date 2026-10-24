import type { EmitVersion } from "./codeEmitter";
import { TAG_NAMES, DSR_NAMES, type BaselineNames } from "./baselineShell";
import C2ctl from "../assets/pattern-extension/C2_ctl.buc?raw";
import C2aodv from "../assets/pattern-extension/C2_aodv.buc?raw";
import C2dsr from "../assets/pattern-extension/C2_dsr.buc?raw";

// What a routing value (`--routing`, the API's `routing`) selects, in one place.
// Before this the choice was read in three files: patternExtension picked the
// bundled split, pipeline refused `dsr` outside structure 4, and baselineShell
// compared the value twice to pick its names. Adding a routing now means adding
// one entry to ROUTINGS.
//
// ⚠ What a profile does NOT hold, on purpose:
// - which routing a project's SHAPE reads as (routingStyleOf, patternExtension):
//   that is a guess made when no routing is given, not a property of a routing;
// - MintRoute's counters, hooks and first fires (MINTROUTE_LEAVES): keyed by
//   leaf tag, they apply wherever ROUTE or BEACON appear, whatever chose them;
// - anything per case-study test code (MintRoute's parent choice, the AODV and
//   DSR route discovery): that is pasted into the output, never generated.

export interface BundledSplit {
  /** The bundled context file, and its name as a context. */
  file: string; ctx: string;
  xml: string;
  /** The control set it partitions, read off the file. */
  splits: string;
}

// WHICH set each bundled split partitions, read off the bundled file rather than
// written here twice. It is `CONTROL` in all three, and that MATTERS: a split may
// only be applied to a project whose own control set is that same set. A project
// whose control set is named otherwise — the advisor's flooding case study
// calls it FLOOD — would otherwise receive a partition of a set it never
// declares, and a project with no control set at all would receive one of a
// set that does not exist.
function bundledSplit(file: string, xml: string): BundledSplit {
  const m = /partition\(\s*(\w+)\s*,/.exec(xml);
  if (!m)
    throw new Error(`routing: the bundled ${file} declares no partition, so there is `
      + "no way to tell which control set it splits.");
  return { file, ctx: file.replace(/\.buc$/, ""), xml, splits: m[1] };
}

export interface RoutingProfile {
  /** The control split the pattern extension bundles for it. */
  split: BundledSplit;
  /** The structures it may be generated as, and why if not every pattern one. */
  structures: readonly EmitVersion[];
  why?: string;
  /** The names structure 4's baseline shell gives the methods (D16). */
  names: BaselineNames;
}

// flooding and aodv share TAG_NAMES: their name tables are keyed by leaf tag and
// the two splits share no tag, so each module takes only its own leaves' names
// (see baselineShell). dsr has the same leaf tags as aodv and its own baseline,
// which is why it needs a table of its own.
const PROFILES = {
  // MintRoute C3's ROUTE/BEACON. The default for a project that names no sink.
  flooding: { split: bundledSplit("C2_ctl.buc", C2ctl), structures: [3, 4], names: TAG_NAMES },
  // RTMCS C4's RREQ/RREP/RRER.
  aodv: { split: bundledSplit("C2_aodv.buc", C2aodv), structures: [3, 4], names: TAG_NAMES },
  // The same partition under DSR's own context (the v4 DSR plan B1), and the
  // Final Report's names; structure 3 has no baseline shell to carry them, and
  // there `dsr` would be `aodv` under another context name.
  dsr: {
    split: bundledSplit("C2_dsr.buc", C2dsr), structures: [4],
    why: "its baseline shell carries DSR's names", names: DSR_NAMES,
  },
} as const satisfies Record<string, RoutingProfile>;

/** Which routing a structure-3 or -4 module is generated for. */
export type RoutingStyle = keyof typeof PROFILES;

/** Every routing, in the order the tool lists them. */
export const ROUTINGS = Object.keys(PROFILES) as readonly RoutingStyle[];

/**
 * The profile of a routing. Refuses a name that is not one: the type rules it
 * out, but an untyped caller (plain JS, or a cast) used to reach a lookup and
 * crash on `undefined`. An own key, not `in`: `"toString" in PROFILES` is true.
 */
export function routingProfile(routing: string): RoutingProfile {
  if (!Object.hasOwn(PROFILES, routing))
    throw new Error(`The routing "${routing}" is not one of ${ROUTINGS.join(", ")}.`);
  return PROFILES[routing as RoutingStyle];
}

/**
 * Refuses a routing the structure cannot carry. A routing is a choice between
 * the bundled pattern's splits, which only structures 3 and 4 carry; a profile
 * may narrow that further (dsr: structure 4 only).
 */
export function checkRoutingStructure(routing: string, version: EmitVersion): void {
  const p = routingProfile(routing);
  if (p.structures.includes(version)) return;
  const allowed = p.structures.join(" or ");
  throw new Error(`The ${routing} routing applies to structure ${allowed} only (`
    + `${p.why ?? "only those carry the pattern extension"}); this is structure ${version}.`);
}

import { carriesPattern, type EmitVersion } from "./codeEmitter";

// What makes structure 4 differ from structure 3, in one place. Before this the
// pipeline asked `version === 4` at five points and passed three of the answers
// into shared passes as bare booleans, so what structure 4 IS could only be
// read off 400 lines of emitBody.
//
// ⚠ Structure 3's profile is every field false, and that is O1 written as data:
// every next-hop change and every later fix applies to structure 4 only, so the
// structure-3 module and its recorded runs stay as they were measured.
//
// ⚠ What a profile does NOT hold, on purpose:
// - structures 1 and 2: they carry no pattern; their differences (parity, the
//   namespace, the network-layer branch, the CLI's fixture headers) live in
//   codeEmitter and the CLI and are the frozen compare-table outputs;
// - the routing (routing.ts): a routing chooses a split and names; a structure
//   chooses which passes run;
// - any new choice. The fields are a record of decisions already made and
//   measured as the two profiles below, not switches: no other combination has
//   ever been generated, and none can be asked for.

export interface StructureProfile {
  /**
   * The next-hop design: the bundle with uM6 and the generic events removed
   * where they are split (D9, steps 3a/3b), the route-table operation `addEntry`
   * carried in (D2, step 3e), route entries published to INET beside the
   * one-hop routes (D5, step 3d), the data send unicast by its next hop, and the
   * Route Table column's own classes, PRouteTable and RouteTableBase (step 3e).
   */
  nextHop: boolean;
  /**
   * The shell matched to the case study's baseline: one timer per packet type,
   * the baseline's counters, receive handlers and names (D16). It edits methods
   * the next-hop passes write, so it needs `nextHop`.
   */
  baselineShell: boolean;
  /**
   * The frame length applied in bits, the unit the shell declares
   * (`b(headerLength)`); the baseline's bytes otherwise. The 2026-10-13 frame
   * fix: control frames had been 80 bytes where 10 were meant.
   */
  frameLengthInBits: boolean;
  /**
   * A reception counted before the rebroadcast re-stamps the packet
   * (drainSlotOf): a neighbour's first frame was never counted otherwise. The
   * 2026-10-18 first-frame fix, 17b9643.
   */
  countOnArrival: boolean;
}

const PROFILES: Readonly<Record<3 | 4, StructureProfile>> = {
  3: { nextHop: false, baselineShell: false, frameLengthInBits: false, countOnArrival: false },
  4: { nextHop: true, baselineShell: true, frameLengthInBits: true, countOnArrival: true },
};

// The one dependency between fields, checked where the profiles are written:
// the baseline shell runs inside the next-hop passes, so without them it would
// silently do nothing.
for (const [v, p] of Object.entries(PROFILES))
  if (p.baselineShell && !p.nextHop)
    throw new Error(`structure: structure ${v}'s profile has the baseline shell without the next-hop `
      + "design, which it runs inside.");

/** The profile of a structure that carries the pattern (3 or 4). */
export function structureProfile(version: EmitVersion): StructureProfile {
  if (!carriesPattern(version))
    throw new Error(`structure: structure ${version} carries no pattern, so it has no profile.`);
  return PROFILES[version as 3 | 4];
}

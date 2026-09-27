import { describe, it, expect } from "vitest";
import { parseModel } from "../src/engine/parser";
import { routingStyleOf } from "../src/engine/patternExtension";
import { loadProject } from "../scripts/projects";

// routingStyleOf against every model on disk — the rule was CHOSEN on these, so
// they are what pins it. The synthetic cases live in patternExtension.test.ts,
// which runs on a clean checkout; this file needs the advisor's models.
//
// ⚠ Why the sink, and not the per-packet destination: `x ∈ ND ∖ Dests` and
// `des = ran({pkt} ◁ finalDestAddr)` are in pM1's own `creatingPkt`, so every
// pattern-based input carries them and they cannot tell two apart. The sink
// declaration is the one signal that varies. A project naming NO sink reads
// flooding — the default, by the user's ruling (2026-09-27), which is why the two
// pattern-based projects below read flooding. See
// docs/findings/netlayer/2026-09-27-rreq-rrep-rrer-pattern-study.md §7b.
const styleOf = (project: string) => routingStyleOf(parseModel(loadProject(project)).contexts);

describe("routingStyleOf on the corpus", () => {
  it.each([
    // one sink node, everything flows to it
    ["MintRoute", "flooding"],
    ["Ex_WSN_Pattern/WSN_Pattern", "flooding"], // the advisor's flooding study
    // the sink is one destination among several
    ["RTMCS", "aodv"],
    // no sink at all: the default
    ["AppLayer", "flooding"],
    ["Ex_WSN_Pattern/WSN_Pattern_shDecom6_2", "flooding"],
  ])("%s reads as %s", (project, style) => {
    expect(styleOf(project)).toBe(style);
  });

  it("records the known limit: the DSR stub reads as flooding, though DSR discovers on demand", () => {
    // WBAN_1_0/C0.buc declares `Sink ∈ ND`. Shape predicts the case study, not
    // the algorithm — and structure 3 never sees this stub (no control set, no
    // CommPattern state), so the misreading cannot reach a generated module.
    expect(styleOf("EventB_model/WBAN_1_0")).toBe("flooding");
  });
});

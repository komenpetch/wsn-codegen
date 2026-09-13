import { describe, it, expect } from "vitest";
import { synthProject } from "../scripts/synth-model";
import { parseModel } from "../src/engine/parser";
import { flatten } from "../src/engine/flattener";
import { resolveEncodings } from "../src/engine/encodingResolver";

describe("synthProject", () => {
  it("emits one .bum per chain level plus one context", () => {
    const files = synthProject({ depth: 3, eventsPerMachine: 4, vars: 6, clausesPerEvent: 5 });
    expect(files.filter(f => f.name.endsWith(".bum"))).toHaveLength(3);
    expect(files.filter(f => f.name.endsWith(".buc"))).toHaveLength(1);
  });

  it("produces a chain the real pipeline accepts, with the requested scale", () => {
    const files = synthProject({ depth: 2, eventsPerMachine: 3, vars: 4, clausesPerEvent: 4 });
    const raw = parseModel(files);
    expect(raw.machines).toHaveLength(2);
    const flat = flatten(raw, "sM2");
    expect(flat.events.length).toBeGreaterThan(0);
    const clauses = flat.events.reduce((a, e) => a + e.guards.length + e.actions.length, 0);
    expect(clauses).toBeGreaterThan(0);
  });

  it("scales clause count monotonically with clausesPerEvent", () => {
    const count = (c: number) => {
      const raw = parseModel(synthProject({ depth: 2, eventsPerMachine: 3, vars: 4, clausesPerEvent: c }));
      const flat = flatten(raw, "sM2");
      return flat.events.reduce((a, e) => a + e.guards.length + e.actions.length, 0);
    };
    expect(count(8)).toBeGreaterThan(count(4));
  });

  it("every state variable gets a concrete encoding (no unresolved vars)", () => {
    const raw = parseModel(synthProject({ depth: 2, eventsPerMachine: 3, vars: 8, clausesPerEvent: 4 }));
    const enc = resolveEncodings(flatten(raw, "sM2"));
    expect(enc.encodings.size).toBe(enc.variables.length);
  });
});

// ── Stage 1: Parser output ──────────────────────────────────────────────
export interface RawModel { machines: RawMachine[]; contexts: RawContext[]; }
export interface RawMachine {
  name: string;
  refines?: string;            // target machine name
  sees: string[];              // seen context names
  variables: string[];
  invariants: Labelled[];      // predicate carried in `.text`
  events: RawEvent[];
}
export interface RawEvent {
  label: string;
  refines?: string;            // refined event label, if any
  extended: boolean;
  parameters: string[];
  guards: Labelled[];          // predicate in `.text`
  actions: Labelled[];         // assignment in `.text`
}
export interface RawContext {
  name: string;
  extendsCtx?: string;
  sets: string[];
  constants: string[];
  axioms: Labelled[];
}
export interface Labelled { label: string; text: string; }

// ── Stage 3: Flattener output ───────────────────────────────────────────
export interface FlatEvent {
  label: string;
  parameters: string[];
  guards: string[];     // predicate strings, refines/extends merged in
  actions: string[];    // assignment strings, refines/extends merged in
}
export interface FlatMachine {
  name: string;                       // target machine label, e.g. "pM1"
  chain: string[];                    // machine labels base → target, e.g. ["pM1","uM2","pM3"]
  variables: string[];                // union across the refines chain
  variableTypes: Map<string, string>; // identifier → invariant predicate (raw Unicode)
  events: FlatEvent[];                // every event fully flattened
}

// ── Stage 4: EncodingResolver output ────────────────────────────────────
// ENC1 scalar int alias | ENC2 plain set | ENC3 function map | ENC4 pair-set
// | ENC5 map-of-sets | ENC6 bool. (Enum tags live in the context fixture.)
export type EncodingForm =
  | "int" | "set" | "function" | "pair-set" | "map-of-sets" | "bool";
export interface EncodedMachine extends FlatMachine {
  encodings: Map<string, EncodingForm>;  // machine variables only
}

// ── Stage 5/6: RuleEngine + Emitter output ──────────────────────────────
export interface Fragment { sourceExpr: string; rule: string; cpp: string; }
export interface GeneratedFile { path: string; content: string; }
export type GeneratedTree = GeneratedFile[];

// The label Rodin gives every machine's initialisation event. Spelled out as
// a literal in three places, which is two places for a typo to hide in --
// `find(e => e.label === "INITIALISATION")` silently finds nothing.
export const INITIALISATION = "INITIALISATION";

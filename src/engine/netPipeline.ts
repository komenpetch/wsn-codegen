// The network-layer half of the generator: everything the app-layer pipeline
// emits, PLUS the packet classes (PPkt), the per-type transmit methods
// (sendBeaconBroadcast / sendRouteBroadcast / …), the flooding scheduler and
// the medium binding.
//
// It is NOT a separate generator and there is no separate command. `pipeline.ts`
// calls tryNetworkLayer() for every v4 generation; it returns null when the
// model has no medium to bind, and that model keeps the app-layer shell. So one
// project + one target machine still produces exactly three files, one module —
// the model decides how much of it is there.
import { addMissingPacketTypeConstants, fixNonLeafSetConstants, fixSetTypedParameters,
  insertPacketRegistry, renameReservedIdentifiers, spliceHeader, spliceImpl,
  stripDeadPacketFieldMaps } from "./postEmit";
import { flatten } from "./flattener";
import { resolveEncodings } from "./encodingResolver";
import { emit } from "./codeEmitter";
import { RULES } from "./rules";
import type { Rule } from "./rules";
import type { EncodedMachine, GeneratedTree, RawModel } from "./types";
import { packetModelFor } from "./packetModel";
import type { PacketModel } from "./packetModel";
import { emitPacketClasses } from "./packetEmitter";
import { packetRules } from "./packetRules";
import { miscRules } from "./miscRules";
import { scalarRules } from "./scalarRules";
import { composedRules } from "./composedRules";
import { nestedMapVars, nestedMapRules, fixNestedMapDeclarations } from "./nestedMap";
import { pairKeyedVars, pairKeyedRules, fixPairKeyedDeclarations } from "./pairKeyed";
import { installScheduler } from "./scheduler";
import { bindNodeIdentity } from "./nodeIdentity";
import { installNetProtocolShell, renameCommPatternPair } from "./netProtocolShell";
import { imageRules, insertImageHelper } from "./imageRules";
import { composeRules } from "./compose";
import { mediumRules } from "./mediumRules";
import { planMedium, bindMedium, modelHasMedium } from "./mediumBinding";
import { fixAliasedEncodings, fixBooleanEncodings } from "./aliasEncoding";
import { carrierSetsOf } from "./text";
import { implText } from "./emitted";

// PPkt and everything that follows from it, WITHOUT the network-layer shell.
//
// Shared by the two things that need packet classes: a network-layer module
// (tryNetworkLayer, below, which then adds the protocol shell and the medium)
// and an app-layer module that carries PPkt but no medium -- the SensorApp shell
// plus the packet pattern class, which is emitted structure v5.
//
// `pm` is a parameter rather than derived here BECAUSE of v5: the packet model
// may come from a DIFFERENT Event-B project than the module being emitted. The
// packet pattern class is a pattern, and a pattern is not owned by the protocol
// it was read off.
export interface PacketClassInput {
  raw: RawModel;
  model: EncodedMachine;
  name: string;
  pm: PacketModel;
  carriers: Set<string>;
}

export function emitWithPacketClasses(
  { raw, model, name, pm, carriers }: PacketClassInput): GeneratedTree {
  // Composition is installed for the duration of this generation only, so the
  // app-layer catalog module is never mutated for other callers.
  const nested = nestedMapVars(model);
  const pairKeyed = pairKeyedVars(model);
  // ⚠ pairKeyedRules FIRST, and rule order here is BEHAVIOUR, not style. With
  // them last, SETEXPR-PAIR-MEM claims `y ↦ x ∈ dom(sentEst)` and emits "" --
  // the deliberate intercept-and-refuse technique -- so update_route stayed
  // untranslated even though PK-DOM matched the clause in isolation. That cost
  // a debugging round the first time this was built.
  const composed = composeRules([...pairKeyedRules(pairKeyed, model),
    ...packetRules(pm.fields), ...mediumRules(pm.lattice), ...miscRules(),
    ...scalarRules(), ...composedRules(carriers), ...nestedMapRules(nested), ...imageRules()]);
  let tree = withRules(composed, () => emit(model, name, 2, raw.contexts));

  // Splice the packet classes into the header, above the module class.
  const { header, impl } = emitPacketClasses(pm);
  tree = tree.map((f) =>
    f.path.endsWith(".h") ? { ...f, content: spliceHeader(f.content, header) }
    : f.path.endsWith(".cc") ? { ...f, content: spliceImpl(f.content, impl) }
    : f);

  tree = renameReservedIdentifiers(tree);
  tree = stripDeadPacketFieldMaps(tree, pm.fields);
  tree = addMissingPacketTypeConstants(tree, pm.lattice.tagOf);
  tree = fixNonLeafSetConstants(tree, pm.lattice);
  tree = fixSetTypedParameters(tree, name);
  tree = fixNestedMapDeclarations(tree, nested);
  // ⚠ The encoding resolver calls a pair-keyed function an ordinary function
  // and declares `std::map<int, T>` -- a key of the wrong ARITY, on six
  // variables per case study. Nothing caught it because every clause using one
  // was `// UNTRANSLATED`; translating them is what makes the declaration matter.
  tree = fixPairKeyedDeclarations(tree, pairKeyed);
  tree = insertPacketRegistry(tree);
  tree = insertImageHelper(tree);
  return tree;
}

// Generate the merged module WITH its network layer, or return null if this
// model has none — in which case the caller emits the app-layer module instead.
//
// The test is the medium, read off the model: does it serialise a packet field
// by field, hand it to a shared relation, and deliver it to whoever a
// propagation variable names? A model that does is a network-layer model. The
// app-layer chain pM1 → uM2 → pM3 has the CommPattern pair but none of that, so
// it answers no and keeps its ApplicationBase shell — its emitted bytes are
// frozen evidence behind the paper's similarity figures and must not move.
//
// The model built here is this function's OWN: fixAliasedEncodings and
// fixBooleanEncodings MUTATE it, and a bail-out must not leave the caller
// holding a model those passes have already rewritten.
export interface NetworkLayerAttempt {
  /**
   * The flattened, encoded model. Built once here and handed back so the caller
   * does not rebuild it: when `tree` is null the app-layer path emits from THIS
   * model rather than flattening and encoding the same machine a second time.
   * Untouched by any network-layer pass -- see the ordering note below.
   */
  model: EncodedMachine;
  /** The generated module, or null when the model has no network layer. */
  tree: GeneratedTree | null;
}

export function tryNetworkLayer(raw: RawModel, machine: string, name: string): NetworkLayerAttempt {
  const model = resolveEncodings(flatten(raw, machine));

  // Both bail-outs come BEFORE the two encoding fixes below, and that ordering
  // is the reason the model can be handed back at all. The fixes MUTATE it; a
  // model returned to the app-layer path after they had run would be a
  // different model from the one that path builds for itself, so the app layer's
  // output would silently depend on how far into this function a bail-out got.

  // No packet-type partition means no PPkt, so nothing here applies.
  const pm = packetModelFor(raw, model);
  if (!pm) return { model, tree: null };
  // The medium decides. Asked BEFORE emitting, because the answer chooses the
  // shell, and the shell is what the rest of this pipeline attaches to.
  if (!modelHasMedium(model, pm)) return { model, tree: null };

  // wsn-codegen's encodingResolver never dereferences a context-level type
  // alias (MintRoute's `WSN = ND ↔ ND`), so a variable declared merely
  // `∈ WSN` (wsnLinks, crashedLinks) silently defaults to a scalar "set"
  // instead of "pair-set" -- see aliasEncoding.ts for the full account. Fix
  // it here, on the model this pipeline owns, rather than in encodingResolver
  // itself (off-limits).
  fixAliasedEncodings(raw, model);
  // Same "encodingResolver's infer() silently defaults to 'set'" family of
  // gap, this time for a variable typed directly against the builtin BOOL
  // (MintRoute M4's `bcastRouTimer ∈ BOOL`) -- see aliasEncoding.ts.
  fixBooleanEncodings(model);

  // The model's carrier sets: membership in one is a typing statement, not a
  // container lookup (setExpr.ts memberOfLeaf).
  const carriers = carrierSetsOf(raw);

  let tree = emitWithPacketClasses({ raw, model, name, pm, carriers });

  // The network-layer shell replaces the app layer's SensorApp shell BEFORE
  // anything patches it: the identity binding, the medium binding and the
  // scheduler all attach to methods this pass emits.
  tree = installNetProtocolShell(tree, name, machine);
  // Before planMedium: the CommPattern pair moves to NetworkProtocolBase's own
  // names here, and planMedium resolves the delivery method by reading the
  // provenance comment above it. Renaming afterwards would leave bindMedium
  // calling a method that no longer exists.
  tree = renameCommPatternPair(tree, name);
  tree = bindNodeIdentity(tree, model, raw.contexts, name);
  // The medium binding is planned against the FINAL emitted signatures (the
  // CommPattern rename and fixSetTypedParameters have both run by now), and it
  // must precede the scheduler: which events the simulator realises decides
  // which events the scheduler may not fire on its own.
  const plan = planMedium(model, pm, implText(tree), name);
  if (plan) tree = bindMedium(tree, plan, name);
  // The medium binding's own exclusions, with the reason the emitted comment
  // has always carried.
  const notScheduled = new Map([...(plan?.realisedByMedium ?? [])].map((l) =>
    [l, "the simulator's medium realises it"] as const));
  tree = installScheduler(tree, model, name, pm.fields, notScheduled, plan !== null, carriers);
  return { model, tree };
}



// RULES is a const array the engine reads directly, so swap its CONTENTS for
// the duration of the call and restore them afterwards. Mutating a shared array
// is ugly; the alternative is threading a rule set through six engine
// signatures in wsn-codegen, which this plan is not allowed to modify.
function withRules<T>(rules: Rule[], fn: () => T): T {
  const saved = RULES.slice();
  RULES.length = 0; RULES.push(...rules);
  try { return fn(); } finally { RULES.length = 0; RULES.push(...saved); }
}
// Safe alongside the freeze guard only because vitest isolates each test FILE
// in its own module registry, so appLayerUnchanged.test.ts never observes a
// swapped catalog. If that isolation is ever turned off (`--no-isolate`,
// `pool: "vmThreads"`), this becomes a race and the guard starts flapping.

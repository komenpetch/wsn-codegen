import { INITIALISATION } from "./types";
import type { EncodedMachine, GeneratedTree, RawContext } from "./types";
import { mustFind } from "./emitted";
import { subsetClosure } from "./text";

// The node-level identity binding: bind the model's carrier set to the
// simulation's actual nodes.
//
// This is the counterpart of the PktId -> PPkt binding. Without it every
// carrier-set loop in the scheduler iterates an empty `ND`, every node-keyed
// map is empty, and no event can fire however well its guards translate.
//
// The approach is taken from the reference implementation rather than invented:
// INET's own MintRoute (MintRoute.cc, INITSTAGE_NETWORK_LAYER) identifies a node
// by its interface address and decides sink-ness by comparing that address with
// a resolved `sinkAddress` NED parameter:
//
//     sinkAddress = L3AddressResolver().resolve(par("sinkAddress"));
//     myNetwAddr  = ie->getNetworkAddress();
//     if (myNetwAddr == sinkAddress) { ...I am the root... }
//
// So sink-ness is an address comparison, NOT a harness convention such as "an
// empty sinkAddress means I am the sink" -- see
// findings/2026-09-07-mintroute-flooding.md.
//
// Two stages are used, and the split matters. INET runs every module through
// stage N before any module reaches N+1, so registering identities in one stage
// and reading `Sink` in the next is what makes the sink known to everyone. Doing
// both in one stage would leave the answer dependent on module order.

// WHICH constant names the distinguished node, derived rather than assumed.
//
// This used to be the literal name `Sink`, which is MintRoute's and RTMCS's
// name for it -- the only two models that had ever reached this binding. A
// model that does not declare it emitted `myNodeId = isSink ? Sink : ...`
// against an undeclared identifier and did not compile.
//
// The discriminator is measured, not guessed: across the corpus the sink is the
// only constant carrying BOTH a value axiom (`Sink = 0` -- the model fixes its
// id, which is why the id is adopted rather than assigned) AND a membership
// axiom placing it in the node set (`Sink ∈ ND`, or RTMCS's `Sink ∈ Destination`
// with `Destination ⊆ ND`). Neither half alone is enough: `CTL_VAL = 0` is
// pinned but is not a node, and `DATA ∈ TYPE` is typed but has no value.
//
// Null is a legitimate answer, not a failure. The app-layer pattern's own
// vocabulary is `ND ∖ Dests` -- a SET of destinations, no single distinguished
// node -- so there is no id to adopt and every node takes its module id.
// Which carrier sets hold NODES: ND itself, plus anything a `S ⊆ ND` axiom
// places inside it, to a fixpoint so `A ⊆ B ⊆ ND` counts whatever order the
// axioms appear in.
//
// Extracted because TWO questions need it and only one was asking. Finding the
// distinguished node needs it; so does deciding whether a `V ≔ C × {v}`
// initialisation is node-keyed at all -- and that second caller had no notion
// of it, so it specialised `netSeqNo ≔ PKT × {0}` as though PKT were ND.
export function nodeSetsOf(contexts: readonly RawContext[]): Set<string> {
  return subsetClosure("ND", contexts.flatMap((c) => c.axioms.map((a) => a.text)));
}

/**
 * Node subsets the axioms declare but leave OPEN — the ones a harness has to
 * populate, because nothing in the model says who is in them.
 *
 * ⚠ WHY THIS EXISTS. `Dests ⊆ ND` is declared and never filled, so `ND ∖ Dests`
 * admits every node and `dest_recv_pkt`'s `nb ∈ Dests` can never hold: the
 * flood has no destination. Every node forwards and nobody consumes — measured
 * on the nine-node field as `fwdr_receive_pkt` 94–95 on all nine while
 * `final_tx_pkt` totalled 3 for the whole run, i.e. packets were essentially
 * never retired.
 *
 * ✅ AND IT IS A SHAPE, NOT A NAME. Measured across the corpus before it was
 * written:
 *
 *   AppLayer   `Dests ⊆ ND`                     members NOT fixed  → harness
 *   MintRoute  (no node subsets at all)                            → untouched
 *   RTMCS      `Actuators = {1,8,9}`,
 *              `partition(Destination, {Sink}, Actuators)`
 *                                               members ARE fixed  → untouched
 *
 * So the rule picks out exactly the one set that needs supplying, and cannot
 * disturb either case study. A subset whose members the axioms DO fix is left
 * alone deliberately: emitting those from `C = {…}` is a separate gap (RTMCS's
 * `Actuators` is declared empty today) and belongs to the context emitter, not
 * to the identity binding.
 *
 * ⚠ `ND` itself is excluded: it is bound to the simulation's nodes by this same
 * pass, which is what `ND.insert(myNodeId)` is.
 */
export function openNodeSubsetsOf(contexts: readonly RawContext[]): string[] {
  const axioms = contexts.flatMap((c) => c.axioms.map((a) => a.text.trim()));
  const fixed = (c: string) => axioms.some((a) =>
    new RegExp(`^${c}\\s*=`).test(a) || new RegExp(`partition\\s*\\(\\s*${c}\\b`).test(a));
  return [...nodeSetsOf(contexts)].filter((c) => c !== "ND" && !fixed(c)).sort();
}

/** The NED parameter by which the harness says this node is in that set. */
export const membershipParam = (constant: string) => `in${constant}`;

export function sinkConstantOf(contexts: readonly RawContext[]): string | null {
  const axioms = contexts.flatMap((c) => c.axioms.map((a) => a.text.trim()));

  const nodeSets = nodeSetsOf(contexts);

  const pinned = new Set<string>();
  const inNodeSet = new Set<string>();
  for (const a of axioms) {
    const v = /^(\w+)\s*=\s*-?\d+$/.exec(a);
    if (v) pinned.add(v[1]);
    const t = /^(\w+)\s*∈\s*(\w+)$/.exec(a);
    if (t && nodeSets.has(t[2])) inNodeSet.add(t[1]);
  }

  const declared = new Set(contexts.flatMap((c) => c.constants));
  const found = [...pinned].filter((c) => inNodeSet.has(c) && declared.has(c));
  // Two would mean two distinguished nodes and no way to choose between them.
  // Refusing beats adopting whichever the context order happened to yield.
  if (found.length > 1)
    throw new Error(`bindNodeIdentity: ${found.join(", ")} are all pinned node constants, so `
      + "which one the simulation's sink adopts is ambiguous. Expected exactly one.");
  return found[0] ?? null;
}

interface CartesianInit { target: string; carrier: string; excluded: string | null; value: string; }

// `f ≔ ND × {v}` and `f ≔ (ND ∖ {Sink}) × {v}` from INITIALISATION. These could
// not run at construction time -- ND was empty then -- so they are specialised
// to this node once its id exists. The excluded name is CAPTURED rather than
// assumed to be the sink: it is the model that says which node the assignment
// skips.
// ⚠ The CARRIER is captured and checked, not skipped over. It used to be a
// bare uncaptured `\w+`, so ANY `V ≔ C × {v}` counted as node-keyed: MintRoute
// and the bundled extension both write `netSeqNo ≔ PKT × {0}` for a variable
// the model types `netSeqNo ∈ PKT → ℕ`, and that emitted
// `netSeqNo[myNodeId] = 0;` -- a node id used as a key in a PKT-keyed map --
// under a comment that read `≔ ND × {…}` when the model had said PKT. The
// comment was the visible half of the matcher being too loose.
function cartesianInits(model: EncodedMachine, nodeSets: ReadonlySet<string>): CartesianInit[] {
  const init = model.events.find((e) => e.label === INITIALISATION);
  if (!init) return [];
  const out: CartesianInit[] = [];
  for (const a of init.actions) {
    const m = /^\s*(\w+)\s*≔\s*\(?\s*(\w+)\s*(?:∖\s*\{\s*(\w+)\s*\})?\s*\)?\s*×\s*\{\s*(∅|\w+)\s*\}\s*$/.exec(a);
    if (!m) continue;
    if (!nodeSets.has(m[2])) continue;   // keyed by something that is not a node
    const cpp = m[4] === "∅" ? null : m[4] === "FALSE" ? "false" : m[4] === "TRUE" ? "true" : m[4];
    out.push({ target: m[1], carrier: m[2], excluded: m[3] ?? null, value: cpp ?? "" });
  }
  return out;
}

// Which shell the module has decides only HOW the two addresses are obtained,
// and at which stage. Everything else -- adopting Sink's id, registering in ND,
// specialising the node-keyed initialisations a stage later -- is the same
// binding, so it is written once.
//
// The network module reads `myNetwAddr` and `sinkAddress`, which its own shell
// has already resolved in that same stage. An application has neither: its
// `sinkAddress` member is filled in by openSocket(), which runs at LIFECYCLE
// START, after every init stage. So the application resolves both itself,
// through the same resolver, and sink-ness stays an ADDRESS comparison rather
// than becoming a name test.
//
// tryResolve, not resolve: a node with no L3 address is a normal outcome in a
// passive-app harness (`hasIpv4 = false` assigns none), and resolve() throws on
// it. An unresolved address simply means "not the sink".
export type ShellKind = "network" | "application";

const IDENTITY_STAGE: Record<ShellKind, string> = {
  network: "INITSTAGE_NETWORK_LAYER",
  application: "INITSTAGE_APPLICATION_LAYER",
};

// Sink-ness is an ADDRESS COMPARISON, never a name test or a harness
// convention. Emitted verbatim when the model names a distinguished node.
const addressLines: Record<ShellKind, string[]> = {
  network: [
    "        // Both addresses are the network shell's own members, resolved just",
    "        // above in this same stage -- exactly MintRoute's own test for",
    "        // whether it is the root of the tree (`myNetwAddr == sinkAddress`).",
    "        bool isSink = !sinkAddress.isUnspecified() && myNetwAddr == sinkAddress;",
  ],
  application: [
    "        // An application has no resolved address of its own at init time --",
    "        // openSocket() fills sinkAddress in at lifecycle start, later than",
    "        // every stage -- so both are resolved here, through the SAME resolver,",
    "        // which keeps sink-ness an address comparison rather than a name test.",
    "        L3Address _sinkAddr;",
    "        // Kept as a member: the arrival needs it to recognise this node's own",
    "        // broadcast coming back up the stack, and it must be an address the",
    "        // SIMULATOR owns -- a model field would be re-stamped.",
    "        L3AddressResolver().tryResolve(getContainingNode(this)->getFullName(), myNetwAddr);",
    "        const char *_sinkStr = par(\"sinkAddress\");",
    "        if (_sinkStr[0]) L3AddressResolver().tryResolve(_sinkStr, _sinkAddr);",
    "        bool isSink = !_sinkAddr.isUnspecified() && !myNetwAddr.isUnspecified()",
    "                      && myNetwAddr == _sinkAddr;",
  ],
};

// With no distinguished node there is nothing to compare an address AGAINST, so
// the sink test is not emitted at all. The application still resolves its own
// address: the arrival recognises this node's own broadcast coming back up the
// stack by it, and that must be an address the SIMULATOR owns, since a model
// field would be re-stamped.
const selfAddressOnly: Record<ShellKind, string[]> = {
  network: [],
  application: [
    "        // Kept as a member: the arrival needs it to recognise this node's own",
    "        // broadcast coming back up the stack, and it must be an address the",
    "        // SIMULATOR owns -- a model field would be re-stamped.",
    "        L3AddressResolver().tryResolve(getContainingNode(this)->getFullName(), myNetwAddr);",
  ],
};

export function bindNodeIdentity(tree: GeneratedTree, model: EncodedMachine,
  contexts: readonly RawContext[], cls: string, shell: ShellKind = "network"): GeneratedTree {
  const inits = cartesianInits(model, nodeSetsOf(contexts));
  const sink = sinkConstantOf(contexts);
  const openSubsets = openNodeSubsetsOf(contexts);

  const identity = sink
    ? [
      ...addressLines[shell],
      `        // ${sink} is a CONTEXT CONSTANT: the model fixes its value, so the id is`,
      "        // adopted rather than assigned. Every other node takes its module id,",
      `        // which INET never issues as 0, so it cannot collide with ${sink}.`,
      `        myNodeId = isSink ? ${sink} : getContainingNode(this)->getId();`,
    ]
    : [
      ...selfAddressOnly[shell],
      "        // This model names no distinguished node -- its vocabulary is a SET of",
      "        // destinations (`ND ∖ Dests`), not a single sink -- so no id is fixed by",
      "        // the context and every node simply takes its own module id.",
      "        myNodeId = getContainingNode(this)->getId();",
    ];

  const seed = [
    "",
    "    // ── Node identity binding ──",
    "    // Binds the model's carrier set ND to the simulation's nodes. Taken from",
    "    // INET MintRoute's own approach: a node IS its address, and the sink is",
    "    // decided by comparing addresses -- never by a harness convention.",
    `    if (stage == ${IDENTITY_STAGE[shell]}) {`,
    ...identity,
    "        ND.insert(myNodeId);",
    // A node subset the axioms leave open is populated the same way ND is:
    // each node declares its own membership, and the set is shared, so the
    // members accumulate across the modules. The harness decides, because the
    // model does not -- see openNodeSubsetsOf.
    ...openSubsets.flatMap((c) => [
      `        // ${c} ⊆ ND is declared and its members are not fixed by any axiom,`,
      "        // so the harness names them -- exactly as it names the topology.",
      `        if (par("${membershipParam(c)}").boolValue()) ${c}.insert(myNodeId);`,
    ]),
    "    }",
    `    // A LATER stage, so every node has registered and ${sink ?? "ND"} is settled: INET`,
    "    // runs all modules through one stage before any reaches the next.",
    "    if (stage == INITSTAGE_LAST) {",
    ...inits.map((i) =>
      i.excluded === null
        ? `        ${i.target}[myNodeId]${i.value ? ` = ${i.value}` : ""};   // ${i.target} ≔ ${i.carrier} × {…}`
        : `        if (myNodeId != ${i.excluded}) ${i.target}[myNodeId]${i.value ? ` = ${i.value}` : ""};   // over ND ∖ {${i.excluded}}`),
    "    }",
  ].join("\n");

  return tree.map((f) => {
    if (f.path.endsWith(".h")) {
      const anchor = "    // ── Event-B machine state ──";
      mustFind(f.content, anchor, "bindNodeIdentity (myNodeId declaration)");
      return {
        ...f,
        content: f.content.replace(
          anchor,
          `${anchor}\n    // This node's element of the model's carrier set ND.\n    Node myNodeId = -1;`
          // The network shell already declares its own `myNetwAddr`; an
          // application does not, and both the sink test and the arrival's echo
          // suppression need an address the SIMULATOR owns rather than a model
          // field the model re-stamps.
          + (shell === "application"
            ? "\n    // This node's own address, resolved once at init.\n    L3Address myNetwAddr;"
            : ""),
        ),
      };
    }
    if (f.path.endsWith(".cc")) {
      // Append inside initialize(), just before its closing brace.
      //
      // ⚠ Both anchors are preconditions. Skipping here leaves `myNodeId`
      // declared and never assigned and every node-keyed map empty, so
      // `create_bconPkt` declines on its first guard: the module compiles,
      // links, runs and floods nothing. That is the failure recorded on
      // 2026-09-13 as "compiles and does nothing", and it took a round to find.
      const at = mustFind(f.content, `void ${cls}::initialize(int stage) {`,
        "bindNodeIdentity (initialize)");
      const end = f.content.indexOf("\n}", at);
      if (end < 0)
        throw new Error(`bindNodeIdentity: ${cls}::initialize(int stage) has no closing brace to `
          + "insert the identity binding before.");
      return { ...f, content: f.content.slice(0, end) + "\n" + seed + f.content.slice(end) };
    }
    // The .ned must DECLARE the parameter the .cc reads, or OMNeT++ refuses the
    // module at setup with "unknown parameter" -- so the two are emitted
    // together, from the same derivation, rather than left to agree by hand.
    if (f.path.endsWith(".ned") && openSubsets.length) {
      const anchor = "    parameters:";
      mustFind(f.content, anchor, "bindNodeIdentity (NED parameters)");
      const decls = openSubsets.map((c) =>
        `        bool ${membershipParam(c)} = default(false);`
        + `   // is this node in ${c}? (${c} ⊆ ND, members not fixed by any axiom)`);
      return { ...f, content: f.content.replace(anchor, [anchor, ...decls].join("\n")) };
    }
    return f;
  });
}

import { INITIALISATION } from "./types";
import type { EncodedMachine, GeneratedTree } from "./types";
import { mustFind } from "./emitted";

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

interface CartesianInit { target: string; overSink: boolean; value: string; }

// `f ≔ ND × {v}` and `f ≔ (ND ∖ {Sink}) × {v}` from INITIALISATION. These could
// not run at construction time -- ND was empty then -- so they are specialised
// to this node once its id exists.
function cartesianInits(model: EncodedMachine): CartesianInit[] {
  const init = model.events.find((e) => e.label === INITIALISATION);
  if (!init) return [];
  const out: CartesianInit[] = [];
  for (const a of init.actions) {
    const m = /^\s*(\w+)\s*≔\s*(\(?\s*\w+\s*(?:∖\s*\{\s*\w+\s*\})?\s*\)?)\s*×\s*\{\s*(∅|\w+)\s*\}\s*$/.exec(a);
    if (!m) continue;
    const cpp = m[3] === "∅" ? null : m[3] === "FALSE" ? "false" : m[3] === "TRUE" ? "true" : m[3];
    out.push({ target: m[1], overSink: !/∖/.test(m[2]), value: cpp ?? "" });
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

export function bindNodeIdentity(tree: GeneratedTree, model: EncodedMachine, cls: string,
  shell: ShellKind = "network"): GeneratedTree {
  const inits = cartesianInits(model);

  const seed = [
    "",
    "    // ── Node identity binding ──",
    "    // Binds the model's carrier set ND to the simulation's nodes. Taken from",
    "    // INET MintRoute's own approach: a node IS its address, and the sink is",
    "    // decided by comparing addresses -- never by a harness convention.",
    `    if (stage == ${IDENTITY_STAGE[shell]}) {`,
    ...addressLines[shell],
    "        // Sink is a CONTEXT CONSTANT: the model fixes its value, so the id is",
    "        // adopted rather than assigned. Every other node takes its module id,",
    "        // which INET never issues as 0, so it cannot collide with Sink.",
    "        myNodeId = isSink ? Sink : getContainingNode(this)->getId();",
    "        ND.insert(myNodeId);",
    "    }",
    "    // A LATER stage, so every node has registered and Sink is settled: INET",
    "    // runs all modules through one stage before any reaches the next.",
    "    if (stage == INITSTAGE_LAST) {",
    ...inits.map((i) =>
      i.overSink
        ? `        ${i.target}[myNodeId]${i.value ? ` = ${i.value}` : ""};   // ${i.target} ≔ ND × {…}`
        : `        if (myNodeId != Sink) ${i.target}[myNodeId]${i.value ? ` = ${i.value}` : ""};   // over ND ∖ {Sink}`),
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
    return f;
  });
}

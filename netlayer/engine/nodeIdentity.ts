import type { EncodedMachine, GeneratedTree } from "../../src/engine/types";

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
  const init = model.events.find((e) => e.label === "INITIALISATION");
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

export function bindNodeIdentity(tree: GeneratedTree, model: EncodedMachine, cls: string): GeneratedTree {
  const inits = cartesianInits(model);

  const seed = [
    "",
    "    // ── Node identity binding ──",
    "    // Binds the model's carrier set ND to the simulation's nodes. Taken from",
    "    // INET MintRoute's own approach: a node IS its address, and the sink is",
    "    // decided by comparing addresses -- never by a harness convention.",
    "    if (stage == INITSTAGE_NETWORK_LAYER) {",
    "        cModule *host = getContainingNode(this);",
    "        // Resolve the parameter HERE rather than reading the shell's member:",
    "        // the shell resolves it in openSocket, which runs on start-operation,",
    "        // long after this stage. MintRoute.cc resolves it at this same stage",
    "        // for the same reason.",
    "        const char *_sinkStr = par(\"sinkAddress\");",
    "        L3Address _sinkAddr;",
    "        if (_sinkStr && _sinkStr[0])",
    "            _sinkAddr = L3AddressResolver().resolve(_sinkStr);",
    "        bool isSink = !_sinkAddr.isUnspecified()",
    "            && L3AddressResolver().addressOf(host) == _sinkAddr;",
    "        // Sink is a CONTEXT CONSTANT: the model fixes its value, so the id is",
    "        // adopted rather than assigned. Every other node takes its module id,",
    "        // which INET never issues as 0, so it cannot collide with Sink.",
    "        myNodeId = isSink ? Sink : host->getId();",
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
      if (!f.content.includes(anchor)) return f;
      return {
        ...f,
        content: f.content.replace(
          anchor,
          `${anchor}\n    // This node's element of the model's carrier set ND.\n    Node myNodeId = -1;`,
        ),
      };
    }
    if (f.path.endsWith(".cc")) {
      // Append inside initialize(), just before its closing brace.
      const at = f.content.indexOf(`void ${cls}::initialize(int stage) {`);
      if (at < 0) return f;
      const end = f.content.indexOf("\n}", at);
      if (end < 0) return f;
      return { ...f, content: f.content.slice(0, end) + "\n" + seed + f.content.slice(end) };
    }
    return f;
  });
}

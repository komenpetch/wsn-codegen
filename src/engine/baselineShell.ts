import type { GeneratedTree } from "./types";
import type { PacketModel } from "./packetModel";
import { broadcastMethodOf } from "./packetModel";
import { headerOf, implOf, nedOf, mustFind, mustReplace } from "./emitted";
import { lowerTag } from "./text";

// Structure 4's shell, matched to the case study's baseline the way structure 2's
// was matched to SensorApp (design/NextHop_Extension_Draft.md D16): the baseline's
// names, its statements where the model allows them, nothing invented. Structure 4
// only; structures 1-3 and the network-layer outputs never reach this pass.
//
// ⚠ THE ONE PLACE STRUCTURE 4 READS LEAF NAMES (user, 2026-10-12, "q1 a"). Some of
// MintRoute's choices cannot be derived from the model -- in the bundled split
// ROUTE and BEACON differ only by name -- so they are stated here, each with the
// baseline line it copies. The leaves are the tool's own bundled flooding split
// (C2_ctl), which is MintRoute's C3. A leaf not in the table (AODV's RREQ, RREP,
// RRER) gets the regular derived names and nothing from it.
//
// The baseline is src/inet/networklayer/mintroute/ in this project's INET tree.
export interface LeafBaseline {
  /**
   * The counter of this leaf's transmissions, incremented right after the send
   * and recorded in finish(). Irregular in the baseline -- `nbBeaconsSent` but
   * `nbRouteFloodsSent` -- which is why it is stated rather than derived.
   */
  sent: string;
  /**
   * This leaf's timer calls the Specific class's hooks, `updateNeighborTable()`
   * then `chooseParent()`, before it creates (D12).
   */
  hooks?: true;
  /**
   * This leaf's timer first fires near 1 s on the sink and 5 s elsewhere, not
   * after a random spread plus one interval.
   */
  sinkFirst?: true;
}

// In the order MintRoute's finish() records them (MintRoute.cc:618-619), which is
// also the order its handleSelfMessage tests the timers (:115, :119).
export const MINTROUTE_LEAVES: Readonly<Record<string, LeafBaseline>> = {
  // ++ :150, = 0 :62, declared .h:139
  BEACON: { sent: "nbBeaconsSent" },
  // ++ :193, = 0 :63, declared .h:140; hooks :120-121; first fire :88-91
  ROUTE: { sent: "nbRouteFloodsSent", hooks: true, sinkFirst: true },
};

const PASS = "installBaselineShell";

// The names one leaf's timer derives, as MintRoute names its own
// (`beaconFloodTimer`, `beaconFloodsInterval`, `SEND_BEACON_FLOOD_TIMER`).
const intervalOf = (tag: string) => `${lowerTag(tag)}FloodsInterval`;
const timerOf = (tag: string) => `${lowerTag(tag)}FloodTimer`;
const kindOf = (tag: string) => `SEND_${tag}_FLOOD_TIMER`;

// Rewrite one method's body, found by the start of its definition line and ended
// at the first `}` in column 0 (the emitter's own layout). Loud on a miss.
function inMethod(cc: string, signature: string, edit: (body: string) => string): string {
  const at = mustFind(cc, signature, `${PASS} (${signature})`);
  const end = cc.indexOf("\n}\n", at);
  if (end < 0) throw new Error(`${PASS}: ${signature} has no closing brace in column 0.`);
  return cc.slice(0, at) + edit(cc.slice(at, end)) + cc.slice(end);
}

interface Texts { h: string; cc: string; ned: string; }

/**
 * D16 piece 2: one timer per packet type (user, 2026-10-12, Q1 = a, Q2 = a). Each
 * leaf whose creating event the scheduler can fire gets a timer and an interval,
 * armed on every node -- the model's guards decide who actually creates -- and a
 * no-argument `send<Leaf>Broadcast()` the timer calls, as MintRoute's
 * handleSelfMessage calls its own: the model creates the packet, and the
 * delivery events send it through the `(Node, PktId)` overload. The table adds
 * the hooks and the sink-first start to the leaves it names.
 *
 * The single model timer and `runEnabledEvents()` go: every event is now reached
 * either by a leaf's timer (the creating events) or by `runDeliveryEvents()`
 * (everything else), and nothing else called it.
 */
function installTimers(t: Texts, cls: string, tags: string[]): Texts {
  const table = (tag: string): LeafBaseline | undefined => MINTROUTE_LEAVES[tag];
  const hooks = tags.some((tag) => table(tag)?.hooks);

  // ── .h ──
  let h = mustReplace(t.h, "    simtime_t tickInterval;\n",
    tags.map((tag) => `    double ${intervalOf(tag)} = 0.0;\n`).join(""), `${PASS} (.h interval)`);
  h = mustReplace(h,
    "    // One self-message drives the model, the way MintRoute's own beacon and\n"
    + "    // route timers drive its periodic work.\n    cMessage *modelTimer = nullptr;\n",
    "    // One self-message per packet type, as MintRoute has one per flood.\n"
    + tags.map((tag) => `    cMessage *${timerOf(tag)} = nullptr;\n`).join(""), `${PASS} (.h timer)`);
  h = mustReplace(h, "    enum messageKinds { MODEL_TICK = 301 };\n",
    "    enum messageKinds {\n"
    + tags.map((tag, i) => `        ${kindOf(tag)} = ${301 + i}`).join(",\n") + "\n    };\n",
    `${PASS} (.h kinds)`);
  h = mustReplace(h, "    virtual L3Address resolveBroadcast() const;\n",
    "    virtual L3Address resolveBroadcast() const;\n\n"
    + "    // What each packet type's timer calls, as MintRoute's handleSelfMessage\n"
    + "    // calls its own: the model creates the packet, the delivery events send it.\n"
    + tags.map((tag) => `    virtual void ${broadcastMethodOf(tag)}();\n`).join("")
    + (hooks
      ? "\n    // The Specific class's entry points (D12), called by the route timer\n"
        + "    // before it creates, as MintRoute.cc:120-121 call its own. Empty here:\n"
        + "    // which routes exist is the Specific class's to decide.\n"
        + "    virtual void updateNeighborTable() {}\n"
        + "    virtual void chooseParent() {}\n"
      : ""),
    `${PASS} (.h sends)`);
  h = mustReplace(h, "    bool runEnabledEvents();\n", "", `${PASS} (.h runEnabledEvents)`);

  // ── .cc ──
  let cc = mustReplace(t.cc, `${cls}::~${cls}() { cancelAndDelete(modelTimer); }`,
    `${cls}::~${cls}() {\n` + tags.map((tag) => `    cancelAndDelete(${timerOf(tag)});\n`).join("") + "}",
    `${PASS} (destructor)`);
  cc = inMethod(cc, `void ${cls}::initialize(int stage) {`, (body) => {
    let b = mustReplace(body, "        tickInterval = par(\"tickInterval\");\n",
      tags.map((tag) => `        ${intervalOf(tag)} = par("${intervalOf(tag)}");\n`).join(""),
      `${PASS} (initialize, intervals)`);
    b = mustReplace(b, "        modelTimer = new cMessage(\"eb-model-tick\", MODEL_TICK);\n",
      tags.map((tag) =>
        `        ${timerOf(tag)} = new cMessage("eb-${lowerTag(tag)}-flood-timer", ${kindOf(tag)});\n`).join(""),
      `${PASS} (initialize, timers)`);
    b = mustReplace(b,
      "        // Spread the first tick so every node does not transmit at once,\n"
      + "        // exactly as MintRoute spreads its first beacon flood.\n"
      + "        scheduleAfter(uniform(0.1, 0.9) + tickInterval, modelTimer);\n",
      "        // Every node arms every timer: the model's guards decide who creates\n"
      + "        // (D16 Q2). The first fires are MintRoute's (MintRoute.cc:84-91).\n"
      + tags.map((tag) => table(tag)?.sinkFirst
        ? `        if (${intervalOf(tag)} > 0) {\n`
          + "            simtime_t firstRoute = uniform(0.000003, 0.000009) + (myNetwAddr == sinkAddress ? 1.0 : 5.0);\n"
          + `            scheduleAfter(firstRoute, ${timerOf(tag)});\n        }\n`
        : `        if (${intervalOf(tag)} > 0)\n`
          + `            scheduleAfter(uniform(0.1, 0.9) + ${intervalOf(tag)}, ${timerOf(tag)});\n`).join(""),
      `${PASS} (initialize, first fires)`);
    return b;
  });
  cc = mustReplace(cc,
    "// The model's clock. Event-B says an event fires when its guards hold; this\n"
    + "// is when the module asks whether any of them do.\n",
    "// One timer per packet type, as MintRoute.cc:113-128: each offers the model\n"
    + "// the chance to create a packet of that type.\n", `${PASS} (handleSelfMessage comment)`);
  cc = inMethod(cc, `void ${cls}::handleSelfMessage(cMessage *msg) {`, (body) => {
    const warn = /\n( {4}else \{\n {8}EV_WARN[\s\S]*)$/.exec(body);
    if (!warn) throw new Error(`${PASS}: handleSelfMessage has no else branch to keep.`);
    return `void ${cls}::handleSelfMessage(cMessage *msg) {\n`
      + tags.map((tag, i) =>
        `    ${i ? "else if" : "if"} (msg->getKind() == ${kindOf(tag)}) {\n`
        + (table(tag)?.hooks ? "        updateNeighborTable();\n        chooseParent();\n" : "")
        + `        ${broadcastMethodOf(tag)}();\n`
        + `        scheduleAfter(${intervalOf(tag)}, ${timerOf(tag)});\n    }\n`).join("")
      + warn[1];
  });
  for (const tag of tags) {
    const send = broadcastMethodOf(tag);
    const transmit = `void ${cls}::${send}(Node x, PktId pkt) {`;
    mustFind(cc, transmit, `${PASS} (${send} transmit)`);
    cc = cc.replace(transmit,
      `// The ${lowerTag(tag)} timer's send: the model creates the packet\n`
      + `// (create_${lowerTag(tag)}Pkt) and the delivery events -- start_tx, send_down --\n`
      + "// put it on the air through the overload below.\n"
      + `void ${cls}::${send}() {\n    try_create_${lowerTag(tag)}Pkt();\n    runDeliveryEvents();\n}\n\n`
      + transmit);
  }
  // runEnabledEvents: its only caller was the model timer.
  const def = mustFind(cc,
    "// One round of the Event-B operational semantics: attempt every event whose\n",
    `${PASS} (runEnabledEvents comment)`);
  // ⚠ The cut runs from that comment to the next `}` in column 0, so the
  // definition must be the very next thing, or the cut would take another method.
  const defAt = mustFind(cc, `bool ${cls}::runEnabledEvents()\n{`, `${PASS} (runEnabledEvents)`);
  if (defAt < def || cc.slice(def, defAt).split("\n").length > 4)
    throw new Error(`${PASS}: runEnabledEvents() no longer follows its comment directly.`);
  const end = cc.indexOf("\n}\n", defAt) + 3;
  cc = cc.slice(0, def) + cc.slice(end).replace(/^\n/, "");

  // ── .ned ──
  const ned = mustReplace(t.ned,
    "        // How often the module asks the model which events are enabled.\n"
    + "        double tickInterval @unit(s) = default(1s);\n",
    "        // One interval per packet type's timer, named as MintRoute names its own.\n"
    + tags.map((tag) => `        double ${intervalOf(tag)} @unit(s) = default(5s);\n`).join(""),
    `${PASS} (.ned)`);

  for (const [what, text] of [[".h", h], [".cc", cc], [".ned", ned]] as const)
    for (const gone of ["modelTimer", "tickInterval", "MODEL_TICK", "runEnabledEvents"])
      if (text.includes(gone))
        throw new Error(`${PASS}: the ${what} still names ${gone} after the timers replaced it.`);
  return { h, cc, ned };
}

/**
 * D16 piece 1: the baseline's control counters and `finish()`. Each leaf in the
 * table gets its counter, declared and reset as MintRoute does, incremented in
 * its `send<Leaf>Broadcast` right after `sendDown(packet);` (so it counts every
 * transmission of that type, rebroadcasts included -- originations stay readable
 * from the scheduler's `fired:create_<leaf>Pkt`), and recorded under the
 * baseline's own `stats` switch. Leaves with no table entry get no counter.
 */
function installCounters(t: Texts, cls: string, tags: string[]): Texts {
  const leaves = Object.entries(MINTROUTE_LEAVES).filter(([tag]) => tags.includes(tag));
  if (leaves.length === 0) return t;

  // Anchored after the parameters, so the timers above can replace theirs.
  let h = mustReplace(t.h, "    L3Address myNetwAddr;\n",
    "    bool stats = true;\n    L3Address myNetwAddr;\n", `${PASS} (.h parameters)`);
  h = mustReplace(h, "    long receivedCount = 0;\n",
    "    long receivedCount = 0;\n" + leaves.map(([, b]) => `    long ${b.sent} = 0;\n`).join(""),
    `${PASS} (.h state)`);

  let cc = inMethod(t.cc, `void ${cls}::initialize(int stage) {`, (body) => {
    // Last of the parameter reads, as MintRoute.cc:48 has it.
    let b = mustReplace(body, "        sentCount = 0;\n",
      "        stats = par(\"stats\");\n        sentCount = 0;\n", `${PASS} (initialize, parameters)`);
    // Reset before the timers are made, as MintRoute.cc:62-63 do.
    b = mustReplace(b, "        WATCH(receivedCount);\n",
      "        WATCH(receivedCount);\n" + leaves.map(([, x]) => `        ${x.sent} = 0;\n`).join(""),
      `${PASS} (initialize, counters)`);
    return b;
  });
  for (const [tag, b] of leaves)
    cc = inMethod(cc, `void ${cls}::${broadcastMethodOf(tag)}(Node x, PktId pkt) {`, (body) =>
      mustReplace(body, "    sendDown(packet);\n", `    sendDown(packet);\n    ${b.sent}++;\n`,
        `${PASS} (${broadcastMethodOf(tag)})`));
  cc = inMethod(cc, `void ${cls}::finish() {`, (body) =>
    body + "\n    if (stats) {\n"
    + leaves.map(([, b]) => `        recordScalar("${b.sent}", ${b.sent});\n`).join("")
    + "    }");

  // ⚠ Anchored on arpModule: the wrapper has an `@display("i=block/fork")` of
  // its own at the same indent, and only the simple module declares arpModule.
  const ned = mustReplace(t.ned, "        string arpModule;\n",
    "        string arpModule;\n        bool stats = default(true);\n", `${PASS} (.ned)`);
  return { h, cc, ned };
}

/**
 * Structure 4's shell, matched to the baseline (D16). The leaves timed are the
 * ones whose creating event the scheduler can fire, the table's first in its
 * order (MintRoute's), then any others as the model lists them.
 */
export function installBaselineShell(tree: GeneratedTree, cls: string, pm: PacketModel): GeneratedTree {
  const h = headerOf(tree), cc = implOf(tree), ned = nedOf(tree);
  if (!h || !cc || !ned) throw new Error(`${PASS}: the module is missing a .h, .cc or .ned.`);
  const scheduled = pm.leaves.filter((l) => cc.content.includes(`bool ${cls}::try_${l.event}()`))
    .map((l) => l.tag);
  if (scheduled.length === 0)
    throw new Error(`${PASS}: no packet type's creating event is scheduled, so there is nothing `
      + "for a timer to offer. Structure 4 needs a control split.");
  const inTable = Object.keys(MINTROUTE_LEAVES).filter((tag) => scheduled.includes(tag));
  const tags = [...inTable, ...scheduled.filter((tag) => !inTable.includes(tag))];

  const out = installCounters(installTimers({ h: h.content, cc: cc.content, ned: ned.content }, cls, tags),
    cls, tags);
  return tree.map((f) =>
    f === h ? { ...f, content: out.h } : f === cc ? { ...f, content: out.cc }
      : f === ned ? { ...f, content: out.ned } : f);
}

import type { GeneratedTree } from "./types";
import type { PacketModel } from "./packetModel";
import { broadcastMethodOf } from "./packetModel";
import { headerOf, implOf, nedOf, mustFind, mustReplace } from "./emitted";
import { capTag, lowerTag } from "./text";

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
   * The counter of this leaf's arrivals, incremented in `onReceive<Leaf>Pkt` and
   * recorded after `sent`. Only ROUTE has one in the baseline.
   */
  received?: string;
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
  // ++ :193, = 0 :63, declared .h:140; received ++ :245, = 0 :64, .h:141;
  // hooks :120-121; first fire :88-91
  ROUTE: { sent: "nbRouteFloodsSent", received: "nbRouteFloodsReceived", hooks: true, sinkFirst: true },
};

// The bundle's own events (pM5's Tier B, the same in every routing) that do a
// baseline function's job, emitted under the baseline's name (D16, user
// 2026-10-12, Q1 = a, Q2 = a), as send_down became sendSensorPacket for SensorApp.
// add_newEntry creates a neighbour's entry and zeroes its counters -- MintRoute's
// newEntry (:568) -- and the loop that finds a pending neighbour and runs it is
// MintRoute's findOrCreateEntry (:552). update_nbr is updateNbrCounters (:373).
// All three stay inside the delivery fixpoint: run once instead, they are the
// 2026-09-27 leak (247 of 1571 decoded frames lost).
export const MINTROUTE_EVENTS: Readonly<Record<string, { name: string; line: number; binder?: string }>> = {
  add_newEntry: { name: "newEntry", line: 568, binder: "findOrCreateEntry" },
  update_nbr: { name: "updateNbrCounters", line: 373 },
};

// The AODV split's own baseline is INET's AODV, src/inet/routing/aodv/Aodv.cc
// (the v4 AODV plan, design/V4_AODV_Plan.md, Q17 and Q19, user 2026-10-18). Only
// the RREQ path is named after it, the part the generated module runs: the AODV
// test code sends and handles RREPs and RRERs itself, so their generated
// methods keep the regular names. INET's AODV records no statistics and has no
// RREQ timer, so the table has no counters, hooks or first fires.
export interface LeafNames {
  /** The timer's no-argument target, `send<Leaf>Broadcast()` by default. */
  timer?: { name: string; line: number };
  /** The `(Node, PktId)` transmit, `send<Leaf>Broadcast` by default. */
  send?: { name: string; line: number };
  /** The arrival's handler, `onReceive<Leaf>Pkt` by default. */
  receive?: { name: string; line: number };
}
export const AODV_LEAVES: Readonly<Record<string, LeafNames>> = {
  RREQ: {
    timer: { name: "startRouteDiscovery", line: 249 },
    send: { name: "sendRREQ", line: 271 },
    receive: { name: "handleRREQ", line: 772 },
  },
};
// create_rreqPkt makes the RREQ, as createRREQ does (D16's rule: a model event
// doing a baseline function's job takes its name).
export const AODV_EVENTS: Readonly<Record<string, { name: string; line: number; binder?: string }>> = {
  create_rreqPkt: { name: "createRREQ", line: 374 },
};

// The DSR split's baseline is the Final Report's MiXiM DSRRoute, printed only
// in part (Fig 6.9-6.11, printed p.48-50; the v4 DSR plan Q4). It names
// sendRREQ() as what sends an RREQ (the text above Fig 6.9, p.48); it prints no
// name for the timer's job, the per-type reception (inline in handleLowerMsg's
// switch) or the RREQ's creation, so those keep their regular names. `line` is
// the printed page here. The RREP and RRER are the DSR test code's.
export const DSR_LEAVES: Readonly<Record<string, LeafNames>> = {
  RREQ: { send: { name: "sendRREQ", line: 48 } },
};

export type EventTable = { events: Readonly<Record<string, { name: string; line: number; binder?: string }>>;
  who: string; file: string };
const MINTROUTE_TABLE: EventTable = { events: MINTROUTE_EVENTS, who: "MintRoute", file: "MintRoute.cc" };
const AODV_TABLE: EventTable = { events: AODV_EVENTS, who: "INET AODV", file: "Aodv.cc" };

/**
 * The baseline names a shell gives: which leaf methods take a baseline's name,
 * how a renamed method cites it, and which event tables apply (their `who` and
 * `file` go into the provenance comment). A routing's profile (routing.ts)
 * chooses one; this module never reads the routing itself.
 */
export interface BaselineNames {
  leaves: Readonly<Record<string, LeafNames>>;
  cite: (line: number) => string;
  events: readonly EventTable[];
}

// Names keyed by leaf tag or event label: INET AODV's for RREQ's methods and
// create_rreqPkt, MintRoute's for the shared neighbour-table events. A split
// whose tags are not in a table (ROUTE and BEACON have no LeafNames entry)
// keeps its regular names, so the flooding and AODV routings share this, and so
// does a module whose routing was read off its shape.
export const TAG_NAMES: BaselineNames = {
  leaves: AODV_LEAVES,
  cite: (line: number) => `// INET AODV's name for it (Aodv.cc:${line}).\n`,
  events: [MINTROUTE_TABLE, AODV_TABLE],
};

// DSR's split has AODV's tags, so it needs its own: the Final Report's names
// for the RREQ, MintRoute's for the shared neighbour-table events (as AODV's
// does, the AODV plan Q23) and none of INET AODV's: `create_rreqPkt` stays.
export const DSR_NAMES: BaselineNames = {
  leaves: DSR_LEAVES,
  cite: (page: number) => `// The Final Report's name for it (printed p.${page}, the text above Fig 6.9).\n`,
  events: [MINTROUTE_TABLE],
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

const onReceiveOf = (tag: string) => `onReceive${capTag(tag)}Pkt`;

/**
 * D16 piece 3: the receive side (user, 2026-10-12, Q1 = a, Q2 = a).
 *
 * 1. The bundle's events in MINTROUTE_EVENTS take the baseline's names, with an
 *    `// Event-B: <label>` provenance line; the scheduler's `fired:<label>`
 *    counts keep the Event-B label. add_newEntry's binding loop, inline in
 *    runDeliveryEvents(), becomes the method `findOrCreateEntry()`.
 * 2. The arrival's last step -- run the delivery events, delete the packet --
 *    becomes MintRoute's dispatch on the packet type (MintRoute.cc:196-213): each
 *    timed leaf to `onReceive<Leaf>Pkt(packet, header)`, which runs the delivery
 *    events (where the model counts and floods it) and deletes the packet, and
 *    anything else as before. The table's `received` counter is incremented there.
 */
function installReceive(t: Texts, cls: string, tags: string[], tables: readonly EventTable[]): Texts {
  let { h, cc } = t;

  // ── 1. the events' baseline names ──
  for (const { events, who, file } of tables) for (const [label, ev] of Object.entries(events)) {
    if (!cc.includes(`bool ${cls}::${label}(`)) continue;
    cc = cc.replace(`bool ${cls}::${label}(`,
      `// Event-B: ${label} — emitted under ${who}'s name for it (${file}:${ev.line}).\n`
      + `bool ${cls}::${ev.name}(`);
    h = mustReplace(h, new RegExp(`^( *)bool ${label}\\(([^)]*)\\);$`, "m"),
      `$1bool ${ev.name}($2);   // Event-B: ${label}`, `${PASS} (.h ${label})`);
    // Calls only: not `::label(` (done above), not `"label"` (the fired count).
    cc = cc.replace(new RegExp(`(?<![\\w:"])${label}\\(`, "g"), `${ev.name}(`);
    h = h.replace(`// not scheduled: ${label} -- the reception runs it, inline in runDeliveryEvents()`,
      `// not scheduled: ${label} -- the reception runs it, as ${ev.name}`
      + (ev.binder ? `, through ${ev.binder}()` : "") + ", in runDeliveryEvents()");
    if (!ev.binder) continue;
    // The binding loop the scheduler emitted inline, lifted into its own method.
    const open = `        // ${label} -- run by the reception, not by the timer.\n        if ([&]() -> bool {\n`;
    const close = "        }()) _any = true;\n";
    const at = mustFind(cc, open, `${PASS} (${label} binding)`);
    const end = cc.indexOf(close, at);
    if (end < 0) throw new Error(`${PASS}: ${label}'s binding loop has no end.`);
    const inner = cc.slice(at + open.length, end).split("\n").filter((l) => l !== "")
      .map((l) => l.replace(/^ {8}/, "")).join("\n");
    cc = cc.slice(0, at) + `        // ${label} -- run by the reception, not by the timer.\n`
      + `        if (${ev.binder}()) _any = true;\n` + cc.slice(end + close.length);
    const def = `// Event-B: ${label} — emitted under ${who}'s name for it`;
    cc = cc.replace(def,
      `// The binding of ${label}: each pending neighbour pair, and ${ev.name} for the one\n`
      + `// not yet in the table. MintRoute's own ${ev.binder} finds an entry or creates it\n`
      + `// (MintRoute.cc:552).\nbool ${cls}::${ev.binder}() {\n${inner}\n}\n\n${def}`);
    h = mustReplace(h, new RegExp(`^( *)bool ${ev.name}\\(`, "m"),
      `$1bool ${ev.binder}();\n$1bool ${ev.name}(`, `${PASS} (.h ${ev.binder})`);
  }
  for (const label of tables.flatMap((t) => Object.keys(t.events)))
    if (new RegExp(`(?<!["\\w])${label}\\(`).test(cc))
      throw new Error(`${PASS}: ${label} is still called under its Event-B name after the rename.`);

  // ── 2. the dispatch ──
  const tail = "    runDeliveryEvents();\n    delete packet;";
  cc = inMethod(cc, `void ${cls}::handleLowerPacket(Packet *packet) {`, (body) => {
    if (!body.endsWith(tail))
      throw new Error(`${PASS}: the arrival no longer ends by running the delivery events.`);
    return body.slice(0, -tail.length)
      + "    switch (_wire->getType()) {\n"
      + tags.map((tag) => `        case PktType::${tag}:\n            ${onReceiveOf(tag)}(packet, _wire);\n`
        + "            break;\n").join("")
      + "        default:\n            runDeliveryEvents();\n            delete packet;\n            break;\n    }";
  });
  const arrival = mustFind(cc, `void ${cls}::handleLowerPacket(Packet *packet) {`, `${PASS} (arrival)`);
  const after = cc.indexOf("\n}\n", arrival) + 3;
  cc = cc.slice(0, after) + tags.map((tag) => {
    const received = MINTROUTE_LEAVES[tag]?.received;
    return `\n// What an arrival of a ${tag} runs, as MintRoute.cc:216-247 do for theirs: the\n`
      + "// delivery events, where the model counts the neighbour and floods the packet.\n"
      + `void ${cls}::${onReceiveOf(tag)}(Packet *packet, const Ptr<const PPkt>& header) {\n`
      + "    runDeliveryEvents();\n" + (received ? `    ${received}++;\n` : "")
      + "    delete packet;\n}\n";
  }).join("") + cc.slice(after);
  h = mustReplace(h, "    void handleLowerPacket(Packet *packet) override;\n",
    "    void handleLowerPacket(Packet *packet) override;\n"
    + tags.map((tag) => `    virtual void ${onReceiveOf(tag)}(Packet *packet, const Ptr<const PPkt>& header);\n`)
      .join(""), `${PASS} (.h onReceive)`);
  return { ...t, h, cc };
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
  // Every counter, in the order MintRoute's finish() records them (:618-620).
  const counters = leaves.flatMap(([, b]) => (b.received ? [b.sent, b.received] : [b.sent]));
  if (leaves.length === 0) return t;

  // Anchored after the parameters, so the timers above can replace theirs.
  let h = mustReplace(t.h, "    L3Address myNetwAddr;\n",
    "    bool stats = true;\n    L3Address myNetwAddr;\n", `${PASS} (.h parameters)`);
  h = mustReplace(h, "    long receivedCount = 0;\n",
    "    long receivedCount = 0;\n" + counters.map((c) => `    long ${c} = 0;\n`).join(""),
    `${PASS} (.h state)`);

  let cc = inMethod(t.cc, `void ${cls}::initialize(int stage) {`, (body) => {
    // Last of the parameter reads, as MintRoute.cc:48 has it.
    let b = mustReplace(body, "        sentCount = 0;\n",
      "        stats = par(\"stats\");\n        sentCount = 0;\n", `${PASS} (initialize, parameters)`);
    // Reset before the timers are made, as MintRoute.cc:62-63 do.
    b = mustReplace(b, "        WATCH(receivedCount);\n",
      "        WATCH(receivedCount);\n" + counters.map((c) => `        ${c} = 0;\n`).join(""),
      `${PASS} (initialize, counters)`);
    return b;
  });
  for (const [tag, b] of leaves)
    cc = inMethod(cc, `void ${cls}::${broadcastMethodOf(tag)}(Node x, PktId pkt) {`, (body) =>
      mustReplace(body, "    sendDown(packet);\n", `    sendDown(packet);\n    ${b.sent}++;\n`,
        `${PASS} (${broadcastMethodOf(tag)})`));
  cc = inMethod(cc, `void ${cls}::finish() {`, (body) =>
    body + "\n    if (stats) {\n"
    + counters.map((c) => `        recordScalar("${c}", ${c});\n`).join("")
    + "    }");

  // ⚠ Anchored on arpModule: the wrapper has an `@display("i=block/fork")` of
  // its own at the same indent, and only the simple module declares arpModule.
  const ned = mustReplace(t.ned, "        string arpModule;\n",
    "        string arpModule;\n        bool stats = default(true);\n", `${PASS} (.ned)`);
  return { h, cc, ned };
}

/**
 * The packet types' methods under the baseline's names where the table gives
 * them (`names.leaves`: AODV_LEAVES in TAG_NAMES, the v4 AODV plan Q19;
 * DSR_LEAVES in DSR_NAMES, the v4 DSR plan Q4). Last, so every pass above has written what it renames:
 * the declarations, the definitions (each with a provenance line), the timer's
 * call, the transmit dispatch's case and the arrival's case. Loud if an anchor
 * is missing or an old name survives.
 */
// Exported for its own test: no generated module leaves an old name behind, so
// only a crafted one can show the survival check works.
export function installLeafNames(t: Texts, cls: string, tags: string[],
  names: BaselineNames): Texts {
  let { h, cc } = t;
  const { leaves, cite } = names;
  for (const tag of tags) {
    const leaf = leaves[tag];
    if (!leaf) continue;
    const send = broadcastMethodOf(tag), rec = onReceiveOf(tag);
    const where = (what: string) => `${PASS} (${tag} ${what})`;
    if (leaf.timer) {
      const n = leaf.timer.name;
      h = mustReplace(h, `    virtual void ${send}();\n`, `    virtual void ${n}();\n`, where("timer, .h"));
      cc = mustReplace(cc,
        `// put it on the air through the overload below.\nvoid ${cls}::${send}() {`,
        `// put it on the air through ${leaf.send?.name ?? "the overload"} below.\n`
        + `${cite(leaf.timer.line)}void ${cls}::${n}() {`, where("timer, definition"));
      cc = mustReplace(cc, `        ${send}();\n`, `        ${n}();\n`, where("timer, call"));
    }
    if (leaf.send) {
      const n = leaf.send.name;
      h = mustReplace(h, `    virtual void ${send}(Node x, PktId pkt);\n`,
        `    virtual void ${n}(Node x, PktId pkt);\n`, where("send, .h"));
      cc = mustReplace(cc, `void ${cls}::${send}(Node x, PktId pkt) {`,
        `${cite(leaf.send.line)}void ${cls}::${n}(Node x, PktId pkt) {`, where("send, definition"));
      cc = mustReplace(cc, `case PktType::${tag}: ${send}(x, pkt); break;`,
        `case PktType::${tag}: ${n}(x, pkt); break;`, where("send, dispatch"));
      // The timer's target keeps its name when only the transmit is renamed
      // (DSR); its comment names the overload it calls, which has a new name.
      if (!leaf.timer)
        cc = mustReplace(cc, `// put it on the air through the overload below.\nvoid ${cls}::${send}() {`,
          `// put it on the air through ${n} below.\nvoid ${cls}::${send}() {`, where("send, timer comment"));
    }
    if (leaf.receive) {
      const n = leaf.receive.name;
      h = mustReplace(h, `    virtual void ${rec}(Packet *packet, const Ptr<const PPkt>& header);\n`,
        `    virtual void ${n}(Packet *packet, const Ptr<const PPkt>& header);\n`, where("receive, .h"));
      cc = mustReplace(cc, `void ${cls}::${rec}(Packet *packet, const Ptr<const PPkt>& header) {`,
        `${cite(leaf.receive.line)}void ${cls}::${n}(Packet *packet, const Ptr<const PPkt>& header) {`,
        where("receive, definition"));
      cc = mustReplace(cc, `            ${rec}(packet, _wire);\n`, `            ${n}(packet, _wire);\n`,
        where("receive, dispatch"));
    }
    // The timer's target and the transmit share one name, `send<Leaf>Broadcast`,
    // as two overloads. Renamed together (AODV), no use of the name may survive;
    // renamed alone (DSR renames only the transmit), only that overload's.
    const gone: { what: string; re: RegExp }[] = [];
    if (leaf.timer && leaf.send) gone.push({ what: send, re: new RegExp(`\\b${send}\\b`) });
    else {
      if (leaf.timer) gone.push({ what: `${send}()`, re: new RegExp(`\\b${send}\\(\\)`) });
      // Any non-empty argument list: a use that kept the old name under other
      // argument names survives as surely as `(x, pkt)` does.
      if (leaf.send)
        gone.push({ what: `${send}(Node, PktId)`, re: new RegExp(`\\b${send}\\(\\s*[^)\\s]`) });
    }
    if (leaf.receive) gone.push({ what: rec, re: new RegExp(`\\b${rec}\\b`) });
    for (const { what, re } of gone)
      if (re.test(h + cc))
        throw new Error(`${PASS}: ${what} survives after ${tag}'s methods took the baseline's names.`);
  }
  return { ...t, h, cc };
}

/**
 * Structure 4's shell, matched to the baseline (D16). The leaves timed are the
 * ones whose creating event the scheduler can fire, the table's first in its
 * order (MintRoute's), then any others as the model lists them.
 */
export function installBaselineShell(tree: GeneratedTree, cls: string, pm: PacketModel,
  names: BaselineNames): GeneratedTree {
  const h = headerOf(tree), cc = implOf(tree), ned = nedOf(tree);
  if (!h || !cc || !ned) throw new Error(`${PASS}: the module is missing a .h, .cc or .ned.`);
  const scheduled = pm.leaves.filter((l) => cc.content.includes(`bool ${cls}::try_${l.event}()`))
    .map((l) => l.tag);
  if (scheduled.length === 0)
    throw new Error(`${PASS}: no packet type's creating event is scheduled, so there is nothing `
      + "for a timer to offer. Structure 4 needs a control split.");
  const inTable = Object.keys(MINTROUTE_LEAVES).filter((tag) => scheduled.includes(tag));
  const tags = [...inTable, ...scheduled.filter((tag) => !inTable.includes(tag))];

  // Timers, then the receive side, then the counters, which declare, reset and
  // record what the two before them increment; then the baseline's names for
  // the methods those passes wrote.
  const timed = installTimers({ h: h.content, cc: cc.content, ned: ned.content }, cls, tags);
  const out = installLeafNames(
    installCounters(installReceive(timed, cls, tags, names.events), cls, tags), cls, tags, names);
  return tree.map((f) =>
    f === h ? { ...f, content: out.h } : f === cc ? { ...f, content: out.cc }
      : f === ned ? { ...f, content: out.ned } : f);
}

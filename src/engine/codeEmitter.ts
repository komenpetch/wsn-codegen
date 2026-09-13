import { INITIALISATION } from "./types";
import type { EncodedMachine, EncodingForm, GeneratedTree, RawContext } from "./types";
import { translateEvent } from "./ruleEngine";

// Map an Event-B carrier token to its C++ alias (defined in eb_context.h).
const ALIAS: Record<string, string> = { ND: "Node", PKT: "PktId", Dests: "Node", "ℤ": "Data", BOOL: "bool" };
const alias = (token: string): string => ALIAS[token] ?? "int";

// A context can NAME a type: RTMCS C3 declares `WSN = ND ↔ ND`, then types a
// constant and an event parameter with the bare name (`wsnTopology ∈ WSN`,
// `l ∈ WSN`). Neither the constant emitter nor the parameter typer looked
// through such a name, so both fell back to `int`: `wsnTopology` was never
// declared at all, and `set_link`'s guard came out as `l == wsnTopology`
// comparing an int to nothing. Collecting the definitions lets both resolve it.
//
// Only TYPE-valued equations qualify. `CTL_VAL = 0` and `BROADCAST = −1` are
// value equations and must keep flowing to the scalar-constant path.
export type TypeAliases = Map<string, string>;
function typeAliases(contexts: RawContext[]): TypeAliases {
  const out: TypeAliases = new Map();
  for (const c of contexts)
    for (const a of c.axioms) {
      const m = /^\s*(\w+)\s*=\s*(.+?)\s*$/.exec(a.text);
      if (m && /[↔→⇸]|ℙ\(/.test(m[2])) out.set(m[1], m[2]);
    }
  return out;
}

// The C++ container for an Event-B type expression. A relation is a SET OF
// PAIRS, not a map: `A ↔ B` may relate one `a` to several `b`, which a
// std::map cannot hold. It also gives the emitted code a working `==`, which
// is what `l = wsnTopology` needs.
function containerFor(expr: string): string | undefined {
  const rel = /^\s*(\w+)\s*(↔|→|⇸)\s*(\w+)\s*$/.exec(expr);
  if (rel)
    return rel[2] === "↔"
      ? `std::set<std::pair<${alias(rel[1])}, ${alias(rel[3])}>>`
      : `std::map<${alias(rel[1])}, ${alias(rel[3])}>`;
  const pow = /^\s*ℙ\(\s*(.+?)\s*\)\s*$/.exec(expr);
  if (pow) return `std::set<${elementType(pow[1])}>`;
  return undefined;
}

// The C++ element type of a set. A Cartesian product is a set of PAIRS:
// MintRoute M5's `report_routeCompletion` takes `r ∈ ℙ(ℤ × ℤ)`, and reading
// only the first token gave `std::set<Data>` -- a set of scalars where the
// model means a set of pairs, so the emitted `r == cRouteTree` compared the
// wrong shape. Anything that is not a product keeps the previous behaviour.
function elementType(expr: string): string {
  const prod = /^\s*(\w+|ℤ)\s*×\s*(\w+|ℤ)\s*$/.exec(expr);
  if (prod) return `std::pair<${alias(prod[1])}, ${alias(prod[2])}>`;
  const one = /^\s*(\w+|ℤ)\s*$/.exec(expr);
  return one ? alias(one[1]) : "int";
}

// Pull domain/range carrier tokens out of an invariant, unwrapping ℙ(…).
function domRan(inv: string | undefined): { dom?: string; ran?: string } {
  if (!inv) return {};
  const rhs = inv.replace(/^[^∈⊆]*[∈⊆]\s*/, "").trim();
  const m = /(.+?)\s*(↔|→|⇸)\s*(.+)/.exec(rhs);
  if (m) {
    const dTok = (m[1].match(/\w+|ℤ/g) ?? []).pop()!;          // last word of domain
    const rRaw = m[3].replace(/ℙ\(|\)/g, "").trim();           // unwrap ℙ(…)
    const rTok = (rRaw.match(/\w+|ℤ/g) ?? [])[0]!;
    return { dom: alias(dTok), ran: alias(rTok) };
  }
  const sub = /ℙ\((\w+|ℤ)\)|⊆\s*(\w+)/.exec(inv);              // plain set / ℙ(T)
  if (sub) return { ran: alias(sub[1] ?? sub[2]) };
  return {};
}

function cppType(form: EncodingForm, inv: string | undefined): string {
  const { dom = "int", ran = "int" } = domRan(inv);
  switch (form) {
    case "set": return `std::set<${ran}>`;
    case "function": return `std::map<${dom}, ${ran}>`;
    case "pair-set": return `std::set<std::pair<${dom}, ${ran}>>`;
    case "map-of-sets": return `std::map<${dom}, std::set<${ran}>>`;
    case "bool": return "bool";
    default: return "int";
  }
}

// Parameter list, typed from the event's typing guards (then those guards drop).
function params(
  ev: { parameters: string[]; guards: string[] },
  aliases: TypeAliases = new Map(),
): string {
  const typeOf = (p: string): string => {
    for (const g of ev.guards) {
      // Set-typed param: `p ∈ ℙ(T)` or the set-builder `p ∈ {n∣ … ℙ(T) …}`.
      // Capture the WHOLE element type, not just its first token, so a set over
      // a Cartesian product (`ℙ(ℤ × ℤ)`) comes out as a set of pairs rather
      // than a set of scalars. `[^)]*` stops at the closing paren, so a single
      // token still resolves exactly as before.
      const setM = new RegExp(`\\b${p}\\s*∈\\s*(?:ℙ\\(|\\{[^}]*ℙ\\()\\s*([^)]*)\\)`).exec(g);
      if (setM) return `const std::set<${elementType(setM[1])}>&`;
      const m = new RegExp(`\\b${p}\\s*∈\\s*(\\w+|ℤ)`).exec(g);
      if (m) {
        // A context-named type (`l ∈ WSN` with `WSN = ND ↔ ND`) is a container,
        // taken by const reference like any other; without this it aliased to
        // a bare `int` and the emitted comparison would not compile.
        const named = aliases.get(m[1]);
        const container = named ? containerFor(named) : undefined;
        if (container) return `const ${container}&`;
        return alias(m[1]);
      }
    }
    return "int";
  };
  return ev.parameters.map((p) => `${typeOf(p)} ${p}`).join(", ");
}

// SensorApp packet-flow structures, merged into the CommPattern pair when the
// model has one. Thesis S4/S5 direction (phdThesis_Adisak, docs/06): send_down
// = transmit down to the channel → SensorApp::sendSensorPacket; send_up =
// channel delivers up to the receiving node → SensorApp's receive path.
const TRANSMIT_BLOCK = [
  "    // — SensorApp transmit structure (SensorApp::sendSensorPacket) —",
  "    if (socket == nullptr || sinkAddress.isUnspecified()) {",
  '        EV_WARN << "socket/sinkAddress not ready, skipping send\\n";',
  "        return false;",
  "    }",
  "    char pktName[32];",
  '    snprintf(pktName, sizeof(pktName), "sensor-%ld", sendSeqNo);',
  "    Packet *packet = new Packet(pktName);",
  "    auto payload = makeShared<ByteCountChunk>(B(payloadLength));",
  "    packet->insertAtBack(payload);",
  "    packet->addTag<PacketProtocolTag>()->setProtocol(&Protocol::manet);",
  "    packet->addTag<L3AddressReq>()->setDestAddress(sinkAddress);",
  "    emit(packetSentSignal, packet);",
  "    socket->send(packet);",
  "    sendSeqNo++;",
  "    sentCount++;",
];
const RECEIVE_BLOCK = [
  "    // — SensorApp receive structure (accounting; the packet object itself",
  "    //   is handled in socketDataArrived, which calls this event) —",
  "    receivedCount++;",
];

// ── Inlined Event-B context + helpers (structures 2 and 3 only) ─────────
// Structure 1 `#include "eb_context.h"` / `"eb_helpers.h"`, two fixtures the
// CLI copies next to the output. The web build never shipped them, so a
// downloaded structure-1 module could not compile. Structures 2 and 3 inline
// their content into the generated header, making the tool's output exactly
// the three contracted files (.h/.cc/.ned) and self-contained on every path.
//
// Values are derived from the project's own contexts wherever an axiom fixes
// one (`BROADCAST = −1`, `CTL_VAL = 0`, `partition(TYPE, CONTROL, {DATA})`).
// Where the axioms state only properties — `ND ⊆ ℕ` names no elements — the
// symbol is declared and left for the simulation harness to populate. Defaults
// cover the standard WSN constants when a project ships a partial context.
function contextBlock(contexts: RawContext[]): string {
  const aliases = typeAliases(contexts);
  const axioms = contexts.flatMap((c) => c.axioms.map((a) => ({ ctx: c.name, ...a })));
  const constants = new Set(contexts.flatMap((c) => c.constants));
  const fixed = new Map<string, string>();     // concrete values from axioms
  const opaque = new Map<string, string>();    // declared, harness-populated
  const note = (a: { ctx: string; label: string; text: string }): string =>
    `  // ${a.ctx} ${a.label}: ${a.text}`;

  // partition(TYPE, CONTROL, {DATA}) fixes the two packet-kind tags: DATA is a
  // single element and CONTROL the disjoint remainder — encode 0 and {1}.
  for (const a of axioms) {
    const p = /partition\(\s*\w+\s*,\s*(\w+)\s*,\s*\{\s*(\w+)\s*\}\s*\)/.exec(a.text);
    if (!p) continue;
    fixed.set(p[2], `inline const int ${p[2]} = 0;${note(a)}`);
    fixed.set(p[1], `inline std::set<int> ${p[1]} = {1};${note(a)}`);
  }
  // A bare `NAME = <int>` axiom pins a scalar (Rodin writes minus as U+2212).
  for (const a of axioms) {
    const m = /^\s*(\w+)\s*=\s*(−|-)?\s*(\d+)\s*$/.exec(a.text);
    if (m && !fixed.has(m[1]))
      fixed.set(m[1], `inline const int ${m[1]} = ${m[2] ? "-" : ""}${m[3]};${note(a)}`);
  }
  // Typed-but-unpopulated constants: functions become maps, subsets become sets.
  for (const a of axioms) {
    const f = /^\s*(\w+)\s*∈\s*(.+?)\s*(?:→|⇸|↔)\s*(.+?)\s*$/.exec(a.text);
    if (f && constants.has(f[1]) && !fixed.has(f[1])) {
      const dTok = (f[2].match(/\w+|ℤ/g) ?? []).pop()!;
      const rTok = (f[3].replace(/[ℙ(){}∪]/g, " ").match(/\w+|ℤ/g) ?? [])[0]!;
      opaque.set(f[1], `inline std::map<${alias(dTok)}, ${alias(rTok)}> ${f[1]};${note(a)}`);
      continue;
    }
    const s = /^\s*(\w+)\s*⊆\s*(.+?)\s*$/.exec(a.text);
    if (s && constants.has(s[1]) && !fixed.has(s[1])) {
      opaque.set(s[1], `inline std::set<int> ${s[1]};${note(a)}`);
      continue;
    }
    // `NAME ∈ ℕ1 | ℕ | ℤ` — a SCALAR constant whose axiom gives only its type.
    // Same failure as the branch below and found the same way: MintRoute's
    // `LIVELINESS ∈ ℕ1` (C3 axm303) matched nothing here, so the module
    // referenced an identifier it never declared — invisible until the clauses
    // using it finally translated, and then three compile errors.
    //
    // The value is the SMALLEST the axiom permits (ℕ1 → 1, ℕ/ℤ → 0), which is
    // read off the axiom rather than invented; a harness that means something
    // else overrides it. Emitted among the declared-only constants because that
    // is exactly what it is: the axiom gives a property, not a value.
    const sc = /^\s*(\w+)\s*∈\s*(ℕ1|ℕ|ℤ)\s*$/.exec(a.text);
    if (sc && constants.has(sc[1]) && !fixed.has(sc[1]) && !opaque.has(sc[1])) {
      opaque.set(sc[1], `inline int ${sc[1]} = ${sc[2] === "ℕ1" ? 1 : 0};`
        + `${note(a)} — a property, not a value; harness may override`);
    }
    // `NAME ∈ <a type this context named>` — e.g. RTMCS's `wsnTopology ∈ WSN`
    // with `WSN = ND ↔ ND`. Without this the constant matched no branch above
    // and was emitted nowhere, so the generated module referenced an
    // identifier it never declared.
    const n = /^\s*(\w+)\s*∈\s*(\w+)\s*$/.exec(a.text);
    if (n && constants.has(n[1]) && !fixed.has(n[1]) && !opaque.has(n[1])) {
      const container = containerFor(aliases.get(n[2]) ?? "");
      if (container) opaque.set(n[1], `inline ${container} ${n[1]};${note(a)}`);
    }
  }

  // Fall back for anything a partial context leaves undefined, so the emitted
  // code still compiles (the shdecom fixture ships only the TYPE context).
  const fallbackFixed: [string, string][] = [
    ["DATA", "inline const int DATA = 0;  // no partition axiom found — default tag"],
    ["CONTROL", "inline std::set<int> CONTROL = {1};  // no partition axiom found — default tag"],
    ["CTL_VAL", "inline const int CTL_VAL = 0;  // no axiom found — default"],
  ];
  const fallbackOpaque: [string, string][] = [
    ["ND", "inline std::set<int> ND;  // not in the supplied context — harness-populated"],
    ["Dests", "inline std::set<int> Dests;  // not in the supplied context — harness-populated"],
    ["initialSrcAddr", "inline std::map<PktId, Node> initialSrcAddr;  // not in the supplied context"],
    ["finalDestAddr", "inline std::map<PktId, Node> finalDestAddr;  // not in the supplied context"],
    ["type", "inline std::map<PktId, int> type;  // not in the supplied context"],
  ];
  for (const [k, v] of fallbackFixed) if (!fixed.has(k)) fixed.set(k, v);
  for (const [k, v] of fallbackOpaque) if (!opaque.has(k) && !fixed.has(k)) opaque.set(k, v);

  const from = contexts.length ? contexts.map((c) => c.name).join(", ") : "no context files supplied";
  return `// ── Event-B context (derived from ${from}) ──
// Inlined so the generated module is self-contained: the tool's output is
// exactly ${"`"}.h/.cc/.ned${"`"}. Two generated modules with DIFFERENT contexts must not
// be linked into one executable — these are inline definitions at namespace
// scope and would collide.
using Node  = int;   // element label of the node carrier
using PktId = int;   // element label of the packet carrier
using Data  = int;   // ℤ payload values
inline constexpr bool FALSE = false, TRUE = true;

// Values an axiom pins:
${[...fixed.values()].join("\n")}

// ⚠ Declared only — the axioms give properties, not elements. The simulation
// harness must populate these before any generated event method runs, or
// ${"`"}.at()${"`"} throws std::out_of_range.
${[...opaque.values()].join("\n")}

// Pair-set domain/range membership (a relation keeps no separate key index).
template<class R> bool inDom(const R& r, Node x) {
  return std::any_of(r.begin(), r.end(), [&](const auto& p){ return p.first == x; });
}
template<class R> bool inRan(const R& r, PktId y) {
  return std::any_of(r.begin(), r.end(), [&](const auto& p){ return p.second == y; });
}`;
}

// Emitted-structure version, kept selectable for the project report's
// compare table: 1 = the original pre-SensorApp structure (RoutingProtocolBase
// + empty stubs, pattern pair untouched); 2 = v1 with ONLY the CommPattern
// pair changed to the merged SensorApp functions (plus the minimal members
// The emitted module STRUCTURES, numbered as the paper numbers them.
//
//   1 = the SensorApp shell, with the shell's transmit call left behind an
//       extension point and the Event-B context in shipped fixture headers;
//   2 = 1 brought to SensorApp behavioural parity -- the transmit is bound and
//       the context is inlined, so the output is genuinely three self-contained
//       files;
//   3 = 2's shell carrying the packet pattern class PPkt from another project.
//
// ⚠ The shell of 3 is IDENTICAL to 2's, so everything below treats 3 exactly as
// 2; what makes it 3 is spliced in afterwards by the pipeline (see
// emitWithPacketClasses). 1 and 2 are FROZEN -- they are the paper's
// compare-table evidence (paper V1 and V2).
//
// ⚠ Renumbered 2026-09-13 to match the paper. The two earliest structures (the
// original RoutingProtocolBase shell, and that shell with only the CommPattern
// pair merged) were DROPPED: neither is cited anywhere in paper2, and carrying
// them forced two dead branches through this emitter. Old 3/4/5 are now 1/2/3.
export type EmitVersion = 1 | 2 | 3;

export function emit(
  model: EncodedMachine,
  name: string,
  version: EmitVersion = 2,
  contexts: RawContext[] = [],
): GeneratedTree {
  // Types the contexts NAME (`WSN = ND ↔ ND`), so a parameter declared with the
  // bare name resolves to its container rather than falling back to `int`.
  const aliases = typeAliases(contexts);
  const fields = [...model.encodings.entries()]
    .map(([id, form]) => `    ${cppType(form, model.variableTypes.get(id))} ${id};`).join("\n");

  const hasSendDown = model.events.some((e) => e.label === "send_down");
  const hasSendUp = model.events.some((e) => e.label === "send_up");
  // Structure 2 = structure 1's shell plus baseline behavioural parity.
  // Structure 3 shares it, which is why this is `>= 2` and not `=== 2`.
  const parity = version >= 2;

  // Event names that collide with a base-class method. A generated
  // `bool receive(Node, PktId)` HIDES omnetpp::cSimpleModule::receive() and its
  // timeout overload (-Woverloaded-virtual). That is harmless while dispatch is
  // handleMessage-style, but it is a real trap: an event named `send` would hide
  // the message-sending API the shell itself relies on. A using-declaration
  // restores the base overloads while keeping the Event-B name.
  const BASE_METHODS = new Set([
    "receive", "send", "sendDelayed", "sendDirect",
    "scheduleAt", "scheduleAfter", "cancelEvent", "cancelAndDelete", "wait",
  ]);
  const hidesBase = new Set<string>();

  const decls: string[] = [];
  const defs: string[] = [];
  for (const raw of model.events) {
    if (raw.label === "INITIALISATION") continue;
    const t = translateEvent(raw, model);
    // The CommPattern pair is emitted under its SensorApp name (thesis S4/S5);
    // the Event-B label is kept as provenance so the model stays traceable.
    const inetName = raw.label === "send_down" ? "sendSensorPacket"
      : raw.label === "send_up" ? "socketDataArrived"
      : undefined;
    const cppName = inetName ?? t.label;
    if (BASE_METHODS.has(cppName)) hidesBase.add(cppName);
    decls.push(
      inetName
        ? `    bool ${cppName}(${params(raw, aliases)});   // Event-B: ${raw.label}`
        : `    bool ${cppName}(${params(raw, aliases)});`,
    );
    const prov = inetName
      ? `// Event-B: ${raw.label} — emitted under its SensorApp name (thesis ${raw.label === "send_down" ? "S4, transmit" : "S5, receive"}).\n`
      : "";
    // Untranslated clauses stay visible: omitting a guard silently weakens
    // the precondition, omitting an action silently weakens the effect.
    const noteG = t.untranslatedGuards.map((g) => `    // UNTRANSLATED GUARD: ${g}`);
    const noteA = t.untranslatedActions.map((a) => `    // UNTRANSLATED ACTION: ${a}`);
    const inject = raw.label === "send_down" ? TRANSMIT_BLOCK
      : raw.label === "send_up" ? RECEIVE_BLOCK
      : [];
    // A partially translated event must NOT report success. Returning true with an
    // unmatched guard claims the event fired on a precondition never checked; with an
    // unmatched action it claims a state change that never happened. Either is a
    // SILENT fault of exactly the kind this project's V3 defect was — invisible to the
    // compiler and to the simulator, and detectable only by comparing behaviour. The
    // UNTRANSLATED comments make the gap visible to a reader of the code; this makes it
    // visible to the program. The event stays emitted (so the module still compiles and
    // the shape of the model is still there to read), it simply refuses to claim it ran.
    const incomplete = noteG.length > 0 || noteA.length > 0;
    const refuse = incomplete
      ? [
          // NB: this comment must NOT contain the token the markers use. The rule gap is
          // measured by counting occurrences of that token in the emitted module
          // (wsn-codegen/scripts/benchmark.ts), so mentioning it here would inflate the
          // reported gap by one per incomplete event and corrupt the published figure.
          "    // Refuses to fire: this event has clauses the rule catalog does not cover",
          "    // (see the markers above). Returning true would report a transition that did",
          "    // not fully happen. Remove this once those clauses translate.",
          "    return false;",
        ]
      : ["    return true;"];

    if (inject.length === 0 && t.actions.length === 0 && noteA.length === 0) {
      const pred = t.guards.length ? t.guards.join(" && ") : "true";
      const body = incomplete
        ? [...noteG, ...refuse].join("\n")
        : [...noteG, `    return ${pred};`].join("\n");
      defs.push(`${prov}bool ${name}::${cppName}(${params(raw, aliases)}) {\n${body}\n}`);
    } else {
      // An incomplete event refuses BEFORE its actions, not after them.
      //
      // The refusal used to be appended at the end, so a partially translated
      // event ran every action it could translate and then reported that it had
      // not fired. That is worse than either honest outcome: the model's state
      // changed, and nothing above the event believed it had. MintRoute's
      // finish_tx_pkt showed both halves of the damage in one run -- it erased
      // from WiMedium and sentUp, returned false, and its caller (which was
      // iterating WiMedium to find candidates) went on using an iterator the
      // erase had invalidated. That is an access violation, not a wrong answer,
      // and it only appeared once the medium binding made deliveries happen.
      //
      // The actions stay in the emitted text, commented, so the shape of the
      // event is still readable next to the markers that say why it cannot run.
      const body = (incomplete
        ? [
            ...t.guards.map((g) => `    if (!(${g}))\n        return false;`),
            ...noteG,
            ...noteA,
            ...refuse,
            ...(inject.length + t.actions.length > 0
              ? ["    // The actions this event would perform, for reference only:",
                 ...inject.map((a) => `    // ${a.trim()}`),
                 ...t.actions.map((a) => `    // ${a}`)]
              : []),
          ]
        : [
            // Each guard early-return on its own indented line for readability.
            ...t.guards.map((g) => `    if (!(${g}))\n        return false;`),
            ...noteG,
            ...inject,
            ...t.actions.map((a) => `    ${a}`),
            ...noteA,
            ...refuse,
          ]).join("\n");
      defs.push(`${prov}bool ${name}::${cppName}(${params(raw, aliases)}) {\n${body}\n}`);
    }
  }

  const init = model.events.find((e) => e.label === INITIALISATION);
  const tInit = init ? translateEvent(init, model) : undefined;
  const ctorBody = tInit
    ? [
        ...tInit.actions.map((a) => `    ${a}`),
        ...tInit.untranslatedActions.map((a) => `    // UNTRANSLATED ACTION: ${a}`),
      ].join("\n")
    : "";

  // One neutral provenance banner shared by all three emitted files. It names
  // the actual input — the whole merged chain when there is one, a single
  // machine otherwise — so nothing in the comment is tied to any fixed model.
  const provenance = model.chain.length > 1
    ? `the Event-B refinement chain ${model.chain.join(" → ")} (merged into one module)`
    : `the Event-B machine ${model.name}`;
  const banner = `Generated by wsn-codegen from ${provenance}.
Do not edit by hand — regenerate instead.`;
  const cxxBanner = banner.split("\n").map((l) => `// ${l}`).join("\n");

  // ⚠ The two earliest emitted structures were REMOVED here on 2026-09-13 when
  // the versions were renumbered to match the paper. They were the original
  // RoutingProtocolBase shell and that shell with only the CommPattern pair
  // merged -- neither is cited anywhere in paper2, and keeping them forced a
  // second header/source/NED emission path through this whole function.

  // ── v3 output (default): the full SensorApp shell ──
  const header = `${cxxBanner}
#pragma once
${parity ? "#include <algorithm>\n" : ""}#include <map>
#include <set>
#include <utility>
${parity ? "" : `#include "eb_helpers.h"
#include "eb_context.h"
`}#include "inet/applications/base/ApplicationBase.h"
#include "inet/common/Protocol.h"
#include "inet/common/lifecycle/LifecycleOperation.h"
${parity ? `#include "inet/common/lifecycle/NodeStatus.h"\n` : ""}#include "inet/common/packet/Packet.h"
#include "inet/networklayer/common/L3Address.h"
#include "inet/networklayer/contract/INetworkSocket.h"

using namespace inet;
${parity ? `\n${contextBlock(contexts)}\n` : ""}
// Module shell modelled on INET's SensorApp (inet/applications/sensorapp).
// The model's CommPattern pair is emitted under SensorApp's names (thesis
// S4/S5): Event-B send_down → sendSensorPacket(...) carrying the transmit
// structure, Event-B send_up → a socketDataArrived(...) model overload
// carrying the receive accounting; every other event keeps its Event-B name
// and pure translation-rules body. A model without the pair gets SensorApp's
// own sendSensorPacket() instead. Binding the model identities (which
// node/packet a simulation message is) happens at the marked extension points
// in handleMessageWhenUp() and the socket-callback socketDataArrived().
class ${name} : public ApplicationBase, public INetworkSocket::ICallback {
  protected:
    // ── Event-B machine state ──
${fields}

    // ── SensorApp shell: parameters (read in initialize / openSocket) ──
    L3Address sinkAddress;
    cPar *sensingIntervalPar = nullptr;
    int payloadLength = 0;
    simtime_t startTime;
    simtime_t stopTime;

    // ── SensorApp shell: state ──
    INetworkSocket *socket = nullptr;
    cMessage *timer = nullptr;
${parity ? "    NodeStatus *nodeStatus = nullptr;\n" : ""}    long sendSeqNo = 0;
    long sentCount = 0;
    long receivedCount = 0;

    // ── statistics ──
    static simsignal_t packetSentSignal;
    static simsignal_t packetReceivedSignal;

  protected:
    void initialize(int stage) override;
    int numInitStages() const override { return NUM_INIT_STAGES; }
    void handleMessageWhenUp(cMessage *msg) override;
    void finish() override;
    void refreshDisplay() const override;

    // SensorApp shell helpers${hasSendDown && !parity ? " (the transmit structure lives in sendSensorPacket(x, pkt) below — Event-B: send_down)" : ""}
    virtual void openSocket();
${hasSendDown && parity
    ? `    // Baseline SensorApp transmit, driven by the sensing timer. Overloads the
    // model's bool sendSensorPacket(Node, PktId) below (Event-B: send_down),
    // which stays for the network-layer phase: its guard chain needs the model
    // identities bound and the context populated before it can fire.
    virtual void sendSensorPacket();\n`
    : hasSendDown ? "" : "    virtual void sendSensorPacket();\n"}    virtual void scheduleNextSensing(simtime_t previous);
    virtual void cancelNextSensing();
    virtual bool isEnabled();

    // ApplicationBase lifecycle
    void handleStartOperation(LifecycleOperation *operation) override;
    void handleStopOperation(LifecycleOperation *operation) override;
    void handleCrashOperation(LifecycleOperation *operation) override;

    // INetworkSocket::ICallback
    void socketDataArrived(INetworkSocket *socket, Packet *packet) override;
    void socketClosed(INetworkSocket *socket) override;

${parity && hidesBase.size ? `    // These Event-B event names also name a base-class method. Keep the model's
    // name, but re-expose the base overloads so they are not hidden
    // (-Woverloaded-virtual); overload resolution still picks the right one.
${[...hidesBase].map((n) => `    using omnetpp::cSimpleModule::${n};`).join("\n")}

` : ""}    // Event-B events, one guarded bool method each: the guards are checked
    // first (early return), then the actions run.
${decls.join("\n")}

  public:
    ${name}();
    virtual ~${name}();
};
`;

  const source = `${cxxBanner}
#include "${name}.h"

#include "inet/common/ModuleAccess.h"
#include "inet/common/Protocol.h"
#include "inet/common/ProtocolTag_m.h"
#include "inet/common/lifecycle/ModuleOperations.h"
#include "inet/common/packet/chunk/ByteCountChunk.h"
#include "inet/networklayer/common/L3AddressResolver.h"
#include "inet/networklayer/common/L3AddressTag_m.h"
#include "inet/networklayer/contract/L3Socket.h"
${parity ? `#include "inet/networklayer/contract/ipv4/Ipv4Socket.h"
#include "inet/networklayer/contract/ipv6/Ipv6Socket.h"
` : ""}
Define_Module(${name});

simsignal_t ${name}::packetSentSignal = registerSignal("packetSent");
simsignal_t ${name}::packetReceivedSignal = registerSignal("packetReceived");

// Event-B INITIALISATION.
${name}::${name}() {
${ctorBody}
}

${name}::~${name}() {
    cancelAndDelete(timer);
    delete socket;
}

void ${name}::initialize(int stage) {
    ApplicationBase::initialize(stage);
    if (stage == INITSTAGE_LOCAL) {
        sensingIntervalPar = &par("sensingInterval");
        payloadLength = par("payloadLength");
        startTime = par("startTime");
        stopTime = par("stopTime");
        if (stopTime >= SIMTIME_ZERO && stopTime < startTime)
            throw cRuntimeError("Invalid startTime/stopTime parameters");
${parity ? `
        sendSeqNo = sentCount = receivedCount = 0;
        WATCH(sendSeqNo);
        WATCH(sentCount);
        WATCH(receivedCount);
` : ""}        timer = new cMessage("sensingTimer");
    }
}

bool ${name}::isEnabled() {
    // the module emits packets only when a destination is configured
    return par("sinkAddress").stringValue()[0] != '\\0';
}

void ${name}::openSocket() {
    // Resolve the sink lazily (it may stay empty on a passive sink-side node).
    const char *sinkStr = par("sinkAddress");
    if (sinkStr[0])
        sinkAddress = L3AddressResolver().resolve(sinkStr);
${parity ? `
    // Determine the network-layer protocol below us. An explicit parameter
    // wins; otherwise infer it from the resolved address type, so a node with
    // a destination but no configured protocol still opens a socket.
    const Protocol *networkProtocol = nullptr;
    const char *netProtoStr = par("networkProtocol");
    if (*netProtoStr) {
        networkProtocol = Protocol::getProtocol(netProtoStr);
    }
    else if (!sinkAddress.isUnspecified()) {
        switch (sinkAddress.getType()) {
            case L3Address::IPv4: networkProtocol = &Protocol::ipv4; break;
            case L3Address::IPv6: networkProtocol = &Protocol::ipv6; break;
            case L3Address::MODULEID:
            case L3Address::MODULEPATH: networkProtocol = &Protocol::nextHopForwarding; break;
            default:
                throw cRuntimeError("${name}: cannot infer networkProtocol from address type %d",
                                    (int)sinkAddress.getType());
        }
    }
    else {
        // no destination and no explicit protocol: nothing to open
        EV_INFO << "${name}: passive mode without a networkProtocol parameter; not opening socket\\n";
        return;
    }

    // Create the matching socket type; L3Socket carries an arbitrary payload.
    if (networkProtocol == &Protocol::ipv4)
        socket = new Ipv4Socket(gate("socketOut"));
    else if (networkProtocol == &Protocol::ipv6)
        socket = new Ipv6Socket(gate("socketOut"));
    else
        socket = new L3Socket(networkProtocol, gate("socketOut"));
` : `
    // Bind an L3 socket over the configured network protocol; without one
    // the module stays passive (no socket), as in SensorApp's passive mode.
    const char *netProtoStr = par("networkProtocol");
    if (!*netProtoStr) {
        EV_INFO << "no networkProtocol parameter; not opening socket\\n";
        return;
    }
    socket = new L3Socket(Protocol::getProtocol(netProtoStr), gate("socketOut"));
`}    socket->bind(&Protocol::manet, L3Address());
    socket->setCallback(this);
}

${parity ? `// Send-down flow: build one packet and hand it down to the network layer
// through the socket (same as SensorApp). Driven by the sensing timer.
${hasSendDown ? `// The model's bool sendSensorPacket(Node, PktId) below (Event-B: send_down)
// carries the same transmit structure under its guard chain; it stays unwired
// until the network-layer phase binds the model identities.
` : ""}void ${name}::sendSensorPacket() {
    if (sinkAddress.isUnspecified() || socket == nullptr) {
        EV_WARN << "${name}: sinkAddress unspecified, skipping send\\n";
        return;
    }

    char name[32];
    snprintf(name, sizeof(name), "sensor-%ld", sendSeqNo);

    Packet *packet = new Packet(name);
    auto payload = makeShared<ByteCountChunk>(B(payloadLength));
    packet->insertAtBack(payload);

    packet->addTag<PacketProtocolTag>()->setProtocol(&Protocol::manet);
    auto addrReq = packet->addTag<L3AddressReq>();
    addrReq->setDestAddress(sinkAddress);

    EV_INFO << "${name}: sending sample #" << sendSeqNo
            << " (" << payloadLength << "B) to " << sinkAddress << endl;

    emit(packetSentSignal, packet);
    socket->send(packet);

    sendSeqNo++;
    sentCount++;
}

` : hasSendDown ? "" : `// Send-down flow: build one packet and hand it down to the network layer
// through the socket (same as SensorApp).
void ${name}::sendSensorPacket() {
    if (sinkAddress.isUnspecified() || socket == nullptr) {
        EV_WARN << "sinkAddress unspecified, skipping send\\n";
        return;
    }

    // EXTENSION POINT (send-down flow): guard/trigger the transmission with
    // the generated Event-B event methods declared above.

    char pktName[32];
    snprintf(pktName, sizeof(pktName), "sensor-%ld", sendSeqNo);
    Packet *packet = new Packet(pktName);
    auto payload = makeShared<ByteCountChunk>(B(payloadLength));
    packet->insertAtBack(payload);
    packet->addTag<PacketProtocolTag>()->setProtocol(&Protocol::manet);
    packet->addTag<L3AddressReq>()->setDestAddress(sinkAddress);

    emit(packetSentSignal, packet);
    socket->send(packet);
    sendSeqNo++;
    sentCount++;
}

`}void ${name}::scheduleNextSensing(simtime_t previous) {
    simtime_t next;
    if (previous < SIMTIME_ZERO)
        next = simTime() <= startTime ? startTime : simTime();
    else
        next = previous + *sensingIntervalPar;
    if (stopTime < SIMTIME_ZERO || next < stopTime)
        scheduleAt(next, timer);
}

void ${name}::cancelNextSensing() {
    cancelEvent(timer);
}

void ${name}::handleMessageWhenUp(cMessage *msg) {
    if (msg->isSelfMessage()) {
        ASSERT(msg == timer);
${parity && hasSendDown
    ? `        sendSensorPacket();
        // EXTENSION POINT (send-down flow): to drive the transmission from the
        // model instead, bind the identities and call start_tx(x, pkt) then
        // sendSensorPacket(x, pkt) (Event-B: send_down) here — that path also
        // needs the context populated (see the header).`
    : hasSendDown
    ? `        // EXTENSION POINT (send-down flow): bind the model identities and
        // drive the transmit chain — e.g. start_tx(...), then
        // sendSensorPacket(x, pkt) (Event-B: send_down), which carries the
        // SensorApp transmit structure.`
    : "        sendSensorPacket();"}
        scheduleNextSensing(simTime());
    }
    else if (socket && socket->belongsToSocket(msg)) {
        socket->processMessage(msg);   // delivered to socketDataArrived
    }
    else {
        EV_WARN << "${parity ? `${name}: ` : ""}dropping unaccepted message " << msg->getName()${parity ? `
                << " (" << msg->getClassName() << ")\\n";` : ` << "\\n";`}
        delete msg;
    }
}

// Send-up flow: a packet the network layer sent up arrives here via
// handleMessageWhenUp → socket (same as SensorApp).
void ${name}::socketDataArrived(INetworkSocket *, Packet *packet) {
${parity
    ? `    // EXTENSION POINT (send-up flow):${hasSendUp ? ` to let the model consume the delivery,
    // bind the identities and call socketDataArrived(x, pkt, nbrs) (Event-B:
    // send_up) here. That overload keeps its own receivedCount++, so wiring it
    // in means dropping the one below or the receive count doubles.` : ` dispatch to the generated
    // Event-B receive-side event methods declared above.`}`
    : hasSendUp
    ? `    // EXTENSION POINT (send-up flow): bind the model identities and let the
    // model consume the delivery — e.g. socketDataArrived(x, pkt, nbrs)
    // (Event-B: send_up), the model overload carrying the SensorApp receive
    // accounting.`
    : `    // EXTENSION POINT (send-up flow): dispatch to the generated Event-B
    // receive-side event methods declared above.
    receivedCount++;`}

    EV_INFO << "${parity ? `${name}: ` : ""}received " << packet->getByteLength()${parity ? `
            << "B from " << packet->getTag<L3AddressInd>()->getSrcAddress() << endl;
    receivedCount++;` : ` << "B\\n";`}
    emit(packetReceivedSignal, packet);
    delete packet;
}

void ${name}::socketClosed(INetworkSocket *) {}

void ${name}::handleStartOperation(LifecycleOperation *) {
    openSocket();
    if (isEnabled() && !sinkAddress.isUnspecified())
        scheduleNextSensing(-1);
}

void ${name}::handleStopOperation(LifecycleOperation *) {
    cancelNextSensing();
    if (socket && socket->isOpen())
        socket->close();
    delayActiveOperationFinish(par("stopOperationTimeout"));
}

void ${name}::handleCrashOperation(LifecycleOperation *operation) {
    cancelNextSensing();
    if (socket && operation->getRootModule() != getContainingNode(this))
        socket->destroy();
}

void ${name}::refreshDisplay() const {
    ApplicationBase::refreshDisplay();
    char buf[48];
    snprintf(buf, sizeof(buf), "sent: %ld\\nrcvd: %ld", sentCount, receivedCount);
    getDisplayString().setTagArg("t", 0, buf);
}

void ${name}::finish() {
    recordScalar("packets sent", sentCount);
    recordScalar("packets received", receivedCount);
}

${defs.join("\n\n")}
`;

  // The module is declared standalone and bound to the C++ class via @class;
  // parameters, signals, and gates mirror INET's SensorApp
  // (inet/applications/sensorapp/SensorApp.ned).
  const ned = `import inet.applications.contract.IApp;

//
// ${name} — ${banner.split("\n").join("\n// ")}
// Shell modelled on INET's SensorApp: periodic sensing traffic toward
// sinkAddress over the bound networkProtocol. The C++ class binds via
// @class below.
//
simple ${name} like IApp
{
    parameters:
        @class(${name});
        string sinkAddress = default("");         // destination; empty = passive (sink-side) node
        volatile double sensingInterval @unit(s) = default(1s);
        int payloadLength @unit(B) = default(10B);
        double startTime @unit(s) = default(uniform(0s, this.sensingInterval));
        double stopTime @unit(s) = default(-1s);  // negative: run forever
        string networkProtocol = default("");     // L3 protocol to bind; empty = no socket
        double stopOperationExtraTime @unit(s) = default(-1s);
        double stopOperationTimeout @unit(s) = default(2s);
        @display("i=block/app");
        @lifecycleSupport;
        @signal[packetSent](type=inet::Packet);
        @signal[packetReceived](type=inet::Packet);
        @statistic[packetSent](title="packets sent"; source=packetSent; record=count,"sum(packetBytes)","vector(packetBytes)"; interpolationmode=none);
        @statistic[packetReceived](title="packets received"; source=packetReceived; record=count,"sum(packetBytes)","vector(packetBytes)"; interpolationmode=none);
    gates:
        input socketIn @labels(ITransportPacket/up);
        output socketOut @labels(ITransportPacket/down);
}
`;

  return [
    { path: `${name}.h`, content: header },
    { path: `${name}.cc`, content: source },
    { path: `${name}.ned`, content: ned },
  ];
}

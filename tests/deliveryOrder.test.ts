import { describe, it, expect } from "vitest";
import { starvedByHoisting } from "../src/engine/packetOps";
import type { EncodedMachine, FlatEvent } from "../src/engine/types";

// THE DELIVERY BATCH ORDER IS BEHAVIOUR. `runDeliveryEvents()` attempts each
// event once per arrival, in order, and each attempt sees what the earlier ones
// left.
//
// The batch is assembled as `[...receive events, ...model order]`, and that
// hoist is load-bearing: flattening puts a CARRIED refinement after every pM1
// event, so `receive_controlPkt` would otherwise run last and an arrival would
// consume nothing.
//
// ⚠ But `send_up` publishes TWO variables — `ctlNeighbours` AND `sentUp` — so
// receiveEventsOf claims anything guarding membership in either, and the CLEANUP
// `finish_tx_pkt` (which guards `x ↦ pkt ∈ sentUp`) gets swept in. Hoisted to the
// front it runs before `fwdr_receive_pkt` fills the `ndBuff` its own guard
// requires. Measured: a candidate existed on 652 of the 655 arrivals that
// forwarded a packet, in a window the event was never tried in — 0 firings in a
// whole run, and 24532 calls that never once saw `pkt ∈ ran(ndBuff)` true.

const ev = (label: string, guards: string[], actions: string[] = []): FlatEvent =>
  ({ label, parameters: ["x", "pkt"], guards, actions });

const machine = (events: FlatEvent[], types: [string, string][]): EncodedMachine => ({
  name: "M", chain: ["M"], variables: types.map(([v]) => v),
  variableTypes: new Map(types), events, encodings: new Map(),
});

const TYPES: [string, string][] = [
  ["sentUp", "sentUp ∈ ND ↔ PKT"],
  ["ndBuff", "ndBuff ∈ ND ↔ PKT"],
  ["ctlNeighbours", "ctlNeighbours ∈ PKT ↔ ND"],
  ["recvBuff", "recvBuff ∈ ND ↔ PKT"],
];

// pM1's own text, reduced to what the ordering turns on.
const finish = ev("finish_tx_pkt",
  ["x ↦ pkt ∈ sentUp", "pkt ∈ ran(sentUp)", "pkt ∈ ran(ndBuff)"],
  ["sentUp ≔ sentUp ∖ {x ↦ pkt}"]);
const receive = ev("receive_controlPkt",
  ["pkt ↦ nb ∈ ctlNeighbours", "nb ↦ pkt ∉ ndBuff"],
  ["recvBuff ≔ recvBuff ∪ {nb ↦ pkt}"]);
const fwdr = ev("fwdr_receive_pkt", ["nb ↦ pkt ∈ recvBuff"],
  ["ndBuff ≔ ndBuff ∪ {nb ↦ pkt}"]);

describe("starvedByHoisting", () => {
  const m = machine([finish, receive, fwdr], TYPES);
  const batch = ["receive_controlPkt", "fwdr_receive_pkt", "finish_tx_pkt"];

  it("⚠ demotes the cleanup: its ndBuff guard is filled by a later, unhoisted event", () => {
    expect(starvedByHoisting(m, ["finish_tx_pkt", "receive_controlPkt"], batch))
      .toEqual(new Set(["finish_tx_pkt"]));
  });

  it("keeps a receive event whose publication nothing in the batch fills", () => {
    // `ctlNeighbours` is filled by send_up, which the ARRIVAL realises and which
    // is therefore not in the batch at all. Hoisting it is correct and required.
    expect(starvedByHoisting(m, ["receive_controlPkt"], batch).has("receive_controlPkt"))
      .toBe(false);
  });

  it("⚠ ignores a filler that is ITSELF hoisted — it is not 'later'", () => {
    // fwdr fills ndBuff, but hoisted alongside it runs first and cannot starve
    // anything, so the cleanup must NOT be demoted on its account.
    const out = starvedByHoisting(m, ["finish_tx_pkt", "fwdr_receive_pkt"], batch);
    expect(out.has("finish_tx_pkt")).toBe(false);
    // ⚠ And the rule generalises rather than being aimed at one event: fwdr
    // itself needs `recvBuff`, which the unhoisted receive event fills, so
    // hoisting FWDR would starve it in exactly the same way.
    expect(out.has("fwdr_receive_pkt")).toBe(true);
  });

  it("⚠ reads POSITIVE positions only — a ∉ guard states an absence", () => {
    // receive_controlPkt guards `nb ↦ pkt ∉ ndBuff`, which fwdr fills. That must
    // NOT demote it: an absence needs no producer, and treating it as one would
    // send every receive event to the back of the batch.
    const onlyNegative = ev("r", ["nb ↦ pkt ∉ ndBuff"], []);
    expect(starvedByHoisting(machine([onlyNegative, fwdr], TYPES), ["r"], ["r", "fwdr_receive_pkt"]))
      .toEqual(new Set());
  });

  it("claims nothing for an event with no membership requirement", () => {
    const bare = ev("b", ["x ∈ ND"], []);
    expect(starvedByHoisting(machine([bare, fwdr], TYPES), ["b"], ["b", "fwdr_receive_pkt"]))
      .toEqual(new Set());
  });

  it("claims nothing when the filler is outside the batch", () => {
    // Same machine, but fwdr is not a member of the delivery batch.
    expect(starvedByHoisting(m, ["finish_tx_pkt"], ["receive_controlPkt", "finish_tx_pkt"]))
      .toEqual(new Set());
  });
});

describe("starvedByHoisting reads each CONJUNCT, not the whole guard", () => {
  // ⚠ THE REQUIREMENT PATTERNS ARE `$`-ANCHORED, so before 2026-09-22 a
  // COMPOUND guard contributed NOTHING: `pkt ∈ ran(ndBuff) ∧ pkt ∉ ran(sentUp)`
  // matched neither pattern, because the trailing conjunct defeats the anchor.
  //
  // In the live corpus `finish_tx_pkt` was covered anyway -- by LUCK, because a
  // second and separate guard happened to state the same requirement. These
  // tests state it only ONCE, inside a compound guard, which is the case that
  // silently fell through. Both real generation targets are byte-identical
  // across the fix, so this seam is the only thing that can catch it.
  const fwdr = ev("fwdr_receive_pkt", [], ["ndBuff ≔ ndBuff ∪ {nb ↦ pkt}"]);

  it("sees a requirement stated only inside a compound guard", () => {
    const compound = ev("cleanup", ["pkt ∈ ran(ndBuff) ∧ pkt ∉ ran(sentUp)"], []);
    expect(starvedByHoisting(machine([compound, fwdr], TYPES),
      ["cleanup"], ["cleanup", "fwdr_receive_pkt"])).toEqual(new Set(["cleanup"]));
  });

  it("still refuses a NEGATED conjunct, which needs no producer", () => {
    // ∉ is U+2209, a different codepoint from ∈, so splitting on ∧ cannot admit
    // it. Were this claimed, every receive event would be demoted to the back
    // of the batch -- the opposite of the fix.
    const negated = ev("r", ["x ∈ ND ∧ nb ↦ pkt ∉ ndBuff"], []);
    expect(starvedByHoisting(machine([negated, fwdr], TYPES),
      ["r"], ["r", "fwdr_receive_pkt"])).toEqual(new Set());
  });

  it("keeps the anchor doing its job within a conjunct", () => {
    // `∈ ran(V)` must END the conjunct. A conjunct that merely mentions it is
    // not a membership requirement, and widening to a substring match would
    // claim it.
    const mentions = ev("m", ["card(ran(ndBuff)) > 0 ∧ x ∈ ND"], []);
    expect(starvedByHoisting(machine([mentions, fwdr], TYPES),
      ["m"], ["m", "fwdr_receive_pkt"])).toEqual(new Set());
  });
});

import { describe, it, expect } from "vitest";
import { senderSideDrainOf, transmitRecordsItsOwnFiring } from "../src/engine/packetOps";
import type { EncodedMachine, FlatEvent } from "../src/engine/types";

// THE MODEL'S CLEANUP RUNS ON THE WRONG NODE.
//
// `send_down` OBSERVES `x ↦ pkt ∈ sentDown`; the pair is removed by `send_up`,
// which in a per-node module runs on the RECEIVER. So the sender's own entry is
// never removed. Measured on the nine-node field: 765 residual entries against
// 763 transmissions — exactly one apiece — and because BOTH of pM1's cleanup
// events guard `pkt ∉ ran(sentDown)`, both die permanently for every packet a
// node has ever sent. `finish_tx_pkt` fired 0 times field-wide.
//
// ⚠ AND THE EXCLUSION IS THE WHOLE SAFETY ARGUMENT. A model whose transmit
// event limits ITSELF (MintRoute guards `cn ↦ pkt ∉ channel` and adds the same
// maplet) must NOT have that set drained — the packet would go on the air
// repeatedly. These tests pin both directions, and pin that the exclusion lines
// up with transmitRecordsItsOwnFiring: the binding drains only where it, not
// the model, owns the limit.

const ev = (label: string, guards: string[], actions: string[]): FlatEvent =>
  ({ label, parameters: ["x", "pkt"], guards, actions });

const pairSets = (...names: string[]) => (v: string) =>
  names.includes(v) ? "pair-set" : "function";

const machine = (events: FlatEvent[], types: [string, string][]): EncodedMachine => ({
  name: "M", chain: ["M"], variables: types.map(([v]) => v),
  variableTypes: new Map(types), events, encodings: new Map(),
});

const TYPES: [string, string][] = [
  ["sentDown", "sentDown ∈ ND ↔ PKT"],
  ["sentUp", "sentUp ∈ ND ↔ PKT"],
  ["channel", "channel ∈ ND ↔ PKT"],
];

// The app chain's own pair, verbatim: send_down is a pure OBSERVATION with no
// actions at all, and send_up is what removes the pair — on the receiver.
const appSendDown = ev("send_down", ["x ∈ ND", "pkt ∈ PKT", "x ↦ pkt ∈ sentDown"], []);
const appSendUp = ev("send_up", ["x ↦ pkt ∈ sentDown", "x ↦ pkt ∉ sentUp"],
  ["sentDown ≔ sentDown ∖ {x ↦ pkt}", "sentUp ≔ sentUp ∪ {x ↦ pkt}"]);

// MintRoute's: send_down keeps its OWN record, which is what stops it
// transmitting the same packet twice.
const mintSendDown = ev("send_down", ["x ↦ pkt ∈ sentDown", "x ↦ pkt ∉ channel"],
  ["channel ≔ channel ∪ {x ↦ pkt}"]);

describe("senderSideDrainOf", () => {
  it("claims the pair-set the delivery event removes and nothing else does", () => {
    expect(senderSideDrainOf(machine([appSendDown, appSendUp], TYPES), pairSets("sentDown", "sentUp")))
      .toEqual(["sentDown"]);
  });

  it("⚠ leaves a set the transmit uses as its OWN self-limit", () => {
    // `channel` is guarded absent and then added by the same event: draining it
    // would put every packet on the air repeatedly. It is also not removed by
    // send_up, so both halves of the test agree here.
    const m = machine([mintSendDown, appSendUp], TYPES);
    expect(senderSideDrainOf(m, pairSets("sentDown", "sentUp", "channel")))
      .not.toContain("channel");
  });

  it("⚠ leaves the observed set too when the transmit self-limits on THAT set", () => {
    // The dangerous case, and the one the exclusion exists for: a model that
    // both observes and self-limits on the same pair-set. Draining it re-enables
    // the transmit.
    const selfLimiting = ev("send_down",
      ["x ↦ pkt ∈ sentDown", "x ↦ pkt ∉ sentDown"], ["sentDown ≔ sentDown ∪ {x ↦ pkt}"]);
    expect(senderSideDrainOf(machine([selfLimiting, appSendUp], TYPES), pairSets("sentDown", "sentUp")))
      .toEqual([]);
  });

  it("claims nothing when the delivery event does not remove the pair", () => {
    // If send_up leaves the pair alone, the sender has nothing to put back —
    // the model never intended that pair to go away.
    const keeps = ev("send_up", ["x ↦ pkt ∈ sentDown"], ["sentUp ≔ sentUp ∪ {x ↦ pkt}"]);
    expect(senderSideDrainOf(machine([appSendDown, keeps], TYPES), pairSets("sentDown", "sentUp")))
      .toEqual([]);
  });

  it("claims nothing for a variable that is not a pair-set", () => {
    expect(senderSideDrainOf(machine([appSendDown, appSendUp], TYPES), pairSets("sentUp")))
      .toEqual([]);
  });

  it("claims nothing when either event is absent", () => {
    const enc = pairSets("sentDown", "sentUp");
    expect(senderSideDrainOf(machine([appSendDown], TYPES), enc)).toEqual([]);
    expect(senderSideDrainOf(machine([appSendUp], TYPES), enc)).toEqual([]);
  });

  it("⚠ drains exactly where the binding — not the model — owns the limit", () => {
    // The two derivations must agree, or the module either transmits twice or
    // leaks. A model that records its own firing is left alone by BOTH.
    const app = machine([appSendDown, appSendUp], TYPES);
    const mint = machine([mintSendDown, appSendUp], TYPES);
    expect(transmitRecordsItsOwnFiring(app)).toBe(false);
    expect(senderSideDrainOf(app, pairSets("sentDown", "sentUp")).length).toBeGreaterThan(0);
    expect(transmitRecordsItsOwnFiring(mint)).toBe(true);
    expect(senderSideDrainOf(mint, pairSets("sentDown", "sentUp", "channel")))
      .not.toContain("channel");
  });
});

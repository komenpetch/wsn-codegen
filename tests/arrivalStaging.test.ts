import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../src/engine/pipeline";
import { parseModel } from "../src/engine/parser";
import { flatten } from "../src/engine/flattener";
import { resolveEncodings } from "../src/engine/encodingResolver";
import { patternExtensionFor } from "../src/engine/patternExtension";
import { senderQueuesOf, transmitEventsOf, receiveEventsOf, arrivalRequirementsOf } from "../src/engine/packetOps";

// An arrival stages the MEDIUM. It must never stage a per-node QUEUE.
//
// Everything the arrival stages is keyed `{_f, _pkt}` — the PREVIOUS HOP. That
// is right for the medium: `sentDown`/`sentUp`/`WiMedium` are statements about a
// transmission, and the sender is who made it. It is wrong for a queue.
// `start_tx` guards `x ↦ pkt ∈ ndBuff` and then stamps `pktFwdr ≔ pktFwdr ⊕
// {pkt ↦ x}`, so a staged `ndBuff` entry keyed by the previous hop makes this
// module TRANSMIT A PACKET CARRYING ANOTHER NODE'S ID as the forwarder.
//
// ⚠ MEASURED, on the nine-node field, before this:
//   - `start_tx` fired with `x != myNodeId` 6–69 times per node;
//   - the sink, which hears exactly ONE node, received frames claiming five
//     distinct forwarders — including itself;
//   - every node's neighbour table filled with nodes it had never heard from,
//     up to all nine on a nine-node network.
// After: `x != myNodeId` never happens, and the tables shrink to (nearly) the
// measured radio neighbours.
//
// ⚠ `arrivalRequirementsOf` ALREADY DESCRIBED THIS BUG AND DID NOT CATCH IT.
// Its comment says staging ndBuff "would hand this node a buffer entry
// belonging to the SENDER, which its transmit events would then pick up and
// send on that node's behalf" — but the exclusion it implemented was "a receive
// event ADDS to it", and the event that dragged ndBuff in only GUARDS it
// (`finish_tx_pkt`, classified as a receive event because it guards membership
// in `sentUp`, which `send_up` also adds to).
const load = (d: string) =>
  readdirSync(d).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(join(d, f), "utf8") }));

const APP = "../Update_wsn/C0_project";
const MINTROUTE = "../EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck";

describe("the arrival stages the medium, never a per-node queue", () => {
  const cc = generate(load(APP), "pM3", "Pm3Wsn", 3)
    .find((f) => f.path.endsWith(".cc"))!.content;

  it("reaches the arrival at all — otherwise this suite proves nothing", () => {
    expect(cc).toContain("bool _st_sentDown = sentDown.insert({_f, _pkt}).second;");
  });

  it("does not stage the transmit queue", () => {
    expect(cc).not.toContain("_st_ndBuff");
    expect(cc).not.toContain("ndBuff.insert({_f, _pkt})");
  });

  it("still stages what the delivery event's own guards require", () => {
    // `send_up` guards `x ↦ pkt ∈ sentDown` and `x ↦ pkt ∉ sentUp`: one
    // membership present, one absent. Both must still be established.
    expect(cc).toContain("bool _st_sentUp = sentUp.erase({_f, _pkt}) > 0;");
  });
});

describe("senderQueuesOf reads the queue off the model", () => {
  const files = load(APP);
  const base = resolveEncodings(flatten(parseModel(files), "pM3"));
  const src = patternExtensionFor(files, "pM3");
  const pModel = resolveEncodings(flatten(parseModel(src.files), src.machine));

  it("names the variable the transmit event reads its sender from", () => {
    expect(senderQueuesOf(base, pModel, transmitEventsOf(base, pModel))).toEqual(["ndBuff"]);
  });

  it("leaves the arrival with nothing to stage beyond the delivery's own needs", () => {
    expect(arrivalRequirementsOf(base, pModel, receiveEventsOf(base, pModel),
      senderQueuesOf(base, pModel, transmitEventsOf(base, pModel)))).toEqual([]);
  });

  it("does NOT strip the medium on the network branch", () => {
    // ⚠ The one thing this exclusion must not do. MintRoute's arrival stages
    // `WiMedium`, and without it every attempt at the forwarding event was
    // rejected by its FIRST guard — the 2026-09-13 finding. `WiMedium` is
    // guarded `pkt ∈ ran(WiMedium)` by a genuine receive event, not read as a
    // sender key by a transmit event, so it survives.
    const m = resolveEncodings(flatten(parseModel(load(MINTROUTE)), "M4"));
    const queues = senderQueuesOf(m, m, transmitEventsOf(m, m));
    expect(queues).toContain("ndBuff");
    expect(queues).not.toContain("WiMedium");
    expect(arrivalRequirementsOf(m, m, receiveEventsOf(m, m), queues)).toEqual(["WiMedium"]);
  });
});

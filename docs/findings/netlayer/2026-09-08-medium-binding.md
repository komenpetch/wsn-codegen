# The medium binding: the flood propagates

**2026-09-08.** The third and last identity binding. The measurable outcome:
a beacon created at the sink reached sensor3, three hops away, through two
rebroadcasts the model itself decided to make.

The day before, the same generator produced a module whose sink executed its
entire send chain sixty times and reached nobody
([2026-09-07-global-model-per-node-module.md](2026-09-07-global-model-per-node-module.md)).
Nothing about that was a missing translation rule, and nothing here is one
either.

---

## 1. The result

60 s, exit 0. `fired:<event>` scalars, per node, from the `.sca`:

| metric                       | sink | sensor1 | sensor2 | sensor3 |
|------------------------------|-----:|--------:|--------:|--------:|
| fired:create_bconPkt         |   61 |       – |       – |       – |
| fired:start_tx_bconPkt       |   61 |       1 |       1 |       1 |
| fired:send_down              |   61 |       1 |       1 |       1 |
| fired:send_up                |    1 |      60 |       2 |       1 |
| fired:receive_controlPkt     |    – |       1 |       1 |       1 |
| fired:receive_dup_controlPkt |    – |       – |       1 |       – |
| MAC nbRxDataPackets          |    1 |      60 |       2 |       1 |

The nodes sit in a line 200 m apart with receiver sensitivity −85 dBm, so each
hears only its immediate neighbours (−82.8 dBm at 200 m, −88.8 dBm at 400 m).

**sensor3's radio received one frame in sixty seconds.** It cannot hear the sink
— 600 m is −92.3 dBm — and had it been in range it would have seen about sixty
frames, as sensor1 did. That one frame was sensor2's rebroadcast of a beacon
sensor2 had received from sensor1. Both rebroadcasts are Event-B events firing
on those nodes: `receive_controlPkt` queued the packet, `start_tx_bconPkt` took
it out of the queue, `send_down` put it on the air.

sensor2 heard the same packet twice — once from sensor1, once from sensor3
rebroadcasting — and fired `receive_dup_controlPkt` on the second. That is the
cross-node packet identity working: two receptions, two different
`inet::Packet` objects, resolved to one local PktId, so the model's own
`pkt ∉ floodTbl(nb)` could recognise the repeat.

## 2. What the binding actually does

Three things, all derived from the model rather than configured.

**Transmit.** The model's transmit event (`send_down`, the CommPattern pair's
first half) hands its own PPkt chunk to the radio as a broadcast. The model
names no destination — its medium delivers to whoever is in range — and a
broadcast is that.

**Receive.** An arrival is the simulator's answer to the question the model asks
with `envNeighbours`: who is in range. So the receiving node writes that answer
in (`{pkt ↦ me}`), stages the wire copies the transmission carried, and then
**runs the model's own `send_up`**. The delivery postcondition is not
hand-written; it executes.

**Identity across nodes.** Each module mints its own PktIds, so the same packet
is a different integer on every node — but the flood's duplicate test is about
the packet, not the integer. The key is the fields no event ever overwrites.

## 3. What is derived, and from what

Nothing below is a name this file chose. The two starting points are the labels
`send_down` and `send_up`, which are the CommPattern pair the app-layer emitter
already keys on to merge the SensorApp transmit and receive structures.

| what | derived from |
|---|---|
| the wire format (`vPktSeqNo` ↔ `getSeqNum`, …) | transmit reads a packet field into a parameter and stores that parameter in a variable: `sno = pktSeqNo(pkt)` then `vPktSeqNo ≔ vPktSeqNo ∪ {pkt ↦ sno}`. That pairing *is* the model's serialisation |
| what an arrival must make true (`WiMedium`, `sentDown`, `channel`) | every `f ↦ pkt ∈ V` guard of the delivery event over a pair-set |
| which chunk field carries the sender | the event that puts a packet INTO the medium stamps it with the same parameter it files the packet under: `WiMedium ≔ WiMedium ∪ {x ↦ pkt}` beside `pktFwdr ≔ pktFwdr ⊕ {pkt ↦ x}`. The model saying a frame carries its sender, which is also what a radio does |
| the propagation variable (`envNeighbours`) | what the delivery event reads for its receiver set: `nbrs = ran({pkt} ◁ envNeighbours)` |
| which events the simulator now realises | the delivery event, plus every event whose entire effect is on the propagation variable — `find_neighbours`, `assign_forwarder`, `lose_all_neighbours` |
| the packet's identity fields | the ENC7 fields no event overwrites, excluding the creating events (which is how an attribute gets its first value, not a change of identity) |

## 4. Why the propagation events had to stop being scheduled

`find_neighbours` computes `nbs = wsnLinks[{f}]` — f's neighbours according to
the model's own topology variable — and `send_up` then delivers to them. Left
schedulable, all of that runs **on the sending node**: it computes its own
neighbour set and delivers the packet to itself, filling its own
`ctlNeighbours`, and every receive event fires locally. The flood would
propagate beautifully inside one module and nothing would cross the air.

That is the same failure the previous finding warned about in a different
costume, and it is worth being explicit that the honest version costs something:
`wsnLinks` is now decorative. The model's `add_link` / `disconnect_link` /
`recover_link` still fire and still maintain it, but nothing reads it to decide
who receives — the radio does. Making the radio's reachability agree with
`wsnLinks` is ENVPattern work (it generates the `.ned` topology), not this
binding's.

## 5. Three defects this surfaced, none of them translation gaps

**An event that refused to fire changed state anyway.** The emitter appended its
refusal *after* the actions, so a partially translated event ran everything it
could translate and then reported that it had not fired. MintRoute's
`finish_tx_pkt` erased from `WiMedium` and `sentUp` and returned false — and its
caller was iterating `WiMedium` to find candidates, so the run died with an
access violation. Both halves are bad on their own; together they were invisible
until deliveries started happening. Fixed in `codeEmitter.ts`: the refusal comes
first, the actions are emitted as comments. The app layer has exactly one
incomplete event (`activate`), whose `emergencyAlert[act] = TRUE;` had the same
problem with nothing calling it; that is the only app-layer byte that moved, and
the freeze baseline was re-recorded deliberately.

**Guards that looked translated and were always false.** `type(pkt) ∈ CONTROL`
compiled to `type.count(pkt) > 0 && …` against the context map ENC7 replaced —
written only by the node that CREATED the packet. A packet off the wire has a
chunk and no map entry, so every `type(pkt)` guard on a receiving node was
unsatisfiable. Same for `nbh = pktNbHops(pkt) + 1` against a map nothing writes
at all. Neither produced a marker, a warning, or a compile error. They are the
reason the receive events would have stayed dead even with a perfect medium.

**A packet identity that changed at every hop.** The first version of the
identity key included `netSeqNo`, because the mutability scan looked for
relational override (`f ≔ f ⊕ {k ↦ v}`) and missed the per-key spelling
(`netSeqNo(pkt) ≔ lsno`). The same packet would then have a new identity at
every hop, no duplicate could ever be recognised, and the flood would not
terminate.

## 6. What limits the flood now, and why it is not the medium

Each node accepts exactly one packet per forwarder and then stops: sensor1
receives 60 beacons and accepts 1. That is the model's own handshake.
`receive_controlPkt` guards `f ↦ nb ∉ updateNbrs` and its own action adds
`f ↦ nb`; the only event that ever removes a pair again is `update_nbr`, which
is still unschedulable. Its parameters need `lastSeqno(y ↦ x)` — a **pair-keyed
function**, `ND ↔ (ND ⇸ ℤ)` written as a function of a maplet — which is the
encoding PRouteTable has to decide and which this round deliberately did not
touch.

So the ceiling on this run is one accepted packet per (forwarder, receiver)
pair, six across four nodes in a line, and the run hit it exactly. Raising it is
PRouteTable's first job, not the medium's.

## 7. What can now be said, with evidence

The generator takes a network-layer Event-B machine and produces a module that
compiles, loads, runs, executes the model's own events, **transmits the model's
own packets over a real radio, and forwards them hop by hop because the model
decided to** — and a packet crossing three nodes that cannot hear each other's
source.

Of the machine's 39 events, 24 are driven by the generated scheduler and 4 more
run when the medium delivers, so 28 can execute; 11 remain unschedulable, each
with its reason emitted as a comment beside its declaration.

What it still cannot say is that MintRoute's tree forms. That needs the
neighbour and route tables, which is the next pattern class.

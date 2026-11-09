# Case study: SensorApp (application layer)

The first case study and the one the paper describes in full. It asks one question: can a
module generated from an Event-B model do what INET's hand-written `SensorApp` does?

## The model

**WSN-App**, the application-layer chain of the pattern: three machines (`pM1`, `uM2`,
`pM3`), 14 events, 101 clauses, 36.2 kB of Rodin XML. It holds the CommPattern: sensing,
packet creation, the neighbour and destination buffers, and the `send_down` / `send_up` pair.

The repository ships an earlier copy of this chain, `tests/fixtures/shdecom`, which generates
structures 1 to 3 (not 4).

## What is generated

Everything. The module is `ApplicationBase` shaped like `SensorApp`: a sensing timer, a socket,
`sendSensorPacket()` and `socketDataArrived()`, `openSocket()` with its IPv4, IPv6 and
address-type fallback, the counters and the log strings. The model's own events are emitted as
guarded methods beside the shell.

Nothing is pasted. The model's own `send_down` and `send_up` overloads
(`sendSensorPacket(Node, PktId)` and `socketDataArrived(Node, PktId, set<Node>)`) are emitted
with their guards and are deliberately not wired into the timer; the shell's own transmit
path produces the traffic.

## Run it

```bash
npm run generate -- tests/fixtures/shdecom out        # structure 2, the default
```

Put the three files in an OMNeT++ project that references INET 4.5 and point the node's
application at the class:

```ini
*.sensor[*].app[0].typename = "EbWsn"
```

The harness is one sink and three sensors within about 130 m of each other, on INET's ApSK
radio, SMAC and WiseRoute, for 60 simulated seconds. The node wiring is `MyWSN`'s own, with
only the application's type name changed. That keeps the comparison to the module and nothing
else.

## Measured

**Packets over 60 s** (one sink and three sensors; "sent" lists the three sensors, "received" is
the run's total):

| | sent | received |
|---|---|---|
| `SensorApp` (reference) | 59 / 60 / 60 | 6 |
| V1 (`--v1`) | 0 / 0 / 0 | 0 |
| V2 (`--v2`) | 59 / 60 / 60 | 6 |

V1 compiled, ran to the end and exited normally, and sent nothing. The transmit call sat behind
an extension point nobody had bound. Nothing in the build or the log said so; only the packet
count did. That is why every similarity figure in this project is paired with a run.

**Similarity to `SensorApp`**, by longest common subsequence over normalised statements:

| Scope | V1 | V2 |
|---|---|---|
| shell functions (15): precision / recall / F | 79.52 / 65.35 / 71.74 % | 100 / 100 / 100 % |
| shell functions statement-identical | 10 of 15 | 15 of 15 |
| all three files, recall (the paper's coverage figure) | 67.3 % | 93.9 % |

Today's V2 output measures 156 of 165 statements, 94.5 %. The paper's 93.9 % was taken before
the generated code was wrapped in a C++ namespace. The extra match is the namespace's closing
brace, which strips to the same text as `SensorApp.cc`'s own; no behaviour changed.

On three files, the V2 row of the paper's accuracy table is precision 37.26 %, recall 93.94 %,
F 53.36 %. Precision is low because the generated files hold the whole Event-B model in
addition to `SensorApp`'s shell, and `SensorApp` has no counterpart for the model's events.

**Rule coverage.** 2 of 101 clauses are unmatched, both in `PActivate`.

## What it does not show

- **One model.** The figures come from one project. The nine-node runs of the network case
  studies are the check that the same shell carries a different model.
- **Equivalence is demonstrated, not proved.** The same packet counts on every node are strong
  evidence and not a refinement argument.
- **In structure 2 the model's events are emitted but do not drive the module.** The shell's
  transmit path produces the traffic. The network-layer structures are where the model's own
  events drive it.

# Pending design-doc correction — the green Base cell is `NetworkProtocolBase`

**Status:** recorded, NOT applied. Same handling as [paper2-pending.md](paper2-pending.md):
the `design/` documents are the frozen, advisor-facing artifacts, so a sweep across
ten of them is an advisor decision rather than a unilateral edit.

**Raised:** 2026-09-22, during the structure-3 shell switch.

---

## What is wrong

The 4×4 pattern class diagram and the design corpus give the **green Base cell** as
INET's `RoutingProtocolBase`, and the 2026-06-12 architecture spec says in as many
words:

> **Dropped:** `INetworkProtocol`, `NetworkProtocolBase` (superseded by the routing-app design).

That was reversed on **2026-09-08**, on advisor direction and on INET's own source.
The code has followed the reversal for two weeks; the documents have not.

## Why the reversal is right

INET 4.5's two implementations of the two shapes disagree with each other, and the
disagreement is the answer:

| class | base | carries data? |
|---|---|---|
| `MintRoute` | `NetworkProtocolBase, INetworkProtocol` | **yes** — packets arrive at `handleLowerPacket`, leave through `sendDown` |
| `Aodv` | `RoutingProtocolBase`, `NetfilterBase::HookBase`, `UdpSocket::ICallback` | **no** — a routing daemon over UDP; it edits a routing table through netfilter hooks |

**The machines forward packets.** A routing daemon does not.

Two further facts measured on 2026-09-21/22, which the 2026-06-12 spec could not have
known because they contradict its stated rationale:

- **`RoutingProtocolBase` provides nothing but three init-stage overrides.** It is
  `: OperationalBase` with `isInitializeStage` / `isModuleStartStage` /
  `isModuleStopStage`. It does not supply a routing table.
- **`IRoutingTable` is orthogonal to the base class.** It arrives as
  `ModuleRefByPar<IRoutingTable>` from a NED parameter, which any `cSimpleModule` can
  hold. The spec's §10.1 rationale — that `RoutingProtocolBase` is the way to "drive
  INET's own `IRoutingTable`/`IRoute`" — does not hold: `MintRoute`, the one
  `NetworkProtocolBase` in the WSN corpus, declares **zero** `IRoutingTable` and keeps
  its own `std::map`, while `Aodv`, which does hold one, is not a `NetworkProtocolBase`.

## What the generator actually emits (all three outputs)

```
class <Name> : public NetworkProtocolBase, public INetworkProtocol
simple <Name> extends NetworkProtocolBase like INetworkProtocol
module <Name>NetworkLayer like INetworkLayer
```

`M4Wsn` and `M6Wsn` since 2026-09-08; structure 3 since 2026-09-22.

## Sites to correct — 28 references in 10 documents, plus two figures

| file | refs |
|---|---|
| `design/Patterns_And_Class_Diagram_Explained.md` | 6 |
| `design/Pattern_Class_Architecture_Report.md` | 5 |
| `design/VERIFICATION_REPORT.md` | 5 |
| `design/VERIFICATION_REPORT_PHASE3_EXIT.md` | 3 |
| `design/INET_VERIFICATION.md` | 2 |
| `design/PHASE3_EXIT_VERIFICATION_PROMPT.md` | 2 |
| `design/translation_rules.md` | 2 |
| `design/CommPattern_Design.md` | 1 |
| `design/Pattern_Comparison_Report.md` | 1 |
| `design/RouteTable_Design.md` | 1 |
| `design/figures/pattern_class_diagram(1).drawio` | — |
| `design/figures/pattern_class_diagram.drawio.svg` | — |

⚠ `design/figures/pattern_class_diagram.png` is an export and has to be regenerated
from the `.drawio`, not edited.

⚠ The Interface cell moves with it: `IRoutingProtocol` *(concept)* → **`INetworkProtocol`**,
which is a real INET interface the emitted class already realises. The 2026-06-12 spec
dropped it in the same sentence.

## What does NOT change

The amber and blue columns are untouched. `PComm`, `PPkt`, `PRouteTable`, `PEnv` and the
per-case-study classes are unaffected — this is the green row only.

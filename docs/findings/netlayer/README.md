# Network-layer findings (M4–M6)

Evidence from extending WSN-CodeGen from the sensing-and-communication layer
(M0–M3) to the **network layer**: packet classes, forwarding, and the medium.

**This was a separate `netlayer/` package until 2026-09-12; it is not any more.**
The engine modules moved to `src/engine/`, the probes to `scripts/`, the tests to
`tests/`, and the two generators became one — `pipeline.ts` emits the network
layer inside the same module whenever the target machine has a medium. Nothing
selects it by hand. The documents in this folder are kept as written, so the
ones predating the merge still describe two packages and two commands; the
findings themselves stand.

**Re-run, do not quote.** Every number in these files is dated and reproducible
from the probes. They are all relative to the engine as it stood on that date,
and the engine has moved since.

## The probes

```bash
npm run scan
```

```bash
npm run shapes
```

```bash
npm run selftest
```

`scan` takes `-- --clauses` to dump every distinct clause, and `label=path`
arguments (paths relative to the parent project directory) to point it at
another project. `shapes` takes `-- --list` for the clauses behind each group.

Both resolve model paths from their own file location via `import.meta.url`,
never from the working directory — a cwd-relative path here reads the wrong tree
without saying so.

## The two layers

| | app layer | network layer |
|---|---|---|
| source | `Update_wsn/C0_project` (pM1/uM2/pM3) | `EventB_model/RTMCS_7_4_proof` M0–M6, `EventB_model/WSN_MintRoute_3_2_5_9/…amiCheck` M0–M5 |
| emitted base class | `inet::ApplicationBase` (SensorApp shell) | `inet::NetworkProtocolBase` — see [the base-class finding](2026-09-06-inet-base-class.md) |
| reference of the same scope | `SensorApp.cc` (238 lines) | `MintRoute.cc` (625 lines), both in this project's INET tree |
| what selects it | — | the model: a medium, or no medium |

DSR has no network-layer Event-B source and it is not recoverable
(advisor-confirmed 2026-06-01). Do not spend time looking for it.

## Reading order

- [Gap baseline](2026-09-06-gap-baseline.md) — untranslated counts per machine,
  grouped into 15 shapes, with a missing-rule / missing-interface-machine
  decision for each.
- [INET base class](2026-09-06-inet-base-class.md) — the target class and its
  obligations, from INET 4.5 source. ⚠ Its "unresolved" note is closed: see the
  network-protocol shell finding below.
- [Global model, per-node module](2026-09-07-global-model-per-node-module.md) —
  why the flood did not propagate, and why making the medium process-global
  would have been a convincing lie.
- [MintRoute flooding](2026-09-07-mintroute-flooding.md) — the Event-B model and
  INET's `MintRoute.cc` implement different control planes, so `MintRoute.cc` is
  not a behavioural baseline for it.
- [Medium binding](2026-09-08-medium-binding.md) — the binding derived from the
  CommPattern pair, and the measured three-hop flood.
- [Network-protocol shell](2026-09-08-network-protocol-shell.md) — the pivot to
  `NetworkProtocolBase`, which closed the base-class conflict.
- [task-reports/](task-reports/) — including `00-decision-ledger.md`, every
  judgment call made during PPkt's implementation and the two that were wrong.

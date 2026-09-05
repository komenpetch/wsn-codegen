# netlayer — WSN-CodeGen network layer (M4–M6)

Working area for extending WSN-CodeGen from the sensing-and-communication layer
(M0–M3, finished and written up) to the **network layer**: route discovery and
forwarding.

Kept in its own folder **on purpose**. The app layer is done, measured and
published; nothing here should disturb it until the two are deliberately merged.
See [Merging back](#merging-back) for what that will involve.

## Layout

```
netlayer/
├── scripts/          measurement probes (read-only against the app-layer engine)
│   ├── scan.ts       untranslated-clause counts, per machine, both projects
│   └── shapes.ts     the same gap grouped by SHAPE, with a selftest
└── findings/         what the probes established, written down
```

## Running

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
arguments (paths relative to the project root) to point it at another project:

```bash
npm run scan -- --clauses AppLayer=Update_wsn/C0_project
```

`shapes` takes `-- --list` for the clauses behind each group.

### Why the scripts run out of `../wsn-codegen`

There is no `node_modules` here. The npm scripts `cd ../wsn-codegen` and use its
installed `vite-node`, because that is also where the engine being measured
lives — installing a second copy of vite/vitest to run two probes would cost
more than it buys. The probes import the engine by relative path
(`../../wsn-codegen/src/engine/…`) and **never write to it**.

Consequence worth knowing: the working directory when a probe runs is
`wsn-codegen`, not `netlayer`. Both probes therefore resolve model paths from
their own file location via `import.meta.url`, never from the cwd. Leave that
alone — a cwd-relative path here reads the wrong tree without saying so.

## Relationship to the app layer

| | app layer | network layer |
|---|---|---|
| source | `Update_wsn/C0_project` (pM1/uM2/pM3) | `EventB_model/RTMCS_7_4_proof` M0–M6, `EventB_model/WSN_MintRoute_3_2_5_9/…amiCheck` M0–M5 |
| emitted base class | `inet::ApplicationBase` (SensorApp shell) | `inet::NetworkProtocolBase` — see [findings](findings/2026-09-06-inet-base-class.md) |
| reference of the same scope | `SensorApp.cc` (238 lines) | `MintRoute.cc` (625 lines), both in this project's INET tree |
| status | finished, v4, behavioural parity | measurement only; no rules written yet |

DSR has no network-layer Event-B source and it is not recoverable
(advisor-confirmed 2026-06-01). Do not spend time looking for it.

## Merging back

Nothing here forks the engine. The probes read `wsn-codegen/src/engine/*` and
that is the only coupling, so the merge is additive rather than a reconciliation:

- rule additions land in `wsn-codegen/src/engine/rules.ts` with their evidence,
  the way the existing ones carry theirs;
- the probes move to `wsn-codegen/scripts/` and their imports shorten;
- anything measured here has to be re-measured there, because the numbers below
  are all relative to the engine as it stood at the time.

The one thing that must **not** be carried over silently is a figure. Every
number in `findings/` is dated and reproducible from the probes; re-run rather
than quote.

## State

Measurement complete, nothing changed in the generator. Findings:

- [Gap baseline](findings/2026-09-06-gap-baseline.md) — counts per machine, and
  the gap grouped into 15 shapes with a missing-rule / missing-interface-machine
  decision for each.
- [INET base class](findings/2026-09-06-inet-base-class.md) — the target class
  and its obligations, established from INET 4.5 source.

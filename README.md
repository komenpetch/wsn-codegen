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
| status | finished, v4, behavioural parity | PPkt landed on branch `ppkt`; see below |

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

Branch `ppkt` implements **PPkt**, the packet pattern class: the packet-type
lattice and the `inet::FieldsChunk` classes are derived from the models' own
`partition` and `type in PKT -> NAME` axioms, with no protocol-specific code.
The same code yields MintRoute's `DATA/ROUTE/BEACON` and RTMCS's
`DATA/RREQ/RREP/RRER`.

What it demonstrates, and what it does not, stated plainly:

- The derivation generalises across both case studies, including RTMCS's
  `create_rrer`, whose tag is fixed by elimination rather than by equality.
- The emitted C++ passes a real compiler frontend against INET 4.5 for
  MintRoute M4 (`g++ -fsyntax-only`, exit 0). RTMCS M6 has one remaining
  error, an undeclared `wsnTopology` -- a pre-existing app-layer
  context-emitter gap on a machine never previously gated.
- **The packet classes are emitted but inert.** No generated code yet
  constructs, sends or reads a `PPkt`. Every packet-attribute clause is
  *refused* rather than mistranslated, which is why the visible gap rose from
  153 to 234 for MintRoute M4. That number going up is the point: each rise
  withdrew a translation that did not compile or was silently wrong.
- **The flooding run has not executed.** OMNeT++ 6.3.0 is installed, but its
  bundled compiler directory (`tools/win32.x86_64/mingw64/bin`) is empty and
  `Makefile.inc` wants `ccache clang++`, while the prebuilt `libINET.dll` was
  built by clang. Restoring that toolchain is what unblocks the run.

The remaining gap is not a rule gap. The refused clauses all wait on the same
missing thing -- a `PktId -> PPkt*` identity binding -- which is an event-level
and harness-level change, not a clause-level one.

Evidence trail: [findings/task-reports/](findings/task-reports/), including
`00-decision-ledger.md`, which records every judgment call made during
implementation and the two that turned out to be wrong.

Earlier measurement findings:

- [Gap baseline](findings/2026-09-06-gap-baseline.md) -- counts per machine, and
  the gap grouped into 15 shapes with a missing-rule / missing-interface-machine
  decision for each.
- [INET base class](findings/2026-09-06-inet-base-class.md) -- the target class
  and its obligations, established from INET 4.5 source. Note this conflicts
  with the pattern class diagram's `RoutingProtocolBase`; unresolved, and it
  becomes unavoidable at `PRouteTable`.

# v4_dsr

Structure 4 with the DSR split (`EbWsn`) on the old SensorScope field: the
WBAN/DSR case study (HCMS) of the v4 DSR plan, `design/V4_DSR_Plan.md`.

## Files

| File | What it is |
|---|---|
| `EbWsn.{h,cc,ned}` | `npm run generate -- AppLayer <dir> --v4 --routing dsr` (wsn-codegen 3f68fb5 + the uncommitted AODV and DSR names tables) |
| `SensorScopeNetwork.ned` | the old field, copied from `../v4_aodv` (the sink's only neighbour is sensor6) |
| `omnetpp.ini` | `[General]` = `../v4_aodv`'s verbatim (-85 dBm, 250 kbps); `[Config Control]`, `Route360`, `Route360Plain`, each with its prediction and result |
| `build.sh`, `run.sh` | as `../v4_aodv`'s; the executable is named after the folder |

## Build and run

From PowerShell:

```powershell
$env:MSYSTEM='CLANG64'; $env:CHERE_INVOKING='1'
& 'C:\Users\Komen\Desktop\omnetpp-6.3.0\tools\win32.x86_64\usr\bin\bash.exe' -l /c/Users/Komen/Desktop/Proj/Simulation/v4_dsr/build.sh
```

and the same with `run.sh` (`CONFIG=Control` is the default).

## Step 1 (2026-10-24)

The generator's `--routing dsr`: the RREQ/RREP/RRER partition in its own
context (`C2_dsr`), and the RREQ transmit named `sendRREQ` after the Final
Report (printed p.48); nothing named after INET's AODV. The module is
`../v4_aodv`'s with AODV's names undone, so Control behaves identically: event
#26590, 649 of 649 scalars equal to `../v4_aodv/results/Control-#0.sca`.

## Step 3 (2026-10-24): the DSR test code and the route test

The staged `EbWsn.{h,cc,ned}` are now the edited files from
`scratch/v4_dsr_2026-10-24/paste_dsr/edited/` (13 pasted edits, every line
marked `[DSR test code]`, active only with `dsr = true`).

| File | What it checks |
|---|---|
| `route.mjs <sca> SensorScopeNetwork.ned` | every sensor's cached path against the field (links from the `.ned` positions and the `.sca`'s radio parameters): FAIL, REFUSE (wrong config, sensitivity or rate) or GREEN, with each path, its shortest length and the counters |
| `invariants.sh` | `../v4_aodv`'s battery with the DSR counters (`SCA=<file> ./invariants.sh` checks a recorded run) |
| `type_check.sh`, `leak_check.sh` | per-type conservation and stuck deliveries; each instruments, builds, runs and restores the module |

Results (`results/`):

- Control on the edited files: event #26590, as step 1.
- Route360 (360 s, seed sets 0-4): GREEN x5, RREQs 8/8/8/8/10, all routed by
  12.1 s, no queue overflow; 6 of 40 paths one hop longer than shortest (the
  rebroadcast race; see the ini).
- Route360Plain (route record free on the air): GREEN x5, RREQs 8/9/11/8/11,
  6 of 40 longer.
- `invariants.sh` GREEN on all 11 runs; type and leak checks GREEN on
  Route360 #0.

Run, for example, `CONFIG=Route360 ./run.sh`, then
`node route.mjs "results/Route360-#0.sca" SensorScopeNetwork.ned` from the Bash
tool (`node` is not on the OMNeT++ shell's PATH).

## Step 4 (2026-10-24): the failure tests

`[Config FailSensor5]` and `[Config FailSensor6]`: one node dead from 1 s,
before the first RREQ (timers first fire at 5.1-5.9 s), 360 s, one run each.
`route.mjs` refuses a failure run unless exactly the named node failed and
it sent no model frame before failing.

- FailSensor5 (#26100): GREEN; the seven living sensors routed by 10.1 s,
  none through sensor5, 7 RREQs.
- FailSensor6 (#124896): GREEN; no sensor has a path; 71 RREQs on each living
  sensor (497 in all), no RREP.
- `invariants.sh` GREEN on both; type and leak checks GREEN on FailSensor5.

## Step 5 (2026-10-24): the tree drawing

The test code's TREE DRAWING block (plan B3 a) draws the routes and changes
nothing else: every run above ends at the same event, with every scalar equal.

- With `dsr` on, the sink writes `results/<config>-#<run>-tree.svg` at the end
  of each run:
  - an arrow from each sensor to its path's first hop, blue, or red where
    following first hops never reaches the sink;
  - the path's hop count inside each node, and the radio links heard;
  - a failed node grey with a cross;
  - every sensor's whole path listed below the field, marked where it is not
    its first hop's own path. A DSR route belongs to its originator, so the
    arrows alone do not show it.
- In Qtenv each sensor's arrow follows its cached path (its tooltip is the
  whole path); a failed node turns red.
- `node tree_svg.mjs results/<run>.sca results/<run>-tree.svg` checks a picture
  against its run, reading only the picture and the `.sca`.

## Step 6 (2026-10-24): the paste guide and the user folder

`scratch/v4_dsr_2026-10-24/paste_dsr/GUIDE.md` gives the fifteen paste steps
(made from the same edit list as the staged files). `Proj/copy-sim-dsr/` holds
these three files with the same field, the same settings and each config's
expected result, ready to import into the IDE as a project of its own; built
from scratch, every run there equals the run recorded here.

## The mirror (step 7, 2026-10-24)

`wsn-codegen/docs/harness/v4_dsr/` holds a copy of this folder's source files:
this README, `omnetpp.ini`, `SensorScopeNetwork.ned`, `build.sh`, `run.sh`,
`route.mjs`, `tree_svg.mjs`, and the invariant, type and leak checks with their
probes. Not copied: the staged `EbWsn.{h,cc,ned}` (the generated files with the
DSR test code pasted in; they are `scratch/v4_dsr_2026-10-24/paste_dsr/edited/`,
made by `tools/make_paste_dsr.mjs` from `original/`), the Makefile, `out/`,
`results/`, the logs and the executable. Change a file here, then copy it back.

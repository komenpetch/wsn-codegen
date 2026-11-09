# Usage

Two ways to run WSN-CodeGen: the web application, and a headless command-line interface.
Both use the same engine and produce the same three files.

---

## In the browser

<https://komenpetch.github.io/wsn-codegen/>

Nothing to install. Parsing and generation execute locally in the browser, so the model is
never uploaded.

1. **Load the project.** Choose a Rodin project *folder*, or a *zip* archive of one. It
   needs the `.bum` machines and the `.buc` contexts they see.
2. **Check what was found.** The tool lists the machines in refinement order and names the
   module they merge into. If the chain shown is not the one you expected, the project is
   probably missing a `refinesMachine` link.
3. **Generate**, then save. Where the browser supports the File System Access API you can
   write the three files straight into a directory; otherwise they download as an archive.

The web page always emits **structure 3**, from the project's most-refined machine, with
nothing to choose. A project the network-layer extension does not fit is refused with a
message that names the missing state and points to the command line (`--v2`); it is not
given a different structure silently. An archive that holds two different files with the same
name (two copies of one project, zipped from their parent folder) is refused as well, and the
message names both paths.

---

## From the command line

Requires Node.js 20 or later. The engine is tested on Node 22.

```bash
git clone https://github.com/komenpetch/wsn-codegen
cd wsn-codegen
npm install
npm run generate -- <inputDir> <outDir>
```

`<inputDir>` is the Rodin project directory; `<outDir>` receives `EbWsn.h`, `EbWsn.cc`
and `EbWsn.ned`. For example, with the fixture shipped in the repository:

```bash
npm run generate -- tests/fixtures/shdecom ./out
```

### Selecting the emitted structure

| Flag | Structure | Use it for |
|---|---|---|
| `--v1` | 1 | the paper's V1: `SensorApp`-shaped, transmit not bound. Five files; it sends nothing, by design, and is kept so the before-and-after comparison can be reproduced |
| `--v2` | 2 | the paper's V2: the same shell with the transmit bound. **The default** |
| `--v3` | 3 | the network protocol module with the bundled `PPkt` and `PRouteTable` extension |
| `--v4` | 4 | structure 3 plus the next-hop design; needs a project whose contexts split the control packet type |

```bash
npm run generate -- <inputDir> <outDir> --v3
npm run generate -- <inputDir> <outDir> --v4 --routing aodv
```

`--routing flooding|aodv|dsr` chooses which control-packet split the bundled extension
applies in structures 3 and 4. Without it the tool reads the project's shape: a project that
declares a sink inside `ND` floods, a project that declares one among several destinations
reads as AODV, and a project that names no sink floods. The input is never edited to choose.
`dsr` is structure 4 only.

Two more options: `--machine <name>` generates from a named machine instead of the
most-refined one, and `--no-drain` turns off the bounded repeat of the non-creating events
in each scheduler pass (structures 3 and 4; it is on by default).

The fixture in the repository generates structures 1 to 3. Structure 4 refuses it, because
the fixture's contexts declare no control split.

### Other commands

```bash
npm test                              # 629 tests (365 on a checkout without the advisor's models)
npm run dev                           # run the web app locally
npm run build                         # production build
npm run check:output -- <reference>   # byte-compare every output with a saved reference
node scripts/gen-rule-map.mjs         # regenerate docs/rule-map.md from the rule source
node scripts/gen-rule-map.mjs --check # fail if that file is stale
```

---

## Putting the module into OMNeT++

### Structures 1 and 2: an application

The output plugs in where a node's application goes.

1. Put the three files in a project that references INET 4.5.
2. Point the node's application at the generated class:

   ```ini
   *.sensor[*].app[0].typename = "EbWsn"
   ```

3. Build the project. The generated `.cc` is written to compile against real INET 4.5
   headers with **only the three generated files present**. If it asks for a header you do
   not have, that is a bug, not a missing step.

### Structures 3 and 4: a network protocol

The module is a network protocol sitting directly above the MAC, so the node needs no IPv4
and no application. The generated `.ned` includes a wrapper, `EbWsnNetworkLayer`, that puts
the module beside ARP and a dispatcher. The harness in [`harness/`](harness/README.md) wires
it like this (excerpt from `v4_mintroute/omnetpp.ini`):

```ini
**.hasIpv4 = false
**.hasGn   = true
*.sensor*.numApps = 0
*.sink.numApps    = 0
*.sink.generic.typename    = "EbWsnNetworkLayer"
*.sensor*.generic.typename = "EbWsnNetworkLayer"
*.sink.generic.np.sinkAddress    = "sink"
*.sensor*.generic.np.sinkAddress = "sink"
**.wlan[*].typename       = "WirelessInterface"
**.wlan[*].radio.typename = "ApskScalarRadio"
**.wlan[*].mac.typename   = "Smac"
```

Two things differ from an application. The generated `.ned` declares no package, so the
directory that holds it must be package-less too. And the module needs its own sink address,
because a node recognises the sink by comparing addresses.

For each case study, the page under [Case studies](case-studies/index.md) gives the
configurations, the field and the expected results.

---

## If something does not work

| Symptom | Likely cause |
|---|---|
| "Class `EbWsn` not found" | the simulation was launched from a different project's executable; build and run the project that contains the generated files |
| exit 127 with a message naming `liboppqtenv.dll` | the real cause is a missing `libINET.dll`; run from the OMNeT++ CLANG64 shell, with `source setenv` done and `inet4.5/src` on `PATH` |
| `make` finds no source, or asks for a file that is gone | the Makefile bakes in its source list when `opp_makemake` writes it; regenerate it whenever a file is added, removed or renamed |
| a debug build fails at run time on a missing MAC | the debug INET library in this tree does not contain `Smac`; build the release configuration |
| an action from the model is missing | the model may spell relational override with a printable glyph rather than Rodin's **U+E103**; see [Documentation §2](documentation.md) |
| `// UNTRANSLATED` in the output | the catalog has no rule for that clause. The event is deliberately closed with `return false` so it cannot report a transition that did not happen. Nothing is silently lost |
| the module runs but sends nothing | check whether you generated with `--v1`; sending nothing is that structure's documented behaviour |
| a multi-hop run looks like a single hop | open the `.sca` and read the `attr configname` line and the **per-module** `sensitivity` line, not the `config` lines. A network and a radio setting that do not move together can turn a multi-hop field into a full mesh, and every node then reports the same counts |
| the pasted test code is not running | a forgotten paste is silent: the module runs, no result scalars appear and the event count differs from the case study's. Check that the switch (`mintRoute`, `aodv` or `dsr`) is set and that the paste steps were all applied |
| a second run in the same Qtenv window behaves differently | fixed in the generator on 2026-10-14 (protocol registration) and 2026-10-18 (node sets); regenerate the module if it predates those |

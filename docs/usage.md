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

## From the command line

Requires Node.js. The engine is tested on **Node v22**.

```bash
git clone https://github.com/komenpetch/wsn-codegen
cd wsn-codegen
npm install
npm run generate -- <inputDir> <outDir>
```

`<inputDir>` is the Rodin project directory; `<outDir>` receives `<Name>.h`, `<Name>.cc`
and `<Name>.ned`. For example:

```bash
npm run generate -- ../Update_wsn/C0_project ./out
```

### Selecting the emitted structure

The generator keeps four emitters from its development history. **`--v4` is the default and
is the one to use.**

```bash
npm run generate -- <inputDir> <outDir> --v4
```

`--v1` and `--v2` are frozen artefacts of a superseded architecture. `--v3` is the
`SensorApp`-shaped shell *before* the behavioural-parity correction: it compiles and runs
but transmits nothing, and it is retained only so that the before/after comparison in the
paper can be reproduced rather than described. (The paper calls `--v3` and `--v4` **V1** and
**V2**, numbering them in the order it compares them.)

### Other commands

```bash
npm test                              # engine unit and snapshot tests
npm run dev                           # run the web app locally
npm run build                         # production build
node scripts/gen-rule-map.mjs         # regenerate docs/rule-map.md from the rule source
node scripts/gen-rule-map.mjs --check # fail if that file is stale
```

---

## Putting the module into OMNeT++

The output is an application-layer module, so it plugs in where a node's application goes —
not as a network-layer wrapper.

1. Put the three files in a project that references INET 4.5.
2. Point the node's application at the generated class:

   ```ini
   *.sensor[*].app[0].typename = "<Name>"
   ```

3. Build the project. The generated `.cc` is written to compile against real INET 4.5
   headers with **only the three generated files present** — if it asks for a header you
   do not have, that is a bug, not a missing step.

A worked harness — one sink and three sensor nodes over the ApSK radio, S-MAC and WiseRoute
stack — is described in the paper, along with the packet counts it produces.

### If something does not work

| Symptom | Likely cause |
|---|---|
| "Class `<Name>` not found" | the simulation was launched from a different project's executable; build and run the project that contains the generated files |
| An action from the model is missing | the model may spell relational override with a printable glyph rather than Rodin's **U+E103**; see [Documentation §2](documentation.md) |
| `// UNTRANSLATED` in the output | the catalog has no rule for that clause. The event is deliberately closed with `return false` so it cannot report a transition that did not happen. Nothing is silently lost |
| The module runs but sends nothing | check you did not generate with `--v3`; that is the frozen pre-correction structure and sending nothing is its documented behaviour |

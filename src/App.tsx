import { useRef, useState, type DragEvent } from "react";
import { generateMerged, machineNames, leafMachine, defaultName } from "./engine/pipeline";
import { readFolder, readZip, writeTree } from "./io/fileOutput";

type EbFiles = { name: string; xml: string }[];

// The page does one thing: one project in, one module out. It always emits
// structure 3 (structure 2's module carrying the bundled PPkt + PRouteTable
// extension) from the leaf machine, which the whole chain merges into.
//
// ⚠ The target-machine and structure selectors were removed on purpose
// (2026-10-06). Structures 1 and 2 are paper2's V1/V2 compare-table artifacts
// and a non-leaf target exists for MintRoute, whose leaf M5 does not compile;
// both stay reachable from the command line (`--v1/--v2`, `--machine`). A
// project the extension does not fit is REFUSED by the engine, with a message
// pointing there, rather than silently given another structure.
const STRUCTURE = 3;

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<EbFiles>([]);
  const [machines, setMachines] = useState<string[]>([]);
  const [outputName, setOutputName] = useState("");
  // The leaf's derived name, kept as the placeholder once the user clears the field.
  const [defaultOut, setDefaultOut] = useState("");
  const zipInput = useRef<HTMLInputElement>(null);
  const append = (s: string) => setLog((l) => [...l, s]);

  // Load Event-B files from any source (folder picker, zip button, drag-drop)
  // and detect every machine. The tool is name-agnostic — any refinement chain
  // (pM1/uM2/pM3/uM4/pM5/…) is supported. The output name defaults to the
  // most-refined (leaf) machine, which the whole project merges into.
  async function loadWith(read: () => Promise<EbFiles>) {
    setBusy(true);
    try {
      const f = await read();
      const names = f.length ? machineNames(f) : [];
      const name = names.length ? defaultName(leafMachine(f)) : "";
      setFiles(f);
      setMachines(names);
      setDefaultOut(name);
      setOutputName(name);
      if (names.length) {
        append(`Loaded ${f.length} file(s); machines (base → leaf): ${names.join(" → ")}.`);
      } else if (f.length) {
        append(`Loaded ${f.length} file(s) but none is an Event-B machine (.bum).`);
      } else {
        // Folder picking is not recursive: the picked folder itself must hold
        // the .bum files (a Rodin project folder is flat).
        append(
          "No .bum/.buc files found. Pick the Rodin project folder itself " +
          "(the one that directly contains the .bum files), or load a .zip of it.",
        );
      }
    } catch (e) {
      // A cancelled picker rejects with AbortError — a normal user choice.
      if ((e as Error).name === "AbortError") append("Cancelled.");
      else append(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // Merge the whole project into one module (the most-refined machine, flattened
  // over its refines chain) and let the user save the three files.
  async function runGenerate() {
    if (!files.length) return append("Load Event-B files first.");
    if (!outputName.trim()) return append("Enter an output name.");
    setBusy(true);
    try {
      append(`Merging ${machines.join(" → ")} → ${outputName.trim()}…`);
      // v4: self-contained output. Earlier structures #include the eb_context.h
      // / eb_helpers.h fixtures, which only the CLI staged — a download from
      // here shipped neither and could not compile.
      //
      // Timed here so the deployed tool can show what generation costs on the
      // artefact people actually run. ONLY generateMerged is inside the timer:
      // writeTree awaits a folder picker, and user think-time is not generation
      // time.
      //
      // THIS IS A DEMONSTRATION FIGURE, NOT THE PAPER'S MEASUREMENT. Browsers
      // clamp performance.now() to 100 us for Spectre mitigation, which is
      // coarser than three of the pipeline's four stages, and give no reliable
      // heap reading at all. The paper's efficiency section uses the Node
      // campaign (paper2/data/MEASURING.md), which has a sub-microsecond clock
      // and an exact post-GC heap baseline. The caveat travels with the number,
      // in the console object below, so it cannot be quoted out of context.
      const t0 = performance.now();
      // The pattern extension ships inside the tool, so there is no second
      // project to upload: the leaf, structure 3, nothing else to choose.
      const tree = generateMerged(files, outputName.trim(), STRUCTURE);
      const genMs = performance.now() - t0;

      const outLines = tree.reduce(
        (n, x) => n + x.content.replace(/\n$/, "").split("\n").length, 0);
      append(`Generated in ${genMs.toFixed(1)} ms (${outLines} lines). See the browser console for detail.`);
      console.info("WSN-CodeGen generation", {
        generationMs: Number(genMs.toFixed(3)),
        inputFiles: files.length,
        machines: machines.length,
        structure: STRUCTURE,
        mergedInto: outputName.trim(),
        emittedFiles: tree.map((f) => f.path),
        emittedLines: outLines,
        note:
          "Wall-clock for the generation pipeline only, excluding file output. " +
          "Browsers clamp performance.now() to ~100 us, so this is a single " +
          "end-to-end figure and cannot be broken down by stage; peak heap is " +
          "not measurable here at all. It demonstrates that generation is " +
          "interactive, and is NOT the measurement reported in the paper.",
      });

      const mode = await writeTree(tree);
      append(
        mode === "folder"
          ? `✓ Wrote ${tree.length} files (${tree.map((f) => f.path).join(", ")}) to chosen folder.`
          : mode === "zip-fallback"
            // Say that the folder was attempted and failed. Reporting a plain
            // download would hide why the files did not land where the user asked.
            ? `✓ Downloaded generated-cpp.zip (${tree.length} files) — the folder picker was unavailable, so the zip was used instead.`
            : `✓ Downloaded generated-cpp.zip (${tree.length} files).`,
      );
    } catch (e) {
      if ((e as Error).name === "AbortError") append("Cancelled.");
      else append(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function pickFolder() {
    append("Selecting Event-B folder…");
    void loadWith(readFolder);
  }

  function pickZip(file: File | undefined) {
    if (!file) return;
    append(`Reading ${file.name}…`);
    void loadWith(() => readZip(file));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = Array.from(e.dataTransfer.files).find((f) => /\.zip$/i.test(f.name));
    if (!file) {
      append("Drop a .zip file (a zipped Rodin project).");
      return;
    }
    pickZip(file);
  }

  return (
    <div
      className={
        "min-h-screen bg-gray-50 p-8 font-mono text-gray-900 " +
        (dragging ? "ring-4 ring-inset ring-blue-300" : "")
      }
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <h1 className="text-xl font-bold text-gray-900">wsn-codegen</h1>
      <p className="mt-1 text-sm text-gray-600">
        Generate compilable OMNeT++/INET&nbsp;4.5 C++ from a pattern-based WSN Event-B model.
      </p>

      <div className="mt-4 max-w-2xl space-y-2 text-sm text-gray-700">
        <p>
          Load a folder of Event-B <code>.bum</code> files (a Rodin project export) — or a{" "}
          <code>.zip</code> of that project. The tool detects every machine, <strong>merges the whole
          refinement chain</strong> into one module, and emits exactly three files —{" "}
          <code>&lt;Name&gt;.h</code>, <code>&lt;Name&gt;.cc</code>, <code>&lt;Name&gt;.ned</code> — to a
          folder you choose (Chrome/Edge) or a downloaded zip. Any chain
          (<code>pM1/uM2/pM3/uM4/pM5/…</code>) works — names are not fixed.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={pickFolder}
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Working…" : "Load Event-B folder"}
        </button>
        <button
          onClick={() => zipInput.current?.click()}
          disabled={busy}
          className="rounded border border-blue-600 px-4 py-2 text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          or load a .zip
        </button>
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            pickZip(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      <p className="mt-2 text-xs text-gray-500">…or drag a .zip anywhere onto this page.</p>

      {machines.length > 0 && (
        <div className="mt-5 flex max-w-2xl flex-wrap items-end gap-4 rounded border border-gray-200 bg-white p-4">
          <p className="w-full text-sm text-gray-700">
            <strong>{machines.length} machine(s)</strong> ({machines.join(" → ")}) → merged into one
            module ({outputName || "…"}.h/.cc/.ned).
          </p>
          <p className="w-full text-sm text-gray-700">
            The module carries the <em>PPkt</em> and <em>PRouteTable</em> patterns, which ship
            inside the tool, so there is nothing more to upload.
          </p>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Output name
            <input
              type="text"
              value={outputName}
              disabled={busy}
              onChange={(e) => setOutputName(e.target.value)}
              placeholder={defaultOut}
              className="rounded border border-gray-300 px-2 py-1"
            />
          </label>
          <button
            onClick={() => void runGenerate()}
            disabled={busy}
            className="rounded bg-green-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Working…" : "Generate → save"}
          </button>
        </div>
      )}

      <pre className="mt-3 h-64 overflow-auto rounded bg-black p-3 text-green-400">
        {log.length
          ? log.join("\n")
          : "Log output appears here. No Rodin export handy? Load the bundled tests/fixtures/shdecom folder."}
      </pre>
    </div>
  );
}

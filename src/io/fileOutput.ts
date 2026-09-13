import JSZip from "jszip";
import type { GeneratedTree } from "../engine/types";

// The File System Access API (showDirectoryPicker / createWritable) is not in
// the standard TypeScript DOM lib, so the minimal surface used here is declared
// locally. Runtime behavior is the browser-native API.
interface FsWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FsFileHandle {
  kind: "file";
  getFile(): Promise<File>;
  createWritable(): Promise<FsWritable>;
}
interface FsDirHandle {
  kind: "directory";
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
  entries(): AsyncIterableIterator<[string, FsFileHandle | FsDirHandle]>;
}
type ShowDirectoryPicker = (options?: { mode?: "read" | "readwrite" }) => Promise<FsDirHandle>;

// Truthy feature-detect rather than `"showDirectoryPicker" in window`: a stub or
// polyfill that sets the property to undefined must still fall back, not throw.
const fsWindow = window as unknown as { showDirectoryPicker?: ShowDirectoryPicker };

export async function readFolder(): Promise<{ name: string; xml: string }[]> {
  // Chrome/Edge: native directory picker. Everything else (Firefox, Safari,
  // mobile) has no showDirectoryPicker, so fall back to a hidden
  // <input webkitdirectory> — same feature-detect shape writeTree uses.
  if (fsWindow.showDirectoryPicker) {
    const dir = await fsWindow.showDirectoryPicker();
    const files: { name: string; xml: string }[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "file" && /\.(bum|buc)$/.test(name)) {
        const file = await handle.getFile();
        files.push({ name, xml: await file.text() });
      }
    }
    return files;
  }
  return readFolderViaInput();
}

// Fallback for browsers without the File System Access API. webkitdirectory
// yields a flat FileList of the chosen folder's contents; keep only .bum/.buc
// and map each to {name (basename), xml (text)} — the same shape the
// showDirectoryPicker path returns.
function readFolderViaInput(): Promise<{ name: string; xml: string }[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    // webkitdirectory is non-standard and absent from the input lib types.
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.oncancel = () => resolve([]);
    input.onchange = async () => {
      try {
        const picked = Array.from(input.files ?? []).filter((f) =>
          /\.(bum|buc)$/.test(f.name),
        );
        // ⚠ webkitdirectory yields a RECURSIVE flat FileList and `f.name` is the
        // basename, so picking a parent folder that holds two projects has the
        // same collision the zip path has. Same guard, one implementation.
        // (readFolder's showDirectoryPicker branch walks `dir.entries()`, which
        // is one level and cannot produce a duplicate name, so it needs none.)
        resolve(dedupeProjectFiles(
          await Promise.all(
            picked.map(async (f) => ({
              name: f.name,
              xml: await f.text(),
              path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
            })),
          ),
        ));
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}

// One Rodin file on its way in: `name` is the basename the parser keys on,
// `path` is where it came from (archive entry or folder-relative path) and is
// used only to explain a collision.
interface ProjectFile { name: string; xml: string; path?: string }

// ⚠ BOTH separators. The ZIP spec says entry names use forward slashes, but
// PowerShell's Compress-Archive writes BACKSLASHES and JSZip reports them
// verbatim -- so splitting on "/" alone left the whole path as the "basename"
// and the parser was handed a file called `MintRoute_amiCheck\M4.bum`.
//
// That also made the duplicate guard below blind to exactly the archives most
// likely to need it: a zip of a parent folder holding two projects, made on
// Windows. With the directory still in the name the two copies never collided.
// Measured on the real WSN_MintRoute_3_2_5_9 zip: 26 entries, 26 "distinct"
// names, no refusal.
//
// lastIndexOf twice rather than a regex: no escaping to get wrong, and this
// project has lost time to a mangled `\s` more than once.
const basenameOf = (path: string): string =>
  path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

// ⚠ A project is read by BASENAME, from anywhere in the archive or folder tree.
// That is deliberate — a Rodin export nests its files under a project directory,
// and several nest them one level deeper still. But it means a selection holding
// TWO projects flattens into one, and any basename they share resolves to
// whichever the iteration reached last, silently.
//
// That is not hypothetical. The 2026-09-13 four-hop simulation result was
// generated from `MintRoute_3_2_5_9_complete_edited2.deprecated` rather than the
// maintained `..._complete_amiCheck`, because the packet-source zip was made
// from the PARENT folder holding both. All 13 of their .bum/.buc basenames
// collide, "amiCheck" sorts first, and the deprecated copy overwrote it. The
// output compiled, ran, and produced a plausible result from the wrong model.
//
// Identical bytes under two paths are NOT ambiguous — there is nothing to choose
// between, so one is kept. Keeping both would hand the parser two machines of
// the same name, which is its own failure.
export function dedupeProjectFiles(
  files: readonly ProjectFile[],
): { name: string; xml: string }[] {
  const byName = new Map<string, ProjectFile>();
  for (const f of files) {
    const seen = byName.get(f.name);
    if (!seen) { byName.set(f.name, f); continue; }
    if (seen.xml === f.xml) continue;
    throw new Error(
      `This selection holds more than one Rodin project: "${f.name}" appears twice `
      + `with different contents, at "${seen.path ?? seen.name}" and "${f.path ?? f.name}". `
      + `A project is read by file name from anywhere in the selection, so the two would be `
      + `merged and one silently overwritten — you would get a module built from whichever `
      + `copy happened to come last. Select a single project directory.`);
  }
  return [...byName.values()].map(({ name, xml }) => ({ name, xml }));
}

// Read a zipped Rodin project (the "Pick .zip" button or a drag-and-drop). Pull
// every .bum/.buc entry from anywhere in the archive and return the same
// {name (basename), xml} shape as readFolder, so the pipeline downstream is
// identical regardless of whether the input was a folder or a zip.
export async function readZip(file: Blob): Promise<{ name: string; xml: string }[]> {
  const zip = await JSZip.loadAsync(file);
  const files: ProjectFile[] = [];
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir && /\.(bum|buc)$/i.test(entry.name)) {
      files.push({ name: basenameOf(entry.name), xml: await entry.async("string"),
        path: entry.name });
    }
  }
  return dedupeProjectFiles(files);
}

// How the three files reached the user. `zip-fallback` is a zip that was NOT the
// first choice: the directory picker existed and failed, so the caller should say
// so rather than reporting a plain download.
export type WriteOutcome = "folder" | "zip" | "zip-fallback";

async function downloadZip(tree: GeneratedTree): Promise<void> {
  const zip = new JSZip();
  for (const f of tree) zip.file(f.path, f.content);
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "generated-cpp.zip";
  a.click();
  URL.revokeObjectURL(url);
}

export async function writeTree(tree: GeneratedTree): Promise<WriteOutcome> {
  // ⚠ The zip used to be reachable ONLY when showDirectoryPicker was absent, so
  // a browser that HAS the picker and then refuses it left the user with
  // nothing at all: no folder, no zip, one error line, and a generation they
  // would have to run again. Measured in the in-app browser, where the picker
  // exists and rejects with "Must be handling a user gesture". Firefox and
  // Safari were never exposed — they have no picker and always took the zip.
  //
  // This is the same shape as the 2026-07-21 defect where the shipped path
  // differed from the tested one: the fallback existed and the failing case
  // could not reach it.
  if (fsWindow.showDirectoryPicker) {
    try {
      const dir = await fsWindow.showDirectoryPicker({ mode: "readwrite" });
      for (const f of tree) {
        const handle = await dir.getFileHandle(f.path, { create: true });
        const w = await handle.createWritable();
        await w.write(f.content);
        await w.close();
      }
      return "folder";
    } catch (e) {
      // ⚠ A CANCELLED picker is a decision, not a failure. Turning it into a
      // surprise download would hand the user a file they just declined to
      // save, so AbortError alone keeps propagating — App.tsx reports it as
      // "Cancelled." Everything else falls through to the zip.
      if ((e as Error).name === "AbortError") throw e;
      await downloadZip(tree);
      return "zip-fallback";
    }
  }
  await downloadZip(tree);
  return "zip";
}

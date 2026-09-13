// @vitest-environment jsdom
//
// The SAVE path, which had no test at all — and that is exactly how its gap
// survived: the zip fallback was reachable only when `showDirectoryPicker` was
// ABSENT, so every browser that has the picker and then refuses it left the
// user with no files and one error line. The suite runs in `node` by default
// (the engine is pure), so this file opts into jsdom for `document` and `URL`.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import JSZip from "jszip";
import { writeTree, readZip, dedupeProjectFiles } from "../src/io/fileOutput";
import type { GeneratedTree } from "../src/engine/types";

const tree: GeneratedTree = [
  { path: "Pm3Wsn.h", content: "// header" },
  { path: "Pm3Wsn.cc", content: "// impl" },
  { path: "Pm3Wsn.ned", content: "// ned" },
];

// Anchor clicks are what a zip download is; capture them instead of navigating.
let clicked: string[];
let origClick: () => void;

beforeEach(() => {
  clicked = [];
  origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    clicked.push(this.download);
  };
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  HTMLAnchorElement.prototype.click = origClick;
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

const setPicker = (fn: unknown) => {
  (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = fn;
};

describe("writeTree: the user gets the files, or a reason", () => {
  it("falls back to the zip when the picker exists and FAILS", async () => {
    // The real case, reproduced: the in-app browser has the picker and rejects
    // it with "Must be handling a user gesture". Before the fix this threw and
    // the user got nothing.
    setPicker(() => {
      const e = new Error("Must be handling a user gesture to show a file picker.");
      e.name = "SecurityError";
      return Promise.reject(e);
    });
    await expect(writeTree(tree)).resolves.toBe("zip-fallback");
    expect(clicked).toEqual(["generated-cpp.zip"]);
  });

  it("still downloads the zip when there is no picker at all", async () => {
    // Firefox and Safari. This path always worked; it must keep working, and it
    // must stay DISTINGUISHABLE from the fallback so the UI can explain itself.
    await expect(writeTree(tree)).resolves.toBe("zip");
    expect(clicked).toEqual(["generated-cpp.zip"]);
  });

  it("⚠ does NOT turn a cancelled picker into a surprise download", async () => {
    // A user who dismisses the picker has decided not to save. Handing them a
    // download instead would be the tool overriding that decision, so AbortError
    // alone keeps propagating — App.tsx reports it as "Cancelled."
    setPicker(() => {
      const e = new Error("The user aborted a request.");
      e.name = "AbortError";
      return Promise.reject(e);
    });
    await expect(writeTree(tree)).rejects.toThrow(/aborted/i);
    expect(clicked).toEqual([]);
  });

  it("writes every file to the folder when the picker succeeds", async () => {
    const written = new Map<string, string>();
    setPicker(() => Promise.resolve({
      getFileHandle: (name: string) => Promise.resolve({
        createWritable: () => Promise.resolve({
          write: (data: string) => { written.set(name, data); return Promise.resolve(); },
          close: () => Promise.resolve(),
        }),
      }),
    }));
    await expect(writeTree(tree)).resolves.toBe("folder");
    expect([...written.keys()].sort()).toEqual(["Pm3Wsn.cc", "Pm3Wsn.h", "Pm3Wsn.ned"]);
    expect(written.get("Pm3Wsn.h")).toBe("// header");
    expect(clicked).toEqual([]);   // no stray download beside the folder write
  });

  it("falls back if the picker opens but a WRITE fails part way", async () => {
    // Permission revoked, disk full, a handle that goes away. Some files may
    // already be on disk; the zip at least hands over the complete set rather
    // than leaving the user with a partial folder and an error.
    let n = 0;
    setPicker(() => Promise.resolve({
      getFileHandle: () => Promise.resolve({
        createWritable: () => Promise.resolve({
          write: () => (++n > 1 ? Promise.reject(new Error("quota")) : Promise.resolve()),
          close: () => Promise.resolve(),
        }),
      }),
    }));
    await expect(writeTree(tree)).resolves.toBe("zip-fallback");
    expect(clicked).toEqual(["generated-cpp.zip"]);
  });
});

// ⚠ A Rodin project is read by BASENAME, from anywhere in the archive or folder
// tree. That is deliberate -- an export nests the files under a project
// directory -- but it means an input holding TWO projects silently flattens
// into one, and any basename they share resolves to whichever came last.
//
// This is not hypothetical. The four-hop simulation result of 2026-09-13 was
// generated from `MintRoute_3_2_5_9_complete_edited2.deprecated` because the
// packet-source zip was made from the PARENT folder, which also holds
// `MintRoute_3_2_5_9_complete_amiCheck`. All 13 of their .bum/.buc basenames
// collide, "amiCheck" sorts first, and the deprecated copy overwrote the
// maintained one with no warning anywhere.
describe("reading a project refuses an ambiguous input instead of picking one", () => {
  const zipOf = async (entries: Record<string, string>): Promise<Blob> => {
    const z = new JSZip();
    for (const [path, body] of Object.entries(entries)) z.file(path, body);
    return z.generateAsync({ type: "blob" });
  };

  it("refuses an archive holding two DIFFERENT files under one basename", async () => {
    await expect(readZip(await zipOf({
      "MintRoute_complete_amiCheck/M4.bum": "<machine>ami</machine>",
      "MintRoute_complete_edited2.deprecated/M4.bum": "<machine>deprecated</machine>",
    }))).rejects.toThrow(/M4\.bum/);
  });

  it("names BOTH paths, so the reason is diagnosable from the message alone", async () => {
    // "M4.bum appears twice" is not actionable; the two directories are.
    await expect(readZip(await zipOf({
      "a_amiCheck/M4.bum": "<machine>one</machine>",
      "b_deprecated/M4.bum": "<machine>two</machine>",
    }))).rejects.toThrow(/a_amiCheck.*b_deprecated|b_deprecated.*a_amiCheck/s);
  });

  it("accepts an IDENTICAL duplicate, keeping one copy", async () => {
    // Same bytes under two paths is not ambiguous -- there is nothing to
    // choose between. Keeping both would hand the parser two machines of the
    // same name, which is its own failure.
    const files = await readZip(await zipOf({
      "proj/M4.bum": "<machine>same</machine>",
      "backup/M4.bum": "<machine>same</machine>",
    }));
    expect(files).toEqual([{ name: "M4.bum", xml: "<machine>same</machine>" }]);
  });

  it("still reads an ordinary single-project archive", async () => {
    const files = await readZip(await zipOf({
      "C0_project/pM1.bum": "<m>1</m>",
      "C0_project/C0.buc": "<c>0</c>",
      "C0_project/notes.txt": "ignored",
    }));
    expect(files.map((f) => f.name).sort()).toEqual(["C0.buc", "pM1.bum"]);
  });

  it("⚠ takes the basename from a WINDOWS-made archive, which uses backslashes", async () => {
    // PowerShell's Compress-Archive writes entry names with backslash
    // separators, and JSZip reports them verbatim. Splitting on "/" alone
    // leaves the WHOLE PATH as the basename, so the parser is handed a file
    // called "MintRoute_amiCheck\M4.bum" instead of "M4.bum".
    const files = await readZip(await zipOf({
      "MintRoute_amiCheck\\M4.bum": "<machine>ami</machine>",
    }));
    expect(files.map((f) => f.name)).toEqual(["M4.bum"]);
  });

  it("⚠ refuses a WINDOWS-made archive holding two projects", async () => {
    // The duplicate guard was blind to exactly the archives most likely to
    // have the problem: a zip of a parent folder, made on Windows. With the
    // path left in the name the two copies never appeared to collide.
    await expect(readZip(await zipOf({
      "MintRoute_amiCheck\\C0.buc": "<c>one</c>",
      "MintRoute_edited2.deprecated\\C0.buc": "<c>two</c>",
    }))).rejects.toThrow(/C0\.buc/);
  });

  it("guards the FOLDER path too, which flattens basenames the same way", async () => {
    // webkitdirectory yields a recursive flat FileList and readFolderViaInput
    // keys on f.name, so picking a parent folder has the identical defect.
    // Both paths share this helper rather than checking it twice.
    expect(() => dedupeProjectFiles([
      { name: "M4.bum", xml: "<a/>" },
      { name: "M4.bum", xml: "<b/>" },
    ])).toThrow(/M4\.bum/);
  });
});

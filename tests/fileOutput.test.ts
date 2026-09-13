// @vitest-environment jsdom
//
// The SAVE path, which had no test at all — and that is exactly how its gap
// survived: the zip fallback was reachable only when `showDirectoryPicker` was
// ABSENT, so every browser that has the picker and then refuses it left the
// user with no files and one error line. The suite runs in `node` by default
// (the engine is pure), so this file opts into jsdom for `document` and `URL`.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeTree } from "../src/io/fileOutput";
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

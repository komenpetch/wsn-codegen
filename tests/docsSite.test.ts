// The documentation site: docs/*.md rendered to HTML under dist/docs.
//
// What this guards is the same failure the project's CI has paid for before, in
// a new place: a page that builds without error and links to something that is
// not there. So the checks are on the OUTPUT -- every internal link must land on
// a file the build actually wrote -- and not on the renderer.
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, posix } from "node:path";
import JSZip from "jszip";
import { buildDocs, PUBLISHED, DOWNLOADS } from "../scripts/build-docs";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const hrefs = (html: string): string[] => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("documentation site, built from the real docs/", () => {
  let out = "";
  let problems: string[] = [];

  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), "docsite-"));
    problems = (await buildDocs({ outDir: out })).problems;
  });

  it("builds without a single problem", () => {
    expect(problems).toEqual([]);
  });

  it("writes one page for every published source, and the stylesheet", () => {
    for (const p of PUBLISHED) expect(existsSync(join(out, p.replace(/\.md$/, ".html"))), p).toBe(true);
    expect(existsSync(join(out, "docs.css"))).toBe(true);
  });

  it("publishes the pages that answer the paper, including all four case studies", () => {
    for (const p of [
      "index.md",
      "documentation.md",
      "usage.md",
      "about.md",
      "case-studies/index.md",
      "case-studies/sensorapp.md",
      "case-studies/mintroute.md",
      "case-studies/aodv.md",
      "case-studies/dsr.md",
    ])
      expect(PUBLISHED, p).toContain(p);
  });

  it("does not render the internal working logs as documentation", () => {
    // Dated findings and harness readmes name local paths and files that are not
    // in the repository. They are linked to on GitHub instead (below).
    for (const p of PUBLISHED) {
      expect(p, p).not.toMatch(/^(findings|harness|agents)\//);
      expect(p, p).not.toMatch(/AUDIT_|OMNETPP_INTEGRATION|design-base-class/);
    }
  });

  it("leaves no relative link pointing at a Markdown source", () => {
    // A link to a .md file ON GITHUB is correct; only a relative one would be a dead end.
    for (const f of walk(out).filter((x) => x.endsWith(".html"))) {
      for (const h of hrefs(readFileSync(f, "utf8"))) {
        if (/^(https?:|mailto:|#)/.test(h)) continue;
        expect(h, `${f} -> ${h}`).not.toMatch(/\.md(#|$)/);
      }
    }
  });

  it("makes every internal link land on a file the build wrote", () => {
    for (const f of walk(out).filter((x) => x.endsWith(".html"))) {
      for (const h of hrefs(readFileSync(f, "utf8"))) {
        if (/^(https?:|mailto:|#)/.test(h)) continue;
        const target = resolve(dirname(f), decodeURI(h.split("#")[0]));
        expect(existsSync(target), `${f} -> ${h}`).toBe(true);
      }
    }
  });

  it("links the harness and findings to their source on GitHub", () => {
    const html = readFileSync(join(out, "case-studies", "mintroute.html"), "utf8");
    expect(html).toContain("https://github.com/komenpetch/wsn-codegen/blob/main/docs/harness/v4_mintroute/README.md");
  });

  it("links source files outside docs/ to the repository too", () => {
    const html = readFileSync(join(out, "rule-map.html"), "utf8");
    expect(html).toContain("https://github.com/komenpetch/wsn-codegen/blob/main/src/engine/rules.ts");
  });

  it("gives every page the same navigation, with the correct relative paths from a subfolder", () => {
    const html = readFileSync(join(out, "case-studies", "aodv.html"), "utf8");
    expect(html).toContain('href="../index.html"');
    expect(html).toContain('href="../documentation.html"');
    expect(html).toContain('href="index.html"'); // "Case studies" from inside the folder
    expect(html).toContain('href="../docs.css"');
  });

  it("renders tables and code, the two things these pages are mostly made of", () => {
    const html = readFileSync(join(out, "documentation.html"), "utf8");
    expect(html).toContain("<table>");
    expect(html).toContain("<code>");
  });

  it("gives headings ids, so a link can name a section", () => {
    const html = readFileSync(join(out, "documentation.html"), "utf8");
    expect(html).toMatch(/<h2 id="[a-z0-9-]+">/);
  });

  it("does not repeat the site name in the home page's title", () => {
    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html).toMatch(/<title>WSN-CodeGen<\/title>/);
  });

  it("shows every figure it refers to, and the figure files exist", () => {
    let seen = 0;
    for (const f of walk(out).filter((x) => x.endsWith(".html"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/<img[^>]*src="([^"]+)"/g)) {
        seen++;
        expect(existsSync(resolve(dirname(f), m[1])), `${f} -> ${m[1]}`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(6); // home pipeline + matrix, documentation, three case studies
  });

  it("builds the downloads from the fixture, so they match the current generator", async () => {
    for (const d of DOWNLOADS) expect(existsSync(join(out, d)), d).toBe(true);
    const names = async (d: string) =>
      Object.entries((await JSZip.loadAsync(readFileSync(join(out, d)))).files)
        .filter(([, f]) => !f.dir).map(([n]) => n).sort();
    expect(await names("downloads/shdecom-project.zip")).toEqual(
      ["shdecom/cM2.buc", "shdecom/pM1.bum", "shdecom/pM3.bum", "shdecom/uM2.bum"]);
    for (const d of DOWNLOADS.slice(1))
      expect(await names(d), d).toEqual(["EbWsn.cc", "EbWsn.h", "EbWsn.ned"]);
  });

  it("links the example project from the home page and from the tool", () => {
    const home = readFileSync(join(out, "index.html"), "utf8");
    expect(home).toContain('href="downloads/shdecom-project.zip"');
    expect(home).not.toContain("Four emitted structures");
    const app = readFileSync(join(__dirname, "..", "src", "App.tsx"), "utf8");
    expect(app).toContain("docs/downloads/shdecom-project.zip");
  });

  it("gives the four case-study pages the same sections in the same order", () => {
    const want = ["Input", "Generated and pasted", "Run it", "Expected result", "What it does not show"];
    for (const p of ["sensorapp", "mintroute", "aodv", "dsr"]) {
      const html = readFileSync(join(out, "case-studies", `${p}.html`), "utf8");
      const heads = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1].trim());
      const picked = heads.filter((h) => want.includes(h));
      expect(picked, p).toEqual(want);
    }
  });

  it("names the page in its title", () => {
    const html = readFileSync(join(out, "case-studies", "dsr.html"), "utf8");
    expect(html).toMatch(/<title>Case study: DSR/);
  });
});

describe("documentation site, on a tree with a broken link", () => {
  const make = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), "docsrc-"));
    for (const [name, body] of Object.entries(files)) {
      const p = join(root, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
    }
    return root;
  };

  it("reports a link to a page that does not exist", async () => {
    const docsDir = make({ "index.md": "# Home\n\nSee [nothing](missing.md).\n" });
    const r = await buildDocs({ docsDir, outDir: mkdtempSync(join(tmpdir(), "o-")), pages: ["index.md"], downloads: false });
    expect(r.problems.join("\n")).toMatch(/index\.md.*missing\.md/);
  });

  it("reports a link that leaves the repository", async () => {
    const docsDir = make({ "index.md": "# Home\n\n[x](../../../outside.md)\n" });
    const r = await buildDocs({ docsDir, outDir: mkdtempSync(join(tmpdir(), "o-")), pages: ["index.md"], downloads: false });
    expect(r.problems.join("\n")).toMatch(/outside\.md/);
  });

  it("reports a published page that is missing", async () => {
    const docsDir = make({ "index.md": "# Home\n" });
    const r = await buildDocs({ docsDir, outDir: mkdtempSync(join(tmpdir(), "o-")), pages: ["index.md", "gone.md"], downloads: false });
    expect(r.problems.join("\n")).toMatch(/gone\.md/);
  });

  it("rewrites a link between published pages and keeps its anchor", async () => {
    const docsDir = make({ "index.md": "# Home\n\n[d](a/b.md#sec)\n", "a/b.md": "# B\n\n## Sec\n" });
    const o = mkdtempSync(join(tmpdir(), "o-"));
    const r = await buildDocs({ docsDir, outDir: o, pages: ["index.md", "a/b.md"], downloads: false });
    expect(r.problems).toEqual([]);
    expect(readFileSync(join(o, "index.html"), "utf8")).toContain('href="a/b.html#sec"');
    expect(existsSync(join(o, "a", "b.html"))).toBe(true);
    expect(posix.basename("a/b.html")).toBe("b.html");
  });

  it("leaves external links alone", async () => {
    const docsDir = make({ "index.md": "# Home\n\n[x](https://example.org/a.md)\n" });
    const o = mkdtempSync(join(tmpdir(), "o-"));
    await buildDocs({ docsDir, outDir: o, pages: ["index.md"], downloads: false });
    expect(readFileSync(join(o, "index.html"), "utf8")).toContain('href="https://example.org/a.md"');
  });
});

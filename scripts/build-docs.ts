// Build the documentation site: docs/*.md rendered to HTML under dist/docs.
//
//   npm run docs                      # → dist/docs   (entry: scripts/docs.ts)
//   npm run build                     # the app first, then this
//
// WHY A BUILD STEP. The Pages workflow publishes `dist`, which is the Vite app, so
// the Markdown under docs/ was never served: .../wsn-codegen/docs/index.html was a
// 404. This renders a CURATED list of pages into the same artifact, so the paper can
// cite one address for the tool and its documentation.
//
// WHAT IS PUBLISHED, AND WHAT IS NOT. PUBLISHED below is the whole decision and it is
// one list on purpose.
//
//   Rendered:     the pages a reader needs to use the tool or to check a claim of the
//                 paper (guide, case studies, the rule catalog and its evidence).
//   Linked only:  docs/harness/** and docs/findings/**. They are dated working notes.
//                 They name local paths, scratch folders and design notes that are not in
//                 the repository, so rendering them would present internal logs as
//                 documentation and leave dead references on the page. A link to the
//                 file on GitHub gives a reader the source and promises nothing more.
//
// A link to anything that is not rendered becomes a GitHub link; a link to something
// that does not exist, or that leaves the repository, is a BUILD ERROR. A page that
// builds and points nowhere is the failure this guards against.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, copyFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep, posix as pp } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { Marked, type Tokens } from "marked";
import JSZip from "jszip";
import { generateMerged } from "../src/engine/pipeline";
import { loadProject } from "./projects";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

const GITHUB = "https://github.com/komenpetch/wsn-codegen";
const APP = "https://komenpetch.github.io/wsn-codegen/";

/** Paths relative to docs/, posix. The order is the order of the build log only. */
export const PUBLISHED: readonly string[] = [
  "index.md",
  "documentation.md",
  "usage.md",
  "about.md",
  "case-studies/index.md",
  "case-studies/sensorapp.md",
  "case-studies/mintroute.md",
  "case-studies/aodv.md",
  "case-studies/dsr.md",
  "TRANSLATION_RULES.md",
  "INTERFACE_MAPPING.md",
  "rule-map.md",
];

/**
 * Files the build MAKES instead of copying, so they cannot go stale: the repository's own
 * application-layer fixture as a project zip, and what the generator emits from it. A page
 * links to them as `downloads/<name>`. They derive only from tests/fixtures/shdecom, which is
 * public; nothing derived from the advisor's models is built here.
 */
export const DOWNLOADS: readonly string[] = [
  "downloads/shdecom-project.zip",
  "downloads/shdecom-generated-structure2.zip",
  "downloads/shdecom-generated-structure3.zip",
];

const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

async function zipOf(files: { path: string; content: string }[]): Promise<Buffer> {
  const z = new JSZip();
  for (const f of files) z.file(f.path, f.content, { date: FIXED_DATE });
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Write the downloads; returns what was written. Skips quietly when the fixture is absent. */
async function makeDownloads(repoRoot: string, out: string): Promise<string[]> {
  const fixture = join(repoRoot, "tests", "fixtures", "shdecom");
  if (!existsSync(fixture)) return [];
  const project = loadProject(fixture);
  const dest = (name: string) => join(out, name);
  mkdirSync(join(out, "downloads"), { recursive: true });
  const written: string[] = [];
  const put = async (name: string, files: { path: string; content: string }[]) => {
    writeFileSync(dest(name), await zipOf(files));
    written.push(dest(name));
  };
  await put(DOWNLOADS[0], project.map((f) => ({ path: `shdecom/${f.name}`, content: f.xml })));
  await put(DOWNLOADS[1], generateMerged(project, undefined, 2));
  await put(DOWNLOADS[2], generateMerged(project, undefined, 3));
  return written;
}

const NAV: readonly { label: string; page: string }[] = [
  { label: "Home", page: "index.md" },
  { label: "Documentation", page: "documentation.md" },
  { label: "Case studies", page: "case-studies/index.md" },
  { label: "Usage", page: "usage.md" },
  { label: "About", page: "about.md" },
];

export interface BuildOptions {
  /** Where the Markdown is. Default: docs/ of this repository. */
  docsDir?: string;
  /** Where the HTML goes. */
  outDir: string;
  /** What to render. Default: PUBLISHED. */
  pages?: readonly string[];
  /** Make the downloads from the repository's fixture. Default: true. */
  downloads?: boolean;
}

export interface BuildResult {
  written: string[];
  problems: string[];
}

const toPosix = (p: string): string => p.split(sep).join("/");

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const slugOf = (text: string, seen: Map<string, number>): string => {
  const base =
    text
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-") || "section";
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
};

/** Posix path from one folder to a file, both relative to the output root. */
const relFrom = (fromDir: string, to: string): string => {
  const r = pp.relative(fromDir === "" ? "." : fromDir, to);
  return r === "" ? "." : r;
};

function commitOf(root: string): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export async function buildDocs(opts: BuildOptions): Promise<BuildResult> {
  const docsDir = resolve(opts.docsDir ?? join(REPO, "docs"));
  const repoRoot = resolve(docsDir, "..");
  const docsInRepo = toPosix(relative(repoRoot, docsDir));
  const pages = opts.pages ?? PUBLISHED;
  const published = new Set(pages);
  const out = resolve(opts.outDir);
  const problems: string[] = [];
  const written: string[] = [];
  const commit = commitOf(repoRoot);

  /** Where a link written in `src` should point in the rendered site. */
  const target = (src: string, href: string): string => {
    if (/^(https?:|mailto:|tel:)/i.test(href) || href.startsWith("#")) return href;
    const [pathPart, ...hashParts] = href.split("#");
    const hash = hashParts.length > 0 ? `#${hashParts.join("#")}` : "";
    const abs = pp.normalize(pp.join(pp.dirname(src), decodeURI(pathPart)));
    // Made by this build, or copied from docs/assets: both land beside the pages.
    if ((opts.downloads !== false && DOWNLOADS.includes(abs)) ||
        (abs.startsWith("assets/") && existsSync(join(docsDir, abs))))
      return relFrom(pp.dirname(src), abs) + hash;
    if (published.has(abs)) {
      const html = abs.replace(/\.md$/, ".html");
      return relFrom(pp.dirname(src), html) + hash;
    }
    const repoRel = pp.normalize(pp.join(docsInRepo, abs));
    if (repoRel.startsWith("..")) {
      problems.push(`${src}: link "${href}" leaves the repository`);
      return "#";
    }
    const onDisk = join(repoRoot, repoRel);
    if (!existsSync(onDisk)) {
      problems.push(`${src}: link "${href}" points at ${repoRel}, which does not exist`);
      return "#";
    }
    const kind = statSync(onDisk).isDirectory() ? "tree" : "blob";
    return `${GITHUB}/${kind}/main/${repoRel.replace(/\/$/, "")}${hash}`;
  };

  const render = (src: string, md: string): { html: string; title: string } => {
    const seen = new Map<string, number>();
    let title = "";
    const marked = new Marked({ gfm: true });
    marked.use({
      walkTokens(token) {
        if (token.type === "link" || token.type === "image") {
          const t = token as Tokens.Link | Tokens.Image;
          t.href = target(src, t.href);
        }
        if (token.type === "heading" && (token as Tokens.Heading).depth === 1 && title === "") {
          title = (token as Tokens.Heading).text.replace(/`/g, "");
        }
      },
      renderer: {
        heading(this, token: Tokens.Heading) {
          const id = slugOf(token.text, seen);
          return `<h${token.depth} id="${id}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
        },
      },
    });
    return { html: marked.parse(md) as string, title: title || src };
  };

  const shell = (src: string, title: string, body: string): string => {
    const dir = pp.dirname(src) === "." ? "" : pp.dirname(src);
    const nav = NAV.map((n) => {
      const href = relFrom(dir, n.page.replace(/\.md$/, ".html"));
      const here = n.page === src || (n.page === "case-studies/index.md" && src.startsWith("case-studies/"));
      return `<a href="${href}"${here ? ' aria-current="page"' : ""}>${n.label}</a>`;
    }).join("\n      ");
    const css = relFrom(dir, "docs.css");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title === "WSN-CodeGen" ? title : `${title} | WSN-CodeGen`)}</title>
<link rel="stylesheet" href="${css}">
</head>
<body>
<header class="site">
  <div class="bar">
    <span class="brand">WSN-CodeGen</span>
    <nav>
      ${nav}
      <a href="${APP}">Tool</a>
      <a href="${GITHUB}">Source</a>
    </nav>
  </div>
</header>
<main>
${body}
</main>
<footer class="site">Built from <code>docs/</code>${commit ? ` at commit <code>${commit}</code>` : ""}. Prince of Songkla University, Phuket Campus, College of Computing.</footer>
</body>
</html>
`;
  };

  for (const src of pages) {
    const file = join(docsDir, src);
    if (!existsSync(file)) {
      problems.push(`${src}: listed as published, but not found in ${docsInRepo}/`);
      continue;
    }
    const { html, title } = render(src, readFileSync(file, "utf8"));
    const dest = join(out, src.replace(/\.md$/, ".html"));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, shell(src, title, html));
    written.push(dest);
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "docs.css"), CSS);
  written.push(join(out, "docs.css"));

  // Figures: every file under docs/assets, copied as it is.
  const assets = join(docsDir, "assets");
  if (existsSync(assets)) {
    mkdirSync(join(out, "assets"), { recursive: true });
    for (const name of readdirSync(assets)) {
      copyFileSync(join(assets, name), join(out, "assets", name));
      written.push(join(out, "assets", name));
    }
  }
  if (opts.downloads !== false) written.push(...(await makeDownloads(repoRoot, out)));
  return { written, problems };
}

const CSS = `:root{
  --bg:#ffffff;--fg:#1c2530;--muted:#5b6673;--line:#d9dee4;--accent:#1f5fa8;--code:#f2f4f7;--bar:#16324f;--barfg:#ffffff;
}
@media (prefers-color-scheme:dark){
  :root{--bg:#10151b;--fg:#e3e8ee;--muted:#9aa6b2;--line:#2b3440;--accent:#7db4f0;--code:#1a222c;--bar:#0b1b2c;--barfg:#e3e8ee}
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header.site{background:var(--bar);color:var(--barfg)}
.bar{max-width:60rem;margin:0 auto;padding:.75rem 1rem;display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;align-items:center}
.brand{font-weight:700;font-size:1.1rem}
nav{display:flex;flex-wrap:wrap;gap:.25rem 1.1rem}
nav a{color:var(--barfg);text-decoration:none;opacity:.85;padding:.15rem 0;border-bottom:2px solid transparent}
nav a:hover{opacity:1}
nav a[aria-current=page]{opacity:1;border-bottom-color:var(--barfg)}
main{max-width:60rem;margin:0 auto;padding:1.25rem 1rem 3rem}
h1{font-size:2rem;line-height:1.2;margin:1.2rem 0 .8rem}
h2{font-size:1.4rem;margin:2.2rem 0 .6rem;padding-top:.4rem;border-top:1px solid var(--line)}
h3{font-size:1.15rem;margin:1.6rem 0 .4rem}
a{color:var(--accent)}
code{font:.9em ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--code);padding:.1em .3em;border-radius:3px}
pre{background:var(--code);padding:.8rem 1rem;border-radius:6px;overflow-x:auto;line-height:1.4}
pre code{background:none;padding:0}
table{border-collapse:collapse;margin:1rem 0;display:block;overflow-x:auto;max-width:100%}
th,td{border:1px solid var(--line);padding:.4rem .65rem;text-align:left;vertical-align:top}
th{background:var(--code)}
blockquote{margin:1rem 0;padding:.2rem 1rem;border-left:4px solid var(--accent);background:var(--code)}
img{max-width:100%;height:auto}
figure{margin:1.2rem 0}
figcaption{color:var(--muted);font-size:.9rem;margin-top:.3rem}
hr{border:0;border-top:1px solid var(--line);margin:2rem 0}
footer.site{max-width:60rem;margin:0 auto;padding:1rem;color:var(--muted);font-size:.85rem;border-top:1px solid var(--line)}
@media (max-width:40rem){h1{font-size:1.6rem}main{padding-inline:.75rem}}
`;

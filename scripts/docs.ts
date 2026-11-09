// Entry for `npm run docs`: write the documentation site to dist/docs (or to the folder
// named), and fail on any problem.
//
// This is a separate file from build-docs.ts on purpose. A "run only when executed
// directly" guard in the module itself cannot be trusted under vite-node, which puts its
// own CLI path in process.argv[1]: the guard never fires and the build writes nothing and
// reports nothing. An entry file has no guard to get wrong.
import { join, relative, resolve } from "node:path";
import { buildDocs, PUBLISHED, DOWNLOADS } from "./build-docs";

const REPO = resolve(import.meta.dirname, "..");
const outDir = process.argv[2] ? resolve(process.argv[2]) : join(REPO, "dist", "docs");

const { written, problems } = await buildDocs({ outDir });

if (problems.length > 0) {
  console.error(`\nThe documentation site has ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("");
  process.exit(1);
}
const pages = written.filter((f) => f.endsWith(".html")).length;
const downloads = written.filter((f) => f.endsWith(".zip")).length;
if (pages !== PUBLISHED.length || downloads !== DOWNLOADS.length) {
  console.error(`\nExpected ${PUBLISHED.length} pages and ${DOWNLOADS.length} downloads, wrote ${pages} and ${downloads}.\n`);
  process.exit(1);
}
const figures = written.filter((f) => /[\\/]assets[\\/]/.test(f)).length;
console.log(`Documentation site: ${pages} pages, ${figures} figures, ${downloads} downloads → ${relative(REPO, outDir)}/`);

// Entry for `npm run docs`: write the documentation site to dist/docs (or to the folder
// named), and fail on any problem.
//
// This is a separate file from build-docs.ts on purpose. A "run only when executed
// directly" guard in the module itself cannot be trusted under vite-node, which puts its
// own CLI path in process.argv[1]: the guard never fires and the build writes nothing and
// reports nothing. An entry file has no guard to get wrong.
import { join, relative, resolve } from "node:path";
import { buildDocs, PUBLISHED } from "./build-docs";

const REPO = resolve(import.meta.dirname, "..");
const outDir = process.argv[2] ? resolve(process.argv[2]) : join(REPO, "dist", "docs");

const { written, problems } = buildDocs({ outDir });

if (problems.length > 0) {
  console.error(`\nThe documentation site has ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("");
  process.exit(1);
}
if (written.length !== PUBLISHED.length + 1) {
  console.error(`\nExpected ${PUBLISHED.length} pages and the stylesheet, wrote ${written.length} files.\n`);
  process.exit(1);
}
console.log(`Documentation site: ${PUBLISHED.length} pages + docs.css → ${relative(REPO, outDir)}/`);

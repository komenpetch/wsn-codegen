// Derive StaticRoutesNetworkLayer.ned from the STAGED, generated EbWsn.ned.
//   node derive_wrapper.mjs <dir>
//
// The generated wrapper fixes `np: EbWsn`, and NED does not let a derived module
// change an inherited submodule's type (OMNeT++ manual: inheritance "may not
// modify inherited submodules"), so StaticRoutes needs its own copy (D12). It is
// derived at staging rather than kept by hand (user, 2026-10-12, Q6 = a): the
// wrapper changed in step 3d (routing table, ARP address type), and a hand copy
// would have gone stale without a word.
//
// The copy is the generated file's imports and its wrapper module, with exactly
// two changes: the module's name and np's type. Each must match exactly once,
// or this refuses (exit 3) rather than write a wrapper that differs from the
// generated one in some other way.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: node derive_wrapper.mjs <dir>"); process.exit(3); }
const ned = readFileSync(join(dir, "EbWsn.ned"), "utf8").replace(/\r\n/g, "\n");
const lines = ned.split("\n");

function refuse(msg) { console.error(`BROKEN: ${msg}`); process.exit(3); }

const imports = lines.filter((l) => /^import\s/.test(l));
if (imports.length === 0) refuse("no import lines in EbWsn.ned");

const starts = lines.flatMap((l, i) => (/^module EbWsnNetworkLayer\b/.test(l) ? [i] : []));
if (starts.length !== 1) refuse(`'module EbWsnNetworkLayer' found ${starts.length} times`);
const start = starts[0];
const end = lines.findIndex((l, i) => i > start && /^}/.test(l));
if (end < 0) refuse("the wrapper module has no closing brace at column 0");
let wrapper = lines.slice(start, end + 1).join("\n");

function once(from, to) {
  const n = wrapper.split(from).length - 1;
  if (n !== 1) refuse(`'${from}' found ${n} times in the wrapper`);
  wrapper = wrapper.replace(from, () => to);
}
once("module EbWsnNetworkLayer", "module StaticRoutesNetworkLayer");
once("np: EbWsn {", "np: StaticRoutes {");
const left = wrapper.match(/\bEbWsn\b/g);
if (left) refuse(`the wrapper still names EbWsn ${left.length} time(s) after the two renames`);

const out = [
  "// DERIVED by derive_wrapper.mjs from the staged, generated EbWsn.ned -- do not",
  "// edit; loop.sh rewrites it on every run. The generated wrapper with exactly two",
  "// changes: the module's name, and np's type (StaticRoutes, see StaticRoutes.ned).",
  "",
  ...imports,
  "",
  wrapper,
  "",
].join("\n");
writeFileSync(join(dir, "StaticRoutesNetworkLayer.ned"), out);
console.log(`derived StaticRoutesNetworkLayer.ned (${imports.length} imports, wrapper lines ${start + 1}-${end + 1})`);

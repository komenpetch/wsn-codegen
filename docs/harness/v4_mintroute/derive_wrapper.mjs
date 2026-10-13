// Derive EbMintRouteNetworkLayer.ned from the STAGED, generated EbWsn.ned.
//   node derive_wrapper.mjs <dir>
//
// v4_static's derive_wrapper.mjs with MintRoute's names. The generated wrapper
// fixes `np: EbWsn`, and NED does not let a derived module change an inherited
// submodule's type (OMNeT++ manual: inheritance "may not modify inherited
// submodules"), so MintRoute needs its own copy (D12). It is derived at staging,
// not kept by hand, so it cannot go stale when the generated wrapper changes.
//
// The copy is the generated file's imports and its wrapper module, with exactly
// two changes: the module's name and np's type. Each must match exactly once,
// or this refuses (exit 3). The name is EbMintRouteNetworkLayer, not
// MintRouteNetworkLayer: INET's own wrapper of that name runs in this same
// executable under [Config Baseline].
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: node derive_wrapper.mjs <dir>"); process.exit(3); }
const ned = readFileSync(join(dir, "EbWsn.ned"), "utf8").replace(/\r\n/g, "\n");
const lines = ned.split("\n");

function refuse(msg) { console.error(`BROKEN: ${msg}`); process.exit(3); }

const imports = lines.filter((l) => /^import\s/.test(l));
if (imports.length === 0) refuse("no import lines in EbWsn.ned");
// The wrapper's `np: MintRoute` must resolve to THIS folder's MintRoute, not
// INET's; it would not if a copied import named INET's.
if (imports.some((l) => /mintroute/i.test(l))) refuse("an import names INET's mintroute package");

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
once("module EbWsnNetworkLayer", "module EbMintRouteNetworkLayer");
once("np: EbWsn {", "np: MintRoute {");
const left = wrapper.match(/\bEbWsn\b/g);
if (left) refuse(`the wrapper still names EbWsn ${left.length} time(s) after the two renames`);

const out = [
  "// DERIVED by derive_wrapper.mjs from the staged, generated EbWsn.ned -- do not",
  "// edit; loop.sh rewrites it on every run. The generated wrapper with exactly two",
  "// changes: the module's name, and np's type (MintRoute, see MintRoute.ned).",
  "",
  ...imports,
  "",
  wrapper,
  "",
].join("\n");
writeFileSync(join(dir, "EbMintRouteNetworkLayer.ned"), out);
console.log(`derived EbMintRouteNetworkLayer.ned (${imports.length} imports, wrapper lines ${start + 1}-${end + 1})`);

// Refuse to build MintRoute if its copies of generated code have drifted (Q12).
//   node check_copy.mjs <dir>        exit 0 same, 2 drifted, 3 cannot read
//
// 1. MintRoute::sendRouteBroadcast(Node, PktId) is the generated
//    EbWsn::sendRouteBroadcast(Node, PktId) copied (Q2 = a). Apart from the
//    chunk's class (MintRoutePkt for PPkt) and the block between the two
//    `[MintRoute]` markers, the statements must be the generated ones, in order.
// 2. MintRoutePkt's constructor from the model's PPkt sets each PPkt field
//    through its setter (MintRoutePkt.h). Every setter the staged PPkt declares
//    must be called there, or a field the generator adds would not reach the air.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: node check_copy.mjs <dir>"); process.exit(3); }
const read = (f) => readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n");
function broken(msg) { console.error(`BROKEN: ${msg}`); process.exit(3); }

// The body of the function whose definition starts with `head`, up to the first
// `}` in column 0.
function body(src, head, what) {
  const at = src.indexOf(head);
  if (at < 0 || src.indexOf(head, at + 1) >= 0) broken(`${what}: expected exactly one '${head}'`);
  const open = src.indexOf("{", at);
  const close = src.indexOf("\n}\n", open);
  if (open < 0 || close < 0) broken(`${what}: no body`);
  return src.slice(open + 1, close).split("\n");
}
const statements = (lines) => lines
  .map((l) => l.replace(/\/\/.*$/, "").trim())
  .filter((l) => l.length > 0);

const gen = statements(body(read("EbWsn.cc"), "void EbWsn::sendRouteBroadcast(Node x, PktId pkt)", "EbWsn.cc"));
const raw = body(read("MintRoute.cc"), "void MintRoute::sendRouteBroadcast(Node x, PktId pkt)", "MintRoute.cc");
const from = raw.findIndex((l) => l.includes("[MintRoute] the route fields"));
const to = raw.findIndex((l) => l.includes("[MintRoute] end"));
if (from < 0 || to < from) broken("MintRoute.cc: the [MintRoute] block markers are missing");
const copy = statements([...raw.slice(0, from), ...raw.slice(to + 1)])
  .map((s) => s.split("makeShared<MintRoutePkt>(*held)").join("makeShared<PPkt>(*held)"));

let drift = [];
if (gen.length !== copy.length || gen.some((s, i) => s !== copy[i])) {
  const n = Math.max(gen.length, copy.length);
  for (let i = 0; i < n; i++)
    if (gen[i] !== copy[i]) drift.push(`  generated: ${gen[i] ?? "(none)"}\n  copy:      ${copy[i] ?? "(none)"}`);
}

// PPkt's setters, from the staged header's class PPkt.
const h = read("EbWsn.h");
const pStart = h.indexOf("class PPkt : public inet::FieldsChunk");
const pEnd = h.indexOf("\n};\n", pStart);
if (pStart < 0 || pEnd < 0) broken("EbWsn.h: no class PPkt");
const setters = [...h.slice(pStart, pEnd).matchAll(/void (set\w+)\(/g)].map((m) => m[1]);
if (setters.length === 0) broken("EbWsn.h: PPkt declares no setters");
const pkt = read("MintRoutePkt.h");
const cHead = pkt.indexOf("explicit MintRoutePkt(const eb_ebwsn::PPkt& held)");
const cOpen = pkt.indexOf("{", cHead);
const cClose = pkt.indexOf("\n    }\n", cOpen);   // the member's closing brace, 4 spaces in
if (cHead < 0 || cOpen < 0 || cClose < 0) broken("MintRoutePkt.h: no constructor from PPkt");
const ctor = pkt.slice(cOpen + 1, cClose);
const missing = setters.filter((s) => !new RegExp(`\\b${s}\\(held\\.get${s.slice(3)}\\(\\)\\)`).test(ctor));

if (drift.length || missing.length) {
  if (drift.length) console.error(`REFUSE: MintRoute's copy of sendRouteBroadcast differs from the generated one:\n${drift.join("\n")}`);
  if (missing.length) console.error(`REFUSE: MintRoutePkt does not copy PPkt's ${missing.join(", ")}`);
  process.exit(2);
}
console.log(`copies current: sendRouteBroadcast (${gen.length} statements), PPkt fields (${setters.length} setters)`);

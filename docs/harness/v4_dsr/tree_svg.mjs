// Check a route picture against its run's scalars, independently of the code
// that drew it (the TREE DRAWING block). Exit 1 on any disagreement.
// usage: node tree_svg.mjs <run.sca> <run-tree.svg>
// ../v4_aodv/tree_svg.mjs for DSR's source routes (plan B3): the arrow is the
// path's first hop, and the picture also lists every path in full.
// From the .sca: each node's id (dsr:myId), its cached path to the sink
// (dsr:hasRoute, dsr:hopCount, dsr:path:<i>), failure (dsr:failed), and what it
// heard (dsr:heard:<id>).
// From the .svg: node positions (circle/rect centres, named by the bold text
// nearest each), every arrow (line with marker-end) mapped to the node nearest
// its two ends, its colour, the hop count printed in each node, the dashed link
// lines, the listed paths (text class="path") and the summary line.
import fs from "node:fs";
const [scaPath, svgPath] = process.argv.slice(2);
if (!scaPath || !svgPath) { console.error("usage: node tree_svg.mjs <run.sca> <run-tree.svg>"); process.exit(3); }
const S = {};
for (const line of fs.readFileSync(scaPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^scalar \S+\.(sink|sensor\d+)\.generic\.np (dsr:\S+) (\S+)$/);
  if (m) (S[m[1]] ??= {})[m[2]] = Number(m[3]);
}
const idToName = {};
for (const [n, v] of Object.entries(S)) idToName[v["dsr:myId"]] = n;
const pathOf = (n) => {
  const s = S[n];
  if (!s["dsr:hasRoute"] || s["dsr:failed"]) return null;
  return Array.from({ length: s["dsr:hopCount"] }, (_, i) => idToName[s[`dsr:path:${i}`]]);
};

const svg = fs.readFileSync(svgPath, "utf8");
const num = (s, a) => Number(s.match(new RegExp(` ${a}="([^"]+)"`))[1]);
const centres = [];
for (const l of svg.split("\n")) {
  if (/^<circle /.test(l) && / r="12"/.test(l)) centres.push({ x: num(l, "cx"), y: num(l, "cy"), failed: /e9e8e4/.test(l) });
  if (/^<rect x=/.test(l) && /rx="3"/.test(l)) centres.push({ x: num(l, "x") + 12, y: num(l, "y") + 12, sink: true });
}
const texts = [...svg.matchAll(/<text x="([^"]+)" y="([^"]+)" font-size="(\d+)"[^>]*>([^<]*)<\/text>/g)]
  .map((m) => ({ x: +m[1], y: +m[2], size: +m[3], t: m[4] }));
for (const c of centres) {
  const names = texts.filter((t) => t.size === 13 && /^(sink|sensor\d+)$/.test(t.t));
  names.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
  c.name = names[0].t;
  const inside = texts.find((t) => t.size === 12 && Math.abs(t.x - c.x) < 0.01 && Math.abs(t.y - c.y - 4) < 0.01);
  c.label = inside ? inside.t : "?";
}
const nearest = (x, y) => centres.reduce((b, c) => (Math.hypot(c.x - x, c.y - y) < Math.hypot(b.x - x, b.y - y) ? c : b));
const arrows = {}, links = new Set();
let bad = 0;
const say = (ok, msg) => { if (!ok) { bad++; console.log("  WRONG:", msg); } };
for (const l of svg.split("\n")) {
  if (!/^<line /.test(l)) continue;
  const x1 = num(l, "x1"), y1 = num(l, "y1"), x2 = num(l, "x2"), y2 = num(l, "y2");
  if (Math.abs(y1 - y2) < 0.01 && x2 - x1 === 40) continue;   // the legend's samples
  const a = nearest(x1, y1), b = nearest(x2, y2);
  if (/marker-end/.test(l)) {
    say(!arrows[a.name], `two arrows from ${a.name}`);
    arrows[a.name] = { to: b.name, red: /e34948/.test(l) };
  } else links.add([a.name, b.name].sort().join("-"));
}
const listed = {};
for (const m of svg.matchAll(/<text class="path"[^>]*>([^<]*)<\/text>/g)) {
  const t = m[1].match(/^(\S+) \((\d+) hops?\): (.*?)( · not (\S+)'s own path)?$/);
  if (!t) { say(false, `cannot read the path line "${m[1]}"`); continue; }
  listed[t[1]] = { hops: +t[2], chain: t[3].split(" → "), notOwn: t[5] ?? null };
}

say(centres.length === Object.keys(S).length, `${centres.length} nodes drawn, ${Object.keys(S).length} in the run`);
let withPath = 0, continuing = 0, living = 0;
for (const c of centres) {
  const s = S[c.name], arrow = arrows[c.name], p = pathOf(c.name);
  if (c.sink) { say(!arrow && !listed[c.name], `the sink has an arrow or a path`); continue; }
  if (s["dsr:failed"]) { say(c.failed && !arrow && !listed[c.name], `${c.name} failed: drawn failed ${c.failed}, arrow ${!!arrow}`); continue; }
  living++;
  say(!c.failed, `${c.name} drawn failed`);
  if (!p) { say(!arrow && c.label === "-" && !listed[c.name], `${c.name}: no path, drawn ${JSON.stringify(arrow)} label ${c.label}`); continue; }
  withPath++;
  say(arrow && arrow.to === p[0], `${c.name}: first hop ${p[0]}, arrow ${JSON.stringify(arrow)}`);
  say(c.label === String(p.length), `${c.name}: ${p.length} hops, printed ${c.label}`);
  const L = listed[c.name];
  say(L && L.hops === p.length && L.chain.join() === [c.name, ...p].join(), `${c.name}: path ${[c.name, ...p].join("-")}, listed ${JSON.stringify(L)}`);
  // continues as its first hop's own path? (the sink as first hop: yes)
  const own = p[0] === "sink" ? true : (pathOf(p[0]) ?? []).join() === p.slice(1).join();
  if (own) continuing++;
  say(L && (L.notOwn === null) === own && (own || L.notOwn === p[0]), `${c.name}: own-path ${own}, listed "${L?.notOwn}"`);
}
say(Object.keys(listed).every((n) => pathOf(n)), `a path listed for a node without one: ${Object.keys(listed).filter((n) => !pathOf(n))}`);
// the links: every dsr:heard pair between two living nodes, and nothing else
const want = new Set();
for (const [n, v] of Object.entries(S))
  for (const k of Object.keys(v)) {
    const m = k.match(/^dsr:heard:(\d+)$/);
    if (!m) continue;
    const o = idToName[m[1]];
    if (!S[n]["dsr:failed"] && !S[o]["dsr:failed"]) want.add([n, o].sort().join("-"));
  }
say([...want].every((x) => links.has(x)) && [...links].every((x) => want.has(x)), `links: drawn ${links.size}, heard ${want.size}`);
// red exactly where following first hops never reaches the sink
for (const [n, a] of Object.entries(arrows)) {
  let cur = n, ok = false;
  const seen = new Set();
  while (!seen.has(cur)) {
    seen.add(cur);
    if (S[cur]["dsr:isSink"]) { ok = true; break; }
    const p = pathOf(cur);
    if (!p) break;
    cur = p[0];
  }
  say(a.red === !ok, `${n}: first hops reach the sink ${ok}, drawn ${a.red ? "red" : "blue"}`);
}
const header = svg.match(/sensors with a cached path: [^<]*/)?.[0] ?? "";
const hm = header.match(/cached path: (\d+) of (\d+).*own path: (\d+) of (\d+)/);
say(hm && +hm[1] === withPath && +hm[2] === living && +hm[3] === continuing && +hm[4] === withPath,
    `summary "${header}" against ${withPath} of ${living}, ${continuing} continuing`);
const summary = Object.entries(arrows).map(([n, a]) => `${n}->${a.to}${a.red ? "(red)" : ""}`).join(" ");
console.log(`${bad ? "RED" : "OK "} ${svgPath.split("/").pop()}: ${centres.length} nodes, ${Object.keys(arrows).length} arrows, ${links.size} links, ${Object.keys(listed).length} paths listed | ${header}\n    ${summary}`);
process.exitCode = bad ? 1 : 0;

// Check a tree picture against its run's scalars, independently of the code
// that drew it (the TREE DRAWING block). Exit 1 on any disagreement.
// usage: node tree_svg.mjs <run.sca> <run-tree.svg>
// From the .sca: each node's id (aodv:myId), its active route (aodv:hasRoute,
// aodv:nextHop, aodv:hopCount), INET's next hop (aodv:inetSinkNextHop, the
// next hop an invalidated route keeps), failure (aodv:failed), and what it
// heard (aodv:heard:<id>).
// From the .svg: node positions (circle/rect centres, named by the bold text
// nearest each), every arrow (line with marker-end) mapped to the node nearest
// its two ends, its kind (blue/red solid = active, grey dashed = invalidated),
// the hop count printed in each node, and the dashed link lines.
import fs from "node:fs";
const [scaPath, svgPath] = process.argv.slice(2);
const sca = fs.readFileSync(scaPath, "utf8");
const S = {};
for (const line of sca.split(/\r?\n/)) {
  const m = line.match(/^scalar \S+\.(sink|sensor\d+)\.generic\.np (aodv:\S+) (\S+)$/);
  if (m) (S[m[1]] ??= {})[m[2]] = Number(m[3]);
}
const idToName = {};
for (const [n, v] of Object.entries(S)) idToName[v["aodv:myId"]] = n;

const svg = fs.readFileSync(svgPath, "utf8");
const num = (s, a) => Number(s.match(new RegExp(` ${a}="([^"]+)"`))[1]);
const centres = [];
for (const l of svg.split("\n")) {
  if (/^<circle /.test(l) && / r="12"/.test(l)) centres.push({ x: num(l, "cx"), y: num(l, "cy"), failed: /e9e8e4/.test(l) });
  if (/^<rect x=/.test(l) && /rx="3"/.test(l)) centres.push({ x: num(l, "x") + 12, y: num(l, "y") + 12, sink: true });
}
// the name: the 13 px bold text nearest the centre; the hop count: the 12 px
// text at the centre.
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
for (const l of svg.split("\n")) {
  if (!/^<line /.test(l)) continue;
  const x1 = num(l, "x1"), y1 = num(l, "y1"), x2 = num(l, "x2"), y2 = num(l, "y2");
  if (Math.abs(y1 - y2) < 0.01 && x2 - x1 === 40) continue;   // the legend's samples
  const a = nearest(x1, y1), b = nearest(x2, y2);
  if (/marker-end/.test(l)) {
    const kind = /9a9893/.test(l) ? "invalid" : /e34948/.test(l) ? "red" : "active";
    if (arrows[a.name]) console.log("TWO ARROWS from", a.name);
    arrows[a.name] = { to: b.name, kind };
  } else links.add([a.name, b.name].sort().join("-"));
}

let bad = 0;
const say = (ok, msg) => { if (!ok) { bad++; console.log("  WRONG:", msg); } };
for (const c of centres) {
  const s = S[c.name];
  if (c.sink) { say(!arrows[c.name], `the sink has an arrow`); continue; }
  const arrow = arrows[c.name];
  if (s["aodv:failed"]) { say(c.failed && !arrow, `${c.name} failed: drawn failed ${c.failed}, arrow ${!!arrow}`); continue; }
  if (s["aodv:hasRoute"]) {
    const want = idToName[s["aodv:nextHop"]];
    say(arrow && arrow.kind !== "invalid" && arrow.to === want, `${c.name}: active route via ${want}, drawn ${JSON.stringify(arrow)}`);
    say(c.label === String(s["aodv:hopCount"]), `${c.name}: hop count ${s["aodv:hopCount"]}, printed ${c.label}`);
  } else if (s["aodv:inetSinkNextHop"] >= 0) {
    const want = idToName[s["aodv:inetSinkNextHop"]];
    say(arrow && arrow.kind === "invalid" && arrow.to === want, `${c.name}: invalidated route via ${want} (INET's table), drawn ${JSON.stringify(arrow)}`);
    say(c.label === "-", `${c.name}: no active route, printed ${c.label}`);
  } else say(!arrow && c.label === "-", `${c.name}: no route, drawn ${JSON.stringify(arrow)} label ${c.label}`);
}
// the links: every aodv:heard pair between two living nodes, and nothing else
const want = new Set();
for (const [n, v] of Object.entries(S))
  for (const k of Object.keys(v)) {
    const m = k.match(/^aodv:heard:(\d+)$/);
    if (!m) continue;
    const o = idToName[m[1]];
    if (!S[n]["aodv:failed"] && !S[o]["aodv:failed"]) want.add([n, o].sort().join("-"));
  }
say([...want].every((p) => links.has(p)) && [...links].every((p) => want.has(p)),
    `links: drawn ${links.size}, heard ${want.size}`);
// red arrows exactly where the chain of active next hops does not reach the sink
for (const [n, a] of Object.entries(arrows)) {
  if (a.kind === "invalid") continue;
  let cur = n, seen = new Set(), ok = false;
  while (!seen.has(cur)) {
    seen.add(cur);
    const s = S[cur];
    if (s["aodv:isSink"]) { ok = true; break; }
    if (s["aodv:failed"] || !s["aodv:hasRoute"]) break;
    cur = idToName[s["aodv:nextHop"]];
  }
  say((a.kind === "red") === !ok, `${n}: chain reaches the sink ${ok}, drawn ${a.kind}`);
}
const header = svg.match(/sensors with an active route: [^<]*/)[0];
const summary = Object.entries(arrows).map(([n, a]) => `${n}->${a.to}${a.kind === "invalid" ? "(inv)" : a.kind === "red" ? "(red)" : ""}`).join(" ");
console.log(`${bad ? "RED" : "OK "} ${svgPath.split("/").pop()}: ${centres.length} nodes, ${Object.keys(arrows).length} arrows, ${links.size} links | ${header}\n    ${summary}`);
process.exitCode = bad ? 1 : 0;

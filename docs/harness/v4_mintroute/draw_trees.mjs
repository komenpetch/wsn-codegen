// Draws route trees from .sca files, one panel per run: v4's (mrt:* scalars,
// MintRoute::finish) or the baseline's (bl:* scalars, BaselineMintRoute::finish).
//   node draw_trees.mjs <out.svg> <title> <prefix> <sca>... [--note <line>]...
//     prefix: mrt (v4) or bl (the baseline), for every file; a file written as
//     <prefix>=<sca> uses its own, so one figure can hold both.
// Positions: SensorScopeNetwork.ned @display p=, which are the mobility
// positions in metres. Arrows go child -> parent; a parent chain that does not
// reach the sink (a loop) is drawn in red; grey dashes are the links each node
// heard. The number in a node is its hop count ("-" without a parent).
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const notes = [];
for (let i = args.indexOf("--note"); i >= 0; i = args.indexOf("--note")) {
  notes.push(args[i + 1]);
  args.splice(i, 2);
}
const [out, title, defaultPrefix, ...files] = args;
if (!out || !title || !["mrt", "bl"].includes(defaultPrefix) || files.length === 0) {
  console.error("usage: node draw_trees.mjs <out.svg> <title> <mrt|bl> <sca>... [--note <line>]...");
  process.exit(3);
}

const POS = {
  sink: [740, 244], sensor1: [101, 74], sensor2: [271, 155], sensor3: [441, 60],
  sensor4: [169, 291], sensor5: [359, 250], sensor6: [556, 169], sensor7: [291, 400],
  sensor8: [495, 366],
};
const LABEL = {   // [dx, dy, text-anchor] from the node centre, clear of the arrows
  sink: [0, -16, "middle"], sensor1: [0, -16, "middle"], sensor2: [0, 26, "middle"],
  sensor3: [0, -16, "middle"], sensor4: [-15, 4, "end"], sensor5: [14, 22, "start"],
  sensor6: [0, -16, "middle"], sensor7: [0, 26, "middle"], sensor8: [15, 4, "start"],
};
const C = {
  surface: "#fcfcfb", panel: "#ffffff", border: "#e4e3df",
  text: "#0b0b0b", text2: "#52514e", link: "#c3c2b7", parent: "#2a78d6", loop: "#e34948",
};

const WHO = { mrt: "v4", bl: "Baseline" };

function readRun(arg) {
  const own = arg.match(/^(mrt|bl)=(.+)$/);
  const prefix = own ? own[1] : defaultPrefix;
  const file = own ? own[2] : arg;
  const np = {};
  let seed = "?", cfg = "?", limit = null;
  for (const l of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (l.startsWith("attr seedset ")) seed = l.split(" ")[2];
    if (l.startsWith("attr configname ")) cfg = l.split(" ")[2];
    const m = l.match(/^scalar SensorScopeNetwork\.(\w+)\.generic\.np (\S+) (\S+)$/);
    if (m && m[2].startsWith(`${prefix}:`)) (np[m[1]] ??= {})[m[2].slice(prefix.length + 1)] = Number(m[3]);
    // The first sim-time-limit line is the command line's, the later one the
    // ini's (OMNeT++ writes the command-line options first).
    const t = l.match(/^config sim-time-limit (\d+(?:\.\d+)?)s$/);
    if (t && limit == null) limit = Number(t[1]);
  }
  const nodes = Object.keys(np).filter((n) => "myId" in np[n]);
  if (nodes.length !== 9) throw new Error(`${file}: ${prefix}:* on ${nodes.length} nodes, expected 9`);
  const nameOf = new Map(nodes.map((n) => [np[n].myId, n]));
  const sink = nodes.find((n) => np[n].isSink === 1);
  const links = new Set();
  for (const n of nodes)
    for (const k of Object.keys(np[n]).filter((k) => k.startsWith("heard:"))) {
      const m = nameOf.get(Number(k.slice(6)));
      if (m) links.add([n, m].sort().join("|"));
    }
  const parent = {};
  for (const n of nodes) if (np[n].hasParent === 1) parent[n] = nameOf.get(np[n].parent);
  const reachesSink = (n) => {
    const seen = new Set();
    for (let cur = n; cur; cur = parent[cur]) {
      if (cur === sink) return true;
      if (seen.has(cur)) return false;
      seen.add(cur);
    }
    return false;
  };
  const hop = Object.fromEntries(nodes.map((n) => [n, n === sink ? 0 : np[n].hasParent === 1 ? np[n].hop : "–"]));
  return { file, who: WHO[prefix], seed, cfg, limit, sink, links: [...links].map((s) => s.split("|")), parent, hop, reachesSink };
}

const runs = files.map(readRun);
const S = 0.5, PW = 440, PH = 300, GAP = 16, COLS = 3, M = 20, R = 10;
const rows = Math.ceil((runs.length + (notes.length ? 1 : 0)) / COLS);
const W = M * 2 + COLS * PW + (COLS - 1) * GAP;
const H = M * 2 + 40 + rows * PH + (rows - 1) * GAP;
const short = (n) => (n === "sink" ? "sink" : n.replace("sensor", "s"));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function panel(run, x0, y0) {
  const ox = x0 + 15, oy = y0 + 52;
  const P = (n) => [ox + POS[n][0] * S, oy + POS[n][1] * S];
  const sensors = Object.keys(POS).filter((n) => n !== run.sink);
  const withParent = sensors.filter((n) => run.parent[n]).length;
  const loops = sensors.filter((n) => run.parent[n] && !run.reachesSink(n)).length;
  let g = `<rect x="${x0}" y="${y0}" width="${PW}" height="${PH}" rx="8" fill="${C.panel}" stroke="${C.border}"/>`;
  g += `<text x="${x0 + 16}" y="${y0 + 24}" font-size="15" font-weight="600" fill="${C.text}">${run.who} · seed set ${esc(run.seed)}</text>`;
  const t = run.limit != null ? `t = ${run.limit} s · ` : "";
  g += `<text x="${x0 + 16}" y="${y0 + 42}" font-size="12" fill="${C.text2}">${t}sensors with a parent: ${withParent} of ${sensors.length}${loops ? ` · ${loops} in a loop` : ""}</text>`;
  for (const [a, b] of run.links) {
    const [x1, y1] = P(a), [x2, y2] = P(b);
    g += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.link}" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  }
  for (const [c, p] of Object.entries(run.parent)) {
    if (!p || c === run.sink) continue;
    const ok = run.reachesSink(c);
    const [x1, y1] = P(c), [x2, y2] = P(p);
    const d = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / d, uy = (y2 - y1) / d;
    g += `<line x1="${x1 + ux * R}" y1="${y1 + uy * R}" x2="${x2 - ux * (R + 3)}" y2="${y2 - uy * (R + 3)}" stroke="${ok ? C.parent : C.loop}" stroke-width="2.5" marker-end="url(#${ok ? "arrow" : "arrowLoop"})"/>`;
  }
  for (const n of Object.keys(POS)) {
    const [x, y] = P(n);
    g += n === run.sink
      ? `<rect x="${x - R}" y="${y - R}" width="${2 * R}" height="${2 * R}" rx="3" fill="${C.text}"/>`
      : `<circle cx="${x}" cy="${y}" r="${R}" fill="${C.panel}" stroke="${C.text}" stroke-width="2"/>`;
    g += `<text x="${x}" y="${y + 4}" font-size="11" font-weight="600" text-anchor="middle" fill="${n === run.sink ? C.panel : C.text}">${run.hop[n]}</text>`;
    const [dx, dy, anchor] = LABEL[n];
    g += `<text x="${x + dx}" y="${y + dy}" font-size="12" font-weight="600" text-anchor="${anchor}" fill="${C.text}">${short(n)}</text>`;
  }
  return g;
}

function notePanel(x0, y0) {
  let g = `<rect x="${x0}" y="${y0}" width="${PW}" height="${PH}" rx="8" fill="${C.panel}" stroke="${C.border}"/>`;
  let y = y0 + 28;
  notes.forEach((t, i) => {
    const head = i === 0;
    g += `<text x="${x0 + 16}" y="${y}" font-size="${head ? 15 : 12}" font-weight="${head ? 600 : 400}" fill="${head ? C.text : C.text2}" xml:space="preserve">${esc(t)}</text>`;
    y += head ? 26 : 19;
  });
  y += 6;
  g += `<line x1="${x0 + 16}" y1="${y}" x2="${x0 + 56}" y2="${y}" stroke="${C.parent}" stroke-width="2.5" marker-end="url(#arrow)"/>`;
  g += `<text x="${x0 + 66}" y="${y + 4}" font-size="12" fill="${C.text2}">child → parent</text>`;
  g += `<line x1="${x0 + 186}" y1="${y}" x2="${x0 + 226}" y2="${y}" stroke="${C.link}" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  g += `<text x="${x0 + 236}" y="${y + 4}" font-size="12" fill="${C.text2}">radio link heard</text>`;
  y += 22;
  g += `<line x1="${x0 + 16}" y1="${y}" x2="${x0 + 56}" y2="${y}" stroke="${C.loop}" stroke-width="2.5" marker-end="url(#arrowLoop)"/>`;
  g += `<text x="${x0 + 66}" y="${y + 4}" font-size="12" fill="${C.text2}">parent chain that never reaches the sink</text>`;
  return g;
}

const marker = (id, fill) => `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${fill}"/></marker>`;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif">`;
svg += `<defs>${marker("arrow", C.parent)}${marker("arrowLoop", C.loop)}</defs>`;
svg += `<rect width="${W}" height="${H}" fill="${C.surface}"/>`;
svg += `<text x="${M}" y="${M + 18}" font-size="18" font-weight="600" fill="${C.text}">${esc(title)}</text>`;
const cells = runs.length + (notes.length ? 1 : 0);
for (let i = 0; i < cells; i++) {
  const x0 = M + (i % COLS) * (PW + GAP), y0 = M + 40 + Math.floor(i / COLS) * (PH + GAP);
  svg += i < runs.length ? panel(runs[i], x0, y0) : notePanel(x0, y0);
}
svg += `</svg>\n`;
writeFileSync(out, svg);
console.log(`wrote ${out}: ${runs.map((r) => `${r.cfg} seed ${r.seed}`).join(", ")}`);

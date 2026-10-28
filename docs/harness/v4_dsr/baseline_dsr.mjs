// The DSR baseline's report (design/V4_DSR_Plan.md section 13), from one
// Baseline-#r.sca. The field is read as route.mjs reads it: positions from the
// .ned, the radio range from the run's own power, frequency and sensitivity
// (free space), shortest hops by breadth-first search.
//
// FAIL (exit 1) when the run contradicts what DSR does on this field: a sensor
// without a path, a path that does not start at the sensor, end at the sink, or
// cross only real links, a loop, a hop-limit drop or a packet off its path, or
// SensorApp's own count at the sink differing from the protocol's. REFUSE
// (exit 2) when the run is not a Baseline run on the field at -85 dBm with one
// rate, or carries no bl:* scalars. Everything else is reported.
//
// Usage: node baseline_dsr.mjs results/Baseline-#0.sca [SensorScopeNetwork.ned]

import fs from "node:fs";
import path from "node:path";

const [scaPath, nedArg] = process.argv.slice(2);
if (!scaPath) { console.log("usage: node baseline_dsr.mjs <Baseline-#r.sca> [ned]"); process.exit(3); }
const nedPath = nedArg ?? path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "SensorScopeNetwork.ned");
const sca = fs.readFileSync(scaPath, "utf8").split(/\r?\n/);
const refuse = (m) => { console.log(`REFUSE: ${m}`); process.exit(2); };

// ---- the run ---------------------------------------------------------------
const attr = {}, config = {}, par = [], S = {};
for (const l of sca) {
  let m;
  if ((m = l.match(/^attr (\S+) (.*)$/))) attr[m[1]] = m[2];
  else if ((m = l.match(/^config (\S+) (.*)$/))) config[m[1]] ??= m[2];
  else if ((m = l.match(/^par (\S+) (\S+) (.*)$/))) par.push([m[1], m[2], m[3]]);
  else if ((m = l.match(/^scalar SensorScopeNetwork\.(sink|sensor\d+)\.(\S+) ("[^"]*"|\S+) (\S+)$/)))
    ((S[m[1]] ??= {})[`${m[2]} ${m[3].replace(/"/g, "")}`] = Number(m[4]));
}
if (attr.network !== "SensorScopeNetwork") refuse(`network ${attr.network}`);
if (attr.configname !== "Baseline") refuse(`config ${attr.configname}: not the DSR baseline`);
const sens = par.filter(([m, n]) => m.endsWith("radio.receiver") && n === "sensitivity").map((p) => p[2]);
if (sens.length !== 9 || sens.some((v) => v !== "-85dBm")) refuse(`sensitivity not -85dBm on all nine radios: ${sens.join(",")}`);
const radioRate = par.filter(([m, n]) => m.endsWith("radio.transmitter") && n === "bitrate").map((p) => p[2]);
const macRate = par.filter(([m, n]) => m.endsWith("wlan[0].mac") && n === "bitrate").map((p) => p[2]);
if (new Set([...radioRate, ...macRate]).size !== 1) refuse(`radio and MAC rates differ: ${[...new Set([...radioRate, ...macRate])]}`);
const np = (n) => S[n] ?? {};
const g = (n, k) => np(n)[`generic.np ${k}`];
const names = Object.keys(S).filter((n) => g(n, "bl:node") !== undefined);
if (names.length !== 9) refuse(`bl:* scalars on ${names.length} nodes, not 9`);
const nameOf = Object.fromEntries(names.map((n) => [g(n, "bl:node"), n]));

// ---- the field -------------------------------------------------------------
const unit = (v, base) => {
  const m = String(v).match(/^(-?[\d.]+)\s*([a-zA-Z]*)$/);
  if (!m) refuse(`cannot read ${v}`);
  const x = Number(m[1]), u = m[2];
  if (base === "W") return u === "dBm" ? 1e-3 * 10 ** (x / 10) : u === "mW" ? x * 1e-3 : u === "W" ? x : refuse(`unit ${u}`);
  if (base === "Hz") return u === "GHz" ? x * 1e9 : u === "MHz" ? x * 1e6 : u === "Hz" ? x : refuse(`unit ${u}`);
};
const pt = unit(config["**.radio.transmitter.power"], "W");
const f = unit(config["**.radio.centerFrequency"], "Hz");
const range = (299792458 / f) / (4 * Math.PI) * Math.sqrt(pt / unit(sens[0], "W"));
const ned = fs.readFileSync(nedPath, "utf8");
const pos = {};
for (const m of ned.matchAll(/^\s*(sink|sensor\d+): SensorNode \{[^\n]*\n\s*@display\("p=(\d+),(\d+)/gm))
  pos[m[1]] = [Number(m[2]), Number(m[3])];
if (Object.keys(pos).length !== 9) refuse(`positions for ${Object.keys(pos).length} nodes in ${nedPath}`);
const dist = (a, b) => Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]);
const link = (a, b) => a !== b && dist(a, b) <= range;
const hops = { sink: 0 };
for (let frontier = ["sink"]; frontier.length;) {
  const next = [];
  for (const a of frontier) for (const b of names)
    if (hops[b] === undefined && link(a, b)) { hops[b] = hops[a] + 1; next.push(b); }
  frontier = next;
}

// ---- the paths -------------------------------------------------------------
let red = 0;
const fail = (m) => { red++; console.log(`  FAIL ${m}`); };
const sensors = names.filter((n) => n !== "sink").sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
const rows = [];
let longer = 0;
for (const n of sensors) {
  if (g(n, "bl:hasRoute") !== 1) { fail(`${n}: no cached path to the sink (shortest ${hops[n]} hops)`); continue; }
  const len = g(n, "bl:hopCount");
  const chain = [];
  for (let i = 0; i <= len; i++) chain.push(nameOf[g(n, `bl:path:${i}`)] ?? `?${g(n, `bl:path:${i}`)}`);
  if (chain[0] !== n) fail(`${n}: its path ${chain.join("-")} does not start at it`);
  if (chain[chain.length - 1] !== "sink") fail(`${n}: path ${chain.join("-")} does not end at the sink`);
  if (new Set(chain).size !== chain.length) fail(`${n}: a loop in ${chain.join("-")}`);
  if (nameOf[g(n, "bl:nextHop")] !== chain[1]) fail(`${n}: next hop ${nameOf[g(n, "bl:nextHop")]} is not path[1] ${chain[1]}`);
  for (let i = 0; i + 1 < chain.length; i++)
    if (!link(chain[i], chain[i + 1])) fail(`${n}: ${chain[i]}-${chain[i + 1]} is not a link (${dist(chain[i], chain[i + 1]).toFixed(1)} m > ${range.toFixed(1)} m)`);
  if (len > hops[n]) longer++;
  const sent = `data ${g(n, "bl:dataCreated")} (path ${g(n, "bl:dataSentPath")}, flood ${g(n, "bl:dataSentFlood")})`;
  const got = g("sink", `bl:dataFrom:${g(n, "bl:node")}`) ?? 0;
  rows.push(`${chain.join("-")}  ${len} hops (shortest ${hops[n]})${len > hops[n] ? "  LONGER" : ""}  at ${g(n, "bl:firstRouteAt").toFixed(3)} s  RREQs ${g(n, "bl:rreqOriginated")}  ${sent}, sink got ${got}`);
}
for (const n of names)
  for (const k of ["bl:hopLimitDrops", "bl:notOnPath"])
    if (g(n, k) > 0) fail(`${n}: ${k} ${g(n, k)}`);
const appGot = np("sink")["app[0] packetReceived:count"];
const blGot = g("sink", "bl:dataReceivedPath") + g("sink", "bl:dataReceivedFlood");
if (appGot !== blGot) fail(`the sink's SensorApp received ${appGot}, the protocol delivered ${blGot}`);

// ---- reported, not gated ---------------------------------------------------
const sum = (k) => names.reduce((s, n) => s + (g(n, k) ?? 0), 0);
const appSent = sensors.reduce((s, n) => s + (np(n)["app[0] packetSent:count"] ?? 0), 0);
const overflow = names.reduce((s, n) => s + (np(n)["wlan[0].queue droppedPacketsQueueOverflow:count"] ?? 0), 0);
console.log(`${red ? "RED  " : "GREEN"} ${path.basename(scaPath)}  range ${range.toFixed(1)} m  rate ${radioRate[0]}  paths longer than the shortest ${longer} of ${sensors.length}`);
for (const r of rows) console.log(`  ${r}`);
console.log(`  sink: received ${blGot} of ${appSent} sent (path ${g("sink", "bl:dataReceivedPath")}, flood ${g("sink", "bl:dataReceivedFlood")})`);
console.log(`  RREQs ${sum("bl:rreqOriginated")} (forwarded ${sum("bl:rreqForwarded")}, answered ${sum("bl:rreqAnswered")})  RREPs sent ${sum("bl:rrepSent")} forwarded ${sum("bl:rrepForwarded")} received ${sum("bl:rrepReceived")}`);
console.log(`  data forwarded ${sum("bl:dataForwarded")}  duplicates dropped ${sum("bl:duplicatesDropped")}  queue overflow ${overflow}`);
process.exitCode = red ? 1 : 0;

// compare_dsr.mjs -- v4 DSR (Route360-#r, the dsr:* scalars of the pasted test code)
// beside the DSR baseline (Baseline-#r, DSRRoute's bl:* scalars), sensor by sensor.
// design/V4_DSR_Plan.md section 13.
//
//   node compare_dsr.mjs <Route360-#r.sca> <Baseline-#r.sca>
//
// The two runs are paired by seed set only: the modules draw from the random
// number generator differently, so the same seed set is not the same random run.
// REFUSE (exit 2) on a wrong config, network, sensitivity or a radio/MAC rate that
// differs within a run or between the two. Report only otherwise.
import fs from "node:fs";
import path from "node:path";

const [v4Path, blPath] = process.argv.slice(2);
if (!v4Path || !blPath) { console.log("usage: node compare_dsr.mjs <Route360-#r.sca> <Baseline-#r.sca>"); process.exit(3); }
const refuse = (m) => { console.log(`REFUSE: ${m}`); process.exit(2); };

function readRun(p) {
  const attr = {}, par = [], S = {};
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    let m;
    if ((m = l.match(/^attr (\S+) (.*)$/))) attr[m[1]] = m[2];
    else if ((m = l.match(/^par (\S+) (\S+) (.*)$/))) par.push([m[1], m[2], m[3]]);
    else if ((m = l.match(/^scalar SensorScopeNetwork\.(sink|sensor\d+)\.(\S+) ("[^"]*"|\S+) (\S+)$/)))
      ((S[m[1]] ??= {})[`${m[2]} ${m[3].replace(/"/g, "")}`] = Number(m[4]));
  }
  if (attr.network !== "SensorScopeNetwork") refuse(`${path.basename(p)}: network ${attr.network}`);
  const sens = par.filter(([m, n]) => m.endsWith("radio.receiver") && n === "sensitivity").map((x) => x[2]);
  if (sens.length !== 9 || sens.some((v) => v !== "-85dBm")) refuse(`${path.basename(p)}: sensitivity not -85dBm on all nine radios`);
  const rates = new Set(par.filter(([m, n]) => (m.endsWith("radio.transmitter") || m.endsWith("wlan[0].mac")) && n === "bitrate").map((x) => x[2]));
  if (rates.size !== 1) refuse(`${path.basename(p)}: radio and MAC rates differ: ${[...rates]}`);
  return { attr, S, rate: [...rates][0], g: (n, k) => (S[n] ?? {})[`generic.np ${k}`] };
}

const v4 = readRun(v4Path), bl = readRun(blPath);
if (!/^Route360$/.test(v4.attr.configname)) refuse(`${path.basename(v4Path)}: config ${v4.attr.configname}, not Route360`);
if (bl.attr.configname !== "Baseline") refuse(`${path.basename(blPath)}: config ${bl.attr.configname}, not Baseline`);
if (v4.rate !== bl.rate) refuse(`the two runs are at different rates: ${v4.rate} vs ${bl.rate}`);

// v4: node ids are module ids (dsr:myId); the cached path leaves the originator out.
const v4Names = Object.keys(v4.S).filter((n) => v4.g(n, "dsr:myId") !== undefined);
const v4NameOf = Object.fromEntries(v4Names.map((n) => [v4.g(n, "dsr:myId"), n]));
// Baseline: node index = sink 0, sensorN N; the path starts with the originator.
const blNames = Object.keys(bl.S).filter((n) => bl.g(n, "bl:node") !== undefined);
const blNameOf = Object.fromEntries(blNames.map((n) => [bl.g(n, "bl:node"), n]));
if (v4Names.length !== 9 || blNames.length !== 9) refuse(`scalars on ${v4Names.length} / ${blNames.length} nodes, not 9`);

const v4Chain = (n) => {
  if (v4.g(n, "dsr:hasRoute") !== 1) return null;
  const len = v4.g(n, "dsr:hopCount"), c = [n];
  for (let i = 0; i < len; i++) c.push(v4NameOf[v4.g(n, `dsr:path:${i}`)] ?? `?${v4.g(n, `dsr:path:${i}`)}`);
  return c;
};
const blChain = (n) => {
  if (bl.g(n, "bl:hasRoute") !== 1) return null;
  const len = bl.g(n, "bl:hopCount"), c = [];
  for (let i = 0; i <= len; i++) c.push(blNameOf[bl.g(n, `bl:path:${i}`)] ?? `?${bl.g(n, `bl:path:${i}`)}`);
  return c;
};

const sensors = v4Names.filter((n) => n !== "sink").sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
let samePath = 0, sameHops = 0, sameFirst = 0, both = 0;
console.log(`${path.basename(v4Path)} (v4 DSR) vs ${path.basename(blPath)} (baseline), rate ${v4.rate}`);
console.log(`  ${"sensor".padEnd(8)} ${"v4 path".padEnd(44)} ${"baseline path".padEnd(44)} hops  first route (s)`);
for (const n of sensors) {
  const a = v4Chain(n), b = blChain(n);
  if (a && b) {
    both++;
    if (a.join("-") === b.join("-")) samePath++;
    if (a.length === b.length) sameHops++;
    if (a[1] === b[1]) sameFirst++;
  }
  const t = (x) => (x < 0 ? "--" : x.toFixed(3));
  const mark = a && b ? (a.join("-") === b.join("-") ? "  same" : a.length === b.length ? "  same length" : "  DIFFERENT LENGTH") : "";
  console.log(`  ${n.padEnd(8)} ${(a ? a.join("-") : "none").padEnd(44)} ${(b ? b.join("-") : "none").padEnd(44)} ${a ? a.length - 1 : "-"}/${b ? b.length - 1 : "-"}  ${t(v4.g(n, "dsr:firstRouteAt"))} / ${t(bl.g(n, "bl:firstRouteAt"))}${mark}`);
}
const sum = (run, k, names) => names.reduce((s, n) => s + (run.g(n, k) ?? 0), 0);
console.log(`  both routed ${both} of ${sensors.length}: same path ${samePath}, same hop count ${sameHops}, same first hop ${sameFirst}`);
console.log(`  RREQs originated: v4 ${sum(v4, "dsr:rreqOriginated", v4Names)}, baseline ${sum(bl, "bl:rreqOriginated", blNames)}; ` +
  `RREPs sent: v4 ${sum(v4, "dsr:rrepSent", v4Names)}, baseline ${sum(bl, "bl:rrepSent", blNames)}`);

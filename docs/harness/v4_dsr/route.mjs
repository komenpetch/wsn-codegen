// The v4 DSR route test (design/V4_DSR_Plan.md section 8): checks every cached
// source route in one run against an INDEPENDENT picture of the field. It reads
// the run's .sca and the field's .ned, nothing from the DSR test code: the links
// come from the node positions and the radio's own numbers (free space:
// range = λ/(4π) · sqrt(Pt / sensitivity)), the shortest hops from a BFS.
//   node route.mjs results/<config>-#<run>.sca [SensorScopeNetwork.ned]
// Exit 0 GREEN, 1 RED (a FAIL line), 2 REFUSE (not a run this test can judge).
import fs from "node:fs";
import path from "node:path";

const [scaPath, nedArg] = process.argv.slice(2);
if (!scaPath) { console.error("usage: node route.mjs <run.sca> [field.ned]"); process.exit(2); }
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
const cfg = attr.configname;
if (!/^(Route360|FailSensor)/.test(cfg ?? "")) refuse(`config ${cfg}: not a DSR route run`);
const sens = par.filter(([m, n]) => m.endsWith("radio.receiver") && n === "sensitivity").map((p) => p[2]);
if (sens.length !== 9 || sens.some((v) => v !== "-85dBm")) refuse(`sensitivity not -85dBm on all nine radios: ${sens.join(",")}`);
const radioRate = par.filter(([m, n]) => m.endsWith("radio.transmitter") && n === "bitrate").map((p) => p[2]);
const macRate = par.filter(([m, n]) => m.endsWith("wlan[0].mac") && n === "bitrate").map((p) => p[2]);
if (new Set([...radioRate, ...macRate]).size !== 1) refuse(`radio and MAC rates differ: ${[...new Set([...radioRate, ...macRate])]}`);
const np = (n) => S[n] ?? {};
const g = (n, k) => np(n)[`generic.np ${k}`];
const names = Object.keys(S).filter((n) => g(n, "dsr:myId") !== undefined);
if (names.length !== 9) refuse(`dsr:* scalars on ${names.length} nodes, not 9 (is dsr on?)`);
const idOf = Object.fromEntries(names.map((n) => [n, g(n, "dsr:myId")]));
const nameOf = Object.fromEntries(names.map((n) => [idOf[n], n]));

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
const pr = unit(sens[0], "W");
const range = (299792458 / f) / (4 * Math.PI) * Math.sqrt(pt / pr);
const ned = fs.readFileSync(nedPath, "utf8");
const pos = {};
for (const m of ned.matchAll(/^\s*(sink|sensor\d+): SensorNode \{[^\n]*\n\s*@display\("p=(\d+),(\d+)/gm))
  pos[m[1]] = [Number(m[2]), Number(m[3])];
if (Object.keys(pos).length !== 9) refuse(`positions for ${Object.keys(pos).length} nodes in ${nedPath}`);
const dist = (a, b) => Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]);
const failed = new Set(names.filter((n) => g(n, "dsr:failed") === 1));
const link = (a, b) => a !== b && dist(a, b) <= range;
// A failure config must have failed exactly the node it names, and that node
// must have died before discovery (plan Q3 b: no model frame sent); otherwise a
// misspelt failAt would grade a failure run as a plain Route360 and pass.
const named = cfg.match(/^FailSensor(\d+)$/);
const wantFailed = named ? [`sensor${named[1]}`] : [];
if ([...failed].sort().join() !== wantFailed.join())
  refuse(`config ${cfg} needs failed [${wantFailed}], the run has [${[...failed]}]`);
for (const n of failed)
  if ((g(n, "fired:send_down") ?? 0) > 0) refuse(`${n} sent ${g(n, "fired:send_down")} model frames before failing: not dead before discovery`);
const alive = names.filter((n) => !failed.has(n));
const hops = { sink: 0 };
for (let frontier = ["sink"]; frontier.length;) {
  const next = [];
  for (const a of frontier) for (const b of alive)
    if (hops[b] === undefined && link(a, b)) { hops[b] = hops[a] + 1; next.push(b); }
  frontier = next;
}

// ---- the checks ------------------------------------------------------------
let red = 0;
const fail = (m) => { red++; console.log(`  FAIL ${m}`); };
const sensors = names.filter((n) => n !== "sink").sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
const rows = [];
for (const n of sensors) {
  const has = g(n, "dsr:hasRoute") === 1;
  if (failed.has(n)) { if (has) rows.push(`${n} failed, still has a route`); continue; }
  const reachable = hops[n] !== undefined;
  if (reachable && !has) { fail(`${n}: no cached path to the sink (shortest ${hops[n]} hops)`); continue; }
  if (!reachable && has) { fail(`${n}: a cached path, but the sink is unreachable without the failed node`); continue; }
  if (!has) { rows.push(`${n}: no path (unreachable, as expected)`); continue; }
  const len = g(n, "dsr:hopCount");
  const p = [];
  for (let i = 0; i < len; i++) p.push(nameOf[g(n, `dsr:path:${i}`)] ?? `?${g(n, `dsr:path:${i}`)}`);
  const chain = [n, ...p];
  if (p[p.length - 1] !== "sink") fail(`${n}: path ${chain.join("-")} does not end at the sink`);
  if (p.slice(0, -1).includes("sink")) fail(`${n}: the sink inside the path ${chain.join("-")}`);
  if (new Set(chain).size !== chain.length) fail(`${n}: a loop in ${chain.join("-")}`);
  for (const x of p) if (failed.has(x)) fail(`${n}: the failed ${x} in ${chain.join("-")}`);
  for (let i = 0; i + 1 < chain.length; i++)
    if (!link(chain[i], chain[i + 1])) fail(`${n}: ${chain[i]}-${chain[i + 1]} is not a link (${dist(chain[i], chain[i + 1]).toFixed(1)} m > ${range.toFixed(1)} m)`);
  if (g(n, `dsr:heard:${idOf[p[0]]}`) !== 1) fail(`${n}: next hop ${p[0]} not in its neighbour table`);
  if (g(n, "dsr:inetRouteOk") !== 1) fail(`${n}: INET's route to the sink is not via ${p[0]}`);
  rows.push(`${n}: ${chain.join("-")}  ${len} hops (shortest ${hops[n]})${len > hops[n] ? "  LONGER" : ""}  at ${g(n, "dsr:firstRouteAt").toFixed(3)} s`);
}
for (const n of names) {
  for (const k of ["dsr:rreqPathMissing", "dsr:pathTooLong", "dsr:rrepNotOnPath"])
    if (g(n, k) > 0) fail(`${n}: ${k} ${g(n, k)}`);
  for (const [k, v] of Object.entries(np(n)))
    if (/^generic\.np fired:(\w*[dD]ata\w*|create_rrepPkt|create_rrerPkt)$/.test(k) && v > 0) fail(`${n}: ${k.slice(11)} ${v}`);
}
if ((g("sink", "fired:create_rreqPkt") ?? 0) > 0) fail(`the sink created ${g("sink", "fired:create_rreqPkt")} RREQs`);

// ---- reported, not gated ---------------------------------------------------
const sum = (k) => names.reduce((s, n) => s + (g(n, k) ?? 0), 0);
const overflow = names.reduce((s, n) => s + (np(n)["wlan[0].queue droppedPacketsQueueOverflow:count"] ?? 0), 0);
const heardMismatch = [];
for (const a of names) for (const b of names)
  if (a !== b && !failed.has(a) && !failed.has(b) && link(a, b) !== (g(a, `dsr:heard:${idOf[b]}`) === 1)) heardMismatch.push(`${a}>${b}`);
console.log(`${red ? "RED  " : "GREEN"} ${path.basename(scaPath)}  config ${cfg}  range ${range.toFixed(1)} m  rate ${radioRate[0]}`);
for (const r of rows) console.log(`  ${r}`);
console.log(`  RREQs ${sum("dsr:rreqOriginated")}  RREPs sent ${sum("dsr:rrepSent")} forwarded ${sum("dsr:rrepForwarded")} received ${sum("dsr:rrepReceived")} duplicates ${sum("dsr:rrepDuplicate")}`);
console.log(`  cache writes ${sum("dsr:routeUpdates")}  addEntry ${sum("dsr:addEntryCalls")} refused ${sum("dsr:addEntryRefused")}  sink copies ignored ${sum("dsr:rreqFromSinkIgnored")}  queue overflow ${overflow}`);
console.log(`  links: model's neighbour tables vs the field's ${heardMismatch.length ? "DIFFER " + heardMismatch.join(" ") : "agree"}`);
process.exitCode = red ? 1 : 0;

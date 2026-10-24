// node compare_aodv.mjs [results-dir] -- v4 AODV against the baseline, run for
// run (design/V4_AODV_Plan.md §8, "the per-sensor comparison with the
// baseline"): Route360-#r beside Baseline-#r for every run number present in
// both. Per sensor: next hop and hop count on each side, when each first had a
// route; then the RREQs each side originated, the sink's sequence number and
// queue overflow. Reported, not gated.
//
// v4's side is the aodv:* scalars of the AODV test code (generic.np), the
// baseline's the bl:* scalars of BaselineAodv (aodv). Next hops are compared by
// NODE NAME, read off each file's own myId scalars.
// REFUSE (exit 2) if a file is not the config its name says, not the old field,
// a radio is not at -85dBm on its per-module line, the radio and SMAC rates
// are not one rate, or the two runs of a pair are on different links.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "results";
const SENSORS = Array.from({ length: 8 }, (_, i) => `sensor${i + 1}`);
const NODES = ["sink", ...SENSORS];

function load(file, config, network, mod, prefix) {
  const text = readFileSync(file, "utf8");
  const name = /^attr configname (\S+)$/m.exec(text)?.[1];
  if (name !== config) throw new Error(`${file}: configname ${name}, not ${config}`);
  if (/^attr network (\S+)$/m.exec(text)?.[1] !== network) throw new Error(`${file}: network is not ${network}`);
  const sens = [...text.matchAll(/^par \S+\.radio\.receiver sensitivity (\S+)$/gm)].map((m) => m[1]);
  if (sens.length !== NODES.length || sens.some((s) => s !== "-85dBm"))
    throw new Error(`${file}: per-module sensitivity [${sens.join(", ")}], expected -85dBm on all ${NODES.length}`);
  // The link rate: radio and SMAC must carry one rate on all nine nodes.
  const rates = [...text.matchAll(/^par \S+\.wlan\[0\]\.(?:radio\.transmitter|mac) bitrate (\S+)$/gm)].map((m) => m[1]);
  if (rates.length !== 2 * NODES.length || new Set(rates).size !== 1)
    throw new Error(`${file}: radio and SMAC bitrates [${[...new Set(rates)].join(", ")}] are not one rate on all ${NODES.length} nodes`);
  const s = new Map();
  for (const m of text.matchAll(new RegExp(`^scalar ${network}\\.(\\S+) (?:"([^"]+)"|(\\S+)) (\\S+)$`, "gm")))
    s.set(`${m[1]} ${m[2] ?? m[3]}`, Number(m[4]));
  const get = (n, k) => s.get(`${n}.${mod} ${prefix}${k}`);
  const byId = Object.fromEntries(NODES.map((n) => [get(n, "myId"), n]));
  return {
    get, run: /^attr runnumber (\S+)$/m.exec(text)?.[1], link: rates[0],
    nextHop: (n) => (get(n, "hasRoute") === 1 ? byId[get(n, "nextHop")] ?? "?" : "-"),
    hops: (n) => (get(n, "hasRoute") === 1 ? get(n, "hopCount") : "-"),
    overflow: () => NODES.map((n) => [n, s.get(`${n}.wlan[0].queue droppedPacketsQueueOverflow:count`) ?? 0])
      .filter(([, v]) => v !== 0).map(([n, v]) => `${n}=${v}`).join(" ") || "none",
  };
}

const runs = (cfg) => new Map(readdirSync(dir).filter((f) => f.startsWith(`${cfg}-#`) && f.endsWith(".sca"))
  .map((f) => [/#(\d+)\.sca$/.exec(f)[1], join(dir, f)]));
const v4Runs = runs("Route360"), blRuns = runs("Baseline");
const both = [...v4Runs.keys()].filter((r) => blRuns.has(r)).sort();
if (both.length === 0) { console.log(`REFUSE: no run number with both Route360 and Baseline in ${dir}`); process.exit(2); }

let refused = false;
const sum = { sameHop: 0, sameHops: 0, n: 0 };
for (const r of both) {
  let v, b;
  try {
    v = load(v4Runs.get(r), "Route360", "SensorScopeNetwork", "generic.np", "aodv:");
    // The same field, nodes swapped by derive_baseline_net.mjs.
    b = load(blRuns.get(r), "Baseline", "SensorScopeAodvNetwork", "aodv", "bl:");
  } catch (e) { console.log(`REFUSE: ${e.message}`); refused = true; continue; }
  // Like for like (plan Q26): both sides on one link, or the pair means nothing.
  if (v.link !== b.link) { console.log(`REFUSE: run #${r}: Route360 at ${v.link}, Baseline at ${b.link}`); refused = true; continue; }
  console.log(`== run #${r}: Route360 (v4) | Baseline (INET AODV), link ${v.link}`);
  console.log("   node      next hop v4|INET     hops v4|INET   route at v4|INET");
  for (const n of SENSORS) {
    const same = v.nextHop(n) === b.nextHop(n), sameHops = v.hops(n) === b.hops(n);
    sum.n++; if (same) sum.sameHop++; if (sameHops) sum.sameHops++;
    const at = (x) => (x >= 0 ? x.toFixed(2) : "-");
    console.log(`   ${n.padEnd(9)} ${`${v.nextHop(n)} | ${b.nextHop(n)}`.padEnd(20)}${same ? " " : "*"} ${`${v.hops(n)} | ${b.hops(n)}`.padEnd(13)}${sameHops ? " " : "*"} ${at(v.get(n, "firstRouteAt"))} | ${at(b.get(n, "firstRouteAt"))}`);
  }
  const total = (x, k) => SENSORS.reduce((a, n) => a + (x.get(n, k) ?? 0), 0);
  console.log(`   RREQs originated ${total(v, "rreqOriginated")} | ${total(b, "rreqOriginated")}; the sink's sequence number ${v.get("sink", "sequenceNum")} | ${b.get("sink", "sequenceNum")}`);
  console.log(`   queue overflow: ${v.overflow()} | ${b.overflow()}`);
}
if (sum.n) console.log(`\nover ${both.length} run(s): the same next hop on ${sum.sameHop} of ${sum.n} sensor routes, the same hop count on ${sum.sameHops} of ${sum.n} (* marks a difference)`);
process.exit(refused ? 2 : 0);

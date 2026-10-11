// Per node: the baseline's control counters beside v4's, from one run of each.
//   node compare.mjs [results-dir]          (default: ./results)
//
// The baseline records nbBeaconsSent / nbRouteFloodsSent / nbRouteFloodsReceived
// in finish() (MintRoute.cc:612-623). v4 does not record those names yet, so its
// side is read off the scheduler's `fired:<event>` scalars:
//   beacons created   = fired:create_beaconPkt
//   routes created    = fired:create_routePkt
//   control received  = fired:receive_controlPkt + fired:receive_dup_controlPkt
//                       (one count for both types: v4 has no per-type reception
//                       until onReceiveRoutePkt exists)
// Originations are what compare (D14: v4 keeps the model's flood, the baseline
// never rebroadcasts), so the received columns are shown, not compared.
//
// ⚠ Refuses rather than prints when a file is not the run it claims to be: the
// config name is read off `attr configname`, and every radio must report
// -85dBm on its PER-MODULE sensitivity line (the -100dBm mesh trap).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "results";
const NODES = ["sink", ...Array.from({ length: 8 }, (_, i) => `sensor${i + 1}`)];

function load(config) {
  const f = readdirSync(dir).find((n) => n.startsWith(`${config}-`) && n.endsWith(".sca"));
  if (!f) throw new Error(`no ${config}-*.sca in ${dir}`);
  const text = readFileSync(join(dir, f), "utf8");
  const name = /^attr configname (\S+)$/m.exec(text)?.[1];
  if (name !== config) throw new Error(`${f}: configname is ${name}, not ${config}`);
  const sens = [...text.matchAll(/^par \S+\.radio\.receiver sensitivity (\S+)$/gm)].map((m) => m[1]);
  if (sens.length !== NODES.length || sens.some((s) => s !== "-85dBm"))
    throw new Error(`${f}: per-module sensitivity is [${sens.join(", ")}], expected -85dBm on all ${NODES.length}`);
  const scalars = new Map();
  for (const m of text.matchAll(/^scalar (\S+) (?:"([^"]+)"|(\S+)) (\S+)$/gm))
    scalars.set(`${m[1]} ${m[2] ?? m[3]}`, Number(m[4]));
  return { file: f, get: (node, mod, name) => scalars.get(`SensorScopeNetwork.${node}.${mod} ${name}`) ?? 0 };
}

const base = load("Baseline"), v4 = load("V4");
const mac = (r, n, s) => r.get(n, "wlan[0].mac", s);
const overflow = (r, n) => r.get(n, "wlan[0].queue", "droppedPacketsQueueOverflow:count");

console.log(`Baseline: ${base.file}   V4: ${v4.file}\n`);
const head = ["node", "beacons B|v4", "routes B|v4", "ctl rcvd B|v4", "MAC Tx B|v4", "MAC Rx B|v4", "q.ovfl B|v4"];
const rows = [head];
const tot = { bb: 0, vb: 0, br: 0, vr: 0 };
for (const n of NODES) {
  const bb = base.get(n, "generic.np", "nbBeaconsSent"), vb = v4.get(n, "generic.np", "fired:create_beaconPkt");
  const br = base.get(n, "generic.np", "nbRouteFloodsSent"), vr = v4.get(n, "generic.np", "fired:create_routePkt");
  const brx = base.get(n, "generic.np", "nbRouteFloodsReceived");
  const vrx = v4.get(n, "generic.np", "fired:receive_controlPkt") + v4.get(n, "generic.np", "fired:receive_dup_controlPkt");
  Object.assign(tot, { bb: tot.bb + bb, vb: tot.vb + vb, br: tot.br + br, vr: tot.vr + vr });
  rows.push([n, `${bb} | ${vb}`, `${br} | ${vr}`, `${brx} | ${vrx}`,
    `${mac(base, n, "nbTxDataPackets")} | ${mac(v4, n, "nbTxDataPackets")}`,
    `${mac(base, n, "nbRxDataPackets")} | ${mac(v4, n, "nbRxDataPackets")}`,
    `${overflow(base, n)} | ${overflow(v4, n)}`]);
}
rows.push(["total", `${tot.bb} | ${tot.vb}`, `${tot.br} | ${tot.vr}`, "", "", "", ""]);
const w = head.map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
for (const r of rows) console.log(r.map((x, c) => String(x).padEnd(w[c])).join("  "));
console.log("\nB = baseline nbBeaconsSent / nbRouteFloodsSent / nbRouteFloodsReceived;"
  + " v4 = fired:create_beaconPkt / create_routePkt / receive_controlPkt + receive_dup_controlPkt.");

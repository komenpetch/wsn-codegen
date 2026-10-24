// The tree the baseline built, read off a [Config BaselineData] or
// [Config BaselineDataAsIs] .sca: the bl:* scalars BaselineMintRoute::finish()
// records (same meanings as MintRoute's mrt:* in v4). A REPORT, not a gate: the
// baseline is what v4 is compared against, not something under test.
//   node baseline_tree.mjs <sca>      exit 0, or 3 BROKEN
// Per sensor: parent, hop against its shortest path over the links it heard,
// when it first had a parent, parent changes, cost, the link estimates to its
// parent. Then whether every parent was heard and the parents reach the sink,
// and the DATA and queue counters.
import { readFileSync } from "node:fs";

const sca = process.argv[2];
if (!sca) { console.error("usage: node baseline_tree.mjs <sca>"); process.exit(3); }
function broken(msg) { console.log(`BROKEN: ${msg}`); process.exit(3); }

const np = {}, all = {};
let cfg = "", seed = "";
for (const l of readFileSync(sca, "utf8").split(/\r?\n/)) {
  if (l.startsWith("attr configname ")) cfg = l.split(" ")[2];
  if (l.startsWith("attr seedset ")) seed = l.split(" ")[2];
  const m = l.match(/^scalar SensorScopeNetwork\.(\w+)\.(\S+) (\S+) (\S+)$/);
  if (!m) continue;
  const k = m[3].replace(/^"|"$/g, "");
  ((all[m[1]] ??= {})[k] = (all[m[1]]?.[k] ?? 0) + Number(m[4]));
  if (m[2] === "generic.np") (np[m[1]] ??= {})[k] = Number(m[4]);
}
if (!cfg.startsWith("BaselineData")) broken(`configname ${cfg}, expected BaselineData or BaselineDataAsIs`);
const nodes = Object.keys(np).filter((n) => "bl:myId" in np[n]);
if (nodes.length !== 9) broken(`bl:* on ${nodes.length} nodes, expected 9`);
const v = (n, k) => np[n][k] ?? 0;
const nameOf = new Map(nodes.map((n) => [v(n, "bl:myId"), n]));
const sink = nodes.find((n) => v(n, "bl:isSink") === 1);
if (!sink) broken("no sink");
const sensors = nodes.filter((n) => n !== sink).sort();

const heard = new Map(nodes.map((n) => [n, Object.keys(np[n])
  .filter((k) => k.startsWith("bl:heard:")).map((k) => nameOf.get(Number(k.slice(9)))).filter(Boolean)]));
const shortest = new Map([[sink, 0]]);
for (let changed = true; changed;) {
  changed = false;
  for (const n of nodes) for (const m of heard.get(n)) {
    if (!shortest.has(m)) continue;
    const d = shortest.get(m) + 1;
    if (!shortest.has(n) || d < shortest.get(n)) { shortest.set(n, d); changed = true; }
  }
}

console.log(`${cfg}, seed set ${seed}, restoreMiximOrder=${v(sink, "bl:restoreMiximOrder")}`);
console.log("node      parent    hop  shortest  first(s)  changes  cost   recvEst  sendEst");
const notes = [];
for (const n of sensors) {
  const has = v(n, "bl:hasParent") === 1;
  const p = has ? nameOf.get(v(n, "bl:parent")) : null;
  const id = has ? v(n, "bl:parent") : null;
  const first = v(n, "bl:firstParentAt");
  console.log([n.padEnd(9), (p ?? "none").padEnd(9), String(has ? v(n, "bl:hop") : "-").padEnd(4),
    String(shortest.get(n) ?? "-").padEnd(9), (first < 0 ? "-" : first.toFixed(1)).padEnd(9),
    String(v(n, "bl:parentChanges")).padEnd(8), String(has ? v(n, "bl:cost") : "-").padEnd(6),
    String(has ? v(n, `bl:receiveEst:${id}`) : "-").padEnd(8), String(has ? v(n, `bl:sendEst:${id}`) : "-")].join(" "));
  if (has && !heard.get(n).includes(p)) notes.push(`${n}: parent ${p} not in its neighbour table`);
  if (has) {   // follow the parents to the sink
    const seen = new Set([n]);
    let cur = p;
    while (cur && cur !== sink && !seen.has(cur)) {
      seen.add(cur);
      cur = v(cur, "bl:hasParent") === 1 ? nameOf.get(v(cur, "bl:parent")) : null;
    }
    if (cur !== sink) notes.push(`${n}: parents do not reach the sink (${cur ? "loop" : "dead end"})`);
  }
}
const withParent = sensors.filter((n) => v(n, "bl:hasParent") === 1).length;
console.log(`sensors with a parent: ${withParent} of ${sensors.length}`);
console.log(notes.length ? notes.join("\n") : "every parent was heard and every chain reaches the sink");

const sum = (k) => nodes.reduce((a, n) => a + (all[n]?.[k] ?? 0), 0);
const row = (label, k) => console.log(`${label.padEnd(26)}${nodes.map((n) => String(all[n]?.[k] ?? 0).padStart(6)).join("")}  total ${sum(k)}`);
console.log(`\n${"".padEnd(26)}${nodes.map((n) => n.replace("sensor", "s").padStart(6)).join("")}`);
row("DATA sent (SensorApp)", "packetSent:count");
row("DATA received (SensorApp)", "packetReceived:count");
row("DATA duplicates dropped", "nbDuplicatesDropped");
row("duplicates counted first", "bl:countedDuplicates");
row("DATA forwarded", "nbDataPacketsForwarded");
row("beacons sent", "nbBeaconsSent");
row("route floods sent", "nbRouteFloodsSent");
row("queue overflow", "droppedPacketsQueueOverflow:count");

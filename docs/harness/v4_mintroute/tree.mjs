// Step 3g's gates on the tree MintRoute built (user, 2026-10-13, Q12), read off
// the [Config Parent] .sca: the mrt:* scalars MintRoute::finish() records.
//   node tree.mjs <Parent .sca>     exit 0 GREEN, 1 RED, 3 BROKEN
//
// RED (a defect to find): a sensor without a parent; a parent the sensor has not
// heard; parents that do not reach the sink (a loop or a dead end); the sink not
// its own root at cost 0; INET's route to the sink not via the parent; a ROUTE
// arrival without MintRoute's fields; a data event.
// REPORTED, not gated: each sensor's hop count against its shortest path over
// the links it heard, when it first had a parent, parent switches, cost, the
// link estimates to its parent, addEntry calls and refusals.
import { readFileSync } from "node:fs";

const sca = process.argv[2];
if (!sca) { console.error("usage: node tree.mjs <sca>"); process.exit(3); }
const lines = readFileSync(sca, "utf8").split(/\r?\n/);
function broken(msg) { console.log(`BROKEN: ${msg}`); process.exit(3); }

// node -> { scalar name -> value }, for SensorScopeNetwork.<node>.generic.np
const np = {};
for (const l of lines) {
  const m = l.match(/^scalar SensorScopeNetwork\.(\w+)\.generic\.np (\S+) (\S+)$/);
  if (!m) continue;
  (np[m[1]] ??= {})[m[2]] = Number(m[3]);
}
const nodes = Object.keys(np).filter((n) => "mrt:myId" in np[n]);
if (nodes.length === 0) broken("no mrt:* scalars -- MintRoute did not run");
const v = (n, k) => np[n][k] ?? 0;
const nameOf = new Map(nodes.map((n) => [v(n, "mrt:myId"), n]));
const sinks = nodes.filter((n) => v(n, "mrt:isSink") === 1);
if (sinks.length !== 1) broken(`expected one sink, found ${sinks.length}: ${sinks}`);
const sink = sinks[0];
const sensors = nodes.filter((n) => n !== sink).sort();

const RED = [];
const red = (msg) => RED.push(msg);

// The sink is its own root at cost 0 (MintRoute.cc:93-103).
if (v(sink, "mrt:parent") !== v(sink, "mrt:myId") || v(sink, "mrt:cost") !== 0)
  red(`sink: parent=${nameOf.get(v(sink, "mrt:parent")) ?? v(sink, "mrt:parent")} cost=${v(sink, "mrt:cost")}`);

// Who each node heard (the model's neighbourTbl), for the shortest paths.
const heard = new Map(nodes.map((n) => [n, Object.keys(np[n])
  .filter((k) => k.startsWith("mrt:heard:")).map((k) => nameOf.get(Number(k.slice(10)))).filter(Boolean)]));
const shortest = new Map([[sink, 0]]);   // hops to the sink over "n heard m" links
for (let changed = true; changed;) {
  changed = false;
  for (const n of nodes) for (const m of heard.get(n)) {
    if (!shortest.has(m)) continue;
    const d = shortest.get(m) + 1;
    if (!shortest.has(n) || d < shortest.get(n)) { shortest.set(n, d); changed = true; }
  }
}

const rows = [];
for (const n of sensors) {
  const has = v(n, "mrt:hasParent") === 1;
  const p = nameOf.get(v(n, "mrt:parent"));
  if (!has) { red(`${n}: no parent`); }
  else {
    if (v(n, "mrt:parentHeard") !== 1) red(`${n}: parent ${p} not in its neighbour table`);
    if (v(n, "mrt:inetRouteOk") !== 1) red(`${n}: INET's route to the sink is not via ${p}`);
    // Follow the parents to the sink.
    const seen = new Set([n]);
    let at = n, ok = false;
    for (let k = 0; k < nodes.length; k++) {
      const next = nameOf.get(v(at, "mrt:parent"));
      if (next === undefined) break;
      if (next === sink) { ok = true; break; }
      if (seen.has(next)) break;
      seen.add(next); at = next;
    }
    if (!ok) red(`${n}: parents do not reach the sink (${[...seen].join(" -> ")})`);
  }
  if (v(n, "mrt:routeFieldsMissing") > 0) red(`${n}: ${v(n, "mrt:routeFieldsMissing")} ROUTE arrivals without MintRoute's fields`);
  const pid = v(n, "mrt:parent");
  rows.push({
    node: n, parent: has ? p : "-", hop: has ? v(n, "mrt:hop") : "-", shortest: shortest.get(n) ?? "-",
    first: v(n, "mrt:firstParentAt") >= 0 ? v(n, "mrt:firstParentAt").toFixed(1) : "-",
    switches: v(n, "mrt:parentChanges"), cost: has ? v(n, "mrt:cost") : "-",
    recvEst: has ? v(n, `mrt:receiveEst:${pid}`) : "-", sendEst: has ? v(n, `mrt:sendEst:${pid}`) : "-",
    addEntry: `${v(n, "mrt:addEntryCalls")}/${v(n, "mrt:addEntryRefused")}`,
  });
}
if (v(sink, "mrt:routeFieldsMissing") > 0) red(`${sink}: ${v(sink, "mrt:routeFieldsMissing")} ROUTE arrivals without MintRoute's fields`);

let data = 0;
for (const n of nodes) for (const e of ["start_tx_dataPkt_bct", "start_tx_dataPkt_fwd", "receive_dataPkt", "receive_dup_dataPkt"])
  data += v(n, `fired:${e}`);
if (data > 0) red(`data events fired ${data} times`);

const read = nodes.reduce((s, n) => s + v(n, "mrt:routeFieldsRead"), 0);
const recv = nodes.reduce((s, n) => s + v(n, "nbRouteFloodsReceived"), 0);

console.log("node      parent    hop  shortest  first(s)  switches  cost  recvEst  sendEst  addEntry(calls/refused)");
for (const r of rows)
  console.log(`${r.node.padEnd(9)} ${String(r.parent).padEnd(9)} ${String(r.hop).padStart(3)} ${String(r.shortest).padStart(9)}`
    + ` ${String(r.first).padStart(9)} ${String(r.switches).padStart(9)} ${String(r.cost).padStart(5)}`
    + ` ${String(r.recvEst).padStart(8)} ${String(r.sendEst).padStart(8)}  ${r.addEntry}`);
console.log(`ROUTE arrivals with MintRoute's fields: ${read} of ${recv} (nbRouteFloodsReceived)`);
const longer = rows.filter((r) => typeof r.hop === "number" && typeof r.shortest === "number" && r.hop > r.shortest);
console.log(`hop count above the shortest path: ${longer.length ? longer.map((r) => `${r.node} ${r.hop}>${r.shortest}`).join(", ") : "none"}`);

if (RED.length) { console.log(`RED:\n  ${RED.join("\n  ")}`); process.exit(1); }
console.log("GREEN: every sensor has a heard parent, the parents reach the sink, INET's routes agree");
process.exit(0);

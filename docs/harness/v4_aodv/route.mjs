// node route.mjs <run.sca>... -- the v4 AODV route test (design/V4_AODV_Plan.md
// §8, Route360). Reads the aodv:* scalars the AODV test code records and the
// model's fired: counters, and checks, per run:
//   FAIL  a sensor without an active route to the sink;
//         a route's next hop not in that node's neighbour table (aodv:heard);
//         a next-hop chain from a sensor that loops or ends before the sink;
//         INET's route to the sink not via the AODV next hop (aodv:inetRouteOk);
//         any DATA event; any RREP or RRER creating event (their timers are
//         off); the sink starting an RREQ; an RREQ sent without its AODV
//         fields; no aodv:* scalars at all (the test code is not there).
//   REPORT hops against the old field's shortest path, when each route
//         appeared, discoveries, RREQ/RREP counts, refused addEntry calls.
// Exit 0 GREEN, 1 RED, 2 REFUSE (not a Route run).
import fs from "fs";

// The old field's shortest hops (SensorScopeNetwork.ned, -85 dBm; plan §2).
const SHORTEST = { sensor1: 4, sensor2: 3, sensor3: 2, sensor4: 3, sensor5: 2, sensor6: 1, sensor7: 3, sensor8: 2 };
const DATA_EVENTS = ["create_dataPkt", "start_tx_dataPkt_bct", "start_tx_dataPkt_fwd", "receive_dataPkt", "receive_dup_dataPkt"];

let worst = 0;
for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, "utf8");
  const config = (/^attr configname (\S+)/m.exec(text) || [])[1];
  const run = (/^attr runnumber (\S+)/m.exec(text) || [])[1];
  const network = (/^attr network (\S+)/m.exec(text) || [])[1];
  const nodes = {};
  for (const m of text.matchAll(/^scalar \S+?\.(sink|sensor\d+)\.generic\.np (\S+) (\S+)$/gm)) {
    (nodes[m[1]] ??= {})[m[2]] = Number(m[3]);
  }
  const fails = [], notes = [];
  if (network !== "SensorScopeNetwork") { console.log(`${file}: REFUSE, network ${network} is not the old field`); worst = Math.max(worst, 2); continue; }
  // The link rate, off every module's own par lines: the radio and SMAC must
  // carry one rate on all nine nodes (plan Q26: 250 kbps since 2026-10-19).
  const rates = [...text.matchAll(/^par \S+\.wlan\[0\]\.(?:radio\.transmitter|mac) bitrate (\S+)$/gm)].map((m) => m[1]);
  if (rates.length !== 2 * (Object.keys(SHORTEST).length + 1) || new Set(rates).size !== 1) {
    console.log(`${file}: REFUSE, radio and SMAC bitrates [${[...new Set(rates)].join(", ")}] are not one rate on all nine nodes`);
    worst = Math.max(worst, 2); continue;
  }
  if (!Object.values(nodes).some((n) => "aodv:myId" in n)) {
    console.log(`${file}: REFUSE, no aodv:* scalars (aodv = false, or the test code is missing)`);
    worst = Math.max(worst, 2); continue;
  }
  const byId = {};
  for (const [name, s] of Object.entries(nodes)) byId[s["aodv:myId"]] = name;
  const sink = Object.keys(nodes).find((n) => nodes[n]["aodv:isSink"] === 1);
  if (sink !== "sink") fails.push(`the node recording isSink is ${sink}`);

  for (const [name, s] of Object.entries(nodes)) {
    for (const e of DATA_EVENTS) if (s[`fired:${e}`] > 0) fails.push(`${name}: DATA event ${e} fired ${s[`fired:${e}`]}`);
    for (const e of ["create_rrepPkt", "create_rrerPkt"]) if (s[`fired:${e}`] > 0) fails.push(`${name}: ${e} fired ${s[`fired:${e}`]}`);
    if (s["aodv:rreqFieldsMissing"] > 0) fails.push(`${name}: ${s["aodv:rreqFieldsMissing"]} RREQ(s) sent without AODV fields`);
  }
  const sinkS = nodes.sink || {};
  if ((sinkS["fired:create_rreqPkt"] ?? 0) > 0 || (sinkS["aodv:rreqOriginated"] ?? 0) > 0) fails.push("the sink started an RREQ");

  const rows = [];
  for (const name of Object.keys(SHORTEST)) {
    const s = nodes[name] || {};
    if (s["aodv:hasRoute"] !== 1) { fails.push(`${name}: no active route to the sink`); continue; }
    const nh = byId[s["aodv:nextHop"]];
    if (!nh) { fails.push(`${name}: next hop id ${s["aodv:nextHop"]} is no node`); continue; }
    if (s[`aodv:heard:${s["aodv:nextHop"]}`] !== 1) fails.push(`${name}: next hop ${nh} not in its neighbour table`);
    if (s["aodv:inetRouteOk"] !== 1) fails.push(`${name}: INET's route to the sink is not via ${nh}`);
    // follow the chain
    const path = [name];
    let at = name;
    while (at !== "sink" && path.length <= 10) {
      const a = nodes[at] || {};
      if (at !== name && a["aodv:hasRoute"] !== 1) { fails.push(`${name}: chain ends at ${at}, which has no route`); break; }
      at = byId[a["aodv:nextHop"]];
      if (!at) { fails.push(`${name}: chain leaves the field`); break; }
      if (path.includes(at)) { fails.push(`${name}: loop ${[...path, at].join(" -> ")}`); break; }
      path.push(at);
    }
    rows.push({ name, nh, hops: s["aodv:hopCount"], chain: path.length - 1, shortest: SHORTEST[name],
      at: s["aodv:firstRouteAt"], rreq: s["aodv:rreqOriginated"] ?? 0,
      disc: `${s["aodv:discoveriesStarted"] ?? 0}/${s["aodv:discoveriesCompleted"] ?? 0}/${s["aodv:discoveriesCancelled"] ?? 0}`,
      refused: s["aodv:addEntryRefused"] ?? 0 });
  }
  const total = (k) => Object.values(nodes).reduce((t, s) => t + (s[k] ?? 0), 0);
  console.log(`== ${config} #${run} (${file.split(/[\\/]/).pop()}, link ${rates[0]}): ${fails.length ? "RED" : "GREEN"}`);
  for (const f of fails) console.log(`   FAIL ${f}`);
  console.log("   node      next hop  hops  chain shortest  route at   RREQs  disc s/c/x  refused");
  for (const r of rows)
    console.log(`   ${r.name.padEnd(9)} ${String(r.nh).padEnd(9)} ${String(r.hops).padStart(4)} ${String(r.chain).padStart(6)} ${String(r.shortest).padStart(8)} ${r.at.toFixed(3).padStart(9)} ${String(r.rreq).padStart(7)}  ${r.disc.padEnd(11)} ${String(r.refused).padStart(7)}`);
  console.log(`   totals: RREQs originated ${total("aodv:rreqOriginated")}, RREPs sent ${total("aodv:rrepSent")}, forwarded ${total("aodv:rrepForwarded")}, received ${total("aodv:rrepReceived")}, no reverse route ${total("aodv:rrepNoReverseRoute")}; addEntry ${total("aodv:addEntryCalls")} calls, ${total("aodv:addEntryRefused")} refused`);
  for (const r of rows) if (r.chain !== r.shortest) notes.push(`${r.name}: ${r.chain} hops, shortest ${r.shortest}`);
  if (notes.length) console.log(`   longer than shortest: ${notes.join("; ")}`);
  // Reported, not gated: frames the interface queue dropped (capacity reached),
  // and RREQ copies the AODV code ignored because their sender was their
  // destination (plan Q25 b).
  const overflow = [...text.matchAll(/^scalar \S+?\.(sink|sensor\d+)\.wlan\[0\]\.queue droppedPacketsQueueOverflow:count (\S+)$/gm)]
    .filter((m) => Number(m[2]) !== 0).map((m) => `${m[1]}=${m[2]}`);
  const ignored = Object.entries(nodes).filter(([, s]) => (s["aodv:rreqFromDestIgnored"] ?? 0) !== 0)
    .map(([n, s]) => `${n}=${s["aodv:rreqFromDestIgnored"]}`);
  console.log(`   queue overflow: ${overflow.length ? overflow.join(" ") : "none"}; RREQ copies from their destination ignored: ${ignored.length ? ignored.join(" ") : "none"}`);
  worst = Math.max(worst, fails.length ? 1 : 0);
}
process.exit(worst);

// node fail.mjs <run.sca>... -- the step-4 report (design/V4_AODV_Plan.md §8):
// HELLO, the lost-link rule, RERR and the node failure test.
//
// Hello360 (HELLO on, nothing fails): REPORTED only -- HELLO and RERR counts,
// every link break (each one is false: no node fails), the route to the sink
// lost and back. Its route test is route.mjs.
// FailSensor5 FAILS if: a living sensor ends without a valid route to the sink;
// a valid route's next-hop chain goes through the failed node, dead-ends or
// loops; no RERR is sent after the failure.
// FailSensor6 FAILS if: a living sensor ends with a valid route to the sink; a
// living sensor's route to the sink was never lost after the failure (the
// loss, by a lost link or an RERR, did not reach it).
// REPORTED for both: when each neighbour of the failed node declared it lost,
// the RERRs after the failure, each sensor's route to the sink lost and back
// after the failure (the stale window: INET's table keeps the old next hop
// meanwhile), INET's next hop to the sink at the end, RREQs, HELLOs, and false
// link breaks (of a node that did not fail, or before the failure).
// Exit 0 GREEN (or a Hello360 report), 1 RED, 2 REFUSE.
import fs from "fs";

const SHORTEST = { sensor1: 4, sensor2: 3, sensor3: 2, sensor4: 3, sensor5: 2, sensor6: 1, sensor7: 3, sensor8: 2 };
const NODES = ["sink", ...Object.keys(SHORTEST)];
const CONFIGS = ["Hello360", "FailSensor5", "FailSensor6"];

let worst = 0;
for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, "utf8");
  const config = (/^attr configname (\S+)/m.exec(text) || [])[1];
  const run = (/^attr runnumber (\S+)/m.exec(text) || [])[1];
  const network = (/^attr network (\S+)/m.exec(text) || [])[1];
  const refuse = (why) => { console.log(`${file}: REFUSE, ${why}`); worst = Math.max(worst, 2); };
  if (!CONFIGS.includes(config)) { refuse(`configname ${config}, not ${CONFIGS.join("/")}`); continue; }
  if (network !== "SensorScopeNetwork") { refuse(`network ${network} is not the old field`); continue; }
  const rates = [...text.matchAll(/^par \S+\.wlan\[0\]\.(?:radio\.transmitter|mac) bitrate (\S+)$/gm)].map((m) => m[1]);
  if (rates.length !== 2 * NODES.length || new Set(rates).size !== 1) {
    refuse(`radio and SMAC bitrates [${[...new Set(rates)].join(", ")}] are not one rate on all nine nodes`); continue;
  }
  const s = {};
  for (const m of text.matchAll(/^scalar \S+?\.(sink|sensor\d+)\.generic\.np (\S+) (\S+)$/gm)) (s[m[1]] ??= {})[m[2]] = Number(m[3]);
  if (NODES.some((n) => !s[n] || !("aodv:myId" in s[n]))) { refuse("no aodv:* scalars on every node"); continue; }
  const byId = Object.fromEntries(NODES.map((n) => [s[n]["aodv:myId"], n]));
  const name = (id) => byId[id] ?? `id${id}`;
  const list = (n, key) => { // aodv:<key>:<k>, in k order
    const out = [];
    for (let k = 0; `aodv:${key}:${k}` in s[n]; k++) out.push(s[n][`aodv:${key}:${k}`]);
    return out;
  };
  const failedNodes = NODES.filter((n) => s[n]["aodv:failed"] === 1);
  const failing = config !== "Hello360";
  if (failing && failedNodes.length !== 1) { refuse(`${failedNodes.length} failed nodes, expected one`); continue; }
  if (!failing && failedNodes.length !== 0) { refuse(`a node failed in ${config}`); continue; }
  const dead = failedNodes[0];
  const failAt = dead ? s[dead]["aodv:failAt"] : Infinity;
  const living = Object.keys(SHORTEST).filter((n) => n !== dead);

  const fails = [], notes = [];
  // The route to the sink at the end, and its chain of next hops.
  const rows = [];
  for (const n of living) {
    const a = s[n];
    const has = a["aodv:hasRoute"] === 1;
    // The number of hops to the sink, or why the chain does not get there.
    let chain = "-";
    if (has) {
      const path = [n];
      let at = n;
      chain = null;
      while (chain === null) {
        if (at !== n && s[at]["aodv:hasRoute"] !== 1) { chain = `ends at ${at}`; break; }
        const next = byId[s[at]["aodv:nextHop"]];
        if (!next) chain = "leaves the field";
        else if (path.includes(next)) chain = `loop ${[...path, next].join(" -> ")}`;
        else if (next === dead) chain = `through ${dead}`;
        else {
          path.push(next);
          if (next === "sink") chain = path.length - 1;
          else at = next;
        }
      }
    }
    const lossTimes = list(n, "sinkRouteAt"), lossHow = list(n, "sinkRouteHow");
    const afterFail = lossTimes.map((t, i) => [t, lossHow[i]]).filter(([t]) => t >= failAt);
    const lost = afterFail.find(([, h]) => h !== 0);
    const back = lost ? afterFail.find(([t, h]) => h === 0 && t >= lost[0]) : undefined;
    rows.push({ n, has, nh: has ? name(a["aodv:nextHop"]) : "-", hops: has ? a["aodv:hopCount"] : "-", chain,
      lost: lost ? `${lost[0].toFixed(2)} (${lost[1] === 1 ? "link" : "RERR"})` : "-",
      back: back ? back[0].toFixed(2) : "-",
      inet: a["aodv:inetSinkRoutes"] > 0 ? name(a["aodv:inetSinkNextHop"]) : "-",
      rreq: a["aodv:rreqOriginated"], hello: a["aodv:helloSent"],
      lostAfterFail: !!lost });
  }

  // Link breaks: of the failed node at or after the failure (true), the rest false.
  const breaks = [];
  for (const n of NODES) {
    if (n === dead) continue;
    const at = list(n, "breakAt"), of = list(n, "breakOf");
    at.forEach((t, i) => breaks.push({ by: n, of: name(of[i]), t, real: name(of[i]) === dead && t >= failAt }));
  }
  const falseBreaks = breaks.filter((b) => !b.real);
  const rerrAfter = NODES.filter((n) => n !== dead).flatMap((n) => list(n, "rerrAt").filter((t) => t >= failAt).map((t) => ({ n, t })));

  if (config === "FailSensor5") {
    for (const r of rows) {
      if (!r.has) fails.push(`${r.n}: no valid route to the sink at the end`);
      else if (typeof r.chain !== "number") fails.push(`${r.n}: chain ${r.chain}`);
    }
    if (rerrAfter.length === 0) fails.push("no RERR after the failure");
  }
  if (config === "FailSensor6") {
    for (const r of rows) {
      if (r.has) fails.push(`${r.n}: still a valid route to the sink at the end (next hop ${r.nh})`);
      if (!r.lostAfterFail) fails.push(`${r.n}: its route to the sink was never lost after the failure`);
    }
  }

  const verdict = config === "Hello360" ? "REPORT" : fails.length ? "RED" : "GREEN";
  console.log(`== ${config} #${run} (${file.split(/[\\/]/).pop()}, link ${rates[0]}${dead ? `, ${dead} failed at ${failAt} s` : ""}): ${verdict}`);
  for (const f of fails) console.log(`   FAIL ${f}`);
  console.log("   node      next hop  hops  chain        lost after fail  back at   INET via  RREQs  HELLOs");
  for (const r of rows)
    console.log(`   ${r.n.padEnd(9)} ${String(r.nh).padEnd(9)} ${String(r.hops).padStart(4)}  ${String(r.chain).padEnd(12)} ${r.lost.padEnd(16)} ${r.back.padStart(7)}   ${String(r.inet).padEnd(9)} ${String(r.rreq).padStart(5)}  ${String(r.hello).padStart(6)}`);
  const total = (k) => NODES.reduce((t, n) => t + (s[n][k] ?? 0), 0);
  console.log(`   totals: HELLO sent ${total("aodv:helloSent")}, received ${total("aodv:helloReceived")}; RERR sent ${total("aodv:rerrSent")}, received ${total("aodv:rerrReceived")}; link breaks ${breaks.length} (${falseBreaks.length} false); RREQs ${total("aodv:rreqOriginated")}`);
  if (dead) {
    const noticed = breaks.filter((b) => b.real).sort((a, b) => a.t - b.t).map((b) => `${b.by} ${b.t.toFixed(2)}`);
    console.log(`   ${dead} declared lost by: ${noticed.join(", ") || "nobody"}`);
    console.log(`   RERRs after the failure: ${rerrAfter.length}${rerrAfter.length ? ` (${rerrAfter.sort((a, b) => a.t - b.t).slice(0, 12).map((x) => `${x.n} ${x.t.toFixed(2)}`).join(", ")}${rerrAfter.length > 12 ? ", ..." : ""})` : ""}`);
  }
  if (falseBreaks.length)
    console.log(`   false link breaks: ${falseBreaks.sort((a, b) => a.t - b.t).map((b) => `${b.by} lost ${b.of} at ${b.t.toFixed(2)}`).join("; ")}`);
  for (const r of rows) if (r.has && typeof r.chain === "number" && r.chain !== SHORTEST[r.n]) notes.push(`${r.n}: ${r.chain} hops (shortest on the intact field ${SHORTEST[r.n]})`);
  for (const r of rows) if (!r.has && r.inet !== "-") notes.push(`${r.n}: INET's table still routes to the sink via ${r.inet} (stale)`);
  for (const t of notes) console.log(`   NOTE ${t}`);
  if (verdict === "RED") worst = Math.max(worst, 1);
}
process.exit(worst);

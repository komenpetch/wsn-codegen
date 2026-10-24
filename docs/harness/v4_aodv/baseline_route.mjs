// node baseline_route.mjs <run.sca>... -- the report for [Config Baseline]
// (design/V4_AODV_Plan.md, step 3): INET's own AODV on the old field. It reads
// the bl:* scalars BaselineAodv records, SensorApp's counts and the queues, and
// prints per run:
//   per sensor: the active route to the sink (next hop, hop count, the chain
//   followed through next hops, the shortest path), when it first had one, the
//   RREQs it created, the RREPs and RERRs it received;
//   totals: DATA sent and received at the sink, the sink's sequence number,
//   queue overflow.
// The baseline is reported, not gated (plan §8). NOTE lines name what departs
// from the ini's prediction.
// REFUSE (exit 2): not a Baseline run, not the old field, a radio not at
// -85dBm on its per-module line, or no bl:* scalars. Otherwise exit 0.
import fs from "fs";

const SHORTEST = { sensor1: 4, sensor2: 3, sensor3: 2, sensor4: 3, sensor5: 2, sensor6: 1, sensor7: 3, sensor8: 2 };
const NODES = ["sink", ...Object.keys(SHORTEST)];

let worst = 0;
for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, "utf8");
  const config = (/^attr configname (\S+)/m.exec(text) || [])[1];
  const run = (/^attr runnumber (\S+)/m.exec(text) || [])[1];
  const network = (/^attr network (\S+)/m.exec(text) || [])[1];
  const refuse = (why) => { console.log(`${file}: REFUSE, ${why}`); worst = Math.max(worst, 2); };
  if (config !== "Baseline") { refuse(`configname ${config}, not Baseline`); continue; }
  // The old field with every node a BaselineAodvSensorNode (derive_baseline_net.mjs).
  if (network !== "SensorScopeAodvNetwork") { refuse(`network ${network} is not the derived old field`); continue; }
  const sens = [...text.matchAll(/^par \S+\.radio\.receiver sensitivity (\S+)$/gm)].map((m) => m[1]);
  if (sens.length !== NODES.length || sens.some((s) => s !== "-85dBm")) {
    refuse(`per-module sensitivity [${sens.join(", ")}], expected -85dBm on all ${NODES.length}`); continue;
  }
  // The link rate, off every module's own par lines: the radio and SMAC must
  // carry one rate on all nine nodes (plan Q26: 250 kbps since 2026-10-19).
  const rates = [...text.matchAll(/^par \S+\.wlan\[0\]\.(?:radio\.transmitter|mac) bitrate (\S+)$/gm)].map((m) => m[1]);
  if (rates.length !== 2 * NODES.length || new Set(rates).size !== 1) {
    refuse(`radio and SMAC bitrates [${[...new Set(rates)].join(", ")}] are not one rate on all ${NODES.length} nodes`); continue;
  }
  const s = new Map();
  for (const m of text.matchAll(/^scalar SensorScopeAodvNetwork\.(\S+) (?:"([^"]+)"|(\S+)) (\S+)$/gm))
    s.set(`${m[1]} ${m[2] ?? m[3]}`, Number(m[4]));
  const bl = (n, k) => s.get(`${n}.aodv bl:${k}`);
  if (NODES.some((n) => bl(n, "myId") === undefined)) { refuse("no bl:* scalars on every node (not BaselineAodv)"); continue; }

  const byId = Object.fromEntries(NODES.map((n) => [bl(n, "myId"), n]));
  const notes = [];
  if (bl("sink", "isSink") !== 1) notes.push("the node named sink does not record isSink");
  const rows = [];
  for (const n of Object.keys(SHORTEST)) {
    const has = bl(n, "hasRoute") === 1;
    const nh = has ? byId[bl(n, "nextHop")] ?? `id${bl(n, "nextHop")}` : "-";
    // follow next hops to the sink
    let chain = "-", at = n;
    if (has) {
      const seen = new Set([n]);
      chain = 0;
      while (at !== "sink") {
        if (bl(at, "hasRoute") !== 1) { chain = `ends at ${at}`; break; }
        const next = byId[bl(at, "nextHop")];
        chain++;
        if (!next || seen.has(next)) { chain = `loop at ${next}`; break; }
        seen.add(next); at = next;
      }
    }
    rows.push({ n, has, nh, hops: has ? bl(n, "hopCount") : "-", chain, at: bl(n, "firstRouteAt"),
      rreq: bl(n, "rreqOriginated"), rrep: bl(n, "rrepReceived"), rerr: bl(n, "rerrReceived"), seq: bl(n, "destSeqNum") });
    if (!has) notes.push(`${n}: no active route to the sink at the end`);
    else if (typeof chain !== "number") notes.push(`${n}: next-hop chain ${chain}`);
    else if (chain !== SHORTEST[n]) notes.push(`${n}: ${chain} hops, shortest ${SHORTEST[n]}`);
    if (has && bl(n, "destSeqNum") !== 0) notes.push(`${n}: route destSeqNum ${bl(n, "destSeqNum")}`);
  }
  const sent = Object.keys(SHORTEST).reduce((a, n) => a + (s.get(`${n}.app[0] packets sent`) ?? 0), 0);
  const recv = s.get("sink.app[0] packets received") ?? 0;
  const rerr = NODES.reduce((a, n) => a + (bl(n, "rerrReceived") ?? 0), 0);
  const overflow = NODES.map((n) => [n, s.get(`${n}.wlan[0].queue droppedPacketsQueueOverflow:count`) ?? 0])
    .filter(([, v]) => v !== 0).map(([n, v]) => `${n}=${v}`);
  if (bl("sink", "sequenceNum") !== 0) notes.push(`the sink's sequence number is ${bl("sink", "sequenceNum")}`);
  if (rerr !== 0) notes.push(`${rerr} RERRs received`);
  if (overflow.some((o) => o.startsWith("sink="))) notes.push("queue overflow at the sink");
  if (sent > 0 && recv / sent < 0.8) notes.push(`DATA delivered ${recv} of ${sent} (${(100 * recv / sent).toFixed(1)} %), below 80 %`);

  console.log(`== Baseline #${run} (${file.split(/[\\/]/).pop()}, link ${rates[0]})`);
  console.log("   node      next hop  hops  chain shortest  route at  RREQs  RREPs rcvd  RERRs  seq");
  for (const r of rows)
    console.log(`   ${r.n.padEnd(9)} ${String(r.nh).padEnd(9)} ${String(r.hops).padStart(4)} ${String(r.chain).padStart(6)} ${String(SHORTEST[r.n]).padStart(8)} ${(r.at >= 0 ? r.at.toFixed(3) : "-").padStart(9)} ${String(r.rreq).padStart(6)} ${String(r.rrep).padStart(11)} ${String(r.rerr).padStart(6)} ${String(r.seq).padStart(4)}`);
  const total = (k) => NODES.reduce((a, n) => a + (bl(n, k) ?? 0), 0);
  console.log(`   totals: RREQs originated ${total("rreqOriginated")}, RREQs received ${total("rreqReceived")}, RREPs received ${total("rrepReceived")}, RERRs received ${rerr}; the sink's sequence number ${bl("sink", "sequenceNum")}`);
  // SensorApp counts copies: SMAC delivers a frame it receives again after a
  // lost ACK (Smac::receiveData has no duplicate test), and IPv4 forwards both.
  // Traced on #0 at 250 kbps: 295 = 276 distinct + 19 copies, 12 never arrived.
  console.log(`   DATA: sent ${sent}, received at the sink ${recv}, copies included (${sent ? (100 * recv / sent).toFixed(1) : "-"} %); queue overflow: ${overflow.length ? overflow.join(" ") : "none"}`);
  const fwdDrops = NODES.reduce((a, n) => a + (s.get(`${n}.ipv4.ip packetDropForwardingDisabled:count`) ?? 0), 0);
  if (fwdDrops) notes.push(`${fwdDrops} datagrams dropped with IP forwarding off (the node must set forwarding = true)`);
  for (const t of notes) console.log(`   NOTE ${t}`);
}
process.exit(worst);

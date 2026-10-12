// Read a LEAF-PROBE .sca and check the per-TYPE conservation laws.
//   node leaf_analyse.mjs <file.sca>
import { readFileSync } from "node:fs";

const sca = readFileSync(process.argv[2], "utf8");
const cfg = /^attr configname (\S+)/m.exec(sca)?.[1];
const rows = {}; // node -> key -> value
for (const m of sca.matchAll(/^scalar SensorScopeNetwork\.(\w+)\.generic\.np (LEAF_\S+) (\S+)$/gm)) {
  (rows[m[1]] ??= {})[m[2]] = Number(m[3]);
}
const nodes = Object.keys(rows).sort();
if (nodes.length === 0) { console.log("BROKEN: no LEAF_ scalars -- not the instrumented build"); process.exit(3); }
const types = [...new Set(nodes.flatMap((n) => Object.keys(rows[n])
  .map((k) => /_t(-?\d+)$/.exec(k)?.[1]).filter((t) => t !== undefined)))].map(Number).sort();
const g = (n, what, t) => rows[n][`LEAF_${what}_t${t}`] ?? 0;

console.log(`config=${cfg}  types seen=${types.join(",")}  (0 is DATA)`);
const cols = ["created", "start_tx_controlPkt", "send_down", "wireTx", "wireRx", "receive_controlPkt", "receive_dup_controlPkt", "fwdr_receive_pkt", "dest_recv_pkt", "reach"];
const short = ["crt", "stx", "sdn", "wTx", "wRx", "acc", "dup", "fwd", "dst", "reach"];
let red = 0;
const chk = (ok, msg) => { if (!ok) { red++; console.log("  RED  " + msg); } };

for (const t of types) {
  console.log(`\n--- type ${t} ---`);
  console.log("node     " + short.map((s) => s.padStart(6)).join(""));
  const tot = Object.fromEntries(cols.map((c) => [c, 0]));
  for (const n of nodes) {
    const v = Object.fromEntries(cols.map((c) => [c, g(n, c, t)]));
    cols.forEach((c) => (tot[c] += v[c]));
    console.log(n.padEnd(9) + cols.map((c) => String(v[c]).padStart(6)).join(""));
    const tag = `${n} t${t}`;
    chk(v.start_tx_controlPkt === v.created + v.fwdr_receive_pkt || t === 0, `${tag} P1 start_tx=${v.start_tx_controlPkt} != created+fwdr=${v.created + v.fwdr_receive_pkt}`);
    chk(v.fwdr_receive_pkt <= v.receive_controlPkt, `${tag} P2 fwdr=${v.fwdr_receive_pkt} > accept=${v.receive_controlPkt}`);
    chk(v.wireTx === v.send_down, `${tag} P3 wireTx=${v.wireTx} != send_down=${v.send_down}`);
    chk(v.receive_controlPkt + v.receive_dup_controlPkt <= v.wireRx, `${tag} P4 accept+dup=${v.receive_controlPkt + v.receive_dup_controlPkt} > wireRx=${v.wireRx}`);
    chk(v.fwdr_receive_pkt + v.dest_recv_pkt <= v.receive_controlPkt, `${tag} P5 fwdr+dest > accept`);
  }
  console.log("TOTAL    " + cols.map((c) => String(tot[c]).padStart(6)).join(""));
}
// Unknown type (-1) means a packet was gone from the store when its event fired.
for (const n of nodes) for (const k of Object.keys(rows[n])) if (k.endsWith("_t-1")) chk(false, `${n} ${k}=${rows[n][k]} (packet missing from store)`);
console.log(red === 0 ? "\nGREEN: every per-type law holds" : `\nRED: ${red} violations`);
process.exit(red === 0 ? 0 : 1);

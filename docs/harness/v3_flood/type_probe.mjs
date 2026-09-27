// Per-TYPE instrumentation of the staged structure-3 module. A probe, not a
// generator change. Backs up Pm3Wsn.cc and refuses to run over a stale backup.
//
//   node leaf_probe.mjs <harness-dir>           instrument
//   node leaf_probe.mjs <harness-dir> restore   put it back, delete the backup
//
// For every node and every packet type it counts: created, start_tx, send_down,
// wireTx (frames built by send<Type>Broadcast), wireRx (frames that reached the
// arrival), accept, dup, fwdr, dest -- and the DISTINCT originators whose packets
// of that type this node accepted (reach). The whole-network battery checks these
// laws summed over all control types; a per-type defect can hide inside a sum.
import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const CC = join(dir, "Pm3Wsn.cc");
const BAK = `${CC}.typebak`;

if (process.argv[3] === "restore") {
  if (existsSync(BAK)) { copyFileSync(BAK, CC); rmSync(BAK); }
  console.log("restored, backup removed");
  process.exit(0);
}
if (existsSync(BAK)) throw new Error("a backup already exists -- restore first");
copyFileSync(CC, BAK);

let cc = readFileSync(CC, "utf8");
const count = (s) => cc.split(s).length - 1;
function once(anchor, replacement) {
  const n = count(anchor);
  if (n !== 1) throw new Error(`anchor matched ${n} times: ${anchor}`);
  cc = cc.replace(anchor, replacement);
}
function every(anchor, replacement, expectAtLeast) {
  const n = count(anchor);
  if (n < expectAtLeast) throw new Error(`anchor matched ${n} (< ${expectAtLeast}) times: ${anchor}`);
  cc = cc.split(anchor).join(replacement);
  return n;
}

once('#include "Pm3Wsn.h"\n', [
  '#include "Pm3Wsn.h"',
  "#include <tuple>",
  "static std::map<std::tuple<int,std::string,int>, long> LEAF_cnt; // [TYPE-PROBE]",
  "static std::set<std::tuple<int,int,int>> LEAF_reach;            // [TYPE-PROBE] (node, type, originator)",
  "",
].join("\n"));

// The scheduler's success line for each event of interest: the packet is in scope as `pkt`.
const EVENTS = ["send_down", "fwdr_receive_pkt", "dest_recv_pkt", "start_tx_controlPkt",
  "receive_controlPkt", "receive_dup_controlPkt"];
for (const e of EVENTS) {
  const a = `firedCount["${e}"]++;`;
  const extra = e === "receive_controlPkt"
    ? ` if (pktOf(pkt)) LEAF_reach.insert(std::make_tuple(getId(), (int)pktOf(pkt)->getType(), (int)pktOf(pkt)->getInitialSrcAddr()));`
    : "";
  once(a, `${a} LEAF_cnt[std::make_tuple(getId(), std::string("${e}"), pktOf(pkt) ? (int)pktOf(pkt)->getType() : -1)]++;${extra} /* [TYPE-PROBE] */`);
}
// Every derived creating event, whatever the leaves are called.
const created = [...cc.matchAll(/firedCount\["(create_\w+Pkt)"\]\+\+;/g)].map((m) => m[1]);
if (created.length === 0) throw new Error("no create_<leaf>Pkt success line found");
for (const e of created) {
  const a = `firedCount["${e}"]++;`;
  once(a, `${a} LEAF_cnt[std::make_tuple(getId(), std::string("created"), pktOf(pkt) ? (int)pktOf(pkt)->getType() : -1)]++; /* [TYPE-PROBE] */`);
}

// Frames built for the air, per type actually on the chunk.
const nTx = every("    if (held == nullptr) return;\n    auto chunk = makeShared<PPkt>(*held);\n",
  "    if (held == nullptr) return;\n    LEAF_cnt[std::make_tuple(getId(), std::string(\"wireTx\"), (int)held->getType())]++; // [TYPE-PROBE]\n    auto chunk = makeShared<PPkt>(*held);\n", 2);

// Frames that reached the model's arrival, per type on the wire.
once("    PktId _pkt = localIdFor(_wire.get());\n",
  "    LEAF_cnt[std::make_tuple(getId(), std::string(\"wireRx\"), (int)_wire->getType())]++; // [TYPE-PROBE]\n    PktId _pkt = localIdFor(_wire.get());\n");

once("void Pm3Wsn::finish() {\n", [
  "void Pm3Wsn::finish() {",
  "    { for (auto& e : LEAF_cnt) if (std::get<0>(e.first) == getId()) // [TYPE-PROBE]",
  '        recordScalar(("LEAF_" + std::get<1>(e.first) + "_t" + std::to_string(std::get<2>(e.first))).c_str(), e.second);',
  "      std::map<int, long> reach; for (auto& r : LEAF_reach) if (std::get<0>(r) == getId()) reach[std::get<1>(r)]++;",
  '      for (auto& r : reach) recordScalar(("LEAF_reach_t" + std::to_string(r.first)).c_str(), r.second); }',
  "",
].join("\n"));

writeFileSync(CC, cc, "utf8");
console.log(`instrumented [TYPE-PROBE]: ${created.length} creating events (${created.join(", ")}), ${nTx} send methods`);

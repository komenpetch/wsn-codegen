// Per-TYPE instrumentation of the staged structure-4 module, and of MintRoute's
// copy of its ROUTE transmit (step 3g). A probe, not a generator change. Backs up
// EbWsn.cc and MintRoute.cc and refuses to run over a stale backup.
//
//   node type_probe.mjs <harness-dir>           instrument
//   node type_probe.mjs <harness-dir> restore   put both back, delete the backups
//
// ../v4_static's type_probe.mjs, plus MintRoute.cc: under [Config Parent] every
// ROUTE frame is built by MintRoute::sendRouteBroadcast(Node, PktId), the copy,
// not the generated one, so the copy's frames must be counted too or law P3
// (frames built = send_down, per type) would read 0 for ROUTE. The counter map is
// therefore global here (it was file-static), and MintRoute.cc names it extern.
//
// For every node and every packet type it counts: created, start_tx, send_down,
// wireTx (frames built), wireRx (frames that reached the arrival), accept, dup,
// fwdr, dest -- and the DISTINCT originators whose packets of that type this node
// accepted (reach).
import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const CC = join(dir, "EbWsn.cc");
const MR = join(dir, "MintRoute.cc");
const BAK = `${CC}.typebak`, MRBAK = `${MR}.typebak`;

if (process.argv[3] === "restore") {
  if (existsSync(BAK)) { copyFileSync(BAK, CC); rmSync(BAK); }
  if (existsSync(MRBAK)) { copyFileSync(MRBAK, MR); rmSync(MRBAK); }
  console.log("restored, backups removed");
  process.exit(0);
}
if (existsSync(BAK) || existsSync(MRBAK)) throw new Error("a backup already exists -- restore first");
copyFileSync(CC, BAK);
copyFileSync(MR, MRBAK);

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

once('#include "EbWsn.h"\n', [
  '#include "EbWsn.h"',
  "#include <tuple>",
  "std::map<std::tuple<int,std::string,int>, long> LEAF_cnt;         // [TYPE-PROBE] global: MintRoute.cc adds to it",
  "static std::set<std::tuple<int,int,int>> LEAF_reach;            // [TYPE-PROBE] (node, type, originator)",
  "",
].join("\n"));

const EVENTS = ["send_down", "fwdr_receive_pkt", "dest_recv_pkt", "start_tx_controlPkt",
  "receive_controlPkt", "receive_dup_controlPkt"];
for (const e of EVENTS) {
  const a = `firedCount["${e}"]++;`;
  const extra = e === "receive_controlPkt"
    ? ` if (pktOf(pkt)) LEAF_reach.insert(std::make_tuple(getId(), (int)pktOf(pkt)->getType(), (int)pktOf(pkt)->getInitialSrcAddr()));`
    : "";
  once(a, `${a} LEAF_cnt[std::make_tuple(getId(), std::string("${e}"), pktOf(pkt) ? (int)pktOf(pkt)->getType() : -1)]++;${extra} /* [TYPE-PROBE] */`);
}
const created = [...cc.matchAll(/firedCount\["(create_\w+Pkt)"\]\+\+;/g)].map((m) => m[1]);
if (created.length === 0) throw new Error("no create_<leaf>Pkt success line found");
for (const e of created) {
  const a = `firedCount["${e}"]++;`;
  once(a, `${a} LEAF_cnt[std::make_tuple(getId(), std::string("created"), pktOf(pkt) ? (int)pktOf(pkt)->getType() : -1)]++; /* [TYPE-PROBE] */`);
}

const nTx = every("    if (held == nullptr) return;\n    auto chunk = makeShared<PPkt>(*held);\n",
  "    if (held == nullptr) return;\n    LEAF_cnt[std::make_tuple(getId(), std::string(\"wireTx\"), (int)held->getType())]++; // [TYPE-PROBE]\n    auto chunk = makeShared<PPkt>(*held);\n", 2);

once("    PktId _pkt = localIdFor(_wire.get());\n",
  "    LEAF_cnt[std::make_tuple(getId(), std::string(\"wireRx\"), (int)_wire->getType())]++; // [TYPE-PROBE]\n    PktId _pkt = localIdFor(_wire.get());\n");

once("void EbWsn::finish() {\n", [
  "void EbWsn::finish() {",
  "    { for (auto& e : LEAF_cnt) if (std::get<0>(e.first) == getId()) // [TYPE-PROBE]",
  '        recordScalar(("LEAF_" + std::get<1>(e.first) + "_t" + std::to_string(std::get<2>(e.first))).c_str(), e.second);',
  "      std::map<int, long> reach; for (auto& r : LEAF_reach) if (std::get<0>(r) == getId()) reach[std::get<1>(r)]++;",
  '      for (auto& r : reach) recordScalar(("LEAF_reach_t" + std::to_string(r.first)).c_str(), r.second); }',
  "",
].join("\n"));
writeFileSync(CC, cc, "utf8");

// MintRoute's copy of the ROUTE transmit.
let mr = readFileSync(MR, "utf8");
const mOnce = (anchor, replacement) => {
  const n = mr.split(anchor).length - 1;
  if (n !== 1) throw new Error(`MintRoute.cc anchor matched ${n} times: ${anchor}`);
  mr = mr.replace(anchor, replacement);
};
mOnce('#include "MintRoute.h"\n', [
  '#include "MintRoute.h"',
  "#include <tuple>",
  "extern std::map<std::tuple<int,std::string,int>, long> LEAF_cnt; // [TYPE-PROBE]",
  "",
].join("\n"));
mOnce("    if (held == nullptr) return;\n    auto chunk = makeShared<MintRoutePkt>(*held);\n",
  "    if (held == nullptr) return;\n    LEAF_cnt[std::make_tuple(getId(), std::string(\"wireTx\"), (int)held->getType())]++; // [TYPE-PROBE]\n    auto chunk = makeShared<MintRoutePkt>(*held);\n");
writeFileSync(MR, mr, "utf8");

console.log(`instrumented [TYPE-PROBE]: ${created.length} creating events (${created.join(", ")}), ${nTx} generated send methods + MintRoute's copy`);

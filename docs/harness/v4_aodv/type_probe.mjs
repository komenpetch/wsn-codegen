// Per-TYPE instrumentation of the staged module (structure 4, AODV split, with
// the AODV test code pasted in). A probe, not a generator change. Backs up
// EbWsn.cc and refuses to run over a stale backup.
//
//   node type_probe.mjs <harness-dir>           instrument
//   node type_probe.mjs <harness-dir> restore   put it back, delete the backup
//
// ../v4_mintroute's type_probe.mjs without MintRoute.cc, with the RREQ transmit
// the test code edits (sendRREQ builds an AodvRreqPkt, plan §6) counted as a
// frame built, so law P3 (frames built = send_down, per type) covers it. An RREP
// is the test code's own frame (sent by sendAODVPacket, received by handleRREP
// before the model's arrival), so it is in no per-type law: only the model's
// types are (plan §8: per-type laws for RREQ only).
//
// For every node and every packet type it counts: created, start_tx, send_down,
// wireTx (frames built), wireRx (frames that reached the arrival), accept, dup,
// fwdr, dest -- and the DISTINCT originators whose packets of that type this node
// accepted (reach).
import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const CC = join(dir, "EbWsn.cc");
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
function every(anchor, replacement, expect) {
  const n = count(anchor);
  if (n !== expect) throw new Error(`anchor matched ${n} (not ${expect}) times: ${anchor}`);
  cc = cc.split(anchor).join(replacement);
  return n;
}

once('#include "EbWsn.h"\n', [
  '#include "EbWsn.h"',
  "#include <tuple>",
  "static std::map<std::tuple<int,std::string,int>, long> LEAF_cnt;  // [TYPE-PROBE]",
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

const TX = "    LEAF_cnt[std::make_tuple(getId(), std::string(\"wireTx\"), (int)held->getType())]++; // [TYPE-PROBE]\n";
const nGen = every("    if (held == nullptr) return;\n    auto chunk = makeShared<PPkt>(*held);\n",
  "    if (held == nullptr) return;\n" + TX + "    auto chunk = makeShared<PPkt>(*held);\n", 3);
once("    if (held == nullptr) return;\n    // [AODV test code] the RREQ goes out with its AODV fields.\n",
  "    if (held == nullptr) return;\n" + TX + "    // [AODV test code] the RREQ goes out with its AODV fields.\n");

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
console.log(`instrumented [TYPE-PROBE]: ${created.length} creating events (${created.join(", ")}), ${nGen} generated send methods + sendRREQ`);

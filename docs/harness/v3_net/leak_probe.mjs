// Instrument the staged module to find DELIVERIES LEFT WAITING -- the probe
// behind leak_check.sh. A PROBE, not a generator change: emitting it would move
// bytes that are held stable.
//
//   node leak_probe.mjs           instrument (backup first)
//   node leak_probe.mjs restore   put it back and delete the backup
//
// Every publication into `ctlNeighbours` (send_up is its only writer) is
// timestamped, and finish() counts the ones still unconsumed after more than
// 2 s. A legitimate delivery is consumed in the arrival that published it or on
// the next pass, so an old one is stuck. Each stuck one is classified, because
// "stuck" alone does not say which of the two known causes came back:
//
//   selfOrig   this node's OWN packet, echoed back by a neighbour. Cause 1:
//              the originator never recorded its packet as seen, or its echo
//              resolved to a fresh id (localIdFor learnt keys only from arrivals).
//   inFlood    a duplicate. With updPending, cause 2: the updateNbrs handshake
//              drained too slowly (runDeliveryEvents ran once, not to a fixpoint).
//
// Diagnosed and fixed 2026-09-27 -- see CLAUDE.md.
import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CC = join(dirname(fileURLToPath(import.meta.url)), "Pm3Wsn.cc");
const BAK = `${CC}.leakbak`;

if (process.argv[2] === "restore") {
  // ⚠ And DELETE the backup: a stale one is how an instrumented build later
  // gets mistaken for the real module.
  if (existsSync(BAK)) { copyFileSync(BAK, CC); rmSync(BAK); }
  console.log("restored, backup removed");
  process.exit(0);
}
if (existsSync(BAK)) throw new Error("a backup already exists -- run `node leak_probe.mjs restore` first");
copyFileSync(CC, BAK);

let cc = readFileSync(CC, { encoding: "utf8" });
function once(anchor, replacement) {
  const n = cc.split(anchor).length - 1;
  if (n !== 1) throw new Error(`anchor matched ${n} times: ${anchor}`);
  cc = cc.replace(anchor, replacement);
}
const L = (...lines) => lines.map((l) => l + "\n").join("");

once('#include "Pm3Wsn.h"\n', L(
  '#include "Pm3Wsn.h"',
  "#include <tuple>",
  "static std::map<std::tuple<int,int,int>, double> LEAK_pub; // [LEAK-PROBE]"));

once("    for (auto _v : nbrs) ctlNeighbours[pkt].insert(_v);\n", L(
  "    for (auto _v : nbrs) ctlNeighbours[pkt].insert(_v);",
  "    for (auto _v : nbrs) LEAK_pub[std::make_tuple(getId(), (int)pkt, (int)_v)] = omnetpp::simTime().dbl(); // [LEAK-PROBE]"));

once("void Pm3Wsn::finish() {\n", L(
  "void Pm3Wsn::finish() {",
  "    { long stuck = 0, young = 0, selfOrig = 0, inFlood = 0, updPending = 0; // [LEAK-PROBE]",
  "      double now = omnetpp::simTime().dbl();",
  "      for (auto& e : ctlNeighbours) for (Node nb : e.second) {",
  "        auto it = LEAK_pub.find(std::make_tuple(getId(), (int)e.first, (int)nb));",
  "        double age = it == LEAK_pub.end() ? -1 : now - it->second;",
  "        if (age <= 2.0) { young++; continue; }",
  "        stuck++;",
  "        PktId p = e.first; PPkt *c = pktOf(p);",
  "        Node f = deliveredBy.count(p) > 0 ? deliveredBy.at(p) : (c ? c->getFwdrAddr() : -99);",
  "        if (c && c->getInitialSrcAddr() == nb) selfOrig++;",
  "        if (floodTbl.count(nb) > 0 && floodTbl.at(nb).count(p) > 0) inFlood++;",
  "        if (updateNbrs.count({f, nb}) > 0) updPending++;",
  "      }",
  '      recordScalar("LEAK_stuck", stuck); recordScalar("LEAK_young", young);',
  '      recordScalar("LEAK_selfOrig", selfOrig); recordScalar("LEAK_inFlood", inFlood);',
  '      recordScalar("LEAK_updPending", updPending); }'));

writeFileSync(CC, cc, { encoding: "utf8" });
console.log("instrumented [LEAK-PROBE] (backup at Pm3Wsn.cc.leakbak)");

// R6: the invariant battery reads only what the module already records, so
// internal state -- residues and unbounded growth -- is invisible to it.
//
// This instruments finish() with one recordScalar per container, so a run
// reports what it left behind. It is a PROBE, not a generator change: emitting
// these permanently would move the bytes of outputs that are held byte-stable.
//
// Backup first, restore always. A crash that leaves the module instrumented is
// how a "measured" number turns out to have come from a debug build.
import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";

const D = "C:/Users/Komen/Desktop/Proj/Simulation/v3_net";
const CC = `${D}/Pm3Wsn.cc`, H = `${D}/Pm3Wsn.h`;

// Containers worth watching, and what each one means when it is non-zero.
//
//   sentDown/sentUp  the CommPattern pair's medium records. Both are drained by
//                    the model plus the sender-side drain, so a residue is the
//                    transmission-cleanup leak returning.
//   ndBuff           packets queued to transmit and never transmitted -- this is
//                    exactly the per-pass backlog, so --drain should empty it.
//   pktStore         every packet this node ever minted or deserialised. Grows
//                    by construction; the question is whether it grows FASTER
//                    than traffic, which a backlog makes it do.
//   floodTbl         the duplicate-suppression set. Unbounded by design.
const WATCH = [
  "sentDown", "sentUp", "ndBuff", "recvBuff", "destBuff",
  "createdPkts", "ctlNeighbours", "updateNbrs", "neighbourTbl",
  "floodTbl", "pktStore", "deliveredBy",
];

const mode = process.argv[2];
if (mode === "restore") {
  // ⚠ And DELETE the backups. Leaving them behind is how a stale .probebak
  // later gets mistaken for source, or gets staged into the harness.
  for (const f of [CC, H])
    if (existsSync(`${f}.probebak`)) {
      copyFileSync(`${f}.probebak`, f);
      rmSync(`${f}.probebak`);
    }
  console.log("restored, backups removed");
  process.exit(0);
}

copyFileSync(CC, `${CC}.probebak`);
copyFileSync(H, `${H}.probebak`);

let cc = readFileSync(CC, { encoding: "utf8" });
const FIN = "void Pm3Wsn::finish() {";
if (cc.split(FIN).length - 1 !== 1) throw new Error("finish anchor not unique");
cc = cc.replace(FIN, FIN + "\n"
  + WATCH.map((v) => `    recordScalar("SZ_${v}", (long)${v}.size());`).join("\n"));
writeFileSync(CC, cc, { encoding: "utf8" });
console.log(`instrumented ${WATCH.length} containers (backups at *.probebak)`);

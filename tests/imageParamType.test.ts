import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../src/engine/pipeline";

// The scheduler binds a relational image. It used to always bind it as
// `std::set<Node>`, which is right for a parameter the model types as a set
// (MintRoute's `nbs`, declared `const std::set<Node>&`) and wrong for one it
// does not: the CommPattern's `des` has no typing guard of its own, only the
// defining `des = ran({pkt} ◁ finalDestAddr)`, so it is declared `int` and a
// set does not go into it.
//
// ⚠ That was invisible while `des` could never be bound — the creating events
// were stopped first by `sno`, and before that by a reachability bug. It would
// have surfaced as a compile error the moment either was answered, which is
// exactly the "compiles today, breaks tomorrow" shape this project has paid
// for before. So the scenario is CONSTRUCTED here rather than waited for:
// `sno` is stripped in memory, leaving `des` as the binding that matters.
const load = (d: string) =>
  readdirSync(d).filter((f) => /\.(bum|buc)$/.test(f))
    .map((f) => ({ name: f, xml: readFileSync(join(d, f), "utf8") }));

const withoutSno = () => {
  const base = load("../Update_wsn/C0_project");
  const ext = load("src/assets/pattern-extension").map((f) =>
    f.name !== "uM4.bum" ? f : {
      ...f,
      xml: f.xml.split("\n")
        .filter((l) => !/identifier="sno"|MPacket_pktSeqNo_g1|MPacket_pktSeqNo_a1/.test(l))
        .join("\n"),
    });
  return generate(base, "pM3", "Pm3Wsn", 3, { files: [...base, ...ext], machine: "pM5" });
};

describe("a relational-image parameter is bound at its DECLARED type", () => {
  const tree = withoutSno();
  const h = tree.find((f) => f.path.endsWith(".h"))!.content;
  const cc = tree.find((f) => f.path.endsWith(".cc"))!.content;

  it("reaches the binding at all — otherwise this suite proves nothing", () => {
    // If the creating events are excluded again for some other reason, the
    // assertions below would pass vacuously. Fail loudly instead.
    expect(h).not.toMatch(/not schedulable: create_routePkt/);
    expect(cc).toContain("try_create_routePkt");
  });

  it("binds a scalar-declared parameter as a scalar, not as a set", () => {
    expect(h).toContain("bool create_routePkt(Node x, int des, PktId pkt, Data data);");
    expect(cc).toContain("int des = finalDestAddr.at(pkt);");
    expect(cc).not.toContain("std::set<Node> des = relImage(finalDestAddr, pkt);");
  });

  it("checks the domain before .at, since a guard is an unordered conjunction", () => {
    expect(cc).toMatch(/if \(finalDestAddr\.count\(pkt\) == 0\)[\s\S]{0,80}int des = finalDestAddr\.at\(pkt\);/);
  });

  it("still binds a set-declared parameter as a set", () => {
    // MintRoute's `nbs` is typed a set by its own model, and must not change.
    const m4 = generate(load("../EventB_model/WSN_MintRoute_3_2_5_9/MintRoute_3_2_5_9_complete_amiCheck"),
      "M4", "M4Wsn", 2);
    const m4h = m4.find((f) => f.path.endsWith(".h"))!.content;
    expect(m4h).toContain("const std::set<Node>& nbs");
  });
});

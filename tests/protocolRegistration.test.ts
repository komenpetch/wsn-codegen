import { describe, it, expect } from "vitest";
import { generate, generateMerged, MODULE_NAME } from "../src/engine/pipeline";
import { loadProject } from "../scripts/projects";
import type { GeneratedTree } from "../src/engine/types";

// The network shell registers the module's own protocol, `eventb`, in INET's
// ethertype ProtocolGroup. That group is a per-NETWORK shared variable: INET's
// SharedDataManager destroys it when the network is deleted, and ~ProtocolGroup
// deletes every protocol added to it. So the protocol must be looked up in the
// current group on every call and never kept across networks. Kept in a static
// (as until 2026-10-14), it dangled after the first network: a second run in one
// process (Qtenv's run again, or `--repeat=2` in Cmdenv) used a freed protocol,
// "Unknown protocol: id = 0" from Smac or a segfault at event #0. Reproduced and
// the fix measured on structure 4 (both runs then identical to a single run).
const cc = (tree: GeneratedTree) => tree.find((f) => f.path.endsWith(".cc"))!.content;
const body = (code: string): string => {
  const at = code.indexOf("::ebProtocol() {");
  expect(at, "ebProtocol() is emitted").toBeGreaterThan(-1);
  return code.slice(at, code.indexOf("\n}\n", at));
};

const outputs: [string, () => GeneratedTree][] = [
  ["MintRoute M4 (network branch)", () => generate(loadProject("MintRoute"), "M4", MODULE_NAME, 2)],
  ["RTMCS M6 (network branch)", () => generate(loadProject("RTMCS"), "M6", MODULE_NAME, 2)],
  ["structure 3", () => generateMerged(loadProject("AppLayer"), undefined, 3)],
  ["structure 4", () => generateMerged(loadProject("AppLayer"), undefined, 4)],
];

describe("the module's own protocol is registered per network", () => {
  for (const [name, make] of outputs) {
    it(`${name}: looks it up in the current ethertype group, keeps no static`, () => {
      const fn = body(cc(make()));
      expect(fn).toContain("ProtocolGroup *group = ProtocolGroup::getEthertypeProtocolGroup();");
      expect(fn).toContain("const Protocol *p = group->findProtocol(EB_ETHERTYPE);");
      // Created and handed to the group only when this network's group lacks it.
      expect(fn).toMatch(/if \(p == nullptr\) \{\n\s+p = new Protocol\("eventb", [^\n]*\n\s+group->addProtocol\(EB_ETHERTYPE, p\);\n\s+\}/);
      expect(fn).not.toMatch(/\bstatic\b/);
    });
  }
});

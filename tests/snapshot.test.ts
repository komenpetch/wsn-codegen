import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { generate } from "../src/engine/pipeline";

const load = (n: string) =>
  ({ name: `${n}.bum`, xml: readFileSync(`tests/fixtures/shdecom/${n}.bum`, "utf8") });

// ⚠ The structure is passed EXPLICITLY, not left to the default.
//
// These snapshots used to ride on `generate`'s default, and when the
// 2026-09-13 renumber moved that default from the pre-parity shell to the
// parity structure, all three snapshots changed at once -- which is exactly how
// a silent regression would look. Pinning the number means a future default
// change cannot rewrite this evidence without someone editing this line.
//
// 2 is the structure the CLI and the deployed web app both emit, i.e. the one
// people actually get.
const STRUCTURE = 2;

describe("snapshot: shDecom6_2 → INET C++", () => {
  it("pM1", () => {
    expect(generate([load("pM1")], "pM1", "Pm1App", STRUCTURE)).toMatchSnapshot();
  });
  it("uM2", () => {
    expect(generate([load("pM1"), load("uM2")], "uM2", "Um2App", STRUCTURE)).toMatchSnapshot();
  });
  it("pM3", () => {
    expect(generate([load("pM1"), load("uM2"), load("pM3")], "pM3", "Pm3App", STRUCTURE)).toMatchSnapshot();
  });
});

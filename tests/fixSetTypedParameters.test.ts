import { describe, it, expect } from "vitest";
import { fixSetTypedParameters } from "../src/engine/postEmit";
import type { GeneratedTree } from "../src/engine/types";

// fixSetTypedParameters retypes an event parameter the emitter declared `int`
// when the method body actually uses it as a container. It has to find each
// method's body to decide, and the body boundaries are byte offsets into the
// .cc.
//
// The bug this pins: those offsets were captured once, up front, and the .cc
// was then rewritten INSIDE the same loop. Each applied fix grows the text by
// 18 characters (`int ` -> `const std::set<Node>& `), so from the second fix
// onward every later method's window slid 18n characters early -- straddling
// the previous method's tail and truncating its own.
//
// The real corpora do not expose it: RTMCS M6 applies five fixes and still
// compiles, because its bodies are long relative to the drift. That is luck,
// not correctness, so the case is constructed here instead. `m2`'s container
// use sits in the last few characters of its body, exactly where an 18-character
// truncation removes it, and `m3` exists only so that `m2`'s window is bounded
// by a stale offset rather than by end-of-string.
const cc = (): string =>
  [
    `bool App::m1(int a, int nbs1) {`,
    `    if (nbs1.count(a) == 0)`,
    `        return false;`,
    `    return true;`,
    `}`,
    ``,
    `bool App::m2(int b, int nbs2) {`,
    `    doSomething(b);`,
    `    return nbs2.empty();`,   // within 18 chars of this body's end
    `}`,
    ``,
    `bool App::m3(int c) {`,
    `    return c > 0;`,
    `}`,
    ``,
  ].join("\n");

const h = (): string =>
  [
    `class App {`,
    `    bool m1(int a, int nbs1);`,
    `    bool m2(int b, int nbs2);`,
    `    bool m3(int c);`,
    `};`,
    ``,
  ].join("\n");

const tree = (): GeneratedTree => [
  { path: "App.h", content: h() },
  { path: "App.cc", content: cc() },
];

describe("fixSetTypedParameters", () => {
  const out = fixSetTypedParameters(tree(), "App");
  const outCc = out.find((f) => f.path.endsWith(".cc"))!.content;
  const outH = out.find((f) => f.path.endsWith(".h"))!.content;

  it("retypes the first set-typed parameter", () => {
    expect(outCc).toContain("bool App::m1(int a, const std::set<Node>& nbs1) {");
  });

  it("retypes a later parameter whose only container use is at the end of its body", () => {
    // This is the assertion that fails when body windows are sliced from the
    // text being mutated: m2's `nbs2.empty()` falls outside the shifted window,
    // so nbs2 stays `int` and the emitted code does not compile.
    expect(outCc).toContain("bool App::m2(int b, const std::set<Node>& nbs2) {");
  });

  it("keeps the header declarations in step with the definitions", () => {
    expect(outH).toContain("bool m1(int a, const std::set<Node>& nbs1);");
    expect(outH).toContain("bool m2(int b, const std::set<Node>& nbs2);");
  });

  it("leaves a parameter that is never used as a container alone", () => {
    expect(outCc).toContain("bool App::m3(int c) {");
    expect(outH).toContain("bool m3(int c);");
  });

  it("throws when the class name matches no definition, rather than silently doing nothing", () => {
    expect(() => fixSetTypedParameters(tree(), "WrongName")).toThrow(/no "bool WrongName::/);
  });
});

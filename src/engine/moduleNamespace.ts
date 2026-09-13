// Put each generated module in a C++ namespace of its own.
//
// Why this exists
// ---------------
// A generated module inlines its Event-B context -- `DATA`, `CONTROL`, `FALSE`,
// `ND`, the element aliases, the pair-set helpers -- at NAMESPACE SCOPE, which
// is what makes the output self-contained and the three-file contract real. The
// cost was stated in the emitted header itself: "Two generated modules with
// DIFFERENT contexts must not be linked into one executable -- these are inline
// definitions at namespace scope and would collide."
//
// They do collide, immediately:
//
//     ./M4Wsn.h:41:18: error: redefinition of 'DATA'
//     ./Pm3Wsn.h:29:18: note: previous definition is here
//
// That blocked the thing the generator is for: a node running the generated
// SENSOR APPLICATION on top of the generated NETWORK PROTOCOL, both from Event-B,
// in one simulation. Each module in its own namespace removes the collision
// without giving up the self-contained header, and it is what INET does with its
// own `namespace inet`.
//
// Verified end to end before being implemented: the module was namespaced by
// hand in the harness, rebuilt, and run -- OMNeT++ resolves a namespace-qualified
// `@class(eb_m4wsn::M4Wsn)` against `Define_Module` inside the namespace, and the
// three-hop flood came out unchanged. The NED TYPE name stays unqualified; only
// the C++ class it binds to is qualified.
//
// Applied LAST, after every network-layer pass, because those passes add
// `#include` lines of their own (the packet classes need FieldsChunk.h) and an
// #include inside a namespace would namespace-ify that header's contents. Any
// include this finds inside the region is hoisted above it rather than being
// left to break in a way that is hard to read back to its cause.

import type { GeneratedTree } from "./types";
import { esc } from "./text";

// One namespace per module, derived from the module's own name, so two modules
// generated from different projects cannot collide however similar their
// contexts are.
const namespaceOf = (name: string): string => `eb_${name.toLowerCase()}`;

// In the header the context block sits between `using namespace inet;` and the
// end of the file; in the .cc everything after the includes is definitions.
const H_ANCHOR = "using namespace inet;";

function wrapHeader(text: string, ns: string): string {
  const at = text.indexOf(H_ANCHOR);
  if (at < 0) throw new Error(`moduleNamespace: no "${H_ANCHOR}" in the generated header.`);
  const cut = at + H_ANCHOR.length;
  return hoistIncludes(text.slice(0, cut), text.slice(cut), ns);
}

function wrapImpl(text: string, ns: string): string {
  const lines = text.split("\n");
  let last = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith("#include")) last = i;
  if (last < 0) throw new Error("moduleNamespace: no #include in the generated .cc.");
  const cut = lines.slice(0, last + 1).join("\n").length;
  return hoistIncludes(text.slice(0, cut), text.slice(cut), ns);
}

// `before` stays outside the namespace, `body` goes inside -- except for any
// #include in `body`, which is lifted out first. An #include inside a namespace
// compiles, and then every declaration in the included header silently belongs
// to this module's namespace; the error surfaces far from its cause.
function hoistIncludes(before: string, body: string, ns: string): string {
  const kept: string[] = [];
  const hoisted: string[] = [];
  for (const line of body.split("\n")) (line.startsWith("#include") ? hoisted : kept).push(line);
  const head = before + (hoisted.length ? "\n" + hoisted.join("\n") : "");
  return `${head}\n\nnamespace ${ns} {\n${kept.join("\n").replace(/^\n+/, "")}\n}  // namespace ${ns}\n`;
}

export function wrapInNamespace(tree: GeneratedTree, name: string): GeneratedTree {
  const ns = namespaceOf(name);
  return tree.map((f) => {
    if (f.path.endsWith(".h")) return { ...f, content: wrapHeader(f.content, ns) };
    if (f.path.endsWith(".cc")) return { ...f, content: wrapImpl(f.content, ns) };
    if (f.path.endsWith(".ned")) {
      // The NED type keeps its plain name; only the C++ class it binds to moves.
      const qualified = f.content.replace(
        new RegExp(`@class\\(${esc(name)}\\);`, "g"), `@class(${ns}::${name});`);
      if (qualified === f.content)
        throw new Error(`moduleNamespace: no @class(${name}); found in the generated .ned.`);
      return { ...f, content: qualified };
    }
    return f;
  });
}

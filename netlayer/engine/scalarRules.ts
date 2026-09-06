import type { RuleMatch } from "../../src/engine/rules";
import type { NetRule } from "./packetRules";

// Scalar rules the flood path needs: arithmetic over a function application,
// and disequality.
//
// Both were named in the 2026-09-06 gap baseline (groups G10 and G11) and left
// unimplemented -- G11 because the app-layer catalog has `a = b` (EQ) and
// `S ≠ ∅` (SET4) but never grew the `a ≠ b` dual, G10 because no interface
// machine in the induction corpus computes anything, so no arithmetic shape was
// ever there to induce from.
//
// They are added here because MintRoute's flooding events cannot fire without
// them: every packet-creating and packet-transmitting event binds a sequence
// number with `sno = floodSeqNo(s) + 1` and a hop count with `nbh = −1`, and
// every control-packet event discriminates with `type(pkt) ≠ DATA`.
//
// Note Rodin writes minus as U+2212 (−), not ASCII hyphen.

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const re = (p: RegExp) => (expr: string): RuleMatch | null => {
  const g = p.exec(expr.trim());
  return g ? { captures: g.groups ?? {} } : null;
};
// A signed integer literal, Rodin-spelled. Returned in C++ form.
const NUM = "(?:−|-)?\\d+";
const num = (s: string) => s.replace(/−/g, "-");

export function scalarRules(): NetRule[] {
  return [
    // `y = f(x) + n` -- an event parameter BOUND to a computed value. In
    // Event-B this constrains the parameter; in C++ the parameter arrives from
    // the caller, so the faithful emission is the check that it holds.
    {
      id: "ARITH-FN-PLUS", tier: 1,
      evidence: ["MintRoute.create_bconPkt", "MintRoute.start_tx_bconPkt"],
      match: re(new RegExp(
        `^(?<y>\\w+)\\s*=\\s*(?<f>\\w+)\\(\\s*(?<x>\\w+)\\s*\\)\\s*(?<op>\\+|−|-)\\s*(?<n>\\d+)$`)),
      emit: (m) => {
        const { y, f, x, op, n } = m.captures;
        return `${y} == ${f}.at(${x}) ${op === "+" ? "+" : "-"} ${n}`;
      },
    },
    // `y = <literal>` -- e.g. `nbh = −1`, the "no hop count yet" sentinel every
    // creating event binds. The app-layer EQ rule cannot match it: its right
    // side is `\w+`, and a signed literal is not.
    {
      id: "ARITH-LIT", tier: 1,
      evidence: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
      match: re(new RegExp(`^(?<y>\\w+)\\s*=\\s*(?<n>${NUM})$`)),
      emit: (m) => `${m.captures.y} == ${num(m.captures.n)}`,
    },
    // `f(x) <cmp> n`
    {
      id: "ARITH-FN-CMP", tier: 1,
      evidence: ["MintRoute.start_tx_bconPkt"],
      match: re(new RegExp(
        `^(?<f>\\w+)\\(\\s*(?<x>\\w+)\\s*\\)\\s*(?<op>≥|≤|>|<)\\s*(?<n>${NUM})$`)),
      emit: (m) => {
        const { f, x, op, n } = m.captures;
        const cpp = op === "≥" ? ">=" : op === "≤" ? "<=" : op;
        return `${f}.at(${x}) ${cpp} ${num(n)}`;
      },
    },
    // `f(x) ≔ f(x) + n` -- increment in place.
    {
      id: "ARITH-FN-INC", tier: 1,
      evidence: ["MintRoute.start_tx_bconPkt"],
      match: re(new RegExp(
        `^(?<f>\\w+)\\(\\s*(?<x>\\w+)\\s*\\)\\s*≔\\s*\\k<f>\\(\\s*\\k<x>\\s*\\)\\s*(?<op>\\+|−|-)\\s*(?<n>\\d+)$`)),
      emit: (m) => {
        const { f, x, op, n } = m.captures;
        return `${f}[${x}] ${op === "+" ? "+=" : "-="} ${n};`;
      },
    },
    // `f(x) ≠ v` -- the control-packet discriminator. FN1-cmp in the app-layer
    // catalog covers only `=`; this is its missing dual.
    {
      id: "NEQ-FN", tier: 3,
      evidence: ["MintRoute.create_dataPkt", "MintRoute.start_tx_dataPkt"],
      match: re(new RegExp(`^(?<f>\\w+)\\(\\s*(?<x>\\w+)\\s*\\)\\s*≠\\s*(?<v>\\w+)$`)),
      emit: (m) => `${m.captures.f}.at(${m.captures.x}) != ${m.captures.v}`,
    },
    // `a ≠ b` -- EQ's missing dual. Deliberately last of the scalar rules and
    // narrowly anchored, so it cannot swallow `S ≠ ∅` (the app-layer SET4
    // rule's shape) -- ∅ is not \w.
    {
      id: "NEQ", tier: 3,
      evidence: ["MintRoute.find_neighbours", "MintRoute.create_dataPkt"],
      match: re(new RegExp(`^(?<a>\\w+)\\s*≠\\s*(?<b>\\w+)$`)),
      emit: (m) => `${m.captures.a} != ${m.captures.b}`,
    },
  ];
}

import type { RuleMatch } from "./rules";
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

const re = (p: RegExp) => (expr: string): RuleMatch | null => {
  const g = p.exec(expr.trim());
  return g ? { captures: g.groups ?? {} } : null;
};
// A signed integer literal, Rodin-spelled. Returned in C++ form.
const NUM = "(?:−|-)?\\d+";
const num = (s: string) => s.replace(/−/g, "-");

export function scalarRules(): NetRule[] {
  return [
    // ── Domain-checked function application ──────────────────────────────
    //
    // In Event-B a guard is an unordered CONJUNCTION, so `f(k) = v` sits
    // happily beside `k ∈ dom(f)` in either order. The emitter turns guards
    // into a SEQUENCE of early returns, and `std::map::at` on an absent key
    // throws -- so whenever the domain check is written second, the emitted
    // code throws std::out_of_range before ever reaching it.
    //
    // This is not hypothetical: it is what stopped the first flood run, at
    // sensor3, event #9. It is also the hazard this project's notes have
    // carried since the app layer without a reproduction.
    //
    // These supersede the app-layer catalog's FN1 / FN1-cmp / FN1-SET1 in
    // place, adding the domain test the Event-B well-definedness proof
    // obligation already guarantees. For a partial function an application
    // outside the domain has no value, so a guard mentioning it cannot hold --
    // `false` is the faithful answer, and it is what `count(k) > 0 && …` gives.
    {
      id: "FN1-SET1-SAFE", tier: 1, supersedes: "FN1-SET1",
      evidence: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt"],
      match: re(new RegExp(`^(?<f>\\w+)\\(\\s*(?<k>\\w+)\\s*\\)\\s*(?<op>∈|∉)\\s*(?<S>\\w+)$`)),
      emit: (m) => {
        const { f, k, op, S } = m.captures;
        return op === "∈"
          ? `(${f}.count(${k}) > 0 && ${S}.count(${f}.at(${k})) > 0)`
          : `(${f}.count(${k}) == 0 || ${S}.count(${f}.at(${k})) == 0)`;
      },
    },
    {
      id: "FN1-CMP-SAFE", tier: 1, supersedes: "FN1-cmp",
      evidence: ["MintRoute.create_bconPkt", "MintRoute.start_flooding"],
      match: re(new RegExp(`^(?<f>\\w+)\\(\\s*(?<k>\\w+)\\s*\\)\\s*=\\s*(?<v>\\w+)$`)),
      emit: (m) => {
        const { f, k, v } = m.captures;
        return `(${f}.count(${k}) > 0 && ${f}.at(${k}) == ${v})`;
      },
    },
    {
      id: "FN1-SAFE", tier: 1, supersedes: "FN1",
      evidence: ["MintRoute.send_down", "MintRoute.create_bconPkt"],
      match: re(new RegExp(`^(?<y>\\w+)\\s*=\\s*(?<f>\\w+)\\(\\s*(?<x>\\w+)\\s*\\)$`)),
      emit: (m) => {
        const { y, f, x } = m.captures;
        return `(${f}.count(${x}) > 0 && ${y} == ${f}.at(${x}))`;
      },
    },
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
        return `(${f}.count(${x}) > 0 && ${y} == ${f}.at(${x}) ${op === "+" ? "+" : "-"} ${n})`;
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
    // `p <cmp> n` -- a bare scalar against a literal. The catalog had `=`
    // (ARITH-LIT) and the function-application form (ARITH-FN-CMP) but not the
    // plainest shape of all, because no clause had needed it.
    //
    // ⚠ How it was found is the point. `update_nbr`'s `delta ≥ 0` -- MintRoute's
    // whole freshness test, and INET MintRoute's `if (sDelta >= 0)` -- was the
    // LAST untranslated clause in the event, so the event refused to fire. And
    // the refusal path is a bare `return false;` with no guard attached, so
    // guard-by-guard instrumentation printed nothing at all: the event was
    // called 231 times and reported neither a failing guard nor a firing.
    // An untranslated clause is louder in the source than in a run.
    {
      id: "ARITH-CMP-LIT", tier: 1,
      evidence: ["MintRoute.update_nbr", "MintRoute.update_est"],
      match: re(new RegExp(`^(?<y>\\w+)\\s*(?<op>≥|≤|>|<)\\s*(?<n>${NUM})$`)),
      emit: (m) => {
        const { y, op, n } = m.captures;
        return `${y} ${op === "≥" ? ">=" : op === "≤" ? "<=" : op} ${num(n)}`;
      },
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
        return `(${f}.count(${x}) > 0 && ${f}.at(${x}) ${cpp} ${num(n)})`;
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
      emit: (m) => `(${m.captures.f}.count(${m.captures.x}) > 0 && ${m.captures.f}.at(${m.captures.x}) != ${m.captures.v})`,
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

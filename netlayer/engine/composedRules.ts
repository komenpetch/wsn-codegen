import type { RuleMatch } from "../../src/engine/rules";
import type { NetRule } from "./packetRules";
import { parseSetExpr, memberTest } from "./setExpr";
import type { SetExpr, Carriers } from "./setExpr";

// Membership rules whose right-hand side is a full set EXPRESSION rather than a
// bare identifier -- the composition the flat catalog could not do (gap-baseline
// group G6, 34 distinct clauses across the two corpora, four of them in every
// MintRoute packet-creating event).
//
// These are deliberately generic: they parse the right-hand side and push the
// membership test down to the leaves (see setExpr.ts). They match ONLY when the
// right-hand side is genuinely compound -- a bare identifier is left to the
// app-layer catalog's own SET1/PS1 rules, so nothing existing is shadowed.
//
// `memberTest` returns null whenever the element shape and the container
// disagree, or when an algebraic step would not be sound (ran/dom over ∖ or ∩).
// Returning "" then makes the engine treat the clause as untranslated, which is
// the honest outcome: a visibly missing guard beats a guard that compiles and
// means something else.

const re = (p: RegExp) => (expr: string): RuleMatch | null => {
  const g = p.exec(expr.trim());
  return g ? { captures: g.groups ?? {} } : null;
};

// "compound" = contains a set operator or a ran/dom application. A bare name is
// not ours.
const isCompound = (rhs: string) =>
  /[∪∩∖]/.test(rhs) || /\b(ran|dom)\s*\(/.test(rhs);

export function composedRules(carriers: Carriers = new Set()): NetRule[] {
  return [
    // `x ∈ <set expression>` / `x ∉ <set expression>`
    {
      id: "SETEXPR-MEM", tier: 1,
      evidence: ["MintRoute.create_bconPkt", "MintRoute.create_routePkt", "RTMCS.create_dataPkt"],
      match: (expr: string) => {
        const m = /^(?<x>\w+)\s*(?<op>∈|∉)\s*(?<rhs>.+)$/.exec(expr.trim());
        return m && isCompound(m.groups!.rhs) ? { captures: m.groups! } : null;
      },
      emit: (m, enc) => {
        const { x, op, rhs } = m.captures;
        const e = parseSetExpr(rhs);
        if (!e) return "";
        const test = memberTest({ kind: "scalar", x }, e, enc, carriers);
        if (test === null) return "";
        return op === "∈" ? test : `!(${test})`;
      },
    },
    // `a ↦ b ∈ <set expression>` -- pair membership in a compound set, e.g.
    // MintRoute's `nb ↦ pkt ∉ (sentUp ∪ sentDown)`.
    {
      id: "SETEXPR-PAIR-MEM", tier: 1,
      evidence: ["MintRoute.find_neighbours"],
      match: (expr: string) => {
        const m = /^(?<a>\w+)\s*↦\s*(?<b>\w+)\s*(?<op>∈|∉)\s*(?<rhs>.+)$/.exec(expr.trim());
        return m && isCompound(m.groups!.rhs) ? { captures: m.groups! } : null;
      },
      emit: (m, enc) => {
        const { a, b, op, rhs } = m.captures;
        const e = parseSetExpr(rhs);
        if (!e) return "";
        const test = memberTest({ kind: "pair", a, b }, e, enc, carriers);
        if (test === null) return "";
        return op === "∈" ? test : `!(${test})`;
      },
    },
    // `<set expression> = ∅` / `≠ ∅` -- emptiness of a compound set. Only the
    // union case is expressible without materialising: A ∪ B is empty exactly
    // when both are.
    {
      id: "SETEXPR-EMPTY", tier: 1,
      evidence: ["MintRoute.create_dataPkt", "RTMCS.create_dataPkt"],
      match: re(/^(?<rhs>\(?[^=≠]*[∪][^=≠]*\)?)\s*(?<op>=|≠)\s*∅$/),
      emit: (m) => {
        const { rhs, op } = m.captures;
        const e = parseSetExpr(rhs);
        if (!e || e.k !== "op" || e.op !== "∪") return "";
        const names: string[] = [];
        const walk = (n: SetExpr): boolean => {
          if (n.k === "id") { names.push(n.name); return true; }
          if (n.k === "op" && n.op === "∪") return walk(n.l) && walk(n.r);
          return false;   // only a union of plain names is expressible this way
        };
        if (!walk(e)) return "";
        const allEmpty = names.map((n) => `${n}.empty()`).join(" && ");
        return op === "=" ? `(${allEmpty})` : `!(${allEmpty})`;
      },
    },
  ];
}

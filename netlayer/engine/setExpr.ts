import type { EncodingForm } from "../../src/engine/types";

// A recursive translator for SET-VALUED expressions, and membership in them.
//
// The gap baseline's group G6: the app-layer catalog matches whole clauses with
// flat regexes, so an operator whose operand is itself an expression has no
// rule. `pkt ∉ ran(ndBuff ∪ WiMedium)` is the canonical case -- and MintRoute's
// packet-creating events guard on four of them, which is why they cannot fire.
//
// The approach is NOT to build the intermediate set and test it. Membership
// distributes over the set operators, so a boolean can be pushed all the way
// down to the leaves:
//
//     x ∈ A ∪ B   ≡   x ∈ A  ||  x ∈ B
//     x ∈ A ∩ B   ≡   x ∈ A  &&  x ∈ B
//     x ∈ A ∖ B   ≡   x ∈ A  && !(x ∈ B)
//
// That yields short-circuiting C++ over the containers the model already has,
// with no allocation and no temporary.
//
// ONE ALGEBRAIC TRAP, and it is the reason this file is careful rather than
// clever: `ran` and `dom` distribute over ∪ but NOT over ∖ or ∩.
//     ran(A ∪ B) = ran(A) ∪ ran(B)          -- true
//     ran(A ∖ B) ≠ ran(A) ∖ ran(B)          -- FALSE: a value reachable by a
//                                              pair kept in A ∖ B may also be
//                                              reachable by a pair only in B
//     ran(A ∩ B) ⊆ ran(A) ∩ ran(B)          -- inclusion only, not equality
// Emitting the distributed form for those would compile and be wrong, which is
// the failure mode this project exists to prevent. So they are refused, and the
// clause stays visibly untranslated.

export type SetExpr =
  | { k: "id"; name: string }
  | { k: "apply"; f: string; arg: string }          // f(k) -- a map-of-sets member
  | { k: "op"; op: "∪" | "∩" | "∖"; l: SetExpr; r: SetExpr }
  | { k: "fn"; fn: "ran" | "dom"; e: SetExpr };

export type Elem =
  | { kind: "scalar"; x: string }
  | { kind: "pair"; a: string; b: string };

// ── Parser ───────────────────────────────────────────────────────────────
// Recursive descent over a tiny grammar. The set operators are left
// associative and share one precedence level, as in Event-B; the models
// parenthesise wherever it matters.
function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /\s*(ran|dom|[A-Za-z_]\w*|[()∪∩∖])/gy;
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) return [];                       // unrecognised character: give up
    out.push(m[1]);
    i = re.lastIndex;
  }
  return out;
}

export function parseSetExpr(src: string): SetExpr | null {
  const t = tokenize(src.trim());
  if (t.length === 0) return null;
  let i = 0;

  const primary = (): SetExpr | null => {
    if (i >= t.length) return null;
    const tok = t[i];
    if (tok === "(") {
      i++;
      const e = expr();
      if (!e || t[i] !== ")") return null;
      i++;
      return e;
    }
    if (tok === "ran" || tok === "dom") {
      i++;
      if (t[i] !== "(") return null;
      i++;
      const e = expr();
      if (!e || t[i] !== ")") return null;
      i++;
      return { k: "fn", fn: tok, e };
    }
    if (/^[A-Za-z_]\w*$/.test(tok)) {
      i++;
      if (t[i] === "(" && /^[A-Za-z_]\w*$/.test(t[i + 1] ?? "") && t[i + 2] === ")") {
        const arg = t[i + 1];
        i += 3;
        return { k: "apply", f: tok, arg };
      }
      return { k: "id", name: tok };
    }
    return null;
  };

  const expr = (): SetExpr | null => {
    let l = primary();
    if (!l) return null;
    while (i < t.length && (t[i] === "∪" || t[i] === "∩" || t[i] === "∖")) {
      const op = t[i] as "∪" | "∩" | "∖";
      i++;
      const r = primary();
      if (!r) return null;
      l = { k: "op", op, l, r };
    }
    return l;
  };

  const e = expr();
  return e && i === t.length ? e : null;      // trailing junk means "not understood"
}

// ── Membership ───────────────────────────────────────────────────────────
type Enc = (id: string) => EncodingForm | undefined;
// The model's carrier sets, by name. Membership in one is a typing statement,
// not a lookup -- see memberOfLeaf.
export type Carriers = ReadonlySet<string>;

// Membership of `elem` in a LEAF set, decided by how that leaf is stored.
// Returns null when the pairing of element shape and container makes no sense,
// so the caller refuses rather than emitting something that merely compiles.
function memberOfLeaf(elem: Elem, name: string, enc: Enc, carriers: Carriers): string | null {
  // A CARRIER SET is a type, not a container. `pkt ∈ PKT ∖ (xmittedPkts ∪
  // middleware)` says "some packet not yet used", and its `∈ PKT` half is the
  // typing half -- true of every PktId there is. C++ has no object to look in:
  // a carrier is declared nowhere, so treating it as one emitted
  // `PKT.count(pkt)` against an undeclared identifier (four compile errors in
  // RTMCS M6's create_* events). The rest of the expression still carries the
  // whole meaning.
  if (carriers.has(name)) return elem.kind === "scalar" ? "true" : null;
  const form = enc(name);
  if (elem.kind === "pair") {
    if (form === "pair-set") return `${name}.count({${elem.a}, ${elem.b}}) > 0`;
    if (form === "map-of-sets")
      return `(${name}.count(${elem.a}) > 0 && ${name}.at(${elem.a}).count(${elem.b}) > 0)`;
    if (form === "function")
      return `(${name}.count(${elem.a}) > 0 && ${name}.at(${elem.a}) == ${elem.b})`;
    return null;
  }
  // A scalar cannot be a member of a set of pairs -- the model would have to
  // say ran(...) or dom(...) first, which is a different node.
  if (form === "pair-set") return null;
  return `${name}.count(${elem.x}) > 0`;
}

export function memberTest(elem: Elem, e: SetExpr, enc: Enc, carriers: Carriers = new Set()): string | null {
  switch (e.k) {
    case "id":
      return memberOfLeaf(elem, e.name, enc, carriers);

    case "apply": {
      // `x ∈ f(k)` -- membership in the set stored under one key.
      if (elem.kind !== "scalar") return null;
      return `(${e.f}.count(${e.arg}) > 0 && ${e.f}.at(${e.arg}).count(${elem.x}) > 0)`;
    }

    case "op": {
      const l = memberTest(elem, e.l, enc, carriers);
      const r = memberTest(elem, e.r, enc, carriers);
      if (l === null || r === null) return null;
      if (e.op === "∪") return `(${l} || ${r})`;
      if (e.op === "∩") return `(${l} && ${r})`;
      return `(${l} && !(${r}))`;
    }

    case "fn": {
      if (elem.kind !== "scalar") return null;   // ran/dom yield a flat set
      // Distributing over ∪ is sound; over ∖ and ∩ it is not (see the header).
      if (e.e.k === "op") {
        if (e.e.op !== "∪") return null;
        const l = memberTest(elem, { k: "fn", fn: e.fn, e: e.e.l }, enc, carriers);
        const r = memberTest(elem, { k: "fn", fn: e.fn, e: e.e.r }, enc, carriers);
        return l === null || r === null ? null : `(${l} || ${r})`;
      }
      if (e.e.k !== "id") return null;
      const name = e.e.name;
      const form = enc(name);
      if (e.fn === "ran") {
        if (form === "pair-set") return `inRan(${name}, ${elem.x})`;
        if (form === "map-of-sets" || form === "function") return null;  // needs a scan helper
        return null;
      }
      // dom
      if (form === "pair-set") return `inDom(${name}, ${elem.x})`;
      if (form === "map-of-sets" || form === "function") return `${name}.count(${elem.x}) > 0`;
      return null;
    }
  }
}

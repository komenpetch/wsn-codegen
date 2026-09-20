import type { EncodedMachine, FlatEvent } from "./types";
import { INITIALISATION } from "./types";
import { splitConjuncts } from "./ruleEngine";

// Boolean PHASE FLAGS, and the order a batch of events has to be tried in when
// the model uses them.
//
// ── The problem ────────────────────────────────────────────────────────────
//
// `runEnabledEvents()` attempts every schedulable event ONCE per tick, in model
// order, and each attempt sees the state the previous ones left. That is a
// sound Event-B trace -- every step is a real step -- but it is a FIXED trace,
// and a fixed order can starve an event for ever. Two ways, both measured on
// RTMCS:
//
//   1. A CONTENDER that is strictly more specific is dead by construction.
//      `start_fldRREP`'s guards are `start_fldRREQ`'s PLUS two more, and both
//      take the same lock (`floodFlg ≔ TRUE` against a `floodFlg = FALSE`
//      guard). So `start_fldRREP` is enabled only when `start_fldRREQ` is, and
//      `start_fldRREQ` is tried first and falsifies it. It can never fire --
//      not "rarely", never -- so `rrepFlg` is never raised, `create_rrep` never
//      fires, and no RREP is ever created. Measured: `start_fldRREP` called
//      308/372/364/336 times per node and rejected on that one guard every
//      single time.
//
//   2. A PHASE TERMINATOR run before the phase's own events empties it.
//      `reset_fldRREQ` lowers `floodFlg` and sits BETWEEN `start_fldRREQ` and
//      `create_rreq` in model order, so raising and lowering both happen before
//      the creating event is tried and it sees FALSE. The same shape is in
//      MintRoute -- `start_flooding`(8), `reset_flooding`(9),
//      `create_bconPkt`(10) -- so this is not an RTMCS quirk.
//
// ⚠ NEITHER IS A MODELLING ERROR. Event-B does not order events; an
// implementation must choose, and these two moves are the choice that lets
// every event the model declares actually occur. Both are derived from the
// model's own guards and actions -- no protocol name appears below.
//
// ── What is deliberately NOT done ─────────────────────────────────────────
//
// The general version of this -- a dependency graph over every read/write pair
// -- was worked through and produces CYCLES on this very corpus (a setter must
// precede its reader, a reader must precede its falsifier, and the setter is
// itself a falsifier of a sibling), and every cycle-breaking rule tried either
// hoisted `create_rreq` above the setter that enables it or left the RREP
// starved. The two rules here are the narrow, checkable cases; anything else
// keeps model order.

const BOOL_LIT = "(?:TRUE|FALSE)";
// `v = TRUE` or `v(x) = TRUE` -- a flag READ. The optional application is how a
// per-node flag is written; the model has both shapes (`bcastRouTimer ∈ BOOL`
// is a bare scalar, `floodFlg ∈ ND → BOOL` is applied).
const READ = new RegExp(`^(\\w+)\\s*(?:\\(\\s*\\w+\\s*\\))?\\s*=\\s*(${BOOL_LIT})$`);
const WRITE = new RegExp(`^(\\w+)\\s*(?:\\(\\s*\\w+\\s*\\))?\\s*≔\\s*(${BOOL_LIT})$`);

/** The model's boolean-valued variables, read off their declared type. */
export function booleanFlagsOf(model: EncodedMachine): Set<string> {
  const out = new Set<string>();
  for (const [v, type] of model.variableTypes) if (/\bBOOL\b/.test(type)) out.add(v);
  return out;
}

export interface FlagUse {
  /** flag → the value this event's guards REQUIRE. */
  reads: Map<string, string>;
  /** flag → the value this event's actions ASSIGN. */
  writes: Map<string, string>;
  /** How many actions the event has in total -- a pure reset has no others. */
  actionCount: number;
}

export function flagUseOf(ev: FlatEvent, flags: ReadonlySet<string>): FlagUse {
  const reads = new Map<string, string>(), writes = new Map<string, string>();
  for (const g of ev.guards.flatMap(splitConjuncts)) {
    const m = READ.exec(g.trim());
    if (m && flags.has(m[1])) reads.set(m[1], m[2]);
  }
  const actions = ev.actions.flatMap(splitConjuncts).map((a) => a.trim()).filter(Boolean);
  for (const a of actions) {
    const m = WRITE.exec(a);
    if (m && flags.has(m[1])) writes.set(m[1], m[2]);
  }
  return { reads, writes, actionCount: actions.length };
}

/**
 * A PHASE TERMINATOR: every action it has lowers a flag it itself guards as
 * raised, and it does nothing else.
 *
 * The "nothing else" is what keeps this narrow and is load-bearing:
 * `finish_sensing` lowers two flags AND clears `sensingNDs`, so it carries
 * state of its own and is left exactly where the model put it. Only an event
 * that is purely "this phase is over" is moved.
 */
export function isPhaseTerminator(use: FlagUse): boolean {
  if (use.actionCount === 0 || use.writes.size !== use.actionCount) return false;
  for (const [flag, value] of use.writes)
    if (value !== "FALSE" || use.reads.get(flag) !== "TRUE") return false;
  return true;
}

// Guard clauses as a comparable set: whitespace is not information here, and
// Rodin's own spacing is inconsistent even between two events of one machine.
const clauseSet = (ev: FlatEvent): Set<string> =>
  new Set(ev.guards.flatMap(splitConjuncts).map((c) => c.replace(/\s+/g, "")).filter(Boolean));

const strictlyContains = (a: Set<string>, b: Set<string>): boolean =>
  a.size > b.size && [...b].every((c) => a.has(c));

/**
 * Order the events a batch will attempt.
 *
 * `labels` arrives in model order and comes back permuted. Every event the two
 * rules do not touch keeps its position, which is the point: this is a repair,
 * not a rescheduling.
 */
export function orderByPhase(model: EncodedMachine, labels: readonly string[]): string[] {
  const flags = booleanFlagsOf(model);
  if (flags.size === 0) return [...labels];

  const byLabel = new Map(model.events.map((e) => [e.label, e]));
  const pos = new Map(labels.map((l, i) => [l, i]));
  const use = new Map<string, FlagUse>();
  for (const l of labels) {
    const ev = byLabel.get(l);
    if (ev && ev.label !== INITIALISATION) use.set(l, flagUseOf(ev, flags));
  }

  // ── Rule 1: contenders, most specific first ──
  //
  // Two events CONTEND when they require the same value of the same flag and
  // both assign that flag: whoever is tried first takes it and disables the
  // other for this round.
  const groups = new Map<string, string[]>();
  for (const [l, u] of use)
    for (const [flag, value] of u.reads)
      if (u.writes.has(flag)) {
        const key = `${flag}=${value}`;
        groups.set(key, [...(groups.get(key) ?? []), l]);
      }

  // An event in two contended groups at once would need both anchors and there
  // is no answer to which wins, so nothing is reordered rather than guessing.
  // ⚠ Counted rather than `!seen.add(l)`: `Set.prototype.add` returns the SET,
  // which is always truthy, so that spelling makes this guard ALWAYS say "no
  // overlap" -- inert, and reading as coverage. It shipped that way for one
  // mutation run and the mutation run is what found it; the same inert-guard
  // shape is on this project's record twice already.
  const contended = [...groups.values()].filter((g) => g.length > 1);
  const memberships = new Map<string, number>();
  for (const g of contended) for (const l of g) memberships.set(l, (memberships.get(l) ?? 0) + 1);
  const overlapping = [...memberships.values()].some((n) => n > 1);

  /** Group anchor position and rank within the group, for a contended event. */
  const anchor = new Map<string, { at: number; rank: number }>();
  if (!overlapping) {
    for (const group of contended) {
      const at = Math.min(...group.map((l) => pos.get(l)!));
      const sets = new Map(group.map((l) => [l, clauseSet(byLabel.get(l)!)]));
      for (const l of group) {
        // How many members of this group this event is strictly more specific
        // than. Higher means "tried earlier"; equal means incomparable, and the
        // stable sort then leaves them in model order.
        const rank = group.filter((o) =>
          o !== l && strictlyContains(sets.get(l)!, sets.get(o)!)).length;
        anchor.set(l, { at, rank });
      }
    }
  }

  // ── Rule 2: phase terminators last ──
  const terminator = new Set([...use].filter(([, u]) => isPhaseTerminator(u)).map(([l]) => l));

  const key = (l: string): [number, number, number, number] => {
    const a = anchor.get(l);
    return [
      terminator.has(l) ? 1 : 0,          // terminators after everything else
      a ? a.at : pos.get(l)!,             // a contended event sits at its group's anchor
      a ? -a.rank : 0,                    // most specific first within the group
      pos.get(l)!,                        // stable: model order breaks every tie
    ];
  };
  return [...labels].sort((x, y) => {
    const a = key(x), b = key(y);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
}

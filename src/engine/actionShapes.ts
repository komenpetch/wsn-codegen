import { esc } from "./text";

// The shapes an Event-B ACTION takes over a single variable, asked in one place.
//
// `v ≔ v ∪ …` and `v ≔ v ∖ …` are how the models add to and remove from a
// variable, and five passes need to recognise them: which events feed the
// variable `send_down` observes (transmitEventsOf), which publish what the
// receive events consume (receiveEventsOf), which drain what the carried events
// only ever fill (drainEventsOf), which retire an abstract event
// (supersededEventsOf), and which hand a packet to the medium (mediumBinding).
//
// ⚠ THEY HAD ALREADY DRIFTED INTO THREE STRICTNESSES, and the difference is
// real rather than cosmetic:
//
//     v ≔ v ∪ {a ↦ b}      a single MAPLET      — addsMaplet
//     v ≔ v ∪ ({k} × s)    a cartesian PRODUCT  — addsTo only
//
// `transmitEventsOf` used the anchored maplet form; `drainEventsOf` used a bare
// `∪` prefix, so its "filled" set silently included variables filled by a
// product. Both readings are defensible and neither is wrong everywhere — what
// was wrong was that the choice lived in a regex literal at each call site,
// where nothing named it or made it reviewable. Each helper below says which it
// is, and a caller picks deliberately.

// A bare Event-B identifier. Callers pin one or both halves of a maplet by
// passing a literal name instead.
const IDENT = String.raw`\w+`;

/** `v ≔ v ∪ …` — v gains something, whatever shape it is. */
export const addsTo = (action: string, v: string): boolean =>
  new RegExp(`^${esc(v)}\\s*≔\\s*${esc(v)}\\s*∪`).test(action.trim());

/** `v ≔ v ∖ …` — v loses something, whatever shape it is. */
export const removesFrom = (action: string, v: string): boolean =>
  new RegExp(`^${esc(v)}\\s*≔\\s*${esc(v)}\\s*∖`).test(action.trim());

/**
 * `v ≔ v ∪ {a ↦ b}` — v gains exactly one MAPLET, and nothing else.
 * `a` and `b` default to any identifier; pass names to pin them, which is how
 * a transmit event is recognised as filing THIS packet under THIS node.
 */
export const addsMaplet = (action: string, v: string, a: string = IDENT, b: string = IDENT): boolean =>
  new RegExp(`^${esc(v)}\\s*≔\\s*${esc(v)}\\s*∪\\s*\\{\\s*${a}\\s*↦\\s*${b}\\s*\\}$`)
    .test(action.trim());

/** The maplet v gains, or null. `v ≔ v ∪ {a ↦ b}` → `[a, b]`. */
export function mapletAddedTo(action: string, v: string): [string, string] | null {
  const m = new RegExp(
    `^${esc(v)}\\s*≔\\s*${esc(v)}\\s*∪\\s*\\{\\s*(${IDENT})\\s*↦\\s*(${IDENT})\\s*\\}$`)
    .exec(action.trim());
  return m ? [m[1], m[2]] : null;
}

/** The variable this action adds to, or null. `V ≔ V ∪ …` → `V`. */
export function variableAddedTo(action: string): string | null {
  const m = new RegExp(`^(${IDENT})\\s*≔\\s*\\1\\s*∪`).exec(action.trim());
  return m ? m[1] : null;
}

/**
 * Any single-maplet addition, or null. `V ≔ V ∪ {a ↦ b}` → `[V, a, b]`.
 * The three-way form: `senderFieldOf` needs the variable AND both members,
 * because the equality between them is what identifies the sender field.
 */
export function anyMapletAdded(action: string): [string, string, string] | null {
  const m = new RegExp(
    `^(${IDENT})\\s*≔\\s*\\1\\s*∪\\s*\\{\\s*(${IDENT})\\s*↦\\s*(${IDENT})\\s*\\}$`)
    .exec(action.trim());
  return m ? [m[1], m[2], m[3]] : null;
}

/**
 * The variable that LOSES this exact maplet, or null. `V ≔ V ∖ {a ↦ b}` → `V`.
 *
 * The mirror of variableGainingMaplet, and here for the same reason: the medium
 * binding asks which pair-sets the DELIVERY event removes `{f ↦ pkt}` from, so
 * the transmitting node can apply that cleanup to its own copy -- which in a
 * per-node module nothing else ever will. Writing the regex there would be an
 * eleventh copy of this shape, which is what noDuplication.test.ts exists for.
 */
export function variableLosingMaplet(action: string, a: string, b: string): string | null {
  const m = new RegExp(`^(${IDENT})\\s*≔\\s*\\1\\s*∖\\s*\\{\\s*${a}\\s*↦\\s*${b}\\s*\\}$`)
    .exec(action.trim());
  return m ? m[1] : null;
}

/** The variable that gains this exact maplet, or null. `V ≔ V ∪ {a ↦ b}` → `V`. */
export function variableGainingMaplet(action: string, a: string, b: string): string | null {
  const m = new RegExp(`^(${IDENT})\\s*≔\\s*\\1\\s*∪\\s*\\{\\s*${a}\\s*↦\\s*${b}\\s*\\}$`)
    .exec(action.trim());
  return m ? m[1] : null;
}

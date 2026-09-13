# Translation Rules — Induced from the WSN Pattern Machine Mapping

**Automatic Code Generation Framework from Event-B Models for WSNs**
**Komen Nitchaphon — 6630613042**
**Date:** 2026-06-30 · **Version:** 1.0

This catalog is **induced bottom-up** from the machine-only Event-B → C++ mapping of the six
shared-decomposition interfaces ([INTERFACE_MAPPING.md](INTERFACE_MAPPING.md)).
Every distinct guard/action shape observed across the interfaces is abstracted into a rule,
each with a first-principles justification and the **evidence** (which events exercise it).
Rules are grouped by the **C++ container** the variable uses, because the C++ form of an
operator depends on its storage form (chosen by the encoding rules in Part I).

> **Relationship to the prior catalog.** The project's earlier `translation_rules.md` /
> `translation_rules_examples.md` (the R1–R20 + A1–A5 set) was authored top-down. *This*
> catalog is derived purely from the advisor's source pattern, with its own prefix scheme
> (`ENC / SET / FN / PS / MS / ST / CMP`) and self-contained justifications. The two can be
> cross-referenced later; this one is the empirically-grounded version.

**Notation.** `A,B` element types (all `int` after **ENC1**); `S` a plain set; `f` a
function; `R` a relation (pair-set); `M` a map-of-sets; `k` a key; `x,y,v` values; `s,V`
sets. Evidence is written `Interface.event`.

---

## Part I — Encoding-selection rules (variable type → C++ container)

These pick the storage form. Every operation rule in Part II is stated relative to the form
chosen here. **Decide by type *and* observed usage, not by the variable's name.**

| ID | Event-B type / usage | C++ container | Why | Evidence |
|---|---|---|---|---|
| **ENC1** | element of a carrier set used by identity (`PKT`), or of a constrained integer set (`ND ⊆ ℕ`, `ℤ`) | `int` (aliased `Node`/`PktId`/`Data`) | values are only compared for equality and stored → an injective integer label loses nothing | `PKT`, `ND`, `ℤ` everywhere |
| **ENC2** | `S ⊆ T` or `ℙ(T)` (a set variable) | `std::set<T>` | a set is a finite collection of unique elements | `createdPkts`; constants `ND`, `Dests` |
| **ENC3** | `f ∈ A → B` or `A ⇸ B` (function) | `std::map<A,B>` | a function gives each key ≤ 1 value = map's unique-key invariant | `ctlSensedFlg`, `pktFwdr`, `pktData`; `type`, `initialSrcAddr` |
| **ENC4** | `R ∈ A ↔ B` used **only by whole pairs** (`a↦b ∈ R`), never indexed `R(a)` | `std::set<std::pair<A,B>>` | a relation *is* its set of pairs; with no per-key indexing the faithful store is exactly that set | `sentUp`,`sentDown`,`recvBuff`,`clrRecvBuffFlg`,`ndBuff`,`destBuff` |
| **ENC5** | `M ∈ A → ℙ(B)`, or a relation accessed **per key** (`{k}◁M`, `M(k):=M(k)∪{x}`, `{k}×s`) | `std::map<A,std::set<B>>` | each key owns a *set* of values; map-of-sets stores that grouping directly | `ctlNeighbours`, `senseBuff`; `finalDestAddr` |
| **ENC6** | `BOOL`; a finite tag carrier set (`TYPE` = {`DATA`,`CONTROL`}) | `bool`; `enum class` | two-valued / small finite enumerated domain | `ctlSensedFlg` value; `type`/`PktType` |

---

## Part II — Operation rules by container

### A. Plain set `S = std::set<E>` (under ENC2)

| ID | Event-B | C++ | Why | Evidence |
|---|---|---|---|---|
| **SET1** | `x ∈ S` / `x ∉ S` | `S.count(x) > 0` / `== 0` | `count` is 1 iff present | `nb ∈ Dests` (IReceive.dest_recv_pkt), `nb ∉ Dests` (IReceive.fwdr_receive_pkt) |
| **SET2** | `S := S ∪ {x}` | `S.insert(x);` | union with a singleton = insert (idempotent) | IPacket.creatingPkt (`createdPkts`) |
| **SET3** | `S := S ∖ {x}` | `S.erase(x);` | difference by a singleton = erase | — (form completeness; no plain-set removal among the six) |
| **SET4** | `S = ∅` / `S ≠ ∅` | `S.empty()` / `!S.empty()` | container emptiness = set emptiness | `nbrs ≠ ∅` (ISend.send_up) |
| **SET5** | `S := ∅` | `S.clear();` | empty set = empty container | IPacket init (`createdPkts`) |

### B. Function `f = std::map<A,B>` (under ENC3)

| ID | Event-B | C++ | Why | Evidence |
|---|---|---|---|---|
| **FN1** | `f(x)` | `f.at(x)` | a function returns its single image of `x` | `initialSrcAddr(pkt)`, `type(pkt)`; `ctlSensedFlg(x)` (ISensingUnit.sensing) |
| **FN2** | `x ∈ dom(f)` / `∉` | `f.count(x) > 0` / `== 0` | a key is in the domain iff it has an entry | `pkt ∈ dom(pktFwdr)` (IPacket.start_tx); `pkt ∉ dom(pktData)` (IPacket.creatingPkt) |
| **FN3** | `f(x) := v`, `f ⊴ {x↦v}`, `f := f ∪ {x↦v}` (`x ∉ dom`) | `f[x] = v;` | set/replace the one image of `x` | `ctlSensedFlg(x):=sf` (ISensingUnit); `pktFwdr`,`pktData` (IPacket.creatingPkt/start_tx) |
| **FN4** | `{x} ⩤ f`, `f := f ∖ {x↦v}` | `f.erase(x);` | domain anti-restriction deletes the entry | — (form completeness; no function-key removal among the six) |
| **FN5** | `f := ∅` | `f.clear();` | empty function = empty container | IPacket init (`pktFwdr`,`pktData`) |

### C. Relation as pair-set `R = std::set<std::pair<A,B>>` (under ENC4)

| ID | Event-B | C++ | Why | Evidence |
|---|---|---|---|---|
| **PS1** | `a↦b ∈ R` / `∉` | `R.count({a,b}) > 0` / `== 0` | the relation is its set of pairs; pair-membership = element-membership | ISend.start_tx, IReceive.clear_recvdBuff, INDBuffer.start_tx, IDestBuffer.dest_recv_pkt |
| **PS2** | `R := R ∪ {a↦b}` | `R.insert({a,b});` | union with one pair = insert | ISend.start_tx, IReceive.receive, INDBuffer.creatingPkt, IDestBuffer.dest_recv_pkt |
| **PS3** | `R := R ∖ {a↦b}` | `R.erase({a,b});` | difference by one pair = erase | ISend.send_up/finish_tx_pkt, IReceive.clear_recvdBuff, INDBuffer.start_tx |
| **PS4** | `a ∈ dom(R)` | `inDom(R,a)` = `any_of(R, first==a)` | domain = set of first components; pair-set has no key index, so scan | ISend.finish_tx_pkt (`x ∈ dom(sentUp)`) |
| **PS5** | `b ∈ ran(R)` / `∉` | `inRan(R,b)` / `!inRan(R,b)` | range = set of second components; scan | ISend.finish/final_tx_pkt; INDBuffer.finish/final_tx_pkt |
| **PS6** | `R := R ⩥ V` (range subtraction) | erase every pair with `second ∈ V` (loop) | `⩥` keeps pairs whose range ∉ `V` | ISend.final_tx_pkt (`sentUp ⩥ {pkt}`) |
| **PS7** | `R := ∅` | `R.clear();` | empty relation = empty container | all buffer inits |

### D. Map-of-sets `M = std::map<K,std::set<V>>` (under ENC5)

| ID | Event-B | C++ | Why | Evidence |
|---|---|---|---|---|
| **MS1** | `x ∈ M(k)` / `∉` | `M.count(k) > 0 && M.at(k).count(x) > 0` / negation | membership in the per-key set (guard `count(k)` avoids creating a missing key) | ISensingUnit.creatingDataPacket (`data ∈ senseBuff(x)`) |
| **MS2** | `M(k) := M(k) ∪ {x}` | `M[k].insert(x);` | insert into key `k`'s set (auto-creates empty set) | ISensingUnit.sensing (`senseBuff`) |
| **MS3** | `M(k) := M(k) ∖ {x}`, `M := M ∖ {k↦x}` | `M[k].erase(x); if (M[k].empty()) M.erase(k);` | remove one value from key `k`'s set; collapse empty key | ISensingUnit.creatingDataPacket; ISend.receive (`ctlNeighbours ∖ {pkt↦nb}`) |
| **MS4** | `k ∈ dom(M)` / `∉` | `M.count(k) > 0` / `== 0` | key present iff it has a (non-empty) value-set | ISend.send_up (`pkt ∉ dom(ctlNeighbours)`) |
| **MS5** | `{k} ◁ M = ∅` | `M.count(k) == 0 \|\| M.at(k).empty()` | restriction-to-`k` empty iff no values under `k` | ISend.finish/final_tx_pkt |
| **MS6** | `ran({k} ◁ M)` | `M.at(k)` | the values related to key `k` = the set stored at `k` | INDBuffer/ISensingUnit/IPacket (`des = ran({pkt}◁finalDestAddr)`) |
| **MS7** | `M := M ∪ ({k} × s)` | `for (auto v : s) M[k].insert(v);` | `{k}×s` joins `k` to every member of `s` | ISend.send_up (`ctlNeighbours ∪ ({pkt}×nbrs)`) |
| **MS8** | `M := ∅` | `M.clear();` | empty map = empty container | ISend init (`ctlNeighbours`); see **CMP2** for `M := D×{∅}` |

### E. Structural / composition rules

| ID | Event-B | C++ | Why | Evidence |
|---|---|---|---|---|
| **ST1** | event with guards `g` and actions `a` | method: `if (any gᵢ fails) return false;` then run `a`; `return true;` | an Event-B event is a guarded atomic operation | every event |
| **ST2** | event with guards, **no actions** | `bool` predicate (no mutation) | identity effect on state = an enabling condition | ISend.send_down; INDBuffer.finish/final_tx_pkt |
| **ST3** | `g1 ∧ g2 ∧ …` (guard conjunction) | `g1 && g2 …`, or one `if (!gᵢ) return false;` per guard | the event fires only when all guards hold | every multi-guard event |
| **ST4** | pure typing guard (`x ∈ ℤ`, `pkt ∈ PKT`, `sf ∈ BOOL`, `theorem="true"`) | *omitted* | enforced statically by the C++ types | dropped throughout |
| **ST5** | multiple actions `a1; a2; a3` | sequential statements, in declared order | actions of an event execute together | ISend.send_up; IPacket.creatingPkt |

### F. Composite / derived rules

| ID | Event-B | C++ | Why | Evidence |
|---|---|---|---|---|
| **CMP1** | `x ∈ A ∖ B` (set-difference membership) | `A.count(x) > 0 && B.count(x) == 0` | in `A` and not in `B` | INDBuffer/ISensingUnit/IPacket (`x ∈ ND∖Dests`) |
| **CMP2** | total-function init `f := D × {c}` (incl. `c = ∅`) | `for (auto d : D) f[d] = c;` (or `f[d] = {};`) | `D×{c}` pairs every `d∈D` with constant `c` | ISensingUnit init (`ctlSensedFlg`, `senseBuff`) |

---

## Part III — Coverage / evidence summary

Which interfaces exercise each rule family (●). Confirms every rule is grounded in the
source pattern (except the two completeness rows **SET3**, **FN4**, marked ○).

| Family | ISend | IReceive | INDBuffer | IDestBuffer | ISensingUnit | IPacket |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| ENC (encoding) | ● | ● | ● | ● | ● | ● |
| SET (plain set) | ● (SET4) | | | | | ● (SET2,SET5) |
| FN (function) | | | | | ● | ● |
| PS (pair-set) | ● | ● | ● | ● | | |
| MS (map-of-sets) | ● | | | | ● | (MS6 only) |
| ST (structural) | ● | ● | ● | ● | ● | ● |
| CMP (composite) | | | ● | | ● | ● |

**Rule count:** 38 rules total — ENC 6, SET 5, FN 5, PS 7, MS 8, ST 5, CMP 2. Of these, **36
are directly evidenced** by the six interfaces; **SET3** and **FN4** are included for
form-completeness (their operator does not occur in these machines but belongs to the form's
operation set).

---

## Part IV — How to apply (generator view)

For a machine variable `v` with Event-B type `τ` and event body `B`:

1. **Encode** `v`: run ENC1–ENC6 on `τ` *and* its usage in `B` → fixes `v`'s C++ container.
2. **Translate** each guard/action in `B` with the Part II rule family matching `v`'s
   container (SET / FN / PS / MS), plus CMP1–CMP2 for derived constructs.
3. **Assemble** the event with ST1–ST5: guards → early-return preconditions (ST3), actions
   → ordered statements (ST5), action-less events → `bool` predicates (ST2), typing guards
   dropped (ST4).

This is exactly the procedure realised by the `§7` assembled classes in the machine mapping,
so those classes double as the worked examples for this catalog.

---

## Addendum — implementation notes (2026-07-05 audit)

Findings from auditing the implemented rule engine (`wsn-codegen/src/engine/rules.ts`) against
this catalog and the raw `.bum` XML:

1. **FN3 override glyph is U+E103.** In raw Rodin XML the relational-override operator of
   `f  {x↦v}` is stored as the private-use codepoint **U+E103** (it renders as tofu/nothing in
   most fonts, which is why it looks like a missing glyph in copied text). The implemented
   FN3-override rule matches U+E103, the legacy `⊴` spelling, and the space-degraded copy form.
   Evidence: `pktFwdr ≔ pktFwdr  {pkt↦x}` (ISend/IPacket `start_tx` a2, pM1.bum); U+E103 also
   appears throughout the RTMCS/MintRoute `.bum` exports (56 occurrences).
2. **FN1 ∘ SET1 composition is realized as an explicit whole-clause rule.** The engine matches
   whole clauses, so `f(k) ∈ S` (e.g. `type(pkt) ∈ CONTROL`, IPacket.creatingControlPacket) is
   implemented as its own pattern emitting `S.count(f.at(k)) > 0` — semantically FN1 + SET1,
   no new catalog entry.
3. **`M ≔ M ∪ {k↦v}` on an ENC5 variable** dispatches to `M[k].insert(v);` (the pair spelling
   of MS2, symmetric with MS3's pair form). Also implementation-level dispatch, not a new rule.
4. **ST4 diagnostic**: clauses matching no rule are emitted as
   `// UNTRANSLATED GUARD/ACTION: <Event-B text>` comments — never silently dropped.

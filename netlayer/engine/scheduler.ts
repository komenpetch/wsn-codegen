import type { EncodedMachine, GeneratedTree } from "../../src/engine/types";
import { splitConjuncts } from "../../src/engine/ruleEngine";
import type { PacketField } from "./packetModel";

// A generic event scheduler.
//
// The generated module has one guarded `bool` method per Event-B event, and
// nothing ever called them: the events could fire, but no simulation trigger
// reached them. This emits the missing half, and emits it from the MODEL rather
// than from knowledge of any protocol -- there is no mention of flooding,
// beacons or MintRoute anywhere below.
//
// The semantics being implemented is Event-B's own: an event is enabled when
// there EXIST parameter values satisfying its guards, and firing it runs its
// actions. The whole difficulty is the existential. A parameter is not searched
// for blindly -- integers cannot be enumerated -- it is classified:
//
//   determined  a guard pins it outright: `sno = floodSeqNo(s) + 1`, `s = Sink`,
//               `nbh = −1`. Compute it; do not search.
//   enumerated  a guard ranges it over a finite carrier: `x ∈ ND`. Loop.
//   fresh       a packet the event is about to CREATE, recognised by a
//               `p ∉ dom(F)` / `p ∉ <set>` freshness guard. Mint one.
//
// Parameters are emitted in dependency order, because `sno = floodSeqNo(s) + 1`
// cannot be computed before `s` exists. An event with a parameter that fits
// none of the three classes is skipped, with the reason emitted as a comment --
// the same discipline as an untranslated clause: a visible gap, never a silent
// one.
//
// Constraints on a FRESH packet are satisfied by CONSTRUCTION rather than by
// rejection. `type(pkt) = BEACON` says "there exists a packet of this type not
// yet used"; minting one and stamping its type is exactly that existential,
// where searching would almost always fail. If the event then declines to fire,
// everything the scheduler synthesised is rolled back, so a failed attempt
// leaves no trace.

const CARRIER_ALIAS: Record<string, string> = { ND: "Node", PKT: "PktId", "ℤ": "Data" };

interface Param { name: string; cppType: string; }
interface Plan {
  label: string;
  params: Param[];
  lines: string[];      // setup, in dependency order
  rollback: string[];   // undo of anything synthesised
  ok: boolean;
  why?: string;         // when !ok
  method?: string;      // emitted name, when the CommPattern merge renamed it
}

const NUM = String.raw`(?:−|-)?\d+`;
const num = (s: string) => s.replace(/−/g, "-");

// Parse `bool <Class>::<event>(<params>) {` out of the emitted .cc, so the
// scheduler uses the signature the emitter actually produced (already corrected
// by fixSetTypedParameters) rather than re-deriving it.
// Also keyed by Event-B LABEL, not just by method name. The CommPattern merge
// emits send_down as sendSensorPacket and send_up as socketDataArrived, so a
// lookup by label alone silently misses them -- and send_down is the event that
// moves a packet from the medium onto the channel, i.e. the one that makes a
// flood propagate rather than just leave the sink. The emitter writes a
// provenance comment above each renamed method; that is what is read here,
// rather than hardcoding the two names.
function signatures(cc: string, cls: string): Map<string, { params: Param[]; method: string }> {
  const out = new Map<string, { params: Param[]; method: string }>();
  const prov = new RegExp(
    `^// Event-B: (\\w+)[^\\n]*\\nbool ${cls}::(\\w+)\\(([^)]*)\\) \\{$`, "gm");
  const parse = (raw: string): Param[] =>
    raw.trim() === "" ? [] : raw.split(",").map((r) => {
      const p = r.trim();
      const i = p.lastIndexOf(" ");
      return { cppType: p.slice(0, i).trim(), name: p.slice(i + 1).trim() };
    });
  for (let m = prov.exec(cc); m; m = prov.exec(cc))
    out.set(m[1], { params: parse(m[3]), method: m[2] });

  const re = new RegExp(`^bool ${cls}::(\\w+)\\(([^)]*)\\) \\{$`, "gm");
  for (let m = re.exec(cc); m; m = re.exec(cc)) {
    const params = m[2].trim() === "" ? [] : m[2].split(",").map((raw) => {
      const p = raw.trim();
      const i = p.lastIndexOf(" ");
      return { cppType: p.slice(0, i).trim(), name: p.slice(i + 1).trim() };
    });
    if (!out.has(m[1])) out.set(m[1], { params, method: m[1] });
  }
  return out;
}

function planFor(label: string, params: Param[], guards: string[], carriers: Set<string>,
  enc: (id: string) => string | undefined, nestedVars: Set<string>, pktField: Map<string, string>): Plan {
  const clauses = guards.flatMap((g) => splitConjuncts(g));
  const lines: string[] = [];
  const rollback: string[] = [];
  const resolved = new Set<string>();
  // Inside a loop an unmet precondition must skip this candidate, not abandon
  // the whole event -- returning would silently stop at the first bad one.
  let depth = 0;
  const bail = () => (depth > 0 ? "continue;" : "return false;");
  const known = (expr: string) =>
    (expr.match(/[A-Za-z_]\w*/g) ?? []).every((t) => !params.some((p) => p.name === t) || resolved.has(t));

  // The type tag a fresh packet must carry, if the event pins one.
  const typeOf = (p: string): string | undefined => {
    for (const c of clauses) {
      const m = new RegExp(`^type\\(\\s*${p}\\s*\\)\\s*=\\s*(\\w+)$`).exec(c.trim());
      if (m) return m[1];
    }
    return undefined;
  };
  const isFresh = (p: string) =>
    clauses.some((c) => new RegExp(`^${p}\\s*∉`).test(c.trim()));

  let progress = true;
  while (progress && resolved.size < params.length) {
    progress = false;
    for (const par of params) {
      if (resolved.has(par.name)) continue;
      const p = par.name;

      // determined: p = <literal>
      const lit = clauses.map((c) => new RegExp(`^${p}\\s*=\\s*(${NUM})$`).exec(c.trim())).find(Boolean);
      if (lit) {
        lines.push(`    ${par.cppType} ${p} = ${num(lit[1])};`);
        resolved.add(p); progress = true; continue;
      }
      // determined: p = f(x) [+|- n]
      const fn = clauses.map((c) =>
        new RegExp(`^${p}\\s*=\\s*(\\w+)\\(\\s*(\\w+)\\s*\\)(?:\\s*(\\+|−|-)\\s*(\\d+))?$`).exec(c.trim())
      ).find(Boolean);
      if (fn && known(fn[2])) {
        const [, f, x, op, n] = fn;
        const arith = op ? ` ${op === "+" ? "+" : "-"} ${n}` : "";
        // ENC7 may have moved this attribute onto the chunk, in which case the
        // context map is empty and reading it would skip every candidate. This
        // is the same trap as in the construction branch below, and it is what
        // stopped find_neighbours firing even once it became schedulable.
        const acc = pktField.get(f);
        if (acc) {
          lines.push(`    if (pktStore.count(${x}) == 0) ${bail()}`);
          lines.push(`    ${par.cppType} ${p} = pktOf(${x})->get${acc}()${arith};`);
        } else {
          lines.push(`    if (${f}.count(${x}) == 0) ${bail()}`);
          lines.push(`    ${par.cppType} ${p} = ${f}.at(${x})${arith};`);
        }
        resolved.add(p); progress = true; continue;
      }
      // determined: p = R[{x}] -- a relational image. Set-valued, but still
      // COMPUTED rather than searched: once x is known the image is a lookup,
      // which is what makes a set-typed parameter bindable at all.
      const img = clauses.map((c) =>
        new RegExp(`^${p}\\s*=\\s*(\\w+)\\s*\\[\\s*\\{\\s*(\\w+)\\s*\\}\\s*\\]$`).exec(c.trim())
      ).find(Boolean);
      if (img && known(img[2])) {
        const [, R, x] = img;
        lines.push(`    std::set<Node> ${p} = relImage(${R}, ${x});`);
        resolved.add(p); progress = true; continue;
      }
      // determined: p = <bare name already known, or a context constant>
      const bare = clauses.map((c) => new RegExp(`^${p}\\s*=\\s*(\\w+)$`).exec(c.trim())).find(Boolean);
      if (bare && known(bare[1])) {
        lines.push(`    ${par.cppType} ${p} = ${bare[1]};`);
        resolved.add(p); progress = true; continue;
      }
      // fresh packet
      if (isFresh(p) && par.cppType === "PktId") {
        lines.push(`    ${par.cppType} ${p} = newPktId();`);
        rollback.push(`    pktStore.erase(${p});`);
        const tag = typeOf(p);
        if (tag) {
          lines.push(`    type[${p}] = ${tag};`);
          lines.push(`    ensurePkt(${p})->setType(PktType::${tag});`);
          rollback.push(`    type.erase(${p});`);
        }
        // Any `q = g(p)` guard over an already-known q is satisfied by
        // construction too -- the model is describing the packet being made.
        for (const c of clauses) {
          const m = new RegExp(`^(\\w+)\\s*=\\s*(\\w+)\\(\\s*${p}\\s*\\)$`).exec(c.trim());
          if (m && resolved.has(m[1])) {
            // ENC7 may have MOVED this attribute onto the chunk. Writing the old
            // context map would then satisfy nothing: the guard reads the chunk.
            // Getting this wrong is why the first instrumented run fired
            // start_flooding but never create_bconPkt.
            const acc = pktField.get(m[2]);
            if (acc) {
              lines.push(`    ensurePkt(${p})->set${acc}(${m[1]});`);
            } else {
              lines.push(`    ${m[2]}[${p}] = ${m[1]};`);
              rollback.push(`    ${m[2]}.erase(${p});`);
            }
          }
        }
        resolved.add(p); progress = true; continue;
      }
      // `a ↦ b ∈ V` with V a pair-set: the pair IS the candidate, so one loop
      // binds both variables at once. This is the dominant shape in the
      // transmit and receive events -- `x ↦ pkt ∈ ndBuff` says exactly "for
      // each packet this node is holding".
      {
        const pr = clauses.map((c) =>
          new RegExp(`^(\\w+)\\s*↦\\s*(\\w+)\\s*∈\\s*(\\w+)$`).exec(c.trim())).find((m) => {
            if (!m) return false;
            const [, a, b, v] = m;
            return enc(v) === "pair-set" && (a === p || b === p)
              && !resolved.has(a) && !resolved.has(b);
          });
        if (pr) {
          const [, a, b, v] = pr;
          const ta = params.find((q) => q.name === a)?.cppType ?? "int";
          const tb = params.find((q) => q.name === b)?.cppType ?? "int";
          lines.push(`    for (auto& _pr_${a}_${b} : ${v}) {`); depth++;
          lines.push(`    ${ta} ${a} = _pr_${a}_${b}.first;`);
          lines.push(`    ${tb} ${b} = _pr_${a}_${b}.second;`);
          resolved.add(a); resolved.add(b); progress = true; continue;
        }
      }
      // `o ↦ {i ↦ v} ∈ N` on a two-level table: once o and i are known, v is a
      // lookup, not a search.
      {
        const nm = clauses.map((c) =>
          new RegExp(`^(\\w+)\\s*↦\\s*\\{\\s*(\\w+)\\s*↦\\s*${p}\\s*\\}\\s*∈\\s*(\\w+)$`).exec(c.trim()))
          .find((m) => m !== null && nestedVars.has(m[3]) && known(m[1]) && known(m[2]));
        if (nm) {
          const [, o, i, v] = nm;
          lines.push(`    if (${v}.count(${o}) == 0 || ${v}.at(${o}).count(${i}) == 0) ${bail()}`);
          lines.push(`    ${par.cppType} ${p} = ${v}.at(${o}).at(${i});`);
          resolved.add(p); progress = true; continue;
        }
      }
      // enumerated over a finite carrier
      const inSet = clauses.map((c) => new RegExp(`^${p}\\s*∈\\s*(\\w+)$`).exec(c.trim())).find(Boolean);
      if (inSet && carriers.has(inSet[1]) && inSet[1] !== "PKT") {
        lines.push(`    for (${par.cppType} ${p} : ${inSet[1]}) {`); depth++;
        resolved.add(p); progress = true; continue;
      }
      // `p ∈ S` where S is an already-bound SET parameter or a set-encoded
      // variable: the candidates are its elements. `nb ∈ nbs` -- pick one
      // neighbour out of the neighbour set find_neighbours just computed -- is
      // the shape, and without it the delivery chain stalls after one hop.
      if (inSet && (
        params.some((q) => q.name === inSet[1] && resolved.has(q.name)) ||
        enc(inSet[1]) === "set")) {
        lines.push(`    for (${par.cppType} ${p} : ${inSet[1]}) {`); depth++;
        resolved.add(p); progress = true; continue;
      }
      // An EXISTING packet -- the transmit and receive events take one the node
      // already holds, so the candidates are exactly the registry's keys. This
      // is the other half of the fresh case: dom of the packet-keyed functions
      // is pktStore, so enumerating it is enumerating the packets that exist.
      if (par.cppType === "PktId") {
        lines.push(`    for (auto& _e_${p} : pktStore) {`); depth++;
        lines.push(`    ${par.cppType} ${p} = _e_${p}.first;`);
        resolved.add(p); progress = true; continue;
      }
    }
  }

  const missing = params.filter((p) => !resolved.has(p.name)).map((p) => p.name);
  return missing.length === 0
    ? { label, params, lines, rollback, ok: true }
    : { label, params, lines, rollback, ok: false, why: `no binding for ${missing.join(", ")}` };
}

export function emitScheduler(model: EncodedMachine, cls: string, cc: string, fields: PacketField[]): { decls: string; defs: string } {
  const pktField = new Map(fields.map((f) => [f.ebName, f.name.charAt(0).toUpperCase() + f.name.slice(1)]));
  // Two-level tables, recognised the same way nestedMap.ts does.
  const nestedVars = new Set<string>();
  for (const [n, inv] of model.variableTypes)
    if (/^\s*\w+\s*∈\s*(?:\w+|ℤ)\s*(?:↔|→|⇸)\s*\(/.test(inv)) nestedVars.add(n);
  const sigs = signatures(cc, cls);
  const carriers = new Set(Object.keys(CARRIER_ALIAS));
  const plans: Plan[] = [];
  for (const ev of model.events) {
    if (ev.label === "INITIALISATION") continue;
    const sig = sigs.get(ev.label);
    if (!sig) continue;                          // not emitted as a bool method
    const plan = planFor(ev.label, sig.params, ev.guards, carriers, (id) => model.encodings.get(id), nestedVars, pktField);
    plan.method = sig.method;
    plans.push(plan);
  }

  const firable = plans.filter((p) => p.ok);
  const defs: string[] = [];
  for (const p of firable) {
    const loops = p.lines.filter((l) => l.trim().startsWith("for (")).length;
    const call = `${p.method ?? p.label}(${p.params.map((x) => x.name).join(", ")})`;
    const body = [
      ...p.lines,
      `    if (${call}) { firedCount["${p.label}"]++; return true; }`,
      ...(p.rollback.length ? p.rollback : []),
      ...Array(loops).fill("    }"),
      "    return false;",
    ];
    defs.push(`bool ${cls}::try_${p.label}()\n{\n${body.join("\n")}\n}`);
  }
  const skipped = plans.filter((p) => !p.ok);

  const runBody = firable.map((p) => `    if (try_${p.label}()) fired = true;`).join("\n");
  defs.push(
    `// One round of the Event-B operational semantics: attempt every event whose\n` +
    `// parameters this scheduler can bind, in declaration order, and report\n` +
    `// whether any fired. Called from the periodic timer.\n` +
    `bool ${cls}::runEnabledEvents()\n{\n    bool fired = false;\n${runBody}\n    return fired;\n}`,
  );

  const decls = [
    "    // ── Event scheduler (Event-B operational semantics) ──",
    "    // How many times each event actually fired. Without this the run is",
    "    // unmeasurable: a green 60s and a plausible packet count say nothing",
    "    // about whether the MODEL executed, which is the only thing under test.",
    "    std::map<std::string, long> firedCount;",
    ...firable.map((p) => `    bool try_${p.label}();`),
    ...skipped.map((p) => `    // not schedulable: ${p.label} -- ${p.why}`),
    `    bool runEnabledEvents();`,
  ].join("\n");

  return { decls, defs: defs.join("\n\n") };
}

// Splice the scheduler in, and call it from the sensing timer.
export function installScheduler(tree: GeneratedTree, model: EncodedMachine, cls: string, fields: PacketField[]): GeneratedTree {
  const ccFile = tree.find((f) => f.path.endsWith(".cc"));
  if (!ccFile) return tree;
  const { decls, defs } = emitScheduler(model, cls, ccFile.content, fields);

  return tree.map((f) => {
    if (f.path.endsWith(".h")) {
      const anchor = "  public:";
      const at = f.content.lastIndexOf(anchor);
      if (at < 0) return f;
      return { ...f, content: f.content.slice(0, at) + decls + "\n\n" + f.content.slice(at) };
    }
    if (f.path.endsWith(".cc")) {
      let content = f.content;
      // Record what fired. Without this the run is unmeasurable: a green 60s
      // and a plausible packet count say nothing about whether the MODEL
      // executed, which is the only thing under test.
      const FIN = `void ${cls}::finish() {`;
      if (content.includes(FIN))
        content = content.replace(
          FIN,
          FIN +
            '\n    for (auto& _fc : firedCount)' +
            '\n        recordScalar(("fired:" + _fc.first).c_str(), _fc.second);',
        );
      const at = content.indexOf("\nDefine_Module(");
      content = at < 0 ? content + "\n" + defs : content.slice(0, at + 1) + defs + "\n\n" + content.slice(at + 1);
      // Drive it from the timer that already exists in the shell.
      content = content.replace(
        /^(\s*)sendSensorPacket\(\);$/m,
        `$1sendSensorPacket();\n$1runEnabledEvents();   // Event-B events enabled at this tick`,
      );
      return { ...f, content };
    }
    return f;
  });
}

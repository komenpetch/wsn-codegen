// similarity_dsr.mjs -- the v4 DSR module (generated EbWsn + the pasted DSR test code)
// scored against the DSR baseline, DSRRoute.cc in this folder (design/V4_DSR_Plan.md
// section 13, Q1 c).
//
//   node similarity_dsr.mjs [<module.cc>] [--json] [--self]
//
// <module.cc> defaults to this folder's staged EbWsn.cc (the paste guide's edited/
// file). --self scores the baseline against itself, the positive control.
//
// Scope: the Final Report's printed DSRRoute functions only (Fig 6.8, plus
// selectRoute from Fig 6.9). The baseline's INET helpers and its CTL6 events are not
// scored (see NOT_SCORED). Pairing, as agreed 2026-10-28:
//   - by name: sendRREQ, sendRREP, reverseRoute, updateRouteCacheTable, selectRoute;
//   - handleLowerMsg (Fig 6.10) against v4's RREQ handler onReceiveRreqPkt followed by
//     its arrival handleLowerPacket(Packet *), which takes the RREP before the model:
//     together they do Fig 6.10's job (RREQ case first, as the figure orders it);
//   - handleUpperMsg (Fig 6.9) is not ported: v4 sends no DATA (D10).
// ⚠ Not an independent baseline: both sides were written from the same sources (Q2).
//
// Method: similarity_aodv.mjs's (statements normalised, class name mapped, LCS).
//   sym    : 2*LCS/(module+baseline)
//   recall : LCS/baseline
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const SELF = argv.includes('--self');
const modArg = argv.find(a => !a.startsWith('--'));
const BASE_FILE = path.join(HERE, 'DSRRoute.cc');
const MOD_FILE = SELF ? BASE_FILE : (modArg ?? path.join(HERE, 'EbWsn.cc'));
const BASE_CLASS = 'DSRRoute';
const MOD_CLASS = SELF ? 'DSRRoute' : 'EbWsn';

// The printed functions, in Fig 6.8's order, and what each pairs with in the module.
// A pair entry lists module functions by name and, where a name is overloaded, the
// start of its parameter list.
const PRINTED = [
  { fn: 'handleUpperMsg', module: null, why: 'not ported: v4 sends no DATA (D10)' },
  { fn: 'handleLowerMsg', module: [{ name: 'onReceiveRreqPkt' }, { name: 'handleLowerPacket', params: 'Packet' }], mixed: true },
  { fn: 'sendRREQ', module: [{ name: 'sendRREQ' }], mixed: true },
  { fn: 'sendRREP', module: [{ name: 'sendRREP' }] },
  { fn: 'reverseRoute', module: [{ name: 'reverseRoute' }] },
  { fn: 'updateRouteCacheTable', module: [{ name: 'updateRouteCacheTable' }] },
  { fn: 'selectRoute', module: [{ name: 'selectRoute' }] },
];
// The rest of DSRRoute.cc, by reason.
const NOT_SCORED = {
  'INET translation (as the MintRoute port has it)': ['dsrProtocol', 'initialize', 'sendToNextHop', 'decapsulate',
    'setDownControlInfo', 'resolveBroadcast', 'pathOf'],
  'harness recording': ['nodeIndexOf', 'finish'],
};

const read = p => fs.readFileSync(p, 'utf8');
const pct = x => (Number.isFinite(x) ? (100 * x).toFixed(1) : '--') + '%';
const log = (...a) => { if (!JSON_MODE) console.log(...a); };

function statements(src) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');
  s = s.split(MOD_CLASS).join(BASE_CLASS);
  s = s.replace(/\bvirtual\s+/g, '').replace(/\bINET_API\s+/g, '');
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+,/g, ',').replace(/\s+;/g, ';');
  const parts = s.split(/(?<=[;{}])/).map(t => t.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p === '{' && out.length) out[out.length - 1] += ' {';
    else out.push(p);
  }
  return out.filter(p => p !== '}' && p !== '{');
}

function lcs(a, b) {
  let prev = new Array(b.length + 1).fill(0), cur = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++)
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}
const metrics = (g, b) => { const L = lcs(g, b); return { gen: g.length, base: b.length, lcs: L, sym: 2 * L / (g.length + b.length), recall: L / b.length }; };

// A signature gathered across lines; the parameter list's start is kept so an
// overloaded name can be told apart.
function extractFunctions(src, cls) {
  const lines = src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/);
  const start = new RegExp(`^[^=;(]*\\b${cls}::([~\\w]+)\\s*\\(([^)]*)`);
  const fns = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(start);
    if (!m) continue;
    let depth = 0, started = false, j = i;
    const body = [];
    for (; j < lines.length; j++) {
      body.push(lines[j]);
      for (const ch of lines[j].replace(/\/\/.*$/, '')) {
        if (ch === '{') { depth++; started = true; }
        else if (ch === '}') depth--;
      }
      if (started && depth === 0) break;
    }
    fns.push({ name: m[1], params: m[2].trim(), body: body.join('\n') });
    i = j;
  }
  return fns;
}

const baseFns = extractFunctions(read(BASE_FILE), BASE_CLASS);
const modFns = extractFunctions(read(MOD_FILE), MOD_CLASS);

// Every DSRRoute.cc function must be classified, or the scope is stale.
const classified = new Set([...PRINTED.map(p => p.fn), ...Object.values(NOT_SCORED).flat()]);
const found = new Set(baseFns.map(f => f.name));
const unclassified = [...found].filter(n => !classified.has(n));
const absent = [...classified].filter(n => !found.has(n));
if (unclassified.length || absent.length)
  throw new Error(`DSRRoute.cc scope is stale -- unclassified: [${unclassified}], absent: [${absent}]`);
const dupBase = PRINTED.filter(p => baseFns.filter(f => f.name === p.fn).length !== 1).map(p => p.fn);
if (dupBase.length) throw new Error(`Overloaded baseline names: [${dupBase}]`);

// The module side of one pair: each listed function exactly once, or refuse.
function moduleBody(p) {
  if (SELF) return [baseFns.find(f => f.name === p.fn)];
  if (!p.module) return null;
  const picked = [];
  for (const want of p.module) {
    const hits = modFns.filter(f => f.name === want.name && (!want.params || f.params.startsWith(want.params)));
    if (hits.length === 0) return picked.length ? picked : null;
    if (hits.length > 1) throw new Error(`${want.name}${want.params ? `(${want.params}…)` : ''} matches ${hits.length} functions in the module`);
    picked.push(hits[0]);
  }
  return picked;
}

log(`=== ${path.basename(MOD_FILE)} (${MOD_CLASS}) vs DSRRoute.cc: the ${PRINTED.length} printed functions ===`);
const sum = () => ({ gen: 0, base: 0, lcs: 0, n: 0, same: 0 });
const all = sum(), testOnly = sum(), mixed = sum();
const perFunction = [];
for (const p of PRINTED) {
  const bs = statements(baseFns.find(f => f.name === p.fn).body);
  const mods = moduleBody(p);
  if (!mods) {
    all.base += bs.length;
    perFunction.push({ fn: p.fn, defined: false, base: bs.length, why: p.why ?? null });
    log(`${p.fn.padEnd(24)} --  not defined${p.why ? ': ' + p.why : ''}  (base=${bs.length})`);
    continue;
  }
  const ms = mods.flatMap(f => statements(f.body));
  const m = metrics(ms, bs);
  const isMixed = p.mixed && !SELF;
  for (const acc of [all, isMixed ? mixed : testOnly]) {
    acc.gen += m.gen; acc.base += m.base; acc.lcs += m.lcs; acc.n++; if (m.sym === 1) acc.same++;
  }
  const against = SELF ? '' : `  [${mods.map((f, i) => f.name + (p.module[i].params ? `(${p.module[i].params} *)` : '')).join(' + ')}]`;
  perFunction.push({ fn: p.fn, defined: true, mixed: isMixed, against: mods.map(f => f.name), gen: m.gen, base: m.base, lcs: m.lcs });
  log(`${(p.fn + (isMixed ? ' *' : '')).padEnd(24)} sym=${pct(m.sym).padStart(6)}  recall=${pct(m.recall).padStart(6)}  (module=${m.gen} base=${m.base} lcs=${m.lcs})${against}`);
}
const line = (label, a) => log(`${label}: defined ${a.n}, identical ${a.same}  sym=${pct(2 * a.lcs / (a.gen + a.base))}  recall=${pct(a.lcs / a.base)}  (module=${a.gen} base=${a.base} lcs=${a.lcs})`);
log('');
line(`All ${PRINTED.length} (an undefined one counts its baseline statements as missed)`, all);
if (!SELF) {
  line('  test code only', testOnly);
  line('  * paired with generated code (generated + pasted statements)', mixed);
}
const notScored = Object.values(NOT_SCORED).flat();
log(`\nNot scored: ${Object.entries(NOT_SCORED).map(([k, v]) => `${k}: ${v.join(', ')}`).join('; ')}`);
if (!SELF) log(`Defined in the module under a baseline helper's name, not scored: ${notScored.filter(n => modFns.some(f => f.name === n)).join(', ') || 'none'}`);

if (!JSON_MODE && !SELF) {
  console.log('\n=== BASELINE STATEMENTS NOT IN THE MODULE (per printed function) ===');
  for (const p of PRINTED) {
    const mods = moduleBody(p);
    const have = new Set(mods ? mods.flatMap(f => statements(f.body)) : []);
    const miss = statements(baseFns.find(f => f.name === p.fn).body).filter(x => !have.has(x));
    if (miss.length) { console.log(`-- ${p.fn}${mods ? '' : ' (not defined)'}: ${miss.length}`); for (const x of miss) console.log('     ' + x); }
  }
}

if (JSON_MODE)
  console.log(JSON.stringify({ module: MOD_FILE, baseline: BASE_FILE, perFunction, all, testOnly, mixed }));

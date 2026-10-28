// similarity_aodv.mjs -- the AODV test code ported into the v4 AODV module, scored
// against the baseline it was ported from, INET 4.5's Aodv.cc. design/V4_AODV_Plan.md
// section 7 ("an AODV variant of the similarity script") and Q17 ("ported code under
// INET's names, scored with --specific").
//
//   node similarity_aodv.mjs [<module.cc>] [--json] [--self]
//
// <module.cc> defaults to this folder's staged EbWsn.cc (the paste guide's edited/
// file). --self scores the baseline against itself, the positive control: every
// in-scope function must come out identical.
//
// Method: scratch/similarity_mintroute.mjs's, which is similarity_analysis.mjs's --
// statements normalised (comments and whitespace dropped, split at ; { }, class
// name mapped), compared as ordered lists by LCS.
//   sym    : 2*LCS/(module+baseline)  -- extra statements in the module lower it
//   recall : LCS/baseline             -- the share of the baseline reproduced, in order
//
// Unlike MintRoute's Specific class, which lives in its own file, the AODV test code
// is pasted into the generated class itself, so the functions are EbWsn's.
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const SELF = argv.includes('--self');
const modArg = argv.find(a => !a.startsWith('--'));
const BASE_FILE = path.join(HERE, '../inet4.5/src/inet/routing/aodv/Aodv.cc');
const MOD_FILE = SELF ? BASE_FILE : (modArg ?? path.join(HERE, 'EbWsn.cc'));
const BASE_CLASS = 'Aodv';
const MOD_CLASS = SELF ? 'Aodv' : 'EbWsn';

// The plan's 21 (section 6), in its order.
const PORTED = [
  'startRouteDiscovery', 'hasOngoingRouteDiscovery', 'completeRouteDiscovery', 'cancelRouteDiscovery',
  'handleWaitForRREP', 'createRREQ', 'sendRREQ', 'forwardRREQ', 'handleRREQ',
  'createRREP', 'sendRREP', 'forwardRREP', 'handleRREP', 'createRoute', 'updateRoutingTable',
  'createHelloMessage', 'sendHelloMessagesIfNeeded', 'handleHelloMessage',
  'handleLinkBreakSendRERR', 'createRERR', 'handleRERR',
];
// Where the test code went INTO a generated method (plan section 6: "the ported body
// goes into them"), the module's function also holds generated statements.
const INTO_GENERATED = new Set(['startRouteDiscovery', 'createRREQ', 'sendRREQ', 'handleRREQ']);
// A ported function whose job another function does, with the reason.
const MERGED = { forwardRREQ: "the model's flood rebroadcasts the RREQ through sendRREQ (Q19)" };
// The rest of Aodv.cc, not ported, by the plan's reasons (section 6).
const NOT_PORTED = {
  'data path': ['ensureRouteForDatagram', 'delayDatagram', 'datagramForwardHook', 'sendRERRWhenNoRouteToForward'],
  expiry: ['updateValidRouteLifeTime', 'scheduleExpungeRoutes', 'expungeRoutes'],
  'RREP-ACK': ['createRREPACK', 'sendRREPACK', 'handleRREPACK', 'handleRREPACKTimer'],
  'gratuitous RREP': ['createGratuitousRREP', 'sendGRREP'],
  blacklist: ['handleBlackListTimer'],
  'link-break signal (SMAC sends none)': ['receiveSignal'],
  'UDP/IP plumbing': ['sendAODVPacket', 'processPacket', 'socketDataArrived', 'socketErrorArrived',
    'socketClosed', 'getSelfIPAddress', 'checkIpVersionAndPacketTypeCompatibility'],
  'module and lifecycle': ['Aodv', '~Aodv', 'initialize', 'handleMessageWhenUp', 'handleStartOperation',
    'handleStopOperation', 'handleCrashOperation', 'clearState'],
};

const read = p => fs.readFileSync(p, 'utf8');
const pct = x => (Number.isFinite(x) ? (100 * x).toFixed(1) : '--') + '%';
const log = (...a) => { if (!JSON_MODE) console.log(...a); };

// similarity_mintroute.mjs's statements(), with the class map module -> Aodv.
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

// similarity_mintroute.mjs's extractFunctions(): a signature gathered across lines
// up to its closing parenthesis, the body to its matching brace.
function extractFunctions(src, cls) {
  const lines = src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/);
  const start = new RegExp(`^[^=;(]*\\b${cls}::([~\\w]+)\\s*\\(`);
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
    fns.push({ name: m[1], body: body.join('\n') });
    i = j;
  }
  return fns;
}

const baseFns = extractFunctions(read(BASE_FILE), BASE_CLASS);
const modFns = extractFunctions(read(MOD_FILE), MOD_CLASS);

// Every Aodv.cc method must be classified, or the scope is stale.
const classified = new Set([...PORTED, ...Object.values(NOT_PORTED).flat()]);
const found = new Set(baseFns.map(f => f.name));
const unclassified = [...found].filter(n => !classified.has(n));
const absent = [...classified].filter(n => !found.has(n));
if (unclassified.length || absent.length)
  throw new Error(`Aodv.cc scope is stale -- unclassified: [${unclassified}], absent: [${absent}]`);
const dup = PORTED.filter(n => baseFns.filter(f => f.name === n).length !== 1 || modFns.filter(f => f.name === n).length > 1);
if (dup.length) throw new Error(`Overloaded names cannot be paired by name: [${dup}]`);

log(`=== ${path.basename(MOD_FILE)} (${MOD_CLASS}) vs Aodv.cc: the ${PORTED.length} ported functions ===`);
const sum = () => ({ gen: 0, base: 0, lcs: 0, n: 0, same: 0 });
const all = sum(), testOnly = sum(), mixed = sum();
const perFunction = [];
for (const n of PORTED) {
  const b = baseFns.find(f => f.name === n);
  const bs = statements(b.body);
  const m0 = modFns.find(f => f.name === n);
  if (!m0) {
    all.base += bs.length;
    perFunction.push({ fn: n, defined: false, base: bs.length, why: MERGED[n] ?? null });
    log(`${n.padEnd(26)} --  not defined${MERGED[n] ? ': ' + MERGED[n] : ''}  (base=${bs.length})`);
    continue;
  }
  const m = metrics(statements(m0.body), bs);
  for (const acc of [all, INTO_GENERATED.has(n) && !SELF ? mixed : testOnly]) {
    acc.gen += m.gen; acc.base += m.base; acc.lcs += m.lcs; acc.n++; if (m.sym === 1) acc.same++;
  }
  perFunction.push({ fn: n, defined: true, intoGenerated: INTO_GENERATED.has(n), gen: m.gen, base: m.base, lcs: m.lcs });
  log(`${(n + (INTO_GENERATED.has(n) && !SELF ? ' *' : '')).padEnd(26)} sym=${pct(m.sym).padStart(6)}  recall=${pct(m.recall).padStart(6)}  (module=${m.gen} base=${m.base} lcs=${m.lcs})`);
}
const line = (label, a) => log(`${label}: defined ${a.n}, identical ${a.same}  sym=${pct(2 * a.lcs / (a.gen + a.base))}  recall=${pct(a.lcs / a.base)}  (module=${a.gen} base=${a.base} lcs=${a.lcs})`);
log('');
line(`All ${PORTED.length} (an undefined one counts its baseline statements as missed)`, all);
if (!SELF) {
  line('  test code only', testOnly);
  line('  * test code pasted into a generated method', mixed);
}

const notScored = Object.values(NOT_PORTED).flat();
const sameName = notScored.filter(n => modFns.some(f => f.name === n));
log(`\nNot ported (plan section 6): ${Object.entries(NOT_PORTED).map(([k, v]) => `${k}: ${v.length}`).join(', ')} = ${notScored.length}`);
if (!SELF) log(`Defined under an INET name but not a port, not scored: ${sameName.join(', ') || 'none'}`);

if (!JSON_MODE && !SELF) {
  console.log('\n=== BASELINE STATEMENTS NOT IN THE MODULE (per ported function) ===');
  for (const n of PORTED) {
    const m0 = modFns.find(f => f.name === n);
    const have = new Set(m0 ? statements(m0.body) : []);
    const miss = statements(baseFns.find(f => f.name === n).body).filter(x => !have.has(x));
    if (miss.length) { console.log(`-- ${n}${m0 ? '' : ' (not defined)'}: ${miss.length}`); for (const x of miss) console.log('     ' + x); }
  }
}

if (JSON_MODE)
  console.log(JSON.stringify({ module: MOD_FILE, baseline: BASE_FILE, perFunction,
    all: { ...all }, testOnly: { ...testOnly }, intoGenerated: { ...mixed }, sameNameNotScored: sameName }));

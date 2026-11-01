// What Agent Buddy sends to the AI, measured per function: total size, an estimate in tokens, the fixed prompt (system message)
// against the ticket data (user message), how many <ticket_data> blocks there are and how much of the data the wrappers take.
//
//   node scripts/payload-report.js <dump folder>              one table for the requests an e2e run wrote with E2E_DUMP=<folder>
//   node scripts/payload-report.js <before> <after>           the same two runs side by side (a change to what is sent)
//   node scripts/payload-report.js --fixtures                 build the requests here, from the unit-test fixtures, through the real
//                                                             pipeline and firewall (no browser): every feature that works on an
//                                                             incident, plus a long email-style ticket on a cloud and a local model
//   node scripts/payload-report.js --fixtures --root <dir>   the same, from another copy of the repository (before a change)
//   add --json to print the numbers as JSON instead of a table.
//
// Nothing is sent anywhere and nothing is written to the repository: the fixtures are bundled into the system's temp folder and
// deleted again. Token numbers use src/lib/tokens.js (an estimate on the high side, the same one the pipeline uses to fit a model).
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

/** Bundle an ES module entry (source text, resolved from the repository root) and load it as CommonJS. */
function loadBundled(contents, from = root) {
  const out = esbuild.buildSync({
    stdin: { contents, resolveDir: from, loader: 'jsx', sourcefile: 'payload-report-entry.js' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'error',
    loader: { '.js': 'jsx' },
  });
  const file = path.join(os.tmpdir(), `ab-payload-report-${process.pid}-${Date.now()}.cjs`);
  fs.writeFileSync(file, out.outputFiles[0].text);
  try {
    return require(file);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const { estimateTokens } = loadBundled("export { estimateTokens } from './src/lib/tokens.js';");

// ---- Measuring one request -------------------------------------------------------------------------------------------

const OPEN_TAG = /<ticket_data\b[^>\n]*>\n?/g;
const CLOSE_TAG = /\n?<\/ticket_data>/g;

/** Numbers for one request given as its system and user message texts. */
function measure(system, user) {
  const opens = user.match(OPEN_TAG) || [];
  const closes = user.match(CLOSE_TAG) || [];
  const lastClose = user.lastIndexOf('</ticket_data>');
  const data = lastClose >= 0 ? user.slice(0, lastClose + '</ticket_data>'.length) : '';
  const instruction = lastClose >= 0 ? user.slice(lastClose + '</ticket_data>'.length).trim() : user.trim();
  const tagChars = [...opens, ...closes].reduce((n, t) => n + t.length, 0);
  // The firewall's own rules start with this line (before and after the change).
  const rulesAt = system.search(/\n\nRules (?:set by|from) the application/);
  return {
    totalChars: system.length + user.length,
    tokens: estimateTokens(system) + estimateTokens(user) + 16,
    systemChars: system.length,
    rulesChars: rulesAt >= 0 ? system.length - rulesAt : 0,
    dataChars: data.length,
    instructionChars: instruction.length,
    blocks: opens.length,
    tagChars,
    tagShare: data.length ? tagChars / data.length : 0,
    promptLonger: system.length > data.length,
  };
}

/** One dump file of e2e/common.js: "[system]\n...\n\n[user]\n...". */
function measureDump(text) {
  const clean = text.replace(/\r\n/g, '\n');
  const at = clean.indexOf('\n\n[user]\n');
  const system = clean.slice('[system]\n'.length, at < 0 ? clean.length : at);
  const user = at < 0 ? '' : clean.slice(at + '\n\n[user]\n'.length);
  return measure(system, user);
}

function readDumps(dir) {
  const rows = {};
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) rows[name.replace(/\.txt$/, '')] = measureDump(fs.readFileSync(path.join(dir, name), 'utf8'));
  return rows;
}

// ---- Tables ------------------------------------------------------------------------------------------------------------

const pct = (x) => `${Math.round(x * 100)}%`;
const num = (n) => n.toLocaleString('en-US');

function table(rows) {
  const head = '| Function | Chars | ~Tokens | System (rules) | Data | Blocks | Tags | Tag share | Prompt > data |';
  const lines = [head, head.replace(/[^|]/g, '-').replace(/-\|/g, '-|')];
  for (const [id, r] of Object.entries(rows)) {
    lines.push(`| ${id} | ${num(r.totalChars)} | ${num(r.tokens)} | ${num(r.systemChars)} (${num(r.rulesChars)}) | ${num(r.dataChars)} | ${r.blocks} | ${num(r.tagChars)} | ${pct(r.tagShare)} | ${r.promptLonger ? 'yes' : 'no'} |`);
  }
  lines.push(summary(rows));
  return lines.join('\n');
}

function summary(rows) {
  const list = Object.values(rows);
  if (!list.length) return '';
  const sum = (k) => list.reduce((n, r) => n + r[k], 0);
  const shares = list.filter((r) => r.dataChars).map((r) => r.tagShare);
  const longer = list.filter((r) => r.promptLonger).length;
  return `\n${list.length} requests: ${num(sum('tokens'))} tokens in all (${num(Math.round(sum('tokens') / list.length))} on average), ` +
    `${num(sum('blocks'))} blocks, tag share ${shares.length ? `${pct(Math.min(...shares))}-${pct(Math.max(...shares))}` : 'n/a'}, prompt longer than the data in ${longer} of ${list.length}.`;
}

function compare(before, after) {
  const head = '| Function | ~Tokens before | ~Tokens after | Change | System before / after | Blocks before / after | Tag share before / after |';
  const lines = [head, head.replace(/[^|]/g, '-').replace(/-\|/g, '-|')];
  const ids = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  let tb = 0;
  let ta = 0;
  for (const id of ids) {
    const b = before[id];
    const a = after[id];
    if (!b || !a) {
      lines.push(`| ${id} | ${b ? num(b.tokens) : '-'} | ${a ? num(a.tokens) : '-'} | (only in one run) | | | |`);
      continue;
    }
    tb += b.tokens;
    ta += a.tokens;
    lines.push(`| ${id} | ${num(b.tokens)} | ${num(a.tokens)} | ${pct((a.tokens - b.tokens) / b.tokens)} | ${num(b.systemChars)} / ${num(a.systemChars)} | ${b.blocks} / ${a.blocks} | ${pct(b.tagShare)} / ${pct(a.tagShare)} |`);
  }
  lines.push(`\nIn both runs: ${num(tb)} -> ${num(ta)} tokens (${tb ? pct((ta - tb) / tb) : 'n/a'}).`);
  lines.push(`\nBefore:${summary(before)}`);
  lines.push(`After:${summary(after)}`);
  return lines.join('\n');
}

// ---- Requests built from the unit-test fixtures --------------------------------------------------------------------------

const FIXTURE_ENTRY = `
import { createFirewall } from './src/pii/index.js';
import { prepareRun } from './src/lib/pipeline.js';
import { FEATURES } from './src/features/registry.js';
import { FEATURE_JOURNAL, allowedFields } from './src/context/allowlists.js';
import { relatedPlan } from './src/context/related.js';
import { effectiveSettings, normalizePolicy } from './src/policy/policy.js';
import { resolveProviderConfig } from './src/providers/config.js';
import { hostilePack, hostileRead } from './tests/fixtures/itsm-hostile.js';

const restrict = (pack, id) => {
  const names = new Set(allowedFields(pack.table, id));
  const plan = relatedPlan({ kind: pack.kind, feature: id });
  return {
    ...pack,
    fields: Object.fromEntries(Object.entries(pack.fields).filter(([name]) => names.has(name))),
    journal: FEATURE_JOURNAL[id] ? pack.journal : [],
    related: Object.fromEntries(Object.entries(pack.related).filter(([key]) => plan.includes(key))),
  };
};

// A long ticket: 30 comments that came in by email, each with a signature, a legal notice and the quoted thread under it.
const SIGNATURE = '\\n\\nKind regards,\\nAbel Tuter\\nSenior Analyst | Finance Operations\\nContoso Ltd | Tel: +1 555 0134 | www.contoso.example';
const NOTICE = '\\n\\nCONFIDENTIALITY NOTICE: This e-mail and any attachments are confidential and may be privileged. If you are not the intended recipient, please notify the sender immediately and delete this message. Any unauthorised use, disclosure or copying is strictly prohibited.';
const QUOTE = (n) => '\\n\\nFrom: Service Desk <servicedesk@contoso.example>\\nSent: Monday, 26 October 2026 09:14\\nTo: Abel Tuter <abel.tuter@example.com>\\nSubject: RE: INC0010001 VPN keeps disconnecting\\n\\n' +
  'Hello Abel, we have looked at the gateway logs again and would like you to try the TCP profile and tell us whether the drops continue. '.repeat(4) +
  '\\n\\n> earlier text of update ' + n;
const longPack = () => {
  const base = hostilePack();
  const journal = [];
  for (let i = 0; i < 30; i++) {
    const day = String(1 + Math.floor(i / 3)).padStart(2, '0');
    journal.push(i % 3 === 2
      ? { when: '2026-10-' + day + ' 10:00:00', by: 'Beth Anglin', type: 'work_note', text: 'Checked gateway EU-2 again: ' + 'session resets seen in the log, certificate fine, client version 5.1. '.repeat(3) }
      : { when: '2026-10-' + day + ' 09:00:00', by: 'Abel Tuter', type: 'comment', text: ('Update ' + i + ': the VPN dropped again this morning, twice before 9am, while I was on the finance call. ').repeat(2) + SIGNATURE + NOTICE + QUOTE(i) });
  }
  return { ...base, journal: journal.map((e) => ({ ...e, text: e.text.slice(0, 1500) })) };
};
// A long ticket without clutter: 30 notes of 1,400 characters of plain text each (nothing to clean, only to fit).
const plainPack = () => {
  const base = hostilePack();
  const journal = [];
  for (let i = 0; i < 30; i++) journal.push({ when: '2026-10-' + String(1 + Math.floor(i / 2)).padStart(2, '0') + ' 09:00:00', by: i % 2 ? 'Beth Anglin' : 'Abel Tuter', type: i % 2 ? 'work_note' : 'comment', text: ('Update ' + i + ': ' + 'the VPN dropped again while on the finance call; gateway EU-2 logged session resets and the client was reinstalled. '.repeat(13)).slice(0, 1400) });
  return { ...base, journal };
};

const values = effectiveSettings({ provider: 'anthropic' }, {}).values;
const cloud = resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
const local = resolveProviderConfig({ provider: 'ollama' }, '');
const policy = normalizePolicy({});

const sent = (prepared) => ({ system: prepared.request.messages[0].content, user: prepared.request.messages[1].content });

export async function build() {
  const out = {};
  for (const feature of FEATURES.filter((f) => (f.kinds || []).includes('incident'))) {
    const base = restrict(hostilePack(), feature.id);
    const pack = feature.enrich ? await feature.enrich(base, { read: hostileRead(), allowSensitive: false }) : base;
    try {
      out[feature.id] = sent(prepareRun({ feature, pack, values, policy, config: cloud, createFirewall }));
    } catch (err) {
      out[feature.id] = { error: String(err && err.code || err && err.message || err) };
    }
  }
  const summary = FEATURES.find((f) => f.id === 'record-summary');
  const cases = [
    ['long email ticket, record-summary, cloud model', cloud, longPack],
    ['long email ticket, record-summary, Ollama (4096)', local, longPack],
    ['long plain ticket, record-summary, cloud model', cloud, plainPack],
    ['long plain ticket, record-summary, Ollama (4096)', local, plainPack],
  ];
  for (const [name, config, make] of cases) {
    try {
      out[name] = sent(prepareRun({ feature: summary, pack: restrict(make(), 'record-summary'), values, policy, config, createFirewall }));
    } catch (err) {
      out[name] = { error: String(err && err.code || err && err.message || err) };
    }
  }
  return out;
}
`;

async function fromFixtures(from = root) {
  const { build } = loadBundled(FIXTURE_ENTRY, from);
  const built = await build();
  const rows = {};
  for (const [id, r] of Object.entries(built)) {
    if (r.error) {
      console.error(`${id}: not built (${r.error})`);
      continue;
    }
    rows[id] = measure(r.system, r.user);
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  // --root <dir>: build the fixture requests from another copy of the source (a before/after comparison of one change).
  const rootAt = args.indexOf('--root');
  const from = rootAt >= 0 ? path.resolve(args[rootAt + 1]) : root;
  const dirs = args.filter((a, i) => !a.startsWith('--') && !(rootAt >= 0 && i === rootAt + 1));
  if (args.includes('--fixtures')) {
    const rows = await fromFixtures(from);
    console.log(json ? JSON.stringify(rows, null, 2) : table(rows));
    return;
  }
  if (dirs.length === 1) {
    const rows = readDumps(dirs[0]);
    console.log(json ? JSON.stringify(rows, null, 2) : table(rows));
    return;
  }
  if (dirs.length === 2) {
    const [before, after] = dirs.map(readDumps);
    console.log(json ? JSON.stringify({ before, after }, null, 2) : compare(before, after));
    return;
  }
  console.error('Usage: node scripts/payload-report.js <dump folder> [<second dump folder>] | --fixtures   [--json]');
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

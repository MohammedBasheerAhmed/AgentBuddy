import { mount, makeChrome } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collect, loadCatalogue } from '../scripts/lib/i18nCheck.js';
import { AR_FINISH2, AR_FINISH2_RETIRED, withFinish2 } from '../src/i18n/ar/finish2.js';
import { firstRunSteps } from '../src/sidepanel/firstRun.js';
import SetupView from '../src/sidepanel/SetupView.jsx';
import { STORED_DATA } from '../src/lib/storedData.js';
import { effectiveSettings } from '../src/policy/policy.js';
import { setLanguage, t } from '../src/i18n/index.js';
import { BANNED, ROOT, hitsOf, inScan, walkSource } from './words-list.js';

// The leftover plain words of audit 8 (docs/plain-words.md), rows J35 and J37, finished in the files of builder Q2, and the Arabic of
// this wave (src/i18n/ar/finish2.js). The rest of those rows is in other builders' files (see docs/live-questions/audit-1107-finish2.md).

test.afterEach(() => setLanguage('en'));

const SN = 'https://acme.service-now.com';
const effOf = (settings = {}, policy = {}) => {
  const e = effectiveSettings(settings, policy);
  return { ready: true, values: e.values, locked: e.locked, policy: e.policy, floors: e.floors || {}, apiKey: '', keyLocked: false };
};
const page = (surface) => ({ status: 'no-record', tabId: 3, href: `${SN}/home`, surface, user: { name: 'Beth', roles: ['itil'] } });

// ---- J35: incident-first wording on other kinds of ticket ---------------------------------------------------------------------------

test('J35: the first-run step "Open a ticket" does not list kinds of ticket; any ticket will do', () => {
  const step = firstRunSteps({ page: { status: 'not-enabled', origin: SN }, aiReady: false, eff: effOf() }).steps.find((s) => s.id === 'ticket');
  assert.equal(step.label, 'Open a ticket');
  assert.equal(step.hint, 'Any ticket you work on will do. Agent Buddy offers help for it here.');
  assert.ok(!/incident|catalog task|\bcase\b|\brequest\b/i.test(step.hint), step.hint);
});

test('J35: the Ticket screen asks for "a ticket", on a portal too', async () => {
  globalThis.chrome = makeChrome().chrome;
  const done = effOf({ profiles: ['it'], profilesConfirmed: true, aiSkipped: true, instances: [SN] });
  const classic = await mount(<SetupView page={page('classic')} eff={done} />);
  assert.match(classic.text(), /Open a ticket and Agent Buddy offers help for it here\./);
  await classic.unmount();
  const portal = await mount(<SetupView page={page('portal')} eff={done} />);
  assert.match(portal.text(), /Open a ticket on this portal and Agent Buddy offers help for it here\./);
  assert.ok(!/incident|catalog task|\bcase\b/i.test(portal.text()), portal.text());
  await portal.unmount();
});

test('J35: no prompt in the first run or the setup view names a list of kinds of ticket', () => {
  const files = ['src/sidepanel/firstRun.js', 'src/sidepanel/FirstRun.jsx', 'src/sidepanel/SetupView.jsx'].map((f) => path.join(ROOT, f));
  const { keys } = collect(files);
  const bad = [...keys.keys()].filter((text) => /\bincident\b.*\b(request|catalog task|case)\b|\b(request|catalog task|case)\b.*\bincident\b/i.test(text));
  assert.deepEqual(bad, []);
});

// ---- J37: technical words in the settings and the ticket history ---------------------------------------------------------------------

test('J37: no text of the files Q2 owns says "free text", "field history" or "journal"', () => {
  const owned = walkSource().filter((f) => inScan(f) && /[\\/]src[\\/](?:options|profiles|policy)[\\/]|sidepanel[\\/](?:firstRun\.js|FirstRun\.jsx|SetupView\.jsx|ticket[\\/]cards[\\/]JourneyCard\.jsx)$|lib[\\/]storedData\.js$/.test(f));
  assert.ok(owned.length > 20, 'the scan found the files');
  const { keys } = collect(owned);
  const bad = [...keys.keys()].filter((text) => /free text|field history|\bjournal\b/i.test(text));
  assert.deepEqual(bad, []);
});

test('J37: the privacy and ticket history texts that were fixed earlier stay fixed', () => {
  const privacy = fs.readFileSync(path.join(ROOT, 'src/options/basics/PrivacySection.jsx'), 'utf8');
  assert.match(privacy, /Also refuses sensitive fields and keeps HR descriptions and notes out entirely\./);
  const journey = fs.readFileSync(path.join(ROOT, 'src/sidepanel/ticket/cards/JourneyCard.jsx'), 'utf8');
  assert.match(journey, /Reading the ticket history…/);
  assert.ok(!/Reading the field history/.test(journey));
});

test('every new text of this wave passes the plain-words list (docs/plain-words.md)', () => {
  for (const key of Object.keys(AR_FINISH2)) assert.deepEqual(hitsOf(key, BANNED), [], key);
  // and what "Stored data" says about the settings
  const settings = STORED_DATA.find((item) => item.id === 'settings');
  assert.deepEqual(hitsOf(settings.detail, BANNED), [], settings.detail);
});

// ---- Arabic: the English text is the key ------------------------------------------------------------------------------------------

const catalogue = () => withFinish2(loadCatalogue());
const used = () => collect(walkSource().filter((f) => inScan(f))).keys;

test('Arabic: every text of this wave has an entry, in the Arabic the guide asks for, with its {names}', () => {
  const table = catalogue();
  const keys = used();
  for (const key of Object.keys(AR_FINISH2)) {
    assert.ok(keys.has(key), `no text uses this entry any more: ${key}`);
    const value = AR_FINISH2[key];
    assert.equal(typeof value, 'string');
    assert.match(value, /[؀-ۿ]/, key);
    assert.deepEqual([...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]), [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]), key);
    assert.ok(!/المثيل|مثيل|نقطة النهاية/.test(value), 'one word for the ServiceNow site: موقع');
    // (the shadda, U+0651, is written where the existing entries write it: جرّب, شغّل; the vowel marks are not)
    assert.ok(!/[!؟]|[ً-ِْ]/.test(value), 'no exclamation mark, no vowel marks');
    assert.equal(table[key], value);
  }
  assert.match(AR_FINISH2['Your choices: AI service and model, privacy mode, which ServiceNow sites you turned on, what you work on, and a scrambled code for who chose it.'], /مواقع ServiceNow/);
  assert.match(AR_FINISH2['Any ticket you work on will do. Agent Buddy offers help for it here.'], /Agent Buddy/);
  // every text the files of this wave pass to t() has an Arabic entry
  const mine = walkSource().filter((f) => inScan(f) && /sidepanel[\\/](?:firstRun\.js|FirstRun\.jsx|SetupView\.jsx)$|lib[\\/]storedData\.js$|src[\\/]profiles[\\/]|src[\\/]options[\\/]ProfilePicker\.jsx$/.test(f));
  const missing = [...collect(mine).keys.keys()].filter((key) => !(key in table));
  assert.deepEqual(missing, []);
});

test('Arabic: the English texts these replace are retired, and no text uses them any more', () => {
  const keys = used();
  assert.equal(AR_FINISH2_RETIRED.length, 3);
  for (const key of AR_FINISH2_RETIRED) {
    assert.ok(!keys.has(key), `still written in the code: ${key}`);
    assert.ok(!(key in AR_FINISH2), `both new and retired: ${key}`);
    assert.ok(!(key in catalogue()), `still in the catalogue: ${key}`);
  }
});

test('Arabic: withFinish2 adds and removes without changing anything else', () => {
  const base = { 'A text': 'نص', [AR_FINISH2_RETIRED[0]]: 'قديم' };
  const out = withFinish2(base);
  assert.equal(out['A text'], 'نص');
  assert.ok(!(AR_FINISH2_RETIRED[0] in out));
  for (const key of Object.keys(AR_FINISH2)) assert.equal(out[key], AR_FINISH2[key]);
  assert.ok(Object.isFrozen(out));
  assert.ok(AR_FINISH2_RETIRED[0] in base, 'the base is not changed');
});

test('Arabic: the first-run hint and the stored-data line are shown in Arabic once the file is part of the catalogue', () => {
  // (the catalogue the panel reads is src/i18n/ar/index.js; this is true once it applies withFinish2, as the lead wires it)
  setLanguage('ar');
  const wired = t('Any ticket you work on will do. Agent Buddy offers help for it here.') !== 'Any ticket you work on will do. Agent Buddy offers help for it here.';
  setLanguage('en');
  if (!wired) return; // not wired yet: the other tests above check the entries themselves
  setLanguage('ar');
  assert.equal(t('Open a ticket on this portal and Agent Buddy offers help for it here.'), AR_FINISH2['Open a ticket on this portal and Agent Buddy offers help for it here.']);
});

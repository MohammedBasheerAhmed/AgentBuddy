import { mount, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { callerLanguage, languageOfText, recommendEmails, replyLanguage } from '../src/compose/emailRecommend.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { setLanguage } from '../src/i18n/index.js';
import EmailCard from '../src/sidepanel/ticket/cards/EmailCard.jsx';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';

// Round 4 (docs/round4.md), the Reply row ("Which email fits", the row's only card): the language the caller writes in, the one Draft a
// reply will write in for the setting "Language of AI answers", and what is checked before a reply is sent. No new button.

const AR_TEXT = 'لا أستطيع الاتصال بالشبكة الافتراضية منذ الصباح';
const EN_TEXT = 'I cannot connect to the VPN since this morning';
const people = [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }, { role: 'assigned_to', name: 'Beth Anglin' }];
const packOf = ({ journal = [], description = '', title = '' } = {}) => ({
  table: 'incident', sysId: 'a'.repeat(32), number: 'INC0010001', kind: 'incident',
  fields: { number: 'INC0010001', short_description: title, description, state: 'In Progress' },
  people, journal, related: {}, access: [],
});
const comment = (by, text, when = '2026-11-05 10:00:00') => ({ type: 'comment', by, text, when });

// ---- The caller's language ------------------------------------------------------------------------------------------------------

test('the language of one text: Arabic by its letters, English by its letters and common words, else not known', () => {
  assert.equal(languageOfText(AR_TEXT), 'ar');
  assert.equal(languageOfText(EN_TEXT), 'en');
  assert.equal(languageOfText('Je ne peux pas me connecter au VPN depuis ce matin'), '', 'French is not English');
  assert.equal(languageOfText('VPN'), '');
  assert.equal(languageOfText(''), '');
  assert.equal(languageOfText(`${AR_TEXT} ${EN_TEXT}`), '', 'half and half: not said');
});

test("the caller's language comes from the caller's latest comment, then the description, then the title", () => {
  const latest = packOf({ journal: [comment('Abel Tuter', EN_TEXT, '2026-11-04 09:00:00'), comment('Beth Anglin', 'We are looking at it.'), comment('Abel Tuter', AR_TEXT)], description: EN_TEXT });
  assert.equal(callerLanguage(latest), 'ar', "the caller's latest comment decides");
  const agentLast = packOf({ journal: [comment('Abel Tuter', AR_TEXT), comment('Beth Anglin', 'Hello Abel, we are checking the VPN gateway for you.')] });
  assert.equal(callerLanguage(agentLast), 'ar', "the agent's own comment is not the caller's language");
  assert.equal(callerLanguage(packOf({ description: AR_TEXT, title: 'VPN down' })), 'ar', 'no comment from the caller: the description');
  assert.equal(callerLanguage(packOf({ description: '', title: EN_TEXT })), 'en', 'no description: the title');
  assert.equal(callerLanguage(packOf({ description: 'Bonjour, le VPN ne marche pas depuis ce matin' })), '');
  assert.equal(callerLanguage(null), '');
  assert.equal(callerLanguage({ journal: 'nonsense', fields: null }), '');
});

// ---- The sentence, for each setting --------------------------------------------------------------------------------------------------

test('"Language of AI answers" = the language of the ticket (the default): the draft follows the caller', () => {
  assert.deepEqual(replyLanguage({ caller: 'ar', setting: 'ticket', panel: 'en' }), {
    reply: 'ar',
    fact: 'The caller writes in Arabic. Draft a reply writes in Arabic too, unless you choose English.',
    line: 'the caller writes in Arabic',
  });
  assert.deepEqual(replyLanguage({ caller: 'ar', panel: 'en' }), replyLanguage({ caller: 'ar', setting: 'ticket', panel: 'en' }), 'ticket is the default');
  assert.deepEqual(replyLanguage({ caller: 'ar', setting: 'something old', panel: 'en' }).reply, 'ar', 'an unknown setting acts as the default');
  assert.deepEqual(replyLanguage({ caller: 'en', setting: 'ticket', panel: 'ar' }), {
    reply: 'en',
    fact: 'The caller writes in English. Draft a reply writes in English too, unless you choose Arabic.',
    line: 'the caller writes in English',
  });
});

test('"Language of AI answers" = the language of the panel: the draft is in the panel\'s language, and the sentence says it is the setting', () => {
  assert.deepEqual(replyLanguage({ caller: 'ar', setting: 'panel', panel: 'en' }), {
    reply: 'en',
    fact: 'The caller writes in Arabic. Draft a reply writes in English (your setting).',
    line: 'the caller writes in Arabic',
  });
  assert.deepEqual(replyLanguage({ caller: 'en', setting: 'panel', panel: 'ar' }), {
    reply: 'ar',
    fact: 'The caller writes in English. Draft a reply writes in Arabic (your setting).',
    line: 'the caller writes in English',
  });
});

test('nothing is said when the caller writes in the panel\'s language or it is not known; without AI only the caller\'s language', () => {
  for (const setting of ['ticket', 'panel']) {
    assert.deepEqual(replyLanguage({ caller: 'en', setting, panel: 'en' }), { reply: 'en', fact: '', line: '' });
    assert.deepEqual(replyLanguage({ caller: 'ar', setting, panel: 'ar' }), { reply: 'ar', fact: '', line: '' });
    assert.deepEqual(replyLanguage({ caller: '', setting, panel: 'en' }), { reply: '', fact: '', line: '' });
  }
  assert.equal(replyLanguage({ caller: 'ar', panel: 'en', ai: false }).fact, 'The caller writes in Arabic.');
  assert.equal(replyLanguage({ caller: 'en', panel: 'ar', ai: false }).fact, 'The caller writes in English.');
  assert.equal(replyLanguage({ caller: 'ar', panel: 'en', ai: false }).line, 'the caller writes in Arabic');
});

test('in an Arabic panel the sentences are Arabic', () => {
  setLanguage('ar');
  try {
    const said = replyLanguage({ caller: 'en', setting: 'ticket', panel: 'ar' });
    assert.equal(said.fact, 'يكتب المتصل بالإنجليزية. وتكون مسودة الرد بالإنجليزية أيضا، ما لم تختر العربية.');
    assert.equal(said.line, 'المتصل يكتب بالإنجليزية');
  } finally {
    setLanguage('en');
  }
});

test('the suggestions themselves are unchanged: the language is not one of the recommender\'s facts', () => {
  const pack = packOf({ journal: [comment('Abel Tuter', AR_TEXT)], description: AR_TEXT });
  const rec = recommendEmails(pack, { now: Date.parse('2026-11-06T10:00:00Z') });
  assert.ok(!rec.facts.some((f) => /Arabic|English/.test(f)));
});

// ---- On the card --------------------------------------------------------------------------------------------------------------------

const record = { table: 'incident', sysId: 'a'.repeat(32), number: 'INC0010001', kind: 'incident' };
let tab = 700;
const pageFor = () => ({ status: 'record', tabId: (tab += 1), href: `https://acme.service-now.com/incident.do?sys_id=${record.sysId}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } });
const effOf = (answerLanguage, policy = {}) => ({ ready: true, values: { profiles: ['it'], answerLanguage }, locked: {}, policy: normalizePolicy(policy) });

async function showCard({ callerText, answerLanguage = 'ticket', policy = {} }) {
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('glance', () => ({
    pack: packOf({ journal: [comment('Abel Tuter', callerText)], description: callerText, title: 'VPN' }),
    slas: { items: [], access: [{ source: 'task_sla', status: 'empty' }] },
    vip: { status: 'no', access: [] },
    outage: null,
  }));
  let summary = '';
  const ui = await mount(<EmailCard page={pageFor()} eff={effOf(answerLanguage, policy)} record={record} active setSummary={(s) => (summary = s)} setAttention={() => {}} />);
  await settle(6);
  return { ui, summary: () => summary };
}

test('the card: an Arabic caller in an English panel, for each setting; the row line names the language; the check is described', async () => {
  for (const [setting, sentence] of [
    ['ticket', 'The caller writes in Arabic. Draft a reply writes in Arabic too, unless you choose English.'],
    ['panel', 'The caller writes in Arabic. Draft a reply writes in English (your setting).'],
  ]) {
    const { ui, summary } = await showCard({ callerText: AR_TEXT, answerLanguage: setting });
    try {
      const text = ui.text();
      assert.ok(text.includes(`Language ${sentence}`), `${setting}: ${text}`);
      assert.ok(text.includes('Before it is sent Checked: internal words · a next step · the tone'));
      assert.match(summary(), /^.+ fits best · the caller writes in Arabic$/, summary());
      assert.deepEqual(ui.container.querySelectorAll('button').map((b) => b.textContent.trim()), ['Copy email', 'Open the email form'], 'no new button');
    } finally {
      await ui.unmount();
    }
  }
});

test('the card: an English caller in an English panel: no language line, no change to the row line; the check is still described', async () => {
  const { ui, summary } = await showCard({ callerText: EN_TEXT });
  try {
    assert.ok(!/The caller writes in/.test(ui.text()));
    assert.ok(ui.text().includes('Before it is sent'));
    assert.match(summary(), /fits best$/);
  } finally {
    await ui.unmount();
  }
});

test('the card: with Draft a reply turned off by the organisation, only the caller\'s language is said', async () => {
  const { ui } = await showCard({ callerText: AR_TEXT, policy: { disabledFeatures: ['reply-draft'] } });
  try {
    assert.ok(ui.text().includes('Language The caller writes in Arabic.'));
    assert.ok(!/Draft a reply writes/.test(ui.text()));
  } finally {
    await ui.unmount();
  }
});

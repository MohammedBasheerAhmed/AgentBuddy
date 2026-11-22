// zt. "What goes in" in the check before sending (round 5, board F, docs/round5.md): the groups of a request that can be left out, driven
//     through the real panel. Untick the customer comments: the readable view and the exact text lose them (the seeded prompt-injection
//     comment included), the AI is not asked yet, the request says it was the person's choice, "Remember this" keeps it for the action in
//     the settings, the next run starts with it applied, and what was sent to the AI server really lacks the comments. Strict for this one
//     can be chosen. Nothing is sent before Send.
const { clickButton, waitForText, textOf, waitForRecord, openHalf } = require('../ui.js');

const SETTINGS_KEY = 'agentbuddy_settings';

module.exports = {
  id: 'zt',
  title: 'What goes in: leave a group out before sending, remember it per action, Strict for one request',
  timeoutMs: 120000,
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    await ctx.ensureEnabled();
    inst.setBehaviour();
    await ctx.configure(
      { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', previewMode: 'always', previewSeen: [], aiLeaveOut: {}, instances: [inst.origin] },
      { key: { provider: 'custom', value: ai.key } }
    );
    await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-leaveout');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForRecord(p);
    await waitForText(p, 'VPN keeps disconnecting', { timeout: 15000 }).catch(() => {});
    await openHalf(p, 'assist');

    const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
    const storedLeaveOut = async () => (await ctx.ext(async (key) => (await chrome.storage.local.get(key))[key]?.aiLeaveOut ?? null, SETTINGS_KEY)) || {};
    const choices = () =>
      p.evaluate(() =>
        [...document.querySelectorAll('.ab-choices .ab-choice')].map((c) => ({ text: c.innerText.replace(/\s+/g, ' ').trim(), checked: c.querySelector('input')?.checked === true, id: c.querySelector('input')?.id || '' }))
      );
    const tick = async (re) => {
      const target = (await choices()).find((c) => re.test(c.text));
      if (!target) throw new Error(`no choice matching ${re}`);
      await p.click(`#${target.id}`);
      await settle();
    };
    const exactText = async () => {
      const open = await p.evaluate(() => Boolean(document.querySelector('.ab-preview-exact')));
      if (!open) await clickButton(p, /^Show the exact text/);
      return (await textOf(p, '.ab-preview-exact')) || '';
    };

    // ---- 1. the check opens with the choices the request really holds ---------------------------------------------------------------
    await clickButton(p, /^Summarise this ticket/);
    await p.waitForSelector('.ab-dialog .ab-choices', { timeout: 15000 });
    const first = await choices();
    const commentsChoice = first.find((c) => /Comments to the customer/.test(c.text));
    t.check('the check lists what can be left out: the comments of this ticket, with how many, ticked', Boolean(commentsChoice) && commentsChoice.checked && /\(\d+\)/.test(commentsChoice.text), JSON.stringify(first));
    t.check('...and says the ticket\'s own details always go', /always go/.test((await textOf(p, '.ab-choices')) || ''));
    t.check('...and offers Strict for this one, off', first.some((c) => /Strict privacy for this one/.test(c.text) && !c.checked));
    const before = await exactText();
    t.check('before any choice the exact text carries the comments, the seeded prompt-injection one included', /charged twice/.test(before) && /Ignore all previous instructions/.test(before));
    t.check('nothing was sent yet', ai.requests.length === 0, `${ai.requests.length} requests`);

    // ---- 2. untick: the request is built again without them ---------------------------------------------------------------------------
    await tick(/Comments to the customer/);
    const after = await exactText();
    const sentView = (await textOf(p, '.ab-sent')) || '';
    t.check('unticked: the comments are gone from the readable view and from the exact text', !/charged twice/.test(sentView + after) && !/Ignore all previous instructions/.test(after), after.replace(/\s+/g, ' ').slice(0, 160));
    t.check('...the ticket\'s own details are still there', /INC0010001/.test(sentView) && /VPN keeps disconnecting/.test(sentView));
    t.check('...and the request tells the model it was the person\'s choice, not an empty list', /Comments to the customer: The person chose to leave this out/.test(after), after.replace(/\s+/g, ' ').slice(-260));
    t.check('...the tick shows it, and nothing was sent', (await choices()).find((c) => /Comments to the customer/.test(c.text))?.checked === false && ai.requests.length === 0);
    t.check('...the dialog is the same one (no flash of a new dialog, the focus stays inside it)', await p.evaluate(() => document.querySelectorAll('.ab-dialog').length === 1 && document.querySelector('.ab-dialog')?.contains(document.activeElement)));
    t.check('nothing is kept yet: a choice is for this request until "Remember" is ticked', Object.keys(await storedLeaveOut()).length === 0, JSON.stringify(await storedLeaveOut()));

    // ---- 3. remember it for this action -------------------------------------------------------------------------------------------
    await tick(/Remember this for/);
    await ctx.waitUntil('the choice to be kept', async () => (await storedLeaveOut())['record-summary']?.join() === 'comments', { timeout: 5000 });
    t.check('"Remember this for Summarise this ticket" keeps the group for that action in the settings (a setting, no ticket text)', JSON.stringify(await storedLeaveOut()) === JSON.stringify({ 'record-summary': ['comments'] }), JSON.stringify(await storedLeaveOut()));

    // ---- 4. send: the AI server never sees the comments ---------------------------------------------------------------------------
    await clickButton(p, /^Send to AI/);
    await p.waitForSelector('.ab-output, .ab-note-danger', { timeout: 15000 });
    const body = JSON.stringify(ai.requests[0]?.body || {});
    t.check('one request reached the AI server, and it holds neither comment', ai.requests.length === 1 && !/charged twice/.test(body) && !/Ignore all previous/.test(body) && /VPN keeps disconnecting/.test(body), `${ai.requests.length} requests`);
    await ctx.waitUntil('"Made without" under the answer', async () => /left out by you/.test(await panel.text()), { timeout: 5000 }).catch(() => {});
    t.check('the answer says what it was made without, in the person\'s words', /Comments to the customer \(left out by you\)/.test(await panel.text()), (await panel.text()).replace(/\s+/g, ' ').slice(0, 200));

    // ---- 5. the next run starts with it applied ----------------------------------------------------------------------------------------
    await clickButton(p, /^Summarise this ticket/);
    await p.waitForSelector('.ab-dialog .ab-choices', { timeout: 15000 });
    const again = await choices();
    t.check('next time the check opens with the comments already unticked and "Remember" ticked', again.find((c) => /Comments to the customer/.test(c.text))?.checked === false && again.find((c) => /Remember this for/.test(c.text))?.checked === true, JSON.stringify(again));
    t.check('...and the exact text lacks them from the start', !/charged twice/.test(await exactText()));

    // ---- 6. put it back: with "Remember" ticked the setting is forgotten, and Strict for this one --------------------------------------
    await tick(/Comments to the customer/);
    await ctx.waitUntil('the kept choice to go', async () => Object.keys(await storedLeaveOut()).length === 0, { timeout: 5000 });
    t.check('putting the group back puts the comments back in the request and forgets the kept choice', /charged twice/.test(await exactText()) && Object.keys(await storedLeaveOut()).length === 0);
    await tick(/Strict privacy for this one/);
    t.check('Strict for this one can be chosen: ticked, no "not possible" message, still one dialog', (await choices()).find((c) => /Strict privacy/.test(c.text))?.checked === true && !((await textOf(p, '.ab-choice-problem')) || '').trim() && (await p.evaluate(() => document.querySelectorAll('.ab-dialog').length)) === 1);
    t.check('...and nothing more was sent', ai.requests.length === 1, `${ai.requests.length} requests`);
    await clickButton(p, /^Cancel/);
    await p.waitForFunction(() => !document.querySelector('.ab-dialog'), { timeout: 5000 });
    t.check('Cancel closes the check and sends nothing', ai.requests.length === 1);
  },
};

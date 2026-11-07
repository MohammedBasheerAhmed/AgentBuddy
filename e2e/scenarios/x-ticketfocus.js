// x. The Ticket screen in the focus layout (docs/focus-layout.md, 2026-11-05, after the leaders' "too many features, cluttered"): the compact
//    ticket, then Insights | AI Assist, each with FIVE rows, one per pain point (understand the ticket, find the fix, the same caller,
//    reply, close well); everything else is one step away in All tools ("More for this ticket" at the end of each half, or the header
//    button). The new caller briefing goes through the same check before sending (no name reaches the AI). The side rail is off unless
//    Settings turns it on; then it lists the five and "All tools".
const { clickButton, textOf, waitForRecord, openHalf, chooseTool } = require('../ui.js');
const { findLeaks } = require('../leaks.js');

const PAINS = ['understand', 'fix', 'caller', 'reply', 'close'];
const groups = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll('li.ab-ins-pain[data-group]')]
      .filter((li) => li.getClientRects().length > 0)
      .map((li) => ({ id: li.getAttribute('data-group'), title: li.querySelector('.ab-ins-pain-title')?.innerText.trim() || '', line: li.querySelector('.ab-ins-pain-line')?.innerText.trim() || '', open: li.querySelector('.ab-ins-group-row')?.getAttribute('aria-expanded') === 'true', dot: Boolean(li.querySelector('.ab-ins-tile-dot.is-warn, .ab-ins-tile-dot.is-danger')) }))
  );
const fiveActions = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll('li.ab-act-item[data-pain]')]
      .filter((li) => li.getClientRects().length > 0)
      .map((li) => ({ pain: li.getAttribute('data-pain'), feature: li.querySelector('button[data-feature]')?.getAttribute('data-feature'), primary: Boolean(li.querySelector('.ab-act-primary')), disabled: Boolean(li.querySelector('button[data-feature]')?.disabled) }))
  );
const moreButton = (p) => p.evaluate(() => [...document.querySelectorAll('button.ab-more-tools')].find((b) => b.getClientRects().length > 0)?.innerText.trim() || '');
const allTools = (p) =>
  p.evaluate(() => {
    const d = [...document.querySelectorAll('.ab-palette')].find((e) => e.getClientRects().length > 0);
    if (!d) return null;
    const active = d.querySelector('[role=option][aria-selected="true"]');
    return { groups: [...d.querySelectorAll('.ab-palette-section[data-group]')].map((g) => g.getAttribute('data-group')), activeGroup: active?.closest('.ab-palette-section')?.getAttribute('data-group') || '', ids: [...d.querySelectorAll('[role=option]')].map((o) => o.getAttribute('data-command')) };
  });
const closeAllTools = async (p, ctx) => {
  await p.keyboard.press('Escape');
  await ctx.waitUntil('All tools to close', async () => (await allTools(p)) === null, { timeout: 5000 });
};
const railItems = (p) => p.evaluate(() => [...document.querySelectorAll('.ab-rail .ab-rail-item')].filter((b) => !b.classList.contains('ab-rail-names')).map((b) => b.getAttribute('data-rail-id')));

module.exports = {
  id: 'x',
  title: 'Ticket screen, focus layout: five per tab (one per pain point), the rest in All tools, the caller briefing behind the same check, the rail when turned on',
  timeoutMs: 180000,
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.ensureEnabled();
    // Everything this scenario relies on, so it also runs alone (an earlier scenario confirms the work profiles in a full run).
    await ctx.configure(
      { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', previewMode: 'always', previewSeen: [], instances: [inst.origin], quickPins: {}, pageBar: false, aiSkipped: false, profiles: ['it'], profilesConfirmed: true, railShow: false, railNames: false, halves: {} },
      { key: { provider: 'custom', value: ai.key } }
    );

    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-focus');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForRecord(p);
    await openHalf(p, 'insights');
    await ctx.waitUntil('the five rows', async () => (await groups(p)).length === 5, { timeout: 15000 });
    await p.waitForSelector('.ab-glance-more', { timeout: 15000 }); // the details come with the ticket's read

    // ---- 1. The top --------------------------------------------------------------------------------------------------------------
    const top = await p.evaluate(() => {
      const tab = document.querySelector('[role=tab][id$="-half-tab-insights"]');
      const more = document.querySelector('.ab-glance-more');
      return {
        gone: ['.ab-quick', '.ab-next', '.ab-needs', '.ab-next-btn', '.ab-rail'].filter((s) => document.querySelector(s)),
        switchTop: tab ? Math.round(tab.getBoundingClientRect().top) : -1,
        more: more ? more.getAttribute('aria-expanded') : null,
        details: [...document.querySelectorAll('.ab-glance-details')].some((d) => d.getClientRects().length > 0),
      };
    });
    t.check('no quick bar, no main step, no "Needs you now" block and (by default) no side rail', top.gone.length === 0, JSON.stringify(top.gone));
    t.check('Insights | AI Assist starts high up, under the compact ticket (within the first 260 px)', top.switchTop > 0 && top.switchTop < 260, String(top.switchTop));
    t.check('the other facts of the ticket are folded behind "Ticket details"', top.more === 'false' && !top.details, JSON.stringify(top));

    // ---- 2. Insights: five rows ---------------------------------------------------------------------------------------------------
    await ctx.waitUntil('the rows to have their lines', async () => (await groups(p)).filter((g) => g.line).length >= 4, { timeout: 15000 }).catch(() => {});
    let g = await groups(p);
    t.check('Insights shows five rows, one per pain point, in order', JSON.stringify(g.map((x) => x.id)) === JSON.stringify(PAINS), JSON.stringify(g.map((x) => x.id)));
    t.check('...named for the pain point: Understand the ticket, Find the fix, Same caller, Reply, Close well', JSON.stringify(g.map((x) => x.title)) === JSON.stringify(['Understand the ticket', 'Find the fix', 'Same caller', 'Reply', 'Close well']), JSON.stringify(g.map((x) => x.title)));
    t.check('...each with a one-line answer, all folded', g.filter((x) => x.line).length >= 4 && g.every((x) => !x.open), JSON.stringify(g.map((x) => [x.id, x.line])));
    const tabCount = () => p.evaluate(() => document.querySelector('[role=tab][id$="-half-tab-insights"]')?.innerText.replace(/\D+/g, '') || '0');
    // A row finishes loading after the first read (the dots and the tab's number are two reads): wait for them to agree, then judge.
    await ctx.waitUntil('the number on the Insights tab to match the rows that need a look', async () => Number(await tabCount()) === (await groups(p)).filter((x) => x.dot).length, { timeout: 8000 }).catch(() => {});
    g = await groups(p);
    const count = await tabCount();
    t.check('the number on the Insights tab counts the rows that need a look', Number(count) === g.filter((x) => x.dot).length, JSON.stringify({ count, dots: g.filter((x) => x.dot).map((x) => x.id) }));
    t.check('the Insights half carries no AI mark', (await p.evaluate(() => [...document.querySelectorAll('[id$="-half-panel-insights"] .ab-ai-badge')].filter((e) => e.getClientRects().length > 0).length)) === 0);

    await p.click('li[data-group="fix"] .ab-ins-group-row');
    await ctx.waitUntil('Find the fix to open', async () => (await groups(p)).find((x) => x.id === 'fix')?.open, { timeout: 5000 });
    const fixCards = await p.evaluate(() => [...document.querySelectorAll('li[data-group="fix"] [data-card]')].filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute('data-card')));
    t.check('"Find the fix" opens in place: the steps that worked before and the knowledge for this ticket', ['steps', 'knowledge'].every((id) => fixCards.includes(id)), JSON.stringify(fixCards));
    await p.click('li[data-group="caller"] .ab-ins-group-row');
    await ctx.waitUntil('the caller\'s earlier tickets', async () => /Earlier tickets from Abel Tuter/.test((await textOf(p, 'li[data-group="caller"] [data-card="caller"]')) || ''), { timeout: 15000 }).catch(() => {});
    const caller = (await textOf(p, 'li[data-group="caller"] [data-card="caller"]')) || '';
    t.check('"Same caller" lists the caller\'s earlier tickets (read locally, so the real name is fine on screen)', /Earlier tickets from Abel Tuter/.test(caller) && /INC\d{7}/.test(caller), caller.replace(/\s+/g, ' ').slice(0, 300));
    t.check('nothing went to the AI while Insights loaded', ai.requests.length === 0, String(ai.requests.length));

    // "More for this ticket" and All tools: the rest of the cards.
    const moreIns = await moreButton(p);
    t.check('Insights ends with "More for this ticket: N Insights"', /^More for this ticket: \d+ Insights?$/.test(moreIns), moreIns);
    await p.evaluate(() => [...document.querySelectorAll('button.ab-more-tools')].find((b) => b.getClientRects().length > 0).click());
    await ctx.waitUntil('All tools', async () => Boolean(await allTools(p)), { timeout: 5000 });
    let tools = await allTools(p);
    t.check('...it opens All tools at "More for this ticket: Insights"', tools.activeGroup === 'ticket-insights' && tools.ids.includes('run:show:related') && tools.ids.includes('run:show:missing'), JSON.stringify(tools));
    t.check('...where none of the five rows\' cards is repeated', !['run:show:steps', 'run:show:knowledge', 'run:show:caller', 'run:show:email', 'run:show:resolve', 'run:show:journey'].some((id) => tools.ids.includes(id)), JSON.stringify(tools.ids));
    await closeAllTools(p, ctx);
    await chooseTool(p, /^Related tickets$/);
    await ctx.waitUntil('Related tickets alone', () => p.evaluate(() => [...document.querySelectorAll('.ab-ins-focus-title')].some((h) => h.getClientRects().length > 0 && h.innerText.trim() === 'Related tickets')), { timeout: 10000 });
    t.check('a card from All tools shows alone in Insights, with Back; the five are out of the way; nothing sent', (await p.evaluate(() => [...document.querySelectorAll('.ab-ins-back')].some((b) => b.getClientRects().length > 0))) && (await groups(p)).length === 0 && ai.requests.length === 0);
    await p.evaluate(() => [...document.querySelectorAll('.ab-ins-back')].find((b) => b.getClientRects().length > 0).click());
    await ctx.waitUntil('the five again', async () => (await groups(p)).length === 5, { timeout: 5000 });
    t.check('Back brings the five rows back', true);

    // ---- 3. AI Assist: five rows --------------------------------------------------------------------------------------------------
    await openHalf(p, 'assist');
    await ctx.waitUntil('the five AI rows', async () => (await fiveActions(p)).length === 5, { timeout: 10000 });
    let acts = await fiveActions(p);
    t.check('AI Assist shows five actions, one per pain point', JSON.stringify(acts.map((x) => x.pain)) === JSON.stringify(PAINS), JSON.stringify(acts));
    t.check('...Summarise, Next best action, the caller briefing, Draft a reply, Prepare to close', JSON.stringify(acts.map((x) => x.feature)) === JSON.stringify(['record-summary', 'next-best-action', 'caller-briefing', 'reply-draft', 'prepare-close']), JSON.stringify(acts.map((x) => x.feature)));
    t.check('...one filled "Start": the reply, for a ticket in progress', JSON.stringify(acts.filter((x) => x.primary).map((x) => x.feature)) === '["reply-draft"]', JSON.stringify(acts.filter((x) => x.primary)));
    t.check('...and no "Ask about this ticket" box until it is asked for', !(await p.$('#ab-ticket-half-panel-assist form.ab-ask')));
    const moreAi = await moreButton(p);
    t.check('AI Assist ends with "More for this ticket: N AI actions"', /^More for this ticket: \d+ AI actions?$/.test(moreAi), moreAi);

    // The caller briefing: the same check before sending; the caller's tickets go, their name does not.
    await p.click('li.ab-act-item[data-pain="caller"] button[data-feature="caller-briefing"]');
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    const head = (await textOf(p, '.ab-dialog-head')) || '';
    t.check('the caller briefing opens the check before sending, for that action', /Brief me on this caller/.test(head), head.replace(/\s+/g, ' '));
    if (await p.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.getClientRects().length > 0 && /^Show the exact text/.test(b.innerText.trim())))) await clickButton(p, /^Show the exact text/);
    const preview = (await textOf(p, '.ab-preview')) || '';
    t.check('...the caller\'s other tickets are in what would be sent', /caller's other tickets/i.test(preview) && /INC\d{7}/.test(preview), preview.replace(/\s+/g, ' ').slice(0, 400));
    t.check('...and the caller\'s name is not', !/Abel|Tuter/.test(preview), (preview.match(/.{0,40}(Abel|Tuter).{0,40}/) || [''])[0]);
    t.check('nothing has been sent yet', ai.requests.length === 0, String(ai.requests.length));
    await clickButton(p, /^Send to AI/);
    await p.waitForSelector('.ab-output, .ab-note-danger', { timeout: 15000 });
    t.check('the answer appears after approval, and exactly one request went out', (await textOf(p, '.ab-output')) !== null && ai.requests.length === 1, String(ai.requests.length));
    const leaks = findLeaks(ai.requests[0]?.raw || '', data).critical;
    t.check('...with no raw personal data in it (names, emails, phone numbers masked)', leaks.length === 0, leaks.join(' | '));
    const audit = await ctx.audit();
    t.check('the run is in the activity log as caller-briefing', audit.some((e) => e.feature === 'caller-briefing' && e.outcome === 'sent'), audit.map((e) => `${e.feature}:${e.outcome}`).join(', '));

    // The rest of the AI actions: All tools, which starts them through the same check.
    await p.evaluate(() => [...document.querySelectorAll('button.ab-more-tools')].find((b) => b.getClientRects().length > 0).click());
    await ctx.waitUntil('All tools', async () => Boolean(await allTools(p)), { timeout: 5000 });
    tools = await allTools(p);
    t.check('"More for this ticket: N AI actions" opens All tools at its AI Assist group: Ask first, then the other actions, not the five', tools.activeGroup === 'ticket-assist' && tools.ids.includes('run:ask:ticket') && tools.ids.includes('run:handoff-brief') && !tools.ids.includes('run:reply-draft') && !tools.ids.includes('run:caller-briefing'), JSON.stringify(tools));
    await closeAllTools(p, ctx);
    await chooseTool(p, /^Ask about this ticket/);
    await ctx.waitUntil('the Ask box', () => p.evaluate(() => [...document.querySelectorAll('#ab-ticket-half-panel-assist form.ab-ask')].some((f) => f.getClientRects().length > 0)), { timeout: 8000 });
    // The focus moves into the box once it is drawn (an effect after the render), so it is waited for, as the box itself is.
    const askFocused = await ctx
      .waitUntil('the focus in the Ask box', () => p.evaluate(() => Boolean(document.activeElement?.closest('form.ab-ask'))), { timeout: 3000 })
      .then(() => true, () => false);
    t.check('"Ask about this ticket" from All tools opens its box at the top of AI Assist, with the focus in it', askFocused);
    const before = ai.requests.length;
    await chooseTool(p, /^Write a hand-off brief/);
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    t.check('an action from All tools opens the same check: nothing more sent', ai.requests.length === before, String(ai.requests.length));
    await p.evaluate(() => [...document.querySelectorAll('.ab-dialog button')].find((b) => /^Cancel/.test(b.innerText.trim()))?.click());
    await ctx.waitUntil('the check to close', async () => !(await p.$('.ab-dialog')), { timeout: 8000 });

    // ---- 4. The side rail, when Settings turns it on ------------------------------------------------------------------------------
    await ctx.configure({ railShow: true });
    await ctx.waitUntil('the AI Assist rail', async () => (await railItems(p)).length >= 5, { timeout: 8000 });
    let rail = await railItems(p);
    t.check('turned on, the rail of AI Assist lists the five actions, then All tools', JSON.stringify(rail) === JSON.stringify(['record-summary', 'next-best-action', 'caller-briefing', 'reply-draft', 'prepare-close', 'all-tools']), JSON.stringify(rail));
    await p.click('.ab-rail [data-rail-id="all-tools"]');
    await ctx.waitUntil('All tools from the rail', async () => Boolean(await allTools(p)), { timeout: 5000 });
    t.check('...its "All tools" opens All tools at the AI Assist group', (await allTools(p)).activeGroup === 'ticket-assist');
    await closeAllTools(p, ctx);
    await openHalf(p, 'insights');
    await ctx.waitUntil('the Insights rail', async () => (await railItems(p))[0] === 'understand', { timeout: 5000 });
    rail = await railItems(p);
    t.check('the rail of Insights lists the five pain points, then All tools', JSON.stringify(rail) === JSON.stringify([...PAINS, 'all-tools']), JSON.stringify(rail));
    await p.click('.ab-rail [data-rail-id="reply"]');
    await ctx.waitUntil('Reply to open', async () => (await groups(p)).find((x) => x.id === 'reply')?.open, { timeout: 5000 });
    t.check('...a pain point in the rail opens its row', true);
    await ctx.configure({ railShow: false });
    await ctx.waitUntil('the rail to go', async () => !(await p.$('.ab-rail')), { timeout: 5000 });
    t.check('turned off again, the rail is gone', true);

    // ---- 5. "Skip AI for now": AI Assist says so; Insights is unchanged -------------------------------------------------------------
    await ctx.configure({ aiSkipped: true });
    await openHalf(p, 'assist');
    await ctx.waitUntil('the AI rows to go', async () => (await fiveActions(p)).length === 0, { timeout: 5000 }).catch(() => {});
    acts = await fiveActions(p);
    t.check('with AI skipped, AI Assist shows no actions (it says how to set it up)', acts.length === 0, JSON.stringify(acts));
    await openHalf(p, 'insights');
    g = await groups(p);
    t.check('...and Insights still shows its five', g.length === 5, JSON.stringify(g.map((x) => x.id)));
    await ctx.configure({ aiSkipped: false });

    t.check('no secret reached the page: the AI key is not in the panel text', !(await panel.text()).includes(ai.key));
    await panel.close();
    await ticket.close();
  },
};

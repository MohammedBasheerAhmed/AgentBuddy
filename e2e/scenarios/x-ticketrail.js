// x. The Ticket screen with its side rail (the 2026-11-05 layout, docs/rail-layout.md; it replaced the quick-actions bar). The top is the
//    compact ticket (its other facts behind "Ticket details") and then straight away Insights | AI Assist: no "Needs you now" block, no
//    one main step, no quick bar. The rail lists every Insights card (a dot where a card needs a look; a click shows that card alone, with
//    "All insights" back) or, with AI Assist on, every AI action this record offers (state-aware order; a click starts it exactly as AI
//    Assist does: preview first, nothing sent before it is approved). The person's arrangement (Settings > Side rail) orders and hides
//    items; with AI skipped the AI items wait.
const { clickButton, textOf, waitForRecord, openHalf } = require('../ui.js');

const railItems = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll('.ab-rail .ab-rail-item')]
      .filter((b) => !b.classList.contains('ab-rail-names'))
      .map((b) => ({ id: b.getAttribute('data-rail-id'), name: b.getAttribute('aria-label'), current: b.getAttribute('aria-current') === 'true', disabled: b.getAttribute('aria-disabled') === 'true', dot: b.querySelector('.ab-rail-dot')?.className.replace('ab-rail-dot ', '') || '' }))
  );
const railTitle = (p) => p.evaluate(() => document.querySelector('.ab-rail')?.getAttribute('aria-label') || '');
const clickRail = (p, id) => p.click(`.ab-rail [data-rail-id="${id}"]`);
const shownCards = (p) => p.evaluate(() => [...document.querySelectorAll('li[data-card]')].filter((li) => li.getClientRects().length > 0).map((li) => li.getAttribute('data-card')));
const rowLevels = (p) => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('li[data-card]')].map((li) => [li.getAttribute('data-card'), (li.className.match(/is-(danger|warn)/) || [])[1] || ''])));
const halfOn = (p) => p.evaluate(() => window.__vis(document.querySelectorAll('[role=tab][id$="-half-tab-insights"], [role=tab][id$="-half-tab-assist"]')).find((t) => t.getAttribute('aria-selected') === 'true')?.id.replace(/.*-half-tab-/, '') || null);
const settle = (ctx, ms = 500) => ctx.sleep(ms);

module.exports = {
  id: 'x',
  title: 'Ticket screen with its side rail: compact top, every card and every AI action in the rail, one card alone, the same preview, the person\'s arrangement, AI skipped',
  timeoutMs: 150000,
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.ensureEnabled();
    // Everything this scenario relies on, so it also runs alone (an earlier scenario confirms the work profiles in a full run).
    await ctx.configure(
      { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', previewMode: 'always', previewSeen: [], instances: [inst.origin], quickPins: {}, pageBar: false, aiSkipped: false, profiles: ['it'], profilesConfirmed: true, railLayout: {}, railByState: true, railNames: false, halves: {} },
      { key: { provider: 'custom', value: ai.key } }
    );

    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-rail');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForRecord(p);
    await openHalf(p, 'insights');
    await ctx.waitUntil('the Insights rail', async () => (await railItems(p)).length >= 4, { timeout: 15000 });
    await p.waitForSelector('.ab-glance-more', { timeout: 15000 }); // the details come with the ticket's read

    // ---- 1. The top --------------------------------------------------------------------------------------------------------------
    const top = await p.evaluate(() => {
      const tab = document.querySelector('[role=tab][id$="-half-tab-insights"]');
      const more = document.querySelector('.ab-glance-more');
      return {
        gone: ['.ab-quick', '.ab-next', '.ab-needs', '.ab-next-btn'].filter((s) => document.querySelector(s)),
        switchTop: tab ? Math.round(tab.getBoundingClientRect().top) : -1,
        more: more ? more.getAttribute('aria-expanded') : null,
        details: [...document.querySelectorAll('.ab-glance-details')].some((d) => d.getClientRects().length > 0),
      };
    });
    t.check('no "Needs you now" block, no main step and no quick bar at the top', top.gone.length === 0, JSON.stringify(top.gone));
    t.check('Insights | AI Assist starts high up, under the compact ticket (within the first 260 px)', top.switchTop > 0 && top.switchTop < 260, String(top.switchTop));
    t.check('the other facts of the ticket are folded behind "Ticket details"', top.more === 'false' && !top.details, JSON.stringify(top));
    await p.click('.ab-glance-more');
    await ctx.waitUntil('the details to open', () => p.evaluate(() => [...document.querySelectorAll('.ab-glance-details')].some((d) => d.getClientRects().length > 0)), { timeout: 5000 });
    t.check('"Ticket details" opens them (assigned to, updated ...)', /Updated/.test((await textOf(p, '.ab-glance-details')) || ''), await textOf(p, '.ab-glance-details'));
    await p.click('.ab-glance-more');

    // ---- 2. The Insights rail ---------------------------------------------------------------------------------------------------
    let items = await railItems(p);
    const cardIds = await p.evaluate(() => [...document.querySelectorAll('li[data-card]')].map((li) => li.getAttribute('data-card')));
    t.check('the rail is the Insights rail: "All insights" first, then exactly the cards of this ticket', /Side rail: Insights/.test(await railTitle(p)) && items[0].id === 'all' && JSON.stringify(items.slice(1).map((x) => x.id).sort()) === JSON.stringify([...cardIds].sort()), JSON.stringify({ rail: items.map((x) => x.id), cards: cardIds }));
    await ctx.waitUntil('the cards to report', async () => Object.values(await rowLevels(p)).some(Boolean), { timeout: 15000 }).catch(() => {});
    await settle(ctx, 800);
    items = await railItems(p);
    const levels = await rowLevels(p);
    t.check('a dot in the rail exactly where a card\'s row says it needs a look', items.slice(1).every((x) => (x.dot ? x.dot === `is-${levels[x.id]}` : !levels[x.id])), JSON.stringify({ rail: items.map((x) => [x.id, x.dot]), rows: levels }));
    t.check('nothing in the Insights rail is an AI action', items.every((x) => !/\(AI\)$/.test(x.name)));

    // One card alone.
    await clickRail(p, 'related');
    await ctx.waitUntil('the card shown alone', async () => JSON.stringify(await shownCards(p)) === '["related"]', { timeout: 5000 });
    items = await railItems(p);
    const back = await p.evaluate(() => [...document.querySelectorAll('.ab-ins-back')].some((b) => b.getClientRects().length > 0));
    t.check('a card in the rail shows that card alone, marked in the rail, with "All insights" back; nothing went to the AI', back && items.find((x) => x.id === 'related').current && ai.requests.length === 0, JSON.stringify({ back, items: items.filter((x) => x.current).map((x) => x.id), sent: ai.requests.length }));
    await clickRail(p, 'all');
    await ctx.waitUntil('the list again', async () => (await shownCards(p)).length > 1, { timeout: 5000 });
    t.check('"All insights" brings the whole list back', (await railItems(p))[0].current);

    // ---- 3. The AI Assist rail ----------------------------------------------------------------------------------------------------
    await openHalf(p, 'assist');
    await ctx.waitUntil('the AI Assist rail', async () => /AI Assist/.test(await railTitle(p)), { timeout: 5000 });
    items = await railItems(p);
    t.check('with AI Assist on, the rail lists "Suggested" then every AI action, each named as AI', items[0].id === 'suggested' && items.length >= 6 && items.slice(1).every((x) => /\(AI\)$/.test(x.name)), JSON.stringify(items.map((x) => x.name)));
    t.check('...what fits a ticket in progress first: the reply', items[1].id === 'reply-draft', JSON.stringify(items.slice(1, 4).map((x) => x.id)));
    t.check('...and nothing in it waits while no answer is on its way', items.every((x) => !x.disabled), JSON.stringify(items.filter((x) => x.disabled).map((x) => x.id)));

    await clickRail(p, 'record-summary');
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    const head = await textOf(p, '.ab-dialog-head');
    t.check('a rail action opens the same preview as AI Assist, for that action', /Summarise this ticket/.test(head || '') && (await halfOn(p)) === 'assist', `${(head || '').replace(/\s+/g, ' ')} / ${await halfOn(p)}`);
    t.check('nothing has been sent to the AI yet', ai.requests.length === 0, String(ai.requests.length));
    const waiting = (await railItems(p)).slice(1);
    t.check('while a run is open the AI actions in the rail wait', waiting.length > 0 && waiting.every((x) => x.disabled), JSON.stringify(waiting.map((x) => x.disabled)));
    await clickButton(p, /^Send to AI/);
    await p.waitForSelector('.ab-output, .ab-note-danger', { timeout: 15000 });
    t.check('the answer appears, and exactly one request went out, only after approval', (await textOf(p, '.ab-output')) !== null && ai.requests.length === 1, String(ai.requests.length));
    const audit = await ctx.audit();
    t.check('the run is in the activity log under the same feature id as AI Assist', audit.some((e) => e.feature === 'record-summary' && e.outcome === 'sent'), audit.map((e) => `${e.feature}:${e.outcome}`).join(', '));
    await ctx.waitUntil('the rail to work again', async () => (await railItems(p)).slice(1).every((x) => !x.disabled), { timeout: 5000 }).catch(() => {});
    items = await railItems(p);
    t.check('the answer is there: the rail works again and marks the action whose answer is on show', items.slice(1).every((x) => !x.disabled) && items.find((x) => x.id === 'record-summary').current, JSON.stringify(items.map((x) => [x.id, x.current, x.disabled])));

    // ---- 4. The person's arrangement (Settings > Side rail) ------------------------------------------------------------------------
    await ctx.configure({ railLayout: { incident: { assist: { order: ['handoff-brief'], hidden: ['reply-draft'] } } } });
    await ctx.waitUntil('the arranged rail', async () => (await railItems(p))[1]?.id === 'handoff-brief', { timeout: 5000 }).catch(() => {});
    items = await railItems(p);
    t.check('the person\'s order comes first and a hidden action is not in the rail', items[1].id === 'handoff-brief' && !items.some((x) => x.id === 'reply-draft'), JSON.stringify(items.map((x) => x.id)));
    await ctx.configure({ railLayout: {} });
    await ctx.waitUntil('the suggested order again', async () => (await railItems(p))[1]?.id === 'reply-draft', { timeout: 5000 }).catch(() => {});
    t.check('back to the suggested order', (await railItems(p))[1]?.id === 'reply-draft');

    // ---- 5. "Skip AI for now": the AI items wait; the Insights rail is as before -------------------------------------------------------
    await ctx.configure({ aiSkipped: true });
    await ctx.waitUntil('the AI items to wait', async () => (await railItems(p)).slice(1).every((x) => x.disabled), { timeout: 5000 }).catch(() => {});
    items = await railItems(p);
    t.check('with AI skipped every AI action in the rail waits (AI Assist says how to set it up)', items.slice(1).length > 0 && items.slice(1).every((x) => x.disabled), JSON.stringify(items.map((x) => [x.id, x.disabled])));
    await openHalf(p, 'insights');
    await ctx.waitUntil('the Insights rail', async () => /Insights/.test(await railTitle(p)), { timeout: 5000 });
    t.check('...and the Insights rail is unchanged', (await railItems(p)).every((x) => !x.disabled));
    await ctx.configure({ aiSkipped: false });

    t.check('no secret reached the page: the AI key is not in the panel text', !(await panel.text()).includes(ai.key));
    await panel.close();
    await ticket.close();
  },
};

// i. The Ticket screen's Insights half on an incident: the ticket at a glance and the cards (related tickets, knowledge, steps that
//    worked, risk, missing details, journey...), all read with the agent's own session, no AI. A table the user cannot read becomes a
//    plain note instead of an error. Tickets in the cards are real links that open in a NEW tab: the ticket being worked on stays.
const { waitForText, textOf, waitForRecord, openScreen, openHalf } = require('../ui.js');
const { prepare } = require('../common.js');
// The redesign: the cards are one list of rows; a row shows the card's one line without being opened (e2e/insightsUi.js).
const { openCard, openGroup, painLine } = require('../insightsUi.js');

module.exports = {
  id: 'i',
  title: 'Ticket screen, Insights: glance, related tickets, knowledge, steps, risk, journey; reads only, no AI call, denied table shows a note',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    inst.setBehaviour();
    // The shared start (the fake instance's behaviour, the AI stub, settings): an earlier scenario (f) leaves state this one must not see.
    await prepare(ctx);

    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-classic');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForRecord(p);
    await openScreen(p, 'Ticket');

    // ---- N1: the ticket at the top (no box), compact since the 2026-11-05 layout: the number, the title, chips; the other facts
    //      (who has it, when it was updated ...) behind "Ticket details" ------------------------------------------------------------
    await openHalf(p, 'insights');
    await p.waitForSelector('.ab-glance', { timeout: 15000 });
    await waitForText(p, /VPN keeps disconnecting/, { timeout: 15000 });
    await ctx.waitUntil('the state and priority chips', async () => /In Progress/.test((await textOf(p, '.ab-glance')) || '') && /High/.test((await textOf(p, '.ab-glance')) || ''), { timeout: 15000 }).catch(() => {});
    const glance = (await textOf(p, '.ab-glance')) || '';
    t.check('the glance shows the number, the title, the state and the priority', /INC0010001/.test(glance) && /VPN keeps disconnecting/.test(glance) && /In Progress/.test(glance) && /High/.test(glance), glance.replace(/\s+/g, ' ').slice(0, 200));
    const folded = await p.evaluate(() => ({ more: document.querySelector('.ab-glance-more')?.getAttribute('aria-expanded'), shown: [...document.querySelectorAll('.ab-glance-details')].some((d) => d.getClientRects().length > 0) }));
    t.check('the glance is calm: the other facts wait behind "Ticket details"', folded.more === 'false' && !folded.shown, JSON.stringify(folded));
    await p.click('.ab-glance-more');
    await ctx.waitUntil('the owner in the details', async () => /Beth Anglin/.test((await textOf(p, '.ab-glance-details')) || ''), { timeout: 15000 }).catch(() => {});
    const details = (await textOf(p, '.ab-glance-details')) || '';
    t.check('...the owner and when it was last updated (read with the glance read, no AI)', /Beth Anglin/.test(details) && /Updated\s/.test(details), details.replace(/\s+/g, ' ').slice(0, 240));
    await p.click('.ab-glance-more');

    t.check('the Insights half carries no AI mark', (await p.evaluate(() => [...document.querySelectorAll('[id$="-half-panel-insights"] .ab-ai-badge')].filter((e) => e.getClientRects().length > 0).length)) === 0);

    // ---- N2: the same caller (the "Same caller" row) and related tickets (All tools) -----------------------------------------------------
    await openCard(p, "Caller's other tickets");
    await ctx.waitUntil('the caller\'s earlier tickets', async () => /Earlier tickets from Abel Tuter/.test((await textOf(p, '[data-card="caller"]')) || ''), { timeout: 20000 });
    const callerText = (await textOf(p, '[data-card="caller"]')) || '';
    t.check('Same caller: the caller\'s earlier tickets (read locally, so the real name is fine on screen)', /Earlier tickets from Abel Tuter/.test(callerText) && /INC\d{7}/.test(callerText), callerText.replace(/\s+/g, ' ').slice(0, 400));
    t.check('Same caller: its row\'s one line counts the earlier tickets', /\d+ earlier ticket/.test(await painLine(p, 'caller')), await painLine(p, 'caller'));
    await openCard(p, 'Related tickets');
    await openGroup(p, /^Solved look-alikes/);
    await waitForText(p, 'INC0009640', { timeout: 15000 });
    const text = await panel.text();
    t.check('Related tickets (from All tools): the solved look-alikes, and no second list of the caller\'s tickets', text.includes('INC0009640') && !/Earlier tickets from/.test((await textOf(p, '[data-card="related"]')) || ''), text.replace(/\s+/g, ' ').slice(0, 400));
    await p.evaluate(() => [...document.querySelectorAll('.ab-ins-back')].find((b) => b.getClientRects().length > 0)?.click());

    // ---- N3 and N12: knowledge and the steps that worked --------------------------------------------------------------------------------
    await openCard(p, 'Knowledge for this ticket');
    await waitForText(p, 'KB0010001', { timeout: 15000 });
    t.check('Knowledge for this ticket: the article for the symptom is suggested, with "Copy link"', (await panel.text()).includes('KB0010001') && (await p.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.getClientRects().length > 0 && /Copy link/.test(b.innerText)))));
    await openCard(p, 'Steps that worked before');
    await waitForText(p, /Replaced the expired gateway certificate/, { timeout: 15000 });
    t.check('Steps that worked before: the fix of a solved look-alike is listed', true);

    // ---- N9, N11, N24: from the same glance read --------------------------------------------------------------------------------------
    // The five rows answer at a look (their one line, without being opened); Risk signals and Missing details are in All tools now.
    await ctx.waitUntil('the five lines', async () => (await Promise.all(['understand', 'fix', 'caller', 'reply', 'close'].map((g) => painLine(p, g)))).filter(Boolean).length >= 4, { timeout: 10000 }).catch(() => {});
    const lines = await Promise.all(['understand', 'fix', 'caller', 'reply', 'close'].map((g) => painLine(p, g)));
    t.check('the five rows show their one line without being opened', lines.filter(Boolean).length >= 4, lines.join(' | '));
    await openCard(p, 'Risk signals');
    await waitForText(p, /Risk signals/, { timeout: 10000 });
    t.check('Risk signals (from All tools) opens alone with its content', ((await textOf(p, '[data-card="risk"]')) || '').trim().length > 0);
    await openCard(p, 'Missing details');
    t.check('Missing details (from All tools) opens alone with its content', ((await textOf(p, '[data-card="missing"]')) || '').trim().length > 0);
    await p.evaluate(() => [...document.querySelectorAll('.ab-ins-back')].find((b) => b.getClientRects().length > 0)?.click());
    t.check('no AI request was made while the Insights cards loaded', ai.requests.length === 0);
    t.check('no error banner', (await textOf(p, '.ab-note-danger')) === null);

    // ---- a table the user may not read ------------------------------------------------------------------------------------------------
    inst.setBehaviour({ denied: ['kb_knowledge'] });
    // (The cards are rows that open in place: its Refresh button is in the card's body, on screen once the row is open.)
    await openCard(p, 'Knowledge for this ticket');
    await p.evaluate(() => {
      const card = document.querySelector('[data-card="knowledge"]');
      [...(card?.querySelectorAll('button') || [])].find((b) => /^Refresh/.test(b.innerText.trim()))?.click();
    });
    // (The note's label and its sentence are on separate lines in the card.)
    await waitForText(p, /Knowledge articles:\s*[^\n]*cannot read/i, { timeout: 15000 });
    t.check('knowledge table denied (403): a plain note, not an error', (await textOf(p, '[data-card="knowledge"] .ab-note-danger')) === null);
    t.check('the other cards still show', (await p.evaluate(() => document.querySelector('[data-card="caller"]')?.textContent || '')).includes('Earlier tickets from Abel Tuter'));
    inst.setBehaviour();

    // ---- links: a ticket opens in a NEW tab, the ticket being worked on stays ----------------------------------------------------------
    const earlier = async () => (await p.evaluateHandle(() => window.__vis(document.querySelectorAll('a.ab-ins-item')).find((x) => /INC0009640/.test(x.innerText)))).asElement();
    const link = await earlier();
    const attrs = link ? await link.evaluate((a) => ({ href: a.href, target: a.target, rel: a.rel })) : null;
    t.check('a ticket in a card is a real link to that ticket on the instance, set to open a new tab', Boolean(attrs) && attrs.href.startsWith(`${inst.origin}/nav_to.do?uri=`) && attrs.target === '_blank' && /noopener/.test(attrs.rel), JSON.stringify(attrs));
    const ticketUrl = ticket.url();
    // (the plain click last: it brings its new tab to the front, and the panel follows the tab on show)
    for (const how of ['Ctrl+click', 'middle click', 'plain click']) {
      const before = new Set(ctx.browser.targets());
      const el = await earlier();
      await el.evaluate((node) => node.scrollIntoView({ block: 'center' }));
      if (how === 'Ctrl+click') {
        await p.keyboard.down('Control');
        await el.click();
        await p.keyboard.up('Control');
      } else if (how === 'middle click') {
        await el.click({ button: 'middle' });
      } else {
        await el.click();
      }
      const opened = await ctx.browser.waitForTarget((x) => !before.has(x) && x.url().startsWith(`${inst.origin}/nav_to.do`), { timeout: 8000 }).catch(() => null);
      t.check(`${how} on a ticket opens it in a new tab`, Boolean(opened), opened?.url() || 'no new tab');
      await ctx.sleep(300);
      t.check(`${how}: the ticket tab the panel is attached to did not move`, ticket.url() === ticketUrl, ticket.url());
      await (await opened?.page?.().catch(() => null))?.close().catch(() => {});
    }
    // (back to the ticket tab, so the panel follows it again)
    await ticket.bringToFront().catch(() => {});

    await panel.close();
    await ticket.close();
  },
};

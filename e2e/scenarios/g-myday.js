// g. My Day: on a page that is not a record, the panel lists the agent's own open tickets from the fake instance,
//    most urgent first (breached SLA, then SLA nearly used up, then priority). Tables or SLAs the user cannot read become
//    a short note, never an error screen. No AI is involved.
const { clickButton, waitForText, textOf } = require('../ui.js');

// The numbers in the order the list shows them, with the risk label each row carries.
const readList = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('section[aria-label="My day"] li')].map((li) => {
      const text = li.innerText.replace(/\s+/g, ' ').trim();
      return { number: (text.match(/\b[A-Z]{2,6}\d{4,}\b/) || [''])[0], text, breached: /SLA breached/.test(text), atRisk: /SLA at risk/.test(text) };
    })
  );

module.exports = {
  id: 'g',
  title: 'My Day: queue ordered breached SLA first, access notes instead of errors',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.ensureEnabled();
    await ctx.configure({ provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, instances: [inst.origin] }, { key: { provider: 'custom', value: ai.key } });

    const home = await ctx.openInstancePage('/home', 'home');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForText(p, 'INC0010100', { timeout: 15000 });
    t.check('panel is on a non-record page and shows the My day card', (await panel.text()).includes('My day') && (await panel.text()).includes('Open a ticket'));

    let list = await readList(p);
    const numbers = list.map((x) => x.number);
    t.check('lists the agent\'s own tickets from the fake instance', ['INC0010100', 'INC0010001', 'INC0010101'].every((n) => numbers.includes(n)), numbers.join(', '));
    t.check('another agent\'s tickets are not listed (only assigned_to = me)', !numbers.includes('INC0010002') && !numbers.includes('INC0010003'), numbers.join(', '));
    // (The shared fixtures also give this agent a breached customer-service case, so more than one row can be breached.)
    const breachedRow = list.find((x) => x.number === 'INC0010100');
    t.check('a breached ticket is FIRST in the list, and the seeded breached incident is labelled "SLA breached"', Boolean(list[0]?.breached) && Boolean(breachedRow?.breached), `${list[0]?.number}: ${list[0]?.text}`);
    const risk = list.find((x) => x.number === 'INC0010001');
    t.check('the ticket whose SLA is used up (118%) is labelled "SLA at risk" and sits after every breached one', Boolean(risk?.atRisk) && list.indexOf(risk) > list.reduce((last, x, i) => (x.breached ? i : last), -1), risk?.text);
    t.check('breached tickets come before at-risk, at-risk before the rest', (() => {
      const order = list.map((x) => (x.breached ? 0 : x.atRisk ? 1 : 2));
      return order.every((v, i) => i === 0 || order[i - 1] <= v);
    })(), list.map((x) => `${x.number}:${x.breached ? 'B' : x.atRisk ? 'R' : '-'}`).join(' '));
    t.check('the critical ticket without an SLA ranks after the SLA-risk ones', numbers.indexOf('INC0010101') > numbers.indexOf('INC0010001'));
    t.check('no AI request was made for My Day', ai.requests.length === 0);

    // A table the user cannot read (a customer-service case queue they have no role for): a note, and the rest still shows.
    inst.setBehaviour({ denied: ['sn_customerservice_case', 'change_task'] });
    await clickButton(p, /^Refresh/);
    await waitForText(p, /you cannot read this/i, { timeout: 8000 });
    const hint = await p.evaluate(() => document.querySelector('section[aria-label="My day"] .ab-hint')?.innerText || '');
    t.check('denied tables become a short note, not an error', /sn_customerservice_case: you cannot read this/.test(hint) && (await textOf(p, '.ab-note-danger')) === null, hint);
    list = await readList(p);
    t.check('the readable tables are still listed', list.some((x) => x.number === 'INC0010100'), list.map((x) => x.number).join(', '));

    // The SLA table denied: the list falls back on priority and says why.
    inst.setBehaviour({ denied: ['task_sla'] });
    await clickButton(p, /^Refresh/);
    await waitForText(p, /SLA information is not available/i, { timeout: 8000 });
    list = await readList(p);
    t.check('SLA table denied: a note explains the order, and no row claims an SLA state', list.every((x) => !x.breached && !x.atRisk) && (await textOf(p, '.ab-note-danger')) === null, list.map((x) => x.number).join(', '));
    t.check('SLA table denied: ordered by priority (critical first)', list[0]?.number === 'INC0010101', list.map((x) => x.number).join(', '));

    // The session has expired: plain sentence.
    inst.setBehaviour({ expired: true });
    await clickButton(p, /^Refresh/);
    await p.waitForSelector('.ab-note-danger', { timeout: 8000 });
    t.check('expired session: a plain "log in again" message', /session has expired/i.test((await textOf(p, '.ab-note-danger')) || ''), await textOf(p, '.ab-note-danger'));

    // Back to normal, then open the first ticket from the list: the tab navigates and the panel follows.
    inst.setBehaviour();
    await clickButton(p, /^Refresh/);
    await waitForText(p, 'INC0010100', { timeout: 8000 });
    await p.evaluate(() => [...document.querySelectorAll('section[aria-label="My day"] li button')].find((b) => b.innerText.includes('INC0010100')).click());
    await p.waitForFunction(() => document.body.innerText.includes('Summarise this ticket') && !document.body.innerText.includes('Loading'), { timeout: 15000 });
    const opened = await panel.text();
    t.check('clicking a ticket opens it and the panel switches to its actions', opened.includes('INC0010100') && opened.includes('Printer offline in Finance'), opened.replace(/\s+/g, ' ').slice(0, 140));

    await panel.close();
    await home.close();
  },
};

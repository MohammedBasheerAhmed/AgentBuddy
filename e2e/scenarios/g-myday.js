// g. My work: on a page that is not a record, the My work screen lists the agent's own open tickets from the fake instance, of every
//    type (counted first, then read), most urgent first (breached SLA, then SLA at risk, then the customer's reply, then priority), with
//    the time an SLA has left and one status chip per ticket; the unassigned tickets of the agent's groups have their own card. Tables
//    or SLAs the user cannot read become one short line, never an error screen. A plain click opens the ticket and the panel switches
//    to the Ticket screen. No AI is involved.
const { clickButton, waitForText, textOf, openScreen } = require('../ui.js');

const QUEUE = '[data-card="mywork-queue"]';
const GROUPS = '[data-card="mywork-groups"]';

// The tickets of one card in the order it shows them (the folded groups are not drawn), with their SLA mark.
const readCard = (page, card) =>
  page.evaluate(
    (sel) =>
      [...document.querySelectorAll(`${sel} .ab-mw-row a`)]
        .filter((a) => a.getClientRects().length > 0)
        .map((a) => {
          const text = a.innerText.replace(/\s+/g, ' ').trim();
          return {
            number: (text.match(/\b[A-Z]{2,6}\d{4,}\b/) || [''])[0],
            text,
            breached: Boolean(a.querySelector('.ab-mw-sla-breached')),
            atRisk: Boolean(a.querySelector('.ab-mw-sla-at-risk')),
            sla: a.querySelector('.ab-mw-sla')?.innerText || '',
          };
        }),
    card
  );
const readList = (page) => readCard(page, QUEUE);

module.exports = {
  id: 'g',
  title: 'My work: every open ticket, breached SLA first, time left, group queue, access notes instead of errors',
  async run(t, ctx) {
    const { ai, inst } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.ensureEnabled();
    await ctx.configure({ provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, instances: [inst.origin] }, { key: { provider: 'custom', value: ai.key } });

    const home = await ctx.openInstancePage('/home', 'home');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await openScreen(p, 'My work');
    await p.waitForFunction((sel) => /INC0010100/.test(document.querySelector(sel)?.innerText || ''), { timeout: 15000 }, QUEUE);
    t.check('the My work screen shows when it was read', /Read just now|Read \d+ min ago/.test(await panel.text()), (await textOf(p, '.ab-mw-read')) || '');

    let list = await readList(p);
    const numbers = list.map((x) => x.number);
    t.check('lists the agent\'s own tickets from the fake instance', ['INC0010100', 'INC0010001', 'INC0010101'].every((n) => numbers.includes(n)), numbers.join(', '));
    t.check('every type of ticket assigned to the agent is listed (a case and a change too, not only the old six tables)', numbers.includes('CS0001001') && numbers.includes('CHG0030001'), numbers.join(', '));
    t.check('another agent\'s or nobody\'s tickets are not in my queue (only assigned_to = me)', !numbers.includes('INC0010002') && !numbers.includes('INC0010003'), numbers.join(', '));
    const breachedRow = list.find((x) => x.number === 'INC0010100');
    t.check('a breached ticket is FIRST in the list, and the seeded breached incident is marked "SLA breached"', Boolean(list[0]?.breached) && Boolean(breachedRow?.breached), `${list[0]?.number}: ${list[0]?.text}`);
    t.check('breached tickets come before the rest', (() => {
      const order = list.map((x) => (x.breached ? 0 : 1));
      return order.every((v, i) => i === 0 || order[i - 1] <= v);
    })(), list.map((x) => `${x.number}:${x.breached ? 'B' : x.atRisk ? 'R' : '-'}`).join(' '));
    // INC0010001: the caller (Abel) commented after the agent's last comment; its SLA has an end time.
    const vpn = list.find((x) => x.number === 'INC0010001');
    t.check('the caller wrote after the agent: "Customer replied"', /Customer replied/.test(vpn?.text || ''), vpn?.text);
    t.check('a ticket with an SLA shows its time (due in / due now / breached), not a percentage', /^SLA (due|breached)/.test(vpn?.sla || ''), vpn?.sla);
    t.check('the queue card says how many are open', /My queue\s+\d+ open/.test((await textOf(p, QUEUE)) || ''), ((await textOf(p, QUEUE)) || '').slice(0, 80));
    // N14: the group's unassigned tickets, oldest first, on their own card.
    const groups = await readCard(p, GROUPS);
    t.check('the unassigned tickets of my groups have their own card', groups.length > 0 && groups.some((x) => x.number === 'INC0010002' || x.number === 'INC0010003'), groups.map((x) => x.number).join(', '));
    t.check('no AI request was made for My work', ai.requests.length === 0);

    // A table the user cannot read (a customer-service case queue they have no role for): one line, and the rest still shows.
    inst.setBehaviour({ denied: ['sn_customerservice_case', 'change_task'] });
    await clickButton(p, /^Refresh$/);
    await waitForText(p, /You cannot read cases\./, { timeout: 10000 });
    const hint = (await textOf(p, '.ab-mw-access')) || '';
    t.check('a denied table becomes a short plain line, not an error and not the API text', /You cannot read cases\./.test(hint) && !/Table API|403|failed/.test(hint) && (await textOf(p, '.ab-note-danger')) === null, hint);
    list = await readList(p);
    t.check('the readable tables are still listed', list.some((x) => x.number === 'INC0010100') && !list.some((x) => x.number === 'CS0001001'), list.map((x) => x.number).join(', '));

    // The SLA table denied: the list falls back on priority and says why.
    inst.setBehaviour({ denied: ['task_sla'] });
    await clickButton(p, /^Refresh$/);
    await waitForText(p, /SLA information is not available/i, { timeout: 10000 });
    list = await readList(p);
    t.check('SLA table denied: a note explains the order, and no row claims an SLA state', list.every((x) => !x.breached && !x.atRisk && !x.sla) && (await textOf(p, '.ab-note-danger')) === null, list.map((x) => x.number).join(', '));
    const at = (n) => list.findIndex((x) => x.number === n);
    t.check('SLA table denied: ordered by priority (the critical ticket before the moderate one)', at('INC0010101') >= 0 && at('INC0010101') < at('INC0010100'), list.map((x) => x.number).join(', '));

    // The session has expired: plain sentence.
    inst.setBehaviour({ expired: true });
    await clickButton(p, /^Refresh$/);
    await p.waitForSelector('.ab-note-danger', { timeout: 10000 });
    t.check('expired session: a plain "log in again" message', /session has expired/i.test((await textOf(p, '.ab-note-danger')) || ''), await textOf(p, '.ab-note-danger'));

    // Back to normal, then open the first ticket from the list: the tab navigates and the panel follows to the Ticket screen.
    inst.setBehaviour();
    await clickButton(p, /^(Refresh|Try again)$/);
    await p.waitForFunction((sel) => /INC0010100/.test(document.querySelector(sel)?.innerText || '') && !document.querySelector('.ab-note-danger'), { timeout: 10000 }, QUEUE);
    // A ticket in the list is a real link (Ctrl+click and the right-click menu open a new tab); a plain click opens it in this tab.
    const link = await p.evaluate((sel) => {
      const a = [...document.querySelectorAll(`${sel} .ab-mw-row a`)].find((x) => x.innerText.includes('INC0010100'));
      return a ? { href: a.href, target: a.target, rel: a.rel } : null;
    }, QUEUE);
    t.check('a ticket in My work is a real link on the instance, set to open a new tab for Ctrl+click and the right-click menu', Boolean(link) && link.href.startsWith(`${ctx.inst.origin}/nav_to.do?uri=`) && link.target === '_blank' && /noopener/.test(link.rel), JSON.stringify(link));
    await p.evaluate((sel) => [...document.querySelectorAll(`${sel} .ab-mw-row a`)].find((b) => b.innerText.includes('INC0010100')).click(), QUEUE);
    await p.waitForFunction(() => document.querySelector('#ab-sec-tab-ticket')?.getAttribute('aria-selected') === 'true', { timeout: 10000 });
    await p.waitForFunction(() => document.body.innerText.includes('Printer offline in Finance') && !/Loading/.test(document.body.innerText), { timeout: 15000 });
    const opened = await panel.text();
    t.check('clicking a ticket opens it and the panel switches to the Ticket screen with that ticket', opened.includes('INC0010100') && opened.includes('Printer offline in Finance'), opened.replace(/\s+/g, ' ').slice(0, 160));

    await panel.close();
    await home.close();
  },
};

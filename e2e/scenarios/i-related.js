// i. The Related tab (caller history, solved look-alikes, open duplicates, knowledge): all read with the agent's own session,
//    no AI. A table the user cannot read becomes an access note instead of an error.
const { clickButton, waitForText, textOf, waitForRecord } = require('../ui.js');

module.exports = {
  id: 'i',
  title: 'Related tab: reads only, no AI call, denied table shows a note instead of an error',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.ensureEnabled();
    await ctx.configure({ provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, instances: [inst.origin] }, { key: { provider: 'custom', value: ai.key } });

    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-classic');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForRecord(p);
    await clickButton(p, /^Related/);
    await waitForText(p, /Earlier tickets from/, { timeout: 15000 });
    await waitForText(p, 'Knowledge that may help', { timeout: 15000 });
    await ctx.sleep(800);
    const text = await panel.text();
    t.check('shows the caller\'s earlier tickets (read locally, so the real name is fine on screen)', text.includes('Earlier tickets from Abel Tuter') && text.includes('INC0009640'), text.replace(/\s+/g, ' ').slice(120, 520));
    t.check('shows "Solved before" and "Knowledge that may help"', text.includes('Solved before') && text.includes('Knowledge that may help'));
    t.check('the knowledge article for the symptom is suggested', text.includes('KB0010001'), '');
    t.check('no AI request was made while the Related tab loaded', ai.requests.length === 0);
    t.check('no error banner', (await textOf(p, '.ab-note-danger')) === null);

    // The knowledge table is off limits for this user.
    inst.setBehaviour({ denied: ['kb_knowledge'] });
    await clickButton(p, /^Refresh/);
    // (The note names the thing in plain words, not the table.)
    await waitForText(p, /Knowledge articles: /, { timeout: 10000 });
    t.check('knowledge table denied (403): an access note, not an error', /Knowledge articles: .*cannot read/i.test(await panel.text()) && (await textOf(p, '.ab-note-danger')) === null, '');
    await waitForText(p, 'Earlier tickets from Abel Tuter', { timeout: 10000 });
    t.check('the other sections still show', (await panel.text()).includes('Earlier tickets from Abel Tuter') && (await panel.text()).includes('Solved before'));
    inst.setBehaviour();

    // Every ticket in the list is a real link on the instance: Ctrl+click and the middle button open a new tab (and the right-click
    // menu offers "Open link in new tab", which only a real link gets; a context menu cannot be driven headless), and the ticket tab
    // the panel is attached to stays where it is.
    await clickButton(p, /^Refresh/);
    await waitForText(p, 'INC0009640', { timeout: 15000 });
    const earlier = async () => (await p.evaluateHandle(() => window.__vis(document.querySelectorAll('a.ab-feature')).find((x) => /INC0009640/.test(x.innerText)))).asElement();
    const link = await earlier();
    const attrs = link ? await link.evaluate((a) => ({ href: a.href, target: a.target, rel: a.rel })) : null;
    t.check('a ticket in Related is a real link to that ticket on the instance, set to open a new tab', Boolean(attrs) && attrs.href.startsWith(`${inst.origin}/nav_to.do?uri=`) && attrs.target === '_blank' && /noopener/.test(attrs.rel), JSON.stringify(attrs));
    const ticketUrl = ticket.url();
    for (const how of ['Ctrl+click', 'middle click']) {
      const before = new Set(ctx.browser.targets());
      const el = await earlier();
      if (how === 'Ctrl+click') {
        await p.keyboard.down('Control');
        await el.click();
        await p.keyboard.up('Control');
      } else {
        await el.click({ button: 'middle' });
      }
      const opened = await ctx.browser.waitForTarget((x) => !before.has(x) && x.url().startsWith(`${inst.origin}/nav_to.do`), { timeout: 8000 }).catch(() => null);
      t.check(`${how} on a ticket opens it in a new tab`, Boolean(opened), opened?.url() || 'no new tab');
      await ctx.sleep(300);
      t.check(`${how}: the ticket tab the panel is attached to did not move`, ticket.url() === ticketUrl, ticket.url());
      await (await opened?.page?.().catch(() => null))?.close().catch(() => {});
    }

    await panel.close();
    await ticket.close();
  },
};

// j. The panel and what it shows when things change under it:
//    - the "check what is sent" modes (first time / never) behave as promised
//    - an answer that arrives after the agent moved to another ticket is dropped, and a finished answer for one ticket is not
//      left on screen (where it could be inserted into another ticket's form)
const { findLeaks } = require('../leaks.js');
const { clickButton, waitForText, textOf, waitForRecord } = require('../ui.js');

const OTHER_ID = 'aa100000000000000000000000000100'; // INC0010100, seeded in e2e/data.entry.js

module.exports = {
  id: 'j',
  title: 'Panel state: preview modes, and answers never follow the agent to another ticket',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.ensureEnabled();
    const base = { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', instances: [inst.origin] };
    await ctx.configure({ ...base, previewMode: 'first', previewSeen: [] }, { key: { provider: 'custom', value: ai.key } });

    const a = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-a');
    const b = await ctx.openInstancePage(`/incident.do?sys_id=${OTHER_ID}`, 'ticket-b');
    await a.bringToFront();
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForRecord(p, 'INC0010001');

    // ---- 1. "First time per action": shown once, then not again --------------------------------------------------------
    const entries = async () => (await ctx.audit()).filter((e) => e.outcome === 'sent');
    await clickButton(p, /^Summarise this ticket/);
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    t.check('first time: the preview is shown and says it will not be asked again for this action', /not be asked again for this action/.test((await textOf(p, '.ab-dialog-foot')) || ''));
    await clickButton(p, /^Send to AI/);
    await p.waitForSelector('.ab-output', { timeout: 15000 });
    await clickButton(p, /^Try again/);
    await p.waitForSelector('.ab-output', { timeout: 15000 });
    await ctx.sleep(400);
    t.check('second time for the same action: no preview, the request goes straight out', ai.requests.length === 2 && (await p.$('.ab-dialog')) === null, `${ai.requests.length} requests`);
    const sent = (await entries()).slice(-2); // the two runs of this scenario
    t.check("audit says preview 'shown' the first time and 'skipped' the second time", sent[0]?.preview === 'shown' && sent[1]?.preview === 'skipped', sent.map((e) => e.preview).join(','));
    t.check('with the preview skipped, the request is still masked', ai.requests.every((r) => findLeaks(r.raw, data).critical.length === 0));
    await clickButton(p, /^Close/);
    // A different action is a first time again.
    await clickButton(p, /^Draft a reply to the customer/);
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    t.check('a different action is previewed again (first time for that action)', (await p.$('.ab-dialog')) !== null);
    await clickButton(p, /^Cancel/);

    // ---- 2. An answer that arrives after switching ticket is dropped --------------------------------------------------------
    await ctx.configure({ previewMode: 'never' });
    await ctx.sleep(300);
    ai.reset();
    ai.setMode('slow');
    await clickButton(p, /^Summarise this ticket/);
    await ctx.sleep(300); // the request is in flight (the fake AI waits 1.5 s)
    await b.bringToFront();
    await waitForText(p, 'INC0010100', { timeout: 10000 });
    await ctx.sleep(2500); // the slow answer has now come back
    const text = await panel.text();
    t.check('the AI really received the first ticket\'s request', ai.requests.length === 1);
    t.check('after switching ticket, the late answer is NOT shown on the other ticket', (await p.$('.ab-output')) === null && !text.includes('Abel Tuter reports') && /Summarise this ticket/.test(text), text.replace(/\s+/g, ' ').slice(0, 140));
    t.check('nothing was written into either form', (await a.evaluate(() => window.__gformCalls.length)) === 0 && (await b.evaluate(() => window.__gformCalls.length)) === 0);
    ai.setMode('echo');

    // ---- 3. A finished answer does not stay on screen for another ticket ------------------------------------------------
    await a.bringToFront();
    await waitForText(p, 'INC0010001', { timeout: 10000 });
    await clickButton(p, /^Summarise this ticket/);
    await p.waitForSelector('.ab-output', { timeout: 15000 });
    await b.bringToFront();
    await waitForText(p, 'INC0010100', { timeout: 10000 });
    await ctx.sleep(500);
    t.check('a finished answer for ticket A is gone when ticket B is the active tab (no Insert button for it)', (await p.$('.ab-output')) === null && !/Add to work notes/.test(await panel.text()));

    await panel.close();
    await a.close();
    await b.close();
    await ctx.configure({ previewMode: 'always', previewSeen: [] });
  },
};

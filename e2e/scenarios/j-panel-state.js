// j. The panel and what it shows when things change under it:
//    - the "check what is sent" modes (first time / never) behave as promised
//    - answers belong to the ticket they were made for (round 3, TRACKER.md AI0.4): a run that is still going on when the agent
//      moves to another ticket carries on, and its answer is kept for the first ticket; nothing of it is ever shown (or offered for
//      Insert) on the other ticket, which only says in one line that an answer is ready elsewhere. Back on the first ticket, the
//      answers are there again.
const { findLeaks } = require('../leaks.js');
const { clickButton, waitForText, textOf, waitForRecord, openHalf } = require('../ui.js');

const OTHER_ID = 'aa100000000000000000000000000100'; // INC0010100, seeded in e2e/data.entry.js

// The open (not folded) answers on show, and every answer card on show.
const shownAnswers = (p) =>
  p.evaluate(() => {
    const cards = [...document.querySelectorAll('section.ab-answer')].filter((e) => e.getClientRects().length > 0);
    return { all: cards.length, open: cards.filter((c) => !c.classList.contains('is-folded')).map((c) => c.innerText) };
  });

module.exports = {
  id: 'j',
  title: 'Panel state: preview modes, and answers stay with the ticket they were made for',
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
    await openHalf(p, 'assist');

    // ---- 1. "First time per action": shown once, then not again --------------------------------------------------------
    const entries = async () => (await ctx.audit()).filter((e) => e.outcome === 'sent');
    await clickButton(p, /^Summarise this ticket/);
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    t.check('first time: the preview is shown and says it will not be asked again for this action', /not be asked again for this action/.test((await textOf(p, '.ab-dialog-foot')) || ''));
    await clickButton(p, /^Send to AI/);
    await p.waitForSelector('.ab-output', { timeout: 15000 });
    // Try again sits under More on the answer card
    await clickButton(p, /^More/);
    await clickButton(p, /^Try again/);
    await p.waitForFunction(() => document.querySelectorAll('section.ab-answer').length === 2 && document.querySelector('.ab-output'), { timeout: 15000 });
    await ctx.sleep(400);
    t.check('second time for the same action: no preview, the request goes straight out', ai.requests.length === 2 && (await p.$('.ab-dialog')) === null, `${ai.requests.length} requests`);
    const sent = (await entries()).slice(-2); // the two runs of this scenario
    t.check("audit says preview 'shown' the first time and 'skipped' the second time", sent[0]?.preview === 'shown' && sent[1]?.preview === 'skipped', sent.map((e) => e.preview).join(','));
    t.check('with the preview skipped, the request is still masked', ai.requests.every((r) => findLeaks(r.raw, data).critical.length === 0));
    const two = await shownAnswers(p);
    t.check('both answers are kept: the newest open, the earlier one folded', two.all === 2 && two.open.length === 1 && /Earlier: Summarise this ticket/.test(await panel.text()), JSON.stringify({ all: two.all, open: two.open.length }));
    // A different action is a first time again.
    await clickButton(p, /^Draft a reply/);
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    t.check('a different action is previewed again (first time for that action)', (await p.$('.ab-dialog')) !== null);
    await clickButton(p, /^Cancel/);
    await p.waitForFunction(() => !document.querySelector('.ab-dialog'), { timeout: 5000 });
    t.check('after Cancel the answers are still there', (await shownAnswers(p)).all === 2);

    // ---- 2. A run in flight carries on for its ticket ---------------------------------------------------------------------
    await ctx.configure({ previewMode: 'never' });
    await ctx.sleep(300);
    ai.reset();
    ai.setMode('slow');
    await clickButton(p, /^Draft a reply/);
    await ctx.sleep(300); // the request is in flight (the fake AI waits 1.5 s)
    await b.bringToFront();
    await waitForText(p, 'INC0010100', { timeout: 10000 });
    await ctx.sleep(2500); // the slow answer has now come back
    const onB = await panel.text();
    t.check('the AI really received the first ticket\'s request', ai.requests.length === 1);
    t.check('on the other ticket nothing of it is shown: no answer card, no text, its own actions are there', (await shownAnswers(p)).all === 0 && (await p.$('.ab-output')) === null && !onB.includes('Abel Tuter reports') && /Summarise this ticket/.test(onB), onB.replace(/\s+/g, ' ').slice(0, 160));
    t.check('the other ticket says, in one line, that an answer is ready for INC0010001', /INC0010001: an answer is ready\./.test(onB), onB.replace(/\s+/g, ' ').slice(0, 200));
    t.check('nothing was written into either form', (await a.evaluate(() => window.__gformCalls.length)) === 0 && (await b.evaluate(() => window.__gformCalls.length)) === 0);
    ai.setMode('echo');

    // ---- 3. Back on the first ticket: its answers are there, the late one on top -------------------------------------------
    await a.bringToFront();
    await waitForText(p, 'INC0010001', { timeout: 10000 });
    await p.waitForSelector('.ab-output', { timeout: 10000 });
    const back = await shownAnswers(p);
    t.check('back on the first ticket: the reply that arrived meanwhile is open on top, the summaries are kept, folded', back.all === 3 && back.open.length === 1 && /Draft a reply/.test(back.open[0]), JSON.stringify({ all: back.all, open: back.open.map((x) => x.slice(0, 40)) }));
    t.check('...and the line about it is gone', !/an answer is ready/.test(await panel.text()));

    // ---- 4. A finished answer does not follow the agent to another ticket -----------------------------------------------
    await b.bringToFront();
    await waitForText(p, 'INC0010100', { timeout: 10000 });
    await ctx.sleep(500);
    t.check('on ticket B no answer of ticket A is on screen (no Insert button for it)', (await p.$('.ab-output')) === null && !/Add to work notes|Insert as customer comment/.test(await panel.text()));

    // ---- 5. A Save on the page (TRACKER.md N1): the form reloads, and the header follows on the same ticket -------------------
    // The agent saved the incident On Hold on the form: the instance has the new state and the classic form reloads, as Save does.
    await a.bringToFront();
    await waitForText(p, 'INC0010001', { timeout: 10000 });
    await openHalf(p, 'insights');
    const row = inst.state.tables.incident.find((r) => String(r.sys_id?.value ?? r.sys_id) === data.INCIDENT_ID);
    const savedState = row.state;
    t.check('before the save the header does not say On Hold', !/On Hold/.test(await panel.text()));
    row.state = { value: '3', display_value: 'On Hold' };
    await a.reload({ waitUntil: 'load' });
    const followed = await waitForText(p, 'On Hold', { timeout: 12000 }).then(() => true, () => false);
    t.check('after a Save (the form reloads) the header shows the new state without leaving the ticket', followed, (await panel.text()).replace(/\s+/g, ' ').slice(0, 200));
    row.state = savedState;
    await a.reload({ waitUntil: 'load' });

    await panel.close();
    await a.close();
    await b.close();
    await ctx.configure({ previewMode: 'always', previewSeen: [] });
  },
};

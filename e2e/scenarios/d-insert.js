// d. Insert: the only thing the extension writes is text into ONE field of the open form, on the page, and never over what the
//    agent already typed. Classic forms are filled through g_form; Workspace pages have no g_form, so there is a DOM fallback.
//    A reply that would go to the customer is checked for card numbers and passwords first.
const { clickButton, waitForText, textOf, runFeature, waitForRecord, deepTextareaValue } = require('../ui.js');
const { TYPED_WORK_NOTES } = require('../fakeInstance.js');

module.exports = {
  id: 'd',
  title: 'Insert into the form: g_form append, Workspace DOM fallback, safe-to-send check',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.configure(
      { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', previewMode: 'always', previewSeen: [], instances: [inst.origin] },
      { key: { provider: 'custom', value: ai.key } }
    );

    // ---- 1. Classic form: append to work notes -------------------------------------------------------------------------
    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-classic');
    let panel = await ctx.openPanel();
    await waitForRecord(panel.page);
    const ran = await runFeature(panel.page, /^Summarise this ticket/);
    t.check('summary produced for the classic page', Boolean(ran.result), ran.error || '');
    const summaryLine = 'Issue: Abel Tuter reports a recurring VPN problem.';
    t.check('before inserting, the form still holds only what the agent typed', (await ticket.evaluate(() => window.__gformCalls.length)) === 0 && (await ticket.evaluate(() => window.g_form.getValue('work_notes'))) === TYPED_WORK_NOTES);

    await clickButton(panel.page, /^Add to work notes/);
    await waitForText(panel.page, /Inserted into the form|Copied to the clipboard|blocked copying|could not/i, { timeout: 8000 });
    const note = await textOf(panel.page, '.ab-note-ok, .ab-note-danger');
    const calls = await ticket.evaluate(() => window.__gformCalls);
    t.check('panel says it was inserted and reminds the agent to save', /^Inserted into the form\. Review it, then save the record yourself\./.test(note || ''), note || '');
    t.check('g_form received exactly one setValue, for work_notes', calls.length === 1 && calls[0].fn === 'setValue' && calls[0].name === 'work_notes', JSON.stringify(calls).slice(0, 200));
    t.check('what the agent had typed is kept, the AI text is APPENDED after it', calls[0]?.value.startsWith(`${TYPED_WORK_NOTES}\n\n`) && calls[0].value.includes(summaryLine), (calls[0]?.value || '').replace(/\n/g, '\\n').slice(0, 160));
    t.check('the visible field shows the combined text', (await ticket.evaluate(() => document.getElementById('incident.work_notes').value)) === calls[0]?.value);
    t.check('inserted text contains the REAL names (rehydrated), no placeholders', calls[0]?.value.includes('Abel Tuter') && !/\[[A-Z_]{2,20}_\d+\]/.test(calls[0].value));
    t.check('the extension never saved or submitted the form', (await ticket.evaluate(() => window.__gformSaves.length)) === 0);
    t.check("no other field was touched (comments and close_notes are still empty)", (await ticket.evaluate(() => window.g_form.getValue('comments') === '' && window.g_form.getValue('close_notes') === '')));
    const afterInsert = await ctx.audit();
    t.check("audit log records outcome 'inserted'", afterInsert.some((e) => e.outcome === 'inserted' && e.feature === 'record-summary'));

    // ---- 2. Safe-to-send: a customer-visible reply that contains a card number and a password ---------------------------
    await clickButton(panel.page, /^Close/);
    const reply = await runFeature(panel.page, /^Draft a reply to the customer/);
    t.check('reply draft produced', Boolean(reply.result), reply.error || '');
    t.check('the draft (rehydrated locally) now contains the real card number and password', Boolean(reply.result) && reply.result.includes(data.SEED.card) && reply.result.includes(data.SEED.password), (reply.result || '').replace(/\s+/g, ' ').slice(0, 160));
    const callsBefore = (await ticket.evaluate(() => window.__gformCalls.length));
    await clickButton(panel.page, /^Insert as customer comment/);
    await panel.page.waitForSelector('.ab-note-warn[role="alert"]', { timeout: 8000 });
    const warn = await textOf(panel.page, '.ab-note-warn[role="alert"]');
    t.check('safe-to-send check intercepts the insert and says what it found', /Check before sending to the customer/.test(warn) && /card/i.test(warn) && /password|secret|credential|token/i.test(warn), warn.replace(/\s+/g, ' '));
    t.check('the warning shows masked excerpts only (never the full card number or password)', !warn.includes(data.SEED.card) && !warn.includes(data.SEED.cardDigits) && !warn.includes(data.SEED.password));
    t.check('nothing was written to the comments field while the warning is shown', (await ticket.evaluate(() => window.__gformCalls.length)) === callsBefore && (await ticket.evaluate(() => window.g_form.getValue('comments'))) === '');
    await clickButton(panel.page, /^Insert anyway/);
    await waitForText(panel.page, /Inserted into the form/, { timeout: 8000 });
    const forced = await ticket.evaluate(() => window.__gformCalls.slice(-1)[0]);
    t.check("'Insert anyway' is a deliberate override: then the comments field is filled", forced?.name === 'comments' && forced.value.includes('Issue:'), JSON.stringify(forced).slice(0, 120));
    await panel.close();

    // ---- 3. Workspace page: no g_form -> DOM fallback ------------------------------------------------------------------
    const ws = await ctx.openInstancePage(`/now/sow/record/incident/${data.INCIDENT_ID}`, 'ticket-workspace');
    panel = await ctx.openPanel();
    await waitForText(panel.page, 'Summarise this ticket', { timeout: 15000 });
    const typedBefore = await ws.evaluate(deepTextareaValue, 'Work notes');
    t.check('workspace: the shadow-DOM work notes textarea starts with the agent\'s own text', typeof typedBefore === 'string' && typedBefore.startsWith('Called the customer back'), String(typedBefore));
    const wsRun = await runFeature(panel.page, /^Summarise this ticket/);
    t.check('summary produced for the workspace page', Boolean(wsRun.result), wsRun.error || '');
    await clickButton(panel.page, /^Add to work notes/);
    await waitForText(panel.page, /Inserted into the form|Copied to the clipboard|blocked copying|Could not/i, { timeout: 8000 });
    const wsNote = await textOf(panel.page, '.ab-note-ok, .ab-note-danger');
    const typedAfter = await ws.evaluate(deepTextareaValue, 'Work notes');
    const filled = typedAfter !== typedBefore;
    t.info(`workspace insert outcome: ${wsNote}`);
    t.check('workspace: either the shadow textarea was filled or a clear clipboard fallback was reported', filled || /Copied to the clipboard|blocked copying/.test(wsNote || ''), wsNote || '');
    t.check('workspace: filling the textarea kept what the agent had typed (appended, not replaced)', !filled || String(typedAfter).startsWith(typedBefore), `before="${typedBefore}" after="${String(typedAfter).slice(0, 80)}"`);
    t.check('workspace: the other textarea (Additional comments) was not touched', (await ws.evaluate(deepTextareaValue, 'Additional comments')) === '');
    if (filled) {
      const events = await ws.evaluate(() => window.__wsEvents);
      t.check('workspace: the component saw input and change events (written like typing, so its state follows)', events.input >= 1 && events.change >= 1, JSON.stringify(events));
    }
    await panel.close();
    await ws.close();
    await ticket.close();
  },
};

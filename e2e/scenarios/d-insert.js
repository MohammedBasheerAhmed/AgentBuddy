// d. Insert: the only thing the extension writes is text into ONE field of the open form, on the page, and never over what the
//    agent already typed. Classic forms are filled through g_form; Workspace pages have no g_form, so there is a DOM fallback.
//    A reply that would go to the customer is checked for card numbers and passwords first.
//    Round 3 (TRACKER.md F5): the card says where the text lands and the next step before the click (Save; Post in a Workspace,
//    whose composer is one box for both kinds); "Try again" then Insert again leaves ONE copy, not two; resolution notes REPLACE what
//    the box holds; "Edit first" opens the edit box instead of inserting.
//    AI9: an AI email draft on the Ticket screen opens the email form of that ticket in a new tab and carries the draft there; Insert
//    subject / Insert body fill the email form (subject replaced, body below), nothing is saved or sent, the ticket tab stays put.
const { clickButton, waitForText, textOf, runFeature, waitForRecord, deepTextareaValue, openHalf } = require('../ui.js');
const { TYPED_WORK_NOTES } = require('../fakeInstance.js');
const { leftoverPlaceholders } = require('../common.js');

const INSERTED = /^Inserted\. Review it\. Then press Save\./;
const count = (text, part) => String(text || '').split(part).length - 1;

/** Unfold "More actions" in AI Assist when it is folded (the actions that do not fit the ticket's state wait there). */
async function openMoreActions(p) {
  await openHalf(p, 'assist');
  await p.evaluate(() => {
    const more = window.__vis(document.querySelectorAll('.ab-act-moretoggle')).find((b) => b.getAttribute('aria-expanded') === 'false');
    if (more) more.click();
  });
}

/** The newest answer's last note: what its last insert or copy did (answers are kept, newest first; a "kept hidden" notice comes first). */
const newestNote = (p) =>
  p.evaluate(() => {
    const notes = window.__vis(document.querySelectorAll('.ab-answer'))[0]?.querySelectorAll('.ab-note[role="status"]') || [];
    return notes.length ? notes[notes.length - 1].innerText : null;
  });
const newestHint = (p) => p.evaluate(() => window.__vis(document.querySelectorAll('.ab-answer'))[0]?.querySelector('.ab-answer-hint, .ab-answer-caution')?.innerText ?? null);

module.exports = {
  id: 'd',
  title: 'Insert into the form: append without doubling, replace resolution notes, Workspace DOM fallback, safe-to-send check',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    await ctx.ensureEnabled();
    inst.setBehaviour();
    await ctx.configure(
      { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', previewMode: 'always', previewSeen: [], instances: [inst.origin], quickPins: {}, aiSkipped: false },
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
    await waitForText(panel.page, /Inserted\. Review it|Copied to the clipboard|blocked copying|could not/i, { timeout: 8000 });
    const note = await newestNote(panel.page);
    const calls = await ticket.evaluate(() => window.__gformCalls);
    t.check('panel says it was inserted and names the next step (Save)', INSERTED.test(note || ''), note || '');
    t.check('g_form received exactly one setValue, for work_notes', calls.length === 1 && calls[0].fn === 'setValue' && calls[0].name === 'work_notes', JSON.stringify(calls).slice(0, 200));
    t.check('what the agent had typed is kept, the AI text is APPENDED after it', calls[0]?.value.startsWith(`${TYPED_WORK_NOTES}\n\n`) && calls[0].value.includes(summaryLine), (calls[0]?.value || '').replace(/\n/g, '\\n').slice(0, 160));
    t.check('the visible field shows the combined text', (await ticket.evaluate(() => document.getElementById('incident.work_notes').value)) === calls[0]?.value);
    t.check('inserted text contains the REAL names (rehydrated); only the card and password stay as markers', calls[0]?.value.includes('Abel Tuter') && leftoverPlaceholders(calls[0].value).length === 0 && !calls[0].value.includes(data.SEED.card) && !calls[0].value.includes(data.SEED.password));
    t.check('the extension never saved or submitted the form', (await ticket.evaluate(() => window.__gformSaves.length)) === 0);
    t.check("no other field was touched (comments and close_notes are still empty)", (await ticket.evaluate(() => window.g_form.getValue('comments') === '' && window.g_form.getValue('close_notes') === '')));
    const afterInsert = await ctx.audit();
    t.check("audit log records outcome 'inserted'", afterInsert.some((e) => e.outcome === 'inserted' && e.feature === 'record-summary'));

    // ---- 1b. Try again, then Insert again: one summary in the work notes, not two -------------------------------------------
    const again = await runFeature(panel.page, /^Summarise this ticket/);
    t.check('a second summary (a new answer, kept above the first)', Boolean(again.result), again.error || '');
    await clickButton(panel.page, /^Add to work notes/);
    await waitForText(panel.page, /Inserted\. Review it/, { timeout: 8000 });
    const twice = await ticket.evaluate(() => window.g_form.getValue('work_notes'));
    t.check('the second insert SWAPPED the first one: what the agent typed, then one summary (no duplicate)', twice.startsWith(`${TYPED_WORK_NOTES}\n\n`) && count(twice, summaryLine) === 1, twice.replace(/\n/g, '\\n').slice(0, 200));

    // ---- 1c. Resolution notes REPLACE what is in the box (Try again + Insert never doubles them) ------------------------------
    await ticket.evaluate(() => {
      const el = document.getElementById('incident.close_notes');
      el.value = 'fixed';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await openMoreActions(panel.page);
    const notesRun = await runFeature(panel.page, /^Write resolution notes/);
    t.check('resolution notes produced', Boolean(notesRun.result), notesRun.error || '');
    const where = await newestHint(panel.page);
    t.check('before the click the card says where the text lands and the next step', /^Replaces what is in Resolution notes, which the customer can often read\. Set State to Resolved, then save\./.test(where || ''), where || '');
    await clickButton(panel.page, /^Insert into resolution notes/);
    await waitForText(panel.page, /Inserted\. Review it|Check before/, { timeout: 8000 });
    if (await panel.page.$('.ab-note-warn[role="alert"]')) await clickButton(panel.page, /^Insert anyway/);
    const closeNotes = await ticket.evaluate(() => window.g_form.getValue('close_notes'));
    t.check('the typed "fixed" was replaced, not added to; the close-code advice stayed out', !closeNotes.startsWith('fixed') && closeNotes.trim().length > 10 && !/Suggested close code/i.test(closeNotes), closeNotes.replace(/\n/g, '\\n').slice(0, 160));

    // ---- 2. Safe-to-send: a customer-visible reply that contains a card number and a password ---------------------------
    const reply = await runFeature(panel.page, /^Draft a reply to the customer/);
    t.check('reply draft produced', Boolean(reply.result), reply.error || '');
    t.check('the draft has the real names back but keeps the card number and password hidden as markers', Boolean(reply.result) && reply.result.includes(data.SEED.callerName) && /\[CARD_\d+\]/.test(reply.result) && /\[SECRET_\d+\]/.test(reply.result) && !reply.result.includes(data.SEED.card) && !reply.result.includes(data.SEED.password), (reply.result || '').replace(/\s+/g, ' ').slice(0, 160));
    const replyWhere = await newestHint(panel.page);
    t.check('the reply card says the comment reaches the customer, and that the customer may be emailed', /Additional comments, which the customer sees\. Then press Save\. The customer may be emailed\./.test(replyWhere || ''), replyWhere || '');
    const callsBefore = await ticket.evaluate(() => window.__gformCalls.length);
    await clickButton(panel.page, /^Insert as customer comment/);
    await panel.page.waitForSelector('.ab-note-warn[role="alert"]', { timeout: 8000 });
    const warn = await textOf(panel.page, '.ab-note-warn[role="alert"]');
    t.check('safe-to-send check intercepts the insert and says what it found', /Check before sending to the customer/.test(warn) && /card/i.test(warn) && /password|secret|credential|token/i.test(warn), warn.replace(/\s+/g, ' '));
    t.check('the warning shows masked excerpts only (never the full card number or password)', !warn.includes(data.SEED.card) && !warn.includes(data.SEED.cardDigits) && !warn.includes(data.SEED.password));
    t.check('nothing was written to the comments field while the warning is shown', (await ticket.evaluate(() => window.__gformCalls.length)) === callsBefore && (await ticket.evaluate(() => window.g_form.getValue('comments'))) === '');
    // "Edit first": the edit box opens with the text; nothing is written until its own Insert.
    await clickButton(panel.page, /^Edit first/);
    await panel.page.waitForSelector('.ab-insert-editor textarea', { timeout: 8000 });
    t.check("'Edit first' opens the edit box with the text, and writes nothing", (await ticket.evaluate(() => window.__gformCalls.length)) === callsBefore && /\[CARD_\d+\]/.test(await panel.page.evaluate(() => window.__vis(document.querySelectorAll('.ab-insert-editor textarea'))[0]?.value || '')));
    await clickButton(panel.page, /^Cancel$/);
    await clickButton(panel.page, /^Insert as customer comment/);
    await panel.page.waitForSelector('.ab-note-warn[role="alert"]', { timeout: 8000 });
    await clickButton(panel.page, /^Insert anyway/);
    await waitForText(panel.page, /The customer may be emailed/, { timeout: 8000 });
    const forced = await ticket.evaluate(() => window.__gformCalls.slice(-1)[0]);
    t.check("'Insert anyway' is a deliberate override: then the comments field is filled", forced?.name === 'comments' && forced.value.length > 20, JSON.stringify(forced).slice(0, 120));

    // A secret that comes back as a BARE value (no "password:" in front of it). The firewall learned that value when it
    // masked it, but the safe-to-send check on insert only knows the usual patterns. A real gap if it is not flagged.
    ai.setMode('bare-secret');
    const bare = await runFeature(panel.page, /^Draft a reply to the customer/);
    t.check('a model that repeats [SECRET_1] does NOT get the real password back: the draft keeps the marker', Boolean(bare.result) && !bare.result.includes(data.SEED.password) && /\[SECRET_\d+\]/.test(bare.result), bare.error || (bare.result || '').slice(0, 120));
    const bareCalls = await ticket.evaluate(() => window.__gformCalls.length);
    await clickButton(panel.page, /^Insert as customer comment/);
    await panel.page.waitForFunction(() => document.querySelector('.ab-note-warn[role="alert"]') || /Inserted\. Review it|Copied to the clipboard|blocked copying/.test(window.__vis(document.querySelectorAll('.ab-answer'))[0]?.innerText || ''), { timeout: 8000 });
    const bareStopped = (await panel.page.$('.ab-note-warn[role="alert"]')) !== null;
    const bareWritten = (await ticket.evaluate(() => window.__gformCalls.length)) > bareCalls;
    t.check('a secret repeated as a bare value is also stopped before it goes into a customer-visible comment', bareStopped && !bareWritten, bareWritten ? 'the password was inserted into the customer comment without a warning' : '');
    ai.setMode('echo');
    t.check('the extension never saved or submitted the form (after all of the above)', (await ticket.evaluate(() => window.__gformSaves.length)) === 0);
    await panel.close();

    // ---- 3. Workspace page: no g_form -> DOM fallback ------------------------------------------------------------------
    const ws = await ctx.openInstancePage(`/now/sow/record/incident/${data.INCIDENT_ID}`, 'ticket-workspace');
    panel = await ctx.openPanel();
    await waitForRecord(panel.page);
    const typedBefore = await ws.evaluate(deepTextareaValue, 'Work notes');
    t.check('workspace: the shadow-DOM work notes textarea starts with the agent\'s own text', typeof typedBefore === 'string' && typedBefore.startsWith('Called the customer back'), String(typedBefore));
    const wsRun = await runFeature(panel.page, /^Summarise this ticket/);
    t.check('summary produced for the workspace page', Boolean(wsRun.result), wsRun.error || '');
    const wsCaution = await panel.page.evaluate(() => window.__vis(document.querySelectorAll('.ab-answer'))[0]?.querySelector('.ab-answer-caution')?.innerText ?? '');
    t.check('workspace: before the click the card warns that the composer may be one box for both kinds', /check it is set to Work notes before you post/.test(wsCaution), wsCaution);
    await clickButton(panel.page, /^Add to work notes/);
    await waitForText(panel.page, /Inserted\. Review it|Copied to the clipboard|blocked copying|Could not/i, { timeout: 8000 });
    const wsNote = await newestNote(panel.page);
    const typedAfter = await ws.evaluate(deepTextareaValue, 'Work notes');
    const filled = typedAfter !== typedBefore;
    t.info(`workspace insert outcome: ${wsNote}`);
    t.check('workspace: either the shadow textarea was filled or a clear clipboard fallback was reported', filled || /Copied to the clipboard|blocked copying/.test(wsNote || ''), wsNote || '');
    t.check('workspace: after the insert the next step is Post, and the box that was used is named', !filled || /Then press Post\. It went into the box labelled "Work notes"/.test(wsNote || ''), wsNote || '');
    t.check('workspace: filling the textarea kept what the agent had typed (appended, not replaced)', !filled || String(typedAfter).startsWith(typedBefore), `before="${typedBefore}" after="${String(typedAfter).slice(0, 80)}"`);
    t.check('workspace: the other textarea (Additional comments) was not touched', (await ws.evaluate(deepTextareaValue, 'Additional comments')) === '');
    if (filled) {
      const events = await ws.evaluate(() => window.__wsEvents);
      t.check('workspace: the component saw input and change events (written like typing, so its state follows)', events.input >= 1 && events.change >= 1, JSON.stringify(events));
    }
    await panel.close();
    await ws.close();

    // ---- 4. An AI email draft goes into the email form of THIS ticket (AI9) ---------------------------------------------------
    // The answer offers "Open the email form": the email client opens in a new tab (the ticket stays as it is), the panel follows it,
    // and the draft it carried is offered there with Insert subject / Insert body. Nothing is saved or sent.
    const SUBJECT = 'An update on your VPN problem';
    ai.setReplier(({ system, user }) => {
      if (!/write an email to the person who raised a ServiceNow ticket/.test(system)) return null;
      const person = (/\[PERSON_\d+\]/.exec(user) || ['there'])[0];
      return `Subject: ${SUBJECT}\n\nHello ${person},\n\nYour request is being looked at. We will write again when there is news.\n\nKind regards`;
    });
    await ticket.bringToFront();
    panel = await ctx.openPanel();
    await waitForRecord(panel.page);
    const mail = await runFeature(panel.page, /^Draft a status update email/);
    t.check('email draft produced on the Ticket screen, with the real name back in', Boolean(mail.result) && mail.result.includes(`Subject: ${SUBJECT}`) && mail.result.includes(data.SEED.callerName), mail.error || (mail.result || '').slice(0, 120));
    const mailRow = await panel.page.evaluate(() => [...(window.__vis(document.querySelectorAll('.ab-answer'))[0]?.querySelectorAll('.ab-answer-actions button') || [])].map((b) => b.innerText.trim()));
    t.check('the email answer offers Open the email form and Copy body, then Refine and More (four buttons)', JSON.stringify(mailRow) === JSON.stringify(['Open the email form', 'Copy body', 'Refine', 'More']), mailRow.join(' | '));
    const ticketUrl = ticket.url();
    const targetsBefore = new Set(ctx.browser.targets());
    await clickButton(panel.page, /^Open the email form/);
    const opened = await ctx.browser.waitForTarget((x) => !targetsBefore.has(x) && x.url().includes('/email_client.do'), { timeout: 10000 }).catch(() => null);
    t.check('"Open the email form" opened the email client of this ticket in a NEW tab, on the same instance', Boolean(opened) && opened.url().startsWith(`${inst.origin}/email_client.do?sysparm_table=incident&sysparm_sys_id=${data.INCIDENT_ID}`), opened?.url() || 'no new tab');
    t.check('...and the ticket tab stayed where it was', ticket.url() === ticketUrl, ticket.url());
    if (opened) {
      const mailTab = await opened.page();
      await mailTab.waitForFunction(() => window.__gformReady === true, { timeout: 10000 });
      // The panel follows the tab in front: the carried draft waits there.
      await waitForText(panel.page, `Email draft for ${data.INCIDENT_NUMBER}`, { timeout: 20000 });
      const card = (await textOf(panel.page, '.ab-pending-email')) || '';
      t.check('on the email form the draft is shown, AI-marked, with Insert subject and Insert body, and says nothing is sent until Send', /Insert subject/.test(card) && /Insert body/.test(card) && /Nothing is sent until you press Send/.test(card) && (await panel.page.evaluate(() => Boolean(window.__vis(document.querySelectorAll('.ab-pending-email .ab-ai-badge')).length))), card.replace(/\s+/g, ' ').slice(0, 200));
      t.check('the email form starts empty', await mailTab.evaluate(() => window.g_form.getValue('subject') === '' && window.g_form.getValue('body') === ''));

      await clickButton(panel.page, /^Insert subject/);
      await waitForText(panel.page, /Inserted\. Review it\. Nothing is sent until you press Send/, { timeout: 8000 });
      t.check('Insert subject: the subject box holds the subject line, with the ticket number kept in front', (await mailTab.evaluate(() => window.g_form.getValue('subject'))) === `${data.INCIDENT_NUMBER}: ${SUBJECT}`, await mailTab.evaluate(() => window.g_form.getValue('subject')));
      await clickButton(panel.page, /^Insert body/);
      await panel.page.waitForFunction(() => /The draft is in the email form|Check before/.test(document.body.innerText), { timeout: 8000 });
      if (await panel.page.$('.ab-note-warn[role="alert"]')) await clickButton(panel.page, /^Insert anyway/);
      await waitForText(panel.page, /The draft is in the email form\. Review it\. Nothing is sent until you press Send/, { timeout: 8000 });
      const mailCalls = await mailTab.evaluate(() => window.__gformCalls);
      const mailBody = await mailTab.evaluate(() => window.g_form.getValue('body'));
      t.check('Insert body: the body box holds the body (with the real name), without the Subject line', mailBody.startsWith(`Hello ${data.SEED.callerName},`) && /We will write again/.test(mailBody) && !/Subject:/.test(mailBody), mailBody.replace(/\n/g, '\\n').slice(0, 160));
      t.check('one setValue each, for subject then body; the recipients were not touched; nothing saved or sent', mailCalls.map((c) => c.name).join(',') === 'subject,body' && (await mailTab.evaluate(() => window.__gformSaves.length)) === 0 && (await mailTab.evaluate(() => window.g_form.getValue('recipients'))) === '', mailCalls.map((c) => c.name).join(','));
      t.check('the draft is used up: the card is gone once both went in', !(await panel.page.evaluate(() => /Insert subject|Insert body/.test(document.body.innerText))));
      const mailAudit = (await ctx.audit()).filter((e) => e.feature === 'email-status-update');
      t.check("audit log: two 'inserted' entries for the email draft, no text in them", mailAudit.filter((e) => e.outcome === 'inserted').length === 2 && !JSON.stringify(mailAudit).includes(SUBJECT), JSON.stringify(mailAudit).slice(0, 200));
      t.check("the ticket form itself was not touched by the email inserts", (await ticket.evaluate(() => window.__gformCalls.every((c) => c.name !== 'subject' && c.name !== 'body'))) && (await ticket.evaluate(() => window.__gformSaves.length)) === 0);
      await mailTab.close();
    }
    // Back on the ticket the answer is still there (the email form opened in its own tab).
    await ticket.bringToFront();
    await waitForRecord(panel.page);
    await waitForText(panel.page, 'Draft a status update email', { timeout: 15000 });
    t.check('back on the ticket, its email answer is still on the Ticket screen', /Open the email form/.test(await panel.page.evaluate(() => document.body.innerText)));
    ai.setReplier(null);
    await panel.close();
    await ticket.close();
  },
};

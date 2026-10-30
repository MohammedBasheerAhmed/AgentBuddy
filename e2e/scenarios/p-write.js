// p. The Write tab, through the real panel and content script: Email, Rewrite, Notes to ticket, Snippets.
//   Email     chips that fit the record's state; draft one kind; the result renders; "Open the email form" navigates the SAME tab to
//             the instance's email form (same origin only); "Insert into the email body" falls back to Copy when the form has no
//             body field, and fills the body once the email form is open
//   Rewrite   text from the form or pasted (with a name, email, phone, card and password): nothing personal reaches the AI;
//             "Replace what is in the form" replaces, "Add below" appends; a customer-visible field is guarded by the safe-to-send check
//   Notes     on a blank new-incident form the proposed fields fill ONLY the five whitelisted fields with mapped choice values; a value
//             the AI invented is not filled; on a saved record there is only Copy; the draft can be carried to a blank incident form
//   Snippets  create, preview against the open record, insert as work note, insert as customer comment (a password is stopped),
//             export through the clipboard and import it again
const { findLeaks } = require('../leaks.js');
const { prepare, errorMark, errorsSince, describeErrors, clickTab, clickButton, waitForText, textOf, checkAiRun, runAfter, captureClipboard, clipboardLog, loadingElements, settleOnRecord, waitPanel } = require('../common.js');

const first = (text, kind) => (new RegExp(`\\[${kind}_\\d+\\]`).exec(text) || [''])[0];
const partOf = (user, label) => (new RegExp(`label="${label}">\\n([\\s\\S]*?)\\n</ticket_data>`).exec(user) || [])[1] || '';

// The notes the second Notes run is given; the AI answers with a made-up impact and a made-up channel for this one.
let notesMode = 'good';

function replier({ system, user }) {
  const person = first(user, 'PERSON') || 'there';
  if (/write an email to the person who raised a ServiceNow ticket/.test(system)) {
    return `Subject: An update on your request\n\nHello ${person},\n\nThe print spooler was restarted and your printer should work again. Please reply if the problem is still there.\n\nKind regards`;
  }
  if (/improve a piece of text they wrote/.test(system)) {
    // A rewrite that keeps every placeholder, as the prompt asks. The real values come back locally.
    return `Rewritten: ${partOf(user, 'Text to rewrite')}`;
  }
  if (/log a ticket from rough call/.test(system)) {
    if (notesMode === 'invented') {
      return 'Short description: Cannot sign in to the sales portal\nDescription: The sales team cannot sign in since this morning. Error 809.\nImpact: Catastrophic\nUrgency: ASAP\nCategory hint: access\nContact type: Carrier pigeon\nQuestions still to ask:\n1. Which browser is used?';
    }
    return 'Short description: VPN is down for the sales team since this morning\nDescription: The VPN has been down since this morning for the sales team. Error 809. A restart did not help.\nImpact: High\nUrgency: Medium\nCategory hint: network\nContact type: Phone\nQuestions still to ask:\n1. Which VPN client version is installed?\n2. Do other teams see the same?';
  }
  return null;
}

const CHIP_SELECTOR = '[aria-label="Suggested emails"] .ab-compose-row';
const chips = (p) =>
  p.evaluate((sel) => window.__vis(document.querySelectorAll(sel)).map((li) => ({ title: li.querySelector('.ab-compose-row-title').innerText.trim(), why: (li.querySelector('.ab-sub')?.innerText || '').trim(), primary: li.querySelector('button').className.includes('ab-btn-primary') })), CHIP_SELECTOR);
const facts = (p) => p.evaluate(() => window.__vis(document.querySelectorAll('[aria-label="What the suggestions are based on"] .ab-tag')).map((x) => x.innerText.trim()));

module.exports = {
  id: 'p',
  title: 'Write tab: email suggestions and draft, rewrite with masking and replace/append, notes to a blank ticket form, snippets with export and import',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    await prepare(ctx);
    ai.setReplier(replier);
    const mark = errorMark(ctx);
    const panel = await ctx.openPanel();
    const p = panel.page;
    const note = () => p.evaluate(() => document.querySelector('.ab-compose-actions .ab-note, [role="status"].ab-note')?.innerText || '');
    const subTab = (name) => clickTab(p, name);

    // ============================== EMAIL ==============================================================================================
    let ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.EMAIL_RESOLVED_ID}`, 'ticket-resolved');
    await waitForText(p, 'INC0020001', { timeout: 20000 });
    await clickTab(p, 'Write');
    await waitForText(p, 'Which email fits?', { timeout: 20000 });
    await p.waitForSelector(CHIP_SELECTOR, { timeout: 15000 });

    // Which email fits each record's state (the chips come from rules on the record, no AI)
    const expectTop = async (label, ticketPath, number, title, whyRe, factRe) => {
      if (label !== 'resolved') {
        await ticket.close();
        ticket = await ctx.openInstancePage(ticketPath, `ticket-${label}`);
        await ctx.waitUntil(`the email suggestions for ${number}`, async () => (await chips(p))[0]?.title === title, { timeout: 25000 });
      }
      const rows = await chips(p);
      const fs = await facts(p);
      t.check(`Email chips for ${label} (${number}): the first suggestion is "${title}", marked as the main one`, rows[0]?.title === title && rows[0].primary, JSON.stringify(rows.map((r) => r.title)));
      t.check(`...with a reason in plain words (${whyRe})`, whyRe.test(rows[0]?.why || ''), rows[0]?.why);
      if (factRe) t.check(`...and the facts it is based on (${factRe})`, fs.some((f) => factRe.test(f)), fs.join(' | '));
      return rows;
    };
    await expectTop('resolved', '', 'INC0020001', 'Resolution', /marked resolved and the person has not been told yet/, /^Resolved/);
    await expectTop('on-hold', `/incident.do?sys_id=${data.EMAIL_HOLD_ID}`, 'INC0020002', 'Ask for information', /waiting for the person's reply.*friendly reminder|reminder/i, /Awaiting Caller|You wrote/);
    await expectTop('sla-missed', `/incident.do?sys_id=${data.EMAIL_SLA_ID}`, 'INC0020003', 'Apology for the wait', /service level target was missed/i, /Service level missed/);
    await expectTop('approval', `/sc_req_item.do?sys_id=${data.RITM_ID}`, 'RITM0010050', 'Approval reminder', /approval.*still waiting/i, /approval.* waiting/i);
    t.check('the suggestions made no AI request', ai.requests.length === 0);
    await ticket.close();

    // Draft one kind on the resolved incident
    ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.EMAIL_RESOLVED_ID}`, 'ticket-resolved');
    await ctx.waitUntil('the chips', async () => (await chips(p)).length > 0 && (await chips(p))[0].title === 'Resolution', { timeout: 20000 });
    await captureClipboard(p);
    let before = ai.requests.length;
    let ran = await runAfter(p, () => p.click('button[aria-label="Draft: Resolution"]'));
    await checkAiRun(t, ctx, p, 'email-resolution', ran, { before, system: /write an email to the person who raised a ServiceNow ticket/, userHas: [/Status worked out by Agent Buddy/i, /marked resolved/i] });
    t.check('the draft shows the customer by name again (put back locally)', /Hello Abel Tuter/.test(ran.result || ''), (ran.result || '').replace(/\s+/g, ' ').slice(0, 100));
    await waitForText(p, 'Use the draft', { timeout: 8000 });
    t.check('the draft offers Copy subject, Copy body, Open the email form and Insert into the email body', await p.evaluate(() => ['Copy subject', 'Copy body', 'Open the email form', 'Insert into the email body'].every((b) => window.__vis(document.querySelectorAll('button')).some((x) => x.innerText.trim() === b))));
    await clickButton(p, /^Copy subject/);
    await ctx.waitUntil('copy subject', async () => (await clipboardLog(p)).length >= 1, { timeout: 5000 });
    t.check('Copy subject copies just the subject line', (await clipboardLog(p)).slice(-1)[0] === 'An update on your request', (await clipboardLog(p)).slice(-1)[0]);

    // Insert into the email body on an INCIDENT form: the form has no body field -> Copy, said plainly, nothing written
    const callsBefore = await ticket.evaluate(() => window.__gformCalls.length);
    await clickButton(p, /^Insert into the email body/);
    await waitForText(p, /That field is not on this form\. Copied to the clipboard instead\.|The browser blocked copying/, { timeout: 8000 });
    t.check('"Insert into the email body" on the incident form (no body field): falls back to Copy with a plain sentence, writes nothing', (await ticket.evaluate(() => window.__gformCalls.length)) === callsBefore && (await clipboardLog(p)).slice(-1)[0]?.startsWith('Hello Abel Tuter'), (await clipboardLog(p)).slice(-1)[0]);

    // Open the email form: the same tab, the same instance, the record in the address
    await clickButton(p, /^Open the email form/);
    await ctx.waitUntil('the tab to open the email form', async () => new URL(ticket.url()).pathname === '/email_client.do', { timeout: 10000 });
    const target = new URL(ticket.url());
    t.check('"Open the email form" navigated the SAME tab to /email_client.do on the same instance, for this record', target.origin === inst.origin && target.searchParams.get('sysparm_table') === 'incident' && target.searchParams.get('sysparm_sys_id') === data.EMAIL_RESOLVED_ID, ticket.url());
    await ticket.waitForFunction(() => window.__gformReady === true, { timeout: 10000 });
    t.check('the email form is a blank sys_email form with an empty body', await ticket.evaluate(() => window.g_form.getTableName() === 'sys_email' && window.g_form.isNewRecord() && window.g_form.getValue('body') === ''));
    // The draft is still on screen (the Email panel stays mounted) and Insert works now
    await ctx.waitUntil('the draft to stay on screen on the email form', async () => (await p.evaluate(() => document.body.innerText)).includes('Use the draft'), { timeout: 15000 });
    await clickButton(p, /^Insert into the email body/);
    await waitForText(p, /Inserted into the form\. Review it, then save the record yourself\./, { timeout: 10000 });
    const emailCalls = await ticket.evaluate(() => window.__gformCalls);
    t.check('on the email form "Insert into the email body" made one setValue on body (the greeting and text), and nothing was saved or sent', emailCalls.length === 1 && emailCalls[0].name === 'body' && /^Hello Abel Tuter,/.test(emailCalls[0].value) && !/\[[A-Z_]+_\d+\]/.test(emailCalls[0].value) && (await ticket.evaluate(() => window.__gformSaves.length)) === 0, JSON.stringify(emailCalls).slice(0, 140));
    t.check('the subject and recipients were not touched', await ticket.evaluate(() => window.g_form.getValue('subject') === '' && window.g_form.getValue('recipients') === ''));
    await ticket.close();
    await clickButton(p, /^Close/).catch(() => {});

    // ============================== REWRITE ============================================================================================
    ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-incident');
    await settleOnRecord(ctx, data.INCIDENT_ID);
    await clickTab(p, 'Write');
    await subTab('Rewrite');
    await p.waitForSelector('#ab-rewrite-text', { visible: true, timeout: 10000 });
    // 1. "Use what I typed in the form": the work notes the agent typed but did not save
    await p.select('#ab-rewrite-field', 'work_notes');
    await clickButton(p, /^Use what I typed in the form/);
    await waitForText(p, /Took the work note from the form\./, { timeout: 10000 });
    t.check('"Use what I typed in the form" reads the UNSAVED work note through the page', (await p.$eval('#ab-rewrite-text', (el) => el.value)) === 'Checking the gateway certificate now.');
    // 2. Pasted text with a name, email, phone, card and password; one more person listed under "Names to hide"
    const pasted = `Hi ${data.SEED.callerName}, ${data.MORE_SEED.rewriteName} will call you on ${data.MORE_SEED.rewritePhone} or write to ${data.MORE_SEED.rewriteEmail}. The card ${data.MORE_SEED.rewriteCard} was refused. Your password: ${data.MORE_SEED.rewritePassword} is temporary.`;
    await p.$eval('#ab-rewrite-text', (el) => { el.value = ''; });
    await p.click('#ab-rewrite-text');
    await p.type('#ab-rewrite-text', pasted, { delay: 0 });
    await p.type('#ab-rewrite-names', data.MORE_SEED.rewriteName);
    await captureClipboard(p);
    before = ai.requests.length;
    ran = await runAfter(p, () => clickButton(p, /^Friendlier/));
    const req = await checkAiRun(t, ctx, p, 'rewrite-friendly', ran, { before, system: /improve a piece of text they wrote/, userHas: [/\[PERSON_\d+\]/, /\[EMAIL_\d+\]/, /\[PHONE_\d+\]/, /\[CARD_\d+\]/, /\[SECRET_\d+\]/] });
    t.check('rewrite: the Priya Raman typed under "Names to hide" was masked too (she is not on the ticket)', req ? !/Priya|Raman/.test(req.raw) : false);
    t.check('rewrite: the answer has the real names and email back, locally only; the card and password stay hidden as markers', [data.SEED.callerName, data.MORE_SEED.rewriteEmail, data.MORE_SEED.rewriteName].every((v) => (ran.result || '').includes(v)) && ![data.MORE_SEED.rewriteCard, data.MORE_SEED.rewritePassword].some((v) => (ran.result || '').includes(v)) && /\[CARD_\d+\]/.test(ran.result || '') && /\[SECRET_\d+\]/.test(ran.result || ''), (ran.result || '').replace(/\s+/g, ' ').slice(0, 140));
    await waitForText(p, 'Use it in the form', { timeout: 8000 });

    // 3. Into the WORK NOTE (internal): replace, then add below
    const typed = 'Checking the gateway certificate now.';
    const callsBefore2 = await ticket.evaluate(() => window.__gformCalls.length);
    await clickButton(p, /^Replace what is in the form/);
    await waitForText(p, /Inserted into the form/, { timeout: 8000 });
    let rcalls = (await ticket.evaluate(() => window.__gformCalls)).slice(callsBefore2);
    const plain = rcalls[0]?.value || '';
    t.check('"Replace what is in the form": one setValue on work_notes with ONLY the rewrite (what was typed is gone, as asked)', rcalls.length === 1 && rcalls[0].name === 'work_notes' && plain.startsWith('Rewritten: Hi Abel Tuter') && !plain.includes(typed), JSON.stringify(rcalls).slice(0, 140));
    t.check('...an internal field gets no customer-visibility warning', (await p.$('.ab-note-warn[role="alert"]')) === null);
    await clickButton(p, /^Add below/);
    await ctx.waitUntil('the append', async () => (await ticket.evaluate(() => window.__gformCalls.length)) >= callsBefore2 + 2, { timeout: 8000 });
    rcalls = (await ticket.evaluate(() => window.__gformCalls)).slice(callsBefore2);
    t.check('"Add below": the second setValue is the first text, a blank line, then the same rewrite again', rcalls[1]?.name === 'work_notes' && rcalls[1].value === `${plain}\n\n${plain}`, JSON.stringify(rcalls[1]).slice(0, 120));
    t.check('...and the visible field shows it', (await ticket.evaluate(() => document.getElementById('incident.work_notes').value)) === rcalls[1]?.value);

    // 4. Into the CUSTOMER comment: the card and password that came back are stopped
    await p.select('#ab-rewrite-field', 'comments');
    const callsBefore3 = await ticket.evaluate(() => window.__gformCalls.length);
    await clickButton(p, /^Replace what is in the form/);
    await p.waitForSelector('.ab-note-warn[role="alert"]', { timeout: 8000 });
    const warn = (await textOf(p, '.ab-note-warn[role="alert"]')) || '';
    t.check('a customer comment: the safe-to-send check stops the card and the password, showing masked excerpts only', /Check before sending to the customer/.test(warn) && /card/i.test(warn) && /password|key|hidden from the AI/i.test(warn) && !warn.includes(data.MORE_SEED.rewriteCard) && !warn.includes(data.MORE_SEED.rewritePassword), warn.replace(/\s+/g, ' ').slice(0, 200));
    t.check('...nothing was written to the comments field while the warning is shown', (await ticket.evaluate(() => window.__gformCalls.length)) === callsBefore3);
    await clickButton(p, /^Edit first/);
    await waitForText(p, /Not inserted\. Copied to the clipboard instead\.|The browser blocked copying/, { timeout: 8000 });
    t.check('"Edit first (copy instead)": the warning closes, nothing is written, the text is copied', (await p.$('.ab-note-warn[role="alert"]')) === null && (await ticket.evaluate(() => window.__gformCalls.length)) === callsBefore3 && (await clipboardLog(p)).slice(-1)[0] === plain);
    await clickButton(p, /^Use as my text/);
    t.check('"Use as my text" puts the rewrite back in the box so it can be rewritten again', (await p.$eval('#ab-rewrite-text', (el) => el.value)).startsWith('Rewritten: Hi Abel Tuter'));
    t.check('nothing in the Write tab loads or runs (no image, link, frame or inline script)', (await loadingElements(p)) === 0);
    await p.$eval('#ab-rewrite-text', (el) => { el.value = ''; });
    await ticket.close();

    // ============================== NOTES TO TICKET ====================================================================================
    // A saved record first: the proposal is shown, but there is nothing to fill
    ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-incident');
    await settleOnRecord(ctx, data.INCIDENT_ID);
    await subTab('Notes to ticket');
    await p.click('#ab-notes-text');
    await p.type('#ab-notes-text', `vpn down since this morning, error 809, tried restart, urgent for sales team. caller ${data.MORE_SEED.rewriteName} on ${data.MORE_SEED.rewritePhone}`, { delay: 0 });
    await p.type('#ab-notes-names', data.MORE_SEED.rewriteName);
    before = ai.requests.length;
    ran = await runAfter(p, () => clickButton(p, /^Write the ticket/));
    await checkAiRun(t, ctx, p, 'notes-to-ticket', ran, { before, system: /log a ticket from rough call/, userHas: [/label="Call notes"/, /\[PHONE_\d+\]/] });
    await waitForText(p, 'Review, then fill the form', { timeout: 8000 });
    const savedPlan = await p.evaluate(() => ({ fillDisabled: window.__vis(document.querySelectorAll('button')).find((b) => /^Fill the form/.test(b.innerText.trim()))?.disabled, reason: document.querySelector('[aria-label="Review before filling the form"] .ab-note[role="status"]')?.innerText || '' }));
    t.check('on a SAVED record the form cannot be filled: the button is off and says why; Copy buttons remain', savedPlan.fillDisabled === true && /only offered on a blank ticket form/.test(savedPlan.reason), JSON.stringify(savedPlan));
    t.check('the proposal is shown for review: short description, description, and the questions still to ask', (await p.$eval('#ab-notes-short', (el) => el.value)).startsWith('VPN is down for the sales team') && (await p.evaluate(() => document.body.innerText)).includes('Which VPN client version is installed?'));
    await captureClipboard(p);
    await clickButton(p, /^Copy short description/);
    await ctx.waitUntil('copy', async () => (await clipboardLog(p)).length >= 1, { timeout: 5000 });
    t.check('Copy short description copies the (editable) short description', (await clipboardLog(p)).slice(-1)[0] === 'VPN is down for the sales team since this morning');
    t.check('no field of the saved incident was touched', (await ticket.evaluate(() => window.__gformCalls.length)) === 0);

    // The agent opens a blank incident form (in the classic frame) in the same tab: the notes and the proposal must SURVIVE the
    // page change (the panel used to throw its sections away whenever the tab was loading), and Fill becomes possible.
    t.check('no "Open a new incident form" button is offered any more: the panel fills the blank form itself', !(await p.evaluate(() => document.body.innerText)).includes('Open a new incident form'));
    const notesBefore = await p.$eval('#ab-notes-text', (el) => el.value);
    await ticket.goto(`${inst.origin}/nav_to.do?uri=${encodeURIComponent('incident.do?sys_id=-1')}`, { waitUntil: 'load' });
    await ctx.sleep(300);
    t.check('the tab moved to a blank incident form on the same instance', ticket.url().startsWith(inst.origin) && decodeURIComponent(ticket.url()).includes('incident.do?sys_id=-1'), ticket.url());
    const frame = await ctx.waitUntil('the incident form frame', async () => ticket.frames().find((f) => f.url().startsWith(inst.origin) && new URL(f.url()).pathname === '/incident.do') || null, { timeout: 10000 });
    await frame.waitForFunction(() => window.__gformReady === true, { timeout: 10000 });
    t.check('it is a new record with every proposed field empty', await frame.evaluate(() => window.g_form.isNewRecord() && ['short_description', 'description', 'impact', 'urgency', 'contact_type'].every((f) => window.g_form.getValue(f) === '')));
    await waitPanel(ctx, p, 'the fill button to be enabled', async () => p.evaluate(() => window.__vis(document.querySelectorAll('button')).find((b) => /^Fill the form/.test(b.innerText.trim()))?.disabled === false), { timeout: 20000 });
    t.check('the notes the agent typed and the proposal are still there after the page changed (the panel did not throw its work away)', (await p.$eval('#ab-notes-text', (el) => el.value)) === notesBefore && notesBefore.startsWith('vpn down since this morning') && (await p.$eval('#ab-notes-short', (el) => el.value)).startsWith('VPN is down for the sales team'));
    await clickButton(p, /^Fill the form/);
    await waitForText(p, /Filled: Short description, Description, Impact, Urgency, Contact type\./, { timeout: 15000 });
    let fcalls = await frame.evaluate(() => window.__gformCalls);
    t.check('"Fill the form": exactly the five whitelisted fields, in a fixed order, nothing else', JSON.stringify(fcalls.map((c) => c.name)) === '["short_description","description","impact","urgency","contact_type"]', fcalls.map((c) => c.name).join(','));
    const by = Object.fromEntries(fcalls.map((c) => [c.name, c.value]));
    t.check('impact, urgency and channel were written as the form\'s CHOICE VALUES (1, 2, phone), not as words', by.impact === '1' && by.urgency === '2' && by.contact_type === 'phone', JSON.stringify([by.impact, by.urgency, by.contact_type]));
    t.check('the select boxes show the choices, and nothing was saved or submitted', await frame.evaluate(() => document.getElementById('incident.impact').value === '1' && document.getElementById('incident.urgency').value === '2' && document.getElementById('incident.contact_type').value === 'phone' && window.__gformSaves.length === 0));
    t.check('the description kept its words and no hidden detail came back as a placeholder or a number from the notes\' phone', !/\[[A-Z_]+_\d+\]/.test(`${by.short_description} ${by.description}`) && by.description.includes('Error 809'));

    // The same on a blank form again, with a made-up impact, urgency and channel from the AI: those must NOT be filled
    await subTab('Notes to ticket');
    await ticket.close();
    ticket = await ctx.openInstancePage('/incident.do?sys_id=-1', 'ticket-new-incident');
    await ctx.waitUntil('the panel to see the blank incident form', async () => (await p.evaluate(() => document.body.innerText)).includes('Rough notes'), { timeout: 20000 });
    notesMode = 'invented';
    await p.$eval('#ab-notes-text', (el) => { el.value = ''; });
    await p.click('#ab-notes-text');
    await p.type('#ab-notes-text', 'sales cannot sign in to the portal since this morning, error 809', { delay: 0 });
    ran = await runAfter(p, () => clickButton(p, /^Write the ticket/));
    await waitForText(p, 'Review, then fill the form', { timeout: 8000 });
    await waitForText(p, /Not filled, because Agent Buddy does not recognise the value/, { timeout: 8000 });
    const hint = await p.evaluate(() => document.querySelector('[aria-label="Review before filling the form"] .ab-hint')?.innerText || '');
    t.check('values the AI made up (Catastrophic, ASAP, Carrier pigeon) are shown as "not recognised" and left out', /Impact "Catastrophic"/.test(hint) && /Urgency "ASAP"/.test(hint) && /Contact type "Carrier pigeon"/.test(hint), hint.replace(/\s+/g, ' '));
    await ticket.waitForFunction(() => window.__gformReady === true, { timeout: 10000 });
    await waitPanel(ctx, p, 'fill enabled', async () => p.evaluate(() => window.__vis(document.querySelectorAll('button')).find((b) => /^Fill the form/.test(b.innerText.trim()))?.disabled === false), { timeout: 15000 });
    await clickButton(p, /^Fill the form/);
    await waitForText(p, /Filled: Short description, Description\./, { timeout: 15000 });
    fcalls = await ticket.evaluate(() => window.__gformCalls);
    t.check('only the short description and the description were filled; impact, urgency and channel stayed empty', JSON.stringify(fcalls.map((c) => c.name)) === '["short_description","description"]' && (await ticket.evaluate(() => window.g_form.getValue('impact') === '' && window.g_form.getValue('urgency') === '' && window.g_form.getValue('contact_type') === '')), fcalls.map((c) => `${c.name}=${c.value}`).join(' | ').slice(0, 160));
    notesMode = 'good';
    await ticket.close();

    // ============================== SNIPPETS ===========================================================================================
    ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-incident');
    await settleOnRecord(ctx, data.INCIDENT_ID);
    const aiBeforeSnippets = ai.requests.length;
    await ctx.ext((key) => chrome.storage.local.remove(key), 'agentbuddy_snippets');
    await subTab('Snippets');
    await waitForText(p, 'No snippets yet', { timeout: 8000 });
    await clickButton(p, /^New snippet/);
    await p.type('#ab-snip-title', 'Certificate follow-up');
    await p.type('#ab-snip-shortcut', 'cert');
    const secret = 'Passw0rd!Snip#6';
    await p.type('#ab-snip-body', `Hi {{caller.first_name | there}}, an update on {{number}}. Your temporary password: ${secret} (change it at first sign-in).`, { delay: 0 });
    await waitForText(p, /Filled from the open ticket\./, { timeout: 15000 });
    const livePreview = await p.$eval('[aria-label="Preview of the snippet"]', (el) => el.innerText);
    t.check('snippet editor: the preview is filled from the OPEN ticket (real first name and number), not from examples', /^Hi Abel, an update on INC0010001\./.test(livePreview), livePreview);
    await clickButton(p, /^Save/);
    await waitForText(p, 'Saved.', { timeout: 8000 });
    const readStored = () => ctx.ext(async (key) => (await chrome.storage.local.get(key))[key] || [], 'agentbuddy_snippets');
    const t0 = Date.now();
    const stored = await ctx.waitUntil('the snippet to be in storage', async () => { const l = await readStored(); return l.length ? l : null; }, { timeout: 4000 }).catch(() => []);
    t.info('snippet reached storage after ' + (Date.now() - t0) + ' ms');
    t.check('the snippet is stored as a TEMPLATE (variables as written), not with the ticket\'s values', stored.length === 1 && stored[0].body.includes('{{caller.first_name | there}}') && !stored[0].body.includes('Abel'), JSON.stringify(stored).slice(0, 160));
    await captureClipboard(p);
    // Insert as a work note: appended below what was typed, no customer check
    await ctx.waitUntil('the snippet detail', async () => (await p.$('[aria-label="Snippet: Certificate follow-up"]')) !== null, { timeout: 8000 });
    const snipBefore = await ticket.evaluate(() => window.__gformCalls.length);
    await clickButton(p, /^Insert as work note/);
    await waitForText(p, /Inserted into the form/, { timeout: 8000 });
    let scalls = (await ticket.evaluate(() => window.__gformCalls)).slice(snipBefore);
    t.check('"Insert as work note": one setValue on work_notes, below the typed text, with the real first name and number', scalls.length === 1 && scalls[0].name === 'work_notes' && scalls[0].value.startsWith('Checking the gateway certificate now.\n\nHi Abel, an update on INC0010001.'), JSON.stringify(scalls).slice(0, 160));
    // Insert as a customer comment: the password in the snippet is stopped
    const before2 = await ticket.evaluate(() => window.__gformCalls.length);
    await clickButton(p, /^Insert as customer comment/);
    await p.waitForSelector('.ab-note-warn[role="alert"]', { timeout: 8000 });
    const warn2 = (await textOf(p, '.ab-note-warn[role="alert"]')) || '';
    t.check('"Insert as customer comment": the password in the snippet is stopped by the safe-to-send check (masked excerpt only)', /Check before sending to the customer/.test(warn2) && !warn2.includes(secret), warn2.replace(/\s+/g, ' ').slice(0, 160));
    t.check('...and nothing was written to the comments field', (await ticket.evaluate(() => window.__gformCalls.length)) === before2 && (await ticket.evaluate(() => window.g_form.getValue('comments'))) === '');
    await clickButton(p, /^Edit first/);
    await waitForText(p, /Not inserted\. Copied to the clipboard instead\.|The browser blocked copying/, { timeout: 8000 });

    // Export through the clipboard, delete, import it back
    await clickButton(p, /^Copy all as JSON/);
    await waitForText(p, /Copied 1 snippet as JSON|The browser blocked copying/, { timeout: 8000 });
    const exported = (await clipboardLog(p)).slice(-1)[0] || '';
    let parsed = null;
    try {
      parsed = JSON.parse(exported);
    } catch {
      /* checked below */
    }
    t.check('"Copy all as JSON" copies a snippets file (format, version, the one snippet with its template)', parsed?.format === 'agent-buddy-snippets' && JSON.stringify(parsed).includes('Certificate follow-up') && JSON.stringify(parsed).includes('{{caller.first_name | there}}'), exported.slice(0, 120));
    await clickButton(p, /^Delete/);
    await clickButton(p, /^Yes, delete/);
    await waitForText(p, 'Deleted.', { timeout: 8000 });
    t.check('after Delete the library is empty again', (await ctx.ext(async (key) => ((await chrome.storage.local.get(key))[key] || []).length, 'agentbuddy_snippets')) === 0);
    await clickButton(p, /^Import from JSON/);
    await p.evaluate((text) => {
      const el = document.getElementById('ab-snip-import');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, exported);
    await clickButton(p, /^Add these snippets/);
    await waitForText(p, /Added 1, skipped 0\./, { timeout: 8000 });
    t.check('Import from JSON brings the snippet back (Added 1, skipped 0)', (await ctx.ext(async (key) => ((await chrome.storage.local.get(key))[key] || []).map((s) => s.title), 'agentbuddy_snippets')).join() === 'Certificate follow-up');
    // Importing the same file again skips it (nothing is overwritten)
    await clickButton(p, /^Import from JSON/);
    await p.evaluate((text) => {
      const el = document.getElementById('ab-snip-import');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, exported);
    await clickButton(p, /^Add these snippets/);
    await waitForText(p, /Added 0, skipped 1\./, { timeout: 8000 });
    t.check('importing the same file again adds nothing (skipped 1)', (await ctx.ext(async (key) => ((await chrome.storage.local.get(key))[key] || []).length, 'agentbuddy_snippets')) === 1);

    // A page that is not a record: the preview says it shows examples, and no AI was involved in any of this
    t.check('no snippet action made an AI request', ai.requests.length === aiBeforeSnippets);
    await ctx.ext((key) => chrome.storage.local.remove(key), 'agentbuddy_snippets');

    const bad = errorsSince(ctx, mark);
    t.check('no console error, page error or CSP violation during the Write tab runs', bad.length === 0, describeErrors(bad));
    await panel.close();
    await ticket.close();
    ai.reset();
  },
};

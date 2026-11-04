// p. The Write screen (round 3), through the real panel and content script. Insights (no AI): "Check my comment" and Snippets.
//   AI Assist: Rewrite and Notes to ticket. The email suggestions and drafts moved to the Ticket screen (scenarios of the Insights and
//   Actions agents); here only their absence is checked.
//   Write     every tool names the ticket it works on; no email tools here any more
//   Check     "Check my comment" reads what the agent TYPED in the customer comment (unsaved) and flags a password and internal wording
//             without writing anything
//   Rewrite   text from the form or pasted (with a name, email, phone, card and password): nothing personal reaches the AI;
//             "Replace what is in the form" replaces, "Add below" appends; a customer-visible field is guarded by the safe-to-send check
//   Notes     on a saved record the proposal can only be copied; "Open a blank incident" opens the blank form in the same tab, the
//             proposal survives and fills ONLY the five whitelisted fields with mapped choice values; a value the AI invented is not
//             filled; caller, category and group are only suggested (no AI)
//   Snippets  create, preview against the open record, insert into a field of choice (work note), into the customer comment (a password
//             is stopped), copy as text, delete, paste back, and add the same set from a FILE (skipped: nothing is overwritten)
const fs = require('fs');
const path = require('path');
const { prepare, errorMark, errorsSince, describeErrors, clickButton, waitForText, textOf, checkAiRun, runAfter, captureClipboard, clipboardLog, loadingElements, settleOnRecord, waitPanel } = require('../common.js');
const { openScreen, openHalf, clearBox } = require('../ui.js');

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

module.exports = {
  id: 'p',
  title: 'Write screen: check my comment, rewrite with masking and replace/append, notes to a blank ticket form, snippets into any field with export and import',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    await prepare(ctx);
    ai.setReplier(replier);
    const mark = errorMark(ctx);
    const panel = await ctx.openPanel();
    const p = panel.page;
    const write = async (half) => {
      await openScreen(p, 'Write');
      await openHalf(p, half);
    };

    // ============================== THE WRITE SCREEN AND "CHECK MY COMMENT" ===========================================================
    let ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-incident');
    await settleOnRecord(ctx, data.INCIDENT_ID);
    await write('insights');
    await waitForText(p, /For INC0010001/, { timeout: 20000 });
    const shown = await p.evaluate(() => document.body.innerText);
    t.check('the Write screen names the ticket its tools work on ("For INC0010001 ...")', /For INC0010001/.test(shown), shown.replace(/\s+/g, ' ').slice(0, 120));
    t.check('the Write screen has no email tools any more (they moved to the Ticket screen)', !/Which email fits|Suggested emails/.test(shown));
    t.check('Insights carries no AI mark', await p.evaluate(() => !window.__vis(document.querySelectorAll('[id$="-half-panel-insights"] .ab-ai-badge')).length));
    // The agent types a customer comment (not saved) with a password and internal wording in it
    const typedComment = `Hi Abel, this was escalated to the network team. Your temporary password: ${data.MORE_SEED.rewritePassword}`;
    await ticket.click('[id="incident.comments"]');
    await ticket.type('[id="incident.comments"]', typedComment, { delay: 0 });
    const checkCalls = await ticket.evaluate(() => window.__gformCalls.length);
    const aiBeforeCheck = ai.requests.length;
    await clickButton(p, /^Check my comment/);
    await waitForText(p, /Your customer comment: check before sending\./, { timeout: 15000 });
    const checked = await p.evaluate(() => document.querySelector('.ab-write-check')?.innerText || '');
    t.check('"Check my comment" checks what was TYPED in the form: the password is flagged, shown masked only', /password, key or token/.test(checked) && !checked.includes(data.MORE_SEED.rewritePassword), checked.replace(/\s+/g, ' ').slice(0, 200));
    t.check('...internal wording ("escalated to") is pointed out', /escalated to/i.test(checked), checked.replace(/\s+/g, ' ').slice(0, 200));
    t.check('...and the check wrote nothing to the form and asked no AI', (await ticket.evaluate(() => window.__gformCalls.length)) === checkCalls && ai.requests.length === aiBeforeCheck);
    await ticket.close();

    // ============================== REWRITE ============================================================================================
    ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-incident');
    await settleOnRecord(ctx, data.INCIDENT_ID);
    await write('assist');
    await p.waitForSelector('#ab-rewrite-text', { visible: true, timeout: 10000 });
    // 1. "Use what I typed in the form": the work notes the agent typed but did not save
    await p.select('#ab-rewrite-field', 'work_notes');
    await clickButton(p, /^Use what I typed in the form/);
    await waitForText(p, /Took the work note from the form\./, { timeout: 10000 });
    t.check('"Use what I typed in the form" reads the UNSAVED work note through the page', (await p.$eval('#ab-rewrite-text', (el) => el.value)) === 'Checking the gateway certificate now.');
    // 2. Pasted text with a name, email, phone, card and password; one more person listed under "Names to hide"
    const pasted = `Hi ${data.SEED.callerName}, ${data.MORE_SEED.rewriteName} will call you on ${data.MORE_SEED.rewritePhone} or write to ${data.MORE_SEED.rewriteEmail}. The card ${data.MORE_SEED.rewriteCard} was refused. Your password: ${data.MORE_SEED.rewritePassword} is temporary.`;
    await clearBox(p, '#ab-rewrite-text');
    await p.click('#ab-rewrite-text');
    await p.type('#ab-rewrite-text', pasted, { delay: 0 });
    await p.type('#ab-rewrite-names', data.MORE_SEED.rewriteName);
    await captureClipboard(p);
    let before = ai.requests.length;
    let ran = await runAfter(p, () => clickButton(p, /^Friendlier/));
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
    t.check('nothing on the Write screen loads or runs (no image, link, frame or inline script)', (await loadingElements(p)) === 0);
    await clearBox(p, '#ab-rewrite-text');
    await ticket.close();

    // ============================== NOTES TO TICKET ====================================================================================
    // A saved record first: the proposal is shown, but there is nothing to fill
    ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-incident');
    await settleOnRecord(ctx, data.INCIDENT_ID);
    await write('assist');
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
    // The log already holds the copies of the steps above (the capture is installed once per page): wait for a NEW one, or an earlier
    // copy would be read as this one whenever the click is a little slow.
    const copiesBefore = (await clipboardLog(p)).length;
    await clickButton(p, /^Copy short description/);
    await ctx.waitUntil('copy', async () => (await clipboardLog(p)).length > copiesBefore, { timeout: 5000 });
    const copied = await clipboardLog(p);
    t.check('Copy short description copies the (editable) short description', copied.slice(-1)[0] === 'VPN is down for the sales team since this morning', JSON.stringify(copied.map((c) => String(c).slice(0, 60))));
    t.check('no field of the saved incident was touched', (await ticket.evaluate(() => window.__gformCalls.length)) === 0);

    // Caller, category and group are only suggested, read without AI
    await waitForText(p, 'Suggestions to pick on the form', { timeout: 8000 });
    await waitPanel(ctx, p, 'the suggestions to be read', async () => !/Looking at similar resolved/.test(await p.evaluate(() => document.body.innerText)), { timeout: 15000 });
    t.check('the suggestions for caller, category and group made no AI request and filled nothing', ai.requests.length === before + 1 && (await ticket.evaluate(() => window.__gformCalls.length)) === 0);
    // The agent presses "Open a blank incident": the blank form opens in the SAME tab (classic frame); the notes and the proposal must
    // SURVIVE the page change, and Fill becomes possible.
    const notesBefore = await p.$eval('#ab-notes-text', (el) => el.value);
    await clickButton(p, /^Open a blank incident/);
    await ctx.waitUntil('the tab to open a blank incident form', async () => decodeURIComponent(ticket.url()).includes('incident.do?sys_id=-1'), { timeout: 10000 });
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
    await ticket.close();
    ticket = await ctx.openInstancePage('/incident.do?sys_id=-1', 'ticket-new-incident');
    await ctx.waitUntil('the panel to see the blank incident form', async () => (await p.evaluate(() => document.body.innerText)).includes('Rough notes'), { timeout: 20000 });
    notesMode = 'invented';
    await clearBox(p, '#ab-notes-text');
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
    await write('insights');
    await waitForText(p, 'No snippets yet', { timeout: 8000 });
    await clickButton(p, /^Write my own/);
    await p.type('#ab-snip-title', 'Certificate follow-up');
    await p.type('#ab-snip-shortcut', 'cert');
    const secret = 'Passw0rd!Snip#6';
    await p.type('#ab-snip-body', `Hi {{caller.first_name | there}}, an update on {{number}}. Your temporary password: ${secret} (change it at first sign-in).`, { delay: 0 });
    await waitForText(p, /Filled from INC0010001\./, { timeout: 15000 });
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
    // Into a field of choice, the work note: appended below what was typed, no customer check
    await ctx.waitUntil('the snippet detail', async () => (await p.$('[aria-label="Snippet: Certificate follow-up"]')) !== null, { timeout: 8000 });
    const snipBefore = await ticket.evaluate(() => window.__gformCalls.length);
    await p.select('#ab-snip-target', 'work_notes');
    await clickButton(p, /^Insert$/);
    await waitForText(p, /Inserted into the form/, { timeout: 8000 });
    let scalls = (await ticket.evaluate(() => window.__gformCalls)).slice(snipBefore);
    t.check('Insert into "Work note": one setValue on work_notes, below the typed text, with the real first name and number', scalls.length === 1 && scalls[0].name === 'work_notes' && scalls[0].value.startsWith('Checking the gateway certificate now.\n\nHi Abel, an update on INC0010001.'), JSON.stringify(scalls).slice(0, 160));
    // Into the customer comment: the password in the snippet is stopped
    const before2 = await ticket.evaluate(() => window.__gformCalls.length);
    await p.select('#ab-snip-target', 'comments');
    await clickButton(p, /^Insert$/);
    await p.waitForSelector('.ab-note-warn[role="alert"]', { timeout: 8000 });
    const warn2 = (await textOf(p, '.ab-note-warn[role="alert"]')) || '';
    t.check('Insert into "Customer comment": the password in the snippet is stopped by the safe-to-send check (masked excerpt only)', /Check before sending to the customer/.test(warn2) && !warn2.includes(secret), warn2.replace(/\s+/g, ' ').slice(0, 160));
    t.check('...and nothing was written to the comments field', (await ticket.evaluate(() => window.__gformCalls.length)) === before2 && (await ticket.evaluate(() => window.g_form.getValue('comments'))) === '');
    await clickButton(p, /^Edit first/);
    await waitForText(p, /Not inserted\. Copied to the clipboard instead\.|The browser blocked copying/, { timeout: 8000 });

    // Copy as text, delete, paste it back, then add the same set from a FILE
    await clickButton(p, /^Back up or share/);
    await clickButton(p, /^Copy as text/);
    await waitForText(p, /Copied 1 snippet as text|The browser blocked copying/, { timeout: 8000 });
    const exported = (await clipboardLog(p)).slice(-1)[0] || '';
    let parsed = null;
    try {
      parsed = JSON.parse(exported);
    } catch {
      /* checked below */
    }
    t.check('"Copy as text" copies a snippets file (format, version, the one snippet with its template)', parsed?.format === 'agent-buddy-snippets' && JSON.stringify(parsed).includes('Certificate follow-up') && JSON.stringify(parsed).includes('{{caller.first_name | there}}'), exported.slice(0, 120));
    await clickButton(p, /^Delete/);
    await clickButton(p, /^Yes, delete/);
    await waitForText(p, 'Deleted.', { timeout: 8000 });
    t.check('after Delete the library is empty again', (await ctx.ext(async (key) => ((await chrome.storage.local.get(key))[key] || []).length, 'agentbuddy_snippets')) === 0);
    await clickButton(p, /^Paste instead/);
    await p.evaluate((text) => {
      const el = document.getElementById('ab-snip-import');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, exported);
    await clickButton(p, /^Add these snippets/);
    await waitForText(p, /Added 1, skipped 0\./, { timeout: 8000 });
    t.check('Paste instead brings the snippet back (Added 1, skipped 0)', (await ctx.ext(async (key) => ((await chrome.storage.local.get(key))[key] || []).map((s) => s.title), 'agentbuddy_snippets')).join() === 'Certificate follow-up');
    // Adding the same set from a FILE skips it (nothing is overwritten); a file that is not JSON is refused before it is read
    const file = path.join(ctx.TMP, 'agent-buddy-snippets-e2e.json');
    fs.writeFileSync(file, `${String.fromCharCode(0xfeff)}${exported}`);
    const input = await p.$('#ab-snip-file');
    await input.uploadFile(file);
    await waitForText(p, /Added 0, skipped 1\./, { timeout: 8000 });
    t.check('"Add from a file": the same snippets again add nothing (skipped 1: the search word is taken)', (await ctx.ext(async (key) => ((await chrome.storage.local.get(key))[key] || []).length, 'agentbuddy_snippets')) === 1 && /search word "cert" is already used/.test(await p.evaluate(() => document.body.innerText)));
    const notJson = path.join(ctx.TMP, 'snippets-e2e.txt');
    fs.writeFileSync(notJson, exported);
    await input.uploadFile(notJson);
    await waitForText(p, /Choose a \.json file saved by Agent Buddy/, { timeout: 8000 });
    t.check('a file that is not .json is refused with a plain sentence', true);

    // A page that is not a record: the preview says it shows examples, and no AI was involved in any of this
    t.check('no snippet action made an AI request', ai.requests.length === aiBeforeSnippets);
    await ctx.ext((key) => chrome.storage.local.remove(key), 'agentbuddy_snippets');

    const bad = errorsSince(ctx, mark);
    t.check('no console error, page error or CSP violation on the Write screen', bad.length === 0, describeErrors(bad));
    await panel.close();
    await ticket.close();
    ai.reset();
  },
};

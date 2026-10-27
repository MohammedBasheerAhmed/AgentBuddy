// q. The record tabs, through the real panel and content script:
//    Request     on a requested item and on one of its catalog tasks: what it is waiting for, approvals, tasks, the answers to the
//                request questions (a masked or secret-named answer is never shown); the AI button sends status, not the answers
//    Check       "Check before you resolve" reads the values typed on the CLASSIC form but not saved: close notes too short -> a
//                warning, fixed -> fine, an email address in the notes is reported by kind only; "Check again" reads the form again;
//                "Improve my resolution notes" starts from what is typed now, masked
//    Checklist   steps from the written instructions; ticks survive a reload of the panel; only salted hashes are kept, in session
//                storage, never a step's text or the record id
const { findLeaks } = require('../leaks.js');
const { prepare, errorMark, errorsSince, describeErrors, clickTab, clickButton, waitForText, textOf, checkAiRun, runAfter, waitPanel, settleOnRecord } = require('../common.js');

const first = (text, kind) => (new RegExp(`\\[${kind}_\\d+\\]`).exec(text) || [''])[0];

function replier({ system, user }) {
  const person = first(user, 'PERSON') || 'there';
  if (/tell a requester where their service request stands/.test(system)) {
    return `Hello ${person}, your laptop request is in progress. It is waiting for approval from IT Procurement, and our desktop support team will take it from there.`;
  }
  if (/improve the resolution notes they are writing/.test(system)) {
    return `Cause: The gateway certificate on EU-2 had expired.\nFix: Replaced the expired gateway certificate on EU-2 and restarted the gateway service.\nVerification: Confirmed with ${first(user, 'EMAIL') || 'the caller'} that the VPN stays up.`;
  }
  if (/carry out a catalog task or a requested item/.test(system)) {
    return '1. Image the laptop with the standard build\n2. Install the VPN client\n3. Add it to the asset register\n4. Send the delivery note to the requester';
  }
  return null;
}

const checkRows = (p) => p.evaluate(() => [...document.querySelectorAll('ul[aria-label="Checks"] li')].map((li) => ({ status: li.getAttribute('data-status'), text: li.innerText.replace(/\s+/g, ' ').trim() })));
const findCheck = (rows, re) => rows.find((r) => re.test(r.text));
const sessionStore = (ctx) => ctx.ext(async () => JSON.stringify(await chrome.storage.session.get(null)));
const localStore = (ctx) => ctx.ext(async () => JSON.stringify(await chrome.storage.local.get(null)));

module.exports = {
  id: 'q',
  title: 'Record tabs: Request (status, approvals, answers hidden), Check (unsaved form values, Check again), Checklist (ticks survive a reload, only hashes stored)',
  async run(t, ctx) {
    const { ai, data } = ctx;
    await prepare(ctx);
    ai.setReplier(replier);
    const mark = errorMark(ctx);
    const panel = await ctx.openPanel();
    const p = panel.page;

    // ============================== REQUEST: a requested item =========================================================================
    let ticket = await ctx.openInstancePage(`/sc_req_item.do?sys_id=${data.RITM_ID}`, 'ticket-ritm');
    await waitForText(p, data.RITM_NUMBER, { timeout: 20000 });
    await clickTab(p, 'Request');
    await waitForText(p, 'Where is this request?', { timeout: 15000 });
    await waitPanel(ctx, p, 'the request status', async () => (await p.$('[aria-label="What it is waiting for"]')) !== null, { timeout: 20000 });
    const status = await p.$eval('[aria-label="What it is waiting for"]', (el) => el.innerText.replace(/\s+/g, ' ').trim());
    t.check('Request tab: the "what it is waiting for" card names what the item waits for (the approval of IT Procurement)', /approval/i.test(status) && /IT Procurement/.test(status), status.slice(0, 200));
    t.check('...and says who to ask and when it is due', /Who to ask/.test(status) && /Due/.test(status), status.slice(0, 200));
    const text = () => p.evaluate(() => document.body.innerText);
    // The sections are collapsible: open every one that is closed, then read them
    await p.evaluate(() => document.querySelectorAll('details:not([open]) > summary').forEach((s) => s.click()));
    await ctx.sleep(300);
    const all = await text();
    t.check('Request tab: approvals are listed with their state (the approved one and the one still requested)', /Approvals/.test(all) && /Approved/.test(all) && /Requested/.test(all), all.replace(/\s+/g, ' ').slice(0, 100));
    t.check('Request tab: the catalog tasks of the item are listed, with the new one too', /SCTASK0010060/.test(all) && /SCTASK0010061/.test(all) && new RegExp(data.CHECKLIST_TASK_NUMBER).test(all));
    t.check('Request tab: the answers to the request questions are shown (system, justification)', /Operating system/.test(all) && /Windows 11/.test(all));
    t.check('Request tab: a password-type answer and an answer named like a secret are NEVER shown', !all.includes('hunter2-Secret!') && !all.includes('4417'), '');
    t.check('Request tab: nothing was sent to an AI by looking at it', ai.requests.length === 0);

    // The AI button: a message for the requester from the STATUS, not the answers
    const before = ai.requests.length;
    const ran = await runAfter(p, () => clickButton(p, /^Explain it in plain words for the requester/));
    const req = await checkAiRun(t, ctx, p, 'request-explain', ran, { before, system: /tell a requester where their service request stands/, userHas: [/Status worked out from the records/i] });
    t.check('request-explain: the answers to the request questions (Windows 11, the justification, the secrets) did NOT go to the AI', req ? !/Windows 11|Business justification|hunter2|charlie\.w@example/i.test(req.raw) : false);
    t.check('request-explain: the requester (Charlie) and the approver (Dave) are masked in what was sent', req ? !/Charlie|Whitherspoon|Dave|Loftus/i.test(req.raw) : false);
    await clickButton(p, /^Close/);
    await ticket.close();

    // ============================== REQUEST: a catalog task points at its item ===============================================================
    ticket = await ctx.openInstancePage(`/sc_task.do?sys_id=${data.CHECKLIST_TASK_ID}`, 'ticket-sctask');
    await waitForText(p, data.CHECKLIST_TASK_NUMBER, { timeout: 20000 });
    await clickTab(p, 'Request');
    await waitForText(p, /belongs to RITM0010050; the status below is for that item/, { timeout: 20000 });
    t.check('Request tab on a catalog task: it follows the task to its requested item (op requestTarget) and says so', true);

    // ============================== CHECKLIST ==========================================================================================
    await clickTab(p, 'Checklist');
    await waitForText(p, 'Fulfilment checklist', { timeout: 15000 });
    await waitPanel(ctx, p, 'the steps', async () => (await p.$$('ul[aria-label="Steps"] input[type="checkbox"]')).length === 3, { timeout: 20000 });
    const steps = await p.$$eval('ul[aria-label="Steps"] li', (lis) => lis.map((li) => li.innerText.trim()));
    t.check('Checklist tab: the three written steps of the task, worked out on this computer', JSON.stringify(steps) === JSON.stringify(data.CHECKLIST_STEPS), steps.join(' | '));
    await p.click('ul[aria-label="Steps"] li:nth-child(1) input');
    await p.click('ul[aria-label="Steps"] li:nth-child(3) input');
    await waitForText(p, /2 of 3/, { timeout: 8000 });
    const ticked = () => p.$$eval('ul[aria-label="Steps"] input', (boxes) => boxes.map((b) => b.checked));
    t.check('ticking two steps shows the progress and checks the boxes', JSON.stringify(await ticked()) === '[true,false,true]', (await p.evaluate(() => document.querySelector('.ab-chk-progress-text')?.innerText)) || '');

    const session = await sessionStore(ctx);
    const local = await localStore(ctx);
    const sessionData = JSON.parse(session).agentbuddy_checklists || {};
    const keys = Object.keys(sessionData);
    t.check('storage holds ONE entry for the ticks, in SESSION storage, under a 12-character salted hash (not the record id)', keys.length === 1 && /^[0-9a-f]{12}$/.test(keys[0]) && !session.includes(data.CHECKLIST_TASK_ID), keys.join(','));
    t.check('...the entry is encrypted: no step text, no record id, no number anywhere in session or local storage', ![...data.CHECKLIST_STEPS, data.CHECKLIST_TASK_ID, data.CHECKLIST_TASK_NUMBER, 'asset register', 'delivery note'].some((x) => session.includes(x) || local.includes(x)), Object.keys(sessionData[keys[0]] || {}).join(','));
    t.check('...and nothing about the checklist is in long-lived (local) storage', !/agentbuddy_checklists/.test(local));

    // A reload of the panel: the ticks come back
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('.ab-app', { timeout: 10000 });
    await settleOnRecord(ctx, data.CHECKLIST_TASK_ID);
    await waitForText(p, data.CHECKLIST_TASK_NUMBER, { timeout: 20000 });
    await clickTab(p, 'Checklist');
    await waitPanel(ctx, p, 'the ticks after the reload', async () => (await p.$$('ul[aria-label="Steps"] input[type="checkbox"]')).length === 3, { timeout: 20000 });
    t.check('after the panel was reloaded the same two steps are still ticked', JSON.stringify(await ticked()) === '[true,false,true]', JSON.stringify(await ticked()));
    t.check('...and the progress line says so', /2 of 3/.test(await text()));

    // The AI proposes a cleaner list; the person chooses to use it
    const before2 = ai.requests.length;
    const proposal = await runAfter(p, () => clickButton(p, /^Propose a cleaner checklist/));
    await checkAiRun(t, ctx, p, 'fulfilment-checklist', proposal, { before: before2, system: /carry out a catalog task or a requested item/, userHas: [/Image the laptop/i] });
    // (The offer to use the list is shown while the answer is on screen; closing the answer takes it away.)
    await waitForText(p, /The AI proposed 4 steps/, { timeout: 8000 });
    await clickButton(p, /^Use this list/);
    await waitPanel(ctx, p, 'the AI list', async () => (await p.$$('ul[aria-label="Steps"] input[type="checkbox"]')).length === 4, { timeout: 8000 });
    t.check('"Use this list" replaces the written steps with the four the AI proposed (kept in memory only)', (await p.$$eval('ul[aria-label="Steps"] li', (lis) => lis.map((li) => li.innerText.trim()))).includes('Install the VPN client'));
    t.check('...a step that is in both lists keeps its tick (the ids come from the step text)', (await ticked()).filter(Boolean).length >= 1);
    await p.click('ul[aria-label="Steps"] li:nth-child(2) input');
    await ctx.sleep(500);
    const sessionAfterAi = await sessionStore(ctx);
    t.check('ticking an AI-proposed step stores a hash too, but still no step text anywhere', !['Install the VPN client', 'Add it to the asset register', ...data.CHECKLIST_STEPS].some((x) => sessionAfterAi.includes(x) || ''.includes(x)));
    await clickButton(p, /^Back to the written steps/);
    await clickButton(p, /^Clear ticks/);
    await ctx.waitUntil('the ticks to be cleared', async () => (await ticked()).every((b) => !b), { timeout: 8000 });
    const cleared = JSON.parse(await sessionStore(ctx)).agentbuddy_checklists || {};
    t.check('"Clear ticks" removes the record\'s entry from storage', Object.keys(cleared).length === 0, Object.keys(cleared).join(','));
    await ticket.close();

    // ============================== CHECK: values typed on the classic form ==============================================================
    ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-incident');
    await waitForText(p, data.INCIDENT_NUMBER, { timeout: 20000 });
    await clickTab(p, 'Check');
    await waitForText(p, 'Check before you resolve', { timeout: 15000 });
    await waitPanel(ctx, p, 'the checks', async () => (await checkRows(p)).length >= 3, { timeout: 20000 });
    t.check('Check tab: it says it checked what is on the form right now (a classic form is readable)', /Checked against what is on the form right now/.test(await text()));
    let rows = await checkRows(p);
    t.check('no resolution notes yet: a warning, and it notes that the work note typed on the form is not a substitute', findCheck(rows, /No resolution notes yet/)?.status === 'warn' && /work note you have typed is separate/i.test(findCheck(rows, /No resolution notes yet/)?.text || ''), findCheck(rows, /resolution notes/i)?.text);
    t.check('the header line counts what needs a look', /thing(s)? to look at before you resolve this/.test(await text()));

    // Type "Done." into the CLASSIC form's resolution notes (unsaved) and check again
    const typeInForm = async (value) => {
      await ticket.focus('[id="incident.close_notes"]');
      await ticket.evaluate(() => { document.getElementById('incident.close_notes').value = ''; });
      await ticket.type('[id="incident.close_notes"]', value, { delay: 0 });
    };
    await typeInForm('Done.');
    await clickButton(p, /^Check again/);
    await waitPanel(ctx, p, 'the notes warning', async () => /only say "resolved"/.test(findCheck(await checkRows(p), /notes/i)?.text || ''), { timeout: 15000 });
    rows = await checkRows(p);
    t.check('typed "Done." (unsaved): the check now warns that the notes only say "resolved"', findCheck(rows, /only say/)?.status === 'warn');
    await typeInForm('Fixed it');
    await clickButton(p, /^Check again/);
    await waitPanel(ctx, p, 'the short-notes warning', async () => /notes/i.test(findCheck(await checkRows(p), /notes/i)?.text || '') && !/No resolution notes yet/.test(findCheck(await checkRows(p), /notes/i)?.text || ''), { timeout: 15000 });
    rows = await checkRows(p);
    t.check('typed a few words: "Check again" reads the form again and warns the notes are very short (or filler)', ['warn'].includes(findCheck(rows, /notes/i)?.status), findCheck(rows, /notes/i)?.text);
    await typeInForm('Replaced the expired gateway certificate on EU-2 and restarted the gateway service. Confirmed with priya.raman@example.com that the VPN stays up.');
    await clickButton(p, /^Check again/);
    await waitPanel(ctx, p, 'the notes to pass', async () => findCheck(await checkRows(p), /Resolution notes are filled in/)?.status === 'ok', { timeout: 15000 });
    rows = await checkRows(p);
    t.check('typed a proper note: "Resolution notes are filled in" is Fine', findCheck(rows, /Resolution notes are filled in/)?.status === 'ok');
    const pii = findCheck(rows, /personal data or secrets/i);
    t.check('the email address in the typed notes is reported by KIND only ("1 email address") and the address itself is not shown', pii?.status === 'warn' && /1 email address in the resolution notes/.test(pii.text) && !(await text()).includes("priya.raman@example.com"), pii?.text);
    t.check('the hold and close-code checks come from the form too (no hold reason is typed; the close code is empty -> warn)', findCheck(rows, /No close code chosen/)?.status === 'warn');

    // "Improve my resolution notes" starts from what is typed now, masked
    const before3 = ai.requests.length;
    const improved = await runAfter(p, () => clickButton(p, /^Improve my resolution notes/));
    const imp = await checkAiRun(t, ctx, p, 'resolution-improve', improved, { before: before3, system: /improve the resolution notes they are writing/, userHas: [/Replaced the expired gateway certificate on EU-2/, /\[EMAIL_\d+\]/] });
    t.check('resolution-improve: the AI got the notes as typed RIGHT NOW (unsaved), and the typed email address did not travel', imp ? !imp.raw.includes("priya.raman@example.com") : false);
    await clickButton(p, /^Close/);
    t.check('nothing was written to the form by any of this', (await ticket.evaluate(() => window.__gformCalls.length)) === 0);

    const bad = errorsSince(ctx, mark);
    t.check('no console error, page error or CSP violation on the record tabs', bad.length === 0, describeErrors(bad));
    await panel.close();
    await ticket.close();
    ai.reset();
  },
};

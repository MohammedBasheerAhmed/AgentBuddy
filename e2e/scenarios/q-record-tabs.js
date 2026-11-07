// q. The Ticket screen's request and resolve cards (Insights), through the real panel and content script:
//    Request status        on a requested item and on one of its catalog tasks: who to chase, what it is waiting for, approvals,
//                          tasks, the answers to the request questions (a masked or secret-named answer is never shown); the AI message
//                          (AI Assist) sends status, not the answers
//    Ready to resolve?     reads the values typed on the CLASSIC form but not saved: close notes too short -> a warning, fixed -> fine,
//                          an email address in the notes is reported by kind only; "Check again" reads the form again; "Improve my
//                          resolution notes" (AI Assist) starts from what is typed now, masked. On a WORKSPACE page (no g_form) the
//                          notes typed in its boxes count too, read without an event; the close code stays the saved one
//    Fulfilment checklist  steps from the written instructions; ticks survive a reload of the panel; only salted hashes are kept, in
//                          session storage, never a step's text or the record id
//    The AI parts run when AI Assist offers the action (Actions agent); otherwise they are reported as a warning.
const { prepare, errorMark, errorsSince, describeErrors, clickButton, waitForText, checkAiRun, runAfter, waitPanel, settleOnRecord } = require('../common.js');
const { actionOffered, startAction, deepTextareaValue } = require('../ui.js');
const { openCard, cardText, showAllIn, cardLine } = require('../insightsUi.js');

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

const checkRows = async (p) => {
  await showAllIn(p, 'resolve');
  return p.evaluate(() => window.__vis(document.querySelectorAll('[data-card="resolve"] .ab-chk-item')).map((li) => ({ status: li.getAttribute('data-status'), text: li.innerText.replace(/\s+/g, ' ').trim() })));
};
const summaryIn = (p, id) => cardLine(p, id); // its own row, or the row of its pain point when it is alone there (e2e/insightsUi.js)
// The AI half holds the AI actions. A part that needs one runs only when AI Assist offers it.
const assistOffers = (p, re) => actionOffered(p, re); // one of AI Assist's five, or in All tools
const findCheck = (rows, re) => rows.find((r) => re.test(r.text));
const sessionStore = (ctx) => ctx.ext(async () => JSON.stringify(await chrome.storage.session.get(null)));
const localStore = (ctx) => ctx.ext(async () => JSON.stringify(await chrome.storage.local.get(null)));

module.exports = {
  id: 'q',
  title: 'Ticket screen cards: Request status (who to chase, approvals, answers hidden), Ready to resolve? (unsaved form values, Check again), Fulfilment checklist (ticks survive a reload, only hashes stored)',
  async run(t, ctx) {
    const { ai, data } = ctx;
    await prepare(ctx);
    // The request and checklist cards are for the request fulfilment profile.
    await ctx.configure({ profiles: ['it', 'req'], profilesConfirmed: true });
    ai.setReplier(replier);
    const mark = errorMark(ctx);
    const panel = await ctx.openPanel();
    const p = panel.page;

    // ============================== REQUEST: a requested item =========================================================================
    let ticket = await ctx.openInstancePage(`/sc_req_item.do?sys_id=${data.RITM_ID}`, 'ticket-ritm');
    await waitForText(p, data.RITM_NUMBER, { timeout: 20000 });
    await openCard(p, 'Request status');
    await waitPanel(ctx, p, 'the request status', async () => (await p.$('[data-card="request"] .ab-ins-chase')) !== null, { timeout: 20000 });
    const status = (await cardText(p, 'request')).replace(/\s+/g, ' ').trim();
    t.check('Request status: names what the item waits for (the approval of IT Procurement)', /approval/i.test(status) && /IT Procurement/.test(status), status.slice(0, 200));
    t.check('...says who to chase in one line at the top, and when it is due', /Chase: .*IT Procurement/.test(status) && /Due/.test(status), status.slice(0, 200));
    t.check('...and the card summary is the same one line', /^Chase: /.test(await summaryIn(p, 'request')), await summaryIn(p, 'request'));
    const text = () => p.evaluate(() => document.body.innerText);
    // The groups fold: open every one that is closed, then read them
    await p.evaluate(() => document.querySelectorAll('[data-card="request"] .ab-ins-group-toggle[aria-expanded="false"]').forEach((b) => b.click()));
    await ctx.sleep(300);
    const all = await text();
    t.check('Request status: approvals are listed with their state (the approved one and the one still requested)', /Approvals/.test(all) && /Approved/.test(all) && /Requested/.test(all), all.replace(/\s+/g, ' ').slice(0, 100));
    t.check('Request status: the catalog tasks of the item are listed, with the new one too', /SCTASK0010060/.test(all) && /SCTASK0010061/.test(all) && new RegExp(data.CHECKLIST_TASK_NUMBER).test(all));
    t.check('Request status: the answers to the request questions are shown (system, justification)', /Operating system/.test(all) && /Windows 11/.test(all));
    t.check('Request status: a password-type answer and an answer named like a secret are NEVER shown', !all.includes('hunter2-Secret!') && !all.includes('4417'), '');
    t.check('Request status: nothing was sent to an AI by looking at it', ai.requests.length === 0);

    // The AI button: a message for the requester from the STATUS, not the answers
    if (await assistOffers(p, /^Tell the requester where it stands/)) {
      const before = ai.requests.length;
      const ran = await runAfter(p, () => startAction(p, /^Tell the requester where it stands/));
      const req = await checkAiRun(t, ctx, p, 'request-explain', ran, { before, system: /tell a requester where their service request stands/, userHas: [/Status worked out from the records/i] });
      t.check('request-explain: the answers to the request questions (Windows 11, the justification, the secrets) did NOT go to the AI', req ? !/Windows 11|Business justification|hunter2|charlie\.w@example/i.test(req.raw) : false);
      t.check('request-explain: the requester (Charlie) and the approver (Dave) are masked in what was sent', req ? !/Charlie|Whitherspoon|Dave|Loftus/i.test(req.raw) : false);
      await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-answer-close'))[0]?.click()); // (Close on an answer is an icon button: its name is its aria-label)
    } else t.warning('request-explain is not offered in AI Assist yet: its checks did not run (Actions agent)');
    await ticket.close();

    // ============================== REQUEST: a catalog task points at its item ===============================================================
    ticket = await ctx.openInstancePage(`/sc_task.do?sys_id=${data.CHECKLIST_TASK_ID}`, 'ticket-sctask');
    await waitForText(p, data.CHECKLIST_TASK_NUMBER, { timeout: 20000 });
    // F1 (audit of 2026-11-07): the person of a catalog task is its requester, read through the requested item (not whoever opened the task)
    await openCard(p, "Caller's other tickets");
    const requesterSeen = await waitForText(p, /Earlier tickets from Charlie Whitherspoon/, { timeout: 15000 }).then(() => true, () => false);
    t.check('catalog task: the same-person row follows the requested item to its requester (F1)', requesterSeen);
    await openCard(p, 'Request status');
    await waitForText(p, /belongs to RITM0010050; the status is for that item/, { timeout: 20000 });
    t.check('Request status on a catalog task: it follows the task to its requested item (op requestTarget) and says so', true);

    // Wave 6 (catalog fulfiller): how the same catalog item was fulfilled before, the exact comment wording, and who the request waits on
    await openCard(p, 'Fulfilled before');
    await waitForText(p, /SCTASK0020061/, { timeout: 20000 });
    const fulfilled = (await cardText(p, 'fulfilled')).replace(/\s+/g, ' ').trim();
    t.check('Fulfilled before: the three completed tasks for the same catalog item, and neither the incomplete one nor the other item', ['SCTASK0020061', 'SCTASK0020062', 'SCTASK0020063'].every((n) => fulfilled.includes(n)) && !/SCTASK0020064|SCTASK0020065/.test(fulfilled), fulfilled.slice(0, 260));
    t.check('...with how long the last one took and what its close notes said', /took 2 days/.test(fulfilled) && /Imaged with the standard build/.test(fulfilled), fulfilled.slice(0, 260));
    await openCard(p, 'Request status');
    await waitForText(p, /Waiting on IT Procurement for \d+ days\./, { timeout: 20000 });
    t.check('Request status: says who the request waits on and for how long, and counts the other approval that is waiting', /1 other approval is also waiting/.test(await p.evaluate(() => document.body.innerText)));

    // ============================== CHECKLIST ==========================================================================================
    await openCard(p, 'Fulfilment checklist');
    await waitPanel(ctx, p, 'the steps', async () => (await p.$$('ul[aria-label="Steps"] input[type="checkbox"]')).length === 3, { timeout: 20000 });
    const steps = await p.$$eval('ul[aria-label="Steps"] li', (lis) => lis.map((li) => li.innerText.trim()));
    t.check('Fulfilment checklist: the three written steps of the task, worked out on this computer', JSON.stringify(steps) === JSON.stringify(data.CHECKLIST_STEPS), steps.join(' | '));
    await p.click('ul[aria-label="Steps"] li:nth-child(1) input');
    await p.click('ul[aria-label="Steps"] li:nth-child(3) input');
    await waitForText(p, /2 of 3/, { timeout: 8000 });
    const ticked = () => p.$$eval('ul[aria-label="Steps"] input', (boxes) => boxes.map((b) => b.checked));
    t.check('ticking two steps shows the progress and checks the boxes', JSON.stringify(await ticked()) === '[true,false,true]', (await p.evaluate(() => document.querySelector('.ab-chk-progress-text')?.innerText)) || '');

    const session = await sessionStore(ctx);
    // The last-viewed list (round 4, build rule 7's named exception) holds the ids of tickets opened, by design; it is checked in e.
    const local = JSON.stringify((({ agentbuddy_last_viewed, ...rest }) => rest)(JSON.parse(await localStore(ctx))));
    const sessionData = JSON.parse(session).agentbuddy_checklists || {};
    const keys = Object.keys(sessionData);
    t.check('storage holds ONE entry for the ticks, in SESSION storage, under a 12-character salted hash (not the record id)', keys.length === 1 && /^[0-9a-f]{12}$/.test(keys[0]) && !session.includes(data.CHECKLIST_TASK_ID), keys.join(','));
    t.check('...the entry is encrypted: no step text, no record id, no number anywhere in session or local storage', ![...data.CHECKLIST_STEPS, data.CHECKLIST_TASK_ID, data.CHECKLIST_TASK_NUMBER, 'asset register', 'delivery note'].some((x) => session.includes(x) || local.includes(x)), Object.keys(sessionData[keys[0]] || {}).join(','));
    t.check('...and nothing about the checklist is in long-lived (local) storage', !/agentbuddy_checklists/.test(local));

    // A reload of the panel: the ticks come back
    // (the second tick is written to the session store a moment after it is shown: reload only when the stored value has stopped changing)
    let storedBefore = '';
    await ctx.waitUntil('the ticks to be saved', async () => {
      const now = await sessionStore(ctx);
      const same = now === storedBefore;
      storedBefore = now;
      return same;
    }, { timeout: 8000, every: 400 });
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('.ab-app', { timeout: 10000 });
    await settleOnRecord(ctx, data.CHECKLIST_TASK_ID);
    await waitForText(p, data.CHECKLIST_TASK_NUMBER, { timeout: 20000 });
    await openCard(p, 'Fulfilment checklist');
    await waitPanel(ctx, p, 'the ticks after the reload', async () => (await p.$$('ul[aria-label="Steps"] input[type="checkbox"]')).length === 3, { timeout: 20000 });
    // (the steps are drawn first and the ticks are read from the session store a moment later: on a slow runner the first look is too early)
    await ctx.waitUntil('the ticks to come back', async () => JSON.stringify(await ticked()) === '[true,false,true]', { timeout: 10000 }).catch(() => {});
    t.check('after the panel was reloaded the same two steps are still ticked', JSON.stringify(await ticked()) === '[true,false,true]', JSON.stringify(await ticked()));
    t.check('...and the progress line says so', /2 of 3/.test(await text()));

    // The AI proposes a cleaner list; the person chooses to use it
    if (await assistOffers(p, /^Draft a checklist from the instructions/)) {
      const before2 = ai.requests.length;
      const proposal = await runAfter(p, () => startAction(p, /^Draft a checklist from the instructions/));
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
    } else t.info('the AI checklist is not offered here, by design (AI18): the written instructions already split into steps; its own checks need a task without steps');
    await openCard(p, 'Fulfilment checklist');
    await clickButton(p, /^Clear ticks/);
    await ctx.waitUntil('the ticks to be cleared', async () => (await ticked()).every((b) => !b), { timeout: 8000 });
    const cleared = JSON.parse(await sessionStore(ctx)).agentbuddy_checklists || {};
    t.check('"Clear ticks" removes the record\'s entry from storage', Object.keys(cleared).length === 0, Object.keys(cleared).join(','));
    await ticket.close();

    // ============================== CHECK: values typed on the classic form ==============================================================
    ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-incident');
    await waitForText(p, data.INCIDENT_NUMBER, { timeout: 20000 });
    await openCard(p, 'Ready to resolve?');
    await waitPanel(ctx, p, 'the checks', async () => (await checkRows(p)).length >= 3, { timeout: 20000 });
    t.check('Ready to resolve?: it says it checked what is on the form now (a classic form is readable)', /Checked against what is on the form now/.test(await text()));
    let rows = await checkRows(p);
    t.check('no resolution notes yet: a warning, and it notes that the work note typed on the form is not a substitute', findCheck(rows, /No resolution notes yet/)?.status === 'warn' && /work note you have typed is separate/i.test(findCheck(rows, /No resolution notes yet/)?.text || ''), findCheck(rows, /resolution notes/i)?.text);
    t.check('the card summary says it is not ready yet (round 4: "Not yet: ...")', /^Not yet: /.test(await summaryIn(p, 'resolve')), await summaryIn(p, 'resolve'));
    t.check('...and a finding about the customer points to the email card', /Go to: Which email fits/.test(await cardText(p, 'resolve')) || !/customer has not replied/i.test(await cardText(p, 'resolve')));

    // Type "Done." into the CLASSIC form's resolution notes (unsaved) and check again
    const typeInForm = async (value) => {
      await ticket.focus('[id="incident.close_notes"]');
      await ticket.evaluate(() => { document.getElementById('incident.close_notes').value = ''; });
      await ticket.type('[id="incident.close_notes"]', value, { delay: 0 });
    };
    // "Check again" pressed while the answer to the earlier press is still on its way is not taken up (the button is busy), so the check is
    // pressed again until the answer shows what was typed.
    const checkAgainUntil = async (what, done) => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await clickButton(p, /^Check again/).catch(() => {});
        try {
          await waitPanel(ctx, p, what, done, { timeout: 6000 });
          return;
        } catch (err) {
          if (attempt === 3) throw err;
        }
      }
    };
    await typeInForm('Done.');
    await checkAgainUntil('the notes warning', async () => /only say "resolved"/.test(findCheck(await checkRows(p), /notes/i)?.text || ''));
    rows = await checkRows(p);
    t.check('typed "Done." (unsaved): the check now warns that the notes only say "resolved"', findCheck(rows, /only say/)?.status === 'warn');
    await typeInForm('Fixed it');
    await checkAgainUntil('the short-notes warning', async () => /notes/i.test(findCheck(await checkRows(p), /notes/i)?.text || '') && !/No resolution notes yet/.test(findCheck(await checkRows(p), /notes/i)?.text || ''));
    rows = await checkRows(p);
    t.check('typed a few words: "Check again" reads the form again and warns the notes are very short (or filler)', ['warn'].includes(findCheck(rows, /notes/i)?.status), findCheck(rows, /notes/i)?.text);
    await typeInForm('Replaced the expired gateway certificate on EU-2 and restarted the gateway service. Confirmed with priya.raman@example.com that the VPN stays up.');
    await checkAgainUntil('the notes to pass', async () => findCheck(await checkRows(p), /Resolution notes are filled in/)?.status === 'ok');
    rows = await checkRows(p);
    t.check('typed a proper note: "Resolution notes are filled in" is Fine', findCheck(rows, /Resolution notes are filled in/)?.status === 'ok');
    const pii = findCheck(rows, /personal data or secrets/i);
    t.check('the email address in the typed notes is reported by KIND only ("1 email address") and the address itself is not shown', pii?.status === 'warn' && /1 email address in the resolution notes/.test(pii.text) && !(await text()).includes("priya.raman@example.com"), pii?.text);
    t.check('the hold and close-code checks come from the form too (no hold reason is typed; the close code is empty -> warn)', findCheck(rows, /No close code chosen/)?.status === 'warn');

    // "Improve my resolution notes" starts from what is typed now, masked
    if (await assistOffers(p, /^Improve my resolution notes/)) {
      const before3 = ai.requests.length;
      const improved = await runAfter(p, () => startAction(p, /^Improve my resolution notes/));
      const imp = await checkAiRun(t, ctx, p, 'resolution-improve', improved, { before: before3, system: /improve the resolution notes they are writing/, userHas: [/Replaced the expired gateway certificate on EU-2/, /\[EMAIL_\d+\]/] });
      t.check('resolution-improve: the AI got the notes as typed RIGHT NOW (unsaved), and the typed email address did not travel', imp ? !imp.raw.includes("priya.raman@example.com") : false);
      await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-answer-close'))[0]?.click()); // (Close on an answer is an icon button: its name is its aria-label)
    } else t.warning('"Improve my resolution notes" is not offered in AI Assist yet: its checks did not run (Actions agent)');
    t.check('nothing was written to the form by any of this', (await ticket.evaluate(() => window.__gformCalls.length)) === 0);

    // ============================== CHECK: notes typed on a WORKSPACE page (no g_form: the boxes) ================================================
    await ticket.close();
    ticket = await ctx.openInstancePage(`/now/sow/record/incident/${data.INCIDENT_ID}`, 'ticket-workspace');
    await settleOnRecord(ctx, data.INCIDENT_ID);
    await openCard(p, 'Ready to resolve?');
    await waitPanel(ctx, p, 'the Workspace checks', async () => /Checked the notes typed on this page, plus the saved ticket/.test(await cardText(p, 'resolve')) && (await checkRows(p)).length >= 3, { timeout: 20000 });
    t.check('Workspace: "Ready to resolve?" says it checked the notes typed on this page (not "the saved ticket only")', !/Checked the saved ticket only/.test(await cardText(p, 'resolve')));
    rows = await checkRows(p);
    const wsEmpty = findCheck(rows, /No resolution notes yet/);
    t.check('Workspace: the empty Resolution notes box -> a warning that also names the work note typed in the composer', wsEmpty?.status === 'warn' && /work note you have typed is separate/i.test(wsEmpty.text) && !/no form Agent Buddy can read/.test(wsEmpty.text), wsEmpty?.text);
    const wsCode = findCheck(rows, /close code/i);
    t.check('Workspace: the close code is the saved one, and the card says a code picked on this page is not counted', wsCode?.status === 'warn' && /only the notes are read/.test(wsCode.text), wsCode?.text);
    // Type into the Workspace's own Resolution notes box (inside shadow roots), without saving, and check again
    const wsBox = (await ticket.evaluateHandle(() => {
      const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.tagName === 'TEXTAREA' && el.getAttribute('aria-label') === 'Resolution notes') return el;
          const found = el.shadowRoot && walk(el.shadowRoot);
          if (found) return found;
        }
        return null;
      };
      return walk(document);
    })).asElement();
    t.check('Workspace: the fake Workspace page has a Resolution notes box', Boolean(wsBox));
    if (wsBox) {
      const wsNotes = 'Replaced the expired gateway certificate on EU-2 and restarted the gateway service. Confirmed with priya.raman@example.com that the VPN stays up.';
      await wsBox.type(wsNotes, { delay: 0 });
      const eventsBefore = await ticket.evaluate(() => ({ ...window.__wsEvents }));
      await clickButton(p, /^Check again/);
      await waitPanel(ctx, p, 'the typed Workspace notes to count', async () => findCheck(await checkRows(p), /Resolution notes are filled in/)?.status === 'ok', { timeout: 15000 });
      rows = await checkRows(p);
      t.check('Workspace: notes typed (not saved) in the Resolution notes box count: "Resolution notes are filled in" is Fine', findCheck(rows, /Resolution notes are filled in/)?.status === 'ok');
      const wsPii = findCheck(rows, /personal data or secrets/i);
      t.check('Workspace: the email address typed in the box is reported by KIND only, and the address is not shown', wsPii?.status === 'warn' && /1 email address in the resolution notes/.test(wsPii.text) && !(await text()).includes('priya.raman@example.com'), wsPii?.text);
      const eventsAfter = await ticket.evaluate(() => ({ ...window.__wsEvents }));
      t.check('Workspace: reading the boxes fired no event on them and changed nothing', JSON.stringify(eventsAfter) === JSON.stringify(eventsBefore) && (await ticket.evaluate(deepTextareaValue, 'Resolution notes')) === wsNotes, `${JSON.stringify(eventsBefore)} -> ${JSON.stringify(eventsAfter)}`);
    }

    const bad = errorsSince(ctx, mark);
    t.check('no console error, page error or CSP violation on these cards', bad.length === 0, describeErrors(bad));
    await panel.close();
    await ticket.close();
    ai.reset();
  },
};

// t. The newer sections on portal and Workspace pages (no g_form there):
//    - Write > Rewrite: the form cannot be read ("paste the text instead"); a rewrite goes into the portal's own work-notes box by
//      Replace and by Add below, like typing (the page's model follows), and the success note names the box it went into; the safe-to-send
//      check guards the customer's comment box; the page's Send button is never pressed
//    - Write > Email: the Insert falls back to Copy when the portal has no body box, and works once the classic email form is open
//    - Write > Notes: nothing can be filled on a portal (no blank form), only copied
//    - Check tab: says it checked the saved ticket only (no readable form); Request tab on a portal request page loads
//    - a Workspace page (shadow DOM, no g_form): Rewrite's Add below types into the box labelled "Work notes"
const { prepare, errorMark, errorsSince, describeErrors, clickTab, clickButton, waitForText, textOf, checkAiRun, runAfter, captureClipboard, clipboardLog, waitPanel, settleOnRecord, frameByPath, clickSel } = require('../common.js');
const { deepTextareaValue } = require('../ui.js');

const first = (text, kind) => (new RegExp(`\\[${kind}_\\d+\\]`).exec(text) || [''])[0];
const partOf = (user, label) => (new RegExp(`label="${label}">\\n([\\s\\S]*?)\\n</ticket_data>`).exec(user) || [])[1] || '';

function replier({ system, user }) {
  const person = first(user, 'PERSON') || 'there';
  if (/write an email to the person who raised a ServiceNow ticket/.test(system)) return `Subject: An update\n\nHello ${person},\n\nYour request is being looked at.\n\nKind regards`;
  if (/improve a piece of text they wrote/.test(system)) return `Rewritten: ${partOf(user, 'Text to rewrite')}`;
  if (/log a ticket from rough call/.test(system)) return 'Short description: VPN is down\nDescription: The VPN is down since this morning.\nImpact: High\nUrgency: High\nContact type: Phone';
  return null;
}

const boxes = (page) =>
  page.evaluate(() => ({
    comment: document.getElementById('comment')?.value ?? null,
    workNote: document.getElementById('worknote')?.value ?? null,
    model: { ...window.__portal.model },
    events: JSON.parse(JSON.stringify(window.__portal.events)),
    sends: [...window.__portal.sends],
  }));

module.exports = {
  id: 't',
  title: 'Portal and Workspace pages: Rewrite types into the page\'s own box, Email and Notes fall back to Copy, the Check and Request tabs work without a form',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    const A = data.PORTAL.tickets[0];
    const R = data.PORTAL.tickets[2];
    await prepare(ctx);
    ai.setReplier(replier);
    const mark = errorMark(ctx);
    const panel = await ctx.openPanel();
    const p = panel.page;

    // ============================== /csm: an incident ===================================================================================
    let portal = await ctx.openInstancePage(`/csm?id=csm_ticket&table=incident&sys_id=${A.sysId}`, 'portal-csm');
    await settleOnRecord(ctx, A.sysId);
    await waitForText(p, data.INCIDENT_NUMBER, { timeout: 20000 });
    const nav = await p.$$eval('[role="tablist"][aria-label="Agent Buddy sections"] [role="tab"]', (tabs) => tabs.map((x) => x.innerText.trim()));
    t.check('on a portal page the panel has all five sections', JSON.stringify(nav) === '["This page","My day","Team","Write","Knowledge"]', nav.join(' | '));

    // ---- Check tab: no form to read ---------------------------------------------------------------------------------------------
    await clickTab(p, 'Check');
    await waitForText(p, 'Check before you resolve', { timeout: 15000 });
    await waitForText(p, /Checked the saved ticket only\. This page has no form Agent Buddy can read/, { timeout: 20000 });
    t.check('Check tab on a portal page: says it checked the saved ticket only, because the page has no form it can read', true);

    // ---- Write > Rewrite -----------------------------------------------------------------------------------------------------------
    await clickTab(p, 'Write');
    await clickTab(p, 'Rewrite');
    await p.waitForSelector('#ab-rewrite-text', { visible: true, timeout: 10000 });
    await p.select('#ab-rewrite-field', 'work_notes');
    await clickButton(p, /^Use what I typed in the form/);
    await waitForText(p, /cannot read the form on this page \(Workspace and portal pages keep it out of reach\)\. Paste the text here instead\./, { timeout: 10000 });
    t.check('"Use what I typed in the form" on a portal: a plain sentence says to paste the text instead (the portal keeps its form out of reach)', true);

    const pasted = `Hi ${data.SEED.callerName}, ${data.MORE_SEED.rewriteName} will call you on ${data.MORE_SEED.rewritePhone} or write to ${data.MORE_SEED.rewriteEmail}. The card ${data.MORE_SEED.rewriteCard} was refused. Your password: ${data.MORE_SEED.rewritePassword} is temporary.`;
    await p.click('#ab-rewrite-text');
    await p.type('#ab-rewrite-text', pasted, { delay: 0 });
    await p.type('#ab-rewrite-names', data.MORE_SEED.rewriteName);
    await captureClipboard(p);
    const before = ai.requests.length;
    const ran = await runAfter(p, () => clickButton(p, /^Plain language/));
    await checkAiRun(t, ctx, p, 'rewrite-plain (portal)', ran, { before, system: /improve a piece of text they wrote/, userHas: [/\[PERSON_\d+\]/, /\[CARD_\d+\]/, /\[SECRET_\d+\]/] });
    await waitForText(p, 'Use it in the form', { timeout: 8000 });

    const start = await boxes(portal);
    t.check('the portal\'s internal work-notes box starts with what the agent typed, and the page\'s model agrees', start.workNote === 'Checked the logs.' && start.model.workNote === start.workNote);
    await clickButton(p, /^Replace what is in the form/);
    await waitForText(p, /Inserted into the form/, { timeout: 8000 });
    const replaced = await boxes(portal);
    const plain = replaced.workNote;
    t.check('"Replace what is in the form": the work-notes box now holds only the rewrite, and the comment box is untouched', plain.startsWith('Rewritten: Hi Abel Tuter') && !plain.includes('Checked the logs.') && replaced.comment === start.comment, plain.slice(0, 80));
    t.check('...the page\'s own model followed (input and change events were delivered, like typing)', replaced.model.workNote === plain && replaced.events.workNote.input > start.events.workNote.input && replaced.events.workNote.change >= 1, JSON.stringify(replaced.events.workNote));
    t.check('...the success note names the box the text went into', /It went into the box labelled "Work notes \(internal\)"/.test((await textOf(p, '.ab-note-ok')) || ''), (await textOf(p, '.ab-note-ok')) || '');
    await clickButton(p, /^Add below/);
    await ctx.waitUntil('the second write', async () => (await boxes(portal)).workNote.length > plain.length, { timeout: 8000 });
    const appended = await boxes(portal);
    t.check('"Add below": the same text is added under it, a blank line between', appended.workNote === `${plain}\n\n${plain}` && appended.model.workNote === appended.workNote, appended.workNote.slice(0, 60));
    t.check('the portal\'s Send button was never pressed and its form was never submitted', appended.sends.length === 0, appended.sends.join(','));

    // The customer's comment box: the card and password that came back are stopped
    await p.select('#ab-rewrite-field', 'comments');
    await clickButton(p, /^Add below/);
    await p.waitForSelector('.ab-note-warn[role="alert"]', { timeout: 8000 });
    const warn = (await textOf(p, '.ab-note-warn[role="alert"]')) || '';
    t.check('the customer\'s comment box on a portal: the safe-to-send check stops the card and the password (masked excerpts only)', /Check before sending to the customer/.test(warn) && !warn.includes(data.MORE_SEED.rewriteCard) && !warn.includes(data.MORE_SEED.rewritePassword), warn.replace(/\s+/g, ' ').slice(0, 160));
    t.check('...and nothing was written to that box', (await boxes(portal)).comment === start.comment);
    await clickButton(p, /^Edit first/);
    await waitForText(p, /Not inserted\. Copied to the clipboard instead\.|The browser blocked copying/, { timeout: 8000 });
    await clickButton(p, /^Use as my text/);
    await p.$eval('#ab-rewrite-text', (el) => { el.value = ''; });

    // ---- Write > Notes: there is no blank form on a portal ---------------------------------------------------------------------------
    await clickTab(p, 'Notes to ticket');
    await ctx.sleep(500);
    await waitPanel(ctx, p, 'the notes box', async () => (await p.$('#ab-notes-text')) !== null && (await p.$eval('#ab-notes-text', (el) => el.getClientRects().length > 0)), { timeout: 8000 });
    await p.click('#ab-notes-text');
    await p.type('#ab-notes-text', 'vpn down since this morning, error 809', { delay: 0 });
    await runAfter(p, () => clickButton(p, /^Write the ticket/));
    await waitForText(p, 'Review, then fill the form', { timeout: 8000 });
    const plan = await p.evaluate(() => ({ off: window.__vis(document.querySelectorAll('button')).find((b) => /^Fill the form/.test(b.innerText.trim()))?.disabled, reason: document.querySelector('[aria-label="Review before filling the form"] .ab-note[role="status"]')?.innerText || '' }));
    t.check('Notes to ticket on a portal: the form cannot be filled (no blank classic form): the button is off and says why; Copy is there', plan.off === true && /only offered on a blank ticket form/.test(plan.reason), JSON.stringify(plan));

    // ---- Write > Email: no body box on a portal -> Copy; the classic email form takes it -----------------------------------------------
    await clickTab(p, 'Email');
    await waitPanel(ctx, p, 'the email suggestions on the portal', async () => (await p.$$('[aria-label="Suggested emails"] .ab-compose-row')).length > 0, { timeout: 25000 });
    const b2 = ai.requests.length;
    const email = await runAfter(p, () => clickSel(p, '[aria-label="Suggested emails"] .ab-compose-row button'));
    await checkAiRun(t, ctx, p, 'email (portal)', email, { before: b2, system: /write an email to the person who raised a ServiceNow ticket/ });
    await waitForText(p, 'Use the draft', { timeout: 8000 });
    await clickButton(p, /^Insert into the email body/);
    await waitPanel(ctx, p, 'the Copy fallback', async () => /That field is not on this form\. Copied to the clipboard instead\.|The browser blocked copying/.test(await p.evaluate(() => document.body.innerText)), { timeout: 8000 });
    t.check('"Insert into the email body" on a portal (no body box): falls back to Copy with a plain sentence, writes nothing', (await boxes(portal)).sends.length === 0 && (await boxes(portal)).comment === start.comment);
    await clickButton(p, /^Open the email form/);
    await ctx.waitUntil('the tab to open the classic email form', async () => new URL(portal.url()).pathname === '/email_client.do', { timeout: 10000 });
    t.check('"Open the email form" from a portal opens the classic email form, in the same tab, on the same instance', portal.url().startsWith(inst.origin) && new URL(portal.url()).searchParams.get('sysparm_sys_id') === A.sysId, portal.url());
    await portal.waitForFunction(() => window.__gformReady === true, { timeout: 10000 });
    await ctx.waitUntil('the draft to stay on screen', async () => (await p.evaluate(() => document.body.innerText)).includes('Use the draft'), { timeout: 15000 });
    await clickButton(p, /^Insert into the email body/);
    await waitForText(p, /Inserted into the form/, { timeout: 8000 });
    t.check('...and there the body is filled (one setValue on body)', (await portal.evaluate(() => window.__gformCalls)).map((c) => c.name).join() === 'body');
    await portal.close();

    // ============================== /esc: a catalog request ===========================================================================
    portal = await ctx.openInstancePage(`/esc?id=sc_request&sys_id=${R.sysId}`, 'portal-esc');
    await settleOnRecord(ctx, R.sysId);
    await clickTab(p, 'This page');
    await waitForText(p, data.REQUEST_NUMBER, { timeout: 20000 });
    await clickTab(p, 'Request');
    await waitForText(p, 'Where is this request?', { timeout: 15000 });
    await waitPanel(ctx, p, 'the request status on the portal', async () => (await p.$('[aria-label="What it is waiting for"]')) !== null, { timeout: 25000 });
    await p.evaluate(() => document.querySelectorAll('details:not([open]) > summary').forEach((s) => s.click()));
    await ctx.sleep(300);
    const reqText = await p.evaluate(() => document.body.innerText);
    t.check('Request tab on a portal request page: the status card and the items of the request (RITM0010050) load', /RITM0010050/.test(reqText) && /Standard Laptop|Requested items|Items/i.test(reqText), reqText.replace(/\s+/g, ' ').slice(0, 120));
    await clickTab(p, 'Actions');
    await p.waitForSelector('.ab-features', { visible: true, timeout: 10000 });
    const requestActions = await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-features .ab-feature-title')).map((e) => e.innerText.trim()));
    t.check('a request (not an item) offers the summary and reply actions but no "Write resolution notes" and no routing hint', requestActions.includes('Summarise this ticket') && !requestActions.includes('Write resolution notes') && !requestActions.includes('Where should this go?'), requestActions.join(' | '));
    await portal.close();

    // ============================== Workspace: Rewrite types into the box labelled "Work notes" =============================================
    const ws = await ctx.openInstancePage(`/now/sow/record/incident/${data.INCIDENT_ID}`, 'workspace');
    await settleOnRecord(ctx, data.INCIDENT_ID);
    await clickTab(p, 'Write');
    await clickTab(p, 'Rewrite');
    await p.waitForSelector('#ab-rewrite-text', { visible: true, timeout: 10000 });
    await p.select('#ab-rewrite-field', 'work_notes');
    await p.$eval('#ab-rewrite-text', (el) => { el.value = ''; });
    await p.click('#ab-rewrite-text');
    await p.type('#ab-rewrite-text', 'please check the vpn gateway certificate', { delay: 0 });
    await p.$eval('#ab-rewrite-names', (el) => { el.value = ''; });
    await runAfter(p, () => clickButton(p, /^Plain language/));
    await waitForText(p, 'Use it in the form', { timeout: 8000 });
    const wsBefore = await ws.evaluate(deepTextareaValue, 'Work notes');
    await clickButton(p, /^Add below/);
    await waitForText(p, /Inserted into the form/, { timeout: 8000 });
    const wsAfter = await ws.evaluate(deepTextareaValue, 'Work notes');
    t.check('Workspace: "Add below" types the rewrite into the box labelled "Work notes", below what the agent typed', wsAfter.startsWith(wsBefore) && wsAfter.includes('Rewritten: please check the vpn gateway certificate'), wsAfter.slice(0, 120));
    t.check('...the success note names the box ("Work notes"), and the Additional comments box was not touched', /It went into the box labelled "Work notes"/.test((await textOf(p, '.ab-note-ok')) || '') && (await ws.evaluate(deepTextareaValue, 'Additional comments')) === '', (await textOf(p, '.ab-note-ok')) || '');
    await ws.close();

    const bad = errorsSince(ctx, mark);
    t.check('no console error, page error or CSP violation on these pages', bad.length === 0, describeErrors(bad));
    await panel.close();
    ai.reset();
  },
};

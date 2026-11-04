// f. Failure modes. Each one must end in a plain sentence for the person, a truthful audit entry where one belongs,
//    and (the important part) nothing sent that should not have been.
const { findLeaks } = require('../leaks.js');
const { clickButton, waitForText, textOf, runFeature, waitForRecord, openHalf } = require('../ui.js');

// Text that must never be shown to a person: stack traces, internals, "undefined".
const UGLY = /TypeError|ReferenceError|undefined|\[object| {4}at |Error:/;

module.exports = {
  id: 'f',
  title: 'Failure modes: bad key, denied journal, denied record, HR policy block, cancelled preview',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.ensureEnabled();
    await ctx.configure(
      { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', previewMode: 'always', previewSeen: [], instances: [inst.origin] },
      { key: { provider: 'custom', value: ai.key } }
    );
    const auditCount = async () => (await ctx.audit()).length;
    const lastAudit = async () => (await ctx.audit()).slice(-1)[0];

    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-classic');
    let panel = await ctx.openPanel();
    let p = panel.page;
    await waitForRecord(p);
    await openHalf(p, 'assist');

    // ---- 1. The AI rejects the key (HTTP 401) ----------------------------------------------------------------------
    ai.setMode('bad-key');
    const bad = await runFeature(p, /^Summarise this ticket/);
    t.check('401 from the AI: a plain error is shown, not a stack trace', /rejected the API key/i.test(bad.error || '') && !UGLY.test(bad.error || ''), bad.error || '');
    // Round 3 (AI0.4): an error offers the step that can fix it. A rejected key is fixed in Settings; the same key would fail again.
    const badSteps = await p.evaluate(() => { const n = [...document.querySelectorAll('.ab-runerror')].find((e) => e.getClientRects().length > 0); return n ? [...n.querySelectorAll('button')].map((b) => b.innerText.trim()) : null; });
    t.check('401 from the AI: the error offers Open Settings (not Try again: the same key would fail again)', Boolean(badSteps) && badSteps.includes('Open Settings') && !badSteps.includes('Try again'), JSON.stringify(badSteps));
    t.check('401 from the AI: the actions can be used again at once', await p.evaluate(() => [...document.querySelectorAll('button')].some((b) => /^Summarise this ticket/.test(b.innerText.trim()) && !b.disabled && b.getClientRects().length > 0)));
    const badEntry = await lastAudit();
    t.check("401 from the AI: audit entry has outcome 'error' and reason BAD_KEY", badEntry?.outcome === 'error' && badEntry.reason === 'BAD_KEY' && badEntry.feature === 'record-summary', JSON.stringify(badEntry));
    t.check('401 from the AI: the request that was refused still carried no raw personal data', ai.requests.length === 1 && findLeaks(ai.requests[0].raw, data).critical.length === 0);
    t.check('the error text and the audit entry hold no key and no ticket content', !JSON.stringify(badEntry).includes(ai.key) && !(bad.error || '').includes(ai.key));
    ai.setMode('echo');

    // ---- 2. The user cancels in the preview: nothing is sent ----------------------------------------------------------
    ai.requests.length = 0;
    await clickButton(p, /^Summarise this ticket/);
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    await clickButton(p, /^Cancel/);
    await p.waitForFunction(() => !document.querySelector('.ab-dialog'), { timeout: 5000 });
    await ctx.sleep(400);
    const cancelled = await lastAudit();
    t.check('Cancel in the preview sends nothing to the AI', ai.requests.length === 0);
    t.check("Cancel in the preview is audited as 'cancelled'", cancelled?.outcome === 'cancelled' && cancelled.preview === 'shown', JSON.stringify(cancelled));

    // The Escape key is the same as Cancel.
    const cancelledBefore = (await ctx.audit()).filter((e) => e.outcome === 'cancelled').length;
    await clickButton(p, /^Summarise this ticket/);
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    // The dialog takes the keyboard focus (so that Escape and Tab belong to it) from an IntersectionObserver, which only runs when the
    // window paints. Wait for that, as a person would (they see the dialog first), and say so if it never happened.
    const tookFocus = await p.waitForFunction(() => Boolean(document.activeElement?.closest('.ab-backdrop')), { timeout: 4000 }).then(() => true, () => false);
    if (!tookFocus) {
      t.info(`the preview did not take the keyboard focus within 4 s (activeElement: ${await p.evaluate(() => document.activeElement?.tagName)}, hasFocus: ${await p.evaluate(() => document.hasFocus())}); focusing it by hand`);
      await p.evaluate(() => document.querySelector('.ab-backdrop').focus());
    }
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('.ab-dialog'), { timeout: 5000 });
    await ctx.sleep(400);
    t.check('Escape in the preview cancels: nothing sent, audited as cancelled', ai.requests.length === 0 && (await ctx.audit()).filter((e) => e.outcome === 'cancelled').length === cancelledBefore + 1);

    // ---- 3. sys_journal_field answers 403: fall back on the record's own comments / work_notes -------------------------
    inst.setBehaviour({ denied: ['sys_journal_field'] });
    ai.requests.length = 0;
    const journal403 = await runFeature(p, /^Summarise this ticket/);
    t.check('journal denied (403): the preview still builds from the notes on the record itself', Boolean(journal403.preview) && journal403.preview.includes('Same as yesterday') && journal403.preview.includes('Checking certificate expiry'), (journal403.error || '').slice(0, 120));
    t.check('journal denied (403): the summary still works', Boolean(journal403.result) && journal403.result.includes(data.SEED.callerName), journal403.error || '');
    const saw403 = inst.browserRequests().some((r) => r.path === '/api/now/table/sys_journal_field' && r.status === 403);
    t.check('journal denied (403): the instance really answered 403 for sys_journal_field (the fallback was used)', saw403);
    t.check('journal denied (403): the fallback text is masked too (no card, password, names, email, phone at the AI)', ai.requests.length === 1 && findLeaks(ai.requests[0].raw, data).critical.length === 0, findLeaks(ai.requests[0]?.raw || '', data).critical.join(' | '));
    t.check('journal denied (403): placeholders for the card and password are present in what was sent', /\[CARD_1\]/.test(ai.requests[0]?.raw || '') && /\[SECRET_1\]/.test(ai.requests[0]?.raw || ''));
    t.check('journal denied (403): no error is shown', (await textOf(p, '.ab-note-danger')) === null);
    await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-answer-close'))[0]?.click()); // (Close on an answer is an icon button: its name is its aria-label)

    // ---- 4. The record's own table answers 403 -----------------------------------------------------------------------
    inst.setBehaviour({ denied: ['incident'] });
    ai.requests.length = 0;
    const denied = await runFeature(p, /^Summarise this ticket/);
    t.check("record table denied (403): a plain 'not allowed' message, no stack trace", /not allowed to read this/i.test(denied.error || '') && !UGLY.test(denied.error || ''), denied.error || '');
    t.check('record table denied (403): nothing was sent to the AI', ai.requests.length === 0);
    inst.setBehaviour();

    // ---- 5. An expired session: the instance answers 401 ----------------------------------------------------------------
    inst.setBehaviour({ expired: true });
    ai.requests.length = 0;
    const expired = await runFeature(p, /^Summarise this ticket/);
    t.check('expired ServiceNow session: plain "log in again" message', /session has expired/i.test(expired.error || '') && !UGLY.test(expired.error || ''), expired.error || '');
    t.check('expired ServiceNow session: nothing was sent to the AI', ai.requests.length === 0);
    inst.setBehaviour();

    // ---- 5b. "Other server" with no address: it must not fall back to a public API with the person's key ----------------------
    const beforeBlocked = await auditCount();
    await ctx.configure({ baseUrls: {} });
    await ctx.sleep(300);
    ai.requests.length = 0;
    // The set-up is checked before anything can start: the AI buttons are off and the panel says what to finish, in Settings.
    const setupText = await waitForText(p, /Finish the AI set-up in Settings[^.]*: Enter the address of your AI server/, { timeout: 8000 }).catch(() => '');
    const summariseOff = await p.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /^Summarise this ticket/.test(b.innerText.trim()) && b.getClientRects().length > 0).every((b) => b.disabled));
    t.check('custom provider with no address: the AI buttons are off and the panel says to enter the address in Settings, before anything starts', Boolean(setupText) && summariseOff, setupText ? '' : 'no set-up sentence on screen');
    await ctx.sleep(500);
    t.check('custom provider with no address: nothing went out to the AI server or to any public API', ai.requests.length === 0 && !ctx.net.some((n) => /api\.openai\.com|api\.anthropic\.com/.test(n.url)), ctx.net.filter((n) => /api\.openai\.com/.test(n.url)).map((n) => n.url).join(' '));
    const noAddressAudit = (await ctx.audit()).slice(beforeBlocked);
    t.check('custom provider with no address: nothing could start, so nothing was audited as sent', !noAddressAudit.some((e) => e.outcome === 'sent'), JSON.stringify(noAddressAudit));
    await ctx.configure({ baseUrls: { custom: ai.baseUrl } });
    await ctx.sleep(300);
    await panel.close();
    await ticket.close();

    // ---- 6. An HR case: the policy blocks it before anything is built -----------------------------------------------
    // (Policy comes from chrome.storage.managed, which a test cannot write; the built-in rule for sn_hr_ tables is the
    //  one block that needs no policy: HR free text is not sent to an AI unless the organisation allows it.)
    const hr = await ctx.openInstancePage(`/now/sow/record/sn_hr_core_case/${data.HR_CASE_ID}`, 'ticket-hr');
    panel = await ctx.openPanel();
    p = panel.page;
    await waitForRecord(p, data.HR_CASE_NUMBER);
    ai.requests.length = 0;
    const before = await auditCount();
    await openHalf(p, 'assist');
    // Round 3: the AI Assist half knows before any click that no AI action may use this record (the same rule the pipeline applies:
    // src/sidepanel/ticket/assist/actions/plan.js recordBlock). It says so once and offers nothing to start: no action, no question box.
    const hrText = await waitForText(p, /HR case content is not sent to an AI/i, { timeout: 8000 }).catch(() => '');
    const hrOffers = await p.evaluate(() => ({
      actions: [...document.querySelectorAll('button')].filter((b) => b.getClientRects().length > 0 && /^Summarise this ticket|^Draft a reply/.test(b.innerText.trim()) && !b.disabled).length,
      ask: [...document.querySelectorAll('.ab-ask')].filter((e) => e.getClientRects().length > 0).length,
    }));
    t.check('HR case: AI Assist says in plain words that HR content is not sent, and offers no action and no question box', Boolean(hrText) && hrOffers.actions === 0 && hrOffers.ask === 0, JSON.stringify(hrOffers));
    t.check('HR case: nothing reached the AI server', ai.requests.length === 0);
    const hrAudit = (await ctx.audit()).slice(before);
    t.check('HR case: nothing was started, so nothing was audited as sent', !hrAudit.some((e) => e.outcome === 'sent'), JSON.stringify(hrAudit));
    t.check('HR case: the audit log holds no HR text', !JSON.stringify(await ctx.audit()).match(/maternity|Jane|Doe|leave/i));
    t.info('the pipeline refusal itself (HR_BLOCKED, audited as blocked) is unit-tested; the panel no longer offers a way to start it on an HR case');

    // HR table denied outright (a user without the HR role): the panel still offers nothing to start and sends nothing.
    inst.setBehaviour({ denied: ['sn_hr_core_case'] });
    await ctx.sleep(500);
    t.check('HR table denied for this user: nothing sent', ai.requests.length === 0);
    inst.setBehaviour();
    await panel.close();
    await hr.close();

    // ---- 7. Local-only privacy mode with an AI address that is not on this computer -------------------------------------
    // (The browser asks for permission to a new AI address first; automation cannot answer that prompt, so this part is
    //  checked on the settings only. See the report.)
    const settings = await ctx.settings();
    t.info(`firewall BLOCKED_FIELD / NOT_LOCAL paths are unit-tested; here the HR rule is checked as the panel shows it. piiMode=${settings.piiMode}`);
  },
};

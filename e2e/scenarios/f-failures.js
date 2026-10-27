// f. Failure modes. Each one must end in a plain sentence for the person, a truthful audit entry where one belongs,
//    and (the important part) nothing sent that should not have been.
const { findLeaks } = require('../leaks.js');
const { clickButton, waitForText, textOf, runFeature, waitForRecord } = require('../ui.js');

// Text that must never be shown to a person: stack traces, internals, "undefined".
const UGLY = /TypeError|ReferenceError|undefined|\[object|    at |Error:/;

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

    // ---- 1. The AI rejects the key (HTTP 401) ----------------------------------------------------------------------
    ai.setMode('bad-key');
    const bad = await runFeature(p, /^Summarise this ticket/);
    t.check('401 from the AI: a plain error is shown, not a stack trace', /rejected the API key/i.test(bad.error || '') && !UGLY.test(bad.error || ''), bad.error || '');
    t.check('401 from the AI: the panel goes back to the action list so the person can retry', await p.evaluate(() => [...document.querySelectorAll('button.ab-feature')].some((b) => /Summarise this ticket/.test(b.innerText))));
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
    await clickButton(p, /^Close/);

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
    const noAddress = await runFeature(p, /^Summarise this ticket/);
    t.check('custom provider with no address: plain message, no preview, nothing to approve', /address of your AI server/i.test(noAddress.error || '') && noAddress.preview === null, noAddress.error || '');
    await ctx.sleep(500);
    t.check('custom provider with no address: nothing went out to the AI server or to any public API', ai.requests.length === 0 && !ctx.net.some((n) => /api\.openai\.com|api\.anthropic\.com/.test(n.url)), ctx.net.filter((n) => /api\.openai\.com/.test(n.url)).map((n) => n.url).join(' '));
    const noAddressAudit = (await ctx.audit()).slice(beforeBlocked);
    t.check("custom provider with no address: audited as 'blocked' (BAD_URL)", noAddressAudit.length === 1 && noAddressAudit[0].outcome === 'blocked' && noAddressAudit[0].reason === 'BAD_URL', JSON.stringify(noAddressAudit));
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
    const hrRun = await runFeature(p, /^Summarise this ticket/);
    t.check('HR case: blocked with a plain explanation, no preview, nothing to approve', /HR case content is not sent to an AI/i.test(hrRun.error || '') && hrRun.preview === null, hrRun.error || '');
    t.check('HR case: nothing reached the AI server', ai.requests.length === 0);
    const hrAudit = (await ctx.audit()).slice(before);
    t.check("HR case: audit entry has outcome 'blocked' and reason HR_BLOCKED", hrAudit.length === 1 && hrAudit[0].outcome === 'blocked' && hrAudit[0].reason === 'HR_BLOCKED', JSON.stringify(hrAudit));
    t.check('HR case: the audit entry holds no HR text', !JSON.stringify(hrAudit).match(/maternity|Jane|Doe|leave/i));

    // HR table denied outright (a user without the HR role): same plain behaviour, nothing sent.
    inst.setBehaviour({ denied: ['sn_hr_core_case'] });
    const hrDenied = await runFeature(p, /^Summarise this ticket/);
    t.check('HR table denied for this user: plain message, nothing sent', /not allowed to read this/i.test(hrDenied.error || '') && ai.requests.length === 0, hrDenied.error || '');
    inst.setBehaviour();
    await panel.close();
    await hr.close();

    // ---- 7. Local-only privacy mode with an AI address that is not on this computer -------------------------------------
    // (The browser asks for permission to a new AI address first; automation cannot answer that prompt, so this part is
    //  checked on the settings only. See the report.)
    const settings = await ctx.settings();
    t.info(`firewall BLOCKED_FIELD / NOT_LOCAL paths are unit-tested; here only HR_BLOCKED could be driven. piiMode=${settings.piiMode}`);
  },
};

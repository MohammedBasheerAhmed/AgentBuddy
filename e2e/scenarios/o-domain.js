// o. The domain features, through the real panel and content script: account-briefing and case-eng-escalation (customer service
//    case), problem-rca (problem), change-cab-brief (change) and hr-case-brief (HR case).
//    - each runs end to end with the stub AI; no seeded personal data (names, emails, phones, secrets) reaches the preview or the AI
//    - the extra reads they make (the account's other cases, the problem's linked incidents, the change's approvals, tasks and
//      conflicts) really happen and end up in the request, as GET-only reads
//    - the Insert buttons fill ONE field each (problem: statement, cause, workaround), never save
//    - the HR case brief: "Needs Strict privacy mode" in Standard mode and a click ends with the Strict-mode message; in Strict mode
//      with no organisation policy it ends with HR_BLOCKED; in both cases nothing reaches the AI and no HR free text was read
const { prepare, errorMark, errorsSince, describeErrors, clickButton, waitForText, textOf, checkAiRun } = require('../common.js');
const { runFeature } = require('../ui.js');

const first = (text, kind) => (new RegExp(`\\[${kind}_\\d+\\]`).exec(text) || [''])[0];

function replier({ system, user }) {
  const person = first(user, 'PERSON') || 'the customer';
  if (/get ready for a call with a customer/.test(system)) {
    return `Who: ${person} at Acme Corp, product Cloud Gateway.\nEntitlement: Gold Support.\nThis case: Intermittent 502 errors, state Open, priority 2 - High.\nHistory:\n- CS0001002 Acme Corp invoices not syncing (open)\n- CS0000990 SSO login loop (closed)\nWatch out for: The response SLA is breached.\nSuggested opening: Hello ${person}, thank you for your patience.`;
  }
  if (/hand a customer case to engineering/.test(system)) {
    return `Summary: The Cloud Gateway returns 502 for Acme Corp users.\nCustomer impact: Intermittent errors since the weekend.\nEnvironment: Cloud Gateway.\nSteps to reproduce: Not stated\nExpected vs actual: Expected 200, actual 502.\nEvidence from the case: "502" (description)\nWhat has been tried: Two upstream nodes were found unhealthy.\nAsk: Please check the upstream pool.`;
  }
  if (/write up a problem record/.test(system)) {
    return 'Problem statement: Remote access sessions reset about every ten minutes on gateway EU-2 since the certificate was rotated.\nTimeline:\n- INC0009001 first report\n- INC0009640 second report\nProbable cause: Hypothesis: the certificate chain is incomplete on EU-2.\nWorkaround: Switch the client profile to TCP mode.\nPermanent fix options: Install the full certificate chain.\nOpen questions: Does EU-1 behave the same?';
  }
  if (/prepare a Change Advisory Board/.test(system)) {
    return 'What changes: The gateway certificate on EU-2.\nWhy: The old certificate expires on Friday.\nWhen: In about two days, CAB tomorrow.\nWho is affected: All remote users.\nRisk and impact: Moderate.\nPlans: Implementation plan present. Back-out plan: Missing. Test plan present.\nApprovals so far: one approved, one waiting.\nScheduling conflicts: CHG0030002 overlaps.\nQuestions the CAB should ask: What is the back-out plan?';
  }
  return null;
}

// Reads the browser made for a table since `from` (an index into the instance log): the GETs, with their decoded query strings.
const readsOf = (inst, from, table) => inst.requests.slice(from).filter((r) => r.path === `/api/now/table/${table}`).map((r) => decodeURIComponent(r.search));

module.exports = {
  id: 'o',
  title: 'Domain features end to end: account briefing, engineering escalation, problem RCA, CAB brief; the HR brief is refused in Standard mode and without a policy',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    await prepare(ctx);
    ai.setReplier(replier);
    const mark = errorMark(ctx);
    const panel = await ctx.openPanel();
    const p = panel.page;
    const close = () => clickButton(p, /^Close/);
    const gform = (page, fn) => page.evaluate(fn);

    // ---- 1. Customer service case ---------------------------------------------------------------------------------------------
    let ticket = await ctx.openInstancePage(`/sn_customerservice_case.do?sys_id=${data.CASE_ID}`, 'ticket-case');
    await waitForText(p, data.CASE_NUMBER, { timeout: 20000 });
    await p.waitForSelector('.ab-features', { timeout: 15000 });
    const offered = await p.evaluate(() => [...document.querySelectorAll('.ab-features .ab-feature-title')].map((e) => e.innerText.trim()));
    t.check('a case offers "Brief me before the call" and "Draft an engineering escalation"; a problem/change/HR feature is not offered', offered.includes('Brief me before the call') && offered.includes('Draft an engineering escalation') && !offered.some((o) => /RCA|CAB|HR case brief/.test(o)), offered.join(' | '));

    let before = ai.requests.length;
    let fromLog = inst.requests.length;
    let ran = await runFeature(p, /^Brief me before the call/);
    let req = await checkAiRun(t, ctx, p, 'account-briefing', ran, { before, system: /get ready for a call with a customer/, userHas: [/CS0001002/, /CS0000990/, /Gold Support/] });
    const accountReads = readsOf(inst, fromLog, 'sn_customerservice_case').filter((q) => q.includes('account='));
    t.check('account-briefing: the account\'s other cases were read with one GET, by the account id, not the case itself', accountReads.length === 1 && /account=e2e0/.test(accountReads[0]) && /sys_id!=/.test(accountReads[0]), accountReads.join(' || ').slice(0, 200));
    t.check('account-briefing: the contact (Erin Contact, her email and phone) never reached the AI', req ? !/Erin|erin@acme|555-0177/i.test(req.raw) : false);
    t.check('account-briefing: the answer shows the contact by name again (put back locally)', /Erin Contact/.test(ran.result || ''), (ran.result || '').replace(/\s+/g, ' ').slice(0, 100));
    await close();

    before = ai.requests.length;
    ran = await runFeature(p, /^Draft an engineering escalation/);
    req = await checkAiRun(t, ctx, p, 'case-eng-escalation', ran, { before, system: /hand a customer case to engineering/, userHas: [/Cloud Gateway/] });
    t.check('case-eng-escalation: it offers work notes only (no customer comment)', await p.evaluate(() => document.body.innerText.includes('Add to work notes') && !document.body.innerText.includes('Insert as customer comment')));
    t.check('case-eng-escalation: the customer contact is not sent as a field (only masked wherever the text names them)', req ? !/Erin|erin@acme/i.test(req.raw) : false);
    await close();
    await ticket.close();

    // ---- 2. Problem: three inserts, one field each --------------------------------------------------------------------------------
    ticket = await ctx.openInstancePage(`/problem.do?sys_id=${data.PROBLEM_ID}`, 'ticket-problem');
    await waitForText(p, data.PROBLEM_NUMBER, { timeout: 20000 });
    await p.waitForSelector('.ab-features', { timeout: 15000 });
    before = ai.requests.length;
    fromLog = inst.requests.length;
    ran = await runFeature(p, /^Draft the problem statement and RCA/);
    req = await checkAiRun(t, ctx, p, 'problem-rca', ran, { before, system: /write up a problem record/, userHas: [/INC0009001/, /INC0009640/, /PTASK0040002/] });
    const linked = readsOf(inst, fromLog, 'incident').filter((q) => q.includes('problem_id='));
    t.check('problem-rca: the linked incidents were read by problem_id (GET), oldest first', linked.length >= 1 && linked.some((q) => /ORDERBYopened_at/.test(q)), linked.join(' || ').slice(0, 160));
    t.check('problem-rca: the secret in the work note ("password: ...") is masked in the request', req ? !req.raw.includes(data.MORE_SEED.secret) && /\[SECRET_\d+\]/.test(req.raw) : false);
    const inserts = await p.evaluate(() => [...document.querySelectorAll('.ab-card .ab-row button')].map((b) => b.innerText.trim()));
    t.check('problem-rca: one Insert button per part: statement, cause, workaround', ['Insert problem statement', 'Insert probable cause', 'Insert workaround'].every((b) => inserts.includes(b)), inserts.join(' | '));
    await clickButton(p, /^Insert probable cause/);
    await waitForText(p, /Inserted into the form/, { timeout: 8000 });
    await clickButton(p, /^Insert workaround/);
    await ctx.waitUntil('the second insert', async () => (await gform(ticket, () => window.__gformCalls.length)) >= 2, { timeout: 8000 });
    await clickButton(p, /^Insert problem statement/);
    await ctx.waitUntil('the third insert', async () => (await gform(ticket, () => window.__gformCalls.length)) >= 3, { timeout: 8000 });
    const calls = await gform(ticket, () => window.__gformCalls);
    const byName = Object.fromEntries(calls.map((c) => [c.name, c.value]));
    t.check('problem-rca: three setValue calls, one each on cause_notes, workaround and description, nothing saved', JSON.stringify(calls.map((c) => c.name).sort()) === '["cause_notes","description","workaround"]' && (await gform(ticket, () => window.__gformSaves.length)) === 0, calls.map((c) => c.name).join(','));
    t.check('problem-rca: each field got only its own section (no heading of another section inside it)', /^Hypothesis: the certificate chain/.test(byName.cause_notes || '') && /Switch the client profile to TCP mode.$/.test(byName.workaround || '') && /Remote access sessions reset about every ten minutes[^]*$/.test(byName.description || '') && !/Workaround:|Timeline:|Open questions:|Problem statement:/.test(`${byName.cause_notes}${byName.description}${byName.workaround}`), JSON.stringify(byName).slice(0, 200));
    t.check('problem-rca: what the form already held (description, workaround) is KEPT and the new text is added below it (append, never replace)', (byName.description || '').startsWith('<p>Several users') && /\n\nRemote access sessions reset/.test(byName.description || '') && /^Switch the client profile to TCP mode\.\n\nSwitch the client profile to TCP mode\.$/.test(byName.workaround || ''), JSON.stringify(byName.workaround));
    await close();
    await ticket.close();

    // ---- 3. Change: approvals, tasks, conflicts ---------------------------------------------------------------------------------------
    ticket = await ctx.openInstancePage(`/change_request.do?sys_id=${data.CHANGE_ID}`, 'ticket-change');
    await waitForText(p, data.CHANGE_NUMBER, { timeout: 20000 });
    await p.waitForSelector('.ab-features', { timeout: 15000 });
    before = ai.requests.length;
    fromLog = inst.requests.length;
    ran = await runFeature(p, /^Brief for the CAB/);
    req = await checkAiRun(t, ctx, p, 'change-cab-brief', ran, { before, system: /prepare a Change Advisory Board/, userHas: [/CHG0030002/, /CTASK0030011/, /have no value on the record[^<]*Back-out plan/i] });
    const conflictReads = readsOf(inst, fromLog, 'change_request').filter((q) => q.includes('start_date<=') && q.includes('end_date>='));
    t.check('change-cab-brief: the schedule conflicts were looked up by CI and by service, over the change window (GET)', conflictReads.length >= 1, conflictReads.join(' || ').slice(0, 160));
    t.check('change-cab-brief: the approvers (Charlie, Dave) and the requester are masked, and put back in the answer only on screen', req ? !/Charlie|Whitherspoon|Dave|Loftus/i.test(req.raw) : false);
    await clickButton(p, /^Add to work notes/);
    await waitForText(p, /Inserted into the form/, { timeout: 8000 });
    const cabCalls = await gform(ticket, () => window.__gformCalls);
    t.check('change-cab-brief: "Add to work notes" made one setValue on work_notes', cabCalls.length === 1 && cabCalls[0].name === 'work_notes' && cabCalls[0].value.includes('What changes:'), JSON.stringify(cabCalls).slice(0, 120));
    await close();
    await ticket.close();

    // ---- 4. HR case: Strict mode needed, then the organisation's HR switch ---------------------------------------------------------------
    ticket = await ctx.openInstancePage(`/sn_hr_core_case.do?sys_id=${data.HR_CASE_ID}`, 'ticket-hr');
    await waitForText(p, data.HR_CASE_NUMBER, { timeout: 20000 });
    await p.waitForSelector('.ab-features', { timeout: 15000 });
    const hrCard = await p.evaluate(() => {
      const b = [...document.querySelectorAll('.ab-feature')].find((x) => /^HR case brief/.test(x.innerText.trim()));
      return b ? b.innerText.replace(/\s+/g, ' ') : null;
    });
    t.check('HR case: the card says "Needs Strict privacy mode" in Standard mode', Boolean(hrCard) && /Needs Strict privacy mode\. Change it in Settings\./.test(hrCard), hrCard || 'no HR case brief card');
    const hrOffered = await p.evaluate(() => [...document.querySelectorAll('.ab-features .ab-feature-title')].map((e) => e.innerText.trim()));
    t.check('HR case: none of the other ITSM / customer service features is offered on an HR case', !hrOffered.some((o) => /Sentiment|Next best|Summarise the discussion|Where should|knowledge article|Major incident|Brief me|engineering/.test(o)), hrOffered.join(' | '));

    before = ai.requests.length;
    fromLog = inst.requests.length;
    await clickButton(p, /^HR case brief/);
    await p.waitForSelector('.ab-note-danger[role="alert"]', { timeout: 15000 });
    t.check('Standard mode: a click ends with the Strict-mode message', (await textOf(p, '.ab-note-danger')) === 'This needs Strict privacy mode. Change it in Settings.', await textOf(p, '.ab-note-danger'));
    t.check('Standard mode: nothing reached the AI', ai.requests.length === before);

    await ctx.configure({ piiMode: 'strict' });
    const hrCardText = () => p.evaluate(() => [...document.querySelectorAll('.ab-feature')].find((x) => /^HR case brief/.test(x.innerText.trim()))?.innerText || '');
    await ctx.waitUntil('the panel to follow the new privacy mode', async () => !(await hrCardText()).includes('Change it in Settings'), { timeout: 8000 });
    t.check('after switching to Strict the card no longer asks to change the mode (the panel followed the setting)', true);
    await clickButton(p, /^HR case brief/);
    await ctx.waitUntil('the HR_BLOCKED message', async () => /HR case content is not sent to an AI model unless your organisation allows it/.test((await textOf(p, '.ab-note-danger')) || ''), { timeout: 15000 });
    t.check('Strict mode with no organisation policy: the HR_BLOCKED message, nothing reached the AI', ai.requests.length === before);
    const hrReads = inst.requests.slice(fromLog).filter((r) => /sn_hr_core_case|sys_journal_field/.test(r.path + decodeURIComponent(r.search)));
    const fieldsAsked = hrReads.flatMap((r) => (new URLSearchParams(r.search).get('sysparm_fields') || '').split(',')).filter(Boolean);
    t.check('the HR case was read without its free text: no description, short description, notes or close notes were asked for', hrReads.length > 0 && !fieldsAsked.some((f) => /description|close_notes|comments|work_notes/.test(f)) && !hrReads.some((r) => r.path.endsWith('sys_journal_field')), fieldsAsked.join(','));
    const blocked = (await ctx.audit()).filter((e) => e.outcome === 'blocked' && e.feature === 'hr-case-brief');
    t.check('the refusals are in the audit log (outcome blocked), without content', blocked.length >= 1 && blocked.every((e) => Object.keys(e).every((k) => ['time', 'feature', 'table', 'record', 'provider', 'model', 'host', 'piiMode', 'preview', 'masked', 'counts', 'inputTokens', 'outputTokens', 'outcome', 'ms', 'reason'].includes(k))), JSON.stringify(blocked[0] || {}));
    await ctx.configure({ piiMode: 'standard' });
    await ticket.close();

    const bad = errorsSince(ctx, mark);
    t.check('no console error, page error or CSP violation during these runs', bad.length === 0, describeErrors(bad));
    await panel.close();
    ai.reset();
  },
};

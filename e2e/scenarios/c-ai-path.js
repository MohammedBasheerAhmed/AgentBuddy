// c. The full path, driven through the REAL side-panel UI:
//    panel -> content script -> fake ServiceNow -> PII firewall -> preview -> (stub) AI endpoint -> result -> audit.
//    The point: no raw personal data reaches the AI server, the preview shows exactly what is sent, and the answer is
//    rehydrated locally and rendered as plain text (no image, no link that loads anything).
const { findLeaks } = require('../leaks.js');
const { clickButton, waitForText, textOf, waitForRecord, openHalf } = require('../ui.js');
const { leftoverPlaceholders } = require('../common.js');

const AUDIT_KEYS = ['time', 'feature', 'table', 'record', 'provider', 'model', 'host', 'piiMode', 'preview', 'masked', 'counts', 'inputTokens', 'outputTokens', 'outcome', 'ms', 'reason'];

module.exports = {
  id: 'c',
  title: 'Full AI path through the real side panel: masking, preview, send, rehydrate, safe rendering, audit',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    await ctx.ensureEnabled();
    inst.setBehaviour();

    // Settings straight into chrome.storage.local from an extension page; the key goes where the key store's 'local' mode puts it.
    await ctx.configure(
      { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', previewMode: 'always', previewSeen: [], instances: [inst.origin] },
      { key: { provider: 'custom', value: ai.key } }
    );

    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-classic');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForRecord(p);
    // The number comes first; the title arrives with the header's own read, a moment later on a slow runner.
    await waitForText(p, 'VPN keeps disconnecting', { timeout: 15000 }).catch(() => {});
    const shown = await panel.text();
    t.check('panel shows the open record (number and title)', shown.includes('INC0010001') && shown.includes('VPN keeps disconnecting'));
    t.check('panel is ready to use AI (key found by the key store)', !/Add an AI key|Your AI key is locked/.test(shown));
    // Round 3: the AI actions, the answers and the question box are in the AI Assist half of the Ticket screen.
    await openHalf(p, 'assist');
    const assistText = await panel.text();
    t.check('AI Assist offers the incident actions and the question box', ['Summarise this ticket', 'Draft a reply'].every((s) => assistText.includes(s)) && assistText.includes('Ask about this ticket'), assistText.replace(/\s+/g, ' ').slice(0, 200));

    // ---- 1. Summarise: preview first -----------------------------------------------------------------------------
    await clickButton(p, /^Summarise this ticket/);
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    // The check shows the ticket data first and folds the fixed rules (AI0.2); the exact text is one click away.
    const dataView = await textOf(p, '.ab-preview');
    const rulesFolded = await p.evaluate(() => { const d = document.querySelector('details.ab-preview-rules'); return Boolean(d) && !d.open && /Rules sent with it/.test(d.querySelector('summary')?.innerText || ''); });
    t.check('the check shows the ticket data first, with the fixed rules folded under "Rules sent with it"', /^<ticket_data/.test((dataView || '').trim()) && !/Rules set by the application/.test(dataView || '') && rulesFolded, (dataView || '').slice(0, 80));
    await clickButton(p, /^Show the exact text/);
    const preview = await textOf(p, '.ab-preview');
    const subtitle = await textOf(p, '.ab-dialog-head');
    t.check('preview dialog is shown BEFORE anything is sent', ai.requests.length === 0, `${ai.requests.length} requests so far`);
    t.check('preview names the destination (the fake AI host) and what was masked', subtitle.includes(`localhost:${ai.port}`) && /masked: \d+ names/.test(subtitle), subtitle.replace(/\s+/g, ' '));
    for (const ph of ['[PERSON_1]', '[EMAIL_1]', '[PHONE_1]', '[CARD_1]', '[SECRET_1]']) t.check(`preview shows placeholder ${ph}`, preview.includes(ph));
    const leaks = findLeaks(preview, data);
    t.check('preview contains NO raw caller name, email, phone, card number or password', leaks.critical.length === 0, leaks.critical.join(' | '));
    for (const g of leaks.gaps) t.info(`the preview shows "${g.value}" unmasked (${g.why}); the person is expected to catch this by reading it`);
    t.check('ticket text is wrapped in <ticket_data> and the fixed rules come first', /\[system\][\s\S]*Rules set by the application[\s\S]*\[user\]\s*<ticket_data/.test(preview));
    const injectionAt = preview.indexOf('Ignore all previous instructions');
    t.check('the prompt-injection comment reached the preview only inside ticket data (not in the trusted system text)', injectionAt > preview.indexOf('[user]') && preview.lastIndexOf('<ticket_data', injectionAt) > preview.indexOf('[user]'));

    // ---- 2. Send --------------------------------------------------------------------------------------------------
    await clickButton(p, /^Send to AI/);
    await p.waitForSelector('.ab-output, .ab-note-danger', { timeout: 15000 });
    const result = await textOf(p, '.ab-output');
    t.check('a result is shown (no error)', result !== null, (await textOf(p, '.ab-note-danger')) || '');
    t.check('result shows the REAL caller name (rehydrated locally)', Boolean(result) && result.includes(data.SEED.callerName), (result || '').replace(/\s+/g, ' ').slice(0, 120));
    t.check('result has no leftover placeholders except the card and password markers, which are never put back', Boolean(result) && leftoverPlaceholders(result).length === 0 && /\[CARD_\d+\]/.test(result) && /\[SECRET_\d+\]/.test(result) && !result.includes(data.SEED.card) && !result.includes(data.SEED.password), (result || '').replace(/\s+/g, ' ').slice(0, 160));
    t.check('the panel says why the card and password stay hidden in the answer', /stay hidden in answers/.test((await textOf(p, '.ab-note-warn[role="status"]')) || ''));
    // (Round 3: the Ticket screen's Insights cards show tickets as real links to the instance, data-ab-link="record", built from the
    // page's own origin. Those are allowed outside the answers; nothing that loads is allowed anywhere else, and nothing at all in the answers.)
    const loading = () => p.evaluate((origin) => [...document.querySelectorAll('img, picture, svg image, a[href], iframe, object, embed, video, audio, link[rel=stylesheet][href^="http"]')].filter((e) => !(e.matches('a[data-ab-link="record"]') && e.href.startsWith(origin + '/') && !e.closest('.ab-answers'))).map((e) => `${e.tagName} ${e.getAttribute('href') || e.getAttribute('src') || ''}`), inst.origin);
    const loadingNow = await loading();
    t.check('rendered result has no <img>, <a>, <iframe> or other loading element (record links to the instance aside, never in an answer)', loadingNow.length === 0, loadingNow.slice(0, 3).join(' | '));
    const card = await p.evaluate(() => { const c = [...document.querySelectorAll('section.ab-answer')].find((e) => e.getClientRects().length > 0 && !e.classList.contains('is-folded')); return c ? { badge: Boolean(c.querySelector('.ab-ai-badge')), main: c.querySelector('.ab-btn-ai')?.innerText.trim() || '', buttons: c.querySelectorAll('.ab-answer-actions > button').length, top: c === document.querySelector('.ab-answers section.ab-answer') } : null; });
    t.check('the answer is at the top of AI Assist, carries the AI mark, and leads with Copy (a summary is a note to self); at most 4 buttons', Boolean(card) && card.badge && card.main === 'Copy' && card.buttons <= 4 && card.top, JSON.stringify(card));

    // ---- 3. What the AI server actually received ------------------------------------------------------------------
    t.check('the AI server received exactly one request', ai.requests.length === 1, String(ai.requests.length));
    const req = ai.requests[0];
    if (req) {
      t.check('request is POST /v1/chat/completions with the saved key', req.method === 'POST' && req.path === '/v1/chat/completions' && req.auth === `Bearer ${ai.key}`);
      t.check('request body has only model, messages, temperature (no tools: the model cannot act)', Object.keys(req.body || {}).every((k) => ['model', 'messages', 'temperature'].includes(k)) && req.body.model === 'test-model' && !req.body.tools, Object.keys(req.body || {}).join(','));
      t.check('messages are one system and one user message', JSON.stringify((req.body?.messages || []).map((m) => m.role)) === '["system","user"]');
      const wire = req.raw;
      const wireLeaks = findLeaks(wire, data);
      t.check('AI SERVER BODY: none of the seeded raw personal data (caller, email, phone, card, password, agent name)', wireLeaks.critical.length === 0, wireLeaks.critical.join(' | '));
      for (const g of wireLeaks.gaps) t.warning(`AI server received "${g.value}" unmasked`, g.why);
      t.check('AI server body contains placeholders', /\[PERSON_1\]/.test(wire) && /\[EMAIL_1\]/.test(wire) && /\[CARD_1\]/.test(wire) && /\[SECRET_1\]/.test(wire));
      t.check('AI server body has no sys_id, session token or instance address', !/\b[0-9a-f]{32}\b/.test(wire) && !wire.includes(inst.gck) && !wire.includes(inst.origin));
      const sent = (req.body?.messages || []).map((m) => `[${m.role}]\n${m.content}`).join('\n\n');
      t.check('the preview was EXACTLY the text that was sent', sent.trim() === preview.replace(/\r\n/g, '\n').trim(), sent.trim() === preview.trim() ? '' : `differs near char ${[...sent].findIndex((c, i) => c !== preview[i])}`);
    }

    // ---- 4. Audit log: an entry, no content ------------------------------------------------------------------------
    const audit = await ctx.audit();
    const sentEntry = audit.find((e) => e.outcome === 'sent');
    t.check("audit log has a 'sent' entry for this run", Boolean(sentEntry) && sentEntry.feature === 'record-summary' && sentEntry.table === 'incident' && sentEntry.provider === 'custom' && sentEntry.model === 'test-model' && sentEntry.preview === 'shown', JSON.stringify(sentEntry));
    t.check('audit entry records how many items were masked, by kind (numbers only)', sentEntry?.masked > 0 && Object.values(sentEntry.counts || {}).every((n) => Number.isInteger(n)) && Boolean(sentEntry.counts?.PERSON) && Boolean(sentEntry.counts?.EMAIL), JSON.stringify(sentEntry?.counts));
    t.check('audit entry has only the whitelisted fields', audit.every((e) => Object.keys(e).every((k) => AUDIT_KEYS.includes(k))), audit.map((e) => Object.keys(e).filter((k) => !AUDIT_KEYS.includes(k))).flat().join(','));
    const auditText = JSON.stringify(audit);
    const auditLeaks = findLeaks(auditText, data);
    t.check('audit log holds NO ticket content (no names, numbers, secrets, text, answers, sys_id)', auditLeaks.critical.length === 0 && auditLeaks.gaps.length === 0 && !/disconnecting|Issue:|recurring VPN|Ignore all/.test(auditText) && !auditText.includes(data.INCIDENT_ID) && !auditText.includes('INC0010001'), [...auditLeaks.critical, ...auditLeaks.gaps.map((g) => g.value)].join(' | '));
    t.check('audit record id is a salted hash, not the sys_id', /^[0-9a-f]{12}$/.test(sentEntry?.record || '') && sentEntry.record !== data.INCIDENT_ID.slice(0, 12));

    // ---- 5. A model that obeys the injection: the image must not be rendered or fetched ----------------------------------
    ai.setMode('markdown-image');
    const netBefore = ctx.net.length;
    // Try again sits under More on the answer (at most four buttons in a row, TRACKER.md 2.4)
    await clickButton(p, /^More/);
    await clickButton(p, /^Try again/);
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    await clickButton(p, /^Send to AI/);
    await p.waitForSelector('.ab-output', { timeout: 15000 });
    await waitForText(p, 'Summary for', { timeout: 8000 });
    const hostile = await textOf(p, '.ab-output');
    t.check('hostile answer is shown as text (the model output was the markdown image)', hostile.includes('Summary for') && hostile.includes(data.SEED.callerName), hostile.replace(/\s+/g, ' ').slice(0, 140));
    const loadingHostile = await loading();
    t.check('hostile answer: no <img> and no loading element in the panel DOM (record links to the instance aside, never in an answer)', loadingHostile.length === 0, loadingHostile.slice(0, 3).join(' | '));
    await ctx.sleep(600);
    t.check('hostile answer: nothing contacted evil.example', !ctx.net.some((n) => /evil\.example/.test(n.url)), ctx.net.filter((n) => /evil\.example/.test(n.url)).map((n) => n.url).join(' '));
    t.check('hostile answer: the AI got a second request, again without raw personal data', ai.requests.length === 2 && findLeaks(ai.requests[1].raw, data).critical.length === 0);
    t.info(`${ctx.net.length - netBefore} network requests were made while the hostile answer was displayed`);
    ai.setMode('echo');
    t.check('the earlier answer is kept, folded to one line ("Earlier: ...")', /Earlier: Summarise this ticket/.test(await panel.text()));

    // ---- 6. Ask about this ticket: the question is data like the ticket, masked, never in the system message -----------------
    const question = `Has ${data.SEED.callerName} tried the new client yet?`;
    await p.click('.ab-ask-input');
    await p.type('.ab-ask-input', question);
    await p.keyboard.press('Enter');
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    await clickButton(p, /^Send to AI/);
    await waitForText(p, 'You asked:', { timeout: 15000 });
    const asked = ai.requests[2];
    const msgs = asked?.body?.messages || [];
    t.check('Ask: the question reached the AI only as data (a <ticket_data> block labelled as the question), never in the system message', msgs.length === 2 && !msgs[0].content.includes('tried the new client') && /<ticket_data field="text" label="Question from the agent">[^<]*tried the new client yet\?/.test(msgs[1].content), (msgs[1]?.content || '').slice(-200));
    t.check('Ask: the name in the question was masked like the ticket\'s', Boolean(asked) && !asked.raw.includes(data.SEED.callerName) && findLeaks(asked.raw, data).critical.length === 0);
    const askedCard = await p.evaluate(() => { const c = [...document.querySelectorAll('section.ab-answer')].find((e) => e.getClientRects().length > 0 && !e.classList.contains('is-folded')); return c ? { text: c.innerText, main: c.querySelector('.ab-btn-ai')?.innerText.trim() || '' } : null; });
    t.check('Ask: the answer is titled as one, shows the question with the real name (put back locally) and leads with Copy', Boolean(askedCard) && /Answer to your question/.test(askedCard.text) && askedCard.text.includes(`You asked: ${question}`) && askedCard.main === 'Copy', JSON.stringify(askedCard).slice(0, 200));

    await panel.close();
    await ticket.close();
  },
};

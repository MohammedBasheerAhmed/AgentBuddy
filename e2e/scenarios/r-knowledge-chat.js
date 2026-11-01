// r. Knowledge and chat, through the real panel and content script:
//    Article checks   (Ticket screen, Insights card) checks on an open knowledge article (a password in the text is flagged by count,
//                     never shown); then AI suggestions from AI Assist (Copy only, the password masked)
//    Knowledge screen (round 3; Insights = no AI, AI Assist = the drafts):
//    Search           (everyone) published articles that match the words typed, best first, with freshness and a short excerpt; "Copy
//                     link" copies the share address by article number; a result opens in this tab; no AI request
//    Duplicates       (knowledge managers) knowledge bases and categories from the Aggregate API, a cluster of near-duplicate titles,
//                     the text overlap of the picked articles; the merge draft in AI Assist keeps placeholders (no real name, email or
//                     phone); opening an article moves the tab on the same instance and the panel keeps its results
//    Gaps             resolved tickets without an article, grouped by topic, "N of M" and a scope; the outline draft in AI Assist sends
//                     topic words only; a table that is denied gives a plain note, not an error
//    Chat facts       (Ticket screen, Insights card) facts about a chat with no AI (who, how many, how long the customer waits); summary
//                     and replies from AI Assist through the firewall, a chat that lives only in Connect Support tables, a chat with nothing readable and a denied table
const { findLeaks } = require('../leaks.js');
const { prepare, errorMark, errorsSince, describeErrors, clickTab, clickButton, waitForText, textOf, checkAiRun, runAfter, waitPanel, settleOnRecord, loadingElements, captureClipboard, clipboardLog } = require('../common.js');
const { runFeature, openHalf, openScreen, buttonShown, showAction } = require('../ui.js');
const { openCard, showAllIn } = require('../insightsUi.js');

const first = (text, kind) => (new RegExp(`\\[${kind}_\\d+\\]`).exec(text) || [''])[0];

function replier({ system, user }) {
  const person = first(user, 'PERSON') || 'the author';
  if (/improve one ServiceNow knowledge article/.test(system)) {
    return 'Title: Guest Wi-Fi setup\n- Add "guest network" to the title.\nKeywords: wifi, guest, network, password\nStructure: Use numbered steps.\nClarity: Say who changes the password.\nMissing: Nothing to add\nLooks outdated: Nothing to add';
  }
  if (/merge near-duplicate ServiceNow knowledge articles/.test(system)) {
    return `Merged title: Reset your VPN password\nMerged article: Open the self-service portal, choose Remote access and then Reset password. If the link does not arrive call ${person} (${first(user, 'EMAIL') || '[EMAIL_1]'}) on ${first(user, 'PHONE') || '[PHONE_1]'}.\nRetire: KB0020002\nKB0020003\nWhat changed: The three articles were combined.`;
  }
  if (/plan a new ServiceNow knowledge article/.test(system)) {
    return 'Suggested title: Fix a stuck printer queue\nWho it is for: Anyone who cannot print.\nOutline:\n1. Symptoms\n2. Steps\n3. When to ask for help\nFacts to collect first: The print server name.';
  }
  if (/wrap up a live chat/.test(system)) {
    return `Summary: ${person} asked for help with a VPN that drops every ten minutes.\nOutcome: Unclear - the client version was asked for.\nFollow-ups:\n- Check the gateway certificate\nSuggested ticket notes:\nCustomer reports VPN drops every ten minutes on client 5.2.\nAsked for client version, got 5.2.\nNext: check the gateway certificate.`;
  }
  if (/answer a customer in a live chat/.test(system)) {
    return `1. Thank you ${person}. Please try switching the client to TCP mode.\n2. Which network are you on when it drops?\n3. I am checking this now and will update you shortly.`;
  }
  return null;
}

const text = (p) => p.evaluate(() => document.body.innerText);
const tagsOf = (p) => p.evaluate(() => window.__vis(document.querySelectorAll('.ab-tags .ab-tag')).map((x) => x.innerText.trim()));
// The AI half of the Ticket screen holds the AI actions (Actions agent). A scenario part that needs one runs only when it is there.
const assistOffers = (p, re) => showAction(p, re);
// The Knowledge screen's folding cards (data-card="kb-search" | "kb-duplicates" | "kb-gaps" | "kb-merge" | "kb-outline").
async function openKb(p, half, cardId) {
  await openScreen(p, 'Knowledge');
  await openHalf(p, half);
  if (!cardId) return;
  await p.waitForSelector(`[data-card="${cardId}"] .ab-cardx-toggle`, { timeout: 15000 });
  await p.evaluate((id) => {
    const b = document.querySelector(`[data-card="${id}"] .ab-cardx-toggle`);
    if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
    b?.scrollIntoView({ block: 'start' });
  }, cardId);
}
const summaryIn = (p, id) => p.evaluate((cid) => document.querySelector(`[data-card="${cid}"] .ab-cardx-summary`)?.innerText || '', id);

module.exports = {
  id: 'r',
  title: 'Knowledge and chat: article checks, duplicates and merge draft, gaps and outline, chat facts, summary and replies, denied tables',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    await prepare(ctx);
    // The article and chat cards are for the knowledge and customer service profiles.
    await ctx.configure({ profiles: ['it', 'csm', 'km'], profilesConfirmed: true });
    ai.setReplier(replier);
    const mark = errorMark(ctx);
    const panel = await ctx.openPanel();
    const p = panel.page;

    // ============================== ARTICLE TAB ========================================================================================
    let ticket = await ctx.openInstancePage(`/kb_knowledge.do?sys_id=${data.kbArticleId(6)}`, 'ticket-article');
    await waitForText(p, 'KB0020006', { timeout: 20000 });
    await openCard(p, 'Article checks');
    await waitPanel(ctx, p, 'the article findings', async () => (await p.$$('[data-card="article"] .ab-kb-finding')).length >= 3, { timeout: 20000 });
    await showAllIn(p, 'article');
    const findings = await p.$$eval('[data-card="article"] .ab-kb-finding', (els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()));
    t.check('Article tab: a password in the text is flagged to FIX, as a count of values, never the value', findings.some((f) => /^Fix May contain a password, key or card number/i.test(f) && /1 value/.test(f)) && !(await text(p)).includes(data.MORE_SEED.articleSecret), findings.join(' | ').slice(0, 200));
    t.check('Article tab: also flags the unfinished text (TODO) and the article that has not been changed for over a year', findings.some((f) => /Unfinished text/i.test(f)) && findings.some((f) => /Not changed for over a year/i.test(f)), findings.join(' | ').slice(0, 300));
    t.check('Article checks: shows the facts (words, views), under "Stays in ServiceNow", with no AI mark and no AI request', (await tagsOf(p)).some((x) => /words/.test(x)) && /Nothing is sent anywhere/.test(await text(p)) && !(await p.$('[data-card="article"] .ab-ai-badge')) && ai.requests.length === 0);
    t.check('Article checks: the card summary says what to fix', /to fix/.test(await summaryIn(p, 'article')), await summaryIn(p, 'article'));
    // (an AI-side step that fails is reported as a failure; the card checks after it still run)
    if (await assistOffers(p, /^Suggest improvements/)) try {
      const before = ai.requests.length;
      const ran = await runAfter(p, () => clickButton(p, /^Suggest improvements/));
      const req = await checkAiRun(t, ctx, p, 'article-optimise', ran, { before, system: /improve one ServiceNow knowledge article/, userHas: [/Guest Wi-Fi/] });
      t.check('article-optimise: the password in the article text reached the AI only as a placeholder', req ? !req.raw.includes(data.MORE_SEED.articleSecret) && /\[SECRET_\d+\]/.test(req.raw) : false);
      const buttons = await p.evaluate(() => window.__vis(document.querySelectorAll('button')).map((b) => b.innerText.trim()));
      t.check('article-optimise: Copy only (the author edits the article in its own form): no Insert button', buttons.includes('Copy') && !buttons.some((b) => /^(Add|Insert)/.test(b)), buttons.join(' | '));
      await clickButton(p, /^Close/).catch(() => {});
    } catch (err) {
      t.check('the article AI action ran to the end', false, String(err?.message || err).slice(0, 200));
    }
    else t.warning('article-optimise is not offered in AI Assist on an article yet: its checks did not run (Actions agent)');
    await ticket.close();

    // ============================== CHAT (before the Knowledge screen: each part opens its own pages) ===============================================================================================
    ticket = await ctx.openInstancePage(`/interaction.do?sys_id=${data.INTERACTION_ID}`, 'ticket-chat');
    await waitForText(p, 'INT0000101', { timeout: 20000 });
    const chatBase = ai.requests.length;
    await openCard(p, 'Chat facts');
    await waitPanel(ctx, p, 'the chat facts', async () => (await tagsOf(p)).some((x) => /message/.test(x)), { timeout: 20000 });
    const tags = await tagsOf(p);
    t.check('Chat tab: 3 messages (the system event "Agent joined" is not counted), 2 from the customer, 1 from agents, chat open', tags.includes('3 messages') && tags.includes('2 from the customer') && tags.includes('1 from agents') && tags.includes('chat open'), tags.join(' | '));
    const chatText = await text(p);
    t.check('Chat tab: the customer has been waiting for an answer, who took part (by name, on screen only), and the last customer message', /The customer has been waiting/.test(chatText) && /Abel Tuter \(customer\)/.test(chatText) && /Beth Anglin \(agent\)/.test(chatText) && /Version 5\.2\. It disconnects every ten minutes/.test(chatText), chatText.replace(/\s+/g, ' ').slice(0, 100));
    t.check('Chat facts: under "Stays in ServiceNow", and no AI request', /Nothing is sent anywhere/.test(chatText) && ai.requests.length === chatBase);
    t.check('Chat facts: the summary line counts the messages', /3 messages/.test(await summaryIn(p, 'chat')), await summaryIn(p, 'chat'));

    if (!(await assistOffers(p, /^Summarise this chat/))) t.warning('the chat actions are not offered in AI Assist yet: chat-summary and chat-reply did not run (Actions agent)');
    else try {
      t.check('a chat (interaction) offers the chat actions in AI Assist', await buttonShown(p, /^Suggest replies/));
      let b4 = ai.requests.length;
      let chatRun = await runAfter(p, () => clickButton(p, /^Summarise this chat/));
      let creq = await checkAiRun(t, ctx, p, 'chat-summary', chatRun, { before: b4, system: /wrap up a live chat/, userHas: [/VPN keeps dropping/i, /ten minutes/] });
      t.check('chat-summary: the customer\'s email, phone and name in the chat never reached the AI (placeholders only)', creq ? !creq.raw.includes(data.MORE_SEED.chatEmail) && !creq.raw.includes(data.MORE_SEED.chatPhone) && /\[EMAIL_\d+\]/.test(creq.raw) && /\[PHONE_\d+\]/.test(creq.raw) : false);
      const insertLabel = await p.evaluate(() => window.__vis(document.querySelectorAll('button')).map((b) => b.innerText.trim()).find((x) => /^Add notes to work notes/.test(x)) || '');
      t.check('chat-summary: offers "Add notes to work notes" (only the notes section, not the whole summary)', Boolean(insertLabel));
      await clickButton(p, /^Add notes to work notes/);
      await waitForText(p, /Inserted. Review it|Inserted into the form/, { timeout: 8000 });
      const wn = await ticket.evaluate(() => window.__gformCalls);
      t.check('the inserted notes are the "Suggested ticket notes" section only, below what was typed', wn.length === 1 && wn[0].name === 'work_notes' && wn[0].value.startsWith('Checking the gateway certificate now.\n\nCustomer reports VPN drops') && !/Outcome:|Follow-ups:/.test(wn[0].value), JSON.stringify(wn).slice(0, 160));
      await clickButton(p, /^Close/);

      b4 = ai.requests.length;
      const kbReadsBefore = inst.requests.length;
      chatRun = await runAfter(p, () => clickButton(p, /^Suggest replies/));
      creq = await checkAiRun(t, ctx, p, 'chat-reply', chatRun, { before: b4, system: /answer a customer in a live chat/, userHas: [/still not working|Version 5\.2/] });
      const kbReads = inst.requests.slice(kbReadsBefore).filter((r) => r.path === '/api/now/table/kb_knowledge');
      t.check('chat-reply: it looked for knowledge articles that match the chat (one GET) before asking, and the answer is Copy only', kbReads.length >= 1 && !(await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-card .ab-row button')).map((b) => b.innerText.trim()).some((x) => /^(Add|Insert)/.test(x)))));
      await clickButton(p, /^Close/);
    } catch (err) {
      t.check('the chat AI actions ran to the end', false, String(err?.message || err).slice(0, 200));
    }
    await ticket.close();

    // A chat that lives only in Connect Support tables
    ticket = await ctx.openInstancePage(`/interaction.do?sys_id=${data.INTERACTION_2_ID}`, 'ticket-chat2');
    await waitForText(p, 'INT0000102', { timeout: 20000 });
    await openCard(p, 'Chat facts');
    await waitPanel(ctx, p, 'the second chat', async () => (await tagsOf(p)).includes('2 messages'), { timeout: 20000 });
    t.check('a chat held in live_group_profile / live_message: found through the second route, 2 messages, ended', (await tagsOf(p)).includes('chat ended') && (await tagsOf(p)).includes('1 from the customer'), (await tagsOf(p)).join(' | '));
    await ticket.close();

    // A chat with nothing readable, and a denied messages table
    ticket = await ctx.openInstancePage(`/interaction.do?sys_id=${data.INTERACTION_3_ID}`, 'ticket-chat3');
    await waitForText(p, 'INT0000103', { timeout: 20000 });
    await openCard(p, 'Chat facts');
    await waitForText(p, /No chat messages are available to you/, { timeout: 20000 });
    t.check('a chat with no readable messages: "No chat messages are available to you" (not "an empty chat")', /No messages available/.test(await summaryIn(p, 'chat')), await summaryIn(p, 'chat'));
    await ticket.close();
    inst.setBehaviour({ denied: ['sys_cs_message'] });
    ticket = await ctx.openInstancePage(`/interaction.do?sys_id=${data.INTERACTION_ID}`, 'ticket-chat-denied');
    await waitForText(p, 'INT0000101', { timeout: 20000 });
    await openCard(p, 'Chat facts');
    await waitForText(p, /No chat messages are available to you/, { timeout: 20000 });
    t.check('the messages table denied: the same plain sentence, no error banner', (await p.$('.ab-note-danger')) === null && /cannot read|do not allow|may not allow|denied|roles/i.test(await text(p)));
    inst.setBehaviour();
    await ticket.close();

    // ============================== KNOWLEDGE SEARCH (everyone) =====================================================================
    ticket = await ctx.openInstancePage('/home', 'home');
    await openKb(p, 'insights', 'kb-search');
    const searchBase = ai.requests.length;
    await p.click('#ab-kb-search');
    await p.type('#ab-kb-search', 'reset vpn password', { delay: 0 });
    await clickButton(p, /^Search$/);
    await waitPanel(ctx, p, 'the search results', async () => (await p.$$('.ab-kbx-hit')).length >= 1, { timeout: 15000 });
    const hits = await p.$$eval('.ab-kbx-hit', (els) => els.filter((e) => e.getClientRects().length > 0).map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    t.check('Search: the article whose title has every word comes first, with its knowledge base and freshness, and a short excerpt', /^KB0020001 How to reset your VPN password/.test(hits[0] || '') && /IT Knowledge Base/.test(hits[0]) && /Updated .* ago/.test(hits[0]), hits.join(' | ').slice(0, 300));
    t.check('...three results show, the rest fold under "Show all"', hits.length === 3 && (await buttonShown(p, /^Show all \(\d+\)/)), hits.length);
    t.check('...the password in an article\'s text is never in an excerpt', !(await text(p)).includes(data.MORE_SEED.articleSecret));
    t.check('Search made no AI request and carries no AI mark', ai.requests.length === searchBase && !(await p.$('[data-card="kb-search"] .ab-ai-badge')));
    await captureClipboard(p);
    await p.evaluate(() => [...document.querySelectorAll('.ab-kbx-hit')].find((h) => h.getClientRects().length > 0).querySelector('button').click());
    await ctx.waitUntil('copy link', async () => (await clipboardLog(p)).length >= 1, { timeout: 5000 });
    t.check('"Copy link" copies the article\'s share address, by its number, on this instance', (await clipboardLog(p)).slice(-1)[0] === `${inst.origin}/kb_view.do?sysparm_article=KB0020001`, (await clipboardLog(p)).slice(-1)[0]);
    await p.evaluate(() => [...document.querySelectorAll('a.ab-kbx-hit-title')].find((a) => a.getClientRects().length > 0).click());
    await ctx.waitUntil('the tab to open the article', async () => decodeURIComponent(ticket.url()).includes(`kb_knowledge.do?sys_id=${data.kbArticleId(1)}`), { timeout: 10000 });
    t.check('a search result opens in the SAME tab, on the same instance', ticket.url().startsWith(inst.origin), ticket.url());
    await ticket.close();

    // ============================== DUPLICATES (knowledge managers) ===================================================================
    ticket = await ctx.openInstancePage('/home', 'home');
    await openKb(p, 'insights', 'kb-duplicates');
    await waitForText(p, /300 at a time, newest changed first/, { timeout: 15000 });
    await waitPanel(ctx, p, 'the knowledge bases', async () => (await p.$$('#ab-kb-base option')).length >= 3, { timeout: 15000 });
    const bases = await p.$$eval('#ab-kb-base option', (os) => os.map((o) => o.innerText.trim()));
    t.check('Duplicates: the knowledge bases come from the Aggregate API, with their counts (IT: 5 published, HR: 1)', bases.some((b) => /^IT Knowledge Base \(5\)$/.test(b)) && bases.some((b) => /^HR Knowledge Base \(1\)$/.test(b)), bases.join(' | '));
    await p.select('#ab-kb-base', data.KB_BASE_ID);
    await waitPanel(ctx, p, 'the categories', async () => (await p.$$('#ab-kb-category option')).length >= 2, { timeout: 10000 });
    t.check('...choosing a base lists its categories', (await p.$$eval('#ab-kb-category option', (os) => os.map((o) => o.innerText.trim()))).some((c) => /^Remote access \(5\)$/.test(c)));
    const dupBase = ai.requests.length;
    await clickButton(p, /^Find duplicates/);
    await waitForText(p, /Compared 5 titles/, { timeout: 15000 });
    const cluster = await p.$eval('.ab-kb-cluster', (el) => el.innerText.replace(/\s+/g, ' ').trim());
    t.check('Duplicates: one group of three that read alike (the three password-reset articles), the others left out', /3 articles that read alike/.test(cluster) && ['KB0020001', 'KB0020002', 'KB0020003'].every((n) => cluster.includes(n)) && !/KB0020004|KB0020006/.test(cluster), cluster.slice(0, 200));
    t.check('...with the most-read one suggested to keep', /Most read: KB0020001/.test(cluster));
    t.check('...no "Compare more" button: all 5 titles were compared at once', !(await buttonShown(p, /^Compare \d+ more/)));
    t.check('Duplicates: finding them made no AI request', ai.requests.length === dupBase);
    t.check('...and the groups can be exported (CSV)', await buttonShown(p, /^Export groups \(CSV\)/));
    await clickButton(p, /^Compare$/);
    await waitForText(p, 'Compare the text', { timeout: 8000 });
    await clickButton(p, /^Compare their text/);
    await waitForText(p, /of the shorter text also appears in the other/, { timeout: 15000 });
    const pairs = await p.$$eval('ul.ab-kb-pairs li', (lis) => lis.filter((li) => li.getClientRects().length > 0).map((li) => li.innerText.replace(/\s+/g, ' ').trim()));
    t.check('...comparing the text reads only those three articles and shows how much of each pair is shared', pairs.length === 3 && pairs.every((x) => /\d+% of the shorter text/.test(x)), pairs.join(' | '));
    t.check('...and points to AI Assist for the merged draft (no AI button in Insights)', /switch to AI Assist/.test(await text(p)) && !(await buttonShown(p, /^Draft a merged article/)));
    // The merge draft, in AI Assist
    await openKb(p, 'assist', 'kb-merge');
    await waitForText(p, 'KB0020003', { timeout: 8000 });
    const before2 = ai.requests.length;
    const merged = await runAfter(p, () => clickButton(p, /Draft a merged article/));
    const mreq = await checkAiRun(t, ctx, p, 'kb-merge-draft', merged, { placeholders: 'kept', before: before2, system: /merge near-duplicate ServiceNow knowledge articles/, userHas: [/KB0020001/, /KB0020002/, /KB0020003/, /\[EMAIL_\d+\]/, /\[PHONE_\d+\]/] });
    t.check('kb-merge-draft: the author named in the article text (Dave Loftus), his email and phone reached the AI only as placeholders', mreq ? !/Dave|Loftus|dave\.loftus|555-0166/i.test(mreq.raw) : false);
    const mergedText = merged.result || '';
    t.check('kb-merge-draft: the merged draft is shown with its placeholders: NO real name, email or phone is put back into a text that will be published', /\[PERSON_\d+\]/.test(mergedText) && /\[EMAIL_\d+\]/.test(mergedText) && /\[PHONE_\d+\]/.test(mergedText) && findLeaks(mergedText, data).critical.length === 0, mergedText.replace(/\s+/g, ' ').slice(0, 200));
    const mbuttons = await p.evaluate(() => window.__vis(document.querySelectorAll('[data-card="kb-merge"] button')).map((b) => b.innerText.trim()));
    t.check('kb-merge-draft: Copy only', mbuttons.includes('Copy') && !mbuttons.some((b) => /^(Add|Insert)/.test(b)), mbuttons.join(' | '));
    t.check('kb-merge-draft: the AI half carries the AI mark', Boolean(await p.$('[data-card="kb-merge"] .ab-ai-badge')));
    await clickButton(p, /^Close/);

    // Opening an article moves the tab (same instance) and the panel keeps what it found
    // (an article in the list is a real link: a click opens it in this tab, Ctrl+click or the right-click menu in a new one)
    await openHalf(p, 'insights');
    await p.evaluate(() => window.__vis(document.querySelectorAll('a.ab-kb-open')).find((a) => /KB0020002/.test(a.innerText)).click());
    await ctx.waitUntil('the tab to open the article', async () => decodeURIComponent(ticket.url()).includes(`kb_knowledge.do?sys_id=${data.kbArticleId(2)}`), { timeout: 10000 });
    t.check('clicking an article opens it in the SAME tab, on the same instance', ticket.url().startsWith(inst.origin), ticket.url());
    await ctx.sleep(800);
    await openScreen(p, 'Knowledge');
    await waitForText(p, 'Compared 5 titles', { timeout: 5000 }).catch(() => {});
    t.check('...and the groups the panel found are still on screen after the tab moved', (await p.$$('.ab-kb-cluster')).length >= 1, '');
    await ticket.close();

    // ============================== GAPS (knowledge managers) =========================================================================
    ticket = await ctx.openInstancePage('/home', 'home');
    await openKb(p, 'insights', 'kb-gaps');
    await waitForText(p, /at most the newest 500/, { timeout: 8000 });
    // The categories arrive after "Everything I can see" (a second read): wait for them, not just for two options.
    await waitPanel(ctx, p, 'the scope choices', async () => (await p.$$eval('#ab-gap-scope option', (os) => os.some((o) => /^Category: /.test(o.innerText.trim())))), { timeout: 15000 });
    const scopes = await p.$$eval('#ab-gap-scope option', (os) => os.map((o) => o.innerText.trim()));
    t.check('Gaps: the scope offers everything I can see (with a count) and the categories of the window, with counts', /^Everything I can see \(\d+\)$/.test(scopes[0] || '') && scopes.some((x) => /^Category: .+ \(\d+\)$/.test(x)), scopes.join(' | '));
    await clickButton(p, /^Find topics/);
    await waitForText(p, /Looked at \d+( of [\d,]+)? tickets? resolved in the last 60 days\. \d+ already had an article\./, { timeout: 20000 });
    const gapsBaseline = ai.requests.length;
    const gapText = await text(p);
    const already = Number(/(\d+) already had an article/.exec(gapText)?.[1] || 0);
    t.check('Gaps: the resolved tickets that already have an article (one through the attached-knowledge list, one through the use log) are counted and left out', already >= 2, (/Looked at[^.]*\./.exec(gapText) || [''])[0]);
    const printer = await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-kb-cluster')).map((c) => c.innerText.replace(/\s+/g, ' ').trim()).find((x) => /printer/i.test(x)) || '');
    t.check('Gaps: the printer tickets (no article, no written fix) form a topic with their category and configuration item', /printer/i.test(printer) && /Hardware/.test(printer) && /Print Server 2F/.test(printer) && /\d+ tickets?/.test(printer), printer.slice(0, 200));
    t.check('Gaps: finding topics made no AI request; the topics can be exported (CSV)', ai.requests.length === gapsBaseline && (await buttonShown(p, /^Export topics \(CSV\)/)));
    // A category scope: only those tickets are read
    const hardware = await p.$$eval('#ab-gap-scope option', (os) => (os.find((o) => /^Category: Hardware/.test(o.innerText.trim())) || {}).value || '');
    if (hardware) {
      await p.select('#ab-gap-scope', hardware);
      const readsBefore = inst.requests.length;
      await clickButton(p, /^Find topics/);
      await waitForText(p, /in category Hardware\./, { timeout: 20000 });
      const scoped = inst.requests.slice(readsBefore).filter((r) => r.path === '/api/now/table/incident');
      t.check('Gaps in one category: the read asks for that category only, and the summary says so', scoped.length >= 1 && scoped.every((r) => /category=hardware/.test(decodeURIComponent(r.search || ''))), scoped.map((r) => r.search).join(' | ').slice(0, 200));
      await p.select('#ab-gap-scope', 'all');
      await clickButton(p, /^Find topics/);
      await waitForText(p, /Looked at \d+( of [\d,]+)? tickets? resolved in the last 60 days\. /, { timeout: 20000 });
    } else {
      t.warning('Gaps: no Hardware category was offered, so the category scope was not exercised');
    }
    // The outline, in AI Assist, for the printer topic
    await openKb(p, 'assist', 'kb-outline');
    await waitForText(p, 'Topic to outline', { timeout: 8000 });
    await p.evaluate(() => {
      const label = [...document.querySelectorAll('[data-card="kb-outline"] label.ab-check')].find((l) => /printer/i.test(l.innerText));
      label?.querySelector('input')?.click();
    });
    const before3 = ai.requests.length;
    const outline = await runAfter(p, () => clickButton(p, /Draft an article outline/));
    const oreq = await checkAiRun(t, ctx, p, 'kb-gap-outline', outline, { placeholders: 'kept', before: before3, system: /plan a new ServiceNow knowledge article/, userLacks: [/INC00\d{5}/, /Second floor printer queue is stuck/, /María|Maria|O'Neil/] });
    t.check('kb-gap-outline: only topic words, counts, category and CI were sent: no ticket number, title or caller', oreq ? !/INC00\d{5}/.test(oreq.raw) && !/Second floor printer queue is stuck/.test(oreq.raw) : false);
    await clickButton(p, /^Close/);

    // The links between tickets and articles cannot be read: a plain note, the topics are still listed
    inst.setBehaviour({ denied: ['m2m_kb_task', 'kb_use'] });
    await openKb(p, 'insights', 'kb-gaps');
    await clickButton(p, /^Find topics/);
    await waitForText(p, /Looked at \d+( of [\d,]+)? tickets? resolved/, { timeout: 20000 });
    await ctx.sleep(500);
    const deniedGaps = await text(p);
    t.check('Gaps with the article links unreadable: a plain note says which tickets had an article could not be told, and no error banner', /could not tell|cannot read|can't read|not available/i.test(deniedGaps) && !/already had an article/.test(deniedGaps) && (await p.$('.ab-note-danger')) === null, (/(could not|cannot|can't|not available)[^.]*\./i.exec(deniedGaps) || [''])[0]);
    inst.setBehaviour();

    // The articles table is denied
    inst.setBehaviour({ denied: ['kb_knowledge'] });
    await p.reload({ waitUntil: 'load' }); // a fresh panel: the Duplicates tool reads the knowledge bases again
    await p.waitForSelector('.ab-app', { timeout: 10000 });
    await openKb(p, 'insights', 'kb-duplicates');
    await waitForText(p, /300 at a time/, { timeout: 15000 });
    await ctx.sleep(800);
    await waitPanel(ctx, p, 'the denied note', async () => /cannot read|not available|No published articles/i.test(await text(p)), { timeout: 15000 });
    t.check('Duplicates with the articles table denied: a plain note, the tool does not break (no error banner, nothing to choose)', (await p.$('.ab-note-danger')) === null && (await p.$$('#ab-kb-base option')).length === 0, (/(cannot read|not available|No published)[^.]*\./i.exec(await text(p)) || [''])[0]);
    // ...and the search says so too, in plain words
    await openKb(p, 'insights', 'kb-search');
    await p.click('#ab-kb-search');
    await p.type('#ab-kb-search', 'printer', { delay: 0 });
    await clickButton(p, /^Search$/);
    await waitPanel(ctx, p, 'the denied search note', async () => /cannot read|not available/i.test(await p.evaluate(() => document.querySelector('[data-card="kb-search"]')?.innerText || '')), { timeout: 15000 });
    t.check('Search with the articles table denied: a plain note, no error banner', (await p.$('.ab-note-danger')) === null);
    inst.setBehaviour();
    await ticket.close();

    const bad = errorsSince(ctx, mark);
    t.check('no console error, page error or CSP violation on these tabs', bad.length === 0, describeErrors(bad));
    await panel.close();
    ai.reset();
  },
};

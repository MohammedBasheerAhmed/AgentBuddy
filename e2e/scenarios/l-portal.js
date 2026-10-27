// l. Portals (Service Portal, Employee Center, customer service portal): single-page apps with NO g_form and, here, no g_user.
//    - the record comes from the address (query string, a table-less request page, a number, a hash route)
//    - the panel follows the page between tickets and a list WITHOUT a reload (history.pushState)
//    - the person is found without g_user: from NOW (/sp), an Angular root scope (/esc), or one small read (/csm)
//    - Insert types into the portal's own comment box (below what the agent typed, so the page's model follows) and into the
//      internal work-notes box where the portal shows one; it refuses when the box is missing, locked or ambiguous (and the panel
//      then copies instead); it never presses the page's Send button
const { clickButton, waitForText, textOf, runFeature, waitForRecord } = require('../ui.js');

module.exports = {
  id: 'l',
  title: 'Portals: record from the address, SPA navigation, user without g_user, Insert into the portal boxes, Copy fallback',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    const [A, B, R] = data.PORTAL.tickets;
    ai.reset();
    await ctx.ensureEnabled();
    inst.setBehaviour();
    await ctx.configure(
      { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', previewMode: 'always', previewSeen: [], instances: [inst.origin] },
      { key: { provider: 'custom', value: ai.key } }
    );

    // The tab of a portal (found by the start of its address, which changes when the page navigates itself), asked the way the
    // side panel asks: chrome.tabs.sendMessage from an extension page.
    const tabCall = (suffix, message) =>
      ctx.ext(
        async (prefix, message) => {
          const tab = (await chrome.tabs.query({})).find((x) => (x.url || '').startsWith(prefix));
          if (!tab) return { noTab: true };
          try {
            return await chrome.tabs.sendMessage(tab.id, message);
          } catch (err) {
            return { sendError: String(err.message || err) };
          }
        },
        `${inst.origin}/${suffix}`,
        message
      );
    const stateOf = (suffix) => tabCall(suffix, { type: 'ab:page-state' });
    const fill = (suffix, field, value, label) => tabCall(suffix, { type: 'ab:fill-field', field, value, label, mode: 'append' });
    const boxes = (page) =>
      page.evaluate(() => ({
        comment: document.getElementById('comment')?.value ?? null,
        comment2: document.getElementById('comment2')?.value ?? null,
        workNote: document.getElementById('worknote')?.value ?? null,
        hidden: document.querySelector('textarea[style*="display:none"]').value,
        search: document.querySelector('input[name="q"]').value,
        model: { ...window.__portal.model },
        events: JSON.parse(JSON.stringify(window.__portal.events)),
        sends: [...window.__portal.sends],
      }));
    const inputsOf = (b, name) => b.events[name]?.input || 0;

    // ---- 1. /sp: the address, the user from NOW, navigation without a reload ------------------------------------------------
    const sp = await ctx.openInstancePage(`/sp?id=ticket&table=incident&sys_id=${A.sysId}`, 'portal-sp');
    t.check('the portal page is a single-page app with NO g_form and NO g_user', await sp.evaluate(() => typeof window.g_form === 'undefined' && typeof window.g_user === 'undefined' && typeof window.__portal === 'object'));
    const s1 = await ctx.waitUntil('the /sp page to answer with a record', async () => ((await stateOf('sp')).record ? stateOf('sp') : null), { timeout: 12000 });
    t.check('record found from the portal address (table, sys_id, kind)', s1.record.table === 'incident' && s1.record.sysId === A.sysId && s1.record.kind === 'incident', JSON.stringify(s1.record));
    t.check('surface is portal and the portal is described: /sp, page "ticket"', s1.surface === 'portal' && JSON.stringify(s1.portal) === JSON.stringify({ base: '/sp', pageId: 'ticket' }), JSON.stringify([s1.surface, s1.portal]));
    t.check('the person is found without g_user (from the NOW object): id, name', s1.user?.userId === data.ME.sysId && s1.user.name === 'Beth Anglin', JSON.stringify(s1.user));

    const panel = await ctx.openPanel();
    await waitForRecord(panel.page);
    t.check('panel shows the portal ticket and its actions', (await panel.text()).includes('Draft a reply to the customer'));
    const marker = await sp.evaluate(() => window.__portal.marker);

    // the SPA moves to a list: no record, no stale ticket
    await sp.click('a[data-nav="list"]');
    const s2 = await ctx.waitUntil('the list page state', async () => {
      const s = await stateOf('sp');
      return s.record === null && s.portal?.pageId === 'my_requests' ? s : null;
    }, { timeout: 8000 });
    t.check('list page: NO record, still a portal page (the old ticket is not remembered)', s2.record === null && s2.newRecord === null && s2.surface === 'portal', JSON.stringify([s2.record, s2.surface]));
    await waitForText(panel.page, /Open a ticket[\s\S]*on this portal/, { timeout: 10000 });
    const listText = await panel.text();
    t.check('panel on the list page: no ticket actions, and the help mentions the portal', !listText.includes('Summarise this ticket') && /on this portal/.test(listText));
    await waitForText(panel.page, 'Printer offline in Finance', { timeout: 15000 });
    t.check('My day works on a portal page: the person was found through NOW, no g_user needed', (await panel.text()).includes('Printer offline in Finance'));

    // list -> another ticket (pushState) -> list -> the first ticket by a hash route
    await sp.click(`a[data-nav="ticket-${B.number}"]`);
    const s3 = await ctx.waitUntil('the second ticket', async () => ((await stateOf('sp')).record?.sysId === B.sysId ? stateOf('sp') : null), { timeout: 8000 });
    t.check('SPA navigation to another ticket: the panel record switches (no reload)', s3.record.table === 'incident' && s3.record.sysId === B.sysId && s3.href.includes(B.sysId), JSON.stringify(s3.record));
    await waitForText(panel.page, 'Summarise this ticket', { timeout: 10000 });
    await sp.click('a[data-nav="list"]');
    await ctx.waitUntil('back on the list', async () => ((await stateOf('sp')).record === null ? true : null), { timeout: 8000 });
    await sp.click('a[data-nav="hash"]');
    const s4 = await ctx.waitUntil('the ticket by hash route', async () => ((await stateOf('sp')).record?.sysId === A.sysId ? stateOf('sp') : null), { timeout: 8000 });
    t.check('hash-routed address (#/?id=ticket&...) also gives the record', s4.href.includes('#/?id=ticket') && s4.record.sysId === A.sysId && s4.portal?.pageId === 'ticket', s4.href);
    const doc = await sp.evaluate(() => ({ marker: window.__portal.marker, renders: window.__portal.renders, navs: performance.getEntriesByType('navigation').length }));
    t.check('all of that happened in ONE page load (same document, several renders, one navigation entry)', doc.marker === marker && doc.renders >= 5 && doc.navs === 1, JSON.stringify(doc));
    await waitForRecord(panel.page);

    // ---- 2. Insert into the customer comment box (below what the agent typed) ----------------------------------------------------
    const before = await boxes(sp);
    t.check('before inserting, the comment box holds only what the agent typed', before.comment === 'Hi, thanks for waiting.' && before.model.comment === before.comment && inputsOf(before, 'comment') === 0);
    const draft = await runFeature(panel.page, /^Draft a reply to the customer/);
    t.check('reply draft produced for the portal ticket', Boolean(draft.result), draft.error || '');
    await clickButton(panel.page, /^Insert as customer comment/);
    await panel.page.waitForSelector('.ab-note-warn[role="alert"]', { timeout: 8000 });
    const warned = await boxes(sp);
    t.check('the safe-to-send check also guards a portal comment: nothing is written while it warns', warned.comment === before.comment && inputsOf(warned, 'comment') === 0);
    await clickButton(panel.page, /^Insert anyway/);
    await waitForText(panel.page, /Inserted into the form/, { timeout: 8000 });
    const after = await boxes(sp);
    t.check('what the agent typed is kept and the AI text is APPENDED below it', after.comment.startsWith('Hi, thanks for waiting.\n\n') && after.comment.includes('Issue:'), after.comment.replace(/\n/g, '\\n').slice(0, 100));
    t.check("the page's own model followed (input and change events were delivered, like typing)", after.model.comment === after.comment && inputsOf(after, 'comment') >= 1 && (after.events.comment?.change || 0) >= 1, JSON.stringify(after.events.comment));
    t.check('inserted text contains the REAL name (rehydrated), no placeholders', after.comment.includes(data.SEED.callerName) && !/\[[A-Z_]{2,20}_\d+\]/.test(after.comment));
    t.check('the hidden template box and the search box were not touched', after.hidden === '' && inputsOf(after, 'hiddenComment') === 0 && after.search === '');
    t.check("the page's own Send button was never pressed and the form never submitted", after.sends.length === 0, after.sends.join(','));

    // ---- 3. Refusals: the panel is told why, and copies instead ---------------------------------------------------------------
    const noNotes = await fill('sp', 'work_notes', 'an internal note', 'Work notes');
    const afterNotes = await boxes(sp);
    t.check('/sp shows no work-notes box: work notes are refused, never put into the customer-visible comment box', noNotes.ok === false && noNotes.reason === 'no-form' && afterNotes.comment === after.comment && inputsOf(afterNotes, 'comment') === inputsOf(after, 'comment'), JSON.stringify(noNotes));

    await sp.evaluate((u) => window.__portal.go(u), `/sp?id=ticket&table=incident&sys_id=${A.sysId}&dup=1`);
    const dupBefore = await boxes(sp);
    const dup = await fill('sp', 'comments', 'which one?', 'Additional comments');
    const dupAfter = await boxes(sp);
    t.check('two identical comment boxes: refused (it cannot tell which one is meant), neither is changed', dup.ok === false && dup.reason === 'no-form' && dupAfter.comment === dupBefore.comment && dupAfter.comment2 === dupBefore.comment2 && inputsOf(dupAfter, 'comment') === inputsOf(dupBefore, 'comment') && inputsOf(dupAfter, 'comment2') === inputsOf(dupBefore, 'comment2'), JSON.stringify(dup));

    await sp.evaluate((u) => window.__portal.go(u), `/sp?id=ticket&table=incident&sys_id=${A.sysId}&ro=1`);
    const ro = await fill('sp', 'comments', 'locked?', 'Additional comments');
    t.check('a disabled comment box is reported as read-only', ro.ok === false && ro.reason === 'read-only', JSON.stringify(ro));

    await sp.evaluate((u) => window.__portal.go(u), `/sp?id=ticket&table=incident&sys_id=${A.sysId}&nobox=1`);
    const missing = await boxes(sp);
    t.check('the page has no comment box now', missing.comment === null && missing.comment2 === null);
    await clickButton(panel.page, /^Insert as customer comment/);
    await panel.page.waitForSelector('.ab-note-warn[role="alert"]', { timeout: 8000 });
    await clickButton(panel.page, /^Insert anyway/);
    await waitForText(panel.page, /Copied to the clipboard instead|blocked copying/, { timeout: 8000 });
    const note = (await textOf(panel.page, '.ab-note-ok, .ab-note-danger')) || '';
    t.check('with no box to type into, the panel falls back to Copy and says why', /^Agent Buddy could not reach a form field on this page\. Copied to the clipboard instead\.$|^The browser blocked copying/.test(note), note);
    t.check("still no press of the page's Send button on any of these", (await boxes(sp)).sends.length === 0);
    await panel.page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Close/.test(b.innerText.trim()))?.click());
    await sp.close();

    // ---- 4. /csm: nothing on the page says who is signed in; the work-notes box is internal -----------------------------------------
    const csm = await ctx.openInstancePage(`/csm?id=csm_ticket&table=incident&sys_id=${A.sysId}`, 'portal-csm');
    const s5 = await ctx.waitUntil('the /csm page to answer with a record', async () => ((await stateOf('csm')).record ? stateOf('csm') : null), { timeout: 12000 });
    t.check('csm: portal /csm, page "csm_ticket", record from the address', s5.portal?.base === '/csm' && s5.portal.pageId === 'csm_ticket' && s5.record.sysId === A.sysId, JSON.stringify([s5.portal, s5.record]));
    t.check('csm: with no g_user, no NOW and no Angular, the person is still found (one small read of their own row)', s5.user?.userId === data.ME.sysId && s5.user.name === 'Beth Anglin', JSON.stringify(s5.user));
    await ctx.sleep(5200); // two more polls by the panel
    const meReads = inst.browserRequests().filter((r) => r.path === '/api/now/table/sys_user' && /DYNAMIC/.test(decodeURIComponent(r.search)));
    t.check('that read was made ONCE (kept for ten minutes, not repeated on every poll), as a GET with the session token, for 3 columns', meReads.length === 1 && meReads[0].method === 'GET' && meReads[0].tokenOk && /sysparm_fields=sys_id%2Cuser_name%2Cname/.test(meReads[0].search) && /sysparm_limit=2/.test(meReads[0].search), JSON.stringify(meReads.map((r) => [r.method, r.search])));

    await waitForRecord(panel.page);
    const csmBefore = await boxes(csm);
    const sum = await runFeature(panel.page, /^Summarise this ticket/);
    t.check('summary produced on /csm', Boolean(sum.result), sum.error || '');
    await clickButton(panel.page, /^Add to work notes/);
    await waitForText(panel.page, /Inserted into the form/, { timeout: 8000 });
    const csmAfter = await boxes(csm);
    t.check('the INTERNAL work-notes box got the summary, below the agent\'s own text', csmAfter.workNote.startsWith('Checked the logs.\n\n') && csmAfter.workNote.includes('Issue:') && csmAfter.model.workNote === csmAfter.workNote, csmAfter.workNote.replace(/\n/g, '\\n').slice(0, 90));
    t.check('...and the customer comment box was not touched at all', csmAfter.comment === csmBefore.comment && inputsOf(csmAfter, 'comment') === inputsOf(csmBefore, 'comment'));
    const toCustomer = await fill('csm', 'comments', 'Hello from the agent', 'Additional comments');
    const csmEnd = await boxes(csm);
    t.check('a customer comment goes to the customer box and not to the work notes', toCustomer.ok === true && csmEnd.comment === `${csmBefore.comment}\n\nHello from the agent` && csmEnd.workNote === csmAfter.workNote, JSON.stringify(toCustomer));
    t.check('csm: the Send button was never pressed', csmEnd.sends.length === 0);
    await panel.close();
    await csm.close();

    // ---- 5. /esc: a request page without a table parameter, a number-only address, the user from an Angular scope -----------------------
    const esc = await ctx.openInstancePage(`/esc?id=sc_request&sys_id=${R.sysId}`, 'portal-esc');
    const s6 = await ctx.waitUntil('the /esc request page', async () => ((await stateOf('esc')).record ? stateOf('esc') : null), { timeout: 12000 });
    t.check('request page (?id=sc_request&sys_id=, no table parameter): the table is inferred from the page id', s6.record.table === 'sc_request' && s6.record.kind === 'request' && s6.record.sysId === R.sysId && s6.portal?.pageId === 'sc_request' && s6.portal.base === '/esc', JSON.stringify([s6.record, s6.portal]));
    t.check('/esc: the person is found from the Angular root scope', s6.user?.userId === data.ME.sysId && s6.user.name === 'Beth Anglin', JSON.stringify(s6.user));
    await esc.goto(`${inst.origin}/esc?id=ticket&table=incident&number=${A.number}`, { waitUntil: 'load' });
    const s7 = await ctx.waitUntil('the number-only address', async () => ((await stateOf('esc')).record ? stateOf('esc') : null), { timeout: 12000 });
    t.check('an address with only a number (?number=INC...) finds the record by one small read', s7.record.sysId === A.sysId && s7.record.number === A.number, JSON.stringify(s7.record));
    await esc.goto(`${inst.origin}/esc?id=ticket&table=incident&sys_id=-1`, { waitUntil: 'load' });
    const s8 = await ctx.waitUntil('the new-record address', async () => {
      const s = await stateOf('esc');
      return s.href?.includes('sys_id=-1') ? s : null;
    }, { timeout: 12000 });
    t.check('a new record (sys_id=-1) is no record', s8.record === null && s8.surface === 'portal', JSON.stringify([s8.record, s8.surface]));
    await esc.close();
  },
};

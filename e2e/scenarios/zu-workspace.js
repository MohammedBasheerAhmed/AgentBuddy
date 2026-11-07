// zu. Workspaces (audit of 2026-11-07, part 9: "Workspaces are the worst served surface"). The fake Workspace has no g_form, so every claim
//    below is about the DOM path:
//    - Insert is offered only when the box is on the page: asked BEFORE the click (READ insertTargets), a missing box says why ('absent'),
//      and the reply card then leads with Copy and says so in one plain line; no click on Insert can fail
//    - the composer serves Work notes and customer comments: its switch (tabs) is read. Set to Work notes, a work note goes in; set to
//      customer comments, nothing is written (the card says to switch it); a composer whose switch cannot be read still takes the text
//      and the answer says so (modeUnread)
//    - the extension never presses the page's own Save or Post; a Post (pressed by the test, as a person would) empties the composer and
//      Undo is withdrawn at once, in English and in Arabic
//    - a big page (60,000 elements in front of the composer), a page in Arabic, the CSM and agent Workspace routes
//      (/now/cwf/agent, /now/workspace/agent) and the Next Experience shell (the classic form in a frame inside a shadow root)
//    - re-looking: a composer opened on the page (the Notes tab) or switched to the right kind is noticed without any click in the panel
const { prepare, errorMark, errorsSince, describeErrors, clickButton, waitForText } = require('../common.js');
const { runFeature, waitForRecord, deepTextareaValue } = require('../ui.js');

const NOT_FILLABLE = "This page's box can't be filled automatically. Copy and paste.";
const SET_TO_CUSTOMER = 'The box on this page is set to customer comments. Switch it to Work notes, then insert, or use Copy.';

/** Press a button of the page (found through the shadow roots) by its text: what a person does with the mouse. Never the extension. */
function pressInPage(text) {
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'tab') && el.textContent.trim() === text) {
        el.click();
        return true;
      }
      if (el.shadowRoot && walk(el.shadowRoot)) return true;
    }
    return false;
  };
  return walk(document);
}

/** What the newest answer card shows: its buttons, the line under them, the caution, whether Undo is there, and its last note. */
const answerState = (p) =>
  p.evaluate(() => {
    const card = window.__vis(document.querySelectorAll('.ab-answer'))[0];
    if (!card) return null;
    const buttons = [...card.querySelectorAll('.ab-answer-actions button')].map((b) => ({ text: b.innerText.trim(), main: b.classList.contains('ab-answer-main'), disabled: b.disabled }));
    const notes = [...card.querySelectorAll('.ab-note[role="status"]')];
    return {
      buttons,
      hint: card.querySelector('.ab-answer-hint')?.innerText ?? '',
      caution: card.querySelector('.ab-answer-caution')?.innerText ?? '',
      undo: Boolean(card.querySelector('.ab-insert-undo')),
      note: notes.length ? notes[notes.length - 1].innerText : '',
    };
  });

module.exports = {
  id: 'zu',
  title: 'Workspaces: Insert only where the box is, Copy leads when it is not, the composer mode is read, Undo goes after a Post (and routes, shell, Arabic, big page)',
  timeoutMs: 150000,
  async run(t, ctx) {
    const { data, inst } = ctx;
    await prepare(ctx);
    const mark = errorMark(ctx);
    const ID = data.INCIDENT_ID;
    const here = { table: 'incident', sysId: ID };

    // Ask the content script of the tab whose address contains `needle`, the way the panel does.
    const ask = (needle, message) =>
      ctx.ext(
        async (needle, message) => {
          const tab = (await chrome.tabs.query({})).find((x) => (x.url || '').includes(needle));
          if (!tab) return { noTab: true };
          try {
            return await chrome.tabs.sendMessage(tab.id, message);
          } catch (err) {
            return { sendError: String(err.message || err) };
          }
        },
        needle,
        message
      );
    const probe = async (needle, fields) => {
      const a = await ask(needle, { type: 'ab:read', op: 'insertTargets', args: { fields, expect: here } });
      return a?.fields || { error: JSON.stringify(a).slice(0, 160) };
    };
    const fill = (needle, field, value = 'A note from the test.') => ask(needle, { type: 'ab:fill-field', field, value, label: field === 'work_notes' ? 'Work notes' : 'Additional comments', mode: 'append', expect: here });
    const WORK = [{ name: 'work_notes', label: 'Work notes' }];
    const COMMENTS = [{ name: 'comments', label: 'Additional comments' }];
    // The card asks the page about its boxes a moment after it appears: wait for the answer it should show, then read it.
    const settle = (p, test, what) =>
      ctx
        .waitUntil(what, async () => {
          const c = await answerState(p);
          return c && test(c) ? c : null;
        }, { timeout: 12000 })
        .catch(() => answerState(p));
    const open = async (path, label) => {
      const page = await ctx.openInstancePage(path, label);
      await ctx.waitUntil('the content script to answer', async () => {
        const a = await ask(path.split('?')[0], { type: 'ab:page-state' });
        return a?.record ? a : null;
      }, { timeout: 20000 });
      return page;
    };

    // ============================== a composer set to Work notes ================================================================
    let ws = await open(`/now/sow/record/incident/${ID}?variant=modes`, 'ws-modes');
    const needle = `/record/incident/${ID}?variant=modes`;
    const work = (await probe(needle, WORK)).work_notes;
    t.check('before the click: the Work notes box is on the page, named by its label, and the composer is set to Work notes', work?.state === 'editable' && work.label === 'Work notes' && work.mode === 'match', JSON.stringify(work));
    const comments = (await probe(needle, COMMENTS)).comments;
    t.check('...the customer comments box is NOT there (the one box keeps its label): "absent", said before any click', comments?.state === 'unknown' && comments.gap === 'absent', JSON.stringify(comments));
    const typed = await ws.evaluate(deepTextareaValue, 'Work notes');
    const noComments = await fill(needle, 'comments');
    t.check('a click on Insert for that missing box would fail the same way: "no-form", and nothing is written', noComments.ok === false && noComments.reason === 'no-form' && (await ws.evaluate(deepTextareaValue, 'Work notes')) === typed, JSON.stringify(noComments));
    const put = await fill(needle, 'work_notes');
    t.check('a work note goes into a composer that is set to Work notes: appended below what was typed, no "unread" flag', put.ok === true && put.method === 'dom' && !put.modeUnread, JSON.stringify(put));
    t.check('...and the box holds the typed text, then the note', (await ws.evaluate(deepTextareaValue, 'Work notes')) === `${typed}\n\nA note from the test.`, String(await ws.evaluate(deepTextareaValue, 'Work notes')).slice(0, 80));
    t.check('the extension pressed neither Post nor Save', (await ws.evaluate(() => [window.__wsPosts.length, window.__wsSaves])).join() === '0,0');

    // ---- the panel: Copy leads for the missing box; Insert is there for the box that exists, with no caution -------------------------------
    let panel = await ctx.openPanel();
    await waitForRecord(panel.page);
    const reply = await runFeature(panel.page, /^Draft a reply to the customer/);
    t.check('a reply was drafted', Boolean(reply.result), reply.error || '');
    let card = await settle(panel.page, (c) => c.hint === NOT_FILLABLE, 'the reply card to know the page has no comments box');
    const replyInsert = card?.buttons.find((b) => /^Insert as customer comment/.test(b.text));
    t.check('the reply card leads with Copy: Insert as customer comment is there, but off', Boolean(card) && card.buttons[0]?.text === 'Copy' && card.buttons[0].main && replyInsert?.disabled === true, JSON.stringify(card?.buttons));
    t.check('...and one plain line says why', card?.hint === NOT_FILLABLE, card?.hint);
    const calls = await ws.evaluate(() => window.__wsEvents.input);
    await panel.page.evaluate(() => [...document.querySelectorAll('.ab-answer-actions button')].find((b) => /^Insert as customer comment/.test(b.innerText) && !b.disabled)?.click());
    t.check('a click on the off Insert does nothing to the page', (await ws.evaluate(() => window.__wsEvents.input)) === calls);

    const sum = await runFeature(panel.page, /^Summarise this ticket/);
    t.check('a summary was produced', Boolean(sum.result), sum.error || '');
    card = await settle(panel.page, (c) => c.caution === '' && c.buttons.some((b) => /^Add to work notes/.test(b.text) && !b.disabled), 'the summary card to read the composer');
    const addNotes = card?.buttons.find((b) => /^Add to work notes/.test(b.text));
    t.check('the summary card: Add to work notes is on (the box is there and the composer is set to Work notes)', addNotes?.disabled === false, JSON.stringify(card?.buttons));
    t.check('...with no "check it is set to" caution: the switch was read', card?.caution === '', card?.caution);
    await clickButton(panel.page, /^Add to work notes/);
    await waitForText(panel.page, /Inserted\. Review it/, { timeout: 8000 });
    card = await answerState(panel.page);
    t.check('inserted: the next step is Post, the box is named, and Undo is offered', /^Inserted\. Review it\. Then press Post\. It went into the box labelled "Work notes"\.$/.test(card?.note || '') && card.undo, `${card?.note} | undo=${card?.undo}`);
    const afterInsert = await ws.evaluate(deepTextareaValue, 'Work notes');
    t.check('the summary is in the box below the earlier text', afterInsert.startsWith(`${typed}\n\nA note from the test.\n\n`) && afterInsert.length > typed.length + 40, afterInsert.slice(0, 120));

    // The person presses the page's own Post (the test does, as a hand would): the composer empties, and Undo has nothing left to put back.
    await ws.evaluate(pressInPage, 'Post');
    const posted = await ws.evaluate(() => window.__wsPosts.slice());
    t.check('the page\'s own Post sent the text (pressed by the test, never by the extension)', posted.length === 1 && posted[0] === afterInsert);
    await ctx.waitUntil('Undo to be withdrawn after the Post', async () => ((await answerState(panel.page))?.undo === false ? true : null), { timeout: 15000 }).catch(() => null);
    card = await answerState(panel.page);
    t.check('after a Post, Undo is gone', card?.undo === false, `undo=${card?.undo}`);
    await panel.close();

    // ============================== a composer set to customer comments ==============================================================
    await ws.close();
    ws = await open(`/now/sow/record/incident/${ID}?variant=customer`, 'ws-customer');
    const needleC = `/record/incident/${ID}?variant=customer`;
    const wrongMode = (await probe(needleC, WORK)).work_notes;
    t.check('set to customer comments: the box is found, and the composer is read as the other kind', wrongMode?.state === 'editable' && wrongMode.mode === 'other', JSON.stringify(wrongMode));
    const typedC = await ws.evaluate(deepTextareaValue, 'Work notes');
    const refused = await fill(needleC, 'work_notes');
    t.check('a work note is refused ("wrong-mode") and nothing is written: it could have gone into a post the customer reads', refused.ok === false && refused.reason === 'wrong-mode' && (await ws.evaluate(deepTextareaValue, 'Work notes')) === typedC, JSON.stringify(refused));
    panel = await ctx.openPanel();
    await waitForRecord(panel.page);
    await runFeature(panel.page, /^Summarise this ticket/);
    card = await settle(panel.page, (c) => c.hint === SET_TO_CUSTOMER, 'the summary card to read the composer set to customer comments');
    const blockedNotes = card?.buttons.find((b) => /^Add to work notes/.test(b.text));
    t.check('the summary card: Add to work notes is off, and the line says which way to switch', blockedNotes?.disabled === true && card.hint === SET_TO_CUSTOMER, `${JSON.stringify(card?.buttons)} | ${card?.hint}`);
    // The person switches the composer on the page: nothing in the panel is pressed, and the card notices.
    await ws.evaluate(pressInPage, 'Work notes');
    await ctx.waitUntil('Add to work notes to come back after the switch', async () => ((await answerState(panel.page))?.buttons.find((b) => /^Add to work notes/.test(b.text))?.disabled === false ? true : null), { timeout: 20000 }).catch(() => null);
    card = await answerState(panel.page);
    t.check('after the person switches the composer to Work notes, Add to work notes is on again (the panel looked again by itself)', card?.buttons.find((b) => /^Add to work notes/.test(b.text))?.disabled === false, JSON.stringify(card?.buttons));
    await panel.close();
    await ws.close();

    // ============================== no composer, a Notes tab, a switch that cannot be read =============================================
    ws = await open(`/now/sow/record/incident/${ID}?variant=notes-tab`, 'ws-notes-tab');
    const needleT = `/record/incident/${ID}?variant=notes-tab`;
    const closed = (await probe(needleT, WORK)).work_notes;
    t.check('the composer is behind the Notes tab: "absent" until the person opens it', closed?.state === 'unknown' && closed.gap === 'absent', JSON.stringify(closed));
    await ws.evaluate(pressInPage, 'Notes');
    const opened = (await probe(needleT, WORK)).work_notes;
    t.check('...and found once it is open', opened?.state === 'editable' && opened.mode === 'match', JSON.stringify(opened));
    await ws.close();

    ws = await open(`/now/sow/record/incident/${ID}?variant=none`, 'ws-none');
    const none = (await probe(`/record/incident/${ID}?variant=none`, WORK)).work_notes;
    t.check('a record page with no composer at all: "absent"', none?.state === 'unknown' && none.gap === 'absent', JSON.stringify(none));
    await ws.close();

    ws = await open(`/now/sow/record/incident/${ID}`, 'ws-plain');
    const unread = (await probe(`/sow/record/incident/${ID}`, WORK)).work_notes;
    t.check('the plain page (two boxes, no switch): found, and the mode cannot be read', unread?.state === 'editable' && unread.mode === 'unread', JSON.stringify(unread));
    const unreadFill = await fill(`/sow/record/incident/${ID}`, 'work_notes');
    t.check('...the note goes in and the answer says the mode was not read', unreadFill.ok === true && unreadFill.modeUnread === true, JSON.stringify(unreadFill));
    await ws.close();

    // ============================== a big page, a page in Arabic ======================================================================
    ws = await open(`/now/sow/record/incident/${ID}?variant=big`, 'ws-big');
    const big = (await probe(`/record/incident/${ID}?variant=big`, WORK)).work_notes;
    t.check('60,000 elements in front of the composer: the box is still found (the first search gave up at 25,000)', big?.state === 'editable', JSON.stringify(big));
    await ws.close();

    ws = await open(`/now/sow/record/incident/${ID}?variant=arabic`, 'ws-arabic');
    const arabic = (await probe(`/record/incident/${ID}?variant=arabic`, WORK)).work_notes;
    const ARABIC_NOTES = 'ملاحظات العمل';
    t.check('an Arabic Workspace: the box is found by its Arabic label, named so, and the Arabic switch is read', arabic?.state === 'editable' && arabic.label === ARABIC_NOTES && arabic.mode === 'match', JSON.stringify(arabic));
    const arabicFill = await fill(`/record/incident/${ID}?variant=arabic`, 'work_notes');
    t.check('...and the note goes in', arabicFill.ok === true && arabicFill.label === ARABIC_NOTES, JSON.stringify(arabicFill));
    await ws.evaluate(pressInPage, 'نشر');
    t.check('the Arabic Post button posted it (pressed by the test)', (await ws.evaluate(() => window.__wsPosts.length)) === 1);
    await ws.close();

    // ============================== the routes of the CSM and the agent Workspaces, and the Next Experience shell ======================
    for (const [route, name] of [['/now/cwf/agent/record/incident/', 'CSM Workspace'], ['/now/workspace/agent/record/incident/', 'agent Workspace']]) {
      const page = await ctx.openInstancePage(`${route}${ID}?variant=modes`, 'ws-route');
      const state = await ctx.waitUntil(`the ${name} page to be read`, async () => {
        const a = await ask(route + ID, { type: 'ab:page-state' });
        return a?.record ? a : null;
      }, { timeout: 20000 }).catch(() => null);
      t.check(`${name} (${route}...): the ticket is found from the address, on a Workspace`, state?.record?.table === 'incident' && state.record.sysId === ID && state.surface === 'workspace', JSON.stringify({ record: state?.record, surface: state?.surface }));
      const box = (await probe(route + ID, WORK)).work_notes;
      t.check(`${name}: the Work notes box is found`, box?.state === 'editable', JSON.stringify(box));
      await page.close();
    }
    const shellPath = `/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${ID}`;
    const shell = await ctx.openInstancePage(shellPath, 'ws-shell');
    const shellState = await ctx.waitUntil('the Next Experience shell to be read', async () => {
      const a = await ask('/now/nav/ui/classic/', { type: 'ab:page-state' });
      return a?.record ? a : null;
    }, { timeout: 20000 }).catch(() => null);
    t.check('Next Experience shell: the ticket is found, on the classic surface', shellState?.record?.sysId === ID && shellState.surface === 'classic', JSON.stringify({ record: shellState?.record, surface: shellState?.surface }));
    const shellFill = await ask('/now/nav/ui/classic/', { type: 'ab:fill-field', field: 'work_notes', value: 'A note into the framed form.', label: 'Work notes', mode: 'append', expect: here });
    t.check('...and a work note goes into the form in the frame inside the shadow root', shellFill.ok === true, JSON.stringify(shellFill));
    if (shellFill.ok === true && shellFill.method !== 'gform') t.warning('the form in the shadow-DOM frame was filled through the page (DOM), not through its g_form', `method=${shellFill.method}: window.frames['gsft_main'] did not reach a frame inside a shadow root in this browser (live question L5)`);
    await shell.close();

    t.check('no extension error during the scenario', errorsSince(ctx, mark).length === 0, describeErrors(errorsSince(ctx, mark)));
    t.check('the fake instance saw only reads from the extension', inst.browserRequests().filter((r) => r.kind === 'api').every((r) => r.method === 'GET'));
  },
};

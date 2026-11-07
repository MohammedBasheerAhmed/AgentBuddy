// u. The guards on the one write (FILL_FIELD), asked straight of the content script the way the side panel asks (chrome.tabs.sendMessage
//    from an extension page), and one panel rule about previews:
//    - a field that is not on the fillable list is refused (priority, state, assigned_to, a made-up column, a password column)
//    - `expect` names the record a text was written for: another record, a blank form of another table, a malformed expectation and the
//      email form of another record are all refused ("wrong-record" / "no-such-field") and nothing is written
//    - a one-line field is replaced and its line breaks become spaces, even when the panel asks to append
//    - the knowledge article body is HTML: markup in the text arrives escaped
//    - a feature that sends other tickets' text as reference material always shows its preview, even in "first time per action" mode
const { prepare, errorMark, errorsSince, describeErrors, clickButton, waitForText, textOf } = require('../common.js');
const { runFeature, waitForVisible, actionOffered, startAction } = require('../ui.js');

/** Put every answer on screen away (round 3 keeps several answers; a run's own result is then the only one). */
const closeAnswers = (p) => p.evaluate(() => window.__vis(document.querySelectorAll('.ab-answer-close')).forEach((b) => b.click()));

function replier({ system }) {
  if (/work through a ticket step by step/.test(system)) return '- [ ] Check the certificate (general practice)';
  if (/catch up on a long thread/.test(system)) return 'Decisions:\n- None\nOpen questions:\n- None\nWho owns what:\n- None\nNext:\n- None';
  return null;
}

module.exports = {
  id: 'u',
  title: 'Insert guards: fields off the list, the record a text was written for, one-line and HTML fields; reference-material previews always shown',
  async run(t, ctx) {
    const { ai, data } = ctx;
    await prepare(ctx);
    ai.setReplier(replier);
    const mark = errorMark(ctx);
    const OTHER = 'aa100000000000000000000000000100'; // INC0010100

    // The tab whose address contains `needle`, asked like the panel asks.
    const fill = (needle, message) =>
      ctx.ext(
        async (needle, message) => {
          const tab = (await chrome.tabs.query({})).find((x) => (x.url || '').includes(needle));
          if (!tab) return { noTab: true };
          try {
            return await chrome.tabs.sendMessage(tab.id, { type: 'ab:fill-field', ...message });
          } catch (err) {
            return { sendError: String(err.message || err) };
          }
        },
        needle,
        message
      );

    // ============================== a saved incident ========================================================================================
    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-classic');
    await ctx.waitUntil('the content script to answer', async () => {
      const a = await fill(`sys_id=${data.INCIDENT_ID}`, { field: 'work_notes', value: 'probe', mode: 'append', expect: { table: 'incident', sysId: data.INCIDENT_ID } });
      return a.ok === true ? a : null;
    }, { timeout: 15000 });
    await ticket.evaluate(() => { window.__gformCalls.length = 0; });
    const calls = () => ticket.evaluate(() => window.__gformCalls);
    const here = `sys_id=${data.INCIDENT_ID}`;
    const here_ = { table: 'incident', sysId: data.INCIDENT_ID };

    // ---- fields that are not on the list --------------------------------------------------------------------------------------------
    const refused = {};
    for (const field of ['priority', 'state', 'assigned_to', 'caller_id', 'u_secret_field', 'user_password', 'sys_id']) {
      refused[field] = await fill(here, { field, value: 'x', expect: here_ });
    }
    t.check('a column off the fillable list (priority, state, assigned_to, caller_id, a custom column, a password column, sys_id) is refused as "bad-field"', Object.values(refused).every((a) => a.ok === false && a.reason === 'bad-field'), JSON.stringify(refused).slice(0, 220));
    t.check('...and nothing was written', (await calls()).length === 0);

    // ---- the record the text was written for ----------------------------------------------------------------------------------------
    const wrong = {
      'another record': await fill(here, { field: 'work_notes', value: 'for the other ticket', mode: 'append', expect: { table: 'incident', sysId: OTHER } }),
      'another table': await fill(here, { field: 'work_notes', value: 'for a problem', mode: 'append', expect: { table: 'problem', sysId: data.INCIDENT_ID } }),
      'a blank form': await fill(here, { field: 'work_notes', value: 'for a new incident', mode: 'append', expect: { table: 'incident', newRecord: true } }),
      'no id': await fill(here, { field: 'work_notes', value: 'x', mode: 'append', expect: { table: 'incident' } }),
      'a string': await fill(here, { field: 'work_notes', value: 'x', mode: 'append', expect: 'incident' }),
      'a made-up id': await fill(here, { field: 'work_notes', value: 'x', mode: 'append', expect: { table: 'incident', sysId: 'not-a-sys-id' } }),
    };
    t.check('written for another record, another table, a blank form, or with a malformed expectation (no id, a string, a made-up id): "wrong-record" every time', Object.values(wrong).every((a) => a.ok === false && a.reason === 'wrong-record'), JSON.stringify(Object.fromEntries(Object.entries(wrong).map(([k, a]) => [k, a.reason || a.sendError]))).slice(0, 260));
    t.check('...and nothing was written', (await calls()).length === 0);
    const right = await fill(here, { field: 'work_notes', value: 'for this ticket', mode: 'append', expect: here_ });
    t.check('written for THIS record: it goes in (one setValue below what was typed)', right.ok === true && (await calls()).length === 1 && (await calls())[0].value === 'Checking the gateway certificate now.\n\nprobe\n\nfor this ticket', JSON.stringify([right, await calls()]).slice(0, 200));
    t.check('with no expectation at all (an older caller) the fill still works', (await fill(here, { field: 'work_notes', value: 'no expectation', mode: 'append' })).ok === true);
    await ticket.evaluate(() => { window.__gformCalls.length = 0; });

    // ---- "Try again" then Insert again (F5): the earlier text is swapped, never doubled; only as a whole block; never with replace ---------
    const workNotes = () => ticket.evaluate(() => window.g_form.getValue('work_notes'));
    const before = await workNotes();
    await fill(here, { field: 'work_notes', value: 'Answer one', mode: 'append', expect: here_ });
    const swap = await fill(here, { field: 'work_notes', value: 'Answer two', mode: 'append', expect: here_, replacing: 'Answer one' });
    t.check('append with the earlier text: that one copy is swapped for the new one, what was there before stays', swap.ok === true && (await workNotes()) === `${before}\n\nAnswer two`, JSON.stringify(await workNotes()).slice(0, 200));
    await fill(here, { field: 'work_notes', value: 'Answer three', mode: 'append', expect: here_, replacing: 'Answer' });
    t.check('a part of a line is not a block: "Answer" inside "Answer two" is not swapped, the new text goes below', (await workNotes()) === `${before}\n\nAnswer two\n\nAnswer three`, JSON.stringify(await workNotes()).slice(0, 200));
    const odd = await fill(here, { field: 'work_notes', value: 'Answer four', mode: 'append', expect: here_, replacing: { not: 'text' } });
    t.check('an earlier text that is not text is ignored (plain append)', odd.ok === true && (await workNotes()).endsWith('Answer three\n\nAnswer four'));
    const wrongSwap = await fill(here, { field: 'work_notes', value: 'x', mode: 'append', expect: { table: 'incident', sysId: OTHER }, replacing: 'Answer four' });
    t.check('the earlier text never gets past the record check', wrongSwap.ok === false && wrongSwap.reason === 'wrong-record' && (await workNotes()).endsWith('Answer four'));
    await ticket.evaluate(() => { window.__gformCalls.length = 0; });

    // The email body belongs to the email client: anywhere else there is no such field
    const emailForm = await fill(here, { field: 'work_notes', value: 'x', mode: 'append', expect: { email: true, table: 'incident', sysId: data.INCIDENT_ID } });
    t.check('a text written for the EMAIL form of this ticket is not put into the ticket form itself (there is no such field here)', emailForm.ok === false && emailForm.reason === 'no-such-field', JSON.stringify(emailForm));
    const body = await fill(here, { field: 'body', value: 'Hello', mode: 'append', expect: { email: true, table: 'incident', sysId: data.INCIDENT_ID } });
    t.check('an email body on the ticket form (not the email client) is "no-such-field"', body.ok === false && body.reason === 'no-such-field', JSON.stringify(body));

    // ---- a one-line field -------------------------------------------------------------------------------------------------------------
    const title = await fill(here, { field: 'short_description', value: 'First line\nSecond line', label: 'Short description', mode: 'append', expect: here_ });
    const afterTitle = await calls();
    t.check('a one-line field (short description) is REPLACED even when the panel asks to append, and the line break becomes a space', title.ok === true && afterTitle.at(-1)?.name === 'short_description' && afterTitle.at(-1).value === 'First line Second line', JSON.stringify(afterTitle.at(-1)));
    await ticket.close();

    // ============================== a blank incident and a blank article ===================================================================
    const blank = await ctx.openInstancePage('/incident.do?sys_id=-1', 'ticket-new');
    await ctx.waitUntil('the blank form to answer', async () => (await fill('sys_id=-1', { field: 'short_description', value: 'probe', expect: { table: 'incident', newRecord: true } })).ok === true, { timeout: 15000 });
    await blank.evaluate(() => { window.__gformCalls.length = 0; });
    const onBlank = {
      'a saved incident': await fill('sys_id=-1', { field: 'short_description', value: 'x', expect: { table: 'incident', sysId: data.INCIDENT_ID } }),
      'a blank article': await fill('sys_id=-1', { field: 'short_description', value: 'x', expect: { table: 'kb_knowledge', newRecord: true } }),
    };
    t.check('a blank incident form refuses a text written for a saved incident or for a blank ARTICLE form', Object.values(onBlank).every((a) => a.ok === false && a.reason === 'wrong-record') && (await blank.evaluate(() => window.__gformCalls.length)) === 0, JSON.stringify(onBlank));
    await blank.close();

    const article = await ctx.openInstancePage('/kb_knowledge.do?sys_id=-1', 'ticket-article');
    await ctx.waitUntil('the blank article to answer', async () => (await fill('kb_knowledge.do', { field: 'short_description', value: 'probe', expect: { table: 'kb_knowledge', newRecord: true } })).ok === true, { timeout: 15000 });
    await article.evaluate(() => { window.__gformCalls.length = 0; });
    const html = await fill('kb_knowledge.do', { field: 'text', value: 'Step 1: open <img src=x onerror=alert(1)> & close it.\n\nStep 2: "quote" it.', mode: 'append', expect: { table: 'kb_knowledge', newRecord: true } });
    const written = (await article.evaluate(() => window.__gformCalls)).at(-1)?.value || '';
    t.check('the article body (an HTML field) receives escaped HTML: the markup of a model answer is shown as characters, never parsed', html.ok === true && /&lt;img src=x onerror=alert\(1\)&gt;/.test(written) && /&amp; close it/.test(written) && !/<img/i.test(written) && /^<p>/.test(written) && /<\/p>\n<p>Step 2: &quot;quote&quot; it\.<\/p>$/.test(written), written);
    t.check('...the form\'s own field shows exactly that and the page created no element from it', (await article.evaluate(() => document.querySelectorAll('img').length)) === 0);
    await article.close();

    // ============================== the preview of reference material ==============================================================================
    await ctx.configure({ previewMode: 'first', previewSeen: [] });
    const panel = await ctx.openPanel();
    const p = panel.page;
    const t2 = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-classic');
    await waitForText(p, data.INCIDENT_NUMBER, { timeout: 20000 });
    await ctx.waitUntil('the discussion catch-up to be offered (in All tools)', () => actionOffered(p, /^Catch up on the discussion/), { timeout: 15000 });
    // "Stop waiting" (the progress button of a run; the preview dialog has its own Cancel): the run is dropped, an answer that arrives
    // later is not shown, and the request itself was NOT recalled (it had left)
    await ctx.configure({ previewMode: 'never' });
    await ctx.sleep(400);
    ai.setMode('slow');
    const sentBefore = ai.requests.length;
    await startAction(p, /^Catch up on the discussion/);
    await waitForText(p, 'Waiting for the AI', { timeout: 10000 });
    await clickButton(p, /^Stop waiting/);
    await ctx.sleep(2300); // the slow answer comes back now
    const afterStop = await p.evaluate(() => ({ output: window.__vis(document.querySelectorAll('.ab-output')).length, actions: window.__vis(document.querySelectorAll('.ab-acts .ab-act:not([disabled])')).length }));
    t.check('"Stop waiting": the answer that arrives afterwards is not shown, the actions are back, and the request had already gone out', afterStop.output === 0 && afterStop.actions > 3 && ai.requests.length === sentBefore + 1, JSON.stringify(afterStop));
    ai.setMode('echo');
    await closeAnswers(p);
    await ctx.configure({ previewMode: 'first', previewSeen: [] });
    await ctx.sleep(400);
    // "First time per action": a feature without reference material is previewed once...
    const first = await runFeature(p, /^Catch up on the discussion/);
    await closeAnswers(p);
    const second = await runFeature(p, /^Catch up on the discussion/);
    t.check('previews "first time per action": Catch up on the discussion is previewed the first time and goes straight out the second', first.preview !== null && second.preview === null && Boolean(second.result), `${first.preview !== null} / ${second.preview !== null}`);
    await closeAnswers(p);
    // ...but one that sends other tickets as reference material is previewed EVERY time
    const one = await runFeature(p, /^Suggest next steps/, { approve: false });
    const foot = (await textOf(p, '.ab-dialog-foot')) || '';
    t.check('Suggest next steps (other tickets as reference): the preview is shown and says why it is always asked', one.preview !== null && /This one includes other tickets, so you are always asked\./.test(foot) && !/will not be asked again/.test(foot), foot.replace(/\s+/g, ' '));
    await clickButton(p, /^Send to AI/);
    await waitForVisible(p, '.ab-output');
    await closeAnswers(p);
    const two = await runFeature(p, /^Suggest next steps/);
    // (round 3: a repeat run may ask with the short check, "Uses N ... from other records", instead of the full text: still asked)
    t.check('...and again the second time (having seen it once does not cover it: the reference changes from run to run)', (two.preview !== null || /Uses .* from other tickets/.test(two.confirm || '')) && Boolean(two.result), `${two.preview !== null} / ${two.confirm || ''}`);
    await closeAnswers(p);
    await ctx.configure({ previewMode: 'always', previewSeen: [] });

    const bad = errorsSince(ctx, mark);
    t.check('no console error, page error or CSP violation', bad.length === 0, describeErrors(bad));
    await panel.close();
    await t2.close();
    ai.reset();
  },
};

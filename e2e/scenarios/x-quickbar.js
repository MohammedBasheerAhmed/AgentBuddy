// x. The quick-actions bar in the ticket at a glance (round 3, TRACKER.md F6): it holds items from both halves for the ticket's state,
//    each marked (AI items carry the AI mark; Insights items do not and open their card); an AI item behaves exactly like the same action
//    in AI Assist (preview first, nothing sent before it is approved); no filled button (the screen's one primary is in AI Assist); it
//    folds and remembers it; the person can choose what it holds; with AI skipped only the Insights items stay.
const { clickButton, textOf, waitForRecord, openHalf } = require('../ui.js');

const barButtons = (p) => p.evaluate(() => window.__vis(document.querySelectorAll('.ab-quick-actions button')).map((b) => b.innerText.trim()));
const toggleState = (p) => p.evaluate(() => window.__vis(document.querySelectorAll('.ab-quick-toggle'))[0]?.getAttribute('aria-expanded') ?? null);
const clickLabel = (p, text) =>
  p.evaluate((text) => {
    const label = window.__vis(document.querySelectorAll('.ab-quick-choose label')).find((l) => l.querySelector('.ab-quick-choice')?.innerText.trim() === text);
    if (!label) return false;
    label.click();
    return true;
  }, text);
const choices = (p) =>
  p.evaluate(() =>
    window.__vis(document.querySelectorAll('.ab-quick-choose label')).map((l) => ({ text: l.querySelector('.ab-quick-choice')?.innerText.trim(), ai: Boolean(l.querySelector('.ab-ai-badge')), checked: l.querySelector('input').checked, disabled: l.querySelector('input').disabled }))
  );
const halfOn = (p) => p.evaluate(() => window.__vis(document.querySelectorAll('[role=tab][id$="-half-tab-insights"], [role=tab][id$="-half-tab-assist"]')).find((t) => t.getAttribute('aria-selected') === 'true')?.id.replace(/.*-half-tab-/, '') || null);
const settle = (ctx, ms = 400) => ctx.sleep(ms);

// The fake incident is In Progress: reply first, then the summary and the next steps, and the Related tickets card.
const WORKING = ['Draft a reply', 'Summarise', 'Next best action', 'Related tickets'];

module.exports = {
  id: 'x',
  title: 'Quick-actions bar: state-aware items from both halves, marked; the same preview; fold; choose; AI skipped',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.ensureEnabled();
    // Everything this scenario relies on, so it also runs alone: without confirmed work profiles the panel goes back to its set-up steps
    // part of the way through (an earlier scenario confirms them in a full run).
    await ctx.configure(
      { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', previewMode: 'always', previewSeen: [], instances: [inst.origin], quickBarOpen: true, quickPins: {}, pageBar: false, aiSkipped: false, profiles: ['it'], profilesConfirmed: true },
      { key: { provider: 'custom', value: ai.key } }
    );

    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-quickbar');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForRecord(p);
    await p.waitForFunction((n) => window.__vis(document.querySelectorAll('.ab-quick-actions button')).length === n, { timeout: 15000 }, WORKING.length);

    // 1. What it holds, and how each item is marked.
    // (Until the ticket's state has been read the bar shows the defaults for the kind, which are also four items in another order: on a slow
    // runner the first look is of those. Wait for the list the state decides.)
    await ctx.waitUntil('the bar to hold what fits a ticket in progress', async () => (await toggleState(p)) === 'true' && JSON.stringify(await barButtons(p)) === JSON.stringify(WORKING), { timeout: 15000 }).catch(() => {});
    t.check('the bar is open and holds what fits an incident in progress, from both halves', (await toggleState(p)) === 'true' && JSON.stringify(await barButtons(p)) === JSON.stringify(WORKING), JSON.stringify(await barButtons(p)));
    const marks = await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-quick-actions button')).map((b) => ({ ai: Boolean(b.querySelector('.ab-ai-badge')), insight: b.classList.contains('ab-quick-insight'), primary: b.classList.contains('ab-btn-primary') })));
    t.check('every AI item carries the AI mark, the Insights item does not', JSON.stringify(marks.map((m) => m.ai)) === JSON.stringify([true, true, true, false]) && marks[3].insight, JSON.stringify(marks));
    t.check('no filled button in the bar (the screen\'s one primary is in AI Assist)', marks.every((m) => !m.primary));

    // 2. An Insights item opens its card: the Insights half comes forward, nothing is sent.
    await clickButton(p, /^Related tickets$/);
    await p.waitForFunction(() => window.__vis(document.querySelectorAll('[role=tab][id$="-half-tab-insights"]')).some((t) => t.getAttribute('aria-selected') === 'true'), { timeout: 10000 });
    t.check('"Related tickets" shows the Insights half (its card), and nothing went to the AI', (await halfOn(p)) === 'insights' && ai.requests.length === 0, `${await halfOn(p)} / ${ai.requests.length}`);

    // 3. An AI item is the same as the action in AI Assist: AI Assist comes forward, the preview comes first, nothing is sent before it is approved.
    await clickButton(p, /^Summarise$/);
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    const head = await textOf(p, '.ab-dialog-head');
    t.check('the preview is shown for the action (named as in AI Assist), in the AI Assist half', /Summarise this ticket/.test(head || '') && (await halfOn(p)) === 'assist', `${(head || '').replace(/\s+/g, ' ')} / ${await halfOn(p)}`);
    t.check('nothing has been sent to the AI yet', ai.requests.length === 0, String(ai.requests.length));
    const whilePreview = await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-quick-actions button')).map((b) => ({ ai: Boolean(b.querySelector('.ab-ai-badge')), off: b.disabled })));
    t.check('while a run is open the AI items wait; the Insights item stays usable', whilePreview.filter((b) => b.ai).every((b) => b.off) && whilePreview.filter((b) => !b.ai).every((b) => !b.off), JSON.stringify(whilePreview));
    await clickButton(p, /^Send to AI/);
    await p.waitForSelector('.ab-output, .ab-note-danger', { timeout: 15000 });
    t.check('the answer appears, and exactly one request went out, only after approval', (await textOf(p, '.ab-output')) !== null && ai.requests.length === 1, String(ai.requests.length));
    const audit = await ctx.audit();
    t.check('the run is in the activity log under the same feature id as AI Assist', audit.some((e) => e.feature === 'record-summary' && e.outcome === 'sent'), audit.map((e) => `${e.feature}:${e.outcome}`).join(', '));
    await p.waitForFunction(() => window.__vis(document.querySelectorAll('.ab-quick-actions button')).every((b) => !b.disabled), { timeout: 5000 });
    t.check('once the answer is there the bar works again (answers are kept, the next one can start)', true);
    const assistText = await panel.text();
    t.check('AI Assist offers the same actions, suggested for the state, the rest under "More actions"', /suggested while you work on it/i.test(assistText) && /Draft a reply to the customer/.test(assistText) && /More actions \(\d+\)/.test(assistText), assistText.replace(/\s+/g, ' ').slice(-400));

    // 4. Fold and open again; the choice is kept.
    await clickButton(p, /^Quick actions$/);
    await p.waitForFunction(() => window.__vis(document.querySelectorAll('.ab-quick-toggle'))[0]?.getAttribute('aria-expanded') === 'false', { timeout: 5000 });
    t.check('folded: only the strip is left, no action buttons', (await barButtons(p)).length === 0);
    const savedClosed = await ctx.waitUntil('the folded bar to be saved', async () => (await ctx.settings()).quickBarOpen === false, { timeout: 5000 }).then(() => true, () => false);
    t.check('the choice is saved', savedClosed);
    await clickButton(p, /^Quick actions$/);
    await p.waitForSelector('.ab-quick-actions button', { timeout: 5000 });
    const savedOpen = await ctx.waitUntil('the opened bar to be saved', async () => (await ctx.settings()).quickBarOpen === true, { timeout: 5000 }).then(() => true, () => false);
    t.check('opened again, saved as open', savedOpen && (await barButtons(p)).length === WORKING.length);

    // 5. Choose what the bar holds (AI items marked in the list too).
    await clickButton(p, /^Choose$/);
    await p.waitForSelector('.ab-quick-choose label', { timeout: 5000 });
    let list = await choices(p);
    t.check('Choose lists the actions this ticket offers and the Insights card, with the current ones ticked', list.length >= 6 && list.filter((c) => c.checked).map((c) => c.text).sort().join('|') === [...WORKING].sort().join('|'), list.map((c) => `${c.text}${c.checked ? '*' : ''}`).join('|'));
    // The Insights cards ("Related tickets", and "Ready to resolve?" since its item points at the card that exists) carry no mark.
    const CARDS = ['Related tickets', 'Ready to resolve?'];
    t.check('in the list the AI actions carry the mark and the cards do not', CARDS.every((name) => list.find((c) => c.text === name)?.ai === false) && list.filter((c) => !CARDS.includes(c.text)).every((c) => c.ai), list.map((c) => `${c.text}${c.ai ? '(AI)' : ''}`).join('|'));
    t.check('at four, every item that is not ticked is off (the limit)', list.filter((c) => !c.checked).every((c) => c.disabled) && list.filter((c) => c.checked).length === 4);
    t.check('one can be taken away', await clickLabel(p, 'Next best action'));
    await settle(ctx);
    t.check('another can be added', await clickLabel(p, 'Hand-off brief'));
    await settle(ctx);
    const pins = (await ctx.settings()).quickPins;
    t.check('the pins are saved for the incident kind only, in the order chosen (cards too)', JSON.stringify(pins) === JSON.stringify({ incident: ['reply-draft', 'record-summary', 'card:related', 'handoff-brief'] }), JSON.stringify(pins));
    await clickButton(p, /^Done$/);
    await p.waitForFunction(() => window.__vis(document.querySelectorAll('.ab-quick-actions button')).some((b) => b.innerText.trim() === 'Hand-off brief'), { timeout: 5000 });
    t.check('the bar shows the chosen items, the new one last', JSON.stringify(await barButtons(p)) === JSON.stringify(['Draft a reply', 'Summarise', 'Related tickets', 'Hand-off brief']), JSON.stringify(await barButtons(p)));
    await clickButton(p, /^Choose$/);
    await p.waitForSelector('.ab-quick-choose label', { timeout: 5000 });
    await clickButton(p, /^Use the suggested ones/);
    await settle(ctx);
    t.check('"Use the suggested ones" removes the pins for this kind', (await ctx.settings()).quickPins.incident === undefined, JSON.stringify((await ctx.settings()).quickPins));
    await clickButton(p, /^Done$/);
    await p.waitForFunction((n) => window.__vis(document.querySelectorAll('.ab-quick-actions button')).length === n, { timeout: 5000 }, WORKING.length);
    t.check('the suggestions are back', JSON.stringify(await barButtons(p)) === JSON.stringify(WORKING));

    // 6. A pin this record does not offer is not a button: the bar falls back to the suggestions rather than showing nothing.
    await ctx.configure({ quickPins: { incident: ['change-cab-brief', 'not-a-feature'] } });
    await settle(ctx, 700);
    t.check('a pin for an action this record does not have is not shown; the suggestions stand in', JSON.stringify(await barButtons(p)) === JSON.stringify(WORKING), JSON.stringify(await barButtons(p)));
    await ctx.configure({ quickPins: {} });

    // 7. "Skip AI for now": no AI item at all, the Insights item stays.
    await ctx.configure({ aiSkipped: true });
    await p.waitForFunction(() => window.__vis(document.querySelectorAll('.ab-quick-actions button')).length === 2, { timeout: 5000 }).catch(() => {});
    t.check('with AI skipped the bar holds only the Insights items, unmarked', JSON.stringify(await barButtons(p)) === JSON.stringify(['Related tickets', 'Ready to resolve?']) && (await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-quick-actions .ab-ai-badge')).length)) === 0, JSON.stringify(await barButtons(p)));
    await ctx.configure({ aiSkipped: false });

    t.check('no secret reached the page: the AI key is not in the panel text', !(await panel.text()).includes(ai.key));
    await openHalf(p, 'insights');
    await panel.close();
    await ticket.close();
  },
};

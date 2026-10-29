// x. The quick-actions bar at the top of a record in the side panel: the main actions are one click away, a click behaves exactly like
//    the same action in the full list (preview first, nothing sent before it is approved), the bar folds and remembers it, and the
//    person can choose which actions it holds.
const { clickButton, textOf, waitForRecord } = require('../ui.js');

const barButtons = (p) => p.evaluate(() => window.__vis(document.querySelectorAll('.ab-quick-actions button')).map((b) => b.innerText.trim()));
const toggleState = (p) => p.evaluate(() => window.__vis(document.querySelectorAll('.ab-quick-toggle'))[0]?.getAttribute('aria-expanded') ?? null);
const clickLabel = (p, text) =>
  p.evaluate((text) => {
    const label = window.__vis(document.querySelectorAll('.ab-quick-choose label')).find((l) => l.innerText.trim() === text);
    if (!label) return false;
    label.click();
    return true;
  }, text);
const choices = (p) =>
  p.evaluate(() => window.__vis(document.querySelectorAll('.ab-quick-choose label')).map((l) => ({ text: l.innerText.trim(), checked: l.querySelector('input').checked, disabled: l.querySelector('input').disabled })));
const settle = (ctx, ms = 400) => ctx.sleep(ms);

module.exports = {
  id: 'x',
  title: 'Quick-actions bar in the side panel: main actions, the same preview, fold, choose',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.ensureEnabled();
    await ctx.configure(
      { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', previewMode: 'always', previewSeen: [], instances: [inst.origin], quickBarOpen: true, quickPins: {}, pageBar: false },
      { key: { provider: 'custom', value: ai.key } }
    );

    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-quickbar');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForRecord(p);
    await p.waitForSelector('.ab-quick-actions button', { timeout: 10000 });

    // 1. What it holds, and that the full list is still all there.
    t.check('the bar is open and holds the three main actions of an incident', (await toggleState(p)) === 'true' && JSON.stringify(await barButtons(p)) === JSON.stringify(['Summarise', 'Draft a reply', 'Resolution notes']), JSON.stringify(await barButtons(p)));
    t.check('the first action is the highlighted one', await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-quick-actions button'))[0].className.includes('ab-btn-primary')));
    const shown = await panel.text();
    t.check('the full Actions list is still there, unchanged (the bar is a shortcut, nothing moved)', ['Summarise this ticket', 'Draft a reply to the customer', 'Write resolution notes', 'Hand-off brief', 'Major incident updates'].every((s) => shown.includes(s)));

    // 2. A click on a bar action is the same as the action in the list: the preview comes first and nothing is sent before it is approved.
    await clickButton(p, /^Summarise$/);
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    const head = await textOf(p, '.ab-dialog-head');
    t.check('the preview is shown for the action (named as in the list)', /Summarise this ticket/.test(head), head.replace(/\s+/g, ' '));
    t.check('nothing has been sent to the AI yet', ai.requests.length === 0, String(ai.requests.length));
    await clickButton(p, /^Send to AI/);
    await p.waitForSelector('.ab-output, .ab-note-danger', { timeout: 15000 });
    t.check('the answer appears, and exactly one request went out, only after approval', (await textOf(p, '.ab-output')) !== null && ai.requests.length === 1, String(ai.requests.length));
    const audit = await ctx.audit();
    t.check('the run is in the activity log under the same feature id as the list', audit.some((e) => e.feature === 'record-summary' && e.outcome === 'sent'), audit.map((e) => `${e.feature}:${e.outcome}`).join(', '));
    t.check('while an answer is on screen the bar\'s buttons are off (one answer at a time)', await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-quick-actions button')).every((b) => b.disabled)));
    await clickButton(p, /^Close$/);
    await p.waitForFunction(() => window.__vis(document.querySelectorAll('.ab-quick-actions button')).every((b) => !b.disabled), { timeout: 5000 });

    // 3. Fold and open again; the choice is kept.
    await clickButton(p, /^Quick actions$/);
    await p.waitForFunction(() => window.__vis(document.querySelectorAll('.ab-quick-toggle'))[0]?.getAttribute('aria-expanded') === 'false', { timeout: 5000 });
    t.check('folded: only the strip is left, no action buttons', (await barButtons(p)).length === 0);
    t.check('the choice is saved', (await ctx.settings()).quickBarOpen === false);
    t.check('folded, the full list still offers every action', (await panel.text()).includes('Summarise this ticket'));
    await clickButton(p, /^Quick actions$/);
    await p.waitForSelector('.ab-quick-actions button', { timeout: 5000 });
    t.check('opened again, saved as open', (await ctx.settings()).quickBarOpen === true && (await barButtons(p)).length === 3);

    // 4. Choose what the bar holds.
    await clickButton(p, /^Choose$/);
    await p.waitForSelector('.ab-quick-choose label', { timeout: 5000 });
    let list = await choices(p);
    t.check('Choose lists the incident\'s actions with the current ones ticked', list.length >= 8 && list.filter((c) => c.checked).map((c) => c.text).join('|') === 'Summarise|Draft a reply|Resolution notes', list.filter((c) => c.checked).map((c) => c.text).join('|'));
    t.check('a fourth action can be added', await clickLabel(p, 'Hand-off brief'));
    await settle(ctx);
    const afterAdd = (await ctx.settings()).quickPins;
    t.check('the pin is saved for the incident kind only, in the order chosen', JSON.stringify(afterAdd) === JSON.stringify({ incident: ['record-summary', 'reply-draft', 'resolution-notes', 'handoff-brief'] }), JSON.stringify(afterAdd));
    list = await choices(p);
    t.check('at four, every action that is not ticked is off (the limit)', list.filter((c) => !c.checked).every((c) => c.disabled) && list.filter((c) => c.checked).length === 4);
    await clickButton(p, /^Done$/);
    await p.waitForFunction(() => window.__vis(document.querySelectorAll('.ab-quick-actions button')).length === 4, { timeout: 5000 });
    t.check('the bar now shows the four, the new one last', JSON.stringify(await barButtons(p)) === JSON.stringify(['Summarise', 'Draft a reply', 'Resolution notes', 'Hand-off brief']), JSON.stringify(await barButtons(p)));

    // Taking one away, then going back to the suggestions.
    await clickButton(p, /^Choose$/);
    await p.waitForSelector('.ab-quick-choose label', { timeout: 5000 });
    await clickLabel(p, 'Draft a reply');
    await settle(ctx);
    t.check('an action can be taken away', JSON.stringify((await ctx.settings()).quickPins.incident) === JSON.stringify(['record-summary', 'resolution-notes', 'handoff-brief']), JSON.stringify((await ctx.settings()).quickPins));
    await clickButton(p, /^Use the suggested ones/);
    await settle(ctx);
    t.check('"Use the suggested ones" removes the pins for this kind', (await ctx.settings()).quickPins.incident === undefined, JSON.stringify((await ctx.settings()).quickPins));
    await clickButton(p, /^Done$/);
    await p.waitForFunction(() => window.__vis(document.querySelectorAll('.ab-quick-actions button')).length === 3, { timeout: 5000 });
    t.check('the suggestions are back', JSON.stringify(await barButtons(p)) === JSON.stringify(['Summarise', 'Draft a reply', 'Resolution notes']));

    // 5. A bar action the full list does not offer is not a button: pin one that does not exist for this kind straight into storage
    //    (what a hand-edited setting, or an action that was renamed in a later version, would leave behind).
    await ctx.configure({ quickPins: { incident: ['change-cab-brief', 'not-a-feature'] } });
    await settle(ctx, 700);
    t.check('a pin for an action this record does not have is not shown; the bar falls back to the suggestions rather than showing nothing', JSON.stringify(await barButtons(p)) === JSON.stringify(['Summarise', 'Draft a reply', 'Resolution notes']), JSON.stringify(await barButtons(p)));
    await ctx.configure({ quickPins: {} });

    t.check('no secret reached the page: the AI key is not in the panel text', !(await panel.text()).includes(ai.key));
    await panel.close();
    await ticket.close();
  },
};

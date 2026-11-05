// z. Pressing an action on the bar of the ServiceNow page: the service worker leaves a short request, the side panel picks it up,
//    shows the record's own preview first, and only then sends. A request that is old, for another ticket, or for an action the
//    record does not have starts nothing. Round 3: answers are kept per ticket, so a request that arrives while an answer is on
//    screen starts the action too (the earlier answer is folded, never replaced).
const { barDriver } = require('../barDriver.js');
const { clickButton, textOf, waitForRecord } = require('../ui.js');

const ARM_MS = 500; // src/content/barLogic.js: how long the actions must be on screen before a click counts
const LAUNCH = 'ab:launch';
const readLaunch = (ctx) => ctx.ext(async (k) => (await chrome.storage.session.get(k))[k] ?? null, LAUNCH);
const writeLaunch = (ctx, value) => ctx.ext((k, v) => chrome.storage.session.set({ [k]: v }), LAUNCH, value);
const dialogShown = (p) => p.evaluate(() => window.__vis(document.querySelectorAll('.ab-dialog')).length > 0);
/** Put every answer on screen away (round 3 keeps several answers per ticket). */
const closeAnswers = (p) => p.evaluate(() => window.__vis(document.querySelectorAll('.ab-answer-close')).forEach((b) => b.click()));

module.exports = {
  id: 'z',
  title: 'Bar on the page -> side panel: the action starts in the panel behind the same preview; stale, wrong-record and unknown requests do nothing',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.ensureEnabled();
    await ctx.configure(
      { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', previewMode: 'always', previewSeen: [], instances: [inst.origin], quickPins: {}, pageBar: true, profilesConfirmed: true },
      { key: { provider: 'custom', value: ai.key } }
    );
    await ctx.ext((k) => chrome.storage.session.remove(k), LAUNCH);

    const path = `/incident.do?sys_id=${data.INCIDENT_ID}`;
    const ticket = await ctx.openInstancePage(path, 'ticket-pagelaunch');
    await ticket.evaluate(() => localStorage.setItem('agentbuddy-bar', JSON.stringify({ open: true })));
    await ticket.reload({ waitUntil: 'load' });
    const bar = await barDriver(ticket);
    await ctx.waitUntil('the open bar', async () => (await bar.view()).open, { timeout: 12000 });
    const tabId = await ctx.ext(async (u) => (await chrome.tabs.query({})).find((x) => (x.url || '').includes(u))?.id, 'incident.do');

    // The panel the test drives (Chrome's own side panel cannot be driven by automation). It is open and showing this ticket, as a
    // person's panel would be; the browser may open a second, real one for the click, which is checked below.
    const panel = await ctx.openPanel();
    const p = panel.page;
    await p.evaluate(() => {
      window.__vis = (list) => [...list].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
    });
    await waitForRecord(p);

    // 1. Press "Summarise" with a real click. The service worker leaves the request in storage.session and asks the browser to open the
    //    side panel. (The request is watched from the control page, because a panel may take it at once.)
    await ctx.ext(() => {
      window.__launchLog = [];
      chrome.storage.onChanged.addListener((changes, area) => area === 'session' && changes['ab:launch'] && window.__launchLog.push({ set: changes['ab:launch'].newValue ?? null, gone: !changes['ab:launch'].newValue }));
    });
    const targetsBefore = new Set(ctx.browser.targets());
    const actionButton = (await bar.elements()).find((e) => e.tag === 'button' && e.text === 'Summarise');
    // A click counts only once the actions have been on screen for half a second (src/content/barLogic.js ARM_MS: a page cannot
    // show the bar just under a click meant for something else). A person is never that fast; this test can be, so it waits.
    await ctx.sleep(ARM_MS + 200);
    // A person hovers over an icon (its name shows) before pressing it. Chrome's visibility check looks again about 100 ms after anything
    // near an icon changes, so the pause matters: a name whose shadow reached the icon made it "covered" and the click was refused.
    await bar.hover(actionButton);
    await ctx.waitUntil('the name of the icon', async () => (await bar.view()).tipShown, { timeout: 4000 });
    await ctx.sleep(1500);
    await bar.click(actionButton);
    await ctx.waitUntil('the request for the panel', async () => (await ctx.ext(() => window.__launchLog)).some((x) => x.set), { timeout: 8000 });
    const left = (await ctx.ext(() => window.__launchLog)).find((x) => x.set).set;
    t.check('the click left one request: this tab, this record, this action, and nothing else', left && left.tabId === tabId && left.table === 'incident' && left.sysId === data.INCIDENT_ID && left.featureId === 'record-summary' && Object.keys(left).sort().join(',') === 'at,featureId,sysId,tabId,table', JSON.stringify(left));
    t.check('the request is fresh', Date.now() - left.at < 15000);
    t.check('a click after a hover (the name showing) is taken: the dock does not say something covered it', !/covering/.test((await bar.view()).noticeText), (await bar.view()).noticeText);
    t.check('nothing was sent to the AI by the bar or the service worker', ai.requests.length === 0, String(ai.requests.length));

    // 2. The browser opens the side panel for the click (the click's permission travels page -> service worker), and a panel takes the
    //    request up and starts the action behind the preview.
    const real = await ctx.browser.waitForTarget((x) => !targetsBefore.has(x) && x.url().endsWith('/sidepanel.html'), { timeout: 6000 }).catch(() => null);
    t.check('the browser opened a real side panel from the click on the page', Boolean(real));
    await p.waitForSelector('.ab-dialog', { timeout: 20000 });
    t.info(`the bar said afterwards: ${(await bar.view()).noticeText ? `"${(await bar.view()).noticeText}"` : 'nothing (it had opened the panel)'}`);
    const head = await textOf(p, '.ab-dialog-head');
    t.check('the panel started the action and shows the preview first', /Summarise this ticket/.test(head), head.replace(/\s+/g, ' '));
    t.check('still nothing has been sent: the preview waits for approval', ai.requests.length === 0, String(ai.requests.length));
    t.check('the request was used once: it is gone from storage', (await readLaunch(ctx)) === null);
    await clickButton(p, /^Send to AI/);
    await p.waitForSelector('.ab-output, .ab-note-danger', { timeout: 15000 });
    t.check('after approval one request went out and the answer is shown', ai.requests.length === 1 && (await textOf(p, '.ab-output')) !== null, String(ai.requests.length));
    const audit = await ctx.audit();
    t.check('the run is in the activity log like any other', audit.some((e) => e.feature === 'record-summary' && e.outcome === 'sent'));
    await closeAnswers(p);

    // 3. Requests that must start nothing.
    const base = { tabId, table: 'incident', sysId: data.INCIDENT_ID, featureId: 'record-summary' };
    const before = ai.requests.length;
    await writeLaunch(ctx, { ...base, at: Date.now() - 60000 });
    await ctx.sleep(1500);
    t.check('a request that is a minute old starts nothing', !(await dialogShown(p)) && ai.requests.length === before);
    await writeLaunch(ctx, { ...base, sysId: 'b'.repeat(32), at: Date.now() });
    await ctx.sleep(1500);
    t.check('a request for another ticket starts nothing', !(await dialogShown(p)) && ai.requests.length === before);
    await writeLaunch(ctx, { ...base, tabId: tabId + 1000, at: Date.now() });
    await ctx.sleep(1500);
    t.check('a request for another tab starts nothing', !(await dialogShown(p)) && ai.requests.length === before);
    await writeLaunch(ctx, { ...base, featureId: 'Not A Feature!', at: Date.now() });
    await ctx.sleep(1500);
    t.check('a request that is not well formed starts nothing', !(await dialogShown(p)) && ai.requests.length === before);
    await ctx.ext((k) => chrome.storage.session.remove(k), LAUNCH);

    // 4. An action this record does not have: the panel says so instead of running anything.
    await writeLaunch(ctx, { ...base, featureId: 'change-cab-brief', at: Date.now() });
    await p.waitForFunction(() => /not available for this record/.test(document.body.innerText), { timeout: 8000 });
    t.check('an action this kind of record does not have is refused in plain words, nothing runs', !(await dialogShown(p)) && ai.requests.length === before);
    t.check('and the request is used up', (await readLaunch(ctx)) === null);

    // 5. A good request while an answer is on screen starts the action; the answer is kept (folded), never replaced.
    await clickButton(p, /^Draft a reply to the customer/);
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    await clickButton(p, /^Send to AI/);
    await p.waitForSelector('.ab-output', { timeout: 15000 });
    const sentBefore = ai.requests.length;
    await writeLaunch(ctx, { ...base, at: Date.now() });
    await p.waitForSelector('.ab-dialog', { timeout: 8000 });
    const head5 = (await textOf(p, '.ab-dialog-head')) || '';
    t.check('a request that arrives while an answer is on screen starts the action behind its preview (nothing sent yet)', /Summarise this ticket/.test(head5) && ai.requests.length === sentBefore, head5.replace(/\s+/g, ' '));
    t.check('...and the earlier answer is kept, folded', /Earlier: Draft a reply/.test(await p.evaluate(() => document.body.innerText)));
    t.check('...and the request is used up', (await readLaunch(ctx)) === null);
    await clickButton(p, /^Cancel/).catch(() => {});

    await bar.close();
    await panel.close();
    // a real side panel cannot be closed from a test window; closing its page target is the nearest thing
    if (real) await (await ctx.browser.target().createCDPSession()).send('Target.closeTarget', { targetId: real._targetId }).catch(() => {});
    await ticket.close();
  },
};

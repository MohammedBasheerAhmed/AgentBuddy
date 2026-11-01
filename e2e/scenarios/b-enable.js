// b. Turning on an instance registers the content scripts, and the page state (which record is open) is found on a classic
//    form (through the page bridge), on a Workspace-style page without g_form (from the URL), and inside the classic frame. Then the
//    first run in the panel: "Turn on for this site" only where the page looks like ServiceNow.
//
// R4 (it timed out once under load): every step here used to open a NEW tab, and each new tab under load costs seconds (a target,
// a CDP session, a first paint), so the steps' own waits added up past the scenario's limit although none of them failed. The
// scenario now works in ONE tab and moves it with goto (which also tests the registered scripts on a fresh load, as before), waits
// for what it needs instead of fixed pauses, and reports how long each step took (E2E_TIMING=1 prints them as it goes).
const { clickButton, waitForText } = require('../ui.js');

module.exports = {
  id: 'b',
  title: 'Enable the instance: content scripts, record detection on classic and Workspace pages',
  async run(t, ctx) {
    const { inst, data } = ctx;
    const id = data.INCIDENT_ID;
    const classicPath = `/incident.do?sys_id=${id}`;
    const started = Date.now();
    let last = started;
    const times = [];
    const step = (name) => {
      const now = Date.now();
      times.push(`${name} ${((now - last) / 1000).toFixed(1)}s`);
      if (process.env.E2E_TIMING === '1') console.log(`        [b] ${name}: ${((now - last) / 1000).toFixed(1)}s`);
      last = now;
    };

    // The tab's page state, asked the way the side panel asks: chrome.tabs.sendMessage from an extension page.
    const pageState = (needle) =>
      ctx.ext(async (needle) => {
        // needle null = the active tab (its URL may be hidden from the extension on an origin it has no access to)
        const tab = needle === null ? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] : (await chrome.tabs.query({})).find((x) => (x.url || '').includes(needle));
        if (!tab) return { noTab: true };
        try {
          return await chrome.tabs.sendMessage(tab.id, { type: 'ab:page-state' });
        } catch (err) {
          return { sendError: String(err.message || err) };
        }
      }, needle);
    const answers = (needle, what, test = (s) => s.record, timeout = 10000) => ctx.waitUntil(what, async () => test(await pageState(needle)), { timeout });

    // 1. Before the instance is enabled nothing is injected.
    const tab = await ctx.openInstancePage(classicPath, 'ticket-b');
    const before = await pageState(classicPath);
    t.check('before enabling: no content script answers on the instance tab', Boolean(before.sendError), before.sendError || JSON.stringify(before));
    t.check('before enabling: nothing registered', (await ctx.ext(() => chrome.scripting.getRegisteredContentScripts())).length === 0);
    step('1 page before enabling');

    // 2. Enable (from the options page context, as the Settings page does after the permission is granted).
    const enabled = await ctx.ext((origin) => chrome.runtime.sendMessage({ type: 'ab:enable-instance', origin }), inst.origin);
    t.check('ENABLE_INSTANCE answers with the instance', JSON.stringify(enabled?.instances) === JSON.stringify([inst.origin]), JSON.stringify(enabled));

    const scripts = await ctx.ext(() => chrome.scripting.getRegisteredContentScripts());
    const bridge = scripts.find((s) => s.id === 'ab-bridge');
    const content = scripts.find((s) => s.id === 'ab-content');
    t.check('page bridge registered: MAIN world, document_start, this instance only', bridge?.world === 'MAIN' && bridge.runAt === 'document_start' && JSON.stringify(bridge.matches) === JSON.stringify([`${inst.origin}/*`]), JSON.stringify(bridge));
    t.check('content script registered: ISOLATED world, document_idle, this instance only', content?.world === 'ISOLATED' && content.runAt === 'document_idle' && JSON.stringify(content.matches) === JSON.stringify([`${inst.origin}/*`]) && content.allFrames === false, JSON.stringify(content));
    t.check('exactly two scripts registered, no all-sites match', scripts.length === 2 && scripts.every((s) => s.matches.every((m) => m === `${inst.origin}/*`)));
    step('2 enable');

    // 3. The tab that was already open is injected without a reload.
    await answers(classicPath, 'the already-open tab to answer');
    const injected = await pageState(classicPath);
    t.check('already-open tab answers PAGE_STATE without a reload', injected.record?.table === 'incident', JSON.stringify(injected.record));
    step('3 already-open tab injected');

    // 4. Classic form, freshly loaded (the registered scripts, not the injection): the record comes from g_form.
    await tab.goto(`${inst.origin}${classicPath}`, { waitUntil: 'load' });
    await answers(classicPath, 'the classic page to answer');
    const state = await pageState(classicPath);
    t.check('classic form: record detected from g_form', JSON.stringify(state.record) === JSON.stringify({ table: 'incident', sysId: id, number: data.INCIDENT_NUMBER, kind: 'incident' }), JSON.stringify(state.record));
    t.check('classic form: user is the fake agent, roles ["itil"], no admin', state.user?.name === 'Beth Anglin' && JSON.stringify(state.user.roles) === '["itil"]' && state.user.userId === data.ME.sysId, JSON.stringify(state.user));
    t.check('classic form: title and href reported', /INC0010001/.test(state.title) && state.href.endsWith(classicPath));
    t.check('classic form has the fake g_form and g_ck', await tab.evaluate(() => typeof window.g_form?.setValue === 'function' && typeof window.g_ck === 'string'));
    t.check('page CSP is in force (no inline script needed)', await tab.evaluate(() => !document.querySelector('script:not([src]):not([type])')));
    step('4 classic form');

    // 5. Workspace-style page: no g_form at all, so the record comes from the URL.
    await tab.goto(`${inst.origin}/now/sow/record/incident/${id}`, { waitUntil: 'load' });
    t.check('workspace page has NO g_form', await tab.evaluate(() => typeof window.g_form === 'undefined'));
    await answers('/now/sow/record/incident/', 'the workspace page to answer');
    const wsState = (await pageState('/now/sow/record/incident/')).record;
    t.check('workspace: record found from the URL (table, sys_id, kind)', wsState.table === 'incident' && wsState.sysId === id && wsState.kind === 'incident', JSON.stringify(wsState));
    step('5 workspace');

    // 6. Classic UI frame (nav_to.do + gsft_main iframe): the form lives in the frame, the content script in the top window.
    await tab.goto(`${inst.origin}/nav_to.do?uri=${encodeURIComponent(classicPath)}`, { waitUntil: 'load' });
    await answers('/nav_to.do', 'the framed page to answer');
    const framedState = (await pageState('/nav_to.do')).record;
    t.check('classic frame (gsft_main): record detected', framedState.table === 'incident' && framedState.sysId === id && framedState.number === data.INCIDENT_NUMBER, JSON.stringify(framedState));
    step('6 classic frame');

    // 7. A page that is not a record.
    await tab.goto(`${inst.origin}/home`, { waitUntil: 'load' });
    await answers('/home', 'the home page to answer', (s) => s.href);
    const homeState = await pageState('/home');
    t.check('home page: answers, but no record', homeState.record === null && homeState.user?.name === 'Beth Anglin', JSON.stringify(homeState.record));
    step('7 home');

    // 8. An origin that was NOT enabled gets no content script (same server, different host name).
    await tab.goto(`https://127.0.0.1:${inst.port}${classicPath}`, { waitUntil: 'load' });
    await tab.bringToFront();
    const otherState = await ctx.waitUntil('the other origin to be the active tab', async () => {
      const s = await pageState(null);
      return s.sendError ? s : null;
    }, { timeout: 5000 }).catch(() => pageState(null));
    t.check('a different origin (127.0.0.1) that was not enabled gets no content script', Boolean(otherState.sendError), otherState.sendError || JSON.stringify(otherState));
    step('8 other origin');

    // 9. Turning the instance off removes the scripts.
    await ctx.ext((origin) => chrome.runtime.sendMessage({ type: 'ab:disable-instance', origin }), inst.origin);
    t.check('DISABLE_INSTANCE unregisters the scripts', (await ctx.ext(() => chrome.scripting.getRegisteredContentScripts())).length === 0);
    t.check('DISABLE_INSTANCE removes the instance from the settings', (await ctx.settings()).instances.length === 0);
    step('9 disable');

    // 10. The panel on a page of the site that does NOT look like ServiceNow (no g_ck, no ServiceNow scripts: a plain text file the
    //     server has, so no 404 lands in the run's error log): it says so, keeps only a small "Turn on anyway", and pushes nothing.
    //     (The browser's own permission prompt is skipped: the patched copy holds it.)
    await tab.goto(`${inst.origin}/scripts/session.js`, { waitUntil: 'load' });
    await tab.bringToFront();
    const panel = await ctx.openPanel();
    await waitForText(panel.page, 'This does not look like ServiceNow', { timeout: 15000 });
    const notSn = await panel.text();
    t.check('a page that is not ServiceNow: "This does not look like ServiceNow", a small "Turn on anyway", no "Turn on for this site"', /Turn on anyway/.test(notSn) && !/Turn on for this site/.test(notSn), notSn.replace(/\s+/g, ' ').slice(0, 200));
    t.check('...and no filled (primary) button pushes the person to turn on this page', (await panel.page.evaluate(() => window.__vis(document.querySelectorAll('.ab-btn-primary')).length)) === 0);
    step('10 not ServiceNow');

    // 11. The ticket page: one "Getting started" card whose first step turns the site on; the click (a real user gesture) enables it.
    await tab.goto(`${inst.origin}${classicPath}`, { waitUntil: 'load' });
    await tab.bringToFront();
    await waitForText(panel.page, 'Turn on for this site', { timeout: 15000 });
    const setup = await panel.text();
    t.check('panel on a ServiceNow page that is not turned on: "Getting started", step 1 of the card, naming the instance address', /Getting started/.test(setup) && /Step 1 of/.test(setup) && setup.includes(`localhost:${inst.port}`), setup.replace(/\s+/g, ' ').slice(0, 200));
    t.check('one card: no separate "Not turned on" or "Add an AI key" card repeats it', !/Not turned on for this page/.test(setup) && !/Add an AI key/.test(setup));
    await clickButton(panel.page, /^Turn on for this site/);
    await waitForText(panel.page, data.INCIDENT_NUMBER, { timeout: 20000 });
    t.check('"Turn on for this site" registers the scripts and the open ticket is then recognised without a reload', (await ctx.ext(() => chrome.scripting.getRegisteredContentScripts())).length === 2);
    const settings = await ctx.settings();
    t.check('settings.instances holds exactly the instance', JSON.stringify(settings.instances) === JSON.stringify([inst.origin]), JSON.stringify(settings.instances));
    step('11 turn on from the panel');
    // The Ticket screen now reads for the record (its cards): let those reads finish before the tab goes, so the run's own request log
    // (scenario e compares the browser's log with the instance's) sees every one of them.
    await tab.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => {});
    await panel.close();
    await tab.close();
    t.info(`step times (${((Date.now() - started) / 1000).toFixed(1)}s in all): ${times.join(', ')}`);
  },
};

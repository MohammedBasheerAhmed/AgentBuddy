// b. Turning on an instance registers the content scripts, and the page state (which record is open) is found on a classic
//    form (through the page bridge), on a Workspace-style page without g_form (from the URL), and inside the classic frame.
const { clickButton, waitForText } = require('../ui.js');

module.exports = {
  id: 'b',
  title: 'Enable the instance: content scripts, record detection on classic and Workspace pages',
  async run(t, ctx) {
    const { inst, data } = ctx;
    const id = data.INCIDENT_ID;
    const classicPath = `/incident.do?sys_id=${id}`;

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

    // 1. Before the instance is enabled nothing is injected.
    const early = await ctx.openInstancePage(classicPath, 'ticket-early');
    await ctx.sleep(500);
    const before = await pageState(classicPath);
    t.check('before enabling: no content script answers on the instance tab', Boolean(before.sendError), before.sendError || JSON.stringify(before));
    t.check('before enabling: nothing registered', (await ctx.ext(() => chrome.scripting.getRegisteredContentScripts())).length === 0);

    // 2. Enable (from the options page context, as the Settings page does after the permission is granted).
    const enabled = await ctx.ext((origin) => chrome.runtime.sendMessage({ type: 'ab:enable-instance', origin }), inst.origin);
    t.check('ENABLE_INSTANCE answers with the instance', JSON.stringify(enabled?.instances) === JSON.stringify([inst.origin]), JSON.stringify(enabled));

    const scripts = await ctx.ext(() => chrome.scripting.getRegisteredContentScripts());
    const bridge = scripts.find((s) => s.id === 'ab-bridge');
    const content = scripts.find((s) => s.id === 'ab-content');
    t.check('page bridge registered: MAIN world, document_start, this instance only', bridge?.world === 'MAIN' && bridge.runAt === 'document_start' && JSON.stringify(bridge.matches) === JSON.stringify([`${inst.origin}/*`]), JSON.stringify(bridge));
    t.check('content script registered: ISOLATED world, document_idle, this instance only', content?.world === 'ISOLATED' && content.runAt === 'document_idle' && JSON.stringify(content.matches) === JSON.stringify([`${inst.origin}/*`]) && content.allFrames === false, JSON.stringify(content));
    t.check('exactly two scripts registered, no all-sites match', scripts.length === 2 && scripts.every((s) => s.matches.every((m) => m === `${inst.origin}/*`)));

    // 3. The tab that was already open is injected without a reload.
    await ctx.waitUntil('the already-open tab to answer', async () => (await pageState(classicPath)).record, { timeout: 8000 });
    const injected = await pageState(classicPath);
    t.check('already-open tab answers PAGE_STATE without a reload', injected.record?.table === 'incident', JSON.stringify(injected.record));
    await early.close();

    // 4. Classic form: the record comes from g_form (table, sys_id, number).
    const classic = await ctx.openInstancePage(classicPath, 'ticket-classic');
    await ctx.waitUntil('the classic page to answer', async () => (await pageState(classicPath)).record, { timeout: 10000 });
    const state = await pageState(classicPath);
    t.check('classic form: record detected from g_form', JSON.stringify(state.record) === JSON.stringify({ table: 'incident', sysId: id, number: data.INCIDENT_NUMBER, kind: 'incident' }), JSON.stringify(state.record));
    t.check('classic form: user is the fake agent, roles ["itil"], no admin', state.user?.name === 'Beth Anglin' && JSON.stringify(state.user.roles) === '["itil"]' && state.user.userId === data.ME.sysId, JSON.stringify(state.user));
    t.check('classic form: title and href reported', /INC0010001/.test(state.title) && state.href.endsWith(classicPath));
    t.check('classic form has the fake g_form and g_ck', await classic.evaluate(() => typeof window.g_form?.setValue === 'function' && typeof window.g_ck === 'string'));
    t.check('page CSP is in force (no inline script needed)', await classic.evaluate(() => !document.querySelector('script:not([src]):not([type])')));

    // 5. Workspace-style page: no g_form at all, so the record comes from the URL.
    const ws = await ctx.openInstancePage(`/now/sow/record/incident/${id}`, 'ticket-workspace');
    t.check('workspace page has NO g_form', await ws.evaluate(() => typeof window.g_form === 'undefined'));
    await ctx.waitUntil('the workspace page to answer', async () => (await pageState('/now/sow/record/incident/')).record, { timeout: 10000 });
    const wsState = (await pageState('/now/sow/record/incident/')).record;
    t.check('workspace: record found from the URL (table, sys_id, kind)', wsState.table === 'incident' && wsState.sysId === id && wsState.kind === 'incident', JSON.stringify(wsState));
    await ws.close();

    // 6. Classic UI frame (nav_to.do + gsft_main iframe): the form lives in the frame, the content script in the top window.
    const framed = await ctx.openInstancePage(`/nav_to.do?uri=${encodeURIComponent(classicPath)}`, 'ticket-framed');
    await ctx.waitUntil('the framed page to answer', async () => (await pageState('/nav_to.do')).record, { timeout: 10000 });
    const framedState = (await pageState('/nav_to.do')).record;
    t.check('classic frame (gsft_main): record detected', framedState.table === 'incident' && framedState.sysId === id && framedState.number === data.INCIDENT_NUMBER, JSON.stringify(framedState));
    await framed.close();

    // 7. A page that is not a record.
    const home = await ctx.openInstancePage('/home', 'home');
    await ctx.waitUntil('the home page to answer', async () => (await pageState('/home')).href, { timeout: 10000 });
    const homeState = await pageState('/home');
    t.check('home page: answers, but no record', homeState.record === null && homeState.user?.name === 'Beth Anglin', JSON.stringify(homeState.record));
    await home.close();

    // 8. An origin that was NOT enabled gets no content script (same server, different host name).
    const other = await ctx.newPage('other-origin');
    await other.goto(`https://127.0.0.1:${inst.port}${classicPath}`, { waitUntil: 'load' });
    await other.bringToFront();
    await ctx.sleep(800);
    const otherState = await pageState(null);
    t.check('a different origin (127.0.0.1) that was not enabled gets no content script', Boolean(otherState.sendError), otherState.sendError || JSON.stringify(otherState));
    await other.close();

    // 9. Turning the instance off removes the scripts.
    await ctx.ext((origin) => chrome.runtime.sendMessage({ type: 'ab:disable-instance', origin }), inst.origin);
    t.check('DISABLE_INSTANCE unregisters the scripts', (await ctx.ext(() => chrome.scripting.getRegisteredContentScripts())).length === 0);
    t.check('DISABLE_INSTANCE removes the instance from the settings', (await ctx.settings()).instances.length === 0);
    await classic.close();

    // 10. The panel on a page that is not turned on offers "Turn on for this site"; the click (a real user gesture) enables it.
    //     (The browser's own permission prompt is skipped here: the patched copy already holds the localhost permission.)
    const fresh = await ctx.openInstancePage(classicPath, 'ticket-fresh');
    const panel = await ctx.openPanel();
    await waitForText(panel.page, 'Not turned on for this page', { timeout: 15000 });
    const setup = await panel.text();
    t.check('panel on a page that is not turned on: says so and names the instance address', setup.includes(`localhost:${inst.port}`) && /Turn on for this site/.test(setup), setup.replace(/\s+/g, ' ').slice(0, 160));
    await clickButton(panel.page, /^Turn on for this site/);
    await waitForText(panel.page, data.INCIDENT_NUMBER, { timeout: 20000 });
    t.check('"Turn on for this site" registers the scripts and the open ticket is then recognised without a reload', (await ctx.ext(() => chrome.scripting.getRegisteredContentScripts())).length === 2 && /Summarise this ticket|Add an AI key/.test(await panel.text()));
    const settings = await ctx.settings();
    t.check('settings.instances holds exactly the instance', JSON.stringify(settings.instances) === JSON.stringify([inst.origin]), JSON.stringify(settings.instances));
    await panel.close();
    await fresh.close();
  },
};

// m. The panel's screens (round 3: Ticket, My work, Team, Write, Knowledge): each one loads in the real side panel, on a record page
//    and on a page that is not a record, with no console error, page error or CSP violation; the work profiles decide which screens
//    show; the screens with AI have the Insights / AI Assist switch and nothing AI-marked under Insights; the chosen screen is
//    remembered when the panel is reloaded; a tab that is not a ServiceNow page leaves the screen bar and what was typed in place (a
//    one-line banner says so, and the Ticket screen shows the setup help); only when there is no ServiceNow tab at all is the setup help
//    all there is, and a draft typed in Write > AI Assist > Rewrite is still there when a ServiceNow tab comes back.
const waitPanelGone = (page, text) => page.waitForFunction((x) => !document.body.innerText.includes(x), { timeout: 15000 }, text);
const { prepare, errorMark, errorsSince, describeErrors, tabsOf, loadingElements, panelShows, waitForText, clickButton } = require('../common.js');
const { openScreen, openHalf } = require('../ui.js');

const SCREENS = ['Ticket', 'My work', 'Team', 'Write', 'Knowledge'];
const NAV = 'Agent Buddy screens';

// Visible elements carrying the AI mark inside the half that is on show (Insights must have none).
const aiMarksInInsights = (p) =>
  p.evaluate(() => {
    const shown = (e) => e.getClientRects().length > 0;
    const panel = [...document.querySelectorAll('[role=tabpanel][id$="-half-panel-insights"]')].find(shown);
    return panel ? [...panel.querySelectorAll('.ab-ai-badge')].filter(shown).length : -1;
  });

module.exports = {
  id: 'm',
  title: 'Panel screens: all load without errors, profiles decide them, Insights carries no AI mark, the choice is remembered, a tab that is not ServiceNow keeps the screens and the typed text, the setup help shows where it belongs',
  async run(t, ctx) {
    const { inst, data } = ctx;
    await prepare(ctx);
    await ctx.configure({ profiles: ['it'], profilesConfirmed: true, halves: {} });
    const mark = errorMark(ctx);

    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-classic');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await panelShows(panel, data.INCIDENT_NUMBER);

    // ---- 1. Profiles decide the screens ------------------------------------------------------------------------------------
    let nav = await tabsOf(p, NAV);
    t.check('IT profile: Ticket, My work, Write, Knowledge (no Team); Ticket first and selected', JSON.stringify(nav?.labels) === JSON.stringify(['Ticket', 'My work', 'Write', 'Knowledge']) && JSON.stringify(nav.selected) === '["Ticket"]', JSON.stringify(nav));
    await ctx.configure({ profiles: ['it', 'lead', 'km'] });
    await ctx.waitUntil('the Team screen to appear', async () => (await tabsOf(p, NAV))?.labels?.includes('Team'), { timeout: 10000 });
    nav = await tabsOf(p, NAV);
    t.check('with the team-lead profile the Team screen appears, in its place', JSON.stringify(nav?.labels) === JSON.stringify(SCREENS), JSON.stringify(nav));

    // ---- 2. The Ticket screen: the halves ----------------------------------------------------------------------------------
    await openHalf(p, 'insights');
    await waitForText(p, 'Related tickets', { timeout: 15000 });
    t.check('Ticket > Insights shows its cards and says nothing leaves ServiceNow', /Stays in ServiceNow\. Nothing is sent anywhere\./.test(await panel.text()));
    t.check('Ticket > Insights: no AI mark anywhere in the half', (await aiMarksInInsights(p)) === 0, String(await aiMarksInInsights(p)));
    await openHalf(p, 'assist');
    await waitForText(p, /Summarise this ticket/, { timeout: 15000 });
    t.check('Ticket > AI Assist names where masked text goes and offers the actions', /Masked text goes to/.test(await panel.text()));

    // What each other screen shows once it has loaded (a text only that screen has).
    const expect = {
      'My work': () => waitForText(p, /My queue/, { timeout: 20000 }),
      Team: () => waitForText(p, /Overview|Workload|Open|Quality/, { timeout: 20000 }),
      Write: () => waitForText(p, /Snippets|Safe-to-send check/, { timeout: 20000 }),
      Knowledge: () => waitForText(p, /Knowledge search/, { timeout: 15000 }),
    };
    for (const name of SCREENS.slice(1)) {
      await openScreen(p, name);
      try {
        await expect[name]();
      } catch (err) {
        t.check(`screen "${name}" loads on a record page`, false, String(err.message).slice(0, 120));
        continue;
      }
      const state = await tabsOf(p, NAV);
      t.check(`screen "${name}" loads on a record page and is the selected one`, JSON.stringify(state.selected) === JSON.stringify([name]), JSON.stringify(state.selected));
      t.check(`screen "${name}": no error banner`, (await p.$('.ab-note-danger')) === null);
      if (name !== 'My work') t.check(`screen "${name}": no AI mark under Insights`, (await aiMarksInInsights(p)) <= 0);
    }
    t.check('no AI request was made just by looking at the screens', ctx.ai.requests.length === 0);
    t.check('nothing in the panel loads or runs (no image, link, frame or inline script)', (await loadingElements(p)) === 0);

    // ---- 3. The choice is remembered across a reload of the panel ------------------------------------------------------------
    await openScreen(p, 'Knowledge');
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('.ab-app', { timeout: 10000 });
    await waitForText(p, /Knowledge search/, { timeout: 20000 });
    const remembered = await tabsOf(p, NAV);
    t.check('after the panel is reloaded the Knowledge screen is still the selected one', JSON.stringify(remembered?.selected) === '["Knowledge"]', JSON.stringify(remembered));
    await openScreen(p, 'Ticket');
    await waitForText(p, data.INCIDENT_NUMBER, { timeout: 10000 });

    // ---- 4. A page that is not a record: every screen still works ---------------------------------------------------------------
    const home = await ctx.openInstancePage('/home', 'home');
    await waitForText(p, 'Open a ticket', { timeout: 15000 });
    t.check('on a page that is not a record the Ticket screen explains how to open one', /Open a ticket/.test(await panel.text()));
    for (const name of ['Write', 'Team', 'Knowledge', 'My work']) {
      await openScreen(p, name);
      await expect[name]();
    }
    t.check('all screens also loaded on a page that is not a record', (await p.$('.ab-note-danger')) === null);

    // ---- 5. A tab that is not a ServiceNow page: the screens and what was typed stay ----------------------------------------------
    const DRAFT = 'A draft that must survive a look at another tab';
    await openScreen(p, 'Write');
    await openHalf(p, 'assist');
    await p.waitForSelector('#ab-rewrite-text', { visible: true, timeout: 10000 });
    await p.click('#ab-rewrite-text');
    await p.type('#ab-rewrite-text', DRAFT, { delay: 0 });
    const draftNow = () => p.$eval('#ab-rewrite-text', (el) => el.value);

    //  (a) an address the browser gave the extension no access to (so even the address is hidden): "not a ServiceNow page"
    const other = await ctx.newPage('other-origin');
    await other.goto(`https://127.0.0.1:${inst.port}/home`, { waitUntil: 'load' });
    await other.bringToFront();
    await waitForText(p, 'This tab is not a ServiceNow page. Agent Buddy keeps working with your last ServiceNow tab.', { timeout: 20000 });
    const stay = await tabsOf(p, NAV);
    t.check('a tab that is not a ServiceNow page: the banner says so, the screen bar stays and Write stays selected', JSON.stringify(stay?.labels) === JSON.stringify(SCREENS) && JSON.stringify(stay.selected) === '["Write"]', JSON.stringify(stay));
    t.check('...and the text typed in Write > Rewrite is still there (nothing was thrown away)', (await draftNow()) === DRAFT, await draftNow());
    await openScreen(p, 'Ticket');
    await waitForText(p, /Not turned on for this page|Open your ServiceNow instance/, { timeout: 15000 });
    const setup = await panel.text();
    t.check('the Ticket screen shows the setup help for that tab, and no actions', /Open your ServiceNow instance/.test(setup) && (await p.$('[data-feature]')) === null, setup.replace(/\s+/g, ' ').slice(0, 160));
    await openScreen(p, 'Write');
    t.check('back in Write the draft is still there', (await draftNow()) === DRAFT);
    await home.bringToFront();
    await waitPanelGone(p, 'This tab is not a ServiceNow page');
    t.check('back on the ServiceNow tab the banner is gone and the draft is still there', !(await panel.text()).includes('This tab is not a ServiceNow page') && (await draftNow()) === DRAFT);
    await other.close();

    //  (b) the instance is turned OFF and no ServiceNow tab is left: the setup help is all there is, and nothing typed is lost
    await home.close();
    await ticket.close();
    await ctx.ext((origin) => chrome.runtime.sendMessage({ type: 'ab:disable-instance', origin }), inst.origin);
    const off = await ctx.openInstancePage('/home', 'home-off');
    await waitForText(p, /Turn on for this site/, { timeout: 20000 });
    const offText = await panel.text();
    t.check('an instance that is turned off: the help offers "Turn on for this site"', /Turn on for this site/.test(offText), offText.replace(/\s+/g, ' ').slice(0, 160));
    t.check('...with no ServiceNow tab left to work with there is no screen bar', (await tabsOf(p, NAV)) === null);

    // ---- 6. Turning it on again brings the screens back, on the one chosen last, with the draft ----------------------------------------
    await clickButton(p, /^Turn on for this site/);
    await ctx.waitUntil('the screen bar to come back', async () => (await tabsOf(p, NAV)) !== null, { timeout: 25000 });
    const back = await tabsOf(p, NAV);
    t.check('after "Turn on for this site" the screen bar is back, on the screen chosen last (Write)', JSON.stringify(back?.selected) === '["Write"]', JSON.stringify(back));
    await p.waitForSelector('#ab-rewrite-text', { visible: true, timeout: 10000 });
    t.check('...and the draft typed before the site was turned off is still in the Rewrite box', (await draftNow()) === DRAFT, await draftNow());
    await openScreen(p, 'Ticket');
    await off.close();
    await ctx.ensureEnabled();

    const bad = errorsSince(ctx, mark);
    t.check('no console error, page error or CSP violation while the screens were used', bad.length === 0, describeErrors(bad));
    t.check('no CSP violation event in the panel', (await p.evaluate(() => window.__cspViolations || [])).length === 0);

    await panel.close();
  },
};

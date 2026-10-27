// m. The panel's five sections (This page, My day, Team, Write, Knowledge): each one loads in the real side panel, on a record page
//    and on a page that is not a record, with no console error, page error or CSP violation; the chosen section is remembered when
//    the panel is reloaded; a tab that is not a ServiceNow page leaves the section bar and what was typed in place (a one-line banner
//    says so, and "This page" shows the setup help); only when there is no ServiceNow tab at all is the setup help all there is, and a
//    draft typed in Write > Rewrite is still there when a ServiceNow tab comes back.
const waitPanelGone = (page, text) => page.waitForFunction((x) => !document.body.innerText.includes(x), { timeout: 15000 }, text);
const { prepare, errorMark, errorsSince, describeErrors, clickTab, tabsOf, loadingElements, panelShows, waitForText, clickButton } = require('../common.js');

const SECTIONS = ['This page', 'My day', 'Team', 'Write', 'Knowledge'];

module.exports = {
  id: 'm',
  title: 'Panel sections: all five load without errors, the choice is remembered, a tab that is not ServiceNow keeps the sections and the typed text, the setup help shows where it belongs',
  async run(t, ctx) {
    const { inst, data } = ctx;
    await prepare(ctx);
    const mark = errorMark(ctx);

    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-classic');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await panelShows(panel, data.INCIDENT_NUMBER);

    // ---- 1. On a record page ---------------------------------------------------------------------------------------------
    const nav = await tabsOf(p, 'Agent Buddy sections');
    t.check('the section bar lists exactly the five sections, "This page" first and selected', JSON.stringify(nav?.labels) === JSON.stringify(SECTIONS) && JSON.stringify(nav.selected) === '["This page"]', JSON.stringify(nav));
    t.check('"This page" shows the record and its actions', (await panel.text()).includes('Summarise this ticket'));

    // What each section shows once it has loaded (a text only that section has).
    const expect = {
      'My day': async () => waitForText(p, 'INC0010100', { timeout: 15000 }),
      Team: async () => waitForText(p, /Overview|Workload|Open tickets|Quality/, { timeout: 20000 }),
      Write: async () => waitForText(p, /Which email fits\?/, { timeout: 20000 }),
      Knowledge: async () => waitForText(p, 'Find near-duplicate articles', { timeout: 15000 }),
    };
    for (const name of SECTIONS.slice(1)) {
      await clickTab(p, name);
      let shown = '';
      try {
        shown = await expect[name]();
      } catch (err) {
        shown = '';
        t.check(`section "${name}" loads on a record page`, false, String(err.message).slice(0, 120));
        continue;
      }
      const state = await tabsOf(p, 'Agent Buddy sections');
      t.check(`section "${name}" loads on a record page and is the selected one`, JSON.stringify(state.selected) === JSON.stringify([name]), JSON.stringify(state.selected));
      t.check(`section "${name}": no error banner`, (await p.$('.ab-note-danger')) === null, shown.replace(/\s+/g, ' ').slice(0, 100));
    }
    t.check('no AI request was made just by looking at the sections', ctx.ai.requests.length === 0);
    t.check('nothing in the panel loads or runs (no image, link, frame or inline script)', (await loadingElements(p)) === 0);

    // ---- 2. The choice is remembered across a reload of the panel ------------------------------------------------------------
    await clickTab(p, 'Knowledge');
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('.ab-app', { timeout: 10000 });
    await waitForText(p, 'Find near-duplicate articles', { timeout: 20000 });
    const remembered = await tabsOf(p, 'Agent Buddy sections');
    t.check('after the panel is reloaded the Knowledge section is still the selected one', JSON.stringify(remembered?.selected) === '["Knowledge"]', JSON.stringify(remembered));
    await clickTab(p, 'This page');
    await waitForText(p, 'Summarise this ticket', { timeout: 10000 });

    // ---- 3. A page that is not a record: every section still works ---------------------------------------------------------------
    const home = await ctx.openInstancePage('/home', 'home');
    await waitForText(p, 'Open a ticket', { timeout: 15000 });
    t.check('on a page that is not a record "This page" explains how to open one', /Open a ticket/.test(await panel.text()));
    await clickTab(p, 'Write');
    await waitForText(p, /Open a ticket \(an incident, request, case or similar\) to get email suggestions/, { timeout: 15000 });
    t.check('Write on a non-record page: the Email tab asks for a ticket, the other tools still work', /Rewrite/.test(await panel.text()));
    await clickTab(p, 'Team');
    await waitForText(p, /Overview|Workload|Open tickets|Quality/, { timeout: 20000 });
    await clickTab(p, 'Knowledge');
    await waitForText(p, 'Find near-duplicate articles', { timeout: 15000 });
    await clickTab(p, 'My day');
    await waitForText(p, 'INC0010100', { timeout: 15000 });
    t.check('all sections also loaded on a page that is not a record', (await p.$('.ab-note-danger')) === null);

    // ---- 4. A tab that is not a ServiceNow page: the sections and what was typed stay ----------------------------------------------
    const DRAFT = 'A draft that must survive a look at another tab';
    await clickTab(p, 'Write');
    await clickTab(p, 'Rewrite');
    await p.waitForSelector('#ab-rewrite-text', { visible: true, timeout: 10000 });
    await p.click('#ab-rewrite-text');
    await p.type('#ab-rewrite-text', DRAFT, { delay: 0 });
    const draftNow = () => p.$eval('#ab-rewrite-text', (el) => el.value);

    //  (a) an address the browser gave the extension no access to (so even the address is hidden): "not a ServiceNow page"
    const other = await ctx.newPage('other-origin');
    await other.goto(`https://127.0.0.1:${inst.port}/home`, { waitUntil: 'load' });
    await other.bringToFront();
    await waitForText(p, 'This tab is not a ServiceNow page. Agent Buddy keeps working with your last ServiceNow tab.', { timeout: 20000 });
    const stay = await tabsOf(p, 'Agent Buddy sections');
    t.check('a tab that is not a ServiceNow page: the banner says so, the section bar stays and Write stays selected', JSON.stringify(stay?.labels) === JSON.stringify(SECTIONS) && JSON.stringify(stay.selected) === '["Write"]', JSON.stringify(stay));
    t.check('...and the text typed in Write > Rewrite is still there (nothing was thrown away)', (await draftNow()) === DRAFT, await draftNow());
    await clickTab(p, 'This page');
    await waitForText(p, 'Not turned on for this page', { timeout: 15000 });
    let setup = await panel.text();
    t.check('"This page" shows the setup help for that tab (no address to turn on: open the instance first), and no actions list', /Open your ServiceNow instance in this tab/.test(setup) && (await p.$('.ab-features')) === null && !/Turn on for this site/.test(setup), setup.replace(/\s+/g, ' ').slice(0, 160));
    await clickTab(p, 'Write');
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
    await waitForText(p, 'Not turned on for this page', { timeout: 20000 });
    setup = await panel.text();
    t.check('an instance that is turned off: the help names the address and offers "Turn on for this site"', setup.includes(`localhost:${inst.port}`) && /Turn on for this site/.test(setup), setup.replace(/\s+/g, ' ').slice(0, 160));
    t.check('...with no ServiceNow tab left to work with there is no section bar, and no section shows its content', (await tabsOf(p, 'Agent Buddy sections')) === null && !/Which email fits|Find near-duplicate|Text to rewrite/.test(setup));

    // ---- 5. Turning it on again brings the sections back, on the one chosen last, with the draft ----------------------------------------
    await clickButton(p, /^Turn on for this site/);
    await ctx.waitUntil('the section bar to come back', async () => (await tabsOf(p, 'Agent Buddy sections')) !== null, { timeout: 25000 });
    const back = await tabsOf(p, 'Agent Buddy sections');
    t.check('after "Turn on for this site" the section bar is back, on the section chosen last (Write)', JSON.stringify(back?.selected) === '["Write"]', JSON.stringify(back));
    await p.waitForSelector('#ab-rewrite-text', { visible: true, timeout: 10000 });
    t.check('...and the draft typed before the site was turned off is still in the Rewrite box', (await draftNow()) === DRAFT, await draftNow());
    await clickTab(p, 'This page');
    await off.close();
    await ctx.ensureEnabled();

    const bad = errorsSince(ctx, mark);
    t.check('no console error, page error or CSP violation while the sections were used', bad.length === 0, describeErrors(bad));
    t.check('no CSP violation event in the panel', (await p.evaluate(() => window.__cspViolations || [])).length === 0);

    await panel.close();
  },
};

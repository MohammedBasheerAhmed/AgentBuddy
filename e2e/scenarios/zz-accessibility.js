// zz. Accessibility and dark mode (TRACKER R6), measured in the real browser on what is on screen: every screen and half of the side
//     panel, each of their tabs, the cards opened, the first-run card, the preview dialog and an answer, the settings page and the Team
//     full page, each in the light theme and in the dark one (the browser's colour scheme is switched, so the same media query a
//     person's system sets decides). Rules are in e2e/a11y.js: text contrast, a name for every control, a label for every field, tabs
//     that say what they are, a visible focus, targets of 24 px, no id used twice. Also: the dark theme really switches on, reduced
//     motion leaves nothing moving, and at 320 px nothing scrolls sideways.
//     Nothing here asks the AI except one answer per theme, which has to be looked at too.
const { auditPage } = require('../a11y.js');
const { prepare } = require('../common.js');
const { openScreen, openHalf, waitForText, clickButton } = require('../ui.js');

const SCHEMES = ['light', 'dark'];
const SCREENS = {
  'My work': [/My queue/, 20000],
  Team: [/Overview|Workload|Open|Quality/, 20000],
  Write: [/Snippets|Safe-to-send check/, 20000],
  Knowledge: [/Knowledge search/, 20000],
};
// The two tab lists that choose a screen and a half; every other tab list is looked at tab by tab.
const NOT_SUB_TABS = /^(Agent Buddy screens|Insights or AI Assist)$/;

module.exports = {
  id: 'zz',
  title: 'Accessibility and dark mode: every screen, half, tab, dialog and page, light and dark: contrast, names, labels, focus, target size, reduced motion, 320 px',
  timeoutMs: 240000,
  async run(t, ctx) {
    const { ai, data } = ctx;
    await prepare(ctx);
    await ctx.configure({ profiles: ['it', 'lead', 'km'], profilesConfirmed: true, halves: {}, previewMode: 'always', previewSeen: [] });

    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-a11y');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForText(p, data.INCIDENT_NUMBER, { timeout: 25000 });

    // One check per view and theme; every finding is printed, so the fix can be made from the log.
    const problems = [];
    const settle = () => new Promise((resolve) => setTimeout(resolve, 400)); // chevrons turn; the audit reads the end state
    const look = async (page, label, scheme, opts = {}) => {
      await page.keyboard.press('Shift'); // the browser treats the next focus as the keyboard's, so a focus ring is drawn where there is one
      const found = await page.evaluate(auditPage, opts);
      const name = `${scheme} / ${label}`;
      t.check(`${name}: no accessibility or colour problem`, found.length === 0, found.slice(0, 2).map((f) => `${f.rule}: ${f.where}: ${f.detail}`).join(' || '));
      for (const f of found.slice(0, 40)) console.log(`        [${name}] ${f.rule}: ${f.where}: ${f.detail}`);
      problems.push(...found.map((f) => ({ ...f, name })));
    };
    const schemeIs = (page, scheme) => page.evaluate((s) => getComputedStyle(document.documentElement).colorScheme.includes(s), scheme);

    // Every tab of any tab list on the view that is not the screen bar or the half switch. The panel has none today (round 3 turned them
    // into cards and menus, which openCards below opens); a tab list added later is looked at without anyone remembering to add it here.
    const subTabs = (page) =>
      page.evaluate((skip) => {
        const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
        return [...document.querySelectorAll('[role=tablist]')]
          .filter((l) => shown(l) && !new RegExp(skip).test(l.getAttribute('aria-label') || ''))
          .flatMap((l) => [...l.querySelectorAll('[role=tab]')].filter(shown).map((tab) => ({ id: tab.id, text: tab.innerText.replace(/\s+/g, ' ').trim().slice(0, 30), on: tab.getAttribute('aria-selected') === 'true' })));
      }, NOT_SUB_TABS.source);
    const eachTab = async (page, label, scheme) => {
      const tabs = (await subTabs(page)).filter((x) => x.id && !x.on).slice(0, 10);
      for (const tab of tabs) {
        await page.evaluate((id) => document.getElementById(id)?.click(), tab.id);
        await settle();
        await look(page, `${label} / ${tab.text}`, scheme);
      }
    };
    // Open every folded card of the view (a card is a button that says aria-expanded="false").
    const openCards = (page) =>
      page.evaluate(() => {
        const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
        const folded = [...document.querySelectorAll('button[aria-expanded="false"]:not([role=tab])')].filter((b) => shown(b) && !b.disabled && !/More actions|Quick actions/i.test(b.innerText)).slice(0, 15);
        for (const b of folded) b.click();
        return folded.length;
      });

    for (const scheme of SCHEMES) {
      await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      t.check(`${scheme}: the panel switches to the ${scheme} theme with the browser's setting`, await schemeIs(p, scheme));

      // ---- Ticket -------------------------------------------------------------------------------------------------------------
      await openScreen(p, 'Ticket');
      await openHalf(p, 'insights');
      await waitForText(p, 'Understand the ticket', { timeout: 20000 });
      await settle();
      await look(p, 'Ticket / Insights', scheme);
      const opened = await openCards(p);
      await settle();
      await look(p, `Ticket / Insights with ${opened} card(s) opened`, scheme);
      await eachTab(p, 'Ticket / Insights', scheme);
      await openHalf(p, 'assist');
      await waitForText(p, /Summarise this ticket/, { timeout: 15000 });
      await settle();
      await look(p, 'Ticket / AI Assist', scheme);

      // ---- The first-run card: it sits above the screen until the profiles are chosen ---------------------------------------------
      await ctx.configure({ profilesConfirmed: false });
      await waitForText(p, 'Getting started', { timeout: 15000 });
      await settle();
      await look(p, 'the Getting started card', scheme);
      await ctx.configure({ profilesConfirmed: true });
      await p.waitForFunction(() => !document.body.innerText.includes('Getting started'), { timeout: 15000 });

      // ---- The other screens, both halves where there are two, and their tabs ----------------------------------------------------------
      for (const [name, [expect, timeout]] of Object.entries(SCREENS)) {
        await openScreen(p, name);
        await openHalf(p, 'insights'); // the half chosen last is remembered: the text waited for is in Insights
        await waitForText(p, expect, { timeout });
        for (const half of ['insights', 'assist']) {
          const two = await openHalf(p, half);
          if (!two && half === 'assist') continue; // a screen with one half
          await settle();
          const label = `${name}${two ? ` / ${half === 'insights' ? 'Insights' : 'AI Assist'}` : ''}`;
          await look(p, label, scheme);
          await eachTab(p, label, scheme);
        }
      }

      // ---- The preview dialog and the answer (one AI run per theme) ------------------------------------------------------------------
      await openScreen(p, 'Ticket');
      await openHalf(p, 'assist');
      await clickButton(p, /^Summarise this ticket/);
      await p.waitForSelector('.ab-dialog', { timeout: 15000 });
      await settle();
      await look(p, 'preview dialog', scheme, { root: '.ab-dialog' });
      await clickButton(p, /^Send to AI/);
      await p.waitForSelector('.ab-output, .ab-note-danger', { timeout: 15000 });
      await settle();
      await look(p, 'an answer', scheme);

      // ---- The Team full page and the settings page ---------------------------------------------------------------------------------------
      const sourceTabId = await ctx.ext(async (u) => (await chrome.tabs.query({})).find((x) => (x.url || '').includes(u))?.id, '/incident.do');
      const dash = await ctx.newPage(`dashboard-a11y-${scheme}`);
      await dash.goto(`${ctx.extUrl('dashboard.html')}?tab=${sourceTabId}`, { waitUntil: 'load' });
      await dash.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      await waitForText(dash, /Reading from localhost:\d+ as you/, { timeout: 20000 });
      await dash.waitForFunction(() => !/Loading|Reading…/.test(document.body.innerText) || document.querySelectorAll('.ab-widget').length > 0, { timeout: 15000 }).catch(() => {});
      await settle();
      await look(dash, 'Team full page', scheme);
      await dash.close();

      const settings = await ctx.newPage(`settings-a11y-${scheme}`);
      await settings.goto(ctx.extUrl('options.html'), { waitUntil: 'load' });
      await settings.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      await settings.waitForSelector('#ab-settings-tab-basics', { timeout: 10000 });
      await settle();
      await look(settings, 'Settings / Basics', scheme);
      await settings.click('#ab-settings-tab-ai');
      await settings.waitForFunction(() => document.querySelector('#ab-settings-tab-ai')?.getAttribute('aria-selected') === 'true', { timeout: 10000 });
      await settle();
      await look(settings, 'Settings / AI Assist', scheme);
      // the answer formats (R11), open: the editor of a summary (sections) and of a customer reply (extra instructions), then one with a format set
      for (const feature of ['record-summary', 'reply-draft']) await settings.click(`details.ab-fmt-item[data-feature="${feature}"] > summary`);
      await settle();
      await look(settings, 'Settings / AI Assist / answer formats open', scheme);
      t.check(`${scheme}: the settings page switches to the ${scheme} theme too`, await schemeIs(settings, scheme));
      await settings.close();
    }

    // ---- Reduced motion: nothing moves ------------------------------------------------------------------------------------------------
    await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const moving = await p.evaluate(() =>
      [...document.querySelectorAll('*')]
        .filter((el) => {
          const cs = getComputedStyle(el);
          const longest = (list) => Math.max(0, ...list.split(',').map((x) => parseFloat(x) * (x.trim().endsWith('ms') ? 0.001 : 1)));
          return longest(cs.transitionDuration) > 0 || (cs.animationName !== 'none' && longest(cs.animationDuration) > 0);
        })
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`)
    );
    t.check('with "reduce motion" set, no element in the panel has a transition or an animation', moving.length === 0, moving.join(' | '));

    // ---- 320 px: the narrowest the side panel can be -------------------------------------------------------------------------------------
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }]);
    const cdp = await p.createCDPSession();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 820, deviceScaleFactor: 1, mobile: false });
    for (const [screen, half] of [['Ticket', 'insights'], ['Ticket', 'assist'], ['My work', 'insights'], ['Team', 'insights'], ['Write', 'insights'], ['Write', 'assist'], ['Knowledge', 'insights']]) {
      await openScreen(p, screen);
      await openHalf(p, half);
      await settle();
      const found = await p.evaluate(auditPage, { rules: ['overflow'], narrow: true });
      t.check(`320 px wide: ${screen}${half === 'assist' ? ' / AI Assist' : ''} does not scroll sideways`, found.length === 0, found.map((f) => f.detail).join(' || '));
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.detach().catch(() => {});

    // ---- In all ------------------------------------------------------------------------------------------------------------------------
    const byRule = {};
    for (const f of problems) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
    t.info(`audit in all: ${problems.length} finding(s) ${JSON.stringify(byRule)}`);
    t.check('the AI was asked only for the one answer per theme that had to be looked at', ai.requests.length === SCHEMES.length, String(ai.requests.length));

    await panel.close();
    await ticket.close();
  },
};

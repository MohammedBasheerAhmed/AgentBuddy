// zx. The look of the panel and the command palette (TRACKER R9): the header, the light / dark / computer's colours (panel, Settings and the bar
//     on the ServiceNow page), and the palette: it opens with Ctrl+K and from the header, searches, runs a command with Enter, closes with Esc,
//     sends nothing by itself (an AI action opens the preview first), works in Arabic, and passes the accessibility audit open in every mode.
const { auditPage } = require('../a11y.js');
const { prepare } = require('../common.js');
const { openScreen, openHalf, waitForText } = require('../ui.js');

const DARK_BG = 'rgb(19, 23, 22)'; // --ab-bg in dark (src/ui/theme.css)
const LIGHT_BG = 'rgb(255, 255, 255)';

module.exports = {
  id: 'zx',
  title: 'Look and feel: the header, light/dark/computer colours everywhere, and the command palette (Ctrl+K)',
  timeoutMs: 240000,
  async run(t, ctx) {
    const { data, ai } = ctx;
    await prepare(ctx);
    await ctx.configure({ language: 'en', theme: 'system', profiles: ['it', 'lead', 'km'], profilesConfirmed: true, halves: {} });
    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-palette');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForText(p, data.INCIDENT_NUMBER, { timeout: 25000 });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
    const chord = async (code) => {
      await p.keyboard.down('Control');
      await p.keyboard.press(code);
      await p.keyboard.up('Control');
    };
    const paletteShown = () => p.evaluate(() => [...document.querySelectorAll('.ab-palette')].some((e) => e.getClientRects().length > 0));
    const openPalette = async () => {
      await chord('KeyK');
      await ctx.waitUntil('the palette to open', paletteShown, { timeout: 5000 });
      await settle();
    };
    const closePalette = async () => {
      await p.keyboard.press('Escape');
      await ctx.waitUntil('the palette to close', async () => !(await paletteShown()), { timeout: 5000 });
    };
    const options = () => p.evaluate(() => [...document.querySelectorAll('.ab-palette [role=option]')].map((o) => ({ id: o.getAttribute('data-command'), text: o.innerText.replace(/\s+/g, ' ').trim(), selected: o.getAttribute('aria-selected') === 'true' })));
    const typeIn = async (text) => {
      await p.keyboard.type(text);
      await settle();
    };
    const bg = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const themeAttr = (page = p) => page.evaluate(() => document.documentElement.getAttribute('data-theme') || '');

    // ---- the header --------------------------------------------------------------------------------------------------------------------
    const header = await p.evaluate(() => ({
      mark: Boolean(document.querySelector('.ab-header .ab-brandmark')),
      name: document.querySelector('.ab-header .ab-brand')?.innerText,
      instance: document.querySelector('.ab-header .ab-instance')?.innerText,
      buttons: [...document.querySelectorAll('.ab-header button')].map((b) => b.getAttribute('aria-label')),
      promise: [document.querySelector('.ab-header .ab-brandtext')?.title || '', document.querySelector('.ab-header .ab-promise')?.textContent || ''],
    }));
    t.check('header: the mark, the name and the instance it reads', header.mark && header.name === 'Agent Buddy' && Boolean(header.instance), JSON.stringify(header));
    t.check('header: buttons for the palette, the colours and Settings, each with a name', ['Search commands', 'Switch to dark colours', 'Settings'].every((n) => header.buttons.includes(n)), JSON.stringify(header.buttons));
    t.check('header: no more than those three buttons, and the privacy promise is still said there (on hover and to a screen reader)', header.buttons.length === 3 && header.promise.every((x) => /Personal data is masked before any AI call/.test(x)), JSON.stringify(header));

    // ---- opening, searching, running --------------------------------------------------------------------------------------------------
    await openPalette();
    const first = await options();
    const dialog = await p.evaluate(() => {
      const d = document.querySelector('.ab-palette');
      const input = d.querySelector('input');
      return { modal: d.getAttribute('aria-modal'), role: d.getAttribute('role'), focused: document.activeElement === input, combobox: input.getAttribute('role'), active: input.getAttribute('aria-activedescendant'), behindInert: document.querySelector('.ab-header')?.hasAttribute('inert') && Boolean(document.querySelector('.ab-main')?.closest('[inert]')) && Boolean(document.querySelector('.ab-screens')?.closest('[inert]')) };
    });
    t.check('Ctrl+K opens a modal dialog with the focus in its search box (a combobox)', dialog.modal === 'true' && dialog.role === 'dialog' && dialog.focused && dialog.combobox === 'combobox', JSON.stringify(dialog));
    t.check('the rest of the panel is shut off while it is open', dialog.behindInert === true, JSON.stringify(dialog));
    t.check('it lists the screens, the AI actions of this ticket, Settings, the colours and the languages', ['go:ticket', 'go:team', 'run:record-summary', 'run:reply-draft', 'run:card:related', 'settings', 'theme:dark', 'language:ar'].every((id) => first.some((o) => o.id === id)), first.map((o) => o.id).join(' '));
    t.check('one command is highlighted and the box names it (aria-activedescendant)', first.filter((o) => o.selected).length === 1 && Boolean(dialog.active), JSON.stringify(first.slice(0, 2)));
    t.check('the AI actions carry the AI mark and the others do not', first.filter((o) => /^run:(?!card)/.test(o.id)).every((o) => /\bAI\b/.test(o.text)) && first.filter((o) => /^(go|theme|language):|^settings$/.test(o.id)).every((o) => !/\bAI\b/.test(o.text)), first.slice(0, 6).map((o) => o.text).join(' | '));

    await typeIn('team');
    const team = await options();
    t.check('typing "team" puts "Go to Team" first', team[0]?.id === 'go:team', team.map((o) => o.id).join(' '));
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('ArrowUp');
    t.check('the arrow keys move the highlight (and come back)', (await options())[0].selected === true);
    await p.keyboard.press('Enter');
    await ctx.waitUntil('the Team screen', () => p.evaluate(() => document.querySelector('#ab-sec-tab-team')?.getAttribute('aria-selected') === 'true'), { timeout: 8000 });
    t.check('Enter runs it: the Team screen is on show and the palette is closed', !(await paletteShown()));
    t.check('the panel is usable again (nothing left inert)', await p.evaluate(() => !document.querySelector('[inert]')));

    await p.keyboard.press('Escape'); // nothing open: harmless
    await openPalette();
    await typeIn('zzzzqq');
    const none = await p.evaluate(() => document.querySelector('.ab-palette-empty')?.innerText || '');
    t.check('a search with no match says so, in words', /Nothing matches/.test(none) && none.includes('zzzzqq'), none);
    await closePalette();
    t.check('Esc closes it', !(await paletteShown()));

    await p.click('.ab-header button[aria-label="Search commands"]');
    await ctx.waitUntil('the palette to open from the header', paletteShown, { timeout: 5000 });
    t.check('the button in the header opens it too', true);
    await closePalette();

    // ---- a command that shows a half, a card, and an AI action -------------------------------------------------------------------------
    await openScreen(p, 'Ticket');
    await openHalf(p, 'insights');
    await openPalette();
    await typeIn('show ai assist');
    await p.keyboard.press('Enter');
    await ctx.waitUntil('AI Assist', () => p.evaluate(() => document.querySelector('#ab-ticket-half-tab-assist')?.getAttribute('aria-selected') === 'true'), { timeout: 8000 });
    t.check('"Show AI Assist" switches the half of the screen on show', true);
    await openPalette();
    await typeIn('related');
    await p.keyboard.press('Enter');
    await ctx.waitUntil('the Related tickets card', () => p.evaluate(() => document.querySelector('#ab-ticket-half-tab-insights')?.getAttribute('aria-selected') === 'true' && [...document.querySelectorAll('[data-card="related"]')].some((c) => c.getClientRects().length > 0)), { timeout: 10000 });
    t.check('"Related tickets" brings that card forward in Insights (nothing is sent)', ai.requests.length === 0, `${ai.requests.length} requests`);

    // An AI action starts from any screen: it brings the Ticket screen forward. (Showing a card scrolls the panel down for a while, and the tabs
    // can sit under the sticky header: a real click on the tab may land on the header, so the tab is pressed by the page's own click here.)
    await p.evaluate(() => document.querySelector('#ab-sec-tab-team').click());
    await ctx.waitUntil('the Team screen', () => p.evaluate(() => document.querySelector('#ab-sec-tab-team')?.getAttribute('aria-selected') === 'true'), { timeout: 8000 });
    await openPalette();
    await typeIn('summarise');
    t.check('"summarise" finds the AI action of this ticket', (await options())[0]?.id === 'run:record-summary', (await options()).map((o) => o.id).join(' '));
    await p.keyboard.press('Enter');
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    t.check('an AI action from the palette opens the check first: nothing has been sent', ai.requests.length === 0, `${ai.requests.length} requests`);
    t.check('and the Ticket screen came forward', await p.evaluate(() => document.querySelector('#ab-sec-tab-ticket')?.getAttribute('aria-selected') === 'true'));
    await p.evaluate(() => [...document.querySelectorAll('.ab-dialog button')].find((b) => /^Cancel/.test(b.innerText.trim()))?.click());
    await ctx.waitUntil('the check to close', async () => !(await p.$('.ab-dialog')), { timeout: 8000 });
    t.check('Cancel sends nothing', ai.requests.length === 0);

    // ---- colours: the panel ------------------------------------------------------------------------------------------------------------
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await settle();
    t.check('"same as the computer": the computer is dark, the panel is dark (no data-theme)', (await bg()) === DARK_BG && (await themeAttr()) === '', `${await bg()} ${await themeAttr()}`);
    await ctx.configure({ theme: 'light' });
    await ctx.waitUntil('the panel to turn light', async () => (await themeAttr()) === 'light', { timeout: 8000 });
    t.check('chosen light: the panel stays light although the computer is dark', (await bg()) === LIGHT_BG, await bg());
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await ctx.configure({ theme: 'dark' });
    await ctx.waitUntil('the panel to turn dark', async () => (await themeAttr()) === 'dark', { timeout: 8000 });
    t.check('chosen dark: the panel is dark although the computer is light', (await bg()) === DARK_BG, await bg());
    await ctx.configure({ theme: 'system' });
    await ctx.waitUntil('the panel to follow the computer', async () => (await themeAttr()) === '', { timeout: 8000 });
    t.check('back to "same as the computer": the panel is light again', (await bg()) === LIGHT_BG, await bg());

    // the sun / moon button in the header, and the palette's colour commands
    await p.click('.ab-header button[aria-label="Switch to dark colours"]');
    await ctx.waitUntil('the button to turn the panel dark', async () => (await themeAttr()) === 'dark', { timeout: 8000 });
    t.check('the moon button turns the panel dark and now says how to go back', await p.evaluate(() => Boolean(document.querySelector('.ab-header button[aria-label="Switch to light colours"]'))));
    await openPalette();
    await typeIn('light');
    const light = await options();
    t.check('the palette offers the colours that are not in use ("Use light colours", not "Use dark colours")', light.some((o) => o.id === 'theme:light') && !light.some((o) => o.id === 'theme:dark'), light.map((o) => o.id).join(' '));
    await p.keyboard.press('Enter');
    await ctx.waitUntil('the palette to turn the panel light', async () => (await themeAttr()) === 'light', { timeout: 8000 });
    t.check('choosing it turns the panel light', true);

    // ---- colours: the bar on the ServiceNow page ---------------------------------------------------------------------------------------
    const hostTheme = async () => {
      const cdp = await ticket.createCDPSession();
      try {
        await cdp.send('DOM.enable');
        const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
        const find = (n) => (n.shadowRoots || []).some((r) => r.shadowRootType === 'closed') ? n : (n.children || []).map(find).find(Boolean);
        const host = find(root);
        if (!host) return null;
        const at = host.attributes || [];
        for (let i = 0; i < at.length; i += 2) if (at[i] === 'data-theme') return at[i + 1];
        return '';
      } finally {
        await cdp.detach().catch(() => {});
      }
    };
    await ctx.configure({ theme: 'dark' });
    await ctx.waitUntil('the bar on the page to turn dark', async () => (await hostTheme()) === 'dark', { timeout: 25000 });
    t.check('the bar on the ServiceNow page takes the chosen colours (dark)', true);
    await ctx.configure({ theme: 'system' });
    await ctx.waitUntil('the bar to follow the computer again', async () => (await hostTheme()) === '', { timeout: 25000 });
    t.check('and follows the computer again when asked to', true);

    // ---- colours: Settings -------------------------------------------------------------------------------------------------------------
    const settings = await ctx.newPage('settings-colours');
    await settings.goto(ctx.extUrl('options.html'), { waitUntil: 'load' });
    await settings.waitForSelector('#theme-choice', { timeout: 10000 });
    t.check('Settings > Basics has the choice (Same as the computer, Light, Dark)', JSON.stringify(await settings.$$eval('#theme-choice option', (o) => o.map((x) => x.textContent))) === JSON.stringify(['Same as the computer', 'Light', 'Dark']));
    await settings.select('#theme-choice', 'dark');
    await ctx.waitUntil('Settings to turn dark', async () => (await themeAttr(settings)) === 'dark', { timeout: 8000 });
    t.check('choosing Dark there turns the page dark', (await settings.evaluate(() => getComputedStyle(document.body).backgroundColor)) === DARK_BG);
    await settings.select('#theme-choice', 'system');
    await ctx.waitUntil('Settings to follow the computer', async () => (await themeAttr(settings)) === '', { timeout: 8000 });
    await settings.close();
    await ctx.configure({ theme: 'system' });
    await ctx.waitUntil('the panel to follow the computer', async () => (await themeAttr()) === '', { timeout: 8000 });

    // ---- the audit with the palette open, in every mode ------------------------------------------------------------------------------------
    const audit = async (label) => {
      await p.keyboard.press('Shift');
      const found = await p.evaluate(auditPage, { root: '.ab-palette' });
      t.check(`${label}: no accessibility or colour problem`, found.length === 0, found.slice(0, 2).map((x) => `${x.rule}: ${x.where}: ${x.detail}`).join(' || '));
      for (const x of found.slice(0, 10)) console.log(`        [${label}] ${x.rule}: ${x.where}: ${x.detail}`);
    };
    await openPalette();
    await audit('the palette, light');
    await typeIn('rep');
    await audit('the palette with a search, light');
    await closePalette();
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await settle();
    await openPalette();
    await audit('the palette, dark');
    await closePalette();
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    const cdp = await p.createCDPSession();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 820, deviceScaleFactor: 1, mobile: false });
    await openPalette();
    const narrow = await p.evaluate(() => ({ over: document.documentElement.scrollWidth - window.innerWidth, box: document.querySelector('.ab-palette').getBoundingClientRect().right <= window.innerWidth }));
    t.check('at 320 px the palette and the header do not scroll sideways', narrow.over <= 1 && narrow.box, JSON.stringify(narrow));
    await closePalette();
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.detach().catch(() => {});

    // ---- Arabic ----------------------------------------------------------------------------------------------------------------------
    await openPalette();
    await typeIn('arabic');
    await p.keyboard.press('Enter');
    await ctx.waitUntil('the panel to turn to Arabic', async () => (await p.evaluate(() => document.documentElement.dir)) === 'rtl', { timeout: 10000 });
    t.check('the "Language: العربية" command turns the panel to Arabic, right to left', true);
    const arabic = /[؀-ۿ]/;
    await openPalette();
    const ar = await options();
    t.check('in Arabic the commands are Arabic (the AI actions, the screens, Settings)', ar.length > 8 && ar.filter((o) => /^(go|run|settings)/.test(o.id)).every((o) => arabic.test(o.text)), ar.slice(0, 3).map((o) => o.text).join(' | '));
    // (names of products and of the language itself stay as they are)
    const english = await p.evaluate(() => [...document.querySelectorAll('.ab-palette')].map((d) => (d.innerText.match(/[A-Za-z]{4,}/g) || []).filter((w) => !/^(Enter|Esc|Agent|Buddy|ServiceNow|English)$/.test(w))).flat());
    t.check('and no English is left in the box (the keys, product names and the name of the language aside)', english.length === 0, english.slice(0, 6).join(' '));
    await typeIn('settings');
    const found = await options();
    t.check('English still finds the command in Arabic ("settings" finds the Settings command)', found[0]?.id === 'settings', found.map((o) => o.id).join(' '));
    await audit('the palette, Arabic');
    await closePalette();
    await ctx.configure({ language: 'en' });
    await ctx.waitUntil('the panel to turn to English', async () => (await p.evaluate(() => document.documentElement.dir)) === 'ltr', { timeout: 10000 });

    await panel.close();
    await ticket.close();
  },
};

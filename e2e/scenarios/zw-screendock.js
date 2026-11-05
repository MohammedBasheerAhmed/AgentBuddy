// zw. The panel's frame since the 2026-11-05 layout (docs/rail-layout.md): the screens in a bar along the bottom (an icon over each name,
//     the screen on show in the accent), and beside the screens a side rail that lists what the screen on show offers (names on hover
//     and on the keyboard, "Show names" widens it). Both stay put while the screen scrolls, go inert behind the palette, fit a 320 px
//     panel and are mirrored in Arabic.
const { prepare } = require('../common.js');
const { openScreen, waitForText } = require('../ui.js');

const SCREENS = ['Ticket', 'My work', 'Team', 'Write', 'Knowledge'];
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

module.exports = {
  id: 'zw',
  title: 'Panel frame: the screens in a bar at the bottom, the side rail beside the screens (names on hover and keyboard, wide with names), behind the palette',
  timeoutMs: 150000,
  async run(t, ctx) {
    const { data } = ctx;
    await prepare(ctx);
    await ctx.configure({ language: 'en', theme: 'light', profiles: ['it', 'lead', 'km'], profilesConfirmed: true, halves: {}, railNames: false });
    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-screendock');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForText(p, data.INCIDENT_NUMBER, { timeout: 25000 });
    await ctx.waitUntil('the five screens', async () => (await p.$$('.ab-screens [role=tab]')).length === 5, { timeout: 10000 });
    await ctx.waitUntil('the side rail of the Ticket screen', async () => (await p.$$('.ab-rail .ab-rail-item')).length >= 3, { timeout: 15000 });

    // What a person sees of the bar and the rail.
    const look = () =>
      p.evaluate(() => {
        const nav = document.querySelector('.ab-screens');
        const box = nav.getBoundingClientRect();
        const main = document.querySelector('.ab-main');
        const head = document.querySelector('.ab-header').getBoundingClientRect();
        const tabs = [...nav.querySelectorAll('[role=tab]')].map((b) => {
          const r = b.getBoundingClientRect();
          const name = b.querySelector('.ab-screen-name');
          return { id: b.id, name: b.innerText.trim(), shownName: name ? name.getClientRects().length > 0 && getComputedStyle(name).visibility === 'visible' : false, w: r.width, h: r.height, cx: r.left + r.width / 2, hasIcon: Boolean(b.querySelector('svg')), color: getComputedStyle(b).color, selected: b.getAttribute('aria-selected') === 'true' };
        });
        const rail = document.querySelector('.ab-rail');
        const inner = rail && rail.querySelector('.ab-rail-inner').getBoundingClientRect();
        const tip = document.querySelector('.ab-rail-tip');
        return {
          view: document.documentElement.clientWidth,
          bar: { left: box.left, right: box.right, top: box.top, bottomGap: window.innerHeight - box.bottom, tag: nav.tagName, role: nav.getAttribute('role'), label: nav.getAttribute('aria-label'), afterMain: Boolean(main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING) },
          tabs,
          headBottom: head.bottom,
          rail: rail
            ? {
                label: rail.getAttribute('aria-label'),
                wide: rail.classList.contains('is-wide'),
                left: inner.left,
                right: inner.right,
                top: inner.top,
                bottom: inner.bottom,
                width: inner.width,
                items: [...rail.querySelectorAll('.ab-rail-item')].map((b) => ({ id: b.getAttribute('data-rail-id'), name: b.getAttribute('aria-label'), tab: b.tabIndex, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, visibleName: Boolean(b.querySelector('.ab-rail-name')) })),
              }
            : null,
          tip: tip ? tip.textContent : '',
        };
      });

    // ---- 1. The bar of screens --------------------------------------------------------------------------------------------------
    let v = await look();
    t.check('five screens in the bar, in order, each an icon with its name drawn under it', JSON.stringify(v.tabs.map((x) => x.name)) === JSON.stringify(SCREENS) && v.tabs.every((x) => x.hasIcon && x.shownName), JSON.stringify(v.tabs.map((x) => [x.name, x.hasIcon, x.shownName])));
    t.check('it is still the tab list of the screens (a name, the Ticket selected)', v.bar.tag === 'NAV' && v.bar.role === 'tablist' && v.bar.label === 'Agent Buddy screens' && JSON.stringify(v.tabs.filter((x) => x.selected).map((x) => x.name)) === '["Ticket"]', JSON.stringify(v.bar));
    t.check('the screen on show is in the green; the others are grey', v.tabs.filter((x) => x.selected).every((x) => x.color === 'rgb(27, 107, 79)') && v.tabs.filter((x) => !x.selected).every((x) => x.color !== 'rgb(27, 107, 79)'), JSON.stringify(v.tabs.map((x) => x.color)));
    t.check('the bar runs the whole width, on the bottom edge, every button at least 44 px tall', near(v.bar.left, 0, 1) && near(v.bar.right, v.view, 1) && near(v.bar.bottomGap, 0, 1) && v.tabs.every((x) => x.h >= 44), JSON.stringify({ bar: v.bar, h: v.tabs.map((x) => x.h) }));
    t.check('it comes after the screens in the page, as it does on the screen', v.bar.afterMain);

    // ---- 2. The side rail ---------------------------------------------------------------------------------------------------------
    t.check('the rail is on the right edge, under the header, above the bar, 48 px wide', near(v.rail.right, v.view, 1) && near(v.rail.width, 48, 1) && near(v.rail.top, v.headBottom, 2) && near(v.rail.bottom, v.bar.top, 2), JSON.stringify({ rail: v.rail, head: v.headBottom, barTop: v.bar.top }));
    t.check('...a landmark named for what it lists, one tab stop, every item named, every target at least 40 px', /^Side rail: /.test(v.rail.label) && v.rail.items.filter((x) => x.tab === 0).length === 1 && v.rail.items.every((x) => x.name && x.w >= 40 && x.h >= 40), JSON.stringify(v.rail.items));
    t.check('...the last item shows the names', v.rail.items[v.rail.items.length - 1].name === 'Show names');

    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await ctx.sleep(300);
    v = await look();
    t.check('scrolled to the end: the bar is still on the bottom edge and the rail still under the header', near(v.bar.bottomGap, 0, 1) && near(v.rail.top, v.headBottom, 2), JSON.stringify({ gap: v.bar.bottomGap, top: v.rail.top, head: v.headBottom }));
    await p.evaluate(() => window.scrollTo(0, 0));

    // A name on hover.
    const second = v.rail.items[1];
    const box = await (await p.$(`.ab-rail [data-rail-id="${second.id}"]`)).boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await ctx.waitUntil('the name on hover', async () => Boolean((await look()).tip), { timeout: 3000 });
    v = await look();
    t.check('hovering a rail icon shows its name beside it', v.tip.length > 0 && second.name.startsWith(v.tip.replace(/\s+$/, '')), JSON.stringify({ tip: v.tip, name: second.name }));
    await p.mouse.move(5, 5, { steps: 3 });
    await ctx.waitUntil('the name to go away', async () => !(await look()).tip, { timeout: 3000 });

    // The keyboard: one tab stop, arrows move along the rail and show the name.
    await p.focus('.ab-rail .ab-rail-item[tabindex="0"]');
    await p.keyboard.press('Home');
    await p.keyboard.press('ArrowDown');
    await ctx.waitUntil('the second item to have the focus', () => p.evaluate((id) => document.activeElement?.getAttribute('data-rail-id') === id, second.id), { timeout: 3000 });
    t.check('the arrow keys move along the rail, and the name shows on keyboard focus', Boolean((await look()).tip));
    await p.keyboard.press('End');
    t.check('End goes to "Show names"', await p.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Show names'));

    // Show names.
    await p.keyboard.press('Enter');
    await ctx.waitUntil('the wide rail', async () => (await look()).rail.wide, { timeout: 5000 });
    v = await look();
    t.check('"Show names" widens the rail over the screen and draws every name', v.rail.width > 150 && near(v.rail.right, v.view, 1) && v.rail.items.every((x) => x.visibleName), JSON.stringify({ width: v.rail.width, names: v.rail.items.map((x) => x.visibleName) }));
    await p.click('.ab-rail .ab-rail-names');
    await ctx.waitUntil('the slim rail again', async () => !(await look()).rail.wide, { timeout: 5000 });
    t.check('"Hide names" makes it slim again', true);

    // ---- 3. The screens: keyboard and click; each screen has its own rail ----------------------------------------------------------------
    await p.focus('#ab-sec-tab-ticket');
    await p.keyboard.press('ArrowRight');
    await ctx.waitUntil('My work to be selected by the arrow key', async () => (await look()).tabs.some((x) => x.selected && x.name === 'My work'), { timeout: 5000 });
    t.check('the right arrow moves to the next screen', true);
    await p.keyboard.press('End');
    await ctx.waitUntil('Knowledge to be selected by End', async () => (await look()).tabs.some((x) => x.selected && x.name === 'Knowledge'), { timeout: 5000 });
    t.check('End goes to the last screen', true);
    await openScreen(p, 'Write');
    await ctx.waitUntil('the rail of the Write screen', async () => {
      const r = (await look()).rail;
      return Boolean(r && r.items.length >= 2);
    }, { timeout: 10000 });
    v = await look();
    t.check('a click on a screen shows it, marks it, and the rail lists that screen\'s own sections', v.tabs.filter((x) => x.selected).map((x) => x.name).join() === 'Write' && v.rail.items.length >= 2, JSON.stringify(v.rail && v.rail.items.map((x) => x.name)));
    await openScreen(p, 'Ticket');

    // ---- 4. Behind the palette ---------------------------------------------------------------------------------------------------------
    await p.click('.ab-header button[aria-haspopup="dialog"]');
    await ctx.waitUntil('the palette to open', () => p.evaluate(() => [...document.querySelectorAll('.ab-palette')].some((e) => e.getClientRects().length > 0)), { timeout: 5000 });
    t.check('while the palette is open the bar and the rail are inert', await p.evaluate(() => document.querySelector('.ab-screens').closest('[inert]') !== null && document.querySelector('.ab-rail').closest('[inert]') !== null));
    await p.keyboard.press('Escape');
    await ctx.waitUntil('the palette to close', () => p.evaluate(() => ![...document.querySelectorAll('.ab-palette')].some((e) => e.getClientRects().length > 0)), { timeout: 5000 });
    t.check('the palette closes: both are live again', await p.evaluate(() => document.querySelector('.ab-screens').closest('[inert]') === null && document.querySelector('.ab-rail').closest('[inert]') === null));

    // ---- 5. A narrow panel ---------------------------------------------------------------------------------------------------------------
    const size = await p.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    await p.setViewport({ width: 320, height: size.h });
    await ctx.sleep(300);
    v = await look();
    t.check('at 320 px wide the five screens and the rail are inside the panel', v.bar.left >= 0 && v.bar.right <= v.view && v.tabs.every((x) => x.cx > 0 && x.cx < v.view) && v.rail.right <= v.view + 1, JSON.stringify({ bar: v.bar, rail: v.rail && v.rail.right, view: v.view }));
    await p.setViewport({ width: size.w, height: size.h });

    // ---- 6. Arabic: the bar and the rail are mirrored, the names are Arabic ------------------------------------------------------------------
    await ctx.configure({ language: 'ar' });
    await ctx.waitUntil('the panel to turn right to left', async () => (await p.evaluate(() => document.documentElement.dir)) === 'rtl', { timeout: 10000 });
    await ctx.waitUntil('the rail in Arabic', async () => Boolean((await look()).rail), { timeout: 10000 });
    v = await look();
    const first = v.tabs[0];
    const last = v.tabs[v.tabs.length - 1];
    t.check('in Arabic the first screen is at the right end of the bar and the last at the left', first.cx > last.cx, JSON.stringify({ first: first.cx, last: last.cx }));
    t.check('...every screen has its Arabic name', v.tabs.every((x) => /[؀-ۿ]/.test(x.name)), JSON.stringify(v.tabs.map((x) => x.name)));
    t.check('...and the rail is on the left edge', near(v.rail.left, 0, 1), JSON.stringify({ left: v.rail.left }));
    await ctx.configure({ language: 'en' });
    await ctx.waitUntil('the panel to turn left to right', async () => (await p.evaluate(() => document.documentElement.dir)) === 'ltr', { timeout: 10000 });

    await panel.close();
    await ticket.close();
  },
};

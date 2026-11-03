// zw. The panel's screens as an icon dock at the bottom centre (TRACKER R10, phase 2): one round icon per screen, named on hover and on the
//     keyboard, the screen on show filled, floating at the bottom edge while the screen scrolls behind it, behind the palette (inert) when it is
//     open, inside the panel at 320 px, mirrored in Arabic.
const { prepare } = require('../common.js');
const { openScreen, waitForText } = require('../ui.js');

const SCREENS = ['Ticket', 'My work', 'Team', 'Write', 'Knowledge'];
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

module.exports = {
  id: 'zw',
  title: 'Panel screens as an icon dock at the bottom centre: icons, names on hover and on the keyboard, the screen on show filled, behind the palette',
  timeoutMs: 120000,
  async run(t, ctx) {
    const { data } = ctx;
    await prepare(ctx);
    await ctx.configure({ language: 'en', theme: 'light', profiles: ['it', 'lead', 'km'], profilesConfirmed: true, halves: {} });
    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-screendock');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForText(p, data.INCIDENT_NUMBER, { timeout: 25000 });
    await ctx.waitUntil('the five icons', async () => (await p.$$('.ab-screens [role=tab]')).length === 5, { timeout: 10000 });

    // What a person sees of the dock: its place, each icon's size, drawn icon and visible words, the name (the ::after text), which is filled.
    const look = () =>
      p.evaluate(() => {
        const nav = document.querySelector('.ab-screens');
        const box = nav.getBoundingClientRect();
        const main = document.querySelector('.ab-main');
        const tabs = [...nav.querySelectorAll('[role=tab]')].map((b) => {
          const r = b.getBoundingClientRect();
          const cs = getComputedStyle(b);
          const after = getComputedStyle(b, '::after');
          const visibleText = [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
          return { id: b.id, name: b.innerText.trim(), dataName: b.getAttribute('data-name'), w: r.width, h: r.height, cx: r.left + r.width / 2, hasIcon: Boolean(b.querySelector('svg')), visibleText, bg: cs.backgroundColor, selected: b.getAttribute('aria-selected') === 'true', tip: after.visibility === 'visible' && Number(after.opacity) > 0.9 ? after.content.replace(/^"|"$/g, '') : '' };
        });
        return { cx: box.left + box.width / 2, bottomGap: window.innerHeight - box.bottom, left: box.left, right: box.right, view: document.documentElement.clientWidth, top: box.top, tag: nav.tagName, role: nav.getAttribute('role'), label: nav.getAttribute('aria-label'), afterMain: Boolean(main.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING), tabs };
      });

    // ---- 1. The icons -------------------------------------------------------------------------------------------------------------
    let v = await look();
    t.check('five icons, one per screen, in order, each with its name as text for a screen reader', JSON.stringify(v.tabs.map((x) => x.name)) === JSON.stringify(SCREENS), JSON.stringify(v.tabs.map((x) => x.name)));
    t.check('every icon is a drawn picture with no visible words, and is a round 40 px target', v.tabs.every((x) => x.hasIcon && x.visibleText === '' && Math.round(x.w) === 40 && Math.round(x.h) === 40), JSON.stringify(v.tabs.map((x) => [x.w, x.h, x.hasIcon, x.visibleText])));
    t.check('it is still the tab list of the screens (one tab stop, a name, the Ticket selected)', v.tag === 'NAV' && v.role === 'tablist' && v.label === 'Agent Buddy screens' && JSON.stringify(v.tabs.filter((x) => x.selected).map((x) => x.name)) === '["Ticket"]', JSON.stringify({ tag: v.tag, role: v.role, label: v.label }));
    t.check('the screen on show is filled with the green; the others have no fill', v.tabs.filter((x) => x.selected).every((x) => x.bg === 'rgb(27, 107, 79)') && v.tabs.filter((x) => !x.selected).every((x) => x.bg === 'rgba(0, 0, 0, 0)'), JSON.stringify(v.tabs.map((x) => x.bg)));
    t.check('it comes after the screens in the page, as it does on the screen', v.afterMain);

    // ---- 2. Where it is ------------------------------------------------------------------------------------------------------------
    t.check('it is in the middle of the panel\'s width', near(v.cx, v.view / 2, 2), JSON.stringify({ cx: v.cx, view: v.view }));
    t.check('...and floats a little above the bottom edge while the ticket (a long screen) is at the top', near(v.bottomGap, 12, 2), JSON.stringify({ gap: v.bottomGap }));
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await ctx.sleep(300);
    v = await look();
    t.check('...and after the last card when the screen is scrolled to its end, with room around it', v.bottomGap >= 10 && v.bottomGap <= 26, JSON.stringify({ gap: v.bottomGap }));
    await p.evaluate(() => window.scrollTo(0, 0));

    // ---- 3. The name of an icon: on hover -----------------------------------------------------------------------------------------
    const center = async (id) => {
      const box = await (await p.$(`#${id}`)).boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const myWork = await center('ab-sec-tab-mywork');
    await p.mouse.move(myWork.x, myWork.y, { steps: 4 });
    await ctx.waitUntil('the name on hover', async () => (await look()).tabs.some((x) => x.tip === 'My work'), { timeout: 3000 });
    v = await look();
    t.check('hovering an icon shows its name, and only that icon\'s', JSON.stringify(v.tabs.filter((x) => x.tip).map((x) => [x.name, x.tip])) === '[["My work","My work"]]', JSON.stringify(v.tabs.map((x) => x.tip)));
    await p.mouse.move(5, 5, { steps: 3 });
    await ctx.waitUntil('the name to go away', async () => (await look()).tabs.every((x) => !x.tip), { timeout: 3000 });
    t.check('the pointer leaves: the name goes', true);

    // ---- 4. On the keyboard ---------------------------------------------------------------------------------------------------------
    await p.focus('#ab-sec-tab-ticket');
    await p.keyboard.press('ArrowRight');
    await ctx.waitUntil('My work to be selected by the arrow key', async () => (await look()).tabs.some((x) => x.selected && x.name === 'My work'), { timeout: 5000 });
    await ctx.waitUntil('the name on keyboard focus', async () => (await look()).tabs.some((x) => x.tip === 'My work'), { timeout: 3000 });
    t.check('the right arrow moves to the next screen and its name shows, as on hover', (await look()).tabs.some((x) => x.tip === 'My work' && x.selected));
    await p.keyboard.press('End');
    await ctx.waitUntil('Knowledge to be selected by End', async () => (await look()).tabs.some((x) => x.selected && x.name === 'Knowledge'), { timeout: 5000 });
    t.check('End goes to the last screen', true);

    // ---- 5. A click ------------------------------------------------------------------------------------------------------------------
    await openScreen(p, 'Write');
    v = await look();
    t.check('a click on an icon shows that screen and fills its icon; the dock stays where it was', v.tabs.filter((x) => x.selected).map((x) => x.name).join() === 'Write' && near(v.cx, v.view / 2, 2));
    await openScreen(p, 'Ticket');

    // ---- 6. Behind the palette ---------------------------------------------------------------------------------------------------------
    await p.click('.ab-header button[aria-haspopup="dialog"]');
    await ctx.waitUntil('the palette to open', () => p.evaluate(() => [...document.querySelectorAll('.ab-palette')].some((e) => e.getClientRects().length > 0)), { timeout: 5000 });
    t.check('while the palette is open the dock is inert: not clickable, not focusable', await p.evaluate(() => document.querySelector('.ab-screens').hasAttribute('inert')));
    await p.keyboard.press('Escape');
    await ctx.waitUntil('the palette to close', () => p.evaluate(() => ![...document.querySelectorAll('.ab-palette')].some((e) => e.getClientRects().length > 0)), { timeout: 5000 });
    t.check('the palette closes: the dock is live again', await p.evaluate(() => !document.querySelector('.ab-screens').hasAttribute('inert')));

    // ---- 7. A narrow panel ---------------------------------------------------------------------------------------------------------------
    const size = await p.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    await p.setViewport({ width: 320, height: size.h });
    await ctx.sleep(300);
    v = await look();
    t.check('at 320 px wide all five icons are inside the panel, with the dock centred', v.left >= 0 && v.right <= v.view && near(v.cx, v.view / 2, 2), JSON.stringify({ left: v.left, right: v.right, view: v.view }));
    await p.setViewport({ width: size.w, height: size.h });

    // ---- 8. Arabic: the dock is mirrored, the names are Arabic ------------------------------------------------------------------------------
    await ctx.configure({ language: 'ar' });
    await ctx.waitUntil('the panel to turn right to left', async () => (await p.evaluate(() => document.documentElement.dir)) === 'rtl', { timeout: 10000 });
    v = await look();
    const first = v.tabs[0];
    const last = v.tabs[v.tabs.length - 1];
    t.check('in Arabic the first screen is at the right end of the dock and the last at the left', first.cx > last.cx && near(v.cx, v.view / 2, 2), JSON.stringify({ first: first.cx, last: last.cx }));
    t.check('...and every icon has its Arabic name', v.tabs.every((x) => /[؀-ۿ]/.test(x.name) && x.dataName === x.name), JSON.stringify(v.tabs.map((x) => x.name)));
    await ctx.configure({ language: 'en' });
    await ctx.waitUntil('the panel to turn left to right', async () => (await p.evaluate(() => document.documentElement.dir)) === 'ltr', { timeout: 10000 });

    await panel.close();
    await ticket.close();
  },
};

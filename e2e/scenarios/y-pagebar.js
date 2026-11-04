// y. The dock on the ServiceNow page itself: a pill at the bottom centre that stays out of the page's reach, shows on a record and nowhere
//    else, opens and folds with real clicks, names each icon on hover and on the keyboard, can be dragged (or moved with the arrow keys)
//    along the bottom, remembers its place, sits below the page's dialogs (and hides while one is open), and goes away when it is
//    switched off. (Pressing an action is scenario z.)
const { barDriver } = require('../barDriver.js');

// What the page's own scripts can learn about the dock: a div on <html> they cannot look inside.
const hostFacts = (page) =>
  page.evaluate(() => {
    const host = [...document.documentElement.children].find((e) => e.tagName === 'DIV' && /z-index/.test(e.getAttribute('style') || ''));
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    // width: the page's own width (documentElement.clientWidth); a visible scrollbar, as in headed Chrome, is not part of it.
    return { shadowRoot: host.shadowRoot, children: host.children.length, text: host.textContent, attrs: host.getAttributeNames().sort(), left: rect.left, right: rect.right, cx: rect.left + rect.width / 2, bottomGap: window.innerHeight - rect.bottom, width: document.documentElement.clientWidth, height: window.innerHeight, position: getComputedStyle(host).position, zIndex: Number(getComputedStyle(host).zIndex) };
  });
const prefs = (page) => page.evaluate(() => localStorage.getItem('agentbuddy-bar'));
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

module.exports = {
  id: 'y',
  title: 'Dock on the ServiceNow page: bottom centre, out of the page\'s reach, open / fold / move, names its icons, hides when it should',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.ensureEnabled();
    await ctx.configure(
      { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', previewMode: 'always', instances: [inst.origin], quickBarOpen: true, quickPins: {}, pageBar: true },
      { key: { provider: 'custom', value: ai.key } }
    );
    await ctx.ext(() => chrome.storage.session.remove('ab:launch'));

    const path = `/incident.do?sys_id=${data.INCIDENT_ID}`;
    const ticket = await ctx.openInstancePage(path, 'ticket-pagebar');
    await ticket.evaluate(() => localStorage.removeItem('agentbuddy-bar'));
    await ticket.reload({ waitUntil: 'load' });
    const bar = await barDriver(ticket);
    const state = () => bar.view();
    const until = (what, test, timeout = 12000) => ctx.waitUntil(what, async () => test(await state()), { timeout });

    // 1. It appears on a record, folded to a small pill, at the bottom centre.
    await until('the dock to appear', (v) => v.visible);
    let v = await state();
    t.check('on a record the dock appears, folded to its small pill', v.handleShown && v.folded && !v.open && !v.expanded, JSON.stringify(v));
    t.check('the pill has its size and look although the page has a strict Content-Security-Policy (the styles are not an inline <style>)', v.handleBox && Math.round(v.handleBox.width) === 36 && Math.round(v.handleBox.height) === 36 && v.dockBox && Math.round(v.dockBox.height) === 48, JSON.stringify({ handle: v.handleBox, dock: v.dockBox }));
    t.check('the pill shows the Buddy mark (a drawn icon, nothing loaded)', (await bar.elements()).some((e) => e.tag === 'svg' && /mark/.test(e.cls)));
    const handleEl = await bar.find('handle');
    t.check('it is a button named for a screen reader, and says it is folded', handleEl?.tag === 'button' && /Open the Agent Buddy quick actions/.test(handleEl.attrs['aria-label'] || '') && handleEl.attrs['aria-expanded'] === 'false', JSON.stringify(handleEl?.attrs));

    // 2. Where it is, and what the page itself can see of it.
    let facts = await hostFacts(ticket);
    t.check('the page sees one element it cannot look into: no shadow root handle, no children, no text', Boolean(facts) && facts.shadowRoot === null && facts.children === 0 && facts.text === '', JSON.stringify(facts));
    t.check('that element has no id, no class and no name of the extension', Boolean(facts) && facts.attrs.join(',') === 'style', JSON.stringify(facts?.attrs));
    t.check('it is fixed to the window, in the middle of its width', facts.position === 'fixed' && near(facts.cx, facts.width / 2, 2), JSON.stringify({ cx: facts.cx, width: facts.width }));
    t.check('...and a little above the bottom edge', near(facts.bottomGap, 16, 2), JSON.stringify({ gap: facts.bottomGap }));
    t.check("it sits BELOW the page's own dialogs: a layer under the classic UI's dialog backdrop (1040) and dialog (1050)", facts.zIndex > 0 && facts.zIndex < 1040, String(facts.zIndex));

    // 2b. While the page shows a dialog the dock is not there at all; it comes back when the dialog closes.
    await ticket.evaluate(() => document.body.classList.add('modal-open'));
    await until('the dock to hide while a dialog is open', (x) => !x.visible, 8000);
    t.check('a dialog opens on the page (body.modal-open): the dock hides', !(await state()).visible);
    await ticket.evaluate(() => document.body.classList.remove('modal-open'));
    await until('the dock to come back after the dialog', (x) => x.visible, 8000);
    t.check('the dialog closes: the dock is back', (await state()).visible);
    // A classic form keeps a hidden light box (display: none, aria-modal="true") in the page all the time: only a shown dialog hides the dock.
    await ticket.evaluate(() => {
      const box = document.createElement('div');
      box.id = 'ab-test-lightbox';
      box.setAttribute('aria-modal', 'true');
      box.className = 'modal';
      box.style.display = 'none';
      document.body.append(box);
    });
    await ctx.sleep(3500);
    t.check('a dialog that is in the page but not shown does not hide the dock', (await state()).visible);
    await ticket.evaluate(() => (document.getElementById('ab-test-lightbox').style.display = 'block'));
    await until('the dock to hide behind the shown dialog', (x) => !x.visible, 8000);
    t.check('the same dialog shown: the dock hides', !(await state()).visible);
    await ticket.evaluate(() => document.getElementById('ab-test-lightbox').remove());
    await until('the dock to come back', (x) => x.visible, 8000);
    t.check('the page can not reach the buttons by searching the document', await ticket.evaluate(() => !document.querySelector('button.handle, .act, .dock') && ![...document.querySelectorAll('*')].some((e) => /Agent Buddy/.test(e.getAttribute('aria-label') || ''))));

    // 2c. Drag the folded mark to the right with the mouse: the pill moves by about the pointer's travel, stays folded (a drag is not a
    //     click), and the place is remembered.
    const hb = await bar.box(await bar.find('handle'));
    const cxBefore = (await hostFacts(ticket)).cx;
    await ticket.mouse.move(hb.cx, hb.cy);
    await ticket.mouse.down();
    await ticket.mouse.move(hb.cx + 60, hb.cy, { steps: 6 });
    await ticket.mouse.move(hb.cx + 200, hb.cy, { steps: 6 });
    await ticket.mouse.up();
    await ctx.sleep(300);
    const dragged = await hostFacts(ticket);
    const draggedPrefs = JSON.parse((await prefs(ticket)) || '{}');
    t.check("dragging the mark to the right moves the pill by about the pointer's travel", dragged.cx - cxBefore > 170 && dragged.cx - cxBefore < 230, JSON.stringify({ before: cxBefore, after: dragged.cx }));
    t.check('the drag is not a click: the dock stays folded', (await state()).folded);
    t.check("the new place is remembered in the page, as a share of the window's width", typeof draggedPrefs.x === 'number' && draggedPrefs.x > 55 && near(draggedPrefs.x, (dragged.cx / dragged.width) * 100, 1.5), JSON.stringify(draggedPrefs));

    // 3. Open it with a real click on the mark: the icons appear, the middle of the dock stays where it was.
    await bar.click(await bar.find('handle'));
    await until('the dock to open', (x) => x.open);
    v = await state();
    t.check("a click opens it: the incident's three main actions show, each one as an icon", v.open && !v.folded && JSON.stringify(v.actions) === JSON.stringify(['Summarise', 'Draft a reply', 'Resolution notes']), JSON.stringify(v));
    const all = await bar.elements();
    const acts = all.filter((e) => e.tag === 'button' && e.cls.split(/\s+/).includes('act'));
    // No mark on the icons (a spark in the corner read as a "+"): an AI action says so in its hover name, checked below.
    t.check('every action has a drawn icon, no mark in its corner and no visible words', acts.length === 3 && all.filter((e) => e.tag === 'svg' && e.cls.split(/\s+/).includes('glyph')).length >= 3 && all.filter((e) => e.cls.split(/\s+/).includes('ai-dot')).length === 0, JSON.stringify({ acts: acts.length }));
    const sizes = await Promise.all(acts.map((a) => bar.box(a)));
    t.check('each icon button is a round 36 px target', sizes.every((b) => b && Math.round(b.width) === 36 && Math.round(b.height) === 36), JSON.stringify(sizes.map((b) => b && [b.width, b.height])));
    t.check('its mark reports that it is expanded, and offers to close it', v.expanded && /Close the Agent Buddy/.test((await bar.find('handle')).attrs['aria-label'] || ''));
    t.check('there is no separate fold button: the dock holds the mark and the icons only', !(await bar.elements()).some((e) => e.cls.split(/\s+/).includes('fold')));
    facts = await hostFacts(ticket);
    t.check('opening kept the middle of the dock where the pill was (the dock grows on both sides)', near(facts.cx, dragged.cx, 3) && near(facts.bottomGap, 16, 2), JSON.stringify({ cx: facts.cx, was: dragged.cx, gap: facts.bottomGap }));
    t.check('opening is remembered in the page (two interface choices, nothing about the ticket)', JSON.stringify(Object.keys(JSON.parse(await prefs(ticket))).sort()) === JSON.stringify(['open', 'x']) && JSON.parse(await prefs(ticket)).open === true, await prefs(ticket));

    // 3b. The name of an icon: shown on hover, above the dock, with the AI mark and where the text goes; gone when the pointer leaves.
    await bar.hover(acts[1]);
    await until('the tooltip on hover', (x) => x.tipShown, 4000);
    v = await state();
    const dockBox = v.dockBox;
    t.check('hovering an icon names it, marks it as AI and says where text goes', /Draft a reply/.test(v.tipText) && /AI/.test(v.tipText) && /Uses AI/.test(v.tipText), v.tipText);
    t.check('the tooltip is above the dock and does not cover any icon', v.tipBox && v.tipBox.top + v.tipBox.height <= dockBox.top + 1, JSON.stringify({ tip: v.tipBox, dock: dockBox }));
    t.check('...and inside the window', v.tipBox.left >= 0 && v.tipBox.left + v.tipBox.width <= facts.width, JSON.stringify(v.tipBox));
    await ticket.mouse.move(5, 5, { steps: 3 });
    await until('the tooltip to go away', (x) => !x.tipShown, 4000);
    t.check('the pointer leaves: the tooltip goes', !(await state()).tipShown);

    // 3c. The keyboard: Tab from the mark to the first icon shows its name too; Escape takes the name away first, and folds only on the next.
    await bar.focus(await bar.find('handle'));
    await ticket.keyboard.press('Tab');
    await until('the tooltip on keyboard focus', (x) => x.tipShown, 4000);
    t.check('tabbing to an icon names it, as hovering does', /Summarise/.test((await state()).tipText), (await state()).tipText);
    await ticket.keyboard.press('Escape');
    await ctx.sleep(200);
    v = await state();
    t.check('Escape takes the name away first and leaves the dock open', !v.tipShown && v.open);
    await ticket.keyboard.press('Escape');
    await until('the dock to fold on the second Escape', (x) => x.folded, 4000);
    t.check('a second Escape folds the dock', (await state()).folded && JSON.parse(await prefs(ticket)).open === false);

    // 4. The keyboard moves it: arrow keys on the mark, 5 % a press. Then a click on the mark opens it, and another closes it.
    const xBefore = JSON.parse(await prefs(ticket)).x;
    await bar.focus(await bar.find('handle'));
    await ticket.keyboard.press('ArrowLeft');
    await ticket.keyboard.press('ArrowLeft');
    await ctx.sleep(200);
    const xAfter = JSON.parse(await prefs(ticket)).x;
    t.check('two presses of the left arrow on the mark move the dock 10 % to the left', near(xBefore - xAfter, 10, 0.2), JSON.stringify({ xBefore, xAfter }));
    await bar.click(await bar.find('handle'));
    await until('the dock to open from the mark', (x) => x.open);
    t.check('a click on the mark opens the folded dock', (await state()).open && JSON.parse(await prefs(ticket)).open === true);
    await bar.click(await bar.find('handle'));
    await until('the dock to close', (x) => x.folded);
    t.check('a click on the mark closes the open dock down to the mark, in the same place', (await state()).folded && JSON.parse(await prefs(ticket)).open === false && near(JSON.parse(await prefs(ticket)).x, xAfter, 0.1));

    // 5. A reload finds it where it was left.
    await ticket.reload({ waitUntil: 'load' });
    const again = await barDriver(ticket);
    await ctx.waitUntil('the dock after the reload', async () => (await again.view()).visible, { timeout: 12000 });
    const kept = await again.view();
    const keptFacts = await hostFacts(ticket);
    t.check('after a reload it is folded and in the place it was left', kept.folded && near(keptFacts.cx, (xAfter / 100) * keptFacts.width, 3), JSON.stringify({ cx: keptFacts.cx, wanted: (xAfter / 100) * keptFacts.width }));
    await again.close();

    // 5b. Dragged to the far left edge and open, it stays inside the window.
    await ticket.evaluate(() => localStorage.setItem('agentbuddy-bar', JSON.stringify({ open: true, x: 5 })));
    await ticket.reload({ waitUntil: 'load' });
    const edge = await barDriver(ticket);
    await ctx.waitUntil('the open dock at the left edge', async () => (await edge.view()).open, { timeout: 12000 });
    const edgeFacts = await hostFacts(ticket);
    t.check('open at the far left, the dock keeps a small gap from the window edge instead of leaving it', edgeFacts.left >= 7 && edgeFacts.left <= 9 && edgeFacts.right <= edgeFacts.width, JSON.stringify({ left: edgeFacts.left, right: edgeFacts.right }));
    await edge.close();
    // an older copy's right-edge tab left { open, side, top } in the page: it is read as "open, in the centre"
    await ticket.evaluate(() => localStorage.setItem('agentbuddy-bar', JSON.stringify({ open: false, side: 'left', top: 61 })));
    await ticket.reload({ waitUntil: 'load' });
    const old = await barDriver(ticket);
    await ctx.waitUntil('the dock with old saved choices', async () => (await old.view()).visible, { timeout: 12000 });
    const oldFacts = await hostFacts(ticket);
    t.check('what the older right-edge tab saved (side, top) is ignored: the dock is folded in the centre', (await old.view()).folded && near(oldFacts.cx, oldFacts.width / 2, 2), JSON.stringify({ cx: oldFacts.cx, width: oldFacts.width }));
    await old.close();

    // 6. Only on a record: a page that is not one has no dock.
    await ticket.goto(`${inst.origin}/home`, { waitUntil: 'load' });
    const home = await barDriver(ticket);
    await ctx.sleep(3500);
    t.check('on a page that is not a record there is no dock to see', !(await home.view()).visible);
    await home.close();

    // 7. Switched off in Settings: it does not appear.
    await ctx.configure({ pageBar: false });
    await ticket.goto(`${inst.origin}${path}`, { waitUntil: 'load' });
    const off = await barDriver(ticket);
    await ctx.sleep(3500);
    t.check('with "Show the bar on ServiceNow pages" switched off the record page has no dock', !(await off.view()).visible);
    await off.close();
    await ctx.configure({ pageBar: true });

    // 8. The dock read nothing it should not and wrote nothing.
    t.check('the dock sent nothing to the AI', ai.requests.length === 0, String(ai.requests.length));
    t.check('it left no request for the panel (nothing was pressed)', (await ctx.ext(async () => (await chrome.storage.session.get('ab:launch'))['ab:launch'] ?? null)) === null);

    await bar.close();
    await ticket.close();
  },
};

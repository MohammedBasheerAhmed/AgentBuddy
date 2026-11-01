// y. The bar on the ServiceNow page itself: it stays out of the page's reach, shows on a record and nowhere else, opens, folds and moves
//    with real clicks, can be dragged up or down, remembers its place, sits below the page's dialogs (and hides while one is open),
//    and goes away when it is switched off. (Pressing an action is scenario z.)
const { barDriver } = require('../barDriver.js');

// What the page's own scripts can learn about the bar: a div on <html> they cannot look inside.
const hostFacts = (page) =>
  page.evaluate(() => {
    const host = [...document.documentElement.children].find((e) => e.tagName === 'DIV' && /z-index/.test(e.getAttribute('style') || ''));
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    // width: the page's own width (documentElement.clientWidth); a visible scrollbar, as in headed Chrome, is not part of it.
    return { shadowRoot: host.shadowRoot, children: host.children.length, text: host.textContent, attrs: host.getAttributeNames().sort(), left: rect.left, right: rect.right, top: rect.top, width: document.documentElement.clientWidth, height: window.innerHeight, position: getComputedStyle(host).position, zIndex: Number(getComputedStyle(host).zIndex) };
  });
const prefs = (page) => page.evaluate(() => localStorage.getItem('agentbuddy-bar'));

module.exports = {
  id: 'y',
  title: 'Bar on the ServiceNow page: out of the page\'s reach, open / fold / move, hides when it should',
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

    // 1. It appears on a record, folded.
    await until('the bar to appear', (v) => v.visible);
    let v = await state();
    t.check('on a record the bar appears, folded to its small tab on the right', v.handleShown && !v.cardShown && v.side === 'right' && !v.expanded, JSON.stringify(v));
    t.check('the folded tab has its size and look although the page has a strict Content-Security-Policy (the styles are not an inline <style>)', v.handleBox && Math.round(v.handleBox.width) === 30 && Math.round(v.handleBox.height) === 76, JSON.stringify(v.handleBox));
    const handleEl = await bar.find('handle');
    t.check('the tab shows an icon and the short label "Buddy", not the letters AB', Boolean(handleEl) && handleEl.text === 'Buddy' && (await bar.elements()).some((e) => e.tag === 'svg' && /glyph/.test(e.cls)), JSON.stringify(handleEl && handleEl.text));

    // 2. What the page itself can see of it.
    const facts = await hostFacts(ticket);
    t.check('the page sees one element it cannot look into: no shadow root handle, no children, no text', Boolean(facts) && facts.shadowRoot === null && facts.children === 0 && facts.text === '', JSON.stringify(facts));
    t.check('that element has no id, no class and no name of the extension', Boolean(facts) && facts.attrs.join(',') === 'style', JSON.stringify(facts?.attrs));
    t.check('it is fixed to the right edge of the window', facts.position === 'fixed' && Math.round(facts.right) === facts.width, JSON.stringify({ right: facts.right, width: facts.width }));
    t.check("it sits BELOW the page's own dialogs: a layer under the classic UI's dialog backdrop (1040) and dialog (1050)", facts.zIndex > 0 && facts.zIndex < 1040, String(facts.zIndex));

    // 2b. While the page shows a dialog the bar is not there at all; it comes back when the dialog closes.
    await ticket.evaluate(() => document.body.classList.add('modal-open'));
    await until('the bar to hide while a dialog is open', (x) => !x.visible, 8000);
    t.check('a dialog opens on the page (body.modal-open): the bar hides', !(await state()).visible);
    await ticket.evaluate(() => document.body.classList.remove('modal-open'));
    await until('the bar to come back after the dialog', (x) => x.visible, 8000);
    t.check('the dialog closes: the bar is back', (await state()).visible);
    t.check('the page can not reach the buttons by searching the document', await ticket.evaluate(() => !document.querySelector('button.handle, .act, .card') && ![...document.querySelectorAll('*')].some((e) => /Agent Buddy/.test(e.getAttribute('aria-label') || ''))));

    // 2c. Drag the folded tab down with the mouse: it moves, stays folded (a drag is not a click), and the place is remembered.
    const hb = await bar.box(await bar.find('handle'));
    const topBefore = (await hostFacts(ticket)).top;
    await ticket.mouse.move(hb.cx, hb.cy);
    await ticket.mouse.down();
    await ticket.mouse.move(hb.cx, hb.cy + 60, { steps: 6 });
    await ticket.mouse.move(hb.cx, hb.cy + 120, { steps: 6 });
    await ticket.mouse.up();
    await ctx.sleep(300);
    const dragged = await hostFacts(ticket);
    const draggedPrefs = JSON.parse((await prefs(ticket)) || '{}');
    t.check("dragging the tab down moves it by about the pointer's travel", dragged.top - topBefore > 90 && dragged.top - topBefore < 150, JSON.stringify({ before: topBefore, after: dragged.top }));
    t.check('the drag is not a click: the bar stays folded', (await state()).handleShown && !(await state()).cardShown);
    t.check("the new place is remembered in the page, as a share of the window's height", typeof draggedPrefs.top === 'number' && draggedPrefs.top > 38, JSON.stringify(draggedPrefs));

    // 3. Open it with a real click.
    await bar.click(await bar.find('handle'));
    await until('the bar to open', (x) => x.cardShown);
    v = await state();
    t.check('a click opens it: the card shows the incident\'s three main actions', v.cardShown && !v.handleShown && JSON.stringify(v.actions) === JSON.stringify(['Summarise', 'Draft a reply', 'Resolution notes']), JSON.stringify(v));
    t.check('its tab reports that it is expanded', v.expanded);
    t.check('opening is remembered in the page (three interface choices, nothing about the ticket)', JSON.stringify(Object.keys(JSON.parse(await prefs(ticket))).sort()) === JSON.stringify(['open', 'side', 'top']) && JSON.parse(await prefs(ticket)).open === true, await prefs(ticket));

    // 4. Move it to the other edge, then fold it.
    await bar.click(await bar.find('quiet'));
    await until('the bar to move', (x) => x.side === 'left');
    const moved = await hostFacts(ticket);
    t.check('"Move to the left" puts it on the left edge', Math.round(moved.left) === 0, JSON.stringify({ left: moved.left }));
    t.check('the move is remembered', JSON.parse(await prefs(ticket)).side === 'left');
    await bar.click(await bar.find('icon'));
    await until('the bar to fold', (x) => x.handleShown && !x.cardShown);
    t.check('the fold button folds it back to the tab, which stays on the left', (await state()).side === 'left' && JSON.parse(await prefs(ticket)).open === false);

    // 5. A reload finds it where it was left.
    await ticket.reload({ waitUntil: 'load' });
    const again = await barDriver(ticket);
    await ctx.waitUntil('the bar after the reload', async () => (await again.view()).visible, { timeout: 12000 });
    const kept = await again.view();
    t.check('after a reload it is on the left, folded, as it was left', kept.side === 'left' && kept.handleShown && !kept.cardShown, JSON.stringify(kept));
    t.check('...and at the height it was dragged to', Math.abs((await hostFacts(ticket)).top - dragged.top) < 3, JSON.stringify({ now: (await hostFacts(ticket)).top, dragged: dragged.top }));
    await again.close();

    // 6. Only on a record: a page that is not one has no bar.
    await ticket.goto(`${inst.origin}/home`, { waitUntil: 'load' });
    const home = await barDriver(ticket);
    await ctx.sleep(3500);
    t.check('on a page that is not a record there is no bar to see', !(await home.view()).visible);
    await home.close();

    // 7. Switched off in Settings: it does not appear.
    await ctx.configure({ pageBar: false });
    await ticket.goto(`${inst.origin}${path}`, { waitUntil: 'load' });
    const off = await barDriver(ticket);
    await ctx.sleep(3500);
    t.check('with "Show the bar on ServiceNow pages" switched off the record page has no bar', !(await off.view()).visible);
    await off.close();
    await ctx.configure({ pageBar: true });

    // 8. The bar read nothing it should not and wrote nothing.
    t.check('the bar sent nothing to the AI', ai.requests.length === 0, String(ai.requests.length));
    t.check('it left no request for the panel (nothing was pressed)', (await ctx.ext(async () => (await chrome.storage.session.get('ab:launch'))['ab:launch'] ?? null)) === null);

    await bar.close();
    await ticket.close();
  },
};

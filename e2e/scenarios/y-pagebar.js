// y. The bar on the ServiceNow page itself: it stays out of the page's reach, shows on a record and nowhere else, opens, folds and moves
//    with real clicks, remembers its place, and goes away when it is switched off. (Pressing an action is scenario z.)
const { barDriver } = require('../barDriver.js');

// What the page's own scripts can learn about the bar: a div on <html> they cannot look inside.
const hostFacts = (page) =>
  page.evaluate(() => {
    const host = [...document.documentElement.children].find((e) => e.tagName === 'DIV' && /z-index/.test(e.getAttribute('style') || ''));
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    // width: the page's own width (documentElement.clientWidth); a visible scrollbar, as in headed Chrome, is not part of it.
    return { shadowRoot: host.shadowRoot, children: host.children.length, text: host.textContent, attrs: host.getAttributeNames().sort(), left: rect.left, right: rect.right, width: document.documentElement.clientWidth, position: getComputedStyle(host).position };
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
    t.check('the folded tab has its size and look although the page has a strict Content-Security-Policy (the styles are not an inline <style>)', v.handleBox && Math.round(v.handleBox.width) === 30 && Math.round(v.handleBox.height) === 60, JSON.stringify(v.handleBox));

    // 2. What the page itself can see of it.
    const facts = await hostFacts(ticket);
    t.check('the page sees one element it cannot look into: no shadow root handle, no children, no text', Boolean(facts) && facts.shadowRoot === null && facts.children === 0 && facts.text === '', JSON.stringify(facts));
    t.check('that element has no id, no class and no name of the extension', Boolean(facts) && facts.attrs.join(',') === 'style', JSON.stringify(facts?.attrs));
    t.check('it is fixed to the right edge of the window', facts.position === 'fixed' && Math.round(facts.right) === facts.width, JSON.stringify({ right: facts.right, width: facts.width }));
    t.check('the page can not reach the buttons by searching the document', await ticket.evaluate(() => !document.querySelector('button.handle, .act, .card') && ![...document.querySelectorAll('*')].some((e) => /Agent Buddy/.test(e.getAttribute('aria-label') || ''))));

    // 3. Open it with a real click.
    await bar.click(await bar.find('handle'));
    await until('the bar to open', (x) => x.cardShown);
    v = await state();
    t.check('a click opens it: the card shows the incident\'s three main actions', v.cardShown && !v.handleShown && JSON.stringify(v.actions) === JSON.stringify(['Summarise', 'Draft a reply', 'Resolution notes']), JSON.stringify(v));
    t.check('its tab reports that it is expanded', v.expanded);
    t.check('opening is remembered in the page (two interface choices, nothing about the ticket)', JSON.stringify(JSON.parse(await prefs(ticket))) === JSON.stringify({ open: true, side: 'right' }), await prefs(ticket));

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

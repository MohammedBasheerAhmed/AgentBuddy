// s. The Team tab and the full-page dashboard, through the real panel, content script and an extension page in a tab:
//    - Overview, Workload, SLA risk radar, Quality and Request fulfilment all load from GET-only Table and Aggregate reads
//    - a number or a ticket in a report opens the right ServiceNow list or record in the tab, on the same instance
//    - Customize (add a section, rename, a second dashboard) keeps CONFIGURATION only in storage: no number, name or ticket
//    - "Download CSV" builds the file in the browser from the numbers on screen; "Mask names and emails" removes the names
//    - "Open full page" opens dashboard.html in a new tab, which finds its source tab (the content script must answer an extension
//      page in a tab), renders the same report, and shows a calm message when the ServiceNow tab is closed
const { prepare, errorMark, errorsSince, describeErrors, clickTab, clickButton, waitForText, textOf, waitPanel, frameByPath } = require('../common.js');
const { findLeaks } = require('../leaks.js');

const widget = (title) => `section.ab-widget[aria-label="${title}"]`;
const text = (p) => p.evaluate(() => document.body.innerText);

/** Wait until a widget has its numbers (or its own error line). */
async function widgetReady(ctx, p, title, timeout = 30000) {
  return waitPanel(ctx, p, `the "${title}" widget to load`, async () =>
    p.evaluate((sel) => {
      const el = document.querySelector(sel);
      return Boolean(el && el.querySelector('.ab-widget-foot') && el.getAttribute('aria-busy') !== 'true');
    }, widget(title)), { timeout });
}
const widgetText = (p, title) => p.$eval(widget(title), (el) => el.innerText.replace(/\s+/g, ' ').trim());
const tileValue = (p, label) =>
  p.evaluate((l) => {
    const t = [...document.querySelectorAll('.ab-tile')].find((x) => x.querySelector('.ab-tile-label')?.innerText.trim() === l);
    return t ? Number(t.querySelector('.ab-tile-value')?.innerText.replace(/[^\d.-]/g, '')) : null;
  }, label);

/** Replace the browser's download with a recorder, so the file the panel builds can be read. */
const recordDownloads = (page) =>
  page.evaluate(() => {
    if (window.__downloadsPatched) return;
    window.__downloadsPatched = true;
    window.__csv = [];
    const blobs = new Map();
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      blobs.set(url, blob);
      return url;
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && blobs.has(this.href)) {
        const name = this.download;
        blobs.get(this.href).text().then((body) => window.__csv.push({ name, body }));
        return undefined;
      }
      return click.call(this);
    };
  });

const numbersIn = (value, path = '', out = []) => {
  if (typeof value === 'number') out.push(`${path}=${value}`);
  else if (Array.isArray(value)) value.forEach((v, i) => numbersIn(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => numbersIn(v, `${path}.${k}`, out));
  return out;
};

module.exports = {
  id: 's',
  title: 'Team tab and full page: all five sections load, drill-down opens the right list, dashboards store configuration only, CSV export, dashboard.html finds its tab',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    await prepare(ctx);
    await ctx.ext((key) => chrome.storage.local.remove(key), 'agentbuddy_dashboards');
    const mark = errorMark(ctx);
    let source = await ctx.openInstancePage('/home', 'home');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await clickTab(p, 'Team');
    const reqFrom = inst.requests.length;

    // ============================== OVERVIEW AND FULFILMENT (the first dashboard) ======================================================
    await widgetReady(ctx, p, 'Overview');
    const tileLabels = ['Open', 'Due soon', 'Breached', 'Waiting', 'Opened today', 'Resolved today'];
    const tileValues = await Promise.all(tileLabels.map((l) => tileValue(p, l)));
    t.check('Team tab: the Overview tiles load, each with a number (open, due soon, breached, waiting, opened and resolved today)', tileValues.every((v) => Number.isFinite(v)), JSON.stringify(Object.fromEntries(tileLabels.map((l, i) => [l, tileValues[i]]))));
    const open = await tileValue(p, 'Open');
    const breached = await tileValue(p, 'Breached');
    t.check('Overview: "Open" counts the agent\'s own active tickets across the six ticket tables (more than the three incidents), "Breached" the SLAs that broke', open >= 6 && breached >= 2, `open=${open} breached=${breached}`);
    const scopeLine = await widgetText(p, 'Overview');
    t.check('Overview says how fresh the numbers are, whose tickets and which tables it covers', /Read at \d\d:\d\d/.test(scopeLine) && /Mine/.test(scopeLine) && /Incidents/.test(scopeLine), scopeLine.slice(-200));
    await widgetReady(ctx, p, 'Request fulfilment');
    t.check('Request fulfilment: requested items and catalog tasks by state, and the oldest open items', /Oldest open items/.test(await widgetText(p, 'Request fulfilment')) && /RITM0010050/.test(await widgetText(p, 'Request fulfilment')));
    await widgetReady(ctx, p, 'SLA risk radar');
    const slaText = await widgetText(p, 'SLA risk radar');
    t.check('SLA risk radar: breached, at risk and due soon counts, from the active SLAs of the agent\'s tickets (dot-walked task query)', /Breached/.test(slaText) && /At risk/.test(slaText) && /active SLAs/.test(slaText), slaText.slice(0, 200));

    // The reads behind all that: GET-only Table / Aggregate, with the dot-walked and grouped queries
    const reads = inst.requests.slice(reqFrom);
    const stats = reads.filter((r) => r.path.startsWith('/api/now/stats/'));
    const grouped = stats.filter((r) => /sysparm_group_by=/.test(r.search));
    const dotWalked = reads.filter((r) => /task_sla/.test(r.path) && /task\.assigned_to%3D|task\.assigned_to=/.test(r.search));
    t.check('the sections used the Aggregate API (counts, grouped counts) and a dot-walked task_sla query, all as GETs', stats.length >= 10 && grouped.length >= 3 && dotWalked.length >= 1 && reads.every((r) => r.method === 'GET'), `${stats.length} stats, ${grouped.length} grouped, ${dotWalked.length} dot-walked`);
    t.check('no read of the Team tab failed (no 4xx/5xx from the instance)', reads.every((r) => r.status === 0 || r.status < 400), reads.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.path}`).join(' | '));

    // ============================== DRILL DOWN ====================================================================================
    await p.evaluate(() => [...document.querySelectorAll('.ab-tile-button')].find((b) => b.querySelector('.ab-tile-label')?.innerText.trim() === 'Open').click());
    await p.waitForSelector('.ab-pick [class*="ab-btn"]', { timeout: 8000 });
    const picks = await p.$$eval('.ab-pick button', (bs) => bs.map((b) => b.innerText.trim()));
    t.check('a number with several tables behind it offers them by name ("Open in ServiceNow": Incidents, Requested items, ...)', picks.some((x) => /^Incidents \(\d+\)$/.test(x)) && picks.length >= 3, picks.join(' | '));
    await p.evaluate(() => [...document.querySelectorAll('.ab-pick button')].find((b) => /^Incidents/.test(b.innerText.trim())).click());
    await ctx.waitUntil('the tab to open the incident list', async () => source.url().includes('nav_to.do'), { timeout: 10000 });
    const listUrl = new URL(source.url());
    const inner = decodeURIComponent(listUrl.searchParams.get('uri') || '');
    t.check('the click opened the incident LIST in the same tab, on the same instance, with the agent\'s own open tickets as the filter', listUrl.origin === inst.origin && /^incident_list\.do\?sysparm_query=/.test(inner) && inner.includes(`assigned_to=${data.ME.sysId}`) && inner.includes('active=true'), inner);
    await ctx.waitUntil('the list page to say what it shows', async () => (await frameByPath(source, inst.origin, '/incident_list.do')?.evaluate(() => document.getElementById('list-table')?.innerText).catch(() => '')) === 'incident', { timeout: 10000 });
    t.check('the fake instance served that list (its table and filter are printed on the page)', (await frameByPath(source, inst.origin, '/incident_list.do').evaluate(() => document.getElementById('list-query').innerText)).includes(`assigned_to=${data.ME.sysId}`));
    await ctx.waitUntil('the panel to still show the Team tab', async () => (await p.$(widget('Overview'))) !== null, { timeout: 15000 });
    t.check('the panel kept its Team tab and its numbers after the tab moved to the list', (await tileValue(p, 'Open')) === open);

    // A ticket in the SLA radar opens the record
    const ticketLink = await p.$(`${widget('SLA risk radar')} .ab-chart-link`);
    if (ticketLink) {
      const label = await ticketLink.evaluate((el) => el.innerText.trim());
      await ticketLink.click();
      await ctx.waitUntil('the tab to open the ticket', async () => /sys_id%3D[0-9a-f]{32}/i.test(source.url()), { timeout: 10000 });
      t.check(`a ticket in the SLA radar (${label}) opens its record, in the same tab, on the same instance`, source.url().startsWith(inst.origin) && decodeURIComponent(source.url()).includes('.do?sys_id='), decodeURIComponent(source.url()).slice(0, 120));
    } else {
      t.warning('the SLA radar listed no ticket to open (the ticket details were not readable)', '');
    }
    await source.close();
    source = await ctx.openInstancePage('/home', 'home');

    // ============================== WORKLOAD AND QUALITY: Customize -> add section -> saved ===================================================
    await clickButton(p, /^Customize/);
    await p.waitForSelector('.ab-customize', { timeout: 8000 });
    for (const [value, title] of [['workload', 'Workload and ageing'], ['quality', 'Quality and trend']]) {
      await p.select('.ab-customize select.ab-select', value);
      await clickButton(p, /^Add section/);
      await widgetReady(ctx, p, title);
      const body = await widgetText(p, title);
      t.check(`Customize > Add section: "${title}" is added to the dashboard and loads (no error line)`, (await p.$(`${widget(title)} .ab-note-danger`)) === null && body.length > 80, body.slice(0, 160));
    }
    await clickButton(p, /^Done/);
    t.check('Workload: the ageing buckets and the open work by state are there', /Open/.test(await widgetText(p, 'Workload and ageing')));
    t.check('Quality: opened against resolved, and the top categories, are there', /Opened|resolved/i.test(await widgetText(p, 'Quality and trend')));

    // "My groups": the memberships are read (sys_user_grmember), and the people / group breakdown appears
    await clickButton(p, /^My groups/);
    await waitPanel(ctx, p, 'the group scope', async () => /Network Support/.test(await text(p)), { timeout: 25000 });
    await widgetReady(ctx, p, 'Workload and ageing');
    await ctx.sleep(600);
    const wl = await widgetText(p, 'Workload and ageing');
    t.check('scope "My groups": the groups the agent belongs to (Network Support, Desktop Support) are used and the workload shows people and groups', /Network Support/.test(wl) && /Desktop Support|Anglin|Loftus/.test(wl), wl.slice(0, 220));
    const groupReads = inst.requests.slice(reqFrom).filter((r) => r.path === '/api/now/table/sys_user_grmember');
    t.check('...read from sys_user_grmember (one GET for the person\'s own memberships)', groupReads.length >= 1 && groupReads.every((r) => r.method === 'GET'));
    await clickButton(p, /^Mine/);
    await widgetReady(ctx, p, 'Overview');

    // ============================== WHAT IS STORED ==============================================================================================
    await clickButton(p, /^Customize/);
    await p.type('#ab-dash-name', ' for the network team');
    await p.keyboard.press('Enter');
    await clickButton(p, /^New dashboard/);
    await ctx.sleep(500);
    await clickButton(p, /^Done/);
    const stored = await ctx.ext(async () => (await chrome.storage.local.get('agentbuddy_dashboards')).agentbuddy_dashboards);
    const storedText = JSON.stringify(stored);
    const leaks = findLeaks(storedText, data);
    const nums = numbersIn(stored).filter((n) => !/(version|\.v|\.max|\.cap)=/.test(n));
    t.check('storage holds the dashboards as configuration: sections, order, scope, tables and names of dashboards', Boolean(stored) && /overview/.test(storedText) && /workload/.test(storedText) && /quality/.test(storedText) && /for the network team/.test(storedText), storedText.slice(0, 200));
    t.check('...and NO number from a report, no ticket number, no person\'s name, no email', leaks.critical.length === 0 && leaks.gaps.length === 0 && !/INC\d{5,}|RITM\d{5,}|CS\d{5,}|Anglin|Tuter|@example/.test(storedText) && nums.length === 0, `${leaks.critical.join(' | ')} ${nums.slice(0, 5).join(' ')}`);
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('.ab-app', { timeout: 10000 });
    await clickTab(p, 'Team');
    await waitForText(p, 'Overview', { timeout: 20000 });
    const selected = await p.$eval('.ab-dash-toolbar select', (el) => el.options[el.selectedIndex].innerText);
    t.check('after the panel was reloaded the saved dashboard (renamed, with the added sections) comes back', /for the network team|New dashboard/.test(selected), selected);

    // ============================== CSV EXPORT =============================================================================================
    await p.select('.ab-dash-toolbar select', await p.$$eval('.ab-dash-toolbar select option', (os) => os.find((o) => /Team overview|My day at a glance/.test(o.innerText))?.value || os[0].value));
    await widgetReady(ctx, p, 'Request fulfilment');
    await recordDownloads(p);
    await p.evaluate((sel) => [...document.querySelector(sel).querySelectorAll('button')].find((b) => /^Download CSV/.test(b.innerText.trim())).click(), widget('Request fulfilment'));
    await ctx.waitUntil('the CSV', async () => (await p.evaluate(() => window.__csv.length)) >= 1, { timeout: 8000 });
    const csv = (await p.evaluate(() => window.__csv))[0];
    t.check('"Download CSV" builds a .csv file in the browser from the table on screen (name, byte-order mark, header and rows)', /\.csv$/.test(csv.name) && csv.body.startsWith('﻿') && /RITM0010050/.test(csv.body) && csv.body.split('\n').length >= 3, `${csv.name} ${csv.body.slice(0, 80).replace(/\n/g, '|')}`);
    t.check('...with the real names (this is the person\'s own data, on their own computer)', /Beth Anglin/.test(csv.body));
    await p.evaluate((sel) => [...document.querySelector(sel).querySelectorAll('input[type="checkbox"]')].find((i) => i.closest('label')?.innerText.includes('Mask names and emails')).click(), widget('Request fulfilment'));
    await p.evaluate((sel) => [...document.querySelector(sel).querySelectorAll('button')].find((b) => /^Download CSV/.test(b.innerText.trim())).click(), widget('Request fulfilment'));
    await ctx.waitUntil('the masked CSV', async () => (await p.evaluate(() => window.__csv.length)) >= 2, { timeout: 8000 });
    const masked = (await p.evaluate(() => window.__csv))[1];
    t.check('"Mask names and emails": the next file has Person 1 instead of the name', /Person 1/.test(masked.body) && !/Beth Anglin/.test(masked.body) && findLeaks(masked.body, data).critical.length === 0, masked.body.slice(0, 160).replace(/\n/g, '|'));
    await p.evaluate((sel) => [...document.querySelector(sel).querySelectorAll('input[type="checkbox"]')].find((i) => i.closest('label')?.innerText.includes('Mask names and emails')).click(), widget('Request fulfilment'));
    t.check('nothing in the Team tab used the AI', ai.requests.length === 0);

    // ============================== FULL PAGE ==============================================================================================
    const sourceTabId = await ctx.ext(async (origin) => (await chrome.tabs.query({})).find((x) => (x.url || '').startsWith(`${origin}/home`))?.id, inst.origin);
    const before = new Set(ctx.browser.targets());
    await clickButton(p, /^Open full page/);
    const target = await ctx.browser.waitForTarget((x) => !before.has(x) && x.url().includes('dashboard.html'), { timeout: 10000 });
    const dash = await target.page();
    await dash.waitForSelector('.ab-dashboard-page', { timeout: 10000 });
    t.check('"Open full page" opened dashboard.html in a new tab, naming the ServiceNow tab it reads through', new URL(target.url()).pathname === '/dashboard.html' && new URL(target.url()).searchParams.get('tab') === String(sourceTabId), target.url());
    await waitForText(dash, /Reading from localhost:\d+ with your own session/, { timeout: 20000 });
    t.check('...it found its source tab (the content script answered an extension page in a tab) and says which site it reads from', true);
    await widgetReady(ctx, dash, 'Overview');
    t.check('the full page shows the same report, in its own layout', (await tileValue(dash, 'Open')) >= 6 && (await dash.$('.ab-dash-page')) !== null, `open=${await tileValue(dash, 'Open')}`);
    await widgetReady(ctx, dash, 'Request fulfilment');
    // Drill-down from the full page brings the ServiceNow tab to the front and leaves the dashboard open
    await dash.evaluate((sel) => document.querySelector(`${sel} .ab-chart-link`)?.click(), widget('Request fulfilment'));
    await ctx.waitUntil('the ServiceNow tab to open the record', async () => /sys_id%3D[0-9a-f]{32}/i.test(source.url()), { timeout: 10000 });
    t.check('from the full page a ticket opens in the ServiceNow tab (same instance) and the dashboard tab stays open', source.url().startsWith(inst.origin) && !dash.isClosed(), decodeURIComponent(source.url()).slice(0, 100));
    // Closing the source tab: a calm message
    await source.close();
    await waitForText(dash, /The ServiceNow tab this dashboard was opened for has been closed/, { timeout: 15000 });
    t.check('closing the ServiceNow tab: the full page says so calmly, with what to do (no error, no blank page)', (await dash.$('.ab-note-danger')) === null && /Open ServiceNow again/.test(await text(dash)));
    const dashErrors = errorsSince(ctx, mark).filter((e) => e.from.includes('dashboard') || (e.url || '').includes('dashboard.html'));
    t.check('the full page logged no console error, page error or CSP violation', dashErrors.length === 0, describeErrors(dashErrors));
    t.check('...and no CSP violation event', (await dash.evaluate(() => window.__cspViolations || [])).length === 0);
    await dash.close();

    const bad = errorsSince(ctx, mark);
    t.check('no console error, page error or CSP violation on the Team tab or the full page', bad.length === 0, describeErrors(bad));
    await panel.close();
    await ctx.ext((key) => chrome.storage.local.remove(key), 'agentbuddy_dashboards');
  },
};

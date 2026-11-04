// s. The Team screen (round 3) and the full-page dashboard, through the real panel, content script and an extension page in a tab:
//    - Team is there for the team-lead profile; its Insights half opens on "Team overview" for the lead's groups, with a quiet top
//      row (dashboard, scope chip, one "⋯" menu) and no AI element
//    - Overview, Workload, SLA risk radar, Quality and Request fulfilment all load from GET-only Table and Aggregate reads
//    - a number or a ticket in a report opens the right ServiceNow list or record in the tab, on the same instance
//    - Customize (from the menu: add a section, rename, a second dashboard) keeps CONFIGURATION only in storage, per instance
//    - Export (one panel for the dashboard) builds a CSV in the browser from the numbers on screen; "Mask names and emails" works
//    - the AI Assist half has the hand-over note, "Explain this dashboard" (run once, through the preview) and coaching behind its gate
//    - "Open full page" opens dashboard.html in a new tab, which finds its source tab, renders the same report, and shows a calm
//      message when the ServiceNow tab is closed
const { prepare, errorMark, errorsSince, describeErrors, clickButton, waitForText, waitPanel, frameByPath } = require('../common.js');
const { openScreen, openHalf } = require('../ui.js');
const { findLeaks } = require('../leaks.js');

const widget = (title) => `section.ab-widget[aria-label="${title}"]`;
const text = (p) => p.evaluate(() => document.body.innerText);

/** Wait until a widget has its numbers, or its own reason, or its own error line. */
async function widgetReady(ctx, p, title, timeout = 30000) {
  return waitPanel(ctx, p, `the "${title}" widget to load`, async () =>
    p.evaluate((sel) => {
      const el = document.querySelector(sel);
      return Boolean(el && ['ready', 'unavailable', 'error'].includes(el.getAttribute('data-state')) && el.getAttribute('aria-busy') !== 'true');
    }, widget(title)), { timeout });
}
const widgetText = (p, title) => p.$eval(widget(title), (el) => el.innerText.replace(/\s+/g, ' ').trim());
/** After the ServiceNow tab moved, the dashboard reads its numbers again: wait until every widget is done. */
async function settleWidgets(ctx, page) {
  await ctx.sleep(1200);
  await waitPanel(ctx, page, 'every widget to finish reading', async () => page.evaluate(() => [...document.querySelectorAll('section.ab-widget[data-state]')].every((w) => w.getAttribute('aria-busy') !== 'true' && w.getAttribute('data-state') !== 'loading')), { timeout: 30000 });
  await ctx.sleep(500);
}
const tileValue = (p, label) =>
  p.evaluate((l) => {
    // (window.__vis exists on the panel page only; the full page is a plain tab)
    const t = [...document.querySelectorAll('.ab-tile')].filter((e) => e.getClientRects().length > 0).find((x) => x.querySelector('.ab-tile-label')?.innerText.trim() === l);
    return t ? Number(t.querySelector('.ab-tile-value')?.innerText.replace(/[^\d.-]/g, '')) : null;
  }, label);
/** Open the dashboard's one "⋯" menu (the one on screen) and choose an item. */
async function menu(p, label) {
  await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-more-btn'))[0].click());
  await p.waitForSelector('[role="menu"]', { timeout: 8000 });
  await clickButton(p, label);
}
/** Choose a dashboard in the top row's picker. */
const pickDashboard = (p, value) => p.select('.ab-dash-toolbar select', value);

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
        // (Blob.text() drops a leading byte-order mark, so the bytes are read to see it.)
        blobs.get(this.href).arrayBuffer().then((buf) => {
          const bytes = new Uint8Array(buf);
          window.__csv.push({ name, bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, body: new TextDecoder('utf-8', { ignoreBOM: false }).decode(buf) });
        });
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
  title: 'Team screen and full page: lead default, quiet top row, all five sections load, drill-down, per-instance configuration, one export panel, AI Assist half, dashboard.html finds its tab',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    await prepare(ctx);
    await ctx.configure({ profiles: ['it', 'lead'], profilesConfirmed: true });
    await ctx.ext((key) => chrome.storage.local.remove(key), 'agentbuddy_dashboards');
    const mark = errorMark(ctx);
    let source = await ctx.openInstancePage('/home', 'home');
    const panel = await ctx.openPanel();
    const p = panel.page;
    const reqFrom = inst.requests.length;
    await openScreen(p, 'Team');
    await openHalf(p, 'insights');

    // ============================== THE LEAD'S FIRST LOOK ===========================================================================
    await widgetReady(ctx, p, 'Overview');
    const first = await p.evaluate(() => {
      const top = window.__vis(document.querySelectorAll('.ab-dash-top'))[0];
      const sel = top?.querySelector('select');
      return { controls: top ? top.querySelectorAll('select, button').length : 0, dash: sel ? sel.options[sel.selectedIndex].text : '', chip: top?.querySelector('.ab-scope-chip')?.innerText.trim() || '' };
    });
    t.check('Team opens on "Team overview" for the lead\'s groups, with three controls before the first number (dashboard, scope chip, one menu)', first.dash === 'Team overview' && /^My groups \(\d+/.test(first.chip) && first.controls === 3, JSON.stringify(first));
    const insightsAi = await p.evaluate(() => window.__vis(document.querySelectorAll('#ab-team-half-panel-insights .ab-ai-badge')).length);
    t.check('the Insights half carries no AI element (no AI mark, no AI button)', insightsAi === 0 && !/Explain these numbers|Write the hand-over note/.test(await p.$eval('#ab-team-half-panel-insights', (el) => el.innerText)));
    t.check('no export bar under every widget any more (one export panel per dashboard)', !(await p.evaluate(() => window.__vis(document.querySelectorAll('button')).some((b) => /^(Download CSV|Copy as table)$/.test(b.innerText.trim())))));

    // ============================== OVERVIEW AND FULFILMENT (my own tickets) ======================================================
    await pickDashboard(p, 'preset-my-day');
    await widgetReady(ctx, p, 'Overview');
    const tileLabels = ['Open', 'Due soon', 'Breached', 'Waiting', 'Opened today', 'Resolved today'];
    const tileValues = await Promise.all(tileLabels.map((l) => tileValue(p, l)));
    t.check('"My numbers": the Overview tiles load, each with a number (open, due soon, breached, waiting, opened and resolved today)', tileValues.every((v) => Number.isFinite(v)), JSON.stringify(Object.fromEntries(tileLabels.map((l, i) => [l, tileValues[i]]))));
    const open = await tileValue(p, 'Open');
    const breached = await tileValue(p, 'Breached');
    t.check('Overview: "Open" counts the agent\'s own active tickets across the ticket tables (more than the three incidents), "Breached" the SLAs that broke', open >= 6 && breached >= 2, `open=${open} breached=${breached}`);
    const status = await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-statusline'))[0]?.innerText || '');
    const chip = await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-scope-chip'))[0]?.innerText.trim());
    t.check('the dashboard says once how fresh the numbers are, how many tables, and whose tickets', /Read at \d\d:\d\d · \d+ tables/.test(status) && chip === 'Mine', `${status} | ${chip}`);
    await widgetReady(ctx, p, 'Request fulfilment');
    t.check('Request fulfilment: requested items and catalog tasks by state, and the oldest open items', /Oldest open items/.test(await widgetText(p, 'Request fulfilment')) && /RITM0010050/.test(await widgetText(p, 'Request fulfilment')));
    await widgetReady(ctx, p, 'SLA risk radar');
    const slaText = await widgetText(p, 'SLA risk radar');
    // One number once: next to Overview the radar draws only its own count (At risk); Breached and Due soon are Overview's tiles.
    const radarTiles = await p.$$eval(`${widget('SLA risk radar')} .ab-tile-label`, (els) => els.map((el) => el.innerText.trim()));
    t.check('SLA risk radar: the at-risk count from the active SLAs of the agent\'s tickets (dot-walked task query); breached and due soon are said once, by Overview', /At risk/.test(slaText) && /active SLAs/.test(slaText) && JSON.stringify(radarTiles) === '["At risk"]' && Number.isFinite(await tileValue(p, 'Due soon')) && breached >= 2, `${JSON.stringify(radarTiles)} | ${slaText.slice(0, 160)}`);
    t.check('SLA risk radar: a short list that says when, in words ("Breached 2 h ago", "Due in 1 h 20 min"), not a timestamp', /(Breached|Due in|Overdue by) [\d]|Breached ·|No SLA is at risk/.test(slaText) && !/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/.test(slaText), slaText.slice(0, 300));

    // The reads behind all that: GET-only Table / Aggregate, with the dot-walked and grouped queries
    const reads = inst.requests.slice(reqFrom);
    const stats = reads.filter((r) => r.path.startsWith('/api/now/stats/'));
    const grouped = stats.filter((r) => /sysparm_group_by=/.test(r.search));
    const dotWalked = reads.filter((r) => /task_sla/.test(r.path) && /task\.assigned_to%3D|task\.assigned_to=/.test(r.search));
    t.check('the sections used the Aggregate API (counts, grouped counts) and a dot-walked task_sla query, all as GETs', stats.length >= 10 && grouped.length >= 3 && dotWalked.length >= 1 && reads.every((r) => r.method === 'GET'), `${stats.length} stats, ${grouped.length} grouped, ${dotWalked.length} dot-walked`);
    t.check('no read of the Team screen failed (no 4xx/5xx from the instance)', reads.every((r) => r.status === 0 || r.status < 400), reads.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.path}`).join(' | '));
    const memberRead = reads.find((r) => r.path === '/api/now/table/sys_user_grmember');
    t.check('"my groups" asks for active groups only (group.active=true)', Boolean(memberRead) && /group\.active%3Dtrue|group\.active=true/.test(memberRead.search), memberRead?.search.slice(0, 160));
    t.check('the person\'s own time zone is read softly, one column of their own user record, as a GET', reads.some((r) => r.path === '/api/now/table/sys_user' && /time_zone/.test(r.search) && r.method === 'GET'));

    // ============================== DRILL DOWN ====================================================================================
    const drillHrefs = await p.$$eval('a[data-ab-link]', (as) => as.map((a) => a.href));
    t.check('every ticket and list link the Team screen draws is a real link to the ServiceNow site itself, and nowhere else', drillHrefs.length > 0 && drillHrefs.every((h) => h.startsWith(`${inst.origin}/`)), `${drillHrefs.length} links; ${drillHrefs.filter((h) => !h.startsWith(`${inst.origin}/`)).slice(0, 2).join(' | ')}`);
    await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-tile-button')).find((b) => b.querySelector('.ab-tile-label')?.innerText.trim() === 'Open').click());
    await p.waitForSelector('.ab-pick [class*="ab-btn"]', { timeout: 8000 });
    const picks = await p.$$eval('.ab-pick a', (bs) => bs.map((b) => b.innerText.trim()));
    t.check('a number with several tables behind it offers them by name ("Open in ServiceNow": Incidents, Requested items, ...)', picks.some((x) => /^Incidents \(\d+\)$/.test(x)) && picks.length >= 3, picks.join(' | '));
    await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-pick a')).find((b) => /^Incidents/.test(b.innerText.trim())).click());
    await ctx.waitUntil('the tab to open the incident list', async () => source.url().includes('nav_to.do'), { timeout: 10000 });
    const listUrl = new URL(source.url());
    const inner = decodeURIComponent(listUrl.searchParams.get('uri') || '');
    t.check('the click opened the incident LIST in the same tab, on the same instance, with the agent\'s own open tickets as the filter', listUrl.origin === inst.origin && /^incident_list\.do\?sysparm_query=/.test(inner) && inner.includes(`assigned_to=${data.ME.sysId}`) && inner.includes('active=true'), inner);
    await ctx.waitUntil('the list page to say what it shows', async () => (await frameByPath(source, inst.origin, '/incident_list.do')?.evaluate(() => document.getElementById('list-table')?.innerText).catch(() => '')) === 'incident', { timeout: 10000 });
    t.check('the fake instance served that list (its table and filter are printed on the page)', (await frameByPath(source, inst.origin, '/incident_list.do').evaluate(() => document.getElementById('list-query').innerText)).includes(`assigned_to=${data.ME.sysId}`));
    await ctx.waitUntil('the panel to still show the Team screen', async () => (await p.$(widget('Overview'))) !== null, { timeout: 15000 });
    await settleWidgets(ctx, p);
    t.check('the panel kept its Team screen and its numbers after the tab moved to the list', (await tileValue(p, 'Open')) === open);

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
    await settleWidgets(ctx, p);
    await source.close();
    source = await ctx.openInstancePage('/home', 'home');
    await settleWidgets(ctx, p);

    // ============================== WORKLOAD AND QUALITY: Customize (from the menu) -> add section -> saved ================================
    await menu(p, /^Customize$/);
    await p.waitForSelector('.ab-customize', { timeout: 8000 });
    for (const [value, title] of [['workload', 'Workload and ageing'], ['quality', 'Quality and trend']]) {
      await p.select('.ab-customize select.ab-select', value);
      await clickButton(p, /^Add section/);
      await widgetReady(ctx, p, title);
      const body = await widgetText(p, title);
      t.check(`Customize > Add section: "${title}" is added to the dashboard and loads (no error line)`, (await p.$(`${widget(title)} .ab-note-danger`)) === null && body.length > 80, body.slice(0, 160));
    }
    const offered = await p.$$eval('.ab-customize select.ab-select option', (os) => os.map((o) => o.value));
    t.check('Customize offers no AI section (Explain this dashboard and coaching are under AI Assist)', !offered.includes('insights') && !offered.includes('coaching'), offered.join(','));
    // The custom report editor opens and previews (it once threw on opening: no scenario had opened it).
    await clickButton(p, /^Add custom report$/);
    const builderOpened = await p.waitForSelector('.ab-builder', { visible: true, timeout: 8000 }).then(() => true, () => false);
    const builderText = builderOpened ? await p.$eval('.ab-builder', (e) => e.innerText) : '';
    t.check('Customize > Add custom report: the editor opens with its fields (no error in its place)', builderOpened && /New custom report/.test(builderText) && /Preview/.test(builderText), builderText.slice(0, 160));
    await clickButton(p, /^Preview$/);
    const previewed = await p.waitForFunction(() => {
      const box = document.querySelector('.ab-builder');
      return box && /in total|nothing to average|No ticket|could not|not available/i.test(box.innerText);
    }, { timeout: 10000 }).then(() => true, () => false);
    t.check('the editor\'s Preview reads and shows a number', previewed && !/could not/i.test(await p.$eval('.ab-builder', (e) => e.innerText)), (await p.$eval('.ab-builder', (e) => e.innerText).catch(() => '')).slice(-200));
    await clickButton(p, /^Cancel$/);
    await p.waitForFunction(() => !document.querySelector('.ab-builder'), { timeout: 5000 }).catch(() => {});
    await clickButton(p, /^Done$/);
    const workloadTiles = await p.$$eval(`${widget('Workload and ageing')} .ab-tile-label`, (els) => els.map((el) => el.innerText.trim()));
    t.check('Workload: the ageing buckets are there, and next to Overview none of Overview\'s counts again (Open, Unassigned, No update)', /How long tickets have been open/.test(await widgetText(p, 'Workload and ageing')) && !workloadTiles.some((l) => tileLabels.includes(l) || /^(Unassigned|No update in)/.test(l)), JSON.stringify(workloadTiles));
    t.check('Quality: opened against resolved, and the top categories, are there', /Opened|resolved/i.test(await widgetText(p, 'Quality and trend')));

    // "My groups": the memberships are read (sys_user_grmember), and the people / group breakdown appears
    await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-scope-chip'))[0].click());
    await clickButton(p, /^My groups/);
    await waitPanel(ctx, p, 'the group scope', async () => /Network Support/.test(await text(p)), { timeout: 25000 });
    await widgetReady(ctx, p, 'Workload and ageing');
    await ctx.sleep(600);
    const wl = await widgetText(p, 'Workload and ageing');
    t.check('scope "My groups": the groups the agent belongs to (Network Support, Desktop Support) are used and the workload shows people and groups', /Network Support/.test(wl) && /Desktop Support|Anglin|Loftus/.test(wl), wl.slice(0, 220));
    const groupReads = inst.requests.slice(reqFrom).filter((r) => r.path === '/api/now/table/sys_user_grmember');
    t.check('...read from sys_user_grmember (GETs for the person\'s own memberships)', groupReads.length >= 1 && groupReads.every((r) => r.method === 'GET'));
    await clickButton(p, /^Mine/);
    await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-scope-chip'))[0].click());
    await widgetReady(ctx, p, 'Overview');

    // ============================== WHAT IS STORED ==============================================================================================
    await menu(p, /^Customize$/);
    await p.type('#ab-dash-name', ' for the network team');
    await p.keyboard.press('Enter');
    await p.evaluate(() => window.__vis(document.querySelectorAll('.ab-customize details > summary'))[0].click());
    await clickButton(p, /^New dashboard/);
    await ctx.sleep(500);
    await clickButton(p, /^Done$/);
    const stored = await ctx.ext(async () => (await chrome.storage.local.get('agentbuddy_dashboards')).agentbuddy_dashboards);
    const storedText = JSON.stringify(stored);
    const leaks = findLeaks(storedText, data);
    const nums = numbersIn(stored).filter((n) => !/(version|\.v|\.max|\.cap)=/.test(n));
    t.check('storage holds the dashboards as configuration, under this instance: sections, order, scope, tables and names', Boolean(stored?.instances?.[inst.origin]) && /overview/.test(storedText) && /workload/.test(storedText) && /quality/.test(storedText) && /for the network team/.test(storedText), storedText.slice(0, 200));
    t.check('...and NO number from a report, no ticket number, no person\'s name, no email', leaks.critical.length === 0 && leaks.gaps.length === 0 && !/INC\d{5,}|RITM\d{5,}|CS\d{5,}|Anglin|Tuter|@example/.test(storedText) && nums.length === 0, `${leaks.critical.join(' | ')} ${nums.slice(0, 5).join(' ')}`);
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('.ab-app', { timeout: 20000 }).catch(async (err) => {
      throw new Error(`${err.message} | panel shows: ${(await p.evaluate(() => document.body?.innerText || document.documentElement.outerHTML).catch(() => '?')).slice(0, 300)}`);
    });
    await openScreen(p, 'Team');
    await openHalf(p, 'insights');
    await p.waitForSelector('.ab-dash-toolbar select', { timeout: 20000 });
    const options = await p.$$eval('.ab-dash-toolbar select option', (os) => os.map((o) => ({ value: o.value, name: o.innerText.trim() })));
    t.check('after the panel was reloaded both saved dashboards come back: the renamed one and the new one', options.some((o) => /for the network team$/.test(o.name)) && options.some((o) => o.name === 'New dashboard'), options.map((o) => o.name).join(' | '));
    const renamed = options.find((o) => /for the network team$/.test(o.name));

    // ============================== EXPORT (one panel for the dashboard) =====================================================================
    await pickDashboard(p, renamed.value);
    await widgetReady(ctx, p, 'Workload and ageing');
    t.check('the renamed dashboard comes back with the sections that were added to it', (await p.$(widget('Quality and trend'))) !== null);
    await widgetReady(ctx, p, 'Request fulfilment');
    await recordDownloads(p);
    await menu(p, /^Export/);
    await p.waitForSelector('.ab-export-panel', { timeout: 8000 });
    const fulfilCsv = () => p.evaluate(() => document.querySelector('.ab-export-panel button[aria-label="Download Request fulfilment as CSV"]').click());
    await fulfilCsv();
    await ctx.waitUntil('the CSV', async () => (await p.evaluate(() => window.__csv.length)) >= 1, { timeout: 8000 });
    const csv = (await p.evaluate(() => window.__csv))[0];
    t.check('Export > One section: a .csv file built in the browser from the table on screen (name, byte-order mark, header and rows)', /\.csv$/.test(csv.name) && csv.bom && /RITM0010050/.test(csv.body) && csv.body.split('\n').length >= 3, `${csv.name} ${csv.body.slice(0, 80).replace(/\n/g, '|')}`);
    t.check('...with the real names (this is the person\'s own data, on their own computer)', /Beth Anglin/.test(csv.body));
    const maskBox = () => p.evaluate(() => document.querySelector('.ab-export-panel input[type="checkbox"]').click());
    await maskBox();
    await fulfilCsv();
    await ctx.waitUntil('the masked CSV', async () => (await p.evaluate(() => window.__csv.length)) >= 2, { timeout: 8000 });
    const masked = (await p.evaluate(() => window.__csv))[1];
    t.check('"Mask names and emails": the next file has Person 1 instead of the name in the people column', /,Person 1,/.test(masked.body) && !/Beth Anglin/.test(masked.body), masked.body.slice(0, 160).replace(/\n/g, '|'));
    t.check('"Mask names and emails": a person named inside a ticket title ("... for Charlie Whitherspoon") is masked as well', !/Charlie|Whitherspoon/.test(masked.body), masked.body.split('\n').filter((l) => /Laptop/.test(l)).join(' | '));
    await maskBox();
    await clickButton(p, /^Download all as CSV/);
    await ctx.waitUntil('the whole dashboard as one file', async () => (await p.evaluate(() => window.__csv.length)) >= 3, { timeout: 8000 });
    const all = (await p.evaluate(() => window.__csv))[2];
    t.check('"Download all as CSV": every section of the dashboard in one file', /Overview/.test(all.body) && /RITM0010050/.test(all.body) && /Workload|Open work/.test(all.body), all.body.slice(0, 120).replace(/\n/g, '|'));
    t.check('nothing in the Insights half used the AI', ai.requests.length === 0);

    // ============================== AI ASSIST HALF ================================================================================================
    await openHalf(p, 'assist');
    await waitForText(p, /Explain this dashboard/, { timeout: 15000 });
    await waitPanel(ctx, p, 'the hand-over numbers', async () => /From the hand-over numbers for/.test(await p.$eval('#ab-team-half-panel-assist', (el) => el.innerText)), { timeout: 30000 });
    const assist = await p.evaluate(() => {
      const pane = document.querySelector('#ab-team-half-panel-assist');
      const buttons = window.__vis(pane.querySelectorAll('button')).filter((b) => /Write the hand-over note|Explain these numbers/.test(b.innerText));
      return { text: pane.innerText, marked: buttons.length === 2 && buttons.every((b) => b.querySelector('.ab-ai-badge') && /^Sends masked text to /.test(b.title)) };
    });
    t.check('AI Assist: the hand-over note and "Explain this dashboard", each button with the AI mark and where the text goes', assist.marked, assist.text.slice(0, 200));
    t.check('AI Assist: coaching stays off unless the organisation switches it on', /Coaching snapshot: off until your organisation switches coaching on/.test(assist.text));
    t.check('...and opening AI Assist sent nothing to the AI', ai.requests.length === 0);
    await clickButton(p, /Explain these numbers/);
    await p.waitForSelector('.ab-dialog', { timeout: 15000 });
    t.check('"Explain these numbers" shows what will be sent first, and sends nothing before Send', ai.requests.length === 0);
    await clickButton(p, /^Send to AI/);
    await p.waitForSelector('#ab-team-half-panel-assist .ab-ai-result', { timeout: 30000 });
    const outgoing = JSON.stringify(ai.requests[ai.requests.length - 1] || {});
    t.check('...one request went to the AI, written from the numbers on the dashboard, with no person\'s name and no ticket title', ai.requests.length === 1 && !/Anglin|Tuter|Whitherspoon|@example/.test(outgoing), outgoing.slice(0, 200));
    t.check('...the answer carries the AI mark', (await p.$('#ab-team-half-panel-assist .ab-ai-result .ab-ai-badge')) !== null);
    await openHalf(p, 'insights');

    // ============================== FULL PAGE ==============================================================================================
    const sourceTabId = await ctx.ext(async (origin) => (await chrome.tabs.query({})).find((x) => (x.url || '').startsWith(`${origin}/home`))?.id, inst.origin);
    const before = new Set(ctx.browser.targets());
    await menu(p, /^Open full page/);
    const target = await ctx.browser.waitForTarget((x) => !before.has(x) && x.url().includes('dashboard.html'), { timeout: 10000 });
    const dash = await target.page();
    await dash.waitForSelector('.ab-dashboard-page', { timeout: 10000 });
    t.check('"Open full page" opened dashboard.html in a new tab, naming the ServiceNow tab it reads through', new URL(target.url()).pathname === '/dashboard.html' && new URL(target.url()).searchParams.get('tab') === String(sourceTabId), target.url());
    await waitForText(dash, /Reading from localhost:\d+ with your own session/, { timeout: 20000 });
    t.check('...it found its source tab (the content script answered an extension page in a tab) and says which site it reads from', true);
    await widgetReady(ctx, dash, 'Overview');
    t.check('the full page shows the same report (the same instance\'s dashboards), in its own layout', (await tileValue(dash, 'Open')) >= 6 && (await dash.$('.ab-dash-page')) !== null, `open=${await tileValue(dash, 'Open')}`);
    await widgetReady(ctx, dash, 'Request fulfilment');
    // Drill-down from the full page brings the ServiceNow tab to the front and leaves the dashboard open
    await dash.evaluate((sel) => document.querySelector(`${sel} .ab-chart-link`)?.click(), widget('Request fulfilment'));
    await ctx.waitUntil('the ServiceNow tab to open the record', async () => /sys_id%3D[0-9a-f]{32}/i.test(source.url()), { timeout: 10000 });
    t.check('from the full page a ticket opens in the ServiceNow tab (same instance) and the dashboard tab stays open', source.url().startsWith(inst.origin) && !dash.isClosed(), decodeURIComponent(source.url()).slice(0, 100));
    // Closing the source tab: a calm message
    await settleWidgets(ctx, dash);
    await source.close();
    await waitForText(dash, /The ServiceNow tab this dashboard was opened for has been closed/, { timeout: 15000 });
    t.check('closing the ServiceNow tab: the full page says so calmly, with what to do (no error, no blank page)', (await dash.$('.ab-note-danger')) === null && /Open ServiceNow again/.test(await text(dash)));
    const dashErrors = errorsSince(ctx, mark).filter((e) => e.from.includes('dashboard') || (e.url || '').includes('dashboard.html'));
    t.check('the full page logged no console error, page error or CSP violation', dashErrors.length === 0, describeErrors(dashErrors));
    t.check('...and no CSP violation event', (await dash.evaluate(() => window.__cspViolations || [])).length === 0);
    await dash.close();

    const bad = errorsSince(ctx, mark);
    t.check('no console error, page error or CSP violation on the Team screen or the full page', bad.length === 0, describeErrors(bad));
    await panel.close();
    await ctx.ext((key) => chrome.storage.local.remove(key), 'agentbuddy_dashboards');
  },
};

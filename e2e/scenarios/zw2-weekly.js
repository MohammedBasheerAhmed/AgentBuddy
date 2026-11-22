// zw2. "My week" and the weekly report (round 5, docs/round5.md, boards B, D and E), through the real panel:
//    - My week opens from the "My week" row of My work, shows its numbers, switches between this week and last week, and "Share with my lead"
//      only copies text
//    - the AI line goes through the preview first, then sends counts and ticket numbers only: no name, no ticket title
//    - "Download PDF" lays the report out as an A4 page for the browser's own print (the panel is not printed) and puts the panel back after
//    - the weekly report (Team) shows five numbers against the week before, the decisions, and copies text for an email
//    - with the AI switched off every number is still there, with one plain sentence instead of the paragraph
//    - nothing about the week is kept in browser storage; the views pass the accessibility audit in light, dark and Arabic, and fit 320 px
// The answers of the two reads are given to the panel here (the fake instance's tickets are not from last week): what is under test is the
// panel's views, the AI path and the print; the reads themselves (dates, counts, left-out numbers) are tests/round5-weekly-read.test.js.
const { prepare, captureClipboard, clipboardLog } = require('../common.js');
const { openScreen } = require('../ui.js');
const { auditPage } = require('../a11y.js');

const HOUR = 3600000;
const day = (d) => ({ y: 2026, m: 11, d, wd: new Date(Date.UTC(2026, 10, d)).getUTCDay() });
const WINDOW = (which) => (which === 'this' ? { which, partial: true, start: 0, end: 1, previousStart: 0, previousEnd: 1, first: day(16), last: day(18) } : { which, partial: false, start: 0, end: 1, previousStart: 0, previousEnd: 1, first: day(9), last: day(15) });
const envelope = (data) => ({ id: 'x', title: 'x', generatedAt: Date.now(), readAt: Date.now(), scope: { kind: 'groups', label: 'My groups (2)', groups: [{ id: 'a', name: 'Service Desk' }, { id: 'b', name: 'Network Ops' }], note: '' }, tables: [], access: [], notes: [], caps: [], zone: { id: 'UTC', source: 'servicenow', note: '' }, data });
const mine = (which) =>
  envelope({
    available: true,
    kind: 'mine',
    window: WINDOW(which),
    types: ['Incidents'],
    now: { closed: 11, complete: true, typicalMs: 30 * HOUR, reply: { meanMs: 42 * 60000, n: 9, of: 11 }, reopened: { n: 1, of: 11, types: ['Incidents'], numbers: ['INC0010099'] }, sla: { kept: 10, total: 11, percent: 91 }, areas: [{ name: 'Network', count: 5, plain: false }, { name: 'Email', count: 3, plain: false }, { name: 'Access', count: 2, plain: false }], notes: { closed: 11, without: 3, reopenedWithout: 1 } },
    before: { closed: 8, complete: true, typicalMs: 30 * HOUR, reply: { meanMs: 50 * 60000, n: 7, of: 8 }, reopened: { n: 0, of: 8 }, sla: { kept: 7, total: 8, percent: 88 } },
    leftOut: [],
  });
const team = (which) =>
  envelope({
    available: true,
    kind: 'team',
    window: WINDOW(which),
    types: ['Incidents'],
    numbers: { cameIn: { value: 63, prev: 54 }, closed: { value: 58, prev: 54 }, backlog: { value: 5, prev: 0 }, sla: { percent: 88, total: 140, kept: 123, prev: 91 }, reopened: { value: 4, of: 58, prev: 6, prevOf: 54, types: ['Incidents'] } },
    areas: [{ name: 'Network', count: 21, plain: false }, { name: 'Email', count: 14, plain: false }, { name: 'Other', count: 3, plain: true }],
    decisions: [{ id: 'cause', count: 4, name: 'VPN Gateway EU', numbers: ['INC0010001', 'INC0010002'] }, { id: 'load', people: 2, percent: 40, of: 85 }, { id: 'notes', without: 3, closed: 14, numbers: ['INC0010101'] }],
    oldest: [{ table: 'incident', sysId: 'a', number: 'INC0010100', title: 'Printer offline in Finance', ageDays: 31, sla: 'breached' }],
    leftOut: [],
  });

// What must never reach the AI: names and ticket words that are in the answers above (the screen may show them; the AI may not see them).
const SECRET = /Printer offline|Finance|VPN Gateway|Service Desk|Network Ops|Anglin|Tuter|Whitherspoon|@example/;

module.exports = {
  id: 'zw2',
  title: 'My week and the weekly report: numbers, the AI line, the PDF page, left-out numbers, Arabic, accessibility',
  timeoutMs: 280000,
  async run(t, ctx) {
    const { ai, inst } = ctx;
    await prepare(ctx);
    await ctx.configure({ profiles: ['it', 'lead'], profilesConfirmed: true, language: 'en', theme: 'system', aiSkipped: false });
    await ctx.ext((key) => chrome.storage.local.remove(key), 'agentbuddy_dashboards');
    const home = await ctx.openInstancePage('/home', 'home');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await p.setViewport({ width: 400, height: 1300, deviceScaleFactor: 1 });
    await p.evaluate(
      (c) => {
        window.__weeklyAsked = [];
        const original = chrome.tabs.sendMessage.bind(chrome.tabs);
        chrome.tabs.sendMessage = async (tabId, message, ...rest) => {
          if (message && message.type === 'ab:read' && message.op === 'myWeek') {
            window.__weeklyAsked.push({ op: 'myWeek', which: message.args.which });
            return c.mine[message.args.which] || c.mine.last;
          }
          if (message && message.type === 'ab:read' && message.op === 'weeklyReport') {
            window.__weeklyAsked.push({ op: 'weeklyReport', which: message.args.which, scope: message.args.scope?.kind });
            return c.team[message.args.which] || c.team.last;
          }
          if (message && message.type === 'ab:read' && message.op === 'weeklyClear') return { ok: true };
          return original(tabId, message, ...rest);
        };
      },
      { mine: { this: mine('this'), last: mine('last') }, team: { this: team('this'), last: team('last') } }
    );
    await captureClipboard(p);
    const clickText = (re) =>
      p.evaluate(
        (src) => {
          const rx = new RegExp(src);
          const b = [...document.querySelectorAll('button')].find((x) => !x.disabled && x.getClientRects().length > 0 && rx.test(x.innerText.trim()));
          b?.click();
          return Boolean(b);
        },
        re
      );
    const view = (sel) => p.evaluate((s) => document.querySelector(s)?.innerText.replace(/\s+/g, ' ').trim() || '', sel);
    const settle = () => ctx.sleep(500);
    // (the sign of a change is kept in front of its number with an invisible mark: taken out here)
    const tilesOf = () => p.evaluate(() => [...document.querySelectorAll('.ab-weekly-tile')].map((x) => x.innerText.replace(/[‎‏]/g, '').replace(/\s+/g, ' ').trim()));
    const waitFor = (what, fn, options) => ctx.waitUntil(what, fn, { timeout: 20000, ...options });
    const audit = async (label, root) => {
      await p.keyboard.press('Shift');
      const found = await p.evaluate(auditPage, { root });
      t.check(`${label}: no accessibility or colour problem`, found.length === 0, found.slice(0, 2).map((x) => `${x.rule}: ${x.where}: ${x.detail}`).join(' || '));
      for (const x of found.slice(0, 8)) console.log(`        [${label}] ${x.rule}: ${x.where}: ${x.detail}`);
    };

    // ---- My week ------------------------------------------------------------------------------------------------------------------------
    t.section('zw2. My week');
    await openScreen(p, 'My work');
    await waitFor('My work to show its rows', () => p.evaluate(() => Boolean(document.querySelector('[data-row]'))));
    t.check('My work has a "My week" row', await clickText('^My week'));
    await waitFor('My week to show its numbers', () => p.evaluate(() => document.querySelectorAll('.ab-myweek .ab-weekly-tile').length > 0));
    await settle();
    t.check('My week: the title, and "Only you see this unless you share it"', /My week/.test(await view('.ab-weekly-title')) && /Only you see this unless you share it/.test(await view('.ab-weekly-period')), await view('.ab-weekly-period'));
    const tiles = await tilesOf();
    t.check('My week: five numbers, in the order of the board', tiles.length === 5 && /^11 Tickets closed/.test(tiles[0]) && /^42 min Average first reply/.test(tiles[1]) && /^1 d 6 h Typical time to resolve/.test(tiles[2]) && /^1 of 11 Reopened after closing/.test(tiles[3]) && /^91% Answered inside the SLA/.test(tiles[4]), JSON.stringify(tiles));
    t.check('My week: each number says how it changed, against the same days of last week while this week is still going', /\+3 on the same days last week/.test(tiles[0]) && /8 min faster than the same days last week/.test(tiles[1]) && /3 points better/.test(tiles[4]), tiles.join(' | '));
    t.check('My week: where the week went, as bars with counts', /Where your week went\s*Network\s*5\s*Email\s*3\s*Access\s*2/.test(await view('.ab-weekly-section')), await view('.ab-weekly-section'));
    await clickText('^Last week$');
    await waitFor('last week to be read', () => p.evaluate(() => /to Sun|Nov 9/.test(document.querySelector('.ab-weekly-period')?.innerText || '') || /9/.test(document.querySelector('.ab-weekly-period')?.innerText || '')));
    await settle();
    const lastTiles = await tilesOf();
    t.check('My week, last week: compared with the week before, and the read asked for last week', /\+3 on the week before/.test(lastTiles[0]) && (await p.evaluate(() => window.__weeklyAsked.some((a) => a.op === 'myWeek' && a.which === 'last'))), lastTiles[0]);
    await clickText('^This week$');
    await settle();
    await audit('My week, light', '.ab-myweek');

    // ---- The AI line: the preview first, counts and ticket numbers only -----------------------------------------------------------------
    const before = ai.requests.length;
    t.check('My week: "One thing to try" is a button, and says what it is written from', (await clickText('^Write one thing to try')) && /Written from counts and ticket numbers\. No names, no ticket text\./.test(await view('.ab-weekly-ai')));
    await waitFor('the check before sending', () => p.evaluate(() => Boolean(document.querySelector('.ab-dialog'))));
    const previewText = await view('.ab-dialog');
    t.check('the preview comes first and nothing was sent before it was confirmed', ai.requests.length === before && /What will be sent/.test(previewText));
    t.check('the preview shows the counts and the ticket number, and no name or ticket text', /Tickets closed: 11/.test(previewText) && /INC0010099/.test(previewText) && !SECRET.test(previewText), previewText.slice(0, 300));
    t.check('Send to AI confirms the preview', await clickText('Send to AI'));
    await waitFor('the answer', () => p.evaluate(() => Boolean(document.querySelector('.ab-weekly-ai-text'))));
    const sent = JSON.stringify(ai.requests[ai.requests.length - 1] || {});
    t.check('exactly one request went to the AI, with the figures and no name, group or ticket title', ai.requests.length === before + 1 && /Tickets closed: 11/.test(sent) && !SECRET.test(sent), sent.slice(0, 200));
    t.check('"What was sent" shows the same figures again', (await clickText('^What was sent$')) && /Tickets closed: 11/.test(await view('.ab-weekly-sent')), await view('.ab-weekly-sent'));

    // ---- Share and PDF -------------------------------------------------------------------------------------------------------------------
    await clickText('^Share with my lead$');
    await settle();
    const copied = (await clipboardLog(p)).join('\n');
    t.check('"Share with my lead" copies plain text with the numbers and the line, and sends nothing anywhere', /^My week: /.test(copied) && /Tickets closed: 11/.test(copied) && /Average first reply: 42 min/.test(copied), copied.slice(0, 200));
    await p.evaluate(() => {
      window.__printed = null;
      window.print = () => {
        const host = [...document.querySelectorAll('.ab-weekly-pdf-host.ab-pdf-live')][0];
        window.__printed = { body: document.body.classList.contains('ab-printing-weekly'), live: document.querySelectorAll('.ab-weekly-pdf-host.ab-pdf-live').length, text: host ? host.innerText.replace(/\s+/g, ' ') : '' };
      };
    });
    await clickText('^Download PDF$');
    const printed = await p.evaluate(() => window.__printed);
    t.check('"Download PDF" lays out the one report page for the browser\'s print (only that page is live)', Boolean(printed) && printed.body && printed.live === 1 && /My week/.test(printed.text) && /Tickets closed/.test(printed.text) && /Nothing was changed/.test(printed.text), JSON.stringify(printed).slice(0, 240));
    await p.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    t.check('after printing the panel is put back', await p.evaluate(() => !document.body.classList.contains('ab-printing-weekly') && document.querySelectorAll('.ab-pdf-live').length === 0));
    const pdfStyle = await p.evaluate(() => {
      const css = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } }).map((r) => r.cssText).join('\n');
      return { page: /@page weekly/.test(css), a4: /size:\s*A4/i.test(css) };
    });
    t.check('the print style sheet asks for A4', pdfStyle.page && pdfStyle.a4, JSON.stringify(pdfStyle));
    await p.setViewport({ width: 320, height: 1300, deviceScaleFactor: 1 });
    await settle();
    t.check('My week fits 320 px: nothing scrolls sideways', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await p.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`));
    await p.setViewport({ width: 400, height: 1300, deviceScaleFactor: 1 });
    t.check('Back goes to My work\'s rows', (await clickText('^My work$')) && (await waitFor('the rows', () => p.evaluate(() => Boolean(document.querySelector('[data-row]'))), { timeout: 8000 }).then(() => true).catch(() => false)));

    // ---- The weekly report ------------------------------------------------------------------------------------------------------------------
    t.section('zw2. The weekly report');
    await openScreen(p, 'Team');
    await waitFor('Team to show its Weekly report button', () => p.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.getClientRects().length > 0 && /Weekly report/.test(b.innerText))));
    t.check('Team has a "Weekly report" button', await clickText('Weekly report'));
    await waitFor('the weekly report to show its numbers', () => p.evaluate(() => document.querySelectorAll('.ab-weekly .ab-weekly-tile').length > 0));
    await settle();
    const wTiles = await tilesOf();
    t.check('the weekly report: five numbers, each with its change against the week before', wTiles.length === 5 && /^63 Came in \+9/.test(wTiles[0]) && /^58 Closed \+4/.test(wTiles[1]) && /^\+5 Backlog worse/.test(wTiles[2]) && /^88% SLA kept -3 pts/.test(wTiles[3]) && /^4 Reopened -2/.test(wTiles[4]), wTiles.join(' | '));
    const decisions = await p.evaluate(() => [...document.querySelectorAll('.ab-weekly-decision')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
    t.check('the weekly report: three plain decisions, numbered', decisions.length === 3 && /VPN Gateway EU: 4 tickets, one likely cause/.test(decisions[0]) && /Two people hold 40% of the open tickets/.test(decisions[1]) && /3 of 14 closes had no fix note/.test(decisions[2]), decisions.join(' | '));
    t.check('the weekly report: the title says the week, the groups and when it was read', /9.*15.*My groups \(2\).*read at \d\d:\d\d/.test(await view('.ab-weekly-period')), await view('.ab-weekly-period'));
    t.check('the weekly report: PDF, CSV and copy for email', (await view('.ab-weekly-actions')).replace(/\s+/g, ' ') === 'Download PDF Download CSV Copy for email', await view('.ab-weekly-actions'));
    await audit('the weekly report, light', '.ab-weekly');
    const askedAI = ai.requests.length;
    await clickText('^Write the week in short$');
    await waitFor('the check before sending', () => p.evaluate(() => Boolean(document.querySelector('.ab-dialog'))));
    const wPreview = await view('.ab-dialog');
    t.check('the weekly summary: the preview shows counts and ticket numbers, no name, group or ticket title', ai.requests.length === askedAI && /Tickets that came in: 63/.test(wPreview) && /INC0010001/.test(wPreview) && !SECRET.test(wPreview), wPreview.slice(0, 300));
    await clickText('Send to AI');
    await waitFor('the paragraph', () => p.evaluate(() => Boolean(document.querySelector('.ab-weekly-ai-text'))));
    const wSent = JSON.stringify(ai.requests[ai.requests.length - 1] || {});
    t.check('the weekly summary: one request, no names', ai.requests.length === askedAI + 1 && /Tickets that came in: 63/.test(wSent) && !SECRET.test(wSent));
    await clickText('^Copy for email$');
    await settle();
    const email = (await clipboardLog(p)).join('\n');
    t.check('"Copy for email" copies plain text: the paragraph, the numbers, the decisions', /Weekly report: /.test(email) && /Came in: 63/.test(email) && /Needs a decision:/.test(email) && /VPN Gateway EU/.test(email), email.slice(0, 200));
    await p.evaluate(() => {
      window.__printed = null;
      window.print = () => {
        const host = document.querySelector('.ab-weekly-pdf-host.ab-pdf-live');
        // (the page is hidden on screen, so its text has no line breaks between blocks: textContent)
        window.__printed = { text: host ? host.textContent : '' };
      };
    });
    await clickText('^Download PDF$');
    const pdf = await p.evaluate(() => window.__printed);
    t.check('the PDF page: the numbers, closed by area, the decisions, the oldest tickets with their short description, and where it came from', Boolean(pdf) && /Weekly report/.test(pdf.text) && /Closed by area/.test(pdf.text) && /Needs a decision/.test(pdf.text) && /Oldest open tickets/.test(pdf.text) && /INC0010100Printer offline in Finance31 dBreached/.test(pdf.text) && /Numbers read from ServiceNow on .* at \d\d:\d\d\. Nothing was changed\./.test(pdf.text), JSON.stringify(pdf).slice(0, 300));
    await p.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await p.setViewport({ width: 320, height: 1300, deviceScaleFactor: 1 });
    await settle();
    t.check('the weekly report fits 320 px', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await p.setViewport({ width: 400, height: 1300, deviceScaleFactor: 1 });

    // ---- Nothing kept ----------------------------------------------------------------------------------------------------------------------------
    const stored = JSON.stringify(await ctx.ext(() => chrome.storage.local.get(null)));
    t.check('nothing about the week is kept in browser storage: no ticket number, title or name', !/INC0010100|INC0010001|Printer offline|VPN Gateway|Service Desk/.test(stored), stored.slice(0, 120));
    t.check('the instance saw only reads', inst.browserRequests().every((r) => r.method === 'GET' || r.method === 'HEAD'));

    // ---- The AI off: the numbers stay -----------------------------------------------------------------------------------------------------------
    t.section('zw2. With the AI switched off');
    await ctx.configure({ aiSkipped: true });
    // (a paragraph that was already written stays: new numbers clear it, so look at the other week)
    await clickText('^This week so far$');
    await settle();
    await waitFor('the line to say why there is none', () => p.evaluate(() => /AI is switched off, so there is no written line/.test(document.querySelector('.ab-weekly-ai')?.innerText || '')), { timeout: 10000 }).catch(() => {});
    t.check('with the AI off: one plain sentence instead of the paragraph, and every number still there', /AI is switched off, so there is no written line\. The numbers do not need it\./.test(await view('.ab-weekly-ai')) && (await tilesOf()).length === 5, await view('.ab-weekly-ai'));
    await ctx.configure({ aiSkipped: false });

    // ---- Dark, and Arabic -------------------------------------------------------------------------------------------------------------------------
    t.section('zw2. Dark and Arabic');
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await settle();
    await audit('the weekly report, dark', '.ab-weekly');
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await ctx.configure({ language: 'ar' });
    await ctx.sleep(1200);
    await openScreen(p, 'My work');
    await waitFor('My work to show its "My week" row', () => p.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.getClientRects().length > 0 && b.innerText.includes('أسبوعي'))), { timeout: 30000 });
    t.check('Arabic: the panel is right to left', await p.evaluate(() => document.documentElement.dir === 'rtl'));
    const rowTexts = await p.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.getClientRects().length > 0).map((b) => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 14));
    t.check('Arabic: My week opens from its row', await clickText('أسبوعي'), rowTexts.join(' | '));
    await waitFor('My week to show its numbers', () => p.evaluate(() => document.querySelectorAll('.ab-myweek .ab-weekly-tile').length > 0));
    await settle();
    const arTiles = await tilesOf();
    t.check('Arabic: the numbers and their labels are in Arabic, the digits stay 0 to 9', arTiles.length === 5 && /^11 التذاكر المغلقة/.test(arTiles[0]) && /^42 دقيقة متوسط أول رد/.test(arTiles[1]), arTiles.join(' | '));
    await audit('My week, Arabic', '.ab-myweek');
    await ctx.configure({ language: 'en' });

    await panel.close();
    await home.close();
  },
};

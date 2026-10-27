// Helpers shared by the newer scenarios (m and later). Nothing here weakens a check of the older ones.
const { findLeaks } = require('./leaks.js');
const { clickButton, waitForText, textOf, waitForVisible } = require('./ui.js');

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The usual start of a scenario: fresh AI log, instance enabled and answering normally, a key and the "custom" provider pointing at
 * the fake AI, the preview on (so every outgoing text can be read before it is sent).
 */
async function prepare(ctx, { previewMode = 'always', piiMode = 'standard' } = {}) {
  const { ai, inst } = ctx;
  ai.reset();
  inst.setBehaviour();
  await ctx.ensureEnabled();
  await ctx.configure(
    { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode, previewMode, previewSeen: [], instances: [inst.origin] },
    { key: { provider: 'custom', value: ai.key } }
  );
}

/** Errors seen since `mark` (an index into ctx.errors), minus the 401/403 answers the failure scenarios cause on purpose. */
const errorMark = (ctx) => ctx.errors.length;
function errorsSince(ctx, mark) {
  return ctx.errors.slice(mark).filter((e) => !(e.kind === 'console' && /Failed to load resource: the server responded with a status of (401|403)/.test(e.text)));
}
const describeErrors = (list) => list.slice(0, 3).map((e) => `${e.from}/${e.kind}: ${e.text.slice(0, 140)}`).join(' | ');

/** Click a tab/section button (role=tab) by its text. */
async function clickTab(page, label) {
  const handle = await page.waitForFunction(
    // (Only a tab a person could see: sections that are not on screen stay mounted, hidden.)
    (text) => [...document.querySelectorAll('[role="tab"]')].find((b) => !b.disabled && b.getClientRects().length > 0 && b.innerText.trim() === text) || null,
    { timeout: 15000 },
    label
  );
  const el = handle.asElement();
  // In the middle of the view: next to the panel's sticky section bar a tab scrolled to the very top can end up under it, and the click lands there.
  await el.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await el.click();
}

/** The label of every tab in a tablist (by the tablist's aria-label), and which one is selected. */
const tabsOf = (page, ariaLabel) =>
  page.evaluate((name) => {
    const list = document.querySelector(`[role="tablist"][aria-label="${name}"]`);
    if (!list) return null;
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    return { labels: tabs.map((b) => b.innerText.trim()), selected: tabs.filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.innerText.trim()) };
  }, ariaLabel);

/** Any element in the page that would load something or run something. */
const loadingElements = (page) => page.evaluate(() => document.querySelectorAll('img, picture, svg image, a[href], iframe, object, embed, video, audio, script:not([src])').length);

/**
 * What an AI run must satisfy, whatever the feature (the point of the harness: wiring, not wording):
 *   - a result was shown, and as text (nothing that loads)
 *   - the preview shown before sending is EXACTLY what the AI server received (system message, then user message)
 *   - the fixed prompt is the system message, the ticket text is only in the user message, wrapped as untrusted data
 *   - neither the preview nor the request carries any seeded personal data (names, emails, phones, cards, passwords)
 * `ran` is what runFeature() returned; `before` the number of AI requests before the run.
 */
async function checkAiRun(t, ctx, panelPage, label, ran, { before, system, userHas = [], userLacks = [], wrapped = true, placeholders = 'none' } = {}) {
  const { ai, data } = ctx;
  t.check(`${label}: a result is shown (no error)`, ran.result !== null && ran.result !== undefined, ran.error || '');
  const requests = ai.requests.slice(before);
  t.check(`${label}: exactly one request reached the AI`, requests.length === 1, String(requests.length));
  const req = requests[requests.length - 1];
  if (!req) return null;
  const messages = req.body?.messages || [];
  // E2E_DUMP=<folder> writes what was sent for every run, to read when a check about its content fails.
  if (process.env.E2E_DUMP) {
    const fs = require('fs');
    fs.mkdirSync(process.env.E2E_DUMP, { recursive: true });
    const text = messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');
    fs.writeFileSync(`${process.env.E2E_DUMP}/${label.replace(/[^a-z0-9-]+/gi, '_')}.txt`, text);
  }
  t.check(`${label}: one system and one user message, no tools`, JSON.stringify(messages.map((m) => m.role)) === '["system","user"]' && !req.body?.tools, JSON.stringify(messages.map((m) => m.role)));
  if (system) {
    const re = system instanceof RegExp ? system : new RegExp(escapeRe(system));
    t.check(`${label}: the fixed prompt is the SYSTEM message`, re.test(messages[0]?.content || '') && !re.test(messages[1]?.content || ''), (messages[0]?.content || '').slice(0, 90));
  }
  const user = messages[1]?.content || '';
  // (The fixed rules in the system message TALK ABOUT <ticket_data>, so the test is for a real wrapper: <ticket_data field=...>.)
  if (wrapped) t.check(`${label}: ticket text is only in the user message, wrapped as untrusted <ticket_data field=...>`, /<ticket_data field=/.test(user) && !/<ticket_data field=/.test(messages[0]?.content || ''));
  for (const needle of userHas) t.check(`${label}: the AI was given ${needle instanceof RegExp ? needle : `"${needle}"`}`, needle instanceof RegExp ? needle.test(user) : user.includes(needle), user.replace(/\s+/g, ' ').slice(0, 100));
  for (const needle of userLacks) t.check(`${label}: the AI was NOT given ${needle instanceof RegExp ? needle : `"${needle}"`}`, needle instanceof RegExp ? !needle.test(user) : !user.includes(needle));
  const wire = findLeaks(req.raw, data);
  t.check(`${label}: AI request has none of the seeded personal data`, wire.critical.length === 0, wire.critical.join(' | '));
  for (const g of wire.gaps) t.warning(`AI server received "${g.value}" unmasked`, g.why);
  if (ran.preview !== null && ran.preview !== undefined) {
    const prev = findLeaks(ran.preview, data);
    t.check(`${label}: the preview has none of the seeded personal data`, prev.critical.length === 0, prev.critical.join(' | '));
    const sent = messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');
    t.check(`${label}: the preview was EXACTLY the text that was sent`, sent.trim() === ran.preview.replace(/\r\n/g, '\n').trim());
  }
  if (ran.result !== null && ran.result !== undefined) {
    t.check(`${label}: the answer is shown as plain text (nothing in the panel loads or runs)`, (await loadingElements(panelPage)) === 0);
    // A feature whose text gets published (keepMasked) must keep its placeholders; any other answer has the real values put back.
    if (placeholders === 'none') t.check(`${label}: no placeholder is left in the answer (the real values were put back locally)`, !/\[[A-Z_]{2,20}_\d+\]/.test(ran.result), ran.result.slice(0, 80));
  }
  return req;
}

/** Wait for the panel to show a record's number (the instance tab must be the active one). */
const panelShows = (panel, text, timeout = 20000) => waitForText(panel.page, text, { timeout });

module.exports = { prepare, errorMark, errorsSince, describeErrors, clickTab, tabsOf, loadingElements, checkAiRun, panelShows, escapeRe, clickButton, waitForText, textOf };

/** Like runFeature() in ui.js, but the first click is made by `act` (for buttons that share one label, such as several "Draft"s). */
async function runAfter(page, act) {
  // (A run's error banner has role=alert; a summary line on some tabs also looks like a danger note, and must not count. Only what is
  // on screen counts: other sections stay mounted, hidden, with their own results.)
  const ERROR = '.ab-note-danger[role="alert"]';
  await act();
  await waitForVisible(page, `.ab-dialog, ${ERROR}, .ab-output`);
  const preview = await textOf(page, '.ab-preview');
  if (preview === null) return { preview, result: await textOf(page, '.ab-output'), error: await textOf(page, ERROR) };
  await clickButton(page, /^Send to AI/);
  await waitForVisible(page, `.ab-output, ${ERROR}`);
  return { preview, result: await textOf(page, '.ab-output'), error: await textOf(page, ERROR) };
}

/**
 * Remember everything the page tries to copy to the clipboard (window.__clip), whether or not the browser lets it. A headless window
 * is not focused, so the real clipboard may refuse; what the extension ASKED to copy is what the test needs to see.
 */
const captureClipboard = (page) =>
  page.evaluate(() => {
    if (window.__clipPatched) return;
    window.__clip = [];
    const board = navigator.clipboard;
    const original = board.writeText.bind(board);
    board.writeText = async (text) => {
      window.__clip.push(String(text));
      try {
        await original(text);
      } catch {
        /* blocked by the browser: the panel then says so; the attempt is recorded above */
      }
    };
    window.__clipPatched = true;
  });
const clipboardLog = (page) => page.evaluate(() => window.__clip || []);

module.exports.runAfter = runAfter;
module.exports.captureClipboard = captureClipboard;
module.exports.clipboardLog = clipboardLog;

/**
 * Wait until the tab in front shows `sysId` to the content script, then give the panel's own refresh (tab events, 2.5 s poll) a
 * moment to pick it up. For panels that do not print the record number (the Write section).
 */
async function settleOnRecord(ctx, sysId) {
  await ctx.waitUntil(`the content script to report record ${sysId.slice(0, 8)}`, async () => {
    const state = await ctx.ext(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) return null;
      try {
        return await chrome.tabs.sendMessage(tab.id, { type: 'ab:page-state' });
      } catch {
        return null;
      }
    });
    return state?.record?.sysId === sysId;
  }, { timeout: 15000 });
  await ctx.sleep(700);
}
module.exports.settleOnRecord = settleOnRecord;

/** ctx.waitUntil, but a timeout also says what the panel was showing (so a failure explains itself). */
async function waitPanel(ctx, p, what, fn, opts) {
  try {
    return await ctx.waitUntil(what, fn, opts);
  } catch (err) {
    const text = await p.evaluate(() => document.body.innerText).catch(() => '');
    const file = require('path').join(ctx.TMP, 'panel-at-failure.txt');
    require('fs').writeFileSync(file, text);
    throw new Error(`${err.message}. The panel showed (full text in ${file}): ${text.replace(/s+/g, ' ').slice(0, 160)}`);
  }
}
module.exports.waitPanel = waitPanel;

/** The frame of a classic page (nav_to.do + gsft_main) whose own address path is `pathname`, or null. (The top frame's address also CONTAINS it.) */
const frameByPath = (page, origin, pathname) => page.frames().find((f) => f.url().startsWith(origin) && new URL(f.url()).pathname === pathname) || null;
module.exports.frameByPath = frameByPath;

/** page.click(selector), scrolled to the middle of the view first (a button at the very top can sit under the panel's sticky bar). */
async function clickSel(page, selector) {
  await page.waitForSelector(selector, { visible: true, timeout: 10000 });
  await page.$eval(selector, (node) => node.scrollIntoView({ block: 'center' }));
  await page.click(selector);
}
module.exports.clickSel = clickSel;

// Small helpers for driving the real side-panel UI and reading what the extension did. Clicks are real mouse events
// (Input.dispatchMouseEvent), so the page sees a user gesture, like a person clicking.

// Round 3: the panel has screens (Ticket, My work, Team, Write, Knowledge) and each screen with AI has two halves (Insights,
// AI Assist). Old names still work, so a scenario can say 'This page' or 'My day'.
const SCREEN_IDS = { ticket: 'ticket', 'this page': 'ticket', 'my work': 'mywork', 'my day': 'mywork', mywork: 'mywork', team: 'team', write: 'write', knowledge: 'knowledge' };

/** Show a screen of the panel by its name or id ('Ticket', 'My work', 'team', ...). */
async function openScreen(page, name, { timeout = 15000 } = {}) {
  const id = SCREEN_IDS[String(name).trim().toLowerCase()];
  if (!id) throw new Error('Unknown screen ' + name);
  const handle = await page.waitForSelector('#ab-sec-tab-' + id, { timeout });
  await handle.click();
  await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-selected') === 'true', { timeout }, '#ab-sec-tab-' + id);
}

/** Show a half ('insights' or 'assist') of the screen on show. No-op when that screen has only one half. */
async function openHalf(page, half) {
  const clicked = await page.evaluate((h) => {
    const shown = (e) => e.getClientRects().length > 0;
    const tab = [...document.querySelectorAll('[role=tab][id$="-half-tab-' + h + '"]')].find(shown);
    if (!tab) return false;
    if (tab.getAttribute('aria-selected') !== 'true') tab.click();
    return true;
  }, half);
  if (clicked) await page.waitForFunction((h) => [...document.querySelectorAll('[role=tab][id$="-half-tab-' + h + '"]')].some((t) => t.getClientRects().length > 0 && t.getAttribute('aria-selected') === 'true'), { timeout: 5000 }, half);
  return clicked;
}

/** Is a button whose text matches visible right now? */
const buttonShown = (page, re) =>
  page.evaluate((src, flags) => {
    const rx = new RegExp(src, flags);
    return [...document.querySelectorAll('button')].some((b) => !b.disabled && b.getClientRects().length > 0 && rx.test(b.innerText.trim()));
  }, re.source, re.flags);

const allToolsShown = (page) => page.evaluate(() => [...document.querySelectorAll('.ab-palette')].some((e) => e.getClientRects().length > 0));

/**
 * Open All tools (docs/focus-layout.md: the command palette grown into the place where everything beyond the five lives) with its
 * button in the header, or with Ctrl+K when there is no button to press.
 */
async function openAllTools(page, { timeout = 5000 } = {}) {
  if (await allToolsShown(page)) return;
  const pressed = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.ab-header button')].find((x) => x.getClientRects().length > 0 && /^All tools/.test(x.getAttribute('aria-label') || ''));
    b?.click();
    return Boolean(b);
  });
  if (!pressed) {
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
  }
  await page.waitForFunction(() => [...document.querySelectorAll('.ab-palette')].some((e) => e.getClientRects().length > 0), { timeout });
}

/**
 * Choose an entry of All tools whose label matches (a string: its start; a RegExp). Opens All tools first. Returns whether one was
 * there to choose (All tools is closed again when there was none).
 */
async function chooseTool(page, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(`^${String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  await openAllTools(page);
  const chosen = await page.evaluate(
    (src, flags) => {
      const rx = new RegExp(src, flags);
      const option = [...document.querySelectorAll('.ab-palette [role=option]')].find((o) => rx.test((o.querySelector('.ab-palette-label')?.innerText || o.innerText).trim()));
      option?.click();
      return Boolean(option);
    },
    re.source,
    re.flags
  );
  if (!chosen) await page.keyboard.press('Escape');
  return chosen;
}

/**
 * The titles of every AI action the record on show offers: the five rows of AI Assist, then the rest from All tools' "More for this
 * ticket: AI Assist" group ("Ask about this ticket" left out). All tools is closed again.
 */
async function offeredActionTitles(page) {
  await openHalf(page, 'assist');
  const five = await page.evaluate(() => [...document.querySelectorAll('.ab-acts .ab-act-title')].filter((e) => e.getClientRects().length > 0).map((e) => e.innerText.trim()));
  await openAllTools(page);
  const rest = await page.evaluate(() =>
    [...document.querySelectorAll('.ab-palette-section[data-group="ticket-assist"] [role=option]')]
      .filter((o) => o.getAttribute('data-command') !== 'run:ask:ticket')
      .map((o) => (o.querySelector('.ab-palette-label')?.innerText || '').trim())
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => ![...document.querySelectorAll('.ab-palette')].some((e) => e.getClientRects().length > 0), { timeout: 5000 });
  return [...five, ...rest];
}

/** Is this AI action offered for the record on show: one of AI Assist's five, or in All tools? Starts nothing. */
async function actionOffered(page, re) {
  await openHalf(page, 'assist');
  if (await buttonShown(page, re)) return true;
  await openAllTools(page);
  const there = await page.evaluate(
    (src, flags) => [...document.querySelectorAll('.ab-palette [role=option]')].some((o) => new RegExp(src, flags).test((o.querySelector('.ab-palette-label')?.innerText || '').trim())),
    re.source,
    re.flags
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => ![...document.querySelectorAll('.ab-palette')].some((e) => e.getClientRects().length > 0), { timeout: 5000 });
  return there;
}

/** Start an AI action: its button among AI Assist's five, or its entry in All tools (the check before sending opens either way). */
async function startAction(page, re) {
  if (await buttonShown(page, re)) return clickButton(page, re);
  if (!(await chooseTool(page, re))) throw new Error(`No AI action matches ${re}`);
  return null;
}

/**
 * Bring an AI action on screen: the AI Assist half shows five (one per pain point); any other action is in All tools, where choosing
 * it STARTS it (the check before sending opens), exactly as the bar on the ServiceNow page does. Returns true when the action's
 * button is now on screen, 'started' when All tools started it, false when it is nowhere.
 */
async function showAction(page, re) {
  await openHalf(page, 'assist');
  if (await buttonShown(page, re)) return true;
  return (await chooseTool(page, re)) ? 'started' : false;
}

/** Empty a text box the way a person does (select all, delete), so the page's own state (React) sees it. */
async function clearBox(page, selector) {
  await page.click(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
}

/** Wait for an enabled <button> whose visible text matches, then click it for real. */
async function clickButton(page, pattern, { timeout = 15000 } = {}) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(`^${String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const handle = await page.waitForFunction(
    (src, flags) => {
      const rx = new RegExp(src, flags);
      // Sections that are not on screen stay mounted (hidden), so a button of another section can have the same label: only a button
      // a person could see and press counts.
      const shown = (b) => b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden';
      return [...document.querySelectorAll('button')].find((b) => !b.disabled && shown(b) && rx.test(b.innerText.trim())) || null;
    },
    { timeout },
    re.source,
    re.flags
  );
  const el = handle.asElement();
  await el.evaluate((node) => node.scrollIntoView({ block: 'center' })); // (not under a sticky bar when it is pressed)
  await el.click();
  return el;
}

/** Wait until the page text contains `text` (string) or matches (RegExp). Returns the page text. */
async function waitForText(page, text, { timeout = 15000 } = {}) {
  const isRe = text instanceof RegExp;
  const handle = await page.waitForFunction(
    (src, flags, re) => {
      const body = document.body.innerText;
      return (re ? new RegExp(src, flags).test(body) : body.includes(src)) ? body : null;
    },
    { timeout },
    isRe ? text.source : text,
    isRe ? text.flags : '',
    isRe
  );
  return handle.jsonValue();
}

/** Text of the first VISIBLE element matching a selector, or null. (Sections that are not on screen stay mounted, hidden, with their own results.) */
const textOf = (page, selector) => page.evaluate((s) => [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0)?.innerText ?? null, selector);

/** Wait until an element matching the selector is visible (any of them, not only the first). */
const waitForVisible = (page, selector, timeout = 15000) =>
  page.waitForFunction((s) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length > 0), { timeout }, selector);

/**
 * Open the preview, approve it, and return what the person saw. `feature` is a regexp for the action button.
 * With the preview switched off the answer (or the error) simply appears: preview is then null.
 */
async function runFeature(page, feature, { approve = true } = {}) {
  // AI actions live in the AI Assist half (five of them) and in All tools (the rest; choosing one there starts it).
  const re = feature instanceof RegExp ? feature : new RegExp(`^${String(feature).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const shown = (await buttonShown(page, re)) || (await showAction(page, re));
  if (shown !== 'started') await clickButton(page, feature);
  await waitForVisible(page, '.ab-dialog, .ab-note-danger, .ab-output, .ab-confirm-short');
  // The full check shows the ticket data first with the fixed rules folded (AI0.2); "Show the exact text" turns it into the request
  // character for character, which is what a scenario compares with what the AI server received.
  if (await buttonShown(page, /^Show the exact text/)) await clickButton(page, /^Show the exact text/);
  const preview = await textOf(page, '.ab-preview');
  // A repeat run of a function that uses other records' tickets may ask with a short check instead of the full text.
  const confirm = await textOf(page, '.ab-confirm-short');
  if (preview === null && confirm === null) return { preview, confirm, result: await textOf(page, '.ab-output'), error: await textOf(page, '.ab-note-danger') };
  if (!approve) return { preview, confirm, result: null, error: null };
  await clickButton(page, /^Send to AI/);
  await waitForVisible(page, '.ab-output, .ab-note-danger');
  return { preview, confirm, result: await textOf(page, '.ab-output'), error: await textOf(page, '.ab-note-danger') };
}

/** Wait until the panel shows a record (the instance tab is the active tab and the content script answered). */
async function waitForRecord(page, number = 'INC0010001') {
  await waitForText(page, number, { timeout: 15000 });
}

/** Deep query: the first element (through nested open shadow roots) matching `test`. Runs in the page. */
function deepTextareaValue(label) {
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.tagName === 'TEXTAREA' && (el.getAttribute('aria-label') || '').toLowerCase() === label.toLowerCase()) return el.value;
      if (el.shadowRoot) {
        const found = walk(el.shadowRoot);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  return walk(document);
}

module.exports = { clickButton, waitForText, textOf, waitForVisible, runFeature, waitForRecord, deepTextareaValue, openScreen, openHalf, buttonShown, showAction, clearBox, openAllTools, chooseTool, offeredActionTitles, actionOffered, startAction };

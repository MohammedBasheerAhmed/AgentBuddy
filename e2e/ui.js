// Small helpers for driving the real side-panel UI and reading what the extension did. Clicks are real mouse events
// (Input.dispatchMouseEvent), so the page sees a user gesture, like a person clicking.

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
  await clickButton(page, feature);
  await waitForVisible(page, '.ab-dialog, .ab-note-danger, .ab-output');
  const preview = await textOf(page, '.ab-preview');
  if (preview === null) return { preview, result: await textOf(page, '.ab-output'), error: await textOf(page, '.ab-note-danger') };
  if (!approve) return { preview, result: null, error: null };
  await clickButton(page, /^Send to AI/);
  await waitForVisible(page, '.ab-output, .ab-note-danger');
  return { preview, result: await textOf(page, '.ab-output'), error: await textOf(page, '.ab-note-danger') };
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

module.exports = { clickButton, waitForText, textOf, waitForVisible, runFeature, waitForRecord, deepTextareaValue };

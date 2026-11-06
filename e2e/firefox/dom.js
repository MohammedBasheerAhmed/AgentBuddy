// Small helpers to drive the add-on's pages and the dock on the ServiceNow page in Firefox.
//
// The add-on's pages: every step is a script run in the page (BiDi script.callFunction), polled until it is true. puppeteer's own
// waitForSelector / waitForFunction use a sandbox of their own and wait for events that Firefox does not send for extension pages,
// so they are not used there. A click is the element's click(): no step of this run needs a real user gesture (turning the site on
// goes through the same message the Settings page sends after the browser granted the site).
//
// The dock: it lives in a CLOSED shadow root on purpose (src/content/bar.js), which the page's scripts cannot see into. WebDriver BiDi
// can, as a person's devtools can: a node serialised with includeShadowTree "all" carries its shadow root, closed or not. The dock's
// buttons are then pressed with a real mouse click (a trusted event, like a person's), because the dock ignores any other click.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll a function run in the page until it returns something truthy; returns that. */
async function waitInPage(page, what, fn, args = [], { timeout = 15000, every = 150 } = {}) {
  const end = Date.now() + timeout;
  let last = null;
  for (;;) {
    try {
      const value = await page.evaluate(fn, ...args);
      if (value) return value;
    } catch (err) {
      last = err;
    }
    if (Date.now() > end) {
      const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      throw new Error(`Timed out waiting for ${what}${last ? ` (${String(last.message).split('\n')[0]})` : ''}. The page showed: ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    await sleep(every);
  }
}

/** Wait until the page text contains `text` (a string) or matches it (a RegExp). */
const waitForText = (page, text, opts) =>
  waitInPage(page, `the text ${text}`, (src, flags, isRe) => (isRe ? new RegExp(src, flags).test(document.body.innerText) : document.body.innerText.includes(src)), text instanceof RegExp ? [text.source, text.flags, true] : [text, '', false], opts);

/** Wait until an element matching the selector is on screen. */
const waitForVisible = (page, selector, opts) => waitInPage(page, selector, (s) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length > 0), [selector], opts);

/** Text of the first element on screen that matches, or null. (Screens that are not shown stay mounted, hidden.) */
const textOf = (page, selector) => page.evaluate((s) => [...document.querySelectorAll(s)].find((e) => e.getClientRects().length > 0)?.innerText ?? null, selector);

/** Is a button whose text matches on screen and enabled? */
const buttonShown = (page, re) =>
  page.evaluate((src, flags) => [...document.querySelectorAll('button')].some((b) => !b.disabled && b.getClientRects().length > 0 && new RegExp(src, flags).test(b.innerText.trim())), re.source, re.flags);

/** Wait for an enabled button on screen whose text matches, and click it. */
async function clickButton(page, re, opts) {
  await waitInPage(
    page,
    `a button ${re}`,
    (src, flags) => {
      const button = [...document.querySelectorAll('button')].find((b) => !b.disabled && b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden' && new RegExp(src, flags).test(b.innerText.trim()));
      if (!button) return false;
      button.scrollIntoView({ block: 'center' });
      button.click();
      return true;
    },
    [re.source, re.flags],
    opts
  );
}

/** Show a half ('insights' or 'assist') of the screen on show (as e2e/ui.js openHalf). */
async function openHalf(page, half) {
  await waitInPage(
    page,
    `the ${half} half`,
    (h) => {
      const tab = [...document.querySelectorAll(`[role=tab][id$="-half-tab-${h}"]`)].find((e) => e.getClientRects().length > 0);
      if (!tab) return false;
      if (tab.getAttribute('aria-selected') !== 'true') tab.click();
      return tab.getAttribute('aria-selected') === 'true';
    },
    [half]
  );
}

// ---- The dock on the ServiceNow page -------------------------------------------------------------------------------------

/**
 * Reads and presses the dock of a ServiceNow page. `conn` is puppeteer's BiDi connection (browser.connection).
 * @param {import('puppeteer-core').Page} page
 */
function dockDriver(page, conn) {
  const context = () => page.mainFrame()._id;

  // The dock's host element (a child of <html>, src/content/bar.js) with its shadow root, as BiDi sees it.
  async function shadowRoot() {
    const { result } = await conn.send('script.callFunction', {
      functionDeclaration: '() => [...document.documentElement.children].filter((e) => e !== document.head && e !== document.body)',
      target: { context: context() },
      awaitPromise: false,
      resultOwnership: 'root',
      serializationOptions: { includeShadowTree: 'all', maxDomDepth: 0 },
    });
    if (result.type === 'exception') throw new Error(result.exceptionDetails?.text || 'the page did not answer');
    const hosts = result.result?.value || [];
    for (const host of hosts) {
      const root = host.value?.shadowRoot;
      if (root?.sharedId) return { sharedId: root.sharedId, mode: root.value?.mode || '' };
    }
    return null;
  }

  /** Run a function with the dock's shadow root as its argument; returns its (JSON) result, or null when there is no dock. */
  async function inDock(fn) {
    const root = await shadowRoot();
    if (!root) return null;
    const { result } = await conn.send('script.callFunction', {
      functionDeclaration: `(root) => JSON.stringify((${fn})(root))`,
      arguments: [{ sharedId: root.sharedId }],
      target: { context: context() },
      awaitPromise: false,
      resultOwnership: 'none',
    });
    if (result.type === 'exception') throw new Error(result.exceptionDetails?.text || 'the dock did not answer');
    return JSON.parse(result.result.value);
  }

  /** What a person sees of the dock right now. */
  async function view() {
    const root = await shadowRoot();
    if (!root) return { present: false, mode: '' };
    const seen = await inDock((r) => {
      const box = (el) => {
        if (!el || el.hidden) return null;
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0 ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
      };
      const bar = r.querySelector('.bar');
      const list = r.querySelector('.actions');
      const notice = r.querySelector('.notice');
      return {
        visible: Boolean(box(bar)),
        open: Boolean(box(list)),
        actions: [...r.querySelectorAll('button.act')].map((b) => ({ label: (b.querySelector('.sr')?.textContent || '').trim(), at: box(b) })),
        notice: notice && !notice.hidden ? notice.textContent.trim() : '',
      };
    });
    return { present: true, mode: root.mode, ...seen };
  }

  /** Press an action of the dock by its name with a real mouse click. */
  async function press(label) {
    const action = (await view()).actions?.find((a) => a.label === label);
    if (!action?.at) throw new Error(`The dock shows no "${label}" button on screen.`);
    await page.mouse.move(action.at.x, action.at.y, { steps: 3 });
    await sleep(150);
    await page.mouse.click(action.at.x, action.at.y);
  }

  return { view, press };
}

module.exports = { waitInPage, waitForText, waitForVisible, textOf, buttonShown, clickButton, openHalf, dockDriver, sleep };

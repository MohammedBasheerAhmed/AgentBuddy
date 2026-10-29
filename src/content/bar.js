// The bar on the ServiceNow page: a small tab on the edge that opens to the few main actions for the record that is open, so the
// person does not have to open the side panel first. It never runs anything itself. A click asks the service worker to open the
// side panel and leave a short-lived request (src/lib/launch.js); the panel runs the action with the usual steps, including the check
// of what will be sent. The bar shows only what the service worker says it may (pins and the organisation's policy are applied there).
//
// It is the one piece of UI Agent Buddy puts into a ServiceNow page, so it is built to stay out of the page's way and out of its reach:
//   - a closed shadow root: the page cannot reach the buttons, and its styles cannot reach them; the styles are a constructed
//     stylesheet, which a strict page CSP does not block (an inline <style> element would be blocked)
//   - it acts only on real clicks and key presses (event.isTrusted): a script in the page that dispatches a click does nothing
//   - it adds nothing to the page's body, loads no image, font or script, and makes no request of its own to any server
//   - it holds only a table, a sys_id and a few action ids; no ticket text
import { MSG } from '../lib/messages.js';
import themeCss from '../ui/theme.css';
import barCss from './bar.css';
import { POLL_MS, PREFS_KEY, isGone, launchNotice, needsAsk, parsePrefs, serializePrefs } from './barLogic.js';

// theme.css is written for extension pages (:root); in the bar's shadow root the same tokens belong to :host.
const TOKENS = themeCss
  .replace(/:root:not\(\[data-theme='light'\]\)/g, ':host')
  .replace(/:root\[data-theme='dark'\]/g, ":host([data-theme='dark'])")
  .replace(/:root/g, ':host');

const ACTION_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_ACTIONS = 4;

function h(doc, tag, attrs = {}, text = '') {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === true) el.setAttribute(name, '');
    else if (value !== false && value != null) el.setAttribute(name, String(value));
  }
  if (text) el.textContent = text;
  return el;
}

// The service worker's answer is checked anyway: it is text that ends up on the page.
const cleanActions = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((a) => a && ACTION_ID_RE.test(String(a.id || '')) && typeof a.label === 'string' && a.label.length > 0 && a.label.length <= 60)
    .slice(0, MAX_ACTIONS)
    .map((a) => ({ id: a.id, label: a.label }));

/**
 * @param {object} deps
 *   resolveRecord()  -> { table, sysId, ... } | null   the record that is open (the content script's own detection)
 *   send(message)    -> Promise                         to the service worker (default chrome.runtime.sendMessage)
 *   doc, win         the page's document and window     (tests may pass others)
 * @returns {{ stop(): void }}
 */
export function startBar({ resolveRecord, send = (message) => chrome.runtime.sendMessage(message), doc = document, win = window }) {
  const prefsBox = {
    read: () => {
      try {
        return win.localStorage.getItem(PREFS_KEY);
      } catch {
        return null;
      }
    },
    write: (text) => {
      try {
        win.localStorage.setItem(PREFS_KEY, text);
      } catch {
        /* the page does not allow it: the bar then starts folded each time */
      }
    },
  };
  let prefs = parsePrefs(prefsBox.read());
  const state = { record: null, actions: [], table: '', askedAt: NaN, busy: false, notice: '' };
  let stopped = false;
  let refreshing = false;
  let shownActions = '';

  // ---- the elements ----------------------------------------------------------------------------------------------
  const host = doc.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`${TOKENS}\n${barCss}`);
  shadow.adoptedStyleSheets = [sheet];

  const bar = h(doc, 'div', { class: 'bar', hidden: true });
  const handle = h(doc, 'button', { type: 'button', class: 'handle', 'aria-expanded': 'false', 'aria-label': 'Open the Agent Buddy quick actions', title: 'Agent Buddy quick actions' }, 'AB');
  const card = h(doc, 'div', { class: 'card', role: 'group', 'aria-label': 'Agent Buddy quick actions', hidden: true });
  const head = h(doc, 'div', { class: 'head' });
  const fold = h(doc, 'button', { type: 'button', class: 'icon', 'aria-label': 'Fold the bar', title: 'Fold the bar' });
  const list = h(doc, 'div', { class: 'actions' });
  const notice = h(doc, 'p', { class: 'notice', role: 'status', hidden: true });
  const foot = h(doc, 'div', { class: 'foot' });
  const move = h(doc, 'button', { type: 'button', class: 'quiet' });
  head.append(h(doc, 'span', { class: 'title' }, 'Agent Buddy'), fold);
  foot.append(move);
  card.append(head, list, notice, foot);
  bar.append(handle, card);
  shadow.append(bar);

  // The page's own style rules can beat a :host rule, so what keeps the bar in place is set on the element itself (through the
  // style object, which a page CSP allows, unlike a style attribute).
  const pin = (name, value) => host.style.setProperty(name, value, 'important');
  pin('all', 'initial');
  pin('position', 'fixed');
  pin('top', '38%');
  pin('z-index', '2147483000');
  pin('display', 'block');

  // ---- drawing ---------------------------------------------------------------------------------------------------
  function render() {
    const visible = Boolean(state.record) && state.actions.length > 0;
    bar.hidden = !visible;
    bar.setAttribute('data-side', prefs.side);
    pin(prefs.side === 'left' ? 'left' : 'right', '0');
    pin(prefs.side === 'left' ? 'right' : 'left', 'auto');

    handle.hidden = prefs.open;
    card.hidden = !prefs.open;
    handle.setAttribute('aria-expanded', String(prefs.open));
    fold.textContent = prefs.side === 'left' ? '‹' : '›';
    move.textContent = prefs.side === 'left' ? 'Move to the right' : 'Move to the left';

    // Rebuilt only when the actions change, so the focus stays where it is while the page is looked at again.
    const signature = state.actions.map((a) => `${a.id}:${a.label}`).join('|');
    if (signature !== shownActions) {
      shownActions = signature;
      list.replaceChildren(
        ...state.actions.map((action, i) => {
          const button = h(doc, 'button', { type: 'button', class: i === 0 ? 'act act-first' : 'act' }, action.label);
          button.addEventListener('click', (e) => e.isTrusted && launch(action));
          return button;
        })
      );
    }
    for (const button of list.children) button.disabled = state.busy;

    notice.textContent = state.notice;
    notice.hidden = !state.notice;
  }

  function setOpen(open, focus) {
    prefs = { ...prefs, open };
    prefsBox.write(serializePrefs(prefs));
    render();
    if (focus) (open ? list.firstElementChild || fold : handle).focus();
  }

  // ---- the person's clicks ---------------------------------------------------------------------------------------
  // (send() is called before this function first waits: the browser opens the side panel only for a request made while the click is
  // still being handled.)
  async function launch(action) {
    if (state.busy || !state.record) return;
    const message = { type: MSG.BAR_LAUNCH, table: state.record.table, sysId: state.record.sysId, featureId: action.id };
    state.busy = true;
    state.notice = '';
    render();
    let answer;
    try {
      answer = await send(message);
    } catch (err) {
      if (isGone(err)) {
        stop();
        return;
      }
      answer = { error: { message: 'Agent Buddy could not be reached. Reload this page and try again.' } };
    }
    state.busy = false;
    state.notice = launchNotice(answer);
    render();
  }

  handle.addEventListener('click', (e) => e.isTrusted && setOpen(true, true));
  fold.addEventListener('click', (e) => e.isTrusted && setOpen(false, true));
  move.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    prefs = { ...prefs, side: prefs.side === 'left' ? 'right' : 'left' };
    prefsBox.write(serializePrefs(prefs));
    render();
  });
  shadow.addEventListener('keydown', (e) => {
    if (e.isTrusted && e.key === 'Escape' && prefs.open) setOpen(false, true);
  });

  // ---- following the page ----------------------------------------------------------------------------------------
  async function refresh() {
    if (stopped || refreshing || doc.hidden) return;
    refreshing = true;
    try {
      // A page that rebuilt its document takes the bar with it: put it back.
      if (!doc.documentElement.contains(host)) doc.documentElement.append(host);
      const record = await resolveRecord();
      if (!record) {
        Object.assign(state, { record: null, actions: [], table: '', notice: '' });
      } else {
        if (state.record && state.record.sysId !== record.sysId) state.notice = '';
        const now = Date.now();
        if (needsAsk({ table: record.table, lastTable: state.table, lastAt: state.askedAt, now })) {
          const answer = await send({ type: MSG.BAR_ACTIONS, table: record.table });
          // An error answer (the site is not turned on, the bar is switched off, the table is blocked) means: show nothing.
          state.actions = answer?.error ? [] : cleanActions(answer?.actions);
          state.table = record.table;
          state.askedAt = now;
        }
        state.record = { table: record.table, sysId: record.sysId };
      }
    } catch (err) {
      if (isGone(err)) {
        stop();
        return;
      }
      Object.assign(state, { record: null, actions: [], table: '', askedAt: NaN });
    } finally {
      refreshing = false;
    }
    if (!stopped) render();
  }

  const timer = win.setInterval(refresh, POLL_MS);
  doc.documentElement.append(host);
  render();
  refresh();

  function stop() {
    stopped = true;
    win.clearInterval(timer);
    host.remove();
  }

  return { stop };
}

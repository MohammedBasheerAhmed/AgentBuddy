// The bar on the ServiceNow page: a small tab on the edge that opens to the few main actions for the record that is open, so the
// person does not have to open the side panel first. It never runs anything itself. A click asks the service worker to open the
// side panel and leave a short-lived request (src/lib/launch.js); the panel runs the action with the usual steps, including the check
// of what will be sent. The bar shows only what the service worker says it may (pins and the organisation's policy are applied there).
//
// It is the one piece of UI Agent Buddy puts into a ServiceNow page, so it is built to stay out of the page's way and out of its reach:
//   - a closed shadow root: the page cannot reach the buttons, and its styles cannot reach them; the styles are a constructed
//     stylesheet, which a strict page CSP does not block (an inline <style> element would be blocked)
//   - it acts only on real clicks and key presses (event.isTrusted): a script in the page that dispatches a click does nothing
//   - a real click starts an action only when the bar is in plain view (barLogic.js clickVerdict): not covered by something that lets
//     clicks through, not made transparent or moved by the page, and on screen for a moment (no click meant for something else)
//   - while the bar is switched off it does not look at the page at all (barSync.js); when its site is turned off it removes itself
//   - it adds nothing to the page's body, loads no image, font or script, and makes no request of its own to any server
//   - it holds only a table, a sys_id and a few action ids; no ticket text
//   - it sits BELOW the page's own dialogs (a lower layer than ServiceNow's modal layers) and hides while one it can see is open
//   - the folded tab shows an icon and a short label; it can be dragged up or down (the place is remembered in the page), and on a
//     Workspace it starts lower, out of the way of the Workspace's own strip of icons on the right edge
import { MSG } from '../lib/messages.js';
import themeCss from '../ui/theme.css';
import barCss from './bar.css';
import { BAR_Z, POLL_MS, PREFS_KEY, clampTop, clickNotice, clickVerdict, dragTop, isGone, launchNotice, nextSeen, pageHasModal, parsePrefs, serializePrefs, topFor } from './barLogic.js';
import { createBarSync } from './barSync.js';

const SVG = 'http://www.w3.org/2000/svg';

// The tab's icon: a speech bubble with two lines of text. Drawn with DOM calls, so nothing is loaded and a page CSP has nothing to block.
function icon(doc) {
  const svg = doc.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '16', height: '16', 'aria-hidden': 'true', focusable: 'false', class: 'glyph' })) svg.setAttribute(name, value);
  for (const d of ['M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8.5l-5 4v-4H4A1.5 1.5 0 0 1 2.5 15V6A1.5 1.5 0 0 1 4 4.5z', 'M7.5 9h9M7.5 12h6']) {
    const path = doc.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// Is a modal dialog open, as far as the top document and the classic form's frame can be seen from here (pageHasModal)?
function modalShown(doc, win) {
  const look = (d) => {
    if (!d) return {};
    let dialogs = 0;
    try {
      dialogs = d.querySelectorAll('[aria-modal="true"], .modal.in, .modal.show, dialog[open], .modal-backdrop').length;
    } catch {
      dialogs = 0;
    }
    return { bodyClasses: d.body ? [...d.body.classList] : [], dialogs };
  };
  if (pageHasModal(look(doc))) return true;
  try {
    // A dialog opened inside the classic form's frame is drawn inside the frame, which the bar would otherwise sit on top of.
    return pageHasModal(look(win.frames?.gsft_main?.document));
  } catch {
    return false; // another origin, or no frame
  }
}

// theme.css is written for extension pages (:root); in the bar's shadow root the same tokens belong to :host.
const TOKENS = themeCss
  .replace(/:root:not\(\[data-theme='light'\]\)/g, ':host')
  .replace(/:root\[data-theme='dark'\]/g, ":host([data-theme='dark'])")
  .replace(/:root/g, ':host');

function h(doc, tag, attrs = {}, text = '') {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === true) el.setAttribute(name, '');
    else if (value !== false && value != null) el.setAttribute(name, String(value));
  }
  if (text) el.textContent = text;
  return el;
}

/**
 * @param {object} deps
 *   resolveRecord()  -> { table, sysId, ... } | null   the record that is open (the content script's own detection)
 *   send(message)    -> Promise                         to the service worker (default chrome.runtime.sendMessage)
 *   onSiteOff()                                         the service worker says this site is no longer turned on
 *   surface()        -> 'classic'|'workspace'|'portal'|'other'   the kind of page (where the tab starts until it is moved)
 *   doc, win         the page's document and window     (tests may pass others)
 * @returns {{ stop(): void }}
 */
export function startBar({ resolveRecord, send = (message) => chrome.runtime.sendMessage(message), onSiteOff = () => {}, surface = () => 'classic', doc = document, win = window }) {
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
  const state = { record: null, actions: [], busy: false, notice: '', modal: false };
  let stopped = false;
  let refreshing = false;
  let shownActions = '';
  let wasShown = false; // were the action buttons on screen at the last draw?
  let armedAt = NaN; // when they last came on screen (or were rebuilt)

  // ---- the elements ----------------------------------------------------------------------------------------------
  const host = doc.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`${TOKENS}\n${barCss}`);
  shadow.adoptedStyleSheets = [sheet];

  const bar = h(doc, 'div', { class: 'bar', hidden: true });
  const handle = h(doc, 'button', { type: 'button', class: 'handle', 'aria-expanded': 'false', 'aria-label': 'Open the Agent Buddy quick actions', title: 'Agent Buddy quick actions. Drag to move it up or down.' });
  handle.append(icon(doc), h(doc, 'span', { class: 'label' }, 'Buddy'));
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
  // style object, which a page CSP allows, unlike a style attribute). A page script CAN still rewrite that style object, so what was
  // set is remembered and compared before a click is taken (intact()).
  let pinnedCss = '';
  const pin = (name, value) => host.style.setProperty(name, value, 'important');
  function pinAll() {
    pin('all', 'initial');
    pin('position', 'fixed');
    pin('top', `${topFor(prefs, pageSurface())}%`);
    // Below the page's own dialogs and their backdrop (BAR_Z, barLogic.js): a ServiceNow dialog covers the bar, never the other way
    // round. Last in the document, so among equal layers the bar is drawn over the page's ordinary content.
    pin('z-index', String(BAR_Z));
    pin('display', 'block');
    pin(prefs.side === 'left' ? 'left' : 'right', '0');
    pin(prefs.side === 'left' ? 'right' : 'left', 'auto');
    pinnedCss = host.style.cssText;
  }
  function pageSurface() {
    try {
      return surface();
    } catch {
      return 'classic';
    }
  }
  const intact = () => host.parentNode === doc.documentElement && host.style.cssText === pinnedCss && !host.hasAttribute('inert');

  // The browser's own visibility tracking (IntersectionObserver v2, trackVisibility): it reports a button as visible only when it is
  // not covered by anything (also by an element that lets clicks through) and has no transparency, filter or odd transform on it.
  // Where the browser cannot report it, clicks are judged by intact() and the time on screen alone.
  const seen = new WeakMap();
  let watcher = null;
  try {
    const Observer = win.IntersectionObserver;
    const Entry = win.IntersectionObserverEntry;
    if (typeof Observer === 'function' && Entry && 'isVisible' in Entry.prototype) {
      watcher = new Observer(
        (entries) => {
          const at = Date.now();
          for (const e of entries) seen.set(e.target, nextSeen(seen.get(e.target), { visible: e.isIntersecting === true && e.isVisible === true, at }));
        },
        { trackVisibility: true, delay: 100, threshold: [0, 1] }
      );
    }
  } catch {
    watcher = null;
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------
  function render() {
    const visible = Boolean(state.record) && state.actions.length > 0 && !state.modal;
    bar.hidden = !visible;
    bar.setAttribute('data-side', prefs.side);
    if (!intact()) pinAll();

    handle.hidden = prefs.open;
    card.hidden = !prefs.open;
    handle.setAttribute('aria-expanded', String(prefs.open));
    fold.textContent = prefs.side === 'left' ? '‹' : '›';
    move.textContent = prefs.side === 'left' ? 'Move to the right' : 'Move to the left';

    // Rebuilt only when the actions change, so the focus stays where it is while the page is looked at again.
    const signature = state.actions.map((a) => `${a.id}:${a.label}`).join('|');
    let rebuilt = false;
    if (signature !== shownActions) {
      shownActions = signature;
      rebuilt = true;
      watcher?.disconnect();
      list.replaceChildren(
        ...state.actions.map((action, i) => {
          // An AI action carries the AI mark (drawn by the stylesheet, so the button's text stays its label; its title says where text
          // goes); an Insights card says it stays in ServiceNow.
          const button = h(doc, 'button', { type: 'button', class: i === 0 ? 'act act-first' : 'act', 'data-ai': action.ai ? 'true' : false, title: action.ai ? 'Uses AI: opens the side panel, which shows what will be sent first' : 'Stays in ServiceNow: opens this in the side panel' }, action.label);
          button.addEventListener('click', (e) => e.isTrusted && press(action, button));
          watcher?.observe(button);
          return button;
        })
      );
    }
    for (const button of list.children) button.disabled = state.busy;

    // The buttons count as "on screen" from the moment they appear (the card opened, or new actions were drawn).
    const shownNow = visible && prefs.open;
    if (shownNow && (!wasShown || rebuilt)) armedAt = Date.now();
    wasShown = shownNow;

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
  // A click is taken only when the bar is in plain view (see clickVerdict); otherwise the person is told and nothing starts.
  function press(action, button) {
    if (state.busy || !state.record) return;
    const verdict = clickVerdict({ now: Date.now(), armedAt, seen: seen.get(button) || null, intact: intact() });
    if (verdict !== 'ok') {
      if (verdict === 'moved') {
        if (host.parentNode !== doc.documentElement) doc.documentElement.append(host);
        host.removeAttribute('inert');
        pinAll();
        armedAt = Date.now();
      }
      state.notice = clickNotice(verdict);
      render();
      return;
    }
    launch(action);
  }

  // (send() is called before this function first waits: the browser opens the side panel only for a request made while the click is
  // still being handled.)
  async function launch(action) {
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

  // ---- moving the tab up or down ----------------------------------------------------------------------------------
  // A press that moves the pointer is a drag; one that does not is a click (open). The new place is kept in the page's storage.
  let drag = null; // { startY, startTop, moved }
  let swallowClick = false;
  function placeAt(top) {
    prefs = { ...prefs, top: clampTop(top) };
    pinAll();
  }
  handle.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted || e.button !== 0) return;
    drag = { startY: e.clientY, startTop: topFor(prefs, pageSurface()), moved: false };
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* not supported: the drag then ends when the pointer leaves the tab */
    }
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag || !e.isTrusted) return;
    const top = dragTop({ startTop: drag.startTop, startY: drag.startY, y: e.clientY, height: win.innerHeight });
    if (top === null) return;
    drag.moved = true;
    placeAt(top);
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) {
      swallowClick = true; // the click that follows the release belongs to the drag, it is not "open"
      prefsBox.write(serializePrefs(prefs));
    }
    drag = null;
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  // The keyboard moves the folded tab too: up and down arrows, 5% a press.
  handle.addEventListener('keydown', (e) => {
    if (!e.isTrusted || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    placeAt(topFor(prefs, pageSurface()) + (e.key === 'ArrowUp' ? -5 : 5));
    prefsBox.write(serializePrefs(prefs));
  });

  handle.addEventListener('click', (e) => {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    if (e.isTrusted) setOpen(true, true);
  });
  fold.addEventListener('click', (e) => e.isTrusted && setOpen(false, true));
  move.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    prefs = { ...prefs, side: prefs.side === 'left' ? 'right' : 'left' };
    prefsBox.write(serializePrefs(prefs));
    pinAll();
    render();
  });
  shadow.addEventListener('keydown', (e) => {
    if (e.isTrusted && e.key === 'Escape' && prefs.open) setOpen(false, true);
  });

  // ---- following the page ----------------------------------------------------------------------------------------
  const sync = createBarSync({ send, resolveRecord, onSiteOff: () => onSiteOff() });

  async function refresh() {
    if (stopped || refreshing || doc.hidden) return;
    refreshing = true;
    let result = null;
    try {
      // A page that rebuilt its document takes the bar with it, and a page script may have moved it: put it back.
      if (host.parentNode !== doc.documentElement) doc.documentElement.append(host);
      result = await sync.tick();
    } finally {
      refreshing = false;
    }
    if (!result) return;
    if (result.status === 'gone' || result.status === 'off') {
      stop();
      return;
    }
    if (!result.record || (state.record && state.record.sysId !== result.record.sysId)) state.notice = '';
    state.record = result.record;
    state.actions = result.actions;
    state.modal = Boolean(result.record) && modalShown(doc, win);
    if (!stopped) render();
  }

  const timer = win.setInterval(refresh, POLL_MS);
  doc.documentElement.append(host);
  pinAll();
  render();
  refresh();

  function stop() {
    if (stopped) return;
    stopped = true;
    win.clearInterval(timer);
    watcher?.disconnect();
    host.remove();
  }

  return { stop };
}

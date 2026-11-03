// The dock on the ServiceNow page: a small pill at the bottom centre of the window with one round icon button for each of the few main
// actions for the record that is open, so the person does not have to open the side panel first. Hovering (or tabbing to) an icon says
// what it is. It never runs anything itself. A click asks the service worker to open the side panel and leave a short-lived request
// (src/lib/launch.js); the panel runs the action with the usual steps, including the check of what will be sent. The dock shows only
// what the service worker says it may (pins and the organisation's policy are applied there).
//
// It is the one piece of UI Agent Buddy puts into a ServiceNow page, so it is built to stay out of the page's way and out of its reach:
//   - a closed shadow root: the page cannot reach the buttons, and its styles cannot reach them; the styles are a constructed
//     stylesheet, which a strict page CSP does not block (an inline <style> element would be blocked)
//   - it acts only on real clicks and key presses (event.isTrusted): a script in the page that dispatches a click does nothing
//   - a real click starts an action only when the dock is in plain view (barLogic.js clickVerdict): not covered by something that lets
//     clicks through, not made transparent or moved by the page, and on screen for a moment (no click meant for something else)
//   - while the bar is switched off it does not look at the page at all (barSync.js); when its site is turned off it removes itself
//   - it adds nothing to the page's body, loads no image, font or script (the icons are drawn with DOM calls), and makes no request of
//     its own to any server
//   - it holds only a table, a sys_id and a few action ids; no ticket text
//   - it sits BELOW the page's own dialogs (a lower layer than ServiceNow's modal layers) and hides while one it can see is open
//   - a click on the Buddy mark closes the dock down to a small pill and opens it again; dragging the mark (or the left and right arrow keys on it) moves
//     the dock along the bottom edge, and the place is remembered in the page
import { MSG } from '../lib/messages.js';
import { direction, setLanguage, t } from '../i18n/index.js';
import { MARK, PATHS, SPARK } from '../sidepanel/ui/iconPaths.js';
import { featureIcon } from '../sidepanel/ui/featureIcons.js';
import themeCss from '../ui/theme.css';
import barCss from './bar.css';
import { BAR_Z, DOCK_BOTTOM_PX, DOCK_EDGE_PX, KEY_STEP, NOTICE_MS, POLL_MS, PREFS_KEY, clampX, clickNotice, clickVerdict, dockLeft, dragX, isGone, launchNotice, nextSeen, pageHasModal, parsePrefs, serializePrefs, xFor } from './barLogic.js';
import { createBarSync } from './barSync.js';

const SVG = 'http://www.w3.org/2000/svg';

function svgOf(doc, className, viewBox, size) {
  const svg = doc.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({ viewBox, width: String(size), height: String(size), 'aria-hidden': 'true', focusable: 'false', class: className })) svg.setAttribute(name, value);
  return svg;
}

function pathOf(doc, d, className = '') {
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  if (className) path.setAttribute('class', className);
  return path;
}

// An icon of the panel's own set (iconPaths.js), by name. Drawn with DOM calls, so nothing is loaded and a page CSP has nothing to block.
function glyph(doc, name, size = 18) {
  if (name === 'spark' || !PATHS[name]) {
    const svg = svgOf(doc, 'glyph glyph-fill', '0 0 24 24', size);
    svg.append(pathOf(doc, SPARK));
    return svg;
  }
  const svg = svgOf(doc, 'glyph', '0 0 24 24', size);
  svg.append(pathOf(doc, PATHS[name]));
  return svg;
}

// The mark of the product (the extension's own icon): a tile, a speech bubble and a tick.
function brandMark(doc, size = 30) {
  const svg = svgOf(doc, 'mark', '0 0 32 32', size);
  svg.append(pathOf(doc, MARK.tile, 'mark-tile'), pathOf(doc, MARK.bubble, 'mark-bubble'), pathOf(doc, MARK.tick, 'mark-tick'));
  return svg;
}

// Is this element drawn (not display: none, not visibility: hidden, in a tree that is shown)?
function isShown(el) {
  try {
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
    return el.getClientRects().length > 0;
  } catch {
    return true; // when unsure, count it: the dock then stays out of the way
  }
}

// Is a modal dialog open, as far as the top document and the classic form's frame can be seen from here (pageHasModal)?
function modalShown(doc, win) {
  const look = (d) => {
    if (!d) return {};
    let dialogs = 0;
    try {
      // Only a dialog that is on screen counts: a classic form keeps a hidden light box (display: none, aria-modal="true") in the page
      // all the time, which must not hide the dock.
      dialogs = [...d.querySelectorAll('[aria-modal="true"], .modal.in, .modal.show, dialog[open], .modal-backdrop')].filter(isShown).length;
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
  .replace(/:root:not\(\[data-theme='light'\]\)/g, ":host(:not([data-theme='light']))")
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
 *   doc, win         the page's document and window     (tests may pass others)
 * @returns {{ stop(): void }}
 */
export function startBar({ resolveRecord, send = (message) => chrome.runtime.sendMessage(message), onSiteOff = () => {}, doc = document, win = window }) {
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
  const state = { record: null, actions: [], busy: false, notice: '', modal: false, language: 'en', theme: '' };
  let appliedLanguage = '';
  let stopped = false;
  let refreshing = false;
  let shownActions = '';
  let shownNotice = '';
  let noticeTimer = 0;
  let wasShown = false; // were the action buttons on screen at the last draw?
  let armedAt = NaN; // when they last came on screen (or were rebuilt)

  // ---- the elements ----------------------------------------------------------------------------------------------
  const host = doc.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`${TOKENS}\n${barCss}`);
  shadow.adoptedStyleSheets = [sheet];

  const bar = h(doc, 'div', { class: 'bar', hidden: true });
  const dock = h(doc, 'div', { class: 'dock', role: 'group', 'aria-label': t('Agent Buddy quick actions') });
  // The mark: a click closes the dock down to this one button and opens it again (there is no other button for it); drag, or the arrow keys, move the dock.
  const handle = h(doc, 'button', { type: 'button', class: 'handle', 'aria-expanded': 'false' });
  handle.append(brandMark(doc));
  const sep = h(doc, 'span', { class: 'sep', 'aria-hidden': 'true' });
  const list = h(doc, 'div', { class: 'actions' });
  dock.append(handle, sep, list);
  // What a hovered icon is called, and what the person needs to know after a click that started nothing. Both float above the dock.
  const tip = h(doc, 'div', { class: 'tip', role: 'tooltip', hidden: true });
  const tipLine = h(doc, 'span', { class: 'tip-line' });
  const tipName = h(doc, 'span', { class: 'tip-name' });
  const tipAi = h(doc, 'span', { class: 'tip-ai' }, 'AI');
  const tipHint = h(doc, 'span', { class: 'tip-hint' });
  tipLine.append(tipName, tipAi);
  tip.append(tipLine, tipHint);
  const notice = h(doc, 'p', { class: 'notice', role: 'status', hidden: true });
  bar.append(dock, tip, notice);
  shadow.append(bar);

  // ---- where it sits ---------------------------------------------------------------------------------------------
  // The page's own style rules can beat a :host rule, so what keeps the dock in place is set on the element itself (through the
  // style object, which a page CSP allows, unlike a style attribute). A page script CAN still rewrite that style object, so what was
  // set is remembered and compared before a click is taken (intact()).
  let pinnedCss = '';
  const pin = (name, value) => host.style.setProperty(name, value, 'important');
  const viewWidth = () => doc.documentElement.clientWidth || win.innerWidth || 0;
  const leftNow = () => dockLeft({ x: prefs.x, view: viewWidth(), width: host.getBoundingClientRect().width });
  function pinAll() {
    pin('all', 'initial');
    pin('position', 'fixed');
    pin('bottom', `calc(${DOCK_BOTTOM_PX}px + env(safe-area-inset-bottom, 0px))`);
    pin('left', `${leftNow()}px`);
    pin('right', 'auto');
    pin('width', 'max-content'); // the dock's own width, whatever room is left to the right of it
    // Below the page's own dialogs and their backdrop (BAR_Z, barLogic.js): a ServiceNow dialog covers the bar, never the other way
    // round. Last in the document, so among equal layers the bar is drawn over the page's ordinary content.
    pin('z-index', String(BAR_Z));
    pin('display', 'block');
    pinnedCss = host.style.cssText;
  }
  // The middle of the dock stays where the person put it while the dock gets wider or narrower (opened, folded, other actions).
  function place() {
    if (bar.hidden) return;
    const left = `${leftNow()}px`;
    if (host.style.getPropertyValue('left') === left) return;
    pin('left', left);
    pinnedCss = host.style.cssText;
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

  // ---- the tooltip -----------------------------------------------------------------------------------------------
  // Above the dock, centred on the icon, kept inside the window.
  function floatAbove(el, centre) {
    el.style.left = '0px';
    const width = el.getBoundingClientRect().width;
    const view = viewWidth();
    const edge = DOCK_EDGE_PX;
    const wanted = Math.max(edge, Math.min(centre - width / 2, view - width - edge));
    el.style.left = `${Math.round(wanted - bar.getBoundingClientRect().left)}px`;
  }
  function hideTip() {
    tip.hidden = true;
  }
  // info: { name, ai, hint }
  function showTip(button, info) {
    if (state.notice || bar.hidden) return; // the note has the place above the dock
    tipName.textContent = info.name;
    tipAi.hidden = !info.ai;
    tipHint.textContent = info.hint || '';
    tipHint.hidden = !info.hint;
    tip.hidden = false;
    const box = button.getBoundingClientRect();
    floatAbove(tip, box.left + box.width / 2);
  }
  // A mouse or a pen over an icon, or the keyboard on it (a click's focus does not count: :focus-visible), shows the name.
  function bindTip(button, info) {
    button.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') showTip(button, info());
    });
    button.addEventListener('pointerleave', hideTip);
    button.addEventListener('focus', () => {
      let visible = false;
      try {
        visible = button.matches(':focus-visible');
      } catch {
        visible = false;
      }
      if (visible) showTip(button, info());
    });
    button.addEventListener('blur', hideTip);
  }
  bindTip(handle, () => ({ name: 'Agent Buddy', ai: false, hint: prefs.open ? t('Click to close. Drag, or use the arrow keys, to move it along the bottom.') : t('Click to open. Drag, or use the arrow keys, to move it along the bottom.') }));

  // ---- drawing ---------------------------------------------------------------------------------------------------
  // The texts that are written once, when the bar is built, are written again when the language changes (the worker says which it is).
  function applyLanguage() {
    if (appliedLanguage === state.language) return;
    appliedLanguage = state.language;
    setLanguage(state.language);
    bar.setAttribute('dir', direction());
    dock.setAttribute('aria-label', t('Agent Buddy quick actions'));
    shownActions = ''; // the buttons carry names and hints: draw them again
  }

  function render() {
    applyLanguage();
    if (state.theme) host.setAttribute('data-theme', state.theme); // 'light' or 'dark'; none: the colours follow the computer
    else host.removeAttribute('data-theme');
    const visible = Boolean(state.record) && state.actions.length > 0 && !state.modal;
    bar.hidden = !visible;
    if (!visible) hideTip();
    if (!intact()) pinAll();

    // Open: the mark and the icons. Folded: the mark alone, a small pill.
    list.hidden = !prefs.open;
    sep.hidden = !prefs.open;
    handle.setAttribute('aria-expanded', String(prefs.open));
    handle.setAttribute('aria-label', prefs.open ? t('Close the Agent Buddy quick actions') : t('Open the Agent Buddy quick actions'));

    // Rebuilt only when the actions change, so the focus stays where it is while the page is looked at again.
    const signature = state.actions.map((a) => `${a.id}:${a.label}`).join('|');
    let rebuilt = false;
    if (signature !== shownActions) {
      shownActions = signature;
      rebuilt = true;
      watcher?.disconnect();
      hideTip();
      list.replaceChildren(
        ...state.actions.map((action, i) => {
          // An icon, and the action's name for a screen reader (the tooltip shows it to everyone else). An AI action carries the AI
          // spark and says where text goes; an Insights card says it stays in ServiceNow.
          const hint = action.ai ? t('Uses AI: opens the side panel, which shows what will be sent first') : t('Stays in ServiceNow: opens this in the side panel');
          const button = h(doc, 'button', { type: 'button', class: i === 0 ? 'act act-first' : 'act', 'data-ai': action.ai ? 'true' : false, 'aria-description': hint });
          button.append(glyph(doc, featureIcon(action.id)), h(doc, 'span', { class: 'sr' }, action.label));
          if (action.ai) {
            const dot = h(doc, 'span', { class: 'ai-dot', 'aria-hidden': 'true' });
            dot.append(glyph(doc, 'spark', 8));
            button.append(dot);
          }
          button.addEventListener('click', (e) => e.isTrusted && press(action, button));
          bindTip(button, () => ({ name: action.label, ai: action.ai, hint }));
          watcher?.observe(button);
          return button;
        })
      );
    }
    for (const button of list.children) button.disabled = state.busy;

    // The buttons count as "on screen" from the moment they appear (the dock opened, or new actions were drawn).
    const shownNow = visible && prefs.open;
    if (shownNow && (!wasShown || rebuilt)) armedAt = Date.now();
    wasShown = shownNow;

    // A note goes away by itself after a while, and when the dock is folded.
    if (!prefs.open) state.notice = '';
    if (state.notice !== shownNotice) {
      shownNotice = state.notice;
      win.clearTimeout(noticeTimer);
      if (state.notice) {
        hideTip();
        noticeTimer = win.setTimeout(() => {
          state.notice = '';
          if (!stopped) render();
        }, NOTICE_MS);
      }
    }
    notice.textContent = state.notice;
    notice.hidden = !state.notice;

    place(); // after everything that changes the dock's width
    if (state.notice && visible) {
      const box = dock.getBoundingClientRect();
      floatAbove(notice, box.left + box.width / 2);
    }
  }

  function setOpen(open, focus) {
    prefs = { ...prefs, open };
    prefsBox.write(serializePrefs(prefs));
    hideTip(); // its hint says what a click does, which just changed
    render();
    if (focus) (open ? list.firstElementChild || handle : handle).focus();
  }

  // ---- the person's clicks ---------------------------------------------------------------------------------------
  // A click is taken only when the dock is in plain view (see clickVerdict); otherwise the person is told and nothing starts.
  function press(action, button) {
    if (state.busy || !state.record) return;
    hideTip();
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

  // ---- moving the dock along the bottom ---------------------------------------------------------------------------
  // A press on the mark that moves the pointer is a drag; one that does not is a click (fold or open). The new place is kept in the
  // page's storage.
  let drag = null; // { startPx, startX, moved }
  let swallowClick = false;
  function placeAt(x) {
    prefs = { ...prefs, x: clampX(x) };
    place();
  }
  handle.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted || e.button !== 0) return;
    hideTip();
    drag = { startPx: e.clientX, startX: xFor(prefs), moved: false };
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* not supported: the drag then ends when the pointer leaves the mark */
    }
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag || !e.isTrusted) return;
    const x = dragX({ startX: drag.startX, startPx: drag.startPx, px: e.clientX, view: viewWidth() });
    if (x === null) return;
    drag.moved = true;
    placeAt(x);
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) {
      swallowClick = true; // the click that follows the release belongs to the drag, it is not "fold" or "open"
      prefsBox.write(serializePrefs(prefs));
    }
    drag = null;
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  // The keyboard moves the dock too: left and right arrows on the mark, a few percent a press.
  handle.addEventListener('keydown', (e) => {
    if (!e.isTrusted || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    placeAt(xFor(prefs) + (e.key === 'ArrowLeft' ? -KEY_STEP : KEY_STEP));
    prefsBox.write(serializePrefs(prefs));
  });

  handle.addEventListener('click', (e) => {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    if (e.isTrusted) setOpen(!prefs.open, true);
  });
  // Escape: first the tooltip goes, then the dock closes (down to the mark).
  shadow.addEventListener('keydown', (e) => {
    if (!e.isTrusted || e.key !== 'Escape') return;
    if (!tip.hidden) hideTip();
    else if (prefs.open) setOpen(false, true);
  });
  const onResize = () => place();
  win.addEventListener('resize', onResize);

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
    if (result.language) state.language = result.language;
    if (typeof result.theme === 'string') state.theme = result.theme;
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
    win.clearTimeout(noticeTimer);
    win.removeEventListener('resize', onResize);
    watcher?.disconnect();
    host.remove();
  }

  return { stop };
}

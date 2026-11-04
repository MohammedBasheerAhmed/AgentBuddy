// An accessibility and colour audit of what is on screen in a page of the extension (the side panel, the settings page, the Team page).
// It runs IN the page, on what a person could see and press right now, so it also covers the dark theme (the scenario switches the
// browser's colour scheme) and every state the scenario brings up. Rules (WCAG 2.1 AA and 2.2 AA where they can be measured):
//
//   contrast         text against the colour behind it: 4.5:1, 3:1 for large text; disabled controls are exempt
//   name             every button, link, field, tab and menu item has a name a screen reader can say
//   field-label      every field has a label, not only a placeholder
//   duplicate-id     no two elements share an id (labels and aria-* point at ids)
//   dangling-ref     aria-labelledby and aria-describedby point at elements that exist
//   tab-structure    a tab sits in a tablist, says whether it is selected, and controls a panel that exists
//   empty-heading    no heading without text
//   hidden-focusable nothing inside an aria-hidden area can take the focus
//   focus-visible    a control that takes the focus shows it (outline, ring, border or background changes)
//   target-size      a control is at least 24 x 24 px (WCAG 2.2, 2.5.8), or its label is
//   document         the page has a language and a title
//   overflow         at the narrowest width (320 px) nothing scrolls sideways
//
// `auditPage` is sent to the page as source: it must not use anything from this file.

function auditPage(options) {
  const opts = Object.assign({ rules: null, focusLimit: 60, root: null, narrow: false }, options || {});
  // With a dialog open, the page behind it is shut off (inert) and dimmed: only the dialog is looked at.
  const root = (opts.root && document.querySelector(opts.root)) || document.body;
  const found = [];
  const seen = new Set();
  const on = (rule) => !opts.rules || opts.rules.includes(rule);

  const shown = (el) => {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || cs.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const text = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
  };
  const add = (rule, el, detail) => {
    if (!on(rule)) return;
    const where = el ? describe(el) : 'page';
    const key = `${rule}|${where}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ rule, where, detail });
  };

  // ---- colour -------------------------------------------------------------------------------------------------------------
  const parse = (s) => {
    const m = /^rgba?\(([^)]+)\)$/.exec(s.trim());
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, under) => {
    const a = top.a + under.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (x, y) => (x * top.a + y * under.a * (1 - top.a)) / a;
    return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a };
  };
  const lum = (c) => {
    const ch = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  // The colour behind an element: every background from the element up to the first opaque one, laid over the page colour. null when
  // an image or gradient is in the way (the colour cannot be told).
  const behind = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') return null;
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) layers.push(bg);
      if (bg && bg.a === 1) break;
    }
    const canvas = getComputedStyle(document.documentElement).colorScheme.includes('dark') ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
    return layers.reduceRight((under, top) => over(top, under), canvas);
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };

  if (on('contrast')) {
    for (const el of root.querySelectorAll('*')) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH'].includes(el.tagName.toUpperCase())) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0);
      if (!own || !shown(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue; // visually hidden text
      if (el.closest(':disabled, [aria-disabled="true"]')) continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      const bg = behind(el);
      if (!fg || !bg) continue;
      const alpha = fg.a * opacityOf(el);
      const text = over({ r: fg.r, g: fg.g, b: fg.b, a: alpha }, bg);
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      const need = large ? 3 : 4.5;
      const got = ratio(text, bg);
      if (got + 0.005 < need) add('contrast', el, `${got.toFixed(2)}:1, needs ${need}:1 (${cs.color} on rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)}))`);
    }
  }

  // ---- names, labels, structure --------------------------------------------------------------------------------------------
  const INTERACTIVE =
    'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=checkbox], [role=switch], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option], [role=radio], [role=combobox]';
  const idText = (list) =>
    String(list || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((n) => (n.innerText || n.textContent || '').trim())
      .join(' ')
      .trim();
  const nameOf = (el) => {
    const by = idText(el.getAttribute('aria-labelledby'));
    if (by) return by;
    const label = (el.getAttribute('aria-label') || '').trim();
    if (label) return label;
    if (el.labels && el.labels.length) {
      const t = [...el.labels].map((l) => (l.innerText || l.textContent || '').trim()).join(' ').trim();
      if (t) return t;
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/.test(el.type)) return (el.value || '').trim();
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text;
    const img = el.querySelector('img[alt]');
    if (img && img.alt.trim()) return img.alt.trim();
    return (el.getAttribute('title') || '').trim();
  };
  const all = [...root.querySelectorAll(INTERACTIVE)].filter((el) => shown(el) && !el.closest('[inert]'));

  if (on('name')) for (const el of all) if (!nameOf(el)) add('name', el, 'nothing a screen reader can say');
  if (on('field-label')) {
    for (const el of all) {
      if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || /^(button|submit|reset|hidden)$/.test(el.type || '')) continue;
      const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.labels && el.labels.length);
      if (!labelled) add('field-label', el, el.getAttribute('placeholder') ? 'only a placeholder' : 'no label');
    }
  }

  if (on('duplicate-id')) {
    const counts = new Map();
    for (const el of document.querySelectorAll('[id]')) counts.set(el.id, (counts.get(el.id) || 0) + 1);
    for (const [id, n] of counts) if (n > 1 && id) add('duplicate-id', document.getElementById(id), `id "${id}" is used ${n} times`);
  }

  if (on('dangling-ref')) {
    for (const el of document.querySelectorAll('[aria-labelledby], [aria-describedby]')) {
      if (!shown(el)) continue;
      for (const attr of ['aria-labelledby', 'aria-describedby']) {
        const ids = (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean);
        for (const id of ids) if (!document.getElementById(id)) add('dangling-ref', el, `${attr} "${id}" does not exist`);
      }
    }
  }

  if (on('tab-structure')) {
    for (const tab of document.querySelectorAll('[role=tab]')) {
      if (!shown(tab)) continue;
      if (!tab.closest('[role=tablist]')) add('tab-structure', tab, 'a tab outside any tablist');
      const sel = tab.getAttribute('aria-selected');
      if (sel !== 'true' && sel !== 'false') add('tab-structure', tab, 'no aria-selected');
      const controls = tab.getAttribute('aria-controls');
      if (controls && !document.getElementById(controls)) add('tab-structure', tab, `aria-controls "${controls}" does not exist`);
    }
    for (const list of document.querySelectorAll('[role=tablist]')) {
      if (!shown(list)) continue;
      const tabs = [...list.querySelectorAll('[role=tab]')].filter(shown);
      const picked = tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length;
      if (tabs.length && picked !== 1) add('tab-structure', list, `${picked} tabs selected (should be 1)`);
      if (!list.getAttribute('aria-label') && !list.getAttribute('aria-labelledby')) add('tab-structure', list, 'a tablist with no name');
    }
  }

  if (on('empty-heading')) {
    for (const h of document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading]')) {
      if (shown(h) && !(h.textContent || '').trim()) add('empty-heading', h, 'a heading with no text');
    }
  }

  if (on('hidden-focusable')) {
    for (const el of document.querySelectorAll('[aria-hidden="true"] :is(button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"]))')) {
      if (shown(el) && !el.disabled) add('hidden-focusable', el, 'can take the focus inside an aria-hidden area');
    }
  }

  // ---- size and focus ------------------------------------------------------------------------------------------------------
  if (on('target-size')) {
    const boxes = all.map((el) => [el, el.getBoundingClientRect()]);
    const crowded = (el, r) => {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      return boxes.some(([other, o]) => {
        if (other === el || other.contains(el) || el.contains(other) || (el.labels && [...el.labels].some((l) => l.contains(other)))) return false;
        const dx = Math.max(o.left - cx, 0, cx - o.right);
        const dy = Math.max(o.top - cy, 0, cy - o.bottom);
        return dx * dx + dy * dy < 12 * 12;
      });
    };
    for (const el of all) {
      if (el.disabled) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 23.5 && r.height >= 23.5) continue;
      // A small box with a label that is big enough is pressed through its label (checkbox, radio).
      const big = el.labels && [...el.labels].some((l) => l.getBoundingClientRect().width >= 23.5 && l.getBoundingClientRect().height >= 23.5);
      if (big) continue;
      // WCAG 2.5.8 also accepts a small target when a 24 px circle on it touches no other target.
      if (!crowded(el, r)) continue;
      // A link inside a sentence is exempt (WCAG 2.5.8, inline).
      if (el.tagName === 'A' && el.closest('p, li, .ab-sub, .ab-note') && (el.parentElement.innerText || '').length > (el.innerText || '').length + 10) continue;
      add('target-size', el, `${Math.round(r.width)} x ${Math.round(r.height)} px`);
    }
  }

  if (on('focus-visible')) {
    const snap = (el) => {
      const cs = getComputedStyle(el);
      return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderTopColor, cs.borderBottomColor, cs.backgroundColor, cs.textDecorationLine, cs.color].join('|');
    };
    const ring = (el) => {
      const cs = getComputedStyle(el);
      return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
    };
    // Start from nothing focused (a control that was just clicked already shows its ring, which would read as no change), and with
    // no transition running (a style read in the middle of one is still the old style).
    const previous = document.activeElement;
    if (previous && previous.blur) previous.blur();
    // (a constructed stylesheet: a <style> element would be refused by the extension pages' own content security policy)
    const still = new CSSStyleSheet();
    still.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }');
    const sheetsBefore = document.adoptedStyleSheets;
    document.adoptedStyleSheets = [...sheetsBefore, still];
    let tried = 0;
    for (const el of all) {
      if (tried >= opts.focusLimit) break;
      if (el.disabled || el.tabIndex < 0 || el.tagName === 'INPUT' && el.type === 'hidden') continue;
      tried += 1;
      const before = snap(el);
      const hadRing = ring(el);
      try {
        el.focus({ focusVisible: true, preventScroll: true });
      } catch {
        el.focus();
      }
      if (document.activeElement !== el) continue;
      const after = snap(el);
      if (after === before && !(ring(el) && !hadRing)) add('focus-visible', el, 'no change when it takes the focus');
      el.blur();
    }
    document.adoptedStyleSheets = sheetsBefore;
    if (previous && previous.focus) previous.focus({ preventScroll: true });
  }

  // ---- the page itself -----------------------------------------------------------------------------------------------------
  if (on('document')) {
    if (!document.documentElement.lang) add('document', null, 'no lang on <html>');
    if (!document.title.trim()) add('document', null, 'no <title>');
  }
  if (on('overflow') && opts.narrow) {
    const wide = document.documentElement.scrollWidth - window.innerWidth;
    if (wide > 1) {
      const culprits = [...document.querySelectorAll('body *')].filter((el) => shown(el) && el.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 3);
      add('overflow', null, `scrolls sideways by ${wide} px at ${window.innerWidth} px wide${culprits.length ? `: ${culprits.map(describe).join(' | ')}` : ''}`);
    }
  }

  return found;
}

module.exports = { auditPage };

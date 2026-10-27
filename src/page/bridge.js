// PAGE-WORLD script (registered as a MAIN-world content script on instances the person enabled). It runs in the
// ServiceNow page's own JavaScript context so it can read page globals such as g_form, g_user and g_ck.
//
// Communication contract (both directions use CustomEvent on `document`):
//   content -> page : 'ab-page-request'  detail { id, action, args }
//   page -> content : 'ab-page-response' detail { id, ok, result, error }
//
// SECURITY: this bridge is deliberately tiny.
//  - It READS: the session token (needed for same-origin REST reads), who the user is, which record the form shows and
//    the values of fields the caller names.
//  - It exposes exactly ONE write: fillField(), which sets one existing field's value on the open form, the same as typing
//    into it. It never saves the form (there is no save action here), never calls REST, never evaluates caller-supplied code.
//    The agent presses the form's own Save, so ACLs, business rules, client scripts and the audit trail all apply.
//  - On a portal page (Service Portal, Employee Center, customer service portal: no g_form, an Angular page) fillField finds the
//    comment or work-notes box in the page and types into it like a person would. It refuses when it cannot tell which box is
//    meant, and it never presses a button of the page: the person reads the text and presses the portal's own Send.
//  - A page script can see these events and could answer them. The content script therefore treats every answer as data to
//    check, never as authority. Do not add an "eval" style action.

(function () {
  if (window.__abBridgeInstalled) return;
  window.__abBridgeInstalled = true;

  var REQUEST_EVENT = 'ab-page-request';
  var RESPONSE_EVENT = 'ab-page-response';
  var MAX_FIELD_CHARS = 20000;

  // Forms live in the top window (Next Experience) or inside the classic `gsft_main` iframe. Resolve whichever has g_form.
  function resolveFormWindow() {
    if (typeof window.g_form !== 'undefined' && window.g_form) return window;
    try {
      var frame = window.frames['gsft_main'];
      if (frame && typeof frame.g_form !== 'undefined' && frame.g_form) return frame;
    } catch (e) {
      /* cross-origin frame */
    }
    try {
      for (var i = 0; i < window.frames.length && i < 20; i++) {
        try {
          var child = window.frames[i];
          if (child && child.g_form && typeof child.g_form.getValue === 'function') return child;
        } catch (e) {
          /* cross-origin child */
        }
      }
    } catch (e) {
      /* no frames */
    }
    return null;
  }

  function rolesOf(u) {
    try {
      if (Array.isArray(u.roles)) return u.roles.slice(0, 200).map(function (r) { return String(r).slice(0, 80); });
      if (typeof u.roles === 'string' && u.roles) return u.roles.split(',').map(function (r) { return r.trim().slice(0, 80); }).filter(Boolean).slice(0, 200);
    } catch (e) {
      /* not available */
    }
    return null;
  }

  // ---- Who is signed in, on pages without g_user (portals) -----------------------------------------------------------
  // Portal pages are Angular pages. They may carry the user in a `NOW` global or on the Angular root scope instead of g_user.
  // Only these four things are ever looked at: the user's sys_id, user name, display name and roles. Every read is guarded:
  // a missing or odd global just means "not there". Nothing is evaluated and nothing is called except the Angular injector's
  // own lookup of the root scope.
  var SYS_ID_RE = /^[0-9a-f]{32}$/i;

  function isSysId(value) {
    return SYS_ID_RE.test(value);
  }

  function cleanText(value, max) {
    if (typeof value !== 'string') return null;
    var t = value.trim();
    return t ? t.slice(0, max || 200) : null;
  }

  function firstOf(obj, names, test) {
    for (var i = 0; i < names.length; i++) {
      var value = null;
      try {
        value = cleanText(obj[names[i]], 200);
      } catch (e) {
        value = null;
      }
      if (value && (!test || test(value))) return value;
    }
    return null;
  }

  // `rootLevel` = the global NOW object itself, whose generic names (sys_id, name) may describe the PAGE, not the person.
  function userFromObject(obj, rootLevel) {
    if (!obj || typeof obj !== 'object') return null;
    var found = {
      userName: firstOf(obj, rootLevel ? ['user_name'] : ['userName', 'user_name', 'username']),
      userId: firstOf(obj, rootLevel ? ['user_id'] : ['userID', 'user_id', 'userId', 'sys_id', 'sysId'], isSysId),
      firstName: rootLevel ? null : firstOf(obj, ['firstName', 'first_name']),
      lastName: rootLevel ? null : firstOf(obj, ['lastName', 'last_name']),
      displayName: firstOf(obj, rootLevel ? ['user_display_name', 'user_full_name'] : ['displayName', 'display_name', 'fullName', 'full_name', 'name']),
      roles: rootLevel ? null : rolesOf(obj),
    };
    return found.userId || found.userName || found.displayName || found.firstName ? found : null;
  }

  // An Angular service of a portal page, or null (angular.element(...).injector() works with debug info off, as on production).
  // Only services that already exist are returned; nothing is created or called.
  function angularService(name) {
    try {
      var ng = window.angular;
      if (!ng || typeof ng.element !== 'function') return null;
      var roots = [document.documentElement, document.body, document.querySelector('[ng-app]'), document.querySelector('[data-ng-app]')];
      for (var i = 0; i < roots.length; i++) {
        if (!roots[i]) continue;
        var injector = ng.element(roots[i]).injector();
        if (injector && typeof injector.get === 'function' && (typeof injector.has !== 'function' || injector.has(name))) return injector.get(name);
      }
    } catch (e) {
      /* no Angular, or not bootstrapped yet */
    }
    return null;
  }

  function mergeUsers(into, extra) {
    if (!extra) return into;
    if (!into) return extra;
    Object.keys(extra).forEach(function (key) {
      if (!into[key] && extra[key]) into[key] = extra[key];
    });
    return into;
  }

  function portalSessionInfo() {
    var merged = null;
    try {
      var now = window.NOW;
      if (now && typeof now === 'object') {
        merged = mergeUsers(merged, userFromObject(now.user, false));
        merged = mergeUsers(merged, userFromObject(now, true));
      }
    } catch (e) {
      /* NOW is not readable */
    }
    var scope = angularService('$rootScope');
    try {
      if (scope) merged = mergeUsers(merged, userFromObject(scope.user, false));
    } catch (e) {
      /* no user on the scope */
    }
    return merged;
  }

  // A field name is a plain ServiceNow column name; anything else is refused before it reaches g_form or the DOM.
  var FIELD_RE = /^[a-z][a-z0-9_]{0,79}$/;

  // Password-typed fields and fields named like secrets are never read.
  var SECRET_NAME_RE = /pass(word)?|secret|token|api[_-]?key|credential|private[_-]?key/i;

  function fieldType(f, name) {
    try {
      var ge = f.getGlideUIElement && f.getGlideUIElement(name);
      return ge && ge.type ? String(ge.type) : '';
    } catch (e) {
      return '';
    }
  }

  // ---- DOM fallback for Workspaces, where g_form is not a page global ------------------------------------------------
  // Walks the document and every open shadow root looking for the editable control of a field. Best effort: Workspace
  // components keep their own state, so a successful DOM write is reported as method 'dom' and the panel still offers Copy.
  function deepFind(root, test, out, depth) {
    if (!root || depth > 12 || out.length) return out;
    var nodes;
    try {
      nodes = root.querySelectorAll('*');
    } catch (e) {
      return out;
    }
    for (var i = 0; i < nodes.length && !out.length; i++) {
      var el = nodes[i];
      if (test(el)) {
        out.push(el);
        break;
      }
      if (el.shadowRoot) deepFind(el.shadowRoot, test, out, depth + 1);
    }
    return out;
  }

  function findControlInDom(name, label) {
    var wanted = (label || '').toLowerCase();
    var found = deepFind(document, function (el) {
      var tag = el.tagName;
      if (tag !== 'TEXTAREA' && tag !== 'INPUT') return false;
      var attrs = [el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('data-field-name')];
      if (attrs.some(function (a) { return a && (a === name || a.slice(-(name.length + 1)) === '.' + name); })) return true;
      // Workspace controls carry only an aria-label ("Work notes", sometimes "Work notes (internal)"): match the whole phrase.
      var aria = (el.getAttribute('aria-label') || '').toLowerCase();
      return Boolean(wanted) && Boolean(aria) && (aria === wanted || aria.indexOf(wanted) !== -1);
    }, [], 0);
    return found[0] || null;
  }

  // `text` below what a field holds already (nothing is added above or in place of it).
  function appendBelow(existing, text) {
    var current = existing == null ? '' : String(existing);
    return current.trim() ? current.replace(/\s+$/, '') + '\n\n' + text : text;
  }

  function setNativeValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  // ---- Portal pages: Service Portal, Employee Center, customer service portal ---------------------------------------
  // No g_form here. The comment box and the work-notes box are ordinary controls of an Angular page, found by what they are
  // called (name, id, ng-model, aria-label, label, placeholder). The rules, in order of importance:
  //  1. A customer-visible box is never taken for the internal one, or the other way round: a box whose own words mention the
  //     other kind ("work notes", "internal", "customer", ...) is not a candidate. No match at all means no write.
  //  2. Several equally good boxes mean no write (the person copies the text instead).
  //  3. Hidden, disabled and read-only boxes are never written. Nothing on the page is clicked, ever.
  //  4. The text goes in the way typing would put it, so Angular's ngModel (and a framework's own state) follows: the native
  //     value setter, then input and change events (blur too, when the box updates on blur).

  function onPortalPage() {
    try {
      var path = location.pathname.replace(/\/+$/, '');
      if (/\.do$/i.test(path) || /^\/(now|api|angular)(\/|$)/i.test(path)) return false;
      var parts = path.split('/').filter(Boolean);
      if (parts.length !== 1 || !/^[a-z][a-z0-9_-]{0,30}$/i.test(parts[0])) return false;
      if (/(^|[?&#!/])id=/i.test(location.search + location.hash)) return true;
      return /^(sp|esc|ec|csm|csp|hrsp)$/i.test(parts[0]);
    } catch (e) {
      return false;
    }
  }

  // Words a box of each field is called by, and words that mark a box as the OTHER kind. Compared as whole words.
  var PORTAL_WORDS = {
    comments: {
      is: ['comment', 'comments', 'additional comments', 'additional comment', 'reply', 'customer comments'],
      isNot: ['work note', 'work notes', 'worknotes', 'internal', 'private', 'close notes', 'close note', 'resolution', 'search', 'password'],
    },
    work_notes: {
      is: ['work note', 'work notes', 'worknotes', 'internal note', 'internal notes', 'private note', 'private notes'],
      isNot: ['comment', 'comments', 'reply', 'customer', 'public', 'visible', 'additional comments', 'close notes', 'close note', 'resolution', 'search', 'password'],
    },
    close_notes: {
      is: ['close notes', 'close note', 'resolution notes', 'resolution note', 'closure notes'],
      isNot: ['comment', 'comments', 'work note', 'work notes', 'worknotes', 'internal', 'search', 'password'],
    },
  };

  // "c.data.newComment" -> " c data new comment ": lower case words, so a phrase is found only as whole words.
  function wordsOf(text) {
    var t = String(text == null ? '' : text).slice(0, 300).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return t ? ' ' + t + ' ' : '';
  }

  function hasPhrase(words, phrase) {
    return words.indexOf(' ' + phrase + ' ') !== -1;
  }

  // Every shadow root and every same-origin frame we can reach. A frame we cannot read (another origin) is simply skipped.
  function collectControls(root, out, state, depth, frameEl) {
    if (!root || depth > 6 || state.nodes > 25000) return;
    var nodes;
    try {
      nodes = root.querySelectorAll('*');
    } catch (e) {
      return;
    }
    for (var i = 0; i < nodes.length; i++) {
      state.nodes++;
      if (state.nodes > 25000) return;
      var el = nodes[i];
      var tag = el.tagName;
      if (el.shadowRoot) collectControls(el.shadowRoot, out, state, depth + 1, frameEl);
      if (tag === 'IFRAME' || tag === 'FRAME') {
        var doc = null;
        try {
          doc = el.contentDocument;
        } catch (e) {
          doc = null;
        }
        if (doc) {
          collectControls(doc, out, state, depth + 1, el);
          // A rich-text editor in a frame: the frame's body is the editable area.
          try {
            var bodyEditable = doc.body ? doc.body.getAttribute('contenteditable') : null;
            if (doc.body && (doc.designMode === 'on' || (bodyEditable !== null && /^(|true|plaintext-only)$/i.test(bodyEditable)))) out.push({ el: doc.body, frame: el });
          } catch (e) {
            /* unreadable body */
          }
        }
        continue;
      }
      if (isTextControl(el)) out.push({ el: el, frame: frameEl || null });
    }
  }

  function isTextControl(el) {
    var tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      return type === 'text';
    }
    // An editable area: the element that CARRIES contenteditable (its editable children are not separate boxes).
    var ce = el.getAttribute('contenteditable');
    return ce !== null && /^(|true|plaintext-only)$/i.test(ce);
  }

  function viewOf(el) {
    return (el.ownerDocument && el.ownerDocument.defaultView) || window;
  }

  function isVisible(el) {
    try {
      if (el.hidden) return false;
      var rects = el.getClientRects();
      if (!rects || !rects.length) return false;
      var r = rects[0];
      // Not rendered, or hidden the way screen-reader-only text is (1px, or far off to the left).
      if (!(r.width > 1 && r.height > 1) || r.right <= 0) return false;
      var style = viewOf(el).getComputedStyle(el);
      return !(style && (style.visibility === 'hidden' || style.display === 'none'));
    } catch (e) {
      return false;
    }
  }

  function isReadOnlyControl(el) {
    return Boolean(el.disabled || el.readOnly || el.getAttribute('aria-readonly') === 'true' || el.getAttribute('aria-disabled') === 'true');
  }

  function textOfIds(el, ids) {
    var out = [];
    var root = el.getRootNode ? el.getRootNode() : document;
    String(ids || '').split(/\s+/).slice(0, 4).forEach(function (id) {
      var target = id && root.getElementById ? root.getElementById(id) : null;
      if (target) out.push(String(target.textContent || '').slice(0, 120));
    });
    return out.join(' ');
  }

  function labelTexts(el) {
    var out = [];
    try {
      var labels = el.labels;
      for (var i = 0; labels && i < labels.length && i < 3; i++) out.push(String(labels[i].textContent || '').slice(0, 120));
    } catch (e) {
      /* no labels collection */
    }
    return out;
  }

  // What a control is called, as [kind, words] pairs. `kind` decides how much a match is worth.
  function signalsOf(c) {
    var el = c.el;
    var list = [];
    function add(kind, text) {
      var words = wordsOf(text);
      if (words) list.push([kind, words]);
    }
    function attr(name) {
      try {
        return el.getAttribute(name);
      } catch (e) {
        return null;
      }
    }
    ['name', 'id', 'data-field-name', 'data-name', 'formcontrolname'].forEach(function (n) { add('name', attr(n)); });
    ['ng-model', 'data-ng-model', 'x-ng-model', 'ng:model'].forEach(function (n) { add('model', attr(n)); });
    add('aria', attr('aria-label'));
    add('aria', textOfIds(el, attr('aria-labelledby')));
    labelTexts(el).forEach(function (t) { add('label', t); });
    add('placeholder', attr('placeholder'));
    add('placeholder', attr('data-placeholder'));
    add('placeholder', attr('aria-placeholder'));
    add('title', attr('title'));
    if (c.frame) {
      // A rich-text editor is named by its frame and the label of its frame.
      ['title', 'name', 'id', 'aria-label'].forEach(function (n) { add('title', c.frame.getAttribute(n)); });
      labelTexts(c.frame).forEach(function (t) { add('label', t); });
    }
    return list;
  }

  var SIGNAL_WEIGHT = { name: 60, model: 60, aria: 55, label: 55, placeholder: 45, title: 35 };

  // How well a control matches the field, 0 = not at all. A control that also carries the OTHER kind's words scores 0.
  function scoreControl(c, words, extraPhrases) {
    var signals = signalsOf(c);
    var is = words.is.concat(extraPhrases);
    var best = 0;
    var kinds = {};
    for (var i = 0; i < signals.length; i++) {
      if (words.isNot.some(function (p) { return hasPhrase(signals[i][1], p); })) return 0;
      for (var j = 0; j < is.length; j++) {
        if (!hasPhrase(signals[i][1], is[j])) continue;
        var exact = signals[i][1] === ' ' + is[j] + ' ';
        best = Math.max(best, SIGNAL_WEIGHT[signals[i][0]] + (exact ? 20 : 0));
        kinds[signals[i][0]] = true;
      }
    }
    return best ? best + Math.min(Object.keys(kinds).length - 1, 3) * 5 : 0;
  }

  // Another field than the three journal fields: its own name (and the label the panel gave) are all there is to go by.
  function wordsForField(name) {
    var known = PORTAL_WORDS[name];
    if (known) return known;
    return { is: [wordsOf(name).trim()], isNot: ['search', 'password'] };
  }

  function chooseControl(name, label) {
    var controls = [];
    collectControls(document, controls, { nodes: 0 }, 0, null);
    var words = wordsForField(name);
    var extra = label ? [wordsOf(label).trim()].filter(Boolean) : [];
    var editable = [];
    var locked = [];
    var seen = [];
    controls.forEach(function (c) {
      if (seen.indexOf(c.el) !== -1) return;
      seen.push(c.el);
      if (SECRET_NAME_RE.test(String(c.el.getAttribute('name') || '') + ' ' + String(c.el.getAttribute('id') || '') + ' ' + String(c.el.getAttribute('ng-model') || ''))) return;
      var score = scoreControl(c, words, extra);
      if (!score || !isVisible(c.el)) return;
      (isReadOnlyControl(c.el) ? locked : editable).push({ el: c.el, score: score });
    });
    editable.sort(function (a, b) { return b.score - a.score; });
    if (editable.length) {
      // Several boxes that look the same: do not guess which one the person means.
      if (editable.length > 1 && editable[0].score - editable[1].score < 15) return { reason: 'no-form' };
      return { el: editable[0].el };
    }
    return { reason: locked.length ? 'read-only' : 'no-form' };
  }

  function fireEvent(el, type, bubbles) {
    var view = viewOf(el);
    el.dispatchEvent(new view.Event(type, { bubbles: bubbles, composed: true }));
  }

  function setControlValue(el, value) {
    var view = viewOf(el);
    var proto = el.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
  }

  function squash(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  // Type into a rich-text area: the browser's own text insertion keeps the editor's state in step. When it refuses, the text is
  // built from plain nodes (never from markup).
  function writeEditable(el, text, append) {
    var doc = el.ownerDocument;
    var view = viewOf(el);
    var current = el.innerText != null ? el.innerText : el.textContent;
    var piece = append && String(current || '').trim() ? '\n\n' + text : text;
    var done = false;
    try {
      el.focus();
      var selection = view.getSelection();
      var range = doc.createRange();
      range.selectNodeContents(el);
      if (append) range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      done = doc.execCommand('insertText', false, piece) === true;
    } catch (e) {
      done = false;
    }
    if (!done) {
      if (!append) while (el.firstChild) el.removeChild(el.firstChild);
      piece.split('\n').forEach(function (line, i) {
        if (i > 0) el.appendChild(doc.createElement('br'));
        if (line) el.appendChild(doc.createTextNode(line));
      });
    }
    fireEvent(el, 'input', true);
    fireEvent(el, 'change', true);
    var probe = squash(text).slice(0, 40);
    return squash(el.innerText != null ? el.innerText : el.textContent).indexOf(probe) !== -1;
  }

  function fillPortalField(name, text, label, append) {
    var chosen = chooseControl(name, label);
    if (!chosen.el) return { ok: false, reason: chosen.reason };
    var el = chosen.el;
    try {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        var next = append === true ? appendBelow(el.value, text) : text;
        if (next.length > MAX_FIELD_CHARS || (el.maxLength > 0 && next.length > el.maxLength)) return { ok: false, reason: 'too-long' };
        setControlValue(el, next);
        fireEvent(el, 'input', true);
        fireEvent(el, 'change', true);
        // A box that only updates its model when it loses focus is told so, the way tabbing out of it would.
        if (/blur/i.test(String(el.getAttribute('ng-model-options') || el.getAttribute('data-ng-model-options') || ''))) {
          fireEvent(el, 'blur', false);
          fireEvent(el, 'focusout', true);
        }
        // The page may have refused the value (a controlled input that put its own back).
        return squash(el.value) === squash(next) ? { ok: true, method: 'dom' } : { ok: false, reason: 'set-failed' };
      }
      var existing = el.innerText != null ? el.innerText : el.textContent;
      if ((append === true ? appendBelow(existing, text) : text).length > MAX_FIELD_CHARS) return { ok: false, reason: 'too-long' };
      return writeEditable(el, text, append === true) ? { ok: true, method: 'dom' } : { ok: false, reason: 'set-failed' };
    } catch (e) {
      return { ok: false, reason: 'set-failed' };
    }
  }

  var actions = {
    // The token ServiceNow wants on same-origin REST calls (X-UserToken). Content scripts cannot read it directly.
    getCsrfToken: function () {
      if (typeof window.g_ck === 'string' && window.g_ck) return window.g_ck;
      var w = resolveFormWindow();
      if (w && typeof w.g_ck === 'string') return w.g_ck;
      try {
        if (window.NOW && typeof window.NOW.g_ck === 'string' && window.NOW.g_ck) return window.NOW.g_ck;
      } catch (e) {
        /* not readable */
      }
      // A portal sends the token with every request it makes: it is among Angular's default headers.
      try {
        var http = angularService('$http');
        var header = http && http.defaults && http.defaults.headers && http.defaults.headers.common && http.defaults.headers.common['X-UserToken'];
        if (typeof header === 'string' && header) return header;
      } catch (e) {
        /* not readable */
      }
      return null;
    },

    // Who is signed in: names and roles (to hide features the person cannot use). No admin probing.
    // Classic and Workspace pages have g_user; portal pages may only have NOW / the Angular root scope (see above).
    getSessionInfo: function () {
      var w = resolveFormWindow() || window;
      var u = w.g_user || window.g_user;
      var info = u
        ? {
            userName: u.userName || null,
            userId: u.userID || null,
            firstName: u.firstName || null,
            lastName: u.lastName || null,
            displayName: null,
            roles: rolesOf(u),
          }
        : null;
      if (!info || !info.userId) info = mergeUsers(info, portalSessionInfo());
      return info;
    },

    // Which record the classic form shows (null on Workspace pages: the panel then reads the table and sys_id from the URL).
    getFormMeta: function () {
      var w = resolveFormWindow();
      if (!w) return null;
      var f = w.g_form;
      var number = null;
      try {
        number = f.getValue('number') || null;
      } catch (e) {
        /* no number field */
      }
      return {
        table: typeof f.getTableName === 'function' ? f.getTableName() : null,
        sysId: typeof f.getUniqueValue === 'function' ? f.getUniqueValue() : null,
        isNewRecord: typeof f.isNewRecord === 'function' ? !!f.isNewRecord() : null,
        number: number,
      };
    },

    // Current (possibly unsaved) values of the NAMED fields only. Used so a draft can see what the agent typed already.
    getFormValues: function (names) {
      var w = resolveFormWindow();
      if (!w || !Array.isArray(names)) return null;
      var f = w.g_form;
      var values = {};
      for (var i = 0; i < names.length && i < 40; i++) {
        var name = names[i];
        if (typeof name !== 'string' || !FIELD_RE.test(name) || SECRET_NAME_RE.test(name)) continue;
        try {
          var type = fieldType(f, name);
          if (/password/i.test(type)) continue;
          var v = f.getValue(name);
          if (v !== undefined && v !== null) values[name] = String(v).slice(0, MAX_FIELD_CHARS);
        } catch (e) {
          /* unreadable field */
        }
      }
      return values;
    },

    // THE ONLY WRITE: put a value into one existing field on the open form. Nothing is saved.
    // With append === true the text goes BELOW whatever the field already holds, so what the agent typed is never lost.
    // Returns { ok, method: 'gform' | 'dom', reason }.
    fillField: function (name, value, label, append) {
      if (typeof name !== 'string' || !FIELD_RE.test(name) || SECRET_NAME_RE.test(name)) return { ok: false, reason: 'bad-field' };
      var text = String(value == null ? '' : value);
      if (text.length > MAX_FIELD_CHARS) return { ok: false, reason: 'too-long' };

      var w = resolveFormWindow();
      if (w) {
        var f = w.g_form;
        var exists = false;
        try {
          exists = typeof f.hasField === 'function' ? !!f.hasField(name) : f.getValue(name) !== undefined;
        } catch (e) {
          exists = false;
        }
        if (!exists) return { ok: false, reason: 'no-such-field' };
        try {
          if (typeof f.isReadOnly === 'function' && typeof f.getEditableFields === 'function') {
            var editable = f.getEditableFields();
            // getEditableFields() is trustworthy; isReadOnly() answers true for everything on current releases.
            if (editable && editable.length && editable.indexOf(name) === -1) return { ok: false, reason: 'read-only' };
          }
          if (append === true) text = appendBelow(f.getValue(name), text);
          if (text.length > MAX_FIELD_CHARS) return { ok: false, reason: 'too-long' };
          f.setValue(name, text);
          return { ok: true, method: 'gform' };
        } catch (e) {
          return { ok: false, reason: 'set-failed' };
        }
      }

      // No g_form: a portal page (an Angular page of boxes found by their names) or a Workspace (components found by aria-label).
      if (onPortalPage()) return fillPortalField(name, text, String(label || '').slice(0, 100), append);

      var el = findControlInDom(name, label);
      if (!el) return { ok: false, reason: 'no-form' };
      if (el.disabled || el.readOnly) return { ok: false, reason: 'read-only' };
      try {
        if (append === true) text = appendBelow(el.value, text);
        if (text.length > MAX_FIELD_CHARS) return { ok: false, reason: 'too-long' };
        setNativeValue(el, text);
        return { ok: true, method: 'dom' };
      } catch (e) {
        return { ok: false, reason: 'set-failed' };
      }
    },
  };

  document.addEventListener(REQUEST_EVENT, function (event) {
    var detail = event && event.detail;
    if (!detail || typeof detail !== 'object' || typeof detail.id !== 'string' || typeof detail.action !== 'string') return;
    var respond = function (payload) {
      document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: Object.assign({ id: detail.id }, payload) }));
    };
    // Only the actions above are reachable: own-property check, not a prototype lookup.
    if (!Object.prototype.hasOwnProperty.call(actions, detail.action)) {
      respond({ ok: false, error: 'Unknown action.' });
      return;
    }
    try {
      respond({ ok: true, result: actions[detail.action].apply(null, Array.isArray(detail.args) ? detail.args : []) });
    } catch (err) {
      respond({ ok: false, error: String((err && err.message) || err) });
    }
  });
})();

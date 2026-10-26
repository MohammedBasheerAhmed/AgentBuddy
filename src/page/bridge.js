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
      if (Array.isArray(u.roles)) return u.roles.slice(0, 200).map(String);
      if (typeof u.roles === 'string' && u.roles) return u.roles.split(',').map(function (r) { return r.trim(); }).filter(Boolean).slice(0, 200);
    } catch (e) {
      /* not available */
    }
    return null;
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
      var aria = (el.getAttribute('aria-label') || '').toLowerCase();
      return Boolean(wanted) && aria === wanted;
    }, [], 0);
    return found[0] || null;
  }

  function setNativeValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  var actions = {
    // The token ServiceNow wants on same-origin REST calls (X-UserToken). Content scripts cannot read it directly.
    getCsrfToken: function () {
      if (typeof window.g_ck === 'string' && window.g_ck) return window.g_ck;
      var w = resolveFormWindow();
      if (w && typeof w.g_ck === 'string') return w.g_ck;
      return null;
    },

    // Who is signed in: names and roles (to hide features the person cannot use). No admin probing.
    getSessionInfo: function () {
      var w = resolveFormWindow() || window;
      var u = w.g_user || window.g_user;
      if (!u) return null;
      return {
        userName: u.userName || null,
        userId: u.userID || null,
        firstName: u.firstName || null,
        lastName: u.lastName || null,
        roles: rolesOf(u),
      };
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
    // Returns { ok, method: 'gform' | 'dom', reason }.
    fillField: function (name, value, label) {
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
          f.setValue(name, text);
          return { ok: true, method: 'gform' };
        } catch (e) {
          return { ok: false, reason: 'set-failed' };
        }
      }

      var el = findControlInDom(name, label);
      if (!el) return { ok: false, reason: 'no-form' };
      if (el.disabled || el.readOnly) return { ok: false, reason: 'read-only' };
      try {
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

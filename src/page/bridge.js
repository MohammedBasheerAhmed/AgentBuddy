// PAGE-WORLD script (registered as a MAIN-world content script on instances the person enabled). It runs in the
// ServiceNow page's own JavaScript context so it can read page globals such as g_form, g_user and g_ck.
//
// Communication contract (both directions use CustomEvent on `document`):
//   content -> page : 'ab-page-request'  detail { id, action, args }
//   page -> content : 'ab-page-response' detail { id, ok, result, error }
//
// SECURITY: this bridge is deliberately tiny.
//  - It READS: the session token (needed for same-origin REST reads), who the user is, which record the form shows (and when
//    the form was loaded, so a Save is noticed),
//    the values of fields the caller names, whether named fields are on the form and editable (getFieldStates), and on a
//    Workspace page (no g_form) the text in the boxes of named fields (getBoxValues: found the way an insert finds them,
//    read without focusing, typing or firing anything).
//  - It exposes exactly ONE write: fillField(), which sets one existing field's value on the open form, the same as typing
//    into it. It never saves the form (there is no save action here), never calls REST, never evaluates caller-supplied code.
//    The agent presses the form's own Save, so ACLs, business rules, client scripts and the audit trail all apply.
//    Its Undo, restoreField() (round 4), only takes that same write back: it puts one field's earlier value back, and only while
//    the field still holds exactly what fillField left there (anything the person typed since is never overwritten).
//    A choice list (the close code) is set through g_form only, by its stored value, and only when it is one of the form's
//    choices; on a page without g_form it is refused ('choice-by-hand'), never typed or clicked.
//  - On a portal page (Service Portal, Employee Center, customer service portal: no g_form, an Angular page) fillField finds the
//    comment or work-notes box in the page and types into it like a person would. It refuses when it cannot tell which box is
//    meant, and it never presses a button of the page: the person reads the text and presses the portal's own Send.
//  - On a Workspace page (audit of 2026-11-07, part 9) the box is found with a TIME budget (findControls), a box that cannot be found
//    is reported as such BEFORE the person clicks Insert (getFieldStates: gaps), and a composer that serves both Work notes and
//    customer comments is read (composer mode: never clicked or switched): an insert goes in only when the mode is the kind of text,
//    or when it cannot be read and the answer says so (modeUnread). watchInsert only LOOKS at the box the last insert wrote to.
//  - A page script can see these events and could answer them. The content script therefore treats every answer as data to
//    check, never as authority. Do not add an "eval" style action.
//
// One bridge per page, the newest. After an extension update the bridge already on an open page keeps running (a page world
// script cannot be unloaded), and the service worker injects the new one (service-worker.js injectIntoOpenTabs). A bridge of a
// HIGHER version takes over: it removes the older one's listener (window.__abBridge.stop) and answers from then on. The same or a
// lower version does nothing. The window keeps only { version, stop }, never the actions. A page script can write that property
// too; the most it can do with it is keep a bridge from starting, which it could already do by answering the requests itself.

(function () {
  // Raise this with every change to this file, or an open page keeps the bridge it had (and answers "Unknown action." to an action
  // added since). tests/page-bridge-version.test.js pins the number to the file's contents.
  var BRIDGE_VERSION = 8;

  // The first bridge kept only a flag, no handle: it counts as version 1, and its listener cannot be removed (see onRequest).
  var installed;
  var installedVersion;
  try {
    installed = window.__abBridge;
    installedVersion = installed && typeof installed.version === 'number' ? installed.version : window.__abBridgeInstalled ? 1 : 0;
  } catch (e) {
    installed = null;
    installedVersion = 0;
  }
  if (installedVersion >= BRIDGE_VERSION) return;
  try {
    if (installed && typeof installed.stop === 'function') installed.stop();
  } catch (e) {
    /* the older bridge is gone already */
  }

  var REQUEST_EVENT = 'ab-page-request';
  var RESPONSE_EVENT = 'ab-page-response';
  var MAX_FIELD_CHARS = 20000;

  // Forms live in the top window (Next Experience) or inside the classic `gsft_main` iframe. Resolve whichever has g_form.
  // The top window and gsft_main come first and are trusted as they are. Any OTHER child frame is the form only when it plainly is the
  // one the person is looking at: on screen and form-sized, or holding the very record the address names. A hidden or small frame
  // (a widget, a preview, a tracking frame) that carries a g_form of its own must not turn a home page into a "record" (audit of
  // 2026-11-07, S7; the home page of one instance showed a table name).
  var FORM_FRAME_MIN_WIDTH = 300;
  var FORM_FRAME_MIN_HEIGHT = 200;

  function frameIsOnScreen(child) {
    try {
      var element = child.frameElement; // a same-origin frame can reach its own element; a cross-origin one throws or answers null
      if (!element || typeof element.getBoundingClientRect !== 'function') return false;
      var box = element.getBoundingClientRect();
      if (!box || !(box.width >= FORM_FRAME_MIN_WIDTH) || !(box.height >= FORM_FRAME_MIN_HEIGHT)) return false;
      var style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(element) : null;
      return !(style && (style.display === 'none' || style.visibility === 'hidden'));
    } catch (e) {
      return false;
    }
  }

  function frameHoldsAddressedRecord(child) {
    try {
      var id = String(child.g_form.getUniqueValue() || '').toLowerCase();
      var address = String(window.location.href || '').toLowerCase();
      return isSysId(id) && address.indexOf(id) !== -1;
    } catch (e) {
      return false;
    }
  }

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
          if (child && child.g_form && typeof child.g_form.getValue === 'function' && (frameIsOnScreen(child) || frameHoldsAddressedRecord(child))) return child;
        } catch (e) {
          /* cross-origin child */
        }
      }
    } catch (e) {
      /* no frames */
    }
    return null;
  }

  // ---- The signed-in person's roles: a list, an empty list, or "not known" ----------------------------------------------
  // The answer has three shapes and the panel must keep them apart: a LIST of names (the page said), an EMPTY list (the page was asked
  // and the person holds none of them) and null (the page could not say: no g_user, or none of the ways below exists). Null is never
  // "no roles" (build-rules.md: roles may only change what is SHOWN, so a guess in either direction must stay a guess).
  // Roles are read from the page only, never over REST (the roles table is not readable by a fulfiller, rule 9). Three ways, in this order:
  //   1. g_user.roles, as an array or a comma list (what the bridge always read; not documented)
  //   2. g_user.getRoles() (the Next Experience client API, every role the person holds including inherited ones)
  //   3. g_user.hasRoleExactly(name) for a FIXED list of names below. Exactly, because hasRole is true for every name when the person
  //      is an admin. Only these names are ever asked; a name outside the list is never built from page data.
  // (the HR family is written in two pieces: a role name with a dot in it is not a dot-walked column, and the scan of src/ for those
  // reads only whole dotted strings: tests/policy-hardening-dotwalk.test.js)
  var HR_CORE = 'sn_hr_core';
  var ROLE_PROBE = [
    'itil', 'itil_admin', 'sn_incident_write', 'sn_request_write', 'catalog_admin', 'catalog_manager', 'catalog_task_editor',
    'sn_customerservice_agent', 'sn_customerservice_manager', 'sn_customerservice_admin', 'csm_ws_agent',
    HR_CORE + '.case_writer', HR_CORE + '.manager', HR_CORE + '.admin', 'approver_user',
    'knowledge', 'knowledge_manager', 'knowledge_admin',
    'problem_coordinator', 'problem_manager', 'change_manager', 'major_incident_manager', 'admin',
  ];

  function cleanRoleList(value) {
    if (Array.isArray(value)) return value.slice(0, 200).map(function (r) { return String(r).slice(0, 80); }).filter(Boolean);
    if (typeof value === 'string' && value) return value.split(',').map(function (r) { return r.trim().slice(0, 80); }).filter(Boolean).slice(0, 200);
    return null;
  }

  function rolesOf(u) {
    try {
      return cleanRoleList(u.roles);
    } catch (e) {
      /* not available */
    }
    return null;
  }

  // The fixed list asked one name at a time. null when the page has no hasRoleExactly (or answered none of them).
  function probeRoles(u) {
    if (typeof u.hasRoleExactly !== 'function') return null;
    var found = [];
    var answered = false;
    for (var i = 0; i < ROLE_PROBE.length; i++) {
      try {
        var yes = u.hasRoleExactly(ROLE_PROBE[i]);
        answered = true;
        if (yes === true) found.push(ROLE_PROBE[i]);
      } catch (e) {
        /* this name could not be asked */
      }
    }
    return answered ? found : null;
  }

  function rolesFromUser(u) {
    if (!u || typeof u !== 'object') return null;
    var list = rolesOf(u);
    // An empty list from an undocumented property is weak: a shim can carry one. Ask the other ways before believing it.
    if (list && list.length) return list;
    try {
      if (typeof u.getRoles === 'function') {
        var got = cleanRoleList(u.getRoles());
        if (got && got.length) return got;
      }
    } catch (e) {
      /* the call is not available here */
    }
    var probed = probeRoles(u);
    if (probed !== null) return probed;
    return list; // [] when the page really said an empty list, else null
  }

  // ---- g_user in a frame ---------------------------------------------------------------------------------------------------
  // Measured on dev364920 (2026-11-07, docs/live-checks-2026-11-07.md): the classic home page is a UI page shown in an inner frame
  // (/ui_page.do): the TOP window has no g_user, the inner frame has one (with getRoles). On Next Experience record pages and on
  // Workspaces the top window never has one. So when the page has no form window to ask, the same-origin child frames are looked at,
  // breadth first and only a few levels deep, and the first g_user found is used. window.frames already lists the frames inside shadow
  // roots (the named ones too), so nothing walks a shadow root. A cross-origin frame throws when asked: it is skipped. Nothing is guessed:
  // no g_user in any frame leaves the roles unknown (null).
  var USER_FRAME_DEPTH = 3;
  var USER_FRAME_LIMIT = 20;

  // The child frames of a window (at most USER_FRAME_LIMIT), or [] when it will not say (a cross-origin frame throws).
  function childFrames(win) {
    var list = [];
    try {
      var count = Math.min(Number(win.frames.length) || 0, USER_FRAME_LIMIT);
      for (var i = 0; i < count; i++) {
        var child = win.frames[i];
        if (child) list.push(child);
      }
    } catch (e) {
      /* a cross-origin frame does not list its frames */
    }
    return list;
  }

  function userOfFrame(child) {
    try {
      var u = child && child.g_user;
      return u && typeof u === 'object' ? u : null;
    } catch (e) {
      return null; /* cross-origin child: its g_user cannot be read */
    }
  }

  function userFromFrames() {
    // The classic frame by name first: on Next Experience it sits inside a shadow root, where the named frames of the window still reach it.
    try {
      var main = userOfFrame(window.frames['gsft_main']);
      if (main) return main;
    } catch (e) {
      /* no such frame, or another origin */
    }
    var level = [window];
    for (var depth = 0; depth < USER_FRAME_DEPTH && level.length; depth++) {
      var next = [];
      for (var p = 0; p < level.length; p++) {
        var children = childFrames(level[p]);
        for (var i = 0; i < children.length; i++) {
          var u = userOfFrame(children[i]);
          if (u) return u;
          next.push(children[i]);
        }
      }
      level = next;
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
      var value;
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
      roles: rootLevel ? null : rolesFromUser(obj),
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

  // `text` below what a field holds already (nothing is added above or in place of it).
  function appendBelow(existing, text) {
    var current = existing == null ? '' : String(existing);
    return current.trim() ? current.replace(/\s+$/, '') + '\n\n' + text : text;
  }

  // Append, unless the field still holds `previous` (the text Agent Buddy put there earlier, sent back by the panel): then that one
  // copy is swapped for the new text and everything else the person typed stays where it was. So "Try again" and Insert again do
  // not leave two answers in one box. Only an exact match counts; a text the person has edited is left alone and the new one goes
  // below it.
  function appendOrSwap(existing, text, previous) {
    var current = existing == null ? '' : String(existing);
    var earlier = typeof previous === 'string' ? previous : '';
    var at = earlier ? current.lastIndexOf(earlier) : -1;
    // A whole block only: from the start of a line to the end of a line. "Brief two, and I checked" is the person's own text now.
    var end = at + earlier.length;
    var whole = at !== -1 && (at === 0 || current.charAt(at - 1) === '\n') && (end === current.length || /^[ \t]*(\n|$)/.test(current.slice(end)));
    if (whole) return current.slice(0, at) + text + current.slice(end);
    return appendBelow(current, text);
  }

  // ---- Workspaces, where g_form is not a page global --------------------------------------------------------------
  // The control of a field is found by what it is called, with the same care as on a portal page (see below): only visible,
  // enabled text controls; only an exact name or label ("Description" is not "Short description"); two equally good controls
  // mean no write; and the value is read back after it was set. Best effort: Workspace components keep their own state, so a
  // successful DOM write is reported as method 'dom' (with the label of the box that was used) and the panel still offers Copy.

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
      // (the same first segments src/context/surface.js never takes for a portal: audit 2026-11-07, S19)
      if (/\.do$/i.test(path) || /^\/(now|api|angular|images|scripts|styles|assets)(\/|$)/i.test(path)) return false;
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

  // Every open shadow root and every same-origin frame we can reach, searched with a TIME budget, not a count of elements (audit of
  // 2026-11-07, S5: a big Workspace page holds more elements than the 25,000 the first search stopped at, and its composer is late
  // in the document). The focused editor comes first, then what is on screen, then the rest; a search that ran out of time says so
  // (complete: false), so "there is no such box" is never confused with "could not look everywhere". A frame we cannot read (another
  // origin) is simply skipped. Nothing is clicked, focused or changed.
  var SEARCH_BUDGET_MS = 900;
  var SEARCH_MAX_NODES = 2000000; // only a guard against a runaway page: the clock is what ends a search
  var SEARCH_MAX_DEPTH = 40;

  // The editor the person is typing in right now, also when it sits inside shadow roots of the page.
  function focusedEditor() {
    try {
      var el = document.activeElement;
      for (var i = 0; el && i < SEARCH_MAX_DEPTH; i++) {
        var inner = el.shadowRoot ? el.shadowRoot.activeElement : null;
        if (!inner) break;
        el = inner;
      }
      return el && el.ownerDocument === document && isTextControl(el) ? el : null;
    } catch (e) {
      return null;
    }
  }

  // -> { controls: [{ el, frame }], complete: boolean }
  function findControls(budgetMs) {
    var found = { controls: [], complete: true, nodes: 0 };
    var out = found.controls;
    var deadline = Date.now() + (budgetMs > 0 ? budgetMs : SEARCH_BUDGET_MS);
    var focused = focusedEditor();
    if (focused) out.push({ el: focused, frame: null });
    var hot = [{ root: document, depth: 0, frame: null }]; // parts that are on screen
    var cold = []; // parts that are not (a hidden tab, a collapsed panel): looked at last
    var h = 0;
    var c = 0;
    while (found.complete && (h < hot.length || c < cold.length)) {
      var item = h < hot.length ? hot[h++] : cold[c++];
      var nodes;
      try {
        nodes = item.root.querySelectorAll('*');
      } catch (e) {
        continue;
      }
      for (var i = 0; i < nodes.length; i++) {
        if ((i & 255) === 0 && Date.now() > deadline) {
          found.complete = false;
          break;
        }
        found.nodes++;
        if (found.nodes > SEARCH_MAX_NODES) {
          found.complete = false;
          break;
        }
        var el = nodes[i];
        var tag = el.tagName;
        if (el.shadowRoot && item.depth < SEARCH_MAX_DEPTH) (isVisible(el) ? hot : cold).push({ root: el.shadowRoot, depth: item.depth + 1, frame: item.frame });
        if (tag === 'IFRAME' || tag === 'FRAME') {
          var doc;
          try {
            doc = el.contentDocument;
          } catch (e) {
            doc = null;
          }
          if (doc && item.depth < SEARCH_MAX_DEPTH) {
            (isVisible(el) ? hot : cold).push({ root: doc, depth: item.depth + 1, frame: el });
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
        if (isTextControl(el)) out.push({ el: el, frame: item.frame });
      }
    }
    return found;
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

  // The box a field goes into, or why there is none: { c } | { reason, gap }. `found` is a search already made (findControls), so one request
  // looks through the page once however many fields it asks about. reason 'no-form' (nothing, or two look-alikes), 'read-only', or
  // 'unreachable' (the search ran out of time before it found anything); `gap` says which of the three it was for the panel:
  // 'absent' | 'ambiguous' | 'too-big'.
  function chooseControl(name, label, found) {
    var search = found || findControls();
    var controls = search.controls;
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
      (isReadOnlyControl(c.el) ? locked : editable).push({ c: c, el: c.el, score: score });
    });
    editable.sort(function (a, b) { return b.score - a.score; });
    if (editable.length) {
      // Several boxes that look the same: do not guess which one the person means.
      if (editable.length > 1 && editable[0].score - editable[1].score < 15) return { reason: 'no-form', gap: 'ambiguous' };
      return { c: editable[0].c };
    }
    if (locked.length) return { reason: 'read-only' };
    return search.complete ? { reason: 'no-form', gap: 'absent' } : { reason: 'unreachable', gap: 'too-big' };
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
    var done;
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

  // ---- What a classic form says about a field: can it be typed into, and did the write take? --------------------------
  // getEditableFields() is undocumented and answers [] on forms we have not seen (audit of 2026-11-07, W-01), so an empty list proves
  // nothing: it is neither "everything is editable" nor "everything is locked". The list decides only when it names fields. Otherwise
  // the form's own state decides when it clearly says closed, and else nobody knows ('unknown'): the write is then tried and READ BACK.
  // No write is ever used to find out whether a field is writable before the person asked for one.

  function editableList(f) {
    try {
      var list = typeof f.getEditableFields === 'function' ? f.getEditableFields() : null;
      return Array.isArray(list) ? list : null;
    } catch (e) {
      return null;
    }
  }

  // A closed or cancelled task: its Active box says false and the form has a State box (so a knowledge article, which also has Active,
  // never counts). A form that cannot be read this way is simply not "closed".
  function formIsClosed(f) {
    try {
      if (typeof f.hasField !== 'function' || !f.hasField('active') || !f.hasField('state')) return false;
      return String(f.getValue('active')).toLowerCase() === 'false';
    } catch (e) {
      return false;
    }
  }

  // 'editable' | 'read-only' | 'unknown' for one field that is on the form.
  function editabilityOf(list, closed, name) {
    if (list && list.length) return list.indexOf(name) === -1 ? 'read-only' : 'editable';
    return closed ? 'read-only' : 'unknown';
  }

  // The field's value as a string, or null when the form cannot say.
  function valueOf(f, name) {
    try {
      var v = f.getValue(name);
      return v == null ? '' : String(v);
    } catch (e) {
      return null;
    }
  }

  // After a write: does the field hold what was put there? 'ok' | 'locked' (it still holds what it held, so the form ignored the
  // write: a locked field often does that without a word) | 'other' (something else) | 'unread' (the form cannot say).
  function heldAfter(before, after, wanted) {
    if (after === null) return 'unread';
    var now = squash(after);
    if (now === squash(wanted)) return 'ok';
    if (now === squash(before)) return 'locked';
    return 'other';
  }

  // What the box is called, for the panel to show ("Inserted into the box labelled ..."): its label, as plain short text.
  function controlLabel(c) {
    var el = c.el;
    var candidates = [];
    try {
      candidates.push(el.getAttribute('aria-label'));
    } catch (e) {
      /* no attribute */
    }
    candidates.push(textOfIds(el, el.getAttribute && el.getAttribute('aria-labelledby')));
    labelTexts(el).forEach(function (t) { candidates.push(t); });
    if (c.frame) {
      ['title', 'aria-label'].forEach(function (n) { candidates.push(c.frame.getAttribute(n)); });
      labelTexts(c.frame).forEach(function (t) { candidates.push(t); });
    }
    ['placeholder', 'title', 'name'].forEach(function (n) {
      try {
        candidates.push(el.getAttribute(n));
      } catch (e) {
        /* no attribute */
      }
    });
    for (var i = 0; i < candidates.length; i++) {
      var t = squash(candidates[i]);
      if (t) return t.slice(0, 80);
    }
    return '';
  }

  // The text a box holds now: a text box's value, an editable area's text.
  function boxValue(el) {
    var value = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : el.innerText != null ? el.innerText : el.textContent;
    return value == null ? '' : String(value);
  }

  // For Undo (round 4): what the field held before the write and holds after it, added to a successful answer when both fit.
  function withUndo(out, before, after) {
    var b = before == null ? '' : String(before);
    var a = after == null ? '' : String(after);
    if (b.length <= MAX_FIELD_CHARS && a.length <= MAX_FIELD_CHARS) {
      out.previous = b;
      out.after = a;
    }
    return out;
  }

  // ---- A Workspace composer that serves both Work notes and customer comments --------------------------------------
  // Audit of 2026-11-07, W-12 and S14: one composer box can hold either kind, so a work note could be typed into a customer-visible
  // post. The bridge reads the composer's mode and never changes it (nothing is clicked): the switch next to the box is the selected
  // tab, radio button, option or pressed button (aria-selected, aria-checked, aria-pressed, aria-current, a chosen <option>), found by
  // climbing from the box through its ancestors (across shadow roots and frames) and looking at the nearest group that has one, and
  // named by its own words in English and Arabic. A group that also lists a filter of the activity stream (All, Attachments...) is
  // not the composer's switch. Two selected choices of different kinds, or none that can be named, mean "cannot tell". Only the
  // wording is read; a mode that cannot be read is never assumed.
  var MODE_INTERNAL = [
    'work note', 'work notes', 'worknotes', 'internal', 'internal note', 'internal notes', 'private', 'private note', 'private notes',
    '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0639\u0645\u0644', '\u0645\u0644\u0627\u062d\u0638\u0629 \u0627\u0644\u0639\u0645\u0644', '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0639\u0645\u0644', '\u0645\u0644\u0627\u062d\u0638\u0629 \u0639\u0645\u0644',
    '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u062f\u0627\u062e\u0644\u064a\u0629', '\u0645\u0644\u0627\u062d\u0638\u0629 \u062f\u0627\u062e\u0644\u064a\u0629', '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u062e\u0627\u0635\u0629',
    '\u062f\u0627\u062e\u0644\u064a', '\u062f\u0627\u062e\u0644\u064a\u0629', '\u062e\u0627\u0635', '\u062e\u0627\u0635\u0629',
  ];
  var MODE_CUSTOMER = [
    'customer', 'customers', 'additional comment', 'additional comments', 'comment', 'comments', 'public', 'reply', 'requester', 'caller',
    '\u062a\u0639\u0644\u064a\u0642\u0627\u062a \u0625\u0636\u0627\u0641\u064a\u0629', '\u062a\u0639\u0644\u064a\u0642 \u0625\u0636\u0627\u0641\u064a', '\u062a\u0639\u0644\u064a\u0642\u0627\u062a \u0627\u0644\u0639\u0645\u064a\u0644', '\u062a\u0639\u0644\u064a\u0642 \u0627\u0644\u0639\u0645\u064a\u0644',
    '\u062a\u0639\u0644\u064a\u0642\u0627\u062a', '\u062a\u0639\u0644\u064a\u0642', '\u0627\u0644\u062a\u0639\u0644\u064a\u0642\u0627\u062a', '\u0627\u0644\u062a\u0639\u0644\u064a\u0642', '\u0627\u0644\u0639\u0645\u064a\u0644', '\u0639\u0645\u064a\u0644', '\u0644\u0644\u0639\u0645\u064a\u0644',
    '\u0627\u0644\u0631\u062f', '\u0631\u062f', '\u0627\u0644\u0645\u062a\u0635\u0644', '\u0639\u0627\u0645', '\u0639\u0627\u0645\u0629',
  ];
  // The filters of the activity stream (not the composer's switch): a group that has one of these is left alone.
  var MODE_FILTER = ['all', 'attachments', 'history', 'activity', 'email', 'emails', 'approvals', '\u0627\u0644\u0643\u0644', '\u0627\u0644\u0645\u0631\u0641\u0642\u0627\u062a', '\u0627\u0644\u0633\u062c\u0644', '\u0627\u0644\u0646\u0634\u0627\u0637', '\u0627\u0644\u0628\u0631\u064a\u062f', '\u0627\u0644\u0645\u0648\u0627\u0641\u0642\u0627\u062a'];
  var JOURNAL_KIND = { work_notes: 'internal', comments: 'customer' };
  var MODE_MAX_NODES = 4000;
  var MODE_BUDGET_MS = 250;

  // Lower case words, Arabic marks and stretching taken out, the forms of alef and of final yeh made one: so a phrase is found as whole words.
  function modeWords(text) {
    var t = String(text == null ? '' : text).slice(0, 300).toLowerCase();
    t = t.replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[\u0622\u0623\u0625]/g, '\u0627').replace(/\u0649/g, '\u064a');
    t = t.replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim();
    return t ? ' ' + t + ' ' : '';
  }

  function hasAnyPhrase(words, list) {
    for (var i = 0; i < list.length; i++) if (hasPhrase(words, modeWords(list[i]).trim())) return true;
    return false;
  }

  // 'internal' | 'customer' | null (neither, or both: "Work notes and comments" names no single kind)
  function classifyMode(text) {
    var words = modeWords(text);
    if (!words) return null;
    var internal = hasAnyPhrase(words, MODE_INTERNAL);
    var customer = hasAnyPhrase(words, MODE_CUSTOMER);
    if (internal === customer) return null;
    return internal ? 'internal' : 'customer';
  }

  function attrOf(el, name) {
    try {
      return el.getAttribute(name);
    } catch (e) {
      return null;
    }
  }

  var GROUP_ROLES = ['tablist', 'radiogroup', 'listbox', 'menu', 'group', 'toolbar'];

  // The words of a choice that is selected right now (a tab, a radio, an option, a pressed button), or null when this is not one.
  function selectedChoiceText(el) {
    var tag = el.tagName;
    var chosen;
    if (tag === 'OPTION') chosen = Boolean(el.selected);
    else if (tag === 'INPUT') chosen = String(el.type || attrOf(el, 'type') || '').toLowerCase() === 'radio' && Boolean(el.checked);
    else {
      var role = String(attrOf(el, 'role') || '').toLowerCase();
      if (tag !== 'BUTTON' && ['tab', 'radio', 'option', 'menuitemradio', 'menuitemcheckbox', 'switch', 'checkbox', 'button'].indexOf(role) === -1) return null;
      chosen = attrOf(el, 'aria-selected') === 'true' || attrOf(el, 'aria-checked') === 'true' || attrOf(el, 'aria-pressed') === 'true' || attrOf(el, 'aria-current') === 'true';
    }
    if (!chosen) return null;
    var text = attrOf(el, 'aria-label') || '';
    if (!squash(text)) labelTexts(el).forEach(function (t) { text = text || t; });
    if (!squash(text)) text = String(el.textContent || '').slice(0, 120);
    return squash(text) ? text : null;
  }

  // The words of the group a choice belongs to (its tab list, radio group, select...), to tell the composer's switch from a filter.
  function groupWords(el) {
    var node = el.parentNode;
    for (var i = 0; node && node.nodeType === 1 && i < 3; i++) {
      if (GROUP_ROLES.indexOf(String(attrOf(node, 'role') || '').toLowerCase()) !== -1 || node.tagName === 'SELECT') break;
      node = node.parentNode;
    }
    if (!node || node.nodeType !== 1) node = el.parentNode;
    try {
      return modeWords(node && node.textContent);
    } catch (e) {
      return '';
    }
  }

  // The next container up: the parent, a shadow root and then its host, the frame element of a frame's document. null at the top.
  function parentOf(node) {
    if (node.nodeType === 11) return node.host || null;
    var next = node.parentNode;
    if (next && next.nodeType === 9) {
      try {
        return next.defaultView && next.defaultView.frameElement ? next.defaultView.frameElement : null;
      } catch (e) {
        return null;
      }
    }
    return next || null;
  }

  // 'internal' | 'customer' | null (cannot tell) for the composer the box `c` is in.
  function readComposerMode(c) {
    var state = { checked: 0, deadline: Date.now() + MODE_BUDGET_MS, seen: new Set(), stop: false };
    var node = c.el;
    for (var level = 0; level < 12 && node && !state.stop; level++) {
      node = parentOf(node);
      if (!node || node === document.body || node === document.documentElement || node.nodeType === 9) return null;
      var kinds = [];
      var stack = [node];
      while (stack.length && !state.stop) {
        var root = stack.pop();
        var nodes;
        try {
          nodes = root.querySelectorAll('*');
        } catch (e) {
          continue;
        }
        for (var i = 0; i < nodes.length; i++) {
          if (state.checked++ > MODE_MAX_NODES || Date.now() > state.deadline) {
            state.stop = true;
            break;
          }
          var el = nodes[i];
          if (state.seen.has(el)) continue;
          state.seen.add(el);
          if (el.shadowRoot) stack.push(el.shadowRoot);
          var text = selectedChoiceText(el);
          if (text === null) continue;
          var kind = classifyMode(text);
          if (kind && !hasAnyPhrase(groupWords(el), MODE_FILTER)) kinds.push(kind);
        }
      }
      if (kinds.length) return kinds.every(function (k) { return k === kinds[0]; }) ? kinds[0] : null;
    }
    return null;
  }

  // What the composer says about a field: 'match' (set to the kind of this field) | 'other' (set to the other kind) | 'unread'.
  function modeOfBox(name, c) {
    var seen = readComposerMode(c);
    return seen === null ? 'unread' : seen === JOURNAL_KIND[name] ? 'match' : 'other';
  }

  // The box the last insert wrote to, so a later look can tell that it was emptied or replaced (a Post, a Send, a Save that re-draws
  // the form): the language-independent sign that an Undo has nothing left to put back. Only the element and a count are kept, no text.
  var lastInsert = null;
  var insertCount = 0;

  // Put the text into the chosen box the way typing would, then read it back: a box that put its own value back is a failure,
  // never a success. With `wantUndo` the answer also says what the box held before and holds now.
  function writeInto(c, text, append, previous, wantUndo) {
    var el = c.el;
    var label = controlLabel(c);
    var before = wantUndo ? boxValue(el) : '';
    function done() {
      var out = label ? { ok: true, method: 'dom', label: label } : { ok: true, method: 'dom' };
      lastInsert = { el: el, n: (insertCount += 1) }; // (watchInsert: has this box been emptied since?)
      return wantUndo ? withUndo(out, before, boxValue(el)) : out;
    }
    try {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        var next = append === true ? appendOrSwap(el.value, text, previous) : text;
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
        return squash(el.value) === squash(next) ? done() : { ok: false, reason: 'set-failed' };
      }
      var existing = el.innerText != null ? el.innerText : el.textContent;
      if ((append === true ? appendBelow(existing, text) : text).length > MAX_FIELD_CHARS) return { ok: false, reason: 'too-long' };
      return writeEditable(el, text, append === true) ? done() : { ok: false, reason: 'set-failed' };
    } catch (e) {
      return { ok: false, reason: 'set-failed' };
    }
  }

  function fillPortalField(name, text, label, append, previous, wantUndo) {
    var chosen = chooseControl(name, label);
    if (!chosen.c) return { ok: false, reason: chosen.reason };
    return writeInto(chosen.c, text, append, previous, wantUndo);
  }

  // Undo on a page without g_form: the box an insert would choose, put back to `previous` only while it still holds what the
  // insert left (`expected`; compared without regard to runs of white space, which an editor may tidy). Typed the same way.
  function restoreInto(c, previous, expected) {
    var el = c.el;
    try {
      if (squash(boxValue(el)) !== squash(expected)) return { ok: false, reason: 'changed' };
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        if (el.maxLength > 0 && previous.length > el.maxLength) return { ok: false, reason: 'too-long' };
        setControlValue(el, previous);
        fireEvent(el, 'input', true);
        fireEvent(el, 'change', true);
        if (/blur/i.test(String(el.getAttribute('ng-model-options') || el.getAttribute('data-ng-model-options') || ''))) {
          fireEvent(el, 'blur', false);
          fireEvent(el, 'focusout', true);
        }
        if (squash(el.value) !== squash(previous)) return { ok: false, reason: 'set-failed' };
        lastInsert = null; // (put back: nothing of the insert is left to watch)
        return { ok: true, method: 'dom' };
      }
      if (!writeEditable(el, previous, false)) return { ok: false, reason: 'set-failed' };
      lastInsert = null;
      return { ok: true, method: 'dom' };
    } catch (e) {
      return { ok: false, reason: 'set-failed' };
    }
  }

  // ---- Workspace: the box of a field, by its exact name or label --------------------------------------------------
  // "Work notes (internal)" is the box called "Work notes"; "Short description" is NOT the box called "Description". A name
  // that is the column (or ends in ".column") counts the same as an exact label.
  var NAME_ATTRS = ['name', 'id', 'data-field-name', 'formcontrolname'];

  // The names a Workspace gives these boxes besides the one the panel asks for (audit of 2026-11-07, S4): ServiceNow's own English
  // wording for the kinds that call a box differently, and the Arabic wording of the same boxes. Always whole labels, never a part of
  // one, so "Description" is still not "Short description", and no bare "Comments" (a dialog has one too). The Arabic is what ServiceNow's
  // Arabic language pack is believed to say; docs/live-questions/audit-1107-surfaces.md (L12) asks for a check on a real Arabic Workspace.
  var LABEL_SETS = {
    work_notes: ['work notes', 'work note', '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0639\u0645\u0644', '\u0645\u0644\u0627\u062d\u0638\u0629 \u0627\u0644\u0639\u0645\u0644'],
    comments: ['additional comments', 'customer comments', '\u062a\u0639\u0644\u064a\u0642\u0627\u062a \u0625\u0636\u0627\u0641\u064a\u0629', '\u062a\u0639\u0644\u064a\u0642\u0627\u062a \u0627\u0644\u0639\u0645\u064a\u0644', '\u0627\u0644\u062a\u0639\u0644\u064a\u0642\u0627\u062a \u0627\u0644\u0625\u0636\u0627\u0641\u064a\u0629'],
    close_notes: ['resolution notes', 'close notes', '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u062d\u0644', '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0625\u063a\u0644\u0627\u0642'],
    short_description: ['short description', '\u0627\u0644\u0648\u0635\u0641 \u0627\u0644\u0645\u062e\u062a\u0635\u0631', '\u0648\u0635\u0641 \u0645\u062e\u062a\u0635\u0631', '\u0627\u0644\u0648\u0635\u0641 \u0627\u0644\u0645\u0648\u062c\u0632', '\u0648\u0635\u0641 \u0645\u0648\u062c\u0632'],
    description: ['description', '\u0627\u0644\u0648\u0635\u0641'],
  };

  // A label as it is compared: one line, lower case, no star, Arabic marks and stretching taken out, the forms of alef and yeh made one.
  function plainLabel(text) {
    return squash(text)
      .toLowerCase()
      .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
      .replace(/[\u0622\u0623\u0625]/g, '\u0627')
      .replace(/\u0649/g, '\u064a')
      .replace(/\s*\*+$/, '');
  }

  // Every label the box of `name` may carry: the one the panel asked for, then the field's own set.
  function wantedLabels(name, label) {
    var out = [];
    [label].concat(LABEL_SETS[name] || []).forEach(function (l) {
      var p = plainLabel(l);
      if (p && out.indexOf(p) === -1) out.push(p);
    });
    return out;
  }

  function labelScore(text, wanted) {
    var t = plainLabel(text);
    if (!t || !wanted) return 0;
    if (t === wanted) return 100;
    // the label followed by a marker: "Work notes (internal)", "Description [required]", "Comments: visible to the customer"
    if (t.indexOf(wanted) === 0 && /^\s*(\(|\[|:|-)/.test(t.slice(wanted.length))) return 50;
    return 0;
  }

  function workspaceScore(c, name, wanted) {
    var el = c.el;
    var best = 0;
    NAME_ATTRS.forEach(function (n) {
      var a;
      try {
        a = el.getAttribute(n);
      } catch (e) {
        a = null;
      }
      if (a && (a === name || a.slice(-(name.length + 1)) === '.' + name)) best = 100;
    });
    var texts = [];
    try {
      texts.push(el.getAttribute('aria-label'));
    } catch (e) {
      /* no attribute */
    }
    texts.push(textOfIds(el, el.getAttribute && el.getAttribute('aria-labelledby')));
    labelTexts(el).forEach(function (t) { texts.push(t); });
    texts.forEach(function (t) {
      wanted.forEach(function (w) { best = Math.max(best, labelScore(t, w)); });
    });
    // A component often carries the field's label on itself and holds a bare box: the label of the nearest two shadow hosts counts a
    // little less than the box's own (two boxes under one label are still "two look-alikes": nothing is guessed).
    var node = el;
    for (var up = 0; up < 2; up++) {
      var root = node.getRootNode ? node.getRootNode() : null;
      var host = root && root.host;
      if (!host) break;
      [attrOf(host, 'aria-label'), attrOf(host, 'label')].forEach(function (t) {
        wanted.forEach(function (w) { best = Math.max(best, Math.min(80, labelScore(t, w))); });
      });
      node = host;
    }
    return best;
  }

  function chooseWorkspaceControl(name, label, found) {
    var search = found || findControls();
    var controls = search.controls;
    var wanted = wantedLabels(name, label);
    var scored = [];
    var seen = [];
    controls.forEach(function (c) {
      if (seen.indexOf(c.el) !== -1) return;
      seen.push(c.el);
      if (SECRET_NAME_RE.test(String(c.el.getAttribute('name') || '') + ' ' + String(c.el.getAttribute('id') || ''))) return;
      var score = workspaceScore(c, name, wanted);
      if (!score || !isVisible(c.el)) return; // a hidden box (another record's tab, a collapsed panel) is never the one
      scored.push({ c: c, score: score, locked: isReadOnlyControl(c.el) });
    });
    if (!scored.length) return search.complete ? { reason: 'no-form', gap: 'absent' } : { reason: 'unreachable', gap: 'too-big' };
    scored.sort(function (a, b) { return b.score - a.score; });
    // Two equally good boxes: do not guess (the person copies the text instead).
    if (scored.length > 1 && scored[0].score === scored[1].score) return { reason: 'no-form', gap: 'ambiguous' };
    if (scored[0].locked) return { reason: 'read-only' };
    return { c: scored[0].c };
  }

  // The composer decides where a note goes (W-12): Work notes and customer comments only go into a box that is set to their kind. A box
  // whose mode cannot be read still takes the text, and the answer says so (modeUnread), so the panel can tell the person to check it.
  function fillWorkspaceField(name, text, label, append, previous, wantUndo) {
    var chosen = chooseWorkspaceControl(name, label);
    if (!chosen.c) return { ok: false, reason: chosen.reason };
    var mode = JOURNAL_KIND[name] ? modeOfBox(name, chosen.c) : '';
    if (mode === 'other') return { ok: false, reason: 'wrong-mode' };
    var out = writeInto(chosen.c, text, append, previous, wantUndo);
    if (out.ok && mode === 'unread') out.modeUnread = true;
    return out;
  }

  // What getFieldStates says about a field on a page without g_form: the box an insert would choose, found WITHOUT writing.
  // `gap` (when the box is not there to fill): 'absent' (looked everywhere, none), 'ambiguous' (two look alike), 'too-big' (the page
  // was too big to search in time). `mode` (a Workspace journal box): 'match' | 'other' | 'unread', see modeOfBox.
  function boxState(name, label, portal, search) {
    var chosen = portal ? chooseControl(name, label, search) : chooseWorkspaceControl(name, label, search);
    if (chosen.c) {
      var out = { state: 'editable', label: controlLabel(chosen.c) };
      if (!portal && JOURNAL_KIND[name]) out.mode = modeOfBox(name, chosen.c);
      return out;
    }
    return { state: chosen.reason === 'read-only' ? 'read-only' : 'unknown', label: '', gap: chosen.gap || '' };
  }

  // What getBoxValues says about a field on a Workspace page: the text now in the box an insert would choose (the same chooser),
  // or null when there is no such box, two boxes look the same, or the box is locked. Only the text is read: the box is not
  // focused and no event is fired, so the page cannot tell it was looked at.
  function boxText(name, label, search) {
    var chosen = chooseWorkspaceControl(name, label, search);
    if (!chosen.c) return null;
    var el = chosen.c.el;
    try {
      var value = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : el.innerText != null ? el.innerText : el.textContent;
      return typeof value === 'string' ? value.slice(0, MAX_FIELD_CHARS) : null;
    } catch (e) {
      return null;
    }
  }

  // Choices of a blank incident or case form (Notes to ticket): lists on a page without g_form. The box finder only takes text boxes, so a
  // list is never typed into; it is picked by hand (audit of 2026-11-07, S15).
  var PICK_BY_HAND = { impact: true, urgency: true, contact_type: true };

  // The classic shell (nav_to.do) keeps its form in the frame gsft_main. When that frame has moved on to a LIST and the top address has
  // not followed (audit of 2026-11-07, S8: A until a real UI16 page is checked), the address still names the form before it: the
  // frame's own address says the person is on a list now. Only the frame's path is read, and only when it has no g_form.
  function frameIsOnList() {
    try {
      var frame = window.frames['gsft_main'];
      return Boolean(frame && !frame.g_form && frame.location && /_list\.do$/i.test(String(frame.location.pathname || '')));
    } catch (e) {
      return false; // another origin, or no frame
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

    // Who is signed in: names and roles (to hide features the person cannot use). No admin probing. `roles` is a list, an empty list
    // or null (not known): see rolesFromUser. Portal pages are asked the same way.
    // Classic and Workspace pages have g_user; portal pages may only have NOW / the Angular root scope (see above).
    // No form window and no g_user in the top window (the classic home page, a Next Experience shell): the same-origin frames are asked
    // (userFromFrames). On a Workspace there is none anywhere: the id comes from NOW.user (portalSessionInfo) and the roles stay null.
    getSessionInfo: function () {
      var w = resolveFormWindow() || window;
      var u = w.g_user || window.g_user || userFromFrames();
      var info = u
        ? {
            userName: u.userName || null,
            userId: u.userID || null,
            firstName: u.firstName || null,
            lastName: u.lastName || null,
            displayName: null,
            roles: rolesFromUser(u),
          }
        : null;
      if (!info || !info.userId) info = mergeUsers(info, portalSessionInfo());
      return info;
    },

    // Which record the classic form shows (null on Workspace pages: the panel then reads the table and sys_id from the URL).
    getFormMeta: function () {
      var w = resolveFormWindow();
      if (!w) return frameIsOnList() ? { table: null, sysId: null, isNewRecord: null, number: null, loadedAt: null, frameIsList: true } : null;
      var f = w.g_form;
      var number = null;
      try {
        number = f.getValue('number') || null;
      } catch (e) {
        /* no number field */
      }
      // When the form's document was loaded: Save reloads it (the whole page, or the form's frame on Next Experience), so a new
      // value says "saved", and the panel reads the ticket's header again. A number only.
      var loadedAt;
      try {
        loadedAt = w.performance && typeof w.performance.timeOrigin === 'number' ? Math.round(w.performance.timeOrigin) : null;
      } catch (e) {
        loadedAt = null;
      }
      return {
        table: typeof f.getTableName === 'function' ? f.getTableName() : null,
        sysId: typeof f.getUniqueValue === 'function' ? f.getUniqueValue() : null,
        isNewRecord: typeof f.isNewRecord === 'function' ? !!f.isNewRecord() : null,
        number: number,
        loadedAt: loadedAt,
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
    // `html` is the same text as escaped HTML, made by the content script for a field the form keeps HTML in (the knowledge
    // article body). A form with g_form gets that, so the characters of a model answer are shown as text and never parsed as
    // markup; a field the form says holds HTML, with no such text supplied, is refused rather than filled with raw text.
    // Returns { ok, method: 'gform' | 'dom', label?, reason }. `label` is the box that was used (Workspace and portal pages).
    // On a form with g_form the value is READ BACK after the write (audit of 2026-11-07, W-01): a field that still holds what it held
    // answers 'read-only' (locked), one that holds something else is put back and answers 'set-failed'. No other write is made.
    // `previous` (append only, never with HTML): the text Agent Buddy put into this box before; when the box still holds it exactly,
    // that copy is replaced by the new text instead of a second copy being added below (see appendOrSwap).
    // `options` (round 4): { choice: true } for a choice list (the close code): `value` is its STORED value, set through g_form only,
    // only when the form's list has it (getOption, where the form offers it) and only when it reads back the same; a page without
    // g_form answers 'choice-by-hand' and touches nothing. { undo: true }: the answer also carries `previous` and `after`, what the
    // field held before and holds now, so the panel can offer Undo (restoreField).
    fillField: function (name, value, label, append, html, previous, options) {
      if (typeof name !== 'string' || !FIELD_RE.test(name) || SECRET_NAME_RE.test(name)) return { ok: false, reason: 'bad-field' };
      var text = String(value == null ? '' : value);
      if (text.length > MAX_FIELD_CHARS) return { ok: false, reason: 'too-long' };
      var htmlText = typeof html === 'string' ? html : '';
      if (htmlText.length > MAX_FIELD_CHARS) return { ok: false, reason: 'too-long' };
      var earlier = append === true && !htmlText && typeof previous === 'string' && previous.length <= MAX_FIELD_CHARS ? previous : '';
      var opts = options && typeof options === 'object' ? options : {};
      var choice = opts.choice === true;
      var wantUndo = opts.undo === true;
      if (choice && (append === true || htmlText || !text.trim())) return { ok: false, reason: 'bad-field' };

      var w = resolveFormWindow();
      if (w) {
        var f = w.g_form;
        var exists;
        try {
          exists = typeof f.hasField === 'function' ? !!f.hasField(name) : f.getValue(name) !== undefined;
        } catch (e) {
          exists = false;
        }
        if (!exists) return { ok: false, reason: 'no-such-field' };
        try {
          // The list names the fields a person can type into when it names any; an empty list proves nothing (see editabilityOf).
          if (editabilityOf(editableList(f), formIsClosed(f), name) === 'read-only') return { ok: false, reason: 'read-only' };
          var type = fieldType(f, name);
          var isHtmlType = /html/i.test(type);
          if (isHtmlType && !htmlText) return { ok: false, reason: 'bad-field' };
          // Use the HTML text when the form says the field holds HTML, or when it does not say what the field holds at all.
          if (htmlText && (isHtmlType || !type)) text = htmlText;
          var before = f.getValue(name);
          if (append === true) text = appendOrSwap(before, text, earlier);
          if (text.length > MAX_FIELD_CHARS) return { ok: false, reason: 'too-long' };
          // A choice: only one of the form's own choices, by its stored value (a label or a made-up value is refused).
          if (choice && typeof f.getOption === 'function' && !f.getOption(name, text)) return { ok: false, reason: 'no-such-choice' };
          f.setValue(name, text);
          // READ IT BACK. A locked field (a closed ticket, a read-only box) often takes setValue without a word and keeps its old
          // value, so a call that did not throw proves nothing: only a field that holds the text counts as inserted.
          var after = valueOf(f, name);
          var held = heldAfter(before, after, text);
          if (choice && held === 'unread') return { ok: false, reason: 'set-failed' };
          if (choice && held !== 'ok') {
            // The form did not take it. When it still holds what it held and the form does list the choice, the box is locked;
            // else it was no choice of this form after all. What was there goes back, and nothing is claimed.
            try {
              if (held !== 'locked') f.setValue(name, before == null ? '' : String(before));
            } catch (e2) {
              /* the form refuses that too: it keeps what it has */
            }
            return { ok: false, reason: held === 'locked' && typeof f.getOption === 'function' ? 'read-only' : 'no-such-choice' };
          }
          if (held === 'locked') return { ok: false, reason: 'read-only' };
          // Something else is in the box now (a client script rewrote it). A rich-text field may tidy its markup, so it keeps its
          // answer; any other box goes back to what it held and nothing is claimed.
          if (held === 'other' && !isHtmlType) {
            try {
              f.setValue(name, before == null ? '' : String(before));
            } catch (e3) {
              /* the form refuses that too: it keeps what it has */
            }
            return { ok: false, reason: 'set-failed' };
          }
          var out = { ok: true, method: 'gform' };
          return wantUndo ? withUndo(out, before, after) : out;
        } catch (e) {
          return { ok: false, reason: 'set-failed' };
        }
      }

      // No g_form: a portal page (an Angular page of boxes found by their names) or a Workspace (components found by aria-label).
      // Both type plain text into the page's own editor, which does its own escaping. A choice list there is a component of the
      // page that cannot be set with certainty without clicking it: the person picks it (the panel says which).
      if (choice || PICK_BY_HAND[name] === true) return { ok: false, reason: 'choice-by-hand' };
      if (onPortalPage()) return fillPortalField(name, text, String(label || '').slice(0, 100), append, earlier, wantUndo);
      return fillWorkspaceField(name, text, String(label || '').slice(0, 100), append, earlier, wantUndo);
    },

    // UNDO of fillField (round 4): put `previous` (what the field held before an insert) back into one field, only while the field
    // still holds exactly `expected` (what the insert left there). Anything else in it now (the person typed, the form changed it)
    // answers 'changed' and nothing is written. Found and written the same way fillField does (g_form; else the same box an insert
    // would choose); a choice list only through g_form. Nothing is saved. Returns { ok, method } or { ok: false, reason }.
    restoreField: function (name, previous, expected, label, options) {
      if (typeof name !== 'string' || !FIELD_RE.test(name) || SECRET_NAME_RE.test(name)) return { ok: false, reason: 'bad-field' };
      if (typeof previous !== 'string' || typeof expected !== 'string' || !expected) return { ok: false, reason: 'bad-field' };
      if (previous.length > MAX_FIELD_CHARS || expected.length > MAX_FIELD_CHARS) return { ok: false, reason: 'too-long' };
      var choice = Boolean(options && typeof options === 'object' && options.choice === true);
      var w = resolveFormWindow();
      if (w) {
        var f = w.g_form;
        var exists;
        try {
          exists = typeof f.hasField === 'function' ? !!f.hasField(name) : f.getValue(name) !== undefined;
        } catch (e) {
          exists = false;
        }
        if (!exists) return { ok: false, reason: 'no-such-field' };
        try {
          if (editabilityOf(editableList(f), formIsClosed(f), name) === 'read-only') return { ok: false, reason: 'read-only' };
          var now = f.getValue(name);
          if ((now == null ? '' : String(now)) !== expected) return { ok: false, reason: 'changed' };
          f.setValue(name, previous);
          // Read it back, as an insert does: a locked field keeps what the insert left, and Undo must not claim it was put back.
          var back = valueOf(f, name);
          if (back !== null && squash(back) !== squash(previous)) return { ok: false, reason: squash(back) === squash(expected) ? 'read-only' : 'set-failed' };
          return { ok: true, method: 'gform' };
        } catch (e) {
          return { ok: false, reason: 'set-failed' };
        }
      }
      if (choice) return { ok: false, reason: 'choice-by-hand' };
      var asked = String(label || '').slice(0, 100);
      var chosen = onPortalPage() ? chooseControl(name, asked) : chooseWorkspaceControl(name, asked);
      if (!chosen.c) return { ok: false, reason: chosen.reason };
      return restoreInto(chosen.c, previous, expected);
    },

    // READ ONLY: before the person clicks Insert, can these fields be filled on the open form? Nothing is written or focused.
    // A form with g_form answers from the form itself (on the form or not; editable or read-only, by getEditableFields). A page
    // without g_form is searched for the box each field would go into, the same way fillField searches; the box's label is
    // returned so the panel can say where the text will land. Returns
    //   { form: 'gform', table, sysId, fields: { name: 'editable' | 'read-only' | 'missing' | 'unknown' } }
    // ('unknown': the form has the field but its list of editable fields is empty or absent and the ticket is not clearly closed:
    // the insert is tried and read back; see editabilityOf.)
    //   { form: 'workspace' | 'portal', fields: { name: 'editable' | 'read-only' | 'unknown' }, boxes: { name: label },
    //     gaps: { name: 'absent' | 'ambiguous' | 'too-big' }, modes: { name: 'match' | 'other' | 'unread' } }
    // (gaps: why a box is not there to fill; modes: a Workspace journal box and what its composer is set to. One look through the page
    // serves every name asked about.)
    getFieldStates: function (names, labels) {
      if (!Array.isArray(names)) return null;
      var list = [];
      var asked = [];
      for (var i = 0; i < names.length && i < 8; i++) {
        var n = names[i];
        if (typeof n !== 'string' || !FIELD_RE.test(n) || SECRET_NAME_RE.test(n)) continue;
        list.push(n);
        asked.push(Array.isArray(labels) && typeof labels[i] === 'string' ? labels[i].slice(0, 100) : '');
      }
      var fields = {};
      var w = resolveFormWindow();
      if (w) {
        var f = w.g_form;
        var editable = editableList(f);
        var closed = formIsClosed(f);
        list.forEach(function (name) {
          var exists;
          try {
            exists = typeof f.hasField === 'function' ? !!f.hasField(name) : f.getValue(name) !== undefined;
          } catch (e) {
            exists = false;
          }
          // 'unknown' = the form has the field but cannot say whether it can be typed into: not a block, and not a promise
          fields[name] = exists ? editabilityOf(editable, closed, name) : 'missing';
        });
        var table = null;
        var sysId = null;
        try {
          table = typeof f.getTableName === 'function' ? f.getTableName() : null;
          sysId = typeof f.getUniqueValue === 'function' ? f.getUniqueValue() : null;
        } catch (e) {
          /* not known */
        }
        return { form: 'gform', table: table, sysId: sysId, fields: fields };
      }
      var portal = onPortalPage();
      var boxes = {};
      var gaps = {};
      var modes = {};
      var search = list.length ? findControls() : { controls: [], complete: true }; // (one look through the page for all the fields asked about)
      list.forEach(function (name, j) {
        var found = boxState(name, asked[j], portal, search);
        fields[name] = found.state;
        if (found.label) boxes[name] = found.label;
        if (found.gap) gaps[name] = found.gap;
        if (found.mode) modes[name] = found.mode;
      });
      return { form: portal ? 'portal' : 'workspace', fields: fields, boxes: boxes, gaps: gaps, modes: modes };
    },

    // READ ONLY: on a Workspace page (no g_form, not a portal) the text now in the box of each NAMED field, so a check can count
    // notes that are typed and not saved yet. Each box is found exactly as fillField and getFieldStates find it (by its column
    // name or exact label, visible, editable, never one of two look-alikes); only its text is read. Nothing is focused, typed or
    // fired. A box that is not found is left out. A page with g_form answers through getFormValues instead, and a portal page has
    // no notes of a ticket the agent works, so both answer null. Returns { name: text } (each cut to MAX_FIELD_CHARS) or null.
    // READ ONLY: the box the last insert wrote to (Workspace and portal pages): { n, gone } where `n` counts the inserts and `gone` is true once
    // that box has been emptied or taken off the page, as a Post, a Send or a Save that draws the form again does. Language-independent:
    // it does not look at any button. null when no insert was made on this page. The content script counts it as a save (Undo is then
    // withdrawn: there is nothing left for it to put back).
    watchInsert: function () {
      if (!lastInsert) return null;
      var gone;
      try {
        gone = lastInsert.el.isConnected === false || !squash(boxValue(lastInsert.el));
      } catch (e) {
        gone = true;
      }
      return { n: lastInsert.n, gone: gone };
    },

    getBoxValues: function (names, labels) {
      if (!Array.isArray(names) || resolveFormWindow() || onPortalPage()) return null;
      var values = {};
      var search = findControls();
      for (var i = 0; i < names.length && i < 8; i++) {
        var name = names[i];
        if (typeof name !== 'string' || !FIELD_RE.test(name) || SECRET_NAME_RE.test(name)) continue;
        var text = boxText(name, Array.isArray(labels) && typeof labels[i] === 'string' ? labels[i].slice(0, 100) : '', search);
        if (text !== null) values[name] = text;
      }
      return values;
    },
  };

  function onRequest(event) {
    var detail = event && event.detail;
    if (!detail || typeof detail !== 'object' || typeof detail.id !== 'string' || typeof detail.action !== 'string') return;
    // Only this bridge acts on the request. The first bridge cannot be removed, but its listener is an ordinary one, and a capture
    // listener on the target runs before those: stopped here, it never answers "Unknown action." first, nor fills a field twice.
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
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
  }

  document.addEventListener(REQUEST_EVENT, onRequest, true);
  window.__abBridge = {
    version: BRIDGE_VERSION,
    // Called by a newer bridge when it takes over (above).
    stop: function () {
      document.removeEventListener(REQUEST_EVENT, onRequest, true);
    },
  };
})();

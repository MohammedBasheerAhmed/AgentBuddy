// A fake portal page (Service Portal / Employee Center / customer service portal style): a single-page app with NO g_form that
// moves between a ticket and a list with history.pushState, so the address changes without a reload, like the real thing.
// Like an Angular page, its boxes keep their own "model", and that model only follows the box when an `input` event arrives:
// a value written silently (element.value = ...) leaves the model stale. window.__portal records what the page's models hold,
// how many events each box saw, and every press of the page's own Send button (the extension must never press it).
//
// URL parameters (query string, or a hash route "#/?id=..."):
//   id=ticket|csm_ticket|sc_request  a ticket page (sys_id=, or number=, picks the ticket)    id=my_requests  a list page
//   dup=1      two identical comment boxes (the extension must refuse: it cannot tell which one is meant)
//   ro=1       the comment box is disabled (a ticket that no longer takes comments)
//   nobox=1    no comment box at all
// The /csm portal (the agent's view) also shows a work-notes box, internal; /sp and /esc show only the customer comment box.
(function () {
  var data = JSON.parse(document.getElementById('e2e-portal-data').textContent);
  var app = document.getElementById('portal-app');
  var suffix = app.getAttribute('data-suffix');

  window.__portal = { marker: Math.random().toString(36).slice(2), renders: 0, sends: [], model: {}, events: {} };

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (name) { node.setAttribute(name, attrs[name]); });
    if (text) node.textContent = text;
    return node;
  }

  function params() {
    var query = new URLSearchParams(location.search);
    if (!query.has('id') && location.hash.indexOf('?') >= 0) return new URLSearchParams(location.hash.slice(location.hash.indexOf('?') + 1));
    return query;
  }

  // An Angular-style box: its model follows the box only on input events.
  function modelBox(modelName, attrs, initial) {
    var box = el('textarea', attrs);
    box.value = initial || '';
    window.__portal.model[modelName] = box.value;
    window.__portal.events[modelName] = window.__portal.events[modelName] || { input: 0, change: 0 };
    box.addEventListener('input', function () {
      window.__portal.model[modelName] = box.value;
      window.__portal.events[modelName].input += 1;
    });
    box.addEventListener('change', function () {
      window.__portal.events[modelName].change += 1;
    });
    return box;
  }

  function link(href, text, name) {
    var a = el('a', { href: href, 'data-nav': name }, text);
    a.addEventListener('click', function (event) {
      event.preventDefault();
      go(href);
    });
    return a;
  }

  function go(href) {
    history.pushState({}, '', href);
    render();
  }
  window.__portal.go = go;

  function ticketView(ticket, p) {
    var wrap = el('section', { id: 'ticket' });
    wrap.appendChild(el('h1', { id: 'ticket-number' }, ticket.number));
    wrap.appendChild(el('p', { id: 'ticket-title' }, ticket.title));
    wrap.appendChild(el('p', { class: 'ws-note' }, 'Activity: the customer wrote in on Monday.'));
    wrap.appendChild(el('input', { type: 'text', name: 'q', placeholder: 'Search', 'ng-model': 'search' }));

    var form = el('form', { action: '#' });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      window.__portal.sends.push('form submit');
    });
    // A hidden template of the comment box, as ng-hide leaves behind. It must never be chosen.
    var hidden = modelBox('hiddenComment', { name: 'comments', 'ng-model': 'c.data.comment', placeholder: 'Add a comment', style: 'display:none' }, '');
    form.appendChild(hidden);

    if (ticket.canComment && p.get('nobox') !== '1') {
      var attrs = { id: 'comment', name: 'comments', 'ng-model': 'c.data.comment', placeholder: 'Add a comment', 'aria-label': 'Additional comments' };
      if (p.get('ro') === '1') attrs.disabled = 'disabled';
      form.appendChild(el('label', { for: 'comment' }, 'Additional comments'));
      form.appendChild(modelBox('comment', attrs, ticket.draft || ''));
      if (p.get('dup') === '1') {
        form.appendChild(el('label', { for: 'comment2' }, 'Additional comments'));
        form.appendChild(modelBox('comment2', { id: 'comment2', name: 'comments', 'ng-model': 'c.data.comment', placeholder: 'Add a comment', 'aria-label': 'Additional comments' }, ticket.draft || ''));
      }
    } else {
      form.appendChild(el('p', { id: 'no-comment-box' }, 'This ticket is closed for comments.'));
    }
    if (suffix === 'csm') {
      form.appendChild(el('label', { for: 'worknote' }, 'Work notes (internal)'));
      form.appendChild(modelBox('workNote', { id: 'worknote', name: 'work_notes', 'ng-model': 'c.data.workNote', placeholder: 'Add a work note', 'aria-label': 'Work notes (internal)' }, 'Checked the logs.'));
    }
    var send = el('button', { type: 'button', id: 'send' }, 'Send');
    send.addEventListener('click', function () {
      window.__portal.sends.push('send button');
    });
    form.appendChild(send);
    wrap.appendChild(form);
    wrap.appendChild(link('/' + suffix + '?id=my_requests', 'My requests', 'list'));
    return wrap;
  }

  function listView() {
    var wrap = el('section', { id: 'list' });
    wrap.appendChild(el('h1', { id: 'list-title' }, 'My requests'));
    var ul = el('ul');
    data.tickets.forEach(function (ticket) {
      var li = el('li');
      var path = ticket.table === 'sc_request' ? '?id=sc_request&sys_id=' + ticket.sysId : '?id=ticket&table=' + ticket.table + '&sys_id=' + ticket.sysId;
      li.appendChild(link('/' + suffix + path, ticket.number + ' ' + ticket.title, 'ticket-' + ticket.number));
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    // The same ticket by a hash route (#/?id=...): another way a portal can move around.
    var first = data.tickets[0];
    if (first) wrap.appendChild(link('/' + suffix + '#/?id=ticket&table=' + first.table + '&sys_id=' + first.sysId, 'Open ' + first.number + ' (hash route)', 'hash'));
    return wrap;
  }

  function render() {
    window.__portal.renders += 1;
    var p = params();
    var id = p.get('id') || '';
    app.textContent = '';
    var ticket = null;
    if (id === 'ticket' || id === 'csm_ticket' || id === 'sc_request') {
      ticket = data.tickets.filter(function (t) { return t.sysId === p.get('sys_id') || (p.get('number') && t.number === p.get('number')); })[0] || null;
      if (!ticket) app.appendChild(el('p', { id: 'not-found' }, 'Ticket not found.'));
    }
    app.appendChild(ticket ? ticketView(ticket, p) : id === 'ticket' || id === 'csm_ticket' || id === 'sc_request' ? el('div') : listView());
  }

  window.addEventListener('popstate', render);
  window.addEventListener('hashchange', render);
  render();
})();

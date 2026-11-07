// A fake Workspace record page: Next-Experience-style nested web components with open shadow roots, and NO g_form.
// The composer holds two textareas labelled only by aria-label ("Work notes", "Additional comments"), as the workspace
// activity composer does; the record form above it has a "Resolution notes" box holding the saved close notes. Each component keeps its own state and counts input/change events, so a test can tell a value
// written the way a person types it (events fired) from a silent property assignment.
window.__wsEvents = { input: 0, change: 0 };

class NowTextarea extends HTMLElement {
  connectedCallback() {
    const label = this.getAttribute('label') || '';
    const root = this.attachShadow({ mode: 'open' });
    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = label;
    const ta = document.createElement('textarea');
    ta.setAttribute('aria-label', label);
    ta.value = this.getAttribute('initial') || '';
    ta.addEventListener('input', () => {
      window.__wsEvents.input += 1;
      this.state = ta.value;
    });
    ta.addEventListener('change', () => {
      window.__wsEvents.change += 1;
    });
    wrap.append(title, ta);
    root.append(wrap);
    this.state = ta.value;
  }
}
customElements.define('now-textarea', NowTextarea);

class NowActivityComposer extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<now-textarea label="Work notes" initial="Called the customer back, waiting for the client logs."></now-textarea>' +
      '<now-textarea label="Additional comments" initial=""></now-textarea>';
  }
}
customElements.define('now-activity-composer', NowActivityComposer);

class NowRecordForm extends HTMLElement {
  connectedCallback() {
    const variant = this.getAttribute('variant') || '';
    if (variant) {
      buildVariant(this, variant);
      return;
    }
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<section><h2 id="heading"></h2><div id="fields"></div><now-activity-composer></now-activity-composer></section>';
    root.getElementById('heading').textContent = this.getAttribute('heading') || '';
    // A field of the record itself: "Resolution notes" shows what is saved, as a Workspace form does; typing there is not saved.
    const notes = document.createElement('now-textarea');
    notes.setAttribute('label', 'Resolution notes');
    notes.setAttribute('initial', this.getAttribute('close-notes') || '');
    root.getElementById('fields').append(notes);
  }
}

// ---- Variants (the address says which: /now/sow/record/incident/<id>?variant=...) -----------------------------------------------------
// Audit of 2026-11-07, part 9: what the plain page above does not have. A composer that serves BOTH Work notes and customer comments, with
// a switch of tabs (the box keeps its label, as one composer may), a record Save and a composer Post that empties the box the way a
// composer does; none of these buttons is ever pressed by the extension, only by the test, as a person would.
//   modes          composer set to Work notes
//   customer       composer set to customer comments
//   arabic         the same composer with Arabic labels (English labels never appear on the page)
//   notes-tab      no composer until the person presses the Notes tab (the page's own button)
//   big            60,000 elements in front of the composer (the first search stopped at 25,000)
//   none           a record with no composer at all
window.__wsPosts = [];
window.__wsSaves = 0;

function pageButton(label, onPress) {
  const host = document.createElement('now-button');
  host.setAttribute('label', label);
  const root = host.attachShadow({ mode: 'open' });
  const button = document.createElement('button');
  button.textContent = label;
  button.addEventListener('click', onPress);
  root.append(button);
  return host;
}

function modesComposer(mode, words) {
  const wrap = document.createElement('now-composer');
  const root = wrap.attachShadow({ mode: 'open' });
  const tabs = document.createElement('div');
  tabs.setAttribute('role', 'tablist');
  const names = [words.internal, words.customer];
  const buttons = names.map((name, i) => {
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    tab.textContent = name;
    tab.setAttribute('aria-selected', String(i === (mode === 'customer' ? 1 : 0)));
    tab.addEventListener('click', () => buttons.forEach((other, j) => other.setAttribute('aria-selected', String(i === j))));
    return tab;
  });
  tabs.append(...buttons);
  const box = document.createElement('textarea');
  box.setAttribute('aria-label', words.box); // one box: its label does not follow the switch
  box.value = 'Called the customer back.';
  box.addEventListener('input', () => {
    window.__wsEvents.input += 1;
  });
  box.addEventListener('change', () => {
    window.__wsEvents.change += 1;
  });
  const post = pageButton(words.post, () => {
    window.__wsPosts.push(box.value);
    box.value = ''; // a composer is empty again after a post
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  root.append(tabs, box, post);
  return wrap;
}

const ENGLISH = { internal: 'Work notes', customer: 'Customer comments', box: 'Work notes', post: 'Post', save: 'Save', notes: 'Notes', details: 'Details' };
const ARABIC = { internal: '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0639\u0645\u0644', customer: '\u062a\u0639\u0644\u064a\u0642\u0627\u062a \u0627\u0644\u0639\u0645\u064a\u0644', box: '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0639\u0645\u0644', post: '\u0646\u0634\u0631', save: '\u062d\u0641\u0638', notes: '\u0627\u0644\u0645\u0644\u0627\u062d\u0638\u0627\u062a', details: '\u0627\u0644\u062a\u0641\u0627\u0635\u064a\u0644' };

function buildVariant(form, variant) {
  const words = variant === 'arabic' ? ARABIC : ENGLISH;
  const root = form.attachShadow({ mode: 'open' });
  root.innerHTML = '<section><h2 id="heading"></h2><div id="fields"></div><div id="stream"></div></section>';
  root.getElementById('heading').textContent = form.getAttribute('heading') || '';
  const fields = root.getElementById('fields');
  const stream = root.getElementById('stream');
  const notes = document.createElement('now-textarea');
  notes.setAttribute('label', variant === 'arabic' ? '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u062d\u0644' : 'Resolution notes');
  notes.setAttribute('initial', form.getAttribute('close-notes') || '');
  fields.append(notes, pageButton(words.save, () => {
    window.__wsSaves += 1;
  }));
  if (variant === 'big') {
    // 60,000 elements in front of the composer, in the page's own light DOM inside the form
    const filler = document.createElement('div');
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 60000; i += 1) fragment.append(document.createElement('div'));
    filler.append(fragment);
    stream.append(filler);
  }
  if (variant === 'none') return;
  if (variant === 'notes-tab') {
    // the activity stream is behind the Notes tab: nothing to type into until the person opens it
    const tabs = document.createElement('div');
    tabs.setAttribute('role', 'tablist');
    const details = document.createElement('button');
    details.setAttribute('role', 'tab');
    details.setAttribute('aria-selected', 'true');
    details.textContent = words.details;
    const notesTab = document.createElement('button');
    notesTab.setAttribute('role', 'tab');
    notesTab.setAttribute('aria-selected', 'false');
    notesTab.textContent = words.notes;
    notesTab.addEventListener('click', () => {
      details.setAttribute('aria-selected', 'false');
      notesTab.setAttribute('aria-selected', 'true');
      if (!stream.querySelector('now-composer')) stream.append(modesComposer('work', words));
    });
    tabs.append(details, notesTab);
    stream.before(tabs);
    return;
  }
  stream.append(modesComposer(variant === 'customer' ? 'customer' : 'work', words));
}

// (defined last: the page's record form is upgraded the moment it is defined, and builds with the variants above)
customElements.define('now-record-form', NowRecordForm);

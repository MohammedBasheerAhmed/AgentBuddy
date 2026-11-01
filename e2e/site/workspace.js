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
customElements.define('now-record-form', NowRecordForm);

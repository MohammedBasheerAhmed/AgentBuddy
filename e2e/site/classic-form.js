// A fake classic ServiceNow form: defines window.g_form over an in-memory field map and writes values into visible inputs.
// It is an EXTERNAL script (no inline code), like a page served with a strict Content-Security-Policy.
//
// Everything the Agent Buddy page bridge touches is here: getValue, setValue, getTableName, getUniqueValue, isNewRecord,
// hasField, getEditableFields, getGlideUIElement, isReadOnly. Every setValue is recorded in window.__gformCalls so the
// test can prove what the extension wrote, and that it only ever called setValue (never a save).
(function () {
  var data = JSON.parse(document.getElementById('e2e-record').textContent);
  var values = Object.assign({}, data.values);
  var editable = data.editable.slice();
  var types = data.types || {};
  window.__gformCalls = [];
  window.__gformSaves = []; // would be filled by save()/submit(); the extension must never trigger either

  function control(name) {
    return document.getElementById(data.table + '.' + name);
  }

  Object.keys(values).forEach(function (name) {
    var el = control(name);
    if (el) el.value = values[name];
  });
  // What the agent types by hand reaches the map, as in the real form.
  document.addEventListener('input', function (event) {
    var el = event.target;
    if (el && el.id && el.id.indexOf(data.table + '.') === 0) values[el.id.slice(data.table.length + 1)] = el.value;
  });

  window.g_form = {
    getTableName: function () { return data.table; },
    getUniqueValue: function () { return data.sysId; },
    isNewRecord: function () { return false; },
    hasField: function (name) { return Object.prototype.hasOwnProperty.call(values, name); },
    getValue: function (name) { return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : ''; },
    setValue: function (name, value) {
      window.__gformCalls.push({ fn: 'setValue', name: name, value: String(value) });
      values[name] = String(value);
      var el = control(name);
      if (el) el.value = String(value);
    },
    getEditableFields: function () { return editable.slice(); },
    // Current releases answer true for everything (the bridge knows and does not trust it).
    isReadOnly: function () { return true; },
    getGlideUIElement: function (name) { return { type: types[name] || 'string' }; },
    save: function () { window.__gformSaves.push('save'); },
    submit: function () { window.__gformSaves.push('submit'); },
  };
  window.__gformReady = true;
})();

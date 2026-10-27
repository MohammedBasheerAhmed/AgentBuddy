import React, { useEffect, useRef, useState } from 'react';
import { read } from '../ask.js';
import { SNIPPETS_KEY } from '../../lib/storage.js';
import { LIMITS, addSnippet, exportSnippets, importSnippets, removeSnippet, searchSnippets, updateSnippet } from '../../snippets/store.js';
import { BUILTIN_VARIABLES } from '../../snippets/render.js';
import { changeSnippets, loadSnippets, starterSnippets } from '../../snippets/library.js';
import { describeMissing, previewSnippet, unknownVariables } from '../../snippets/preview.js';
import { FillFeedback, ReviewHints, hintsFor, useFill } from './shared.js';

const area = () => chrome.storage.local;
const token = (name) => `{{${name}}}`; // (braces cannot be written inside JSX text)
const firstLine = (body) => String(body || '').split('\n').find((l) => l.trim()) || '';

/** What a snippet will look like, as plain text (React escapes it), with the variables that could not be filled listed. */
function PreviewBox({ preview, label }) {
  const hints = describeMissing(preview.missing);
  return (
    <>
      <div className="ab-output ab-compose-preview" aria-label={label}>{preview.text}</div>
      {hints.length > 0 && (
        <ul className="ab-compose-list ab-locked" aria-label="Variables without a value">
          {hints.map((h) => (
            <li key={h.name}>
              <span className="ab-mono">{token(h.name)}</span>: {h.hint}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function SnippetsPanel({ page, eff, active }) {
  const fill = useFill({ page, eff, run: null, feature: 'snippets' }); // (no AI run: the audit log names the action 'snippets')
  const [list, setList] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState(null); // { id, title, shortcut, body } while creating or editing
  const [editError, setEditError] = useState('');
  const [showVars, setShowVars] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [msg, setMsg] = useState(null); // { kind, text, details? }
  const [askMissing, setAskMissing] = useState(null); // an insert waiting for "insert anyway" because a variable has no value
  const [packState, setPackState] = useState({ key: '', pack: null, state: 'none' }); // the open record, for the variables
  const [packNonce, setPackNonce] = useState(0);
  const bodyRef = useRef(null);

  const record = page.record;
  const key = record ? `${record.table}:${record.sysId}` : '';
  const agent = { name: page.user?.name || '' };
  const selected = list.find((s) => s.id === selectedId) || null;
  const needsPack = active && Boolean(selected || editor);

  // ---- the library ----
  useEffect(() => {
    let cancelled = false;
    const reload = () => loadSnippets(area()).then((l) => !cancelled && setList(l));
    reload().finally(() => !cancelled && setLoaded(true));
    const onChange = (changes, areaName) => {
      if (areaName === 'local' && changes[SNIPPETS_KEY]) reload();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, []);

  // Another record is open: what was inserted into the last one is no longer "Inserted" here.
  useEffect(() => {
    fill.clear();
    setAskMissing(null);
    // fill.clear is stable; the open record's identity is what counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // ---- the open record's values, read once per record while a snippet is shown ----
  useEffect(() => {
    if (!needsPack) return undefined;
    if (!key) {
      setPackState({ key: '', pack: null, state: 'none' });
      return undefined;
    }
    let cancelled = false;
    setPackState({ key, pack: null, state: 'loading' });
    read(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: 'reply-draft', allowSensitive: Boolean(eff.policy?.allowHrContent) })
      .then((pack) => !cancelled && setPackState({ key, pack, state: 'ready' }))
      .catch(() => !cancelled && setPackState({ key, pack: null, state: 'error' }));
    return () => {
      cancelled = true;
    };
    // The record's identity and the refresh counter decide when to read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPack, key, packNonce, page.tabId]);

  const realPack = packState.state === 'ready' && packState.key === key ? packState.pack : null;
  // What the person sees: the record's values, or example values when no record is open (clearly labelled).
  const showExamples = !realPack;
  const shown = (body) => previewSnippet(body, showExamples ? { examples: true } : { pack: realPack, agent });
  // What gets inserted: only real values. A variable without one stays visible and is reported, never replaced by an example.
  const actual = (body) => previewSnippet(body, { pack: realPack, agent });
  const sourceNote = !key
    ? 'No ticket is open, so this shows example values. Open a ticket to see real ones.'
    : packState.state === 'loading'
      ? 'Reading the ticket…'
      : packState.state === 'error'
        ? 'The ticket could not be read, so this shows example values.'
        : 'Filled from the open ticket.';

  // ---- changing the library ----
  async function persist(apply) {
    try {
      const res = await changeSnippets(area(), apply);
      setList(res.list);
      return res;
    } catch {
      setMsg({ kind: 'danger', text: 'The snippets could not be saved. Try again.' });
      return null;
    }
  }

  async function save() {
    const input = { title: editor.title, shortcut: editor.shortcut, body: editor.body };
    const res = await persist((cur) => (editor.id ? updateSnippet(cur, editor.id, input) : addSnippet(cur, input)));
    if (!res) return;
    if (res.error) {
      setEditError(res.error);
      return;
    }
    setEditor(null);
    setEditError('');
    setSelectedId(res.snippet?.id || '');
    setMsg({ kind: 'ok', text: 'Saved.' });
  }

  async function remove(id) {
    const res = await persist((cur) => ({ list: removeSnippet(cur, id) }));
    setConfirmDelete('');
    if (res) {
      setSelectedId('');
      setMsg({ kind: 'ok', text: 'Deleted.' });
    }
  }

  async function addStarters() {
    const res = await persist((cur) => {
      let next = cur;
      for (const s of starterSnippets()) {
        const r = addSnippet(next, s);
        if (!r.error) next = r.list;
      }
      return { list: next };
    });
    if (res) setMsg({ kind: 'ok', text: 'Added three examples. Edit or delete them as you like.' });
  }

  async function exportAll() {
    try {
      await navigator.clipboard.writeText(exportSnippets(list));
      setMsg({ kind: 'ok', text: `Copied ${list.length} snippet${list.length === 1 ? '' : 's'} as JSON. Paste it into a note, or into Import on another computer.` });
    } catch {
      setMsg({ kind: 'danger', text: 'The browser blocked copying. Try again from the panel.' });
    }
  }

  async function doImport() {
    const res = await persist((cur) => {
      const r = importSnippets(importText, cur);
      return { list: r.list, added: r.added, skipped: r.skipped, errors: r.errors };
    });
    if (!res) return;
    setMsg({ kind: res.added ? 'ok' : 'warn', text: `Added ${res.added}, skipped ${res.skipped}.`, details: res.errors });
    if (res.added) {
      setImportText('');
      setShowImport(false);
    }
  }

  // ---- using a snippet ----
  async function insertSnippet(snippet, kind, force = false) {
    const real = actual(snippet.body);
    if (!force && real.missing.length) {
      setAskMissing({ id: snippet.id, kind });
      return;
    }
    setAskMissing(null);
    // The customer reads a comment: the review runs first (it looks at the field the text goes into). The text was filled in from the
    // record whose values were read, so it only goes into that record's form.
    const spec =
      kind === 'comment'
        ? { field: 'comments', label: 'Additional comments', key: 'comment' }
        : { field: 'work_notes', label: 'Work notes', key: 'note' };
    await fill.insert(
      { ...spec, value: real.text, mode: 'append', expect: realPack ? { table: realPack.table, sysId: realPack.sysId } : undefined, number: realPack?.number },
      { people: realPack?.people || [] }
    );
  }

  function addVariable(name) {
    const el = bodyRef.current;
    const text = token(name);
    setEditor((ed) => {
      const at = el && typeof el.selectionStart === 'number' ? [el.selectionStart, el.selectionEnd] : [ed.body.length, ed.body.length];
      return { ...ed, body: ed.body.slice(0, at[0]) + text + ed.body.slice(at[1]) };
    });
    if (el) requestAnimationFrame(() => el.focus());
  }

  const results = searchSnippets(list, query);
  const startNew = () => {
    setEditor({ id: '', title: '', shortcut: '', body: '' });
    setEditError('');
    setSelectedId('');
    setMsg(null);
  };
  const startEdit = (s) => {
    setEditor({ id: s.id, title: s.title, shortcut: s.shortcut || '', body: s.body });
    setEditError('');
    setMsg(null);
  };
  const clearNotes = () => {
    fill.clear();
    setAskMissing(null);
  };

  // ---- the editor ----
  if (editor) {
    const unknown = unknownVariables(editor.body);
    return (
      <div className="ab-compose-stack">
        <section className="ab-card" aria-label={editor.id ? 'Edit snippet' : 'New snippet'}>
          <h3 className="ab-h">{editor.id ? 'Edit snippet' : 'New snippet'}</h3>
          <div className="ab-field">
            <label className="ab-label" htmlFor="ab-snip-title">Title</label>
            <input id="ab-snip-title" className="ab-input" maxLength={LIMITS.title} value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} />
          </div>
          <div className="ab-field">
            <label className="ab-label" htmlFor="ab-snip-shortcut">Shortcut (optional)</label>
            <input id="ab-snip-shortcut" className="ab-input" maxLength={LIMITS.shortcut} value={editor.shortcut} onChange={(e) => setEditor({ ...editor, shortcut: e.target.value })} placeholder="info" autoComplete="off" />
            <span className="ab-hint">Letters, digits, dash, underscore and slash. Type it in the search box to find the snippet quickly.</span>
          </div>
          <div className="ab-field">
            <label className="ab-label" htmlFor="ab-snip-body">Text</label>
            <textarea id="ab-snip-body" ref={bodyRef} className="ab-textarea ab-compose-text" maxLength={LIMITS.body} value={editor.body} onChange={(e) => setEditor({ ...editor, body: e.target.value })} />
            <span className="ab-hint">{editor.body.length.toLocaleString()} of {LIMITS.body.toLocaleString()} characters</span>
          </div>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" aria-expanded={showVars} onClick={() => setShowVars((v) => !v)}>
              {showVars ? 'Hide variables' : 'Variables'}
            </button>
          </div>
          {showVars && (
            <div className="ab-note ab-compose-vars">
              <p>
                Write <span className="ab-mono">{token('name')}</span> where a value should go, for example <span className="ab-mono">{token('caller.first_name')}</span>.
                Add a fallback after a bar for when there is no value: <span className="ab-mono">{token('caller.first_name | there')}</span>. A variable with no value and no
                fallback stays visible and is listed, so you can fix it before sending.
              </p>
              <ul className="ab-compose-rows">
                {BUILTIN_VARIABLES.map((v) => (
                  <li key={v.name} className="ab-compose-row">
                    <div className="ab-compose-row-text">
                      <span className="ab-mono">{token(v.name)}</span>
                      <span className="ab-sub">{v.description} (for example {v.example})</span>
                    </div>
                    <button type="button" className="ab-btn ab-btn-sm" onClick={() => addVariable(v.name)} aria-label={`Add ${v.name} to the text`}>Add</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unknown.length > 0 && (
            <p className="ab-note ab-note-warn" role="status">
              Agent Buddy does not know {unknown.length === 1 ? 'this variable' : 'these variables'}: {unknown.map((n) => token(n)).join(', ')}. Check the spelling, or add a fallback.
            </p>
          )}
          <h4 className="ab-compose-sub">Preview</h4>
          <p className="ab-hint">{sourceNote}</p>
          <PreviewBox preview={shown(editor.body)} label="Preview of the snippet" />
          {editError && <p className="ab-note ab-note-danger" role="alert">{editError}</p>}
          <div className="ab-row ab-compose-gap">
            <button type="button" className="ab-btn ab-btn-primary ab-btn-sm" onClick={save}>Save</button>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => { setEditor(null); setEditError(''); }}>Cancel</button>
          </div>
        </section>
      </div>
    );
  }

  // ---- the list ----
  const detail = selected ? shown(selected.body) : null;
  const realMissing = selected ? actual(selected.body).missing : [];
  return (
    <div className="ab-compose-stack">
      <section className="ab-card" aria-label="Snippets">
        <div className="ab-row ab-compose-head">
          <h3 className="ab-h">Snippets</h3>
          <span className="ab-spacer" />
          <button type="button" className="ab-btn ab-btn-primary ab-btn-sm" onClick={startNew}>New snippet</button>
        </div>
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-snip-search">Search</label>
          <input id="ab-snip-search" className="ab-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, shortcut or text" autoComplete="off" />
        </div>
        {!loaded && <p className="ab-sub">Loading…</p>}
        {loaded && list.length === 0 && (
          <div className="ab-note">
            <p>No snippets yet. A snippet is a reply you write once and reuse, with values from the ticket filled in.</p>
            <div className="ab-row">
              <button type="button" className="ab-btn ab-btn-sm ab-btn-primary" onClick={addStarters}>Add three examples</button>
              <button type="button" className="ab-btn ab-btn-sm" onClick={startNew}>Write my own</button>
            </div>
          </div>
        )}
        {loaded && list.length > 0 && results.length === 0 && <p className="ab-sub">Nothing matches "{query}".</p>}
        {results.length > 0 && (
          <ul className="ab-compose-rows ab-compose-scroll" aria-label="Snippet list">
            {results.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`ab-feature ab-compose-pick${s.id === selectedId ? ' ab-compose-picked' : ''}`}
                  aria-pressed={s.id === selectedId}
                  onClick={() => {
                    setSelectedId(s.id === selectedId ? '' : s.id);
                    setConfirmDelete('');
                    clearNotes();
                    setMsg(null);
                  }}
                >
                  <span className="ab-feature-title">
                    {s.title} {s.shortcut && <span className="ab-tag">{s.shortcut}</span>}
                  </span>
                  <span className="ab-feature-desc">{firstLine(s.body).slice(0, 90)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {msg && (
          <div className={`ab-note ab-note-${msg.kind} ab-compose-gap`} role="status">
            {msg.text}
            {msg.details && msg.details.length > 0 && (
              <ul className="ab-compose-list">
                {msg.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {selected && detail && (
        <section className="ab-card ab-compose-actions" aria-label={`Snippet: ${selected.title}`}>
          <div className="ab-row ab-compose-head">
            <h3 className="ab-h">{selected.title}</h3>
            <span className="ab-spacer" />
            {key && (
              <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => setPackNonce((n) => n + 1)} disabled={packState.state === 'loading'}>
                Refresh values
              </button>
            )}
          </div>
          <p className="ab-hint">{sourceNote}</p>
          <PreviewBox preview={detail} label="Snippet as it will be inserted" />
          {/* what the customer would see if this goes in as a comment: low-severity findings never block, but they are shown */}
          <ReviewHints hints={hintsFor('comments', actual(selected.body).text, { people: realPack?.people || [] })} />

          {askMissing && askMissing.id === selected.id && (
            <div className="ab-note ab-note-warn" role="alert">
              <strong>Some values are missing.</strong> If you insert now, these stay as written in the text:{' '}
              {realMissing.map((n) => token(n)).join(', ')}.
              <div className="ab-row ab-compose-gap">
                <button type="button" className="ab-btn ab-btn-sm" disabled={fill.busy} onClick={() => insertSnippet(selected, askMissing.kind, true)}>Insert anyway</button>
                <button type="button" className="ab-btn ab-btn-sm" onClick={() => setAskMissing(null)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm ab-btn-primary" disabled={(Boolean(key) && packState.state === 'loading') || fill.busy || fill.inserted.comment} onClick={() => insertSnippet(selected, 'comment')}>
              {fill.inserted.comment ? 'Inserted' : 'Insert as customer comment'}
            </button>
            <button type="button" className="ab-btn ab-btn-sm" disabled={(Boolean(key) && packState.state === 'loading') || fill.busy || fill.inserted.note} onClick={() => insertSnippet(selected, 'note')}>
              {fill.inserted.note ? 'Inserted' : 'Insert as work note'}
            </button>
            <button type="button" className="ab-btn ab-btn-sm" disabled={fill.busy} onClick={() => fill.copy(actual(selected.body).text)}>Copy</button>
          </div>
          <FillFeedback fill={fill} />
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => startEdit(selected)}>Edit</button>
            {confirmDelete === selected.id ? (
              <>
                <span className="ab-sub">Delete this snippet?</span>
                <button type="button" className="ab-btn ab-btn-danger ab-btn-sm" onClick={() => remove(selected.id)}>Yes, delete</button>
                <button type="button" className="ab-btn ab-btn-sm" onClick={() => setConfirmDelete('')}>No</button>
              </>
            ) : (
              <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => setConfirmDelete(selected.id)}>Delete</button>
            )}
          </div>
          <p className="ab-hint">Insert adds the text below what is in the field. Nothing is saved or sent; you press Save yourself.</p>
        </section>
      )}

      <section className="ab-card" aria-label="Export and import">
        <h3 className="ab-h">Back up or share</h3>
        <div className="ab-row">
          <button type="button" className="ab-btn ab-btn-sm" disabled={list.length === 0} onClick={exportAll}>Copy all as JSON</button>
          <button type="button" className="ab-btn ab-btn-sm" aria-expanded={showImport} onClick={() => setShowImport((v) => !v)}>
            {showImport ? 'Close import' : 'Import from JSON'}
          </button>
        </div>
        {showImport && (
          <div className="ab-field ab-compose-gap">
            <label className="ab-label" htmlFor="ab-snip-import">Paste the JSON here</label>
            <textarea id="ab-snip-import" className="ab-textarea ab-compose-text" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"format":"agent-buddy-snippets", ...}' />
            <div className="ab-row">
              <button type="button" className="ab-btn ab-btn-sm ab-btn-primary" disabled={!importText.trim()} onClick={doImport}>Add these snippets</button>
            </div>
            <span className="ab-hint">Snippets that repeat a shortcut or an existing title and text are skipped. Nothing is overwritten.</span>
          </div>
        )}
      </section>
    </div>
  );
}

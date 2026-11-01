import React, { useEffect, useMemo, useRef, useState } from 'react';
import { read } from '../ask.js';
import { SNIPPETS_KEY } from '../../lib/storage.js';
import { LIMITS, addSnippet, exportSnippets, importSnippets, removeSnippet, searchSnippets, updateSnippet } from '../../snippets/store.js';
import { BUILTIN_VARIABLES } from '../../snippets/render.js';
import { changeSnippets, loadSnippets, starterSnippets } from '../../snippets/library.js';
import { SNIPPET_FEATURE, describeMissing, previewSnippet, unknownVariables } from '../../snippets/preview.js';
import { isOrgSnippet, orgSnippetList, withOrgSnippets } from '../../snippets/org.js';
import { fileProblem, snippetFileName, withoutBom } from '../../snippets/file.js';
import { snippetTargets } from '../../snippets/targets.js';
import { downloadText } from '../reports/download.js';
import { ShowMore } from '../ui/primitives.jsx';
import { FillFeedback, ReviewHints, hintsFor, useFill } from './shared.js';
import { formatNumber, isolate, t, tn, t as tr } from '../../i18n/index.js';
import { tx } from '../../i18n/jsx.jsx';

// N21 Snippets: canned replies with {{variables}} filled from the open ticket, inserted into a field of its form (the person presses
// Save). Three sources, one list: the organisation's (policy `orgSnippets`, read-only, marked), the person's own (this browser,
// chrome.storage.local) and, through a file, someone else's. The "search word" makes a snippet quick to find in the search box; it
// is never typed into a ServiceNow page (nothing here types into the page on its own).

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
        <ul className="ab-compose-list ab-locked" aria-label={t('Variables without a value')}>
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

/** The summary next to the card's title: "12 snippets · 3 from your organisation". */
export function snippetSummary(own, org) {
  const total = own.length + org.length;
  if (!total) return '';
  const count = tn(total, '{n} snippet', '{n} snippets');
  return org.length ? t('{count} · {org} from your organisation', { count, org: org.length }) : count;
}

export default function SnippetsPanel({ page, eff, active, onSummary = () => {} }) {
  const fill = useFill({ page, eff, run: null, feature: 'snippets' }); // (no AI run: the audit log names the action 'snippets')
  const [own, setOwn] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState(null); // { id, title, shortcut, body } while creating or editing
  const [editError, setEditError] = useState('');
  const [showVars, setShowVars] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [backup, setBackup] = useState(false); // the "Back up or share" part is open
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [msg, setMsg] = useState(null); // { kind, text, details? }
  const [askMissing, setAskMissing] = useState(null); // an insert waiting for "insert anyway" because a variable has no value
  const [packState, setPackState] = useState({ key: '', pack: null, state: 'none' }); // the open record, for the variables
  const [packNonce, setPackNonce] = useState(0);
  const [targetField, setTargetField] = useState('');
  const bodyRef = useRef(null);
  const box = useRef(null);
  const titleRef = useRef(null);
  const fileRef = useRef(null);
  // Opening the editor puts the focus in its first box; closing it puts the focus back on the snippet (or on "New snippet"), so a
  // keyboard or screen reader user is never left at the top of the page.
  const editorKey = editor ? editor.id || 'new' : '';
  const lastEditor = useRef('');
  useEffect(() => {
    const before = lastEditor.current;
    lastEditor.current = editorKey;
    if (editorKey) {
      titleRef.current?.focus();
      return;
    }
    if (!before) return;
    const target = (selectedId && box.current?.querySelector(`[data-snippet="${selectedId}"]`)) || box.current?.querySelector('[data-snippet-new]');
    target?.focus();
    // Only the opening and closing of the editor matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorKey]);

  const record = page.record;
  const key = record ? `${record.table}:${record.sysId}` : '';
  const agent = { name: page.user?.name || '' };
  const org = useMemo(() => orgSnippetList(eff.policy?.orgSnippets), [eff.policy?.orgSnippets]);
  const list = useMemo(() => withOrgSnippets(own, org), [own, org]);
  const selected = list.find((s) => s.id === selectedId) || null;
  const needsPack = active && Boolean(selected || editor);
  const targets = snippetTargets(page);
  const target = targets.find((item) => item.field === targetField) || targets[0];

  useEffect(() => {
    onSummary(snippetSummary(own, org));
    // onSummary is the parent's setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own.length, org.length]);

  // ---- the library ----
  useEffect(() => {
    let cancelled = false;
    const reload = () => loadSnippets(area()).then((l) => !cancelled && setOwn(l));
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
    read(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: SNIPPET_FEATURE, allowSensitive: Boolean(eff.policy?.allowHrContent) })
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
  const forNumber = realPack?.number || record?.number || '';
  const sourceNote = !key
    ? t('No ticket is open, so this shows example values. Open a ticket to see real ones.')
    : packState.state === 'loading'
      ? t('Reading the ticket…')
      : packState.state === 'error'
        ? t('The ticket could not be read, so this shows example values.')
        : forNumber
          ? t('Filled from {number}.', { number: isolate(forNumber) })
          : t('Filled from the open ticket.');

  // ---- changing the library ----
  async function persist(apply) {
    try {
      const res = await changeSnippets(area(), apply);
      setOwn(res.list);
      return res;
    } catch {
      setMsg({ kind: 'danger', text: t('The snippets could not be saved. Try again.') });
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
    setMsg({ kind: 'ok', text: t('Saved.') });
  }

  async function remove(id) {
    const res = await persist((cur) => ({ list: removeSnippet(cur, id) }));
    setConfirmDelete('');
    if (res) {
      setSelectedId('');
      setMsg({ kind: 'ok', text: t('Deleted.') });
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
    if (res) setMsg({ kind: 'ok', text: t('Added three examples. Edit or delete them as you like.') });
  }

  // ---- back up and share: your own snippets only (the organisation's come from its policy) ----
  function saveFile() {
    try {
      downloadText(snippetFileName(), exportSnippets(own), 'application/json;charset=utf-8');
      setMsg({ kind: 'ok', text: tn(own.length, 'Saved {n} snippet to a file in your downloads. Add it on another computer with "Add from a file".', 'Saved {n} snippets to a file in your downloads. Add it on another computer with "Add from a file".') });
    } catch {
      setMsg({ kind: 'danger', text: t('The browser did not save the file. Try "Copy as text" instead.') });
    }
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(exportSnippets(own));
      setMsg({ kind: 'ok', text: tn(own.length, 'Copied {n} snippet as text. Paste it into "Paste instead" on another computer.', 'Copied {n} snippets as text. Paste it into "Paste instead" on another computer.') });
    } catch {
      setMsg({ kind: 'danger', text: t('The browser blocked copying. Try "Save to a file" instead.') });
    }
  }

  async function importFrom(text) {
    const res = await persist((cur) => {
      const r = importSnippets(withoutBom(text), cur);
      return { list: r.list, added: r.added, skipped: r.skipped, errors: r.errors };
    });
    if (!res) return false;
    setMsg({ kind: res.added ? 'ok' : 'warn', text: t('Added {added}, skipped {skipped}.', { added: res.added, skipped: res.skipped }), details: res.errors });
    return res.added > 0;
  }

  async function chooseFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be chosen again
    const problem = fileProblem(file);
    if (problem) {
      setMsg({ kind: 'warn', text: problem });
      return;
    }
    let text = '';
    try {
      text = await file.text();
    } catch {
      setMsg({ kind: 'danger', text: t('The file could not be read.') });
      return;
    }
    await importFrom(text);
  }

  async function importPasted() {
    if (await importFrom(importText)) {
      setImportText('');
      setPasteOpen(false);
    }
  }

  // ---- using a snippet ----
  async function insertSnippet(snippet, force = false) {
    const real = actual(snippet.body);
    if (!force && real.missing.length) {
      setAskMissing({ id: snippet.id });
      return;
    }
    setAskMissing(null);
    // The review runs first for a field the customer reads (it looks at the field the text goes into). The text was filled in from
    // the record whose values were read, so it only goes into that record's form.
    await fill.insert(
      {
        field: target.field,
        label: target.fieldLabel,
        key: `snippet:${target.field}`,
        value: real.text,
        mode: 'append',
        expect: realPack ? { table: realPack.table, sysId: realPack.sysId } : undefined,
        number: realPack?.number,
      },
      { people: realPack?.people || [], internalPhrases: eff.policy?.internalPhrases || [] }
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
      <div className="ab-compose-stack" ref={box}>
        <section className="ab-compose-editor" aria-label={editor.id ? t('Edit snippet') : t('New snippet')}>
          <h3 className="ab-h">{editor.id ? t('Edit snippet') : t('New snippet')}</h3>
          <div className="ab-field">
            <label className="ab-label" htmlFor="ab-snip-title">{t('Title')}</label>
            <input id="ab-snip-title" ref={titleRef} className="ab-input" maxLength={LIMITS.title} value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} />
          </div>
          <div className="ab-field">
            <label className="ab-label" htmlFor="ab-snip-shortcut">{t('Search word (optional)')}</label>
            <input id="ab-snip-shortcut" className="ab-input" maxLength={LIMITS.shortcut} value={editor.shortcut} onChange={(e) => setEditor({ ...editor, shortcut: e.target.value })} placeholder={t('info')} autoComplete="off" />
            <span className="ab-hint">{t('One word to find it fast in the search box: letters, digits, dash, underscore or slash.')}</span>
          </div>
          <div className="ab-field">
            <label className="ab-label" htmlFor="ab-snip-body">{t('Text')}</label>
            <textarea id="ab-snip-body" ref={bodyRef} className="ab-textarea ab-compose-text" maxLength={LIMITS.body} value={editor.body} onChange={(e) => setEditor({ ...editor, body: e.target.value })} />
            <span className="ab-hint">{t('{count} of {max} characters', { count: formatNumber(editor.body.length), max: formatNumber(LIMITS.body) })}</span>
          </div>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" aria-expanded={showVars} onClick={() => setShowVars((v) => !v)}>
              {showVars ? t('Hide variables') : t('Variables')}
            </button>
          </div>
          {showVars && (
            <div className="ab-note ab-compose-vars">
              <p>
                {tx('Write {name} where a value should go, for example {example}. Add a fallback after a bar for when there is no value: {fallback}. A variable with no value and no fallback stays visible and is listed, so you can fix it before sending.', {
                  name: <span className="ab-mono">{token('name')}</span>,
                  example: <span className="ab-mono">{token('caller.first_name')}</span>,
                  fallback: <span className="ab-mono">{token('caller.first_name | there')}</span>,
                })}
              </p>
              <ul className="ab-compose-rows">
                {BUILTIN_VARIABLES.map((v) => (
                  <li key={v.name} className="ab-compose-row">
                    <div className="ab-compose-row-text">
                      <span className="ab-mono">{token(v.name)}</span>
                      <span className="ab-sub">{t('{description} (for example {example})', { description: tr(v.description), example: isolate(tr(v.example)) })}</span>
                    </div>
                    <button type="button" className="ab-btn ab-btn-sm" onClick={() => addVariable(v.name)} aria-label={t('Add {name} to the text', { name: isolate(v.name) })}>{t('Add')}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unknown.length > 0 && (
            <p className="ab-note ab-note-warn" role="status">
              {tn(unknown.length, 'Agent Buddy does not know this variable: {list}. Check the spelling, or add a fallback.', 'Agent Buddy does not know these variables: {list}. Check the spelling, or add a fallback.', { list: unknown.map((n) => token(n)).join(', ') })}
            </p>
          )}
          <h4 className="ab-compose-sub">{t('Preview')}</h4>
          <p className="ab-hint">{sourceNote}</p>
          <PreviewBox preview={shown(editor.body)} label={t('Preview of the snippet')} />
          {editError && <p className="ab-note ab-note-danger" role="alert">{editError}</p>}
          <div className="ab-row ab-compose-gap">
            <button type="button" className="ab-btn ab-btn-sm" onClick={save}>{t('Save')}</button>
            <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => { setEditor(null); setEditError(''); }}>{t('Cancel')}</button>
          </div>
        </section>
      </div>
    );
  }

  // ---- the list ----
  const detail = selected ? shown(selected.body) : null;
  const realMissing = selected ? actual(selected.body).missing : [];
  const fromOrg = selected && isOrgSnippet(selected);
  const insertKey = target ? `snippet:${target.field}` : '';
  return (
    <div className="ab-compose-stack" ref={box}>
      <div className="ab-field">
        <label className="ab-label" htmlFor="ab-snip-search">{t('Search')}</label>
        <input id="ab-snip-search" className="ab-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Title, search word or text')} autoComplete="off" />
      </div>
      {!loaded && <p className="ab-sub">{t('Loading…')}</p>}
      {loaded && list.length === 0 && (
        <div className="ab-empty">
          <p className="ab-empty-text">{t('No snippets yet. A snippet is a reply you write once and reuse, with values from the ticket filled in.')}</p>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" onClick={addStarters}>{t('Add three examples')}</button>
            <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" data-snippet-new="" onClick={startNew}>{t('Write my own')}</button>
          </div>
        </div>
      )}
      {loaded && list.length > 0 && results.length === 0 && <p className="ab-sub">{t('Nothing matches "{query}".', { query: isolate(query) })}</p>}
      {results.length > 0 && (
        <ShowMore
          items={results}
          limit={query.trim() ? 5 : 3}
          className="ab-compose-rows"
          render={(s) => (
            <button
              key={s.id}
              type="button"
              data-snippet={s.id}
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
                {s.title} {s.shortcut && <span className="ab-tag">{s.shortcut}</span>} {isOrgSnippet(s) && <span className="ab-tag ab-snip-org">{t('From your organisation')}</span>}
              </span>
              <span className="ab-feature-desc">{firstLine(s.body).slice(0, 90)}</span>
            </button>
          )}
        />
      )}

      {selected && detail && (
        <section className="ab-compose-actions ab-snip-detail" aria-label={t('Snippet: {title}', { title: isolate(selected.title) })}>
          <div className="ab-row ab-compose-head">
            <h3 className="ab-h">{selected.title}</h3>
            <span className="ab-spacer" />
            {key && (
              <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => setPackNonce((n) => n + 1)} disabled={packState.state === 'loading'}>
                {t('Refresh values')}
              </button>
            )}
          </div>
          <p className="ab-hint">{sourceNote}</p>
          <PreviewBox preview={detail} label={t('Snippet as it will be inserted')} />
          {/* what the reader would see: low-severity findings never block, but they are shown */}
          {target?.customerVisible && <ReviewHints hints={hintsFor(target.field, actual(selected.body).text, { people: realPack?.people || [] })} />}

          {askMissing && askMissing.id === selected.id && (
            <div className="ab-note ab-note-warn" role="alert">
              {tx('{heading} If you insert now, these stay as written in the text: {list}.', { heading: <strong>{t('Some values are missing.')}</strong>, list: realMissing.map((n) => token(n)).join(', ') })}
              <div className="ab-row ab-compose-gap">
                <button type="button" className="ab-btn ab-btn-sm" disabled={fill.busy} onClick={() => insertSnippet(selected, true)}>{t('Insert anyway')}</button>
                <button type="button" className="ab-btn ab-btn-sm" onClick={() => setAskMissing(null)}>{t('Cancel')}</button>
              </div>
            </div>
          )}

          <div className="ab-row ab-snip-insert">
            <label className="ab-sub" htmlFor="ab-snip-target">{t('Insert into')}</label>
            <select id="ab-snip-target" className="ab-select ab-compose-select" value={target?.field || ''} onChange={(e) => { setTargetField(e.target.value); clearNotes(); }}>
              {targets.map((item) => (
                <option key={item.field} value={item.field}>{tr(item.label)}</option>
              ))}
            </select>
          </div>
          <div className="ab-row">
            <button
              type="button"
              className="ab-btn ab-btn-sm"
              disabled={!target || (Boolean(key) && packState.state === 'loading') || fill.busy || Boolean(fill.inserted[insertKey])}
              onClick={() => insertSnippet(selected)}
            >
              {fill.inserted[insertKey] ? t('Inserted') : t('Insert')}
            </button>
            <button type="button" className="ab-btn ab-btn-sm" disabled={fill.busy} onClick={() => fill.copy(actual(selected.body).text)}>{t('Copy')}</button>
            {!fromOrg && <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => startEdit(selected)}>{t('Edit')}</button>}
            {!fromOrg &&
              (confirmDelete === selected.id ? (
                <>
                  <span className="ab-sub">{t('Delete this snippet?')}</span>
                  <button type="button" className="ab-btn ab-btn-danger ab-btn-sm" onClick={() => remove(selected.id)}>{t('Yes, delete')}</button>
                  <button type="button" className="ab-btn ab-btn-sm" onClick={() => setConfirmDelete('')}>{t('No')}</button>
                </>
              ) : (
                <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => setConfirmDelete(selected.id)}>{t('Delete')}</button>
              ))}
          </div>
          <FillFeedback fill={fill} />
          <p className="ab-hint">
            {fromOrg ? `${t('From your organisation: it cannot be changed here.')} ` : ''}{t('Insert adds the text below what is in the field. You press Save yourself.')}
          </p>
        </section>
      )}

      {msg && (
        <div className={`ab-note ab-note-${msg.kind}`} role="status">
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

      <div className="ab-row">
        {list.length > 0 && <button type="button" className="ab-btn ab-btn-sm" data-snippet-new="" onClick={startNew}>{t('New snippet')}</button>}
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" aria-expanded={backup} onClick={() => setBackup((v) => !v)}>
          {t('Back up or share')}
        </button>
      </div>
      {backup && (
        <section className="ab-snip-backup" aria-label={t('Back up or share')}>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" disabled={own.length === 0} onClick={saveFile}>{t('Save to a file')}</button>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => fileRef.current?.click()}>{t('Add from a file')}</button>
            <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" disabled={own.length === 0} onClick={copyAll}>{t('Copy as text')}</button>
            <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" aria-expanded={pasteOpen} onClick={() => setPasteOpen((v) => !v)}>{t('Paste instead')}</button>
          </div>
          <input ref={fileRef} id="ab-snip-file" type="file" accept=".json,application/json" aria-label={t('Snippet file to add')} tabIndex={-1} hidden onChange={chooseFile} />
          {pasteOpen && (
            <div className="ab-field">
              <label className="ab-label" htmlFor="ab-snip-import">{t('Paste the snippets here')}</label>
              <textarea id="ab-snip-import" className="ab-textarea ab-compose-text" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"format":"agent-buddy-snippets", ...}' />
              <div className="ab-row">
                <button type="button" className="ab-btn ab-btn-sm" disabled={!importText.trim()} onClick={importPasted}>{t('Add these snippets')}</button>
              </div>
            </div>
          )}
          <span className="ab-hint">{t('Your own snippets only. A snippet that repeats a search word or an existing title and text is skipped; nothing is overwritten.')}</span>
        </section>
      )}
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { read, plainError } from '../ask.js';
import { peopleFromNames } from '../../compose/rewrite.js';

// Suggestions for the fields Notes to ticket never fills itself: caller, category, assignment group (src/compose/notesHints.js). No
// AI: they come from a read with the person's own session, a moment after the proposal is shown (and again on "Look again" after
// the short description was edited). They are only shown; the person picks the values on the form.

const TABLE_OF = (page) => (page.newRecord?.table === 'sn_customerservice_case' || page.newRecord?.kind === 'case' ? 'sn_customerservice_case' : 'incident');

export default function NotesHints({ page, text, names }) {
  const [state, setState] = useState({ phase: 'idle', data: null, error: '', for: '' });
  const token = useRef(0);
  const table = TABLE_OF(page);
  const askFor = `${table}|${text}`;

  async function look() {
    token.current += 1;
    const mine = token.current;
    const listed = peopleFromNames(names).map((p) => p.name);
    setState({ phase: 'reading', data: null, error: '', for: askFor });
    try {
      const data = await read(page.tabId, 'notesHints', { table, text, names: listed });
      if (mine === token.current) setState({ phase: 'ready', data, error: '', for: askFor });
    } catch (err) {
      if (mine === token.current) setState({ phase: 'error', data: null, error: plainError(err, 'The suggestions could not be read.'), for: askFor });
    }
  }

  // Once for each proposal (not on every key press while the short description is edited: "Look again" does that).
  useEffect(() => {
    if (String(text || '').trim()) look();
    return () => {
      token.current += 1;
    };
    // Only the first short description of a proposal starts a read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = state.data;
  const routing = data?.routing;
  const callers = Array.isArray(data?.callers) ? data.callers : [];
  const kind = table === 'incident' ? 'incidents' : 'cases';
  const lines = [];
  for (const c of callers) {
    if (!c.matches?.length) lines.push(`Caller: no active user is named exactly "${c.name}".`);
    else if (c.matches.length === 1) lines.push(`Caller: ${[c.matches[0].name, c.matches[0].department, c.matches[0].email].filter(Boolean).join(' · ')}`);
    else lines.push(`Caller: ${c.matches.length} active users are named "${c.name}" (${c.matches.map((m) => m.department || m.email || '?').join(', ')}). Pick the right one on the form.`);
  }
  if (routing?.category) lines.push(`Category: ${routing.category.name} (${routing.category.count} of ${routing.looked} similar resolved ${kind})`);
  if (routing?.group) lines.push(`Assignment group: ${routing.group.name} (${routing.group.count} of ${routing.looked})`);

  return (
    <div className="ab-write-hints" aria-label="Suggestions for caller, category and group">
      <h4 className="ab-compose-sub">Suggestions to pick on the form</h4>
      {state.phase === 'reading' && <p className="ab-sub" role="status">Looking at similar resolved {kind}…</p>}
      {state.phase === 'error' && <p className="ab-hint">{state.error}</p>}
      {state.phase === 'ready' && lines.length === 0 && <p className="ab-hint">No clear caller, category or group from similar {kind}.</p>}
      {lines.length > 0 && (
        <ul className="ab-compose-list">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <div className="ab-row">
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" disabled={state.phase === 'reading' || !String(text || '').trim()} onClick={look}>
          {state.for && state.for !== askFor ? 'Look again for the new short description' : 'Look again'}
        </button>
      </div>
      <p className="ab-hint">Read with your session, not by AI. Agent Buddy does not fill caller, category or group.</p>
    </div>
  );
}

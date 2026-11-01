import React, { useEffect, useRef, useState } from 'react';
import { read, plainError } from '../ask.js';
import { peopleFromNames } from '../../compose/rewrite.js';
import { isolate, t, tn } from '../../i18n/index.js';

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
      if (mine === token.current) setState({ phase: 'error', data: null, error: plainError(err, t('The suggestions could not be read.')), for: askFor });
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
  const isIncident = table === 'incident';
  const lines = [];
  for (const c of callers) {
    if (!c.matches?.length) lines.push(t('Caller: no active user is named exactly "{name}".', { name: isolate(c.name) }));
    else if (c.matches.length === 1) lines.push(t('Caller: {details}', { details: isolate([c.matches[0].name, c.matches[0].department, c.matches[0].email].filter(Boolean).join(' · ')) }));
    else {
      lines.push(
        tn(c.matches.length, 'Caller: {n} active user is named "{name}" ({where}). Pick the right one on the form.', 'Caller: {n} active users are named "{name}" ({where}). Pick the right one on the form.', {
          name: isolate(c.name),
          where: isolate(c.matches.map((m) => m.department || m.email || '?').join(', ')),
        }),
      );
    }
  }
  if (routing?.category) {
    const params = { name: isolate(routing.category.name), count: routing.category.count, looked: routing.looked };
    lines.push(isIncident ? t('Category: {name} ({count} of {looked} similar resolved incidents)', params) : t('Category: {name} ({count} of {looked} similar resolved cases)', params));
  }
  if (routing?.group) lines.push(t('Assignment group: {name} ({count} of {looked})', { name: isolate(routing.group.name), count: routing.group.count, looked: routing.looked }));

  return (
    <div className="ab-write-hints" aria-label={t('Suggestions for caller, category and group')}>
      <h4 className="ab-compose-sub">{t('Suggestions to pick on the form')}</h4>
      {state.phase === 'reading' && <p className="ab-sub" role="status">{isIncident ? t('Looking at similar resolved incidents…') : t('Looking at similar resolved cases…')}</p>}
      {state.phase === 'error' && <p className="ab-hint">{state.error}</p>}
      {state.phase === 'ready' && lines.length === 0 && <p className="ab-hint">{isIncident ? t('No clear caller, category or group from similar incidents.') : t('No clear caller, category or group from similar cases.')}</p>}
      {lines.length > 0 && (
        <ul className="ab-compose-list">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <div className="ab-row">
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" disabled={state.phase === 'reading' || !String(text || '').trim()} onClick={look}>
          {state.for && state.for !== askFor ? t('Look again for the new short description') : t('Look again')}
        </button>
      </div>
      <p className="ab-hint">{t('Read with your session, not by AI. Agent Buddy does not fill caller, category or group.')}</p>
    </div>
  );
}

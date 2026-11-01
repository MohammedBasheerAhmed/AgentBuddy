import React, { useEffect, useState } from 'react';
import { read } from '../ask.js';

const KINDS = [
  { id: 'mine', label: 'Mine' },
  { id: 'groups', label: 'My groups' },
  { id: 'chosen', label: 'Chosen groups' },
];

function GroupPicker({ tabId, blocked, chosen, myGroups, onAdd }) {
  const [text, setText] = useState('');
  const [found, setFound] = useState({ groups: [], note: '' });

  useEffect(() => {
    const search = text.trim();
    if (search.length < 2) {
      setFound({ groups: [], note: '' });
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(() => {
      read(tabId, 'reportGroups', { search, blocked })
        .then((answer) => alive && setFound(answer))
        .catch((err) => alive && setFound({ groups: [], note: err.message }));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tabId, text, blocked]);

  const free = (list) => list.filter((g) => !chosen.includes(g.id));
  const mine = free(myGroups || []);

  return (
    <div className="ab-picker">
      {mine.length > 0 && (
        <div className="ab-chips" role="group" aria-label="Your groups">
          <span className="ab-hint">Your groups:</span>
          {mine.map((g) => (
            <button key={g.id} type="button" className="ab-chip ab-chip-add" onClick={() => onAdd(g)}>
              Add {g.name}
            </button>
          ))}
        </div>
      )}
      <label className="ab-label" htmlFor="ab-group-search">Find a group by name</label>
      <input id="ab-group-search" className="ab-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type at least two letters" autoComplete="off" />
      {found.note && <p className="ab-hint" role="status">{found.note}</p>}
      {free(found.groups).length > 0 && (
        <ul className="ab-picker-list">
          {free(found.groups).map((g) => (
            <li key={g.id}>
              <button type="button" className="ab-btn ab-btn-sm" onClick={() => onAdd(g)}>
                Add {g.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Whose tickets the dashboard covers, and which tables. Saved with the dashboard (configuration only).
export default function ScopeBar({ scope, tables, selected, context, tabId, blocked, onScope, onTables, canEdit }) {
  const [picking, setPicking] = useState(false);
  const chosen = scope.kind === 'chosen' ? scope.groupIds : [];
  const showPicker = scope.kind === 'chosen' || picking;

  const add = (group) => {
    onScope({ kind: 'chosen', groupIds: [...chosen, group.id], groupNames: { ...(scope.groupNames || {}), [group.id]: group.name } });
    setPicking(false);
  };
  const remove = (id) => {
    if (chosen.length <= 1) return;
    const groupNames = { ...(scope.groupNames || {}) };
    delete groupNames[id];
    onScope({ kind: 'chosen', groupIds: chosen.filter((g) => g !== id), groupNames });
  };
  const pick = (kind) => {
    if (kind === 'chosen') {
      if (scope.kind !== 'chosen') setPicking(true);
      return;
    }
    setPicking(false);
    onScope({ kind });
  };

  const selectedSet = new Set(selected);
  const toggle = (table) => {
    const next = selectedSet.has(table) ? selected.filter((t) => t !== table) : [...selected, table];
    if (next.length) onTables(next);
  };

  return (
    <div className="ab-scope">
      <div className="ab-seg" role="group" aria-label="Whose tickets">
        {KINDS.map((k) => (
          <button key={k.id} type="button" className="ab-btn ab-btn-sm ab-seg-btn" aria-pressed={k.id === 'chosen' ? showPicker : scope.kind === k.id} onClick={() => pick(k.id)} disabled={!canEdit}>
            {k.label}
          </button>
        ))}
      </div>

      {scope.kind === 'groups' && context?.groups?.length > 0 && <p className="ab-hint">Covers: {context.groups.map((g) => g.name).join(', ')}</p>}

      {chosen.length > 0 && (
        <ul className="ab-chips" aria-label="Chosen groups">
          {chosen.map((id) => (
            <li key={id} className="ab-chip">
              <span>{scope.groupNames?.[id] || 'Group'}</span>
              <button type="button" className="ab-chip-x" aria-label={`Remove ${scope.groupNames?.[id] || 'group'}`} onClick={() => remove(id)} disabled={chosen.length <= 1} title={chosen.length <= 1 ? 'Add another group first, or choose Mine' : 'Remove'}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {showPicker && <GroupPicker tabId={tabId} blocked={blocked} chosen={chosen} myGroups={context?.groups} onAdd={add} />}

      <details className="ab-details">
        <summary>Tables: {selected.length ? `${selected.length} of ${tables.filter((t) => t.usable).length} available` : 'none available'}</summary>
        <ul className="ab-table-list">
          {tables.map((t) => (
            <li key={t.table}>
              <label className="ab-check">
                <input type="checkbox" checked={selectedSet.has(t.table)} disabled={!t.usable || !canEdit} onChange={() => toggle(t.table)} />
                <span>
                  {t.label}
                  {!t.usable && <span className="ab-hint"> {t.status === 'denied' ? 'Not available to you' : t.status === 'hidden' ? 'No rows visible to you' : t.status === 'blocked' ? 'Turned off by your organisation' : 'Could not be read'}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

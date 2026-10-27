// The "Check" tab, drawn from buildCheckView() (src/checks/resolutionCheck.js). Pure drawing: no reads, no state.
// Every row says its status in words ("Look at this", "Note", "Fine"); colour only backs it up.
import React from 'react';
import { Tag } from './Bits.jsx';
import { plainNote } from '../plainAccess.js';

const LABEL = { warn: ['Look at this', 'warn'], info: ['Note', ''], ok: ['Fine', 'ok'] };

export function CheckSummary({ summary }) {
  const tone = summary.tone === 'warn' ? 'warn' : summary.tone === 'ok' ? 'ok' : '';
  return <p className={`ab-note${tone ? ` ab-note-${tone}` : ''}`} role="status">{summary.headline}.</p>;
}

export function CheckList({ checks }) {
  return (
    <ul className="ab-chk-list" aria-label="Checks">
      {checks.map((c) => {
        const [word, tone] = LABEL[c.status] || LABEL.info;
        return (
          <li key={c.id} className="ab-chk-item" data-status={c.status}>
            <span className="ab-chk-head">
              <Tag tone={tone}>{word}</Tag> <span className="ab-chk-item-main">{c.title}</span>
            </span>
            {c.hint && <span className="ab-hint">{plainNote(c.hint)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

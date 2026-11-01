// The "Check" tab, drawn from buildCheckView() (src/checks/resolutionCheck.js). Pure drawing: no reads, no state.
// Every row says its status in words ("Look at this", "Note", "Fine"); colour only backs it up.
import React from 'react';
import { Tag } from './Bits.jsx';
import { plainNote } from '../plainAccess.js';
import { t } from '../../i18n/index.js';

const labelFor = (status) => {
  const labels = { warn: [t('Look at this'), 'warn'], info: [t('Note'), ''], ok: [t('Fine'), 'ok'] };
  return labels[status] || labels.info;
};

export function CheckSummary({ summary }) {
  const tone = summary.tone === 'warn' ? 'warn' : summary.tone === 'ok' ? 'ok' : '';
  return <p className={`ab-note${tone ? ` ab-note-${tone}` : ''}`} role="status">{summary.headline}.</p>;
}

export function CheckList({ checks }) {
  return (
    <ul className="ab-chk-list" aria-label={t('Checks')}>
      {checks.map((c) => {
        const [word, tone] = labelFor(c.status);
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

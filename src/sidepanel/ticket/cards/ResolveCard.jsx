import React, { useMemo } from 'react';
import { buildCheckView } from '../../../checks/resolutionCheck.js';
import { fixFor } from '../../../insights/fixes.js';
import { stateBucket } from '../../../insights/order.js';
import { plainNote } from '../../plainAccess.js';
import { ShowMore } from '../../ui/primitives.jsx';
import { Tag } from '../../checks/Bits.jsx';
import { allowSensitiveOf, read } from './data.js';
import { recordKey, useInsight, useReport } from './useInsight.js';
import { CardJump, QuietButton, ReadState } from './bits.jsx';
import { t } from '../../../i18n/index.js';

// N4, "Ready to resolve?": what is worth a second look before the ticket is resolved (notes, close code, did the customer answer,
// open child work, a linked problem or article, personal data in the text, a hold reason). It reads what is typed on the form and
// not saved yet where the page has a form it can read (on a Workspace page: the notes boxes only), and reads again each time the
// card is shown (the agent keeps typing).
// Advice only: nothing is blocked or changed. Each finding points to where it is fixed. (The AI rewrite of the notes is in AI Assist.)

const labelFor = (status) => {
  const labels = { warn: [t('Look at this'), 'warn'], info: [t('Note'), ''], ok: [t('Fine'), 'ok'] };
  return labels[status] || labels.info;
};

// What the checks were made against (buildCheckView's formSource).
const hintFor = (source) => {
  const hints = {
    form: t('Checked against what is on the form now, plus the saved ticket.'),
    boxes: t('Checked the notes typed on this page, plus the saved ticket.'),
    '': t('Checked the saved ticket only: this page has no form Agent Buddy can read.'),
  };
  return hints[source] || hints[''];
};

export default function ResolveCard({ page, eff, record, header, active, setSummary, setAttention, onShowCard }) {
  const ref = { table: record.table, sysId: record.sysId };
  const state = useInsight({
    key: `${recordKey(page, record)}|resolve`,
    load: async () => {
      // A failed facts read must not hide the checks: the saved ticket is still worth checking.
      const [pack, facts] = await Promise.all([
        read(page.tabId, 'pack', { ...ref, feature: 'resolution-check', allowSensitive: allowSensitiveOf(eff) }),
        read(page.tabId, 'resolutionFacts', ref).catch(() => ({ form: null, links: null })),
      ]);
      return { pack, facts, at: Date.now() };
    },
    active,
    maxAgeMs: 15000,
    refreshOnShow: true,
  });
  const data = state.data;
  const view = useMemo(() => (data ? buildCheckView(data.pack, data.facts, { now: data.at }) : null), [data]);
  const warn = view?.summary.warn || 0;
  useReport(setSummary, view ? (warn ? t('{n} to look at', { n: warn }) : view.summary.info ? t('Nothing wrong, a few notes') : t('Looks ready')) : '');
  useReport(setAttention, warn && ['resolved', 'closed'].includes(stateBucket(header?.state)) ? 'warn' : '');

  return (
    <>
      <ReadState state={state} what={t('this ticket')} onRetry={state.reload} />
      {view && (
        <>
          <p className="ab-hint">{hintFor(view.formSource)}</p>
          <ShowMore
            items={view.checks}
            limit={Math.max(3, view.checks.filter((c) => c.status !== 'ok').length)}
            className="ab-chk-list"
            render={(c) => {
              const [word, tone] = labelFor(c.status);
              const fix = fixFor(c);
              return (
                <div key={c.id} className="ab-chk-item" data-status={c.status}>
                  <span className="ab-chk-head">
                    <Tag tone={tone}>{word}</Tag> <span className="ab-chk-item-main">{c.title}</span>
                  </span>
                  {c.hint && <span className="ab-hint">{plainNote(c.hint)}</span>}
                  {fix?.card && <CardJump id={fix.card} label={t('Go to: {label}', { label: fix.label })} onShowCard={onShowCard} />}
                  {fix?.where && <span className="ab-hint ab-ins-where">{fix.where}</span>}
                </div>
              );
            }}
          />
          <div className="ab-ins-foot">
            <QuietButton onClick={state.reload} disabled={state.phase === 'loading'}>
              {t('Check again')}
            </QuietButton>
          </div>
        </>
      )}
    </>
  );
}

import { useMemo } from 'react';
import { buildRequestView } from '../../../checks/requestView.js';
import { chaseLine } from '../../../insights/fixes.js';
import { Facts, Hints, Tag } from '../../checks/Bits.jsx';
import { allowSensitiveOf, read } from './data.js';
import { recordKey, useInsight, useReport } from './useInsight.js';
import { Group, QuietButton, ReadState } from './bits.jsx';
import { t, isolate } from '../../../i18n/index.js';

// N5, request status: who to chase, in one line on top; then what it is waiting for, the due date and SLA, the approvals, the tasks
// and the answers to the request questions (folded). On a catalog task the status is the requested item's. No AI: the message for
// the requester is in AI Assist.

const isNotVisible = (err) => err?.code === 'NOT_FOUND' || err?.code === 'ACCESS_DENIED';

export default function RequestCard({ page, eff, record, header, active, setSummary, setAttention }) {
  const allowSensitive = allowSensitiveOf(eff);
  const state = useInsight({
    key: `${recordKey(page, record)}|request`,
    load: async () => {
      const readPack = (target) => read(page.tabId, 'pack', { table: target.table, sysId: target.sysId, feature: 'request-status', allowSensitive });
      // A catalog task is one step of a requested item: "where is it?" is about the item.
      let target = { table: record.table, sysId: record.sysId, note: '' };
      if (record.kind === 'catalog_task') target = await read(page.tabId, 'requestTarget', { table: record.table, sysId: record.sysId });
      try {
        return { target, pack: await readPack(target) };
      } catch (err) {
        if (target.table === record.table || !isNotVisible(err)) throw err;
        const own = { table: record.table, sysId: record.sysId };
        return { target: { ...own, note: t('You cannot see the requested item this task belongs to. Showing the task on its own.') }, pack: await readPack(own) };
      }
    },
    active,
    maxAgeMs: 60000,
  });
  const data = state.data;
  const view = useMemo(() => (data ? buildRequestView(data.pack, { currentNumber: record.number || header?.number || '' }) : null), [data, record.number, header?.number]);
  const chase = view ? chaseLine(view.status) : null;
  useReport(setSummary, chase ? chase.text : '');
  useReport(setAttention, view && (view.status.state === 'rejected' || view.status.due?.overdue) ? 'warn' : '');

  if (!view) return <ReadState state={state} what={t('the request')} onRetry={state.reload} />;
  const { status, answers, approvals, chain } = view;
  return (
    <>
      <p className={`ab-ins-chase${chase.tone ? ` ab-ins-chase-${chase.tone}` : ''}`}>{chase.text}</p>
      {data.target.note && <p className="ab-note ab-note-warn">{data.target.note}</p>}
      {data.target.table !== record.table && <p className="ab-hint">{t('This task belongs to {number}; the status is for that item.', { number: data.pack.fields?.number ? isolate(data.pack.fields.number) : t('a requested item') })}</p>}
      <p className="ab-ins-line">{status.line}</p>
      <Facts
        tight
        rows={[status.due && { label: t('Due'), value: status.due.overdue ? t('{date} (past due)', { date: status.due.text }) : status.due.text }, status.sla && { label: t('SLA'), value: status.sla.text }].filter(Boolean)}
      />
      {status.caveats.length > 0 && <p className="ab-hint">{status.caveats.join(' ')}</p>}

      {approvals.applicable && (
        <Group title={t('Approvals')} count={approvals.available ? approvals.rows.length : undefined}>
          {!approvals.available && <p className="ab-hint">{t('The approvals could not be read, so they are not shown.')}</p>}
          {approvals.available && !approvals.rows.length && <p className="ab-hint">{t('No approvals are recorded.')}</p>}
          {approvals.rows.map((a, i) => (
            <div key={i} className="ab-ins-kv">
              <span>{a.who}</span>
              <Tag tone={a.tone}>{a.state}</Tag>
            </div>
          ))}
        </Group>
      )}
      {chain.applicable && (
        <Group title={chain.title} count={chain.available ? chain.rows.length : undefined}>
          {!chain.available && <p className="ab-hint">{t('{title} could not be read, so they are not shown.', { title: chain.title })}</p>}
          {chain.available && !chain.rows.length && <p className="ab-hint">{t('None recorded.')}</p>}
          {chain.rows.map((r, i) => (
            <div key={`${r.number}:${i}`} className={`ab-ins-kv${r.current ? ' ab-ins-current' : ''}`}>
              <span>
                <span className="ab-record-number">{r.number}</span> {r.label}
                {r.current ? ` ${t('(this one)')}` : ''}
              </span>
              <span className="ab-ins-kv-side">
                <Tag tone={r.done ? 'ok' : r.open ? '' : 'warn'}>{r.state}</Tag> {r.owner || t('not assigned')}
              </span>
            </div>
          ))}
        </Group>
      )}
      {answers.applicable && (
        <Group title={t('Answers to the request questions')} count={answers.available ? answers.rows.length : undefined}>
          {!answers.available && <p className="ab-hint">{answers.note}</p>}
          {answers.available && !answers.rows.length && <p className="ab-hint">{t('No answers are recorded for this item.')}</p>}
          {answers.rows.length > 0 && <Facts rows={answers.rows.map((r) => ({ label: r.question, value: r.value, hidden: r.hidden }))} />}
          <Hints lines={[answers.available ? answers.note : '']} />
        </Group>
      )}
      <div className="ab-ins-foot">
        <QuietButton onClick={state.reload} disabled={state.phase === 'loading'}>
          {t('Refresh')}
        </QuietButton>
      </div>
    </>
  );
}

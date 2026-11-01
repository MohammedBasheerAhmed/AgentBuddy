import React from 'react';
import { ShowMore } from '../../ui/primitives.jsx';
import { Facts } from '../../checks/Bits.jsx';
import { arrangeChanges } from '../../../insights/changes.js';
import { PRIORITY_ACCOUNT_MARK, isPriorityAccount } from '../../../insights/priorityAccount.js';
import { useRecordRead, useTicketFacts } from './data.js';
import { useReport } from './useInsight.js';
import { Group, ItemLink, Notes, ReadState } from './bits.jsx';

// N28, the account at a glance (customer service cases): the account, its entitlement, product and asset, the account's other cases
// (open first), and changes on the case's configuration item. The no-AI half of the account briefing (AI Assist writes the briefing).
// An account the organisation names in its policy (`priorityAccounts`) is marked "Priority account", with the VIP mark's look, and the
// card's one-line summary starts with it.

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const FINISHED = /closed|resolved|cancel|complete|solved/i;

export default function AccountCard({ page, eff, record, active, setSummary }) {
  const ticket = useTicketFacts({ page, record, eff, active });
  const cases = useRecordRead({ page, record, eff, active, op: 'accountCases' });
  const changes = useRecordRead({ page, record, eff, active, op: 'ciChanges' });
  const f = ticket.data?.pack?.fields || {};
  const list = Array.isArray(cases.data?.cases) ? cases.data.cases : [];
  const open = list.filter((c) => !FINISHED.test(text(c.state)));
  const more = cases.data?.more;
  const arranged = arrangeChanges(changes.data?.items, Date.now());
  const casesKnown = (cases.data?.access || []).some((a) => a?.status === 'ok' || a?.status === 'empty');
  const priority = isPriorityAccount(text(f.account), eff?.policy?.priorityAccounts);
  useReport(
    setSummary,
    [priority ? PRIORITY_ACCOUNT_MARK.text : '', text(f.account), casesKnown ? `${open.length} open case${open.length === 1 ? '' : 's'}${list.length > open.length ? `, ${list.length - open.length} recent` : ''}` : '', arranged.recent ? `${arranged.recent} recent change${arranged.recent === 1 ? '' : 's'}` : '']
      .filter(Boolean)
      .join(' · ')
  );

  if (!ticket.data) return <ReadState state={ticket} what="this case" onRetry={ticket.reload} />;
  const rows = [
    {
      label: 'Account',
      value: priority ? (
        <>
          {text(f.account)}{' '}
          <span className="ab-glance-vip" title={PRIORITY_ACCOUNT_MARK.title}>
            {PRIORITY_ACCOUNT_MARK.text}
          </span>
        </>
      ) : (
        text(f.account)
      ),
    },
    { label: 'Entitlement', value: text(f.entitlement) || 'None on this case' },
    { label: 'Product', value: text(f.product) },
    { label: 'Asset', value: text(f.asset) },
  ].filter((r) => r.value);
  return (
    <>
      {!text(f.account) && <p className="ab-hint">This case has no account.</p>}
      {rows.length > 0 && <Facts tight rows={rows} />}
      <Group title="Other cases of this account" count={casesKnown ? list.length + (Number.isFinite(more) && more > 0 ? more : 0) : undefined} defaultOpen={open.length > 0}>
        <ReadState state={cases} what="the account's cases" onRetry={cases.reload} />
        {list.length > 0 && (
          <ShowMore
            items={[...open, ...list.filter((c) => !open.includes(c))]}
            render={(c, i) => (
              <div key={`${c.number}:${i}`} className="ab-ins-kv">
                <span>
                  <span className="ab-record-number">{c.number}</span> {c.short_description}
                </span>
                <span className="ab-ins-kv-side">{[c.state, c.priority].filter(Boolean).join(' · ')}</span>
              </div>
            )}
          />
        )}
        <Notes access={cases.data?.access} />
        {cases.data?.access?.find((a) => a?.status === 'ok' && a.note) && <p className="ab-hint">{cases.data.access.find((a) => a?.status === 'ok' && a.note).note}</p>}
      </Group>
      <Group title="Recent changes on its configuration item" count={changes.data && (changes.data.access?.[0]?.status === 'ok' || changes.data.access?.[0]?.status === 'empty') ? arranged.items.length : undefined}>
        <ReadState state={changes} what="changes" onRetry={changes.reload} />
        {arranged.items.length > 0 && <ShowMore items={arranged.items} render={(c) => <ItemLink key={c.sysId} page={page} item={c} line={[c.timing.line, c.state].filter(Boolean).join(' · ')} />} />}
        {changes.data?.access?.[0]?.status === 'skipped' && <p className="ab-hint">{changes.data.access[0].note}</p>}
        {changes.data?.access?.[0]?.status === 'empty' && <p className="ab-hint">No change in the last 7 days.</p>}
        <Notes access={changes.data?.access} />
      </Group>
    </>
  );
}

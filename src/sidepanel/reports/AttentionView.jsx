import RecordLink from '../RecordLink.jsx';
import SectionShell from './SectionShell.jsx';
import Foldable from './Foldable.jsx';
import { useSection } from './useSection.js';
import { useMinuteClock } from './hooks.js';
import { ageText, dueText } from './format.js';
import { reasonLabel } from '../../reports/engine/attention.js';
import { placeholderName } from '../../reports/shown.js';
import { t, tn } from '../../i18n/index.js';

// The chip's colour follows how urgent the reason is (the word is always written out: colour is never the only cue).
const TONE = { breached: 'danger', closest: 'warn', approval: 'neutral', reassigned: 'warn', oldest: 'neutral', customer: 'neutral' };

/**
 * The facts after the reason chip on a row's second line: when the SLA ends or how long it has waited, who holds it, its priority, and
 * how many other reasons the ticket has. Pure (`now` is the moment the numbers are shown at).
 */
export function attentionFacts(row, now) {
  const f = row.facts?.[row.reason] || {};
  const out = [];
  if (row.reason === 'breached' || row.reason === 'closest') {
    out.push(dueText({ endMs: f.endMs, breached: f.breached, paused: f.paused, plannedEnd: f.plannedEnd }, now));
    if (!f.breached) out.push(t('{percent}% used', { percent: f.percent ?? 0 }));
  } else if (row.reason === 'approval' || row.reason === 'customer') {
    // How long the TICKET has been open, said as that (the wait itself is not known here): not "7 days old" after "waiting".
    out.push(Number.isFinite(f.ageDays) ? (f.ageDays <= 0 ? t('opened today') : tn(f.ageDays, 'Open {n} day', 'Open {n} days')) : '');
  } else if (row.reason !== 'reassigned') {
    out.push(ageText(f.ageDays));
  }
  out.push(placeholderName(row.owner) || t('Unassigned'), row.priority);
  if (row.more > 0) out.push(tn(row.more, '+{n} more reason', '+{n} more reasons'));
  return out.filter(Boolean);
}

/** What is said under the rows about how many tickets there are, or '' when the rows are all of them. */
export function attentionCount(d) {
  if (d.shown >= d.total && !d.totalAtLeast) return '';
  return d.totalAtLeast ? t('Showing {shown} of at least {total}.', { shown: d.shown, total: d.total }) : t('Showing {shown} of {total}.', { shown: d.shown, total: d.total });
}

/**
 * The tickets that need the lead, for one result (`d` is result.data, with d.available true). Each row opens the ticket in a NEW tab
 * (RecordLink: a "look at this" link, the tab the panel works in stays put). Never "nothing needs attention" unless every source was
 * read in full. `now` is for tests; the panel uses a minute clock so "due in 1 h 20 min" stays right.
 */
export function AttentionBody({ d, env, now }) {
  const clock = useMinuteClock();
  const at = Number.isFinite(now) ? now : clock;
  const count = attentionCount(d);
  return (
    <Foldable id="attention" title={t('Needs attention now')}>
      {!d.complete && <p className="ab-hint">{t('Based on what you can see; some data could not be read.')}</p>}
      {d.rows.length === 0 ? (
        <p className="ab-tlist-empty">{d.complete && d.total === 0 ? t('Nothing needs attention right now.') : t('No ticket stands out in what could be read.')}</p>
      ) : (
        <ul className="ab-tlist" aria-label={t('Needs attention now')}>
          {d.rows.map((row) => (
            <li key={row.sysId} className="ab-tlist-row">
              <span className="ab-tlist-line">
                <RecordLink page={env?.page} item={{ table: row.table, sysId: row.sysId, number: row.number }} className="ab-chart-link ab-tlist-number">
                  {row.number}
                </RecordLink>
                {row.title ? ' ' : null}
                {row.title ? <span className="ab-tlist-title">{row.title}</span> : null}
              </span>
              <span className="ab-tlist-meta">
                <span className={`ab-chip ab-chip-${TONE[row.reason] || 'neutral'}`}>{reasonLabel(row.reason, row.facts?.[row.reason])}</span> {attentionFacts(row, at).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {count && d.rows.length > 0 && <p className="ab-hint">{count}</p>}
    </Foldable>
  );
}

// "What needs me now": the first thing on the Team overview. Composed from what the other sections read (no reads of its own).
export default function AttentionView({ widget, env, tools }) {
  const state = useSection('attention', widget, env);
  const d = state.result?.data;
  const ok = d && d.available !== false;
  return (
    <SectionShell title={t('Needs attention now')} help={t('The tickets that need you most, each with the reason.')} state={state} env={env} widgetId={widget?.id} tools={tools}>
      {ok && <AttentionBody d={d} env={env} />}
    </SectionShell>
  );
}

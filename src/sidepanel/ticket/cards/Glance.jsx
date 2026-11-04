import { useEffect, useRef, useState } from 'react';
import { buildGlance, waitingText } from '../../../insights/glance.js';
import { PRIORITY_ACCOUNT_MARK, isPriorityAccount } from '../../../insights/priorityAccount.js';
import { KNOWN_TABLES } from '../../../mywork/tables.js';
import { needsNow } from '../needsNow.js';
import NeedsNow from '../NeedsNow.jsx';
import { useTicketFacts } from './data.js';
import { t, t as tr } from '../../../i18n/index.js';

// N1, the ticket at the top of the Ticket screen, with no box around it:
//   INC0010001 · Incident
//   VPN keeps disconnecting for Abel Tuter                      (the title, up to two lines)
//   [In Progress] [2 - High] [SLA breached] [VIP]               (chips; a breached SLA is red)
//   Beth Anglin · Network Support · Updated 9 d ago
// then "Needs you now" (src/sidepanel/ticket/needsNow.js: the SLA, a customer waiting, a possible outage and the Insights cards that
// need a look), when there is anything to say. `compact` (the AI Assist half is on show): the number and the title on one line and the
// chips, nothing else.
//
// The header comes from the shell (number, title, state, priority); the rest from the `glance` read, which every Insights card shares.
// It reads again when the shell's header is read again (after a Save the page reloads) and when the panel comes back into view after
// a while, but never more often than every 20 seconds.
//
// props: { page, eff, record, header, headPhase, onShowCard?, active?, compact?, needs? }
//   active: the Ticket screen is on show; needs: { cards: [{ id, title }], reports } (the Insights cards of this record and what they
//   reported) to draw "Needs you now", or null for none

const AGAIN_AFTER_MS = 20000;
const BACK_AFTER_MS = 120000;

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** The one line under the chips: who has it (and their group), when it last changed. A customer waiting is said in "Needs you now". */
export function metaLine(g, fields = {}) {
  const waiting = waitingText(g.waiting);
  const bits = g.line3.filter((bit) => bit !== waiting);
  const who = text(fields.assigned_to);
  const group = text(fields.assignment_group);
  if (who && group && bits[0] === who) bits.splice(1, 0, group);
  return bits;
}

export default function Glance({ page, eff, record, header, headPhase, onShowCard, active = true, compact = false, needs = null }) {
  const facts = useTicketFacts({ page, record, eff, active: true, maxAgeMs: AGAIN_AFTER_MS });
  const [now, setNow] = useState(() => Date.now());
  const at = useRef(0);
  at.current = facts.at;
  const reload = useRef(facts.reload);
  reload.current = facts.reload;

  // The clock for "SLA 2h 10m" and "updated 3 h ago": once a minute is enough.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setNow(Date.now()), [facts.at]);

  // A new header read (the shell reads it for every record and again after the page changed): read the facts again if they are old.
  const seenHeader = useRef(header);
  useEffect(() => {
    if (!header || header === seenHeader.current) return;
    seenHeader.current = header;
    if (at.current && Date.now() - at.current > AGAIN_AFTER_MS) reload.current();
  }, [header]);

  // The Ticket screen shown again after a look at another screen (when the shell passes `active`): read again if older than a minute.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current && at.current && Date.now() - at.current > AGAIN_AFTER_MS * 3) reload.current();
    wasActive.current = active;
  }, [active]);

  // Back to the panel after a while (another window, another tab): the ticket may have moved on.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onShow = () => {
      if (document.visibilityState === 'visible' && at.current && Date.now() - at.current > BACK_AFTER_MS) reload.current();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);

  const g = buildGlance({ record, header, headPhase, answer: facts.data, now });
  const fields = facts.data?.pack?.fields || {};
  // N28: a case whose account the organisation names as a priority account (the account comes with the same read; nothing more is read).
  const priorityAccount = isPriorityAccount(fields.account, eff?.policy?.priorityAccounts);
  const kind = KNOWN_TABLES[record.table]?.one;
  const titleClass = `ab-glance-title${g.titleKind === 'text' ? '' : ' ab-muted'}`;
  const chips = [
    ...g.line2.map((bit, i) => ({ key: `${bit.text}:${i}`, text: bit.text, tone: bit.tone || 'neutral' })),
    g.vip && { key: 'vip', text: t('VIP'), tone: 'warn', title: t('The caller is marked VIP in ServiceNow.'), vip: true },
    priorityAccount && { key: 'account', text: PRIORITY_ACCOUNT_MARK.text, tone: 'warn', title: PRIORITY_ACCOUNT_MARK.title, vip: true },
  ].filter(Boolean);
  const meta = compact ? [] : metaLine(g, fields);
  const items = !compact && needs ? needsNow({ glance: g, cards: needs.cards || [], reports: needs.reports || {} }) : [];

  return (
    <>
      <section className={`ab-glance${compact ? ' is-compact' : ''}`} aria-label={t('Ticket at a glance')}>
        <div className="ab-glance-head">
          {compact ? (
            <h2 className={`${titleClass} ab-glance-oneline`} title={g.titleKind === 'text' ? `${g.number} · ${g.title}` : undefined}>
              <span className="ab-record-number">{g.number}</span> <span className="ab-glance-dot" aria-hidden="true">·</span> {g.title}
            </h2>
          ) : (
            <>
              <p className="ab-glance-id">
                <span className="ab-record-number">{g.number}</span>
                {kind && <span className="ab-glance-kind"> · {tr(kind)}</span>}
              </p>
              <h2 className={titleClass} title={g.titleKind === 'text' ? g.title : undefined}>
                {g.title}
              </h2>
            </>
          )}
        </div>
        {chips.length > 0 && (
          <p className="ab-glance-line ab-chips ab-glance-chips">
            {chips.map((c) => (
              <span key={c.key} className={`ab-chip ab-chip-${c.tone}${c.vip ? ' ab-glance-vip' : ''}`} title={c.title}>
                {c.text}
              </span>
            ))}
          </p>
        )}
        {meta.length > 0 && (
          <p className="ab-glance-line ab-glance-soft">
            {meta.map((bit, i) => (
              <span key={`${bit}:${i}`} className="ab-glance-bit">
                {bit}
              </span>
            ))}
          </p>
        )}
      </section>
      {items.length > 0 && <NeedsNow items={items} onShowCard={onShowCard} />}
    </>
  );
}

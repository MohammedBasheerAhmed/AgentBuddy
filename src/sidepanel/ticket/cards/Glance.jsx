import { useEffect, useRef, useState } from 'react';
import { buildGlance } from '../../../insights/glance.js';
import { PRIORITY_ACCOUNT_MARK, isPriorityAccount } from '../../../insights/priorityAccount.js';
import { useTicketFacts } from './data.js';
import { showCard } from './bits.jsx';
import { t } from '../../../i18n/index.js';

// N1, the ticket at a glance, over both halves of the Ticket screen. Three short lines at most:
//   INC0010001  VPN keeps disconnecting                       [VIP] [Priority account: a case's account the policy names]
//   In Progress · 2 - High · SLA 2h 10m
//   Beth Anglin · Customer waiting 4 d · Updated 3 h ago
// then the outage banner when other open tickets on the same item pile up (N29), then the quick-actions bar (the shell's node).
//
// The header comes from the shell (number, title, state, priority); the rest from the `glance` read, which every Insights card shares.
// It reads again when the shell's header is read again (after a Save the page reloads) and when the panel comes back into view after
// a while, but never more often than every 20 seconds.
//
// props: { page, eff, record, header, headPhase, quickBar, onShowCard?, active? } (active: the Ticket screen is on show)

const AGAIN_AFTER_MS = 20000;
const BACK_AFTER_MS = 120000;

export default function Glance({ page, eff, record, header, headPhase, quickBar = null, onShowCard, active = true }) {
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
  // N28: a case whose account the organisation names as a priority account (the account comes with the same read; nothing more is read).
  const priorityAccount = isPriorityAccount(facts.data?.pack?.fields?.account, eff?.policy?.priorityAccounts);

  return (
    <section className="ab-card ab-glance" aria-label={t('Ticket at a glance')}>
      <div className="ab-glance-line ab-glance-head">
        <span className="ab-record-number">{g.number}</span>
        <span className={`ab-glance-title${g.titleKind === 'text' ? '' : ' ab-muted'}`} title={g.titleKind === 'text' ? g.title : undefined}>
          {g.title}
        </span>
        {g.vip && (
          <span className="ab-glance-vip" title={t('The caller is marked VIP in ServiceNow.')}>
            {t('VIP')}
          </span>
        )}
        {priorityAccount && (
          <span className="ab-glance-vip" title={PRIORITY_ACCOUNT_MARK.title}>
            {PRIORITY_ACCOUNT_MARK.text}
          </span>
        )}
      </div>
      {g.line2.length > 0 && (
        <p className="ab-glance-line ab-glance-chips">
          {g.line2.map((bit, i) => (
            <span key={`${bit.text}:${i}`} className={`ab-glance-bit${bit.tone ? ` ab-glance-${bit.tone}` : ''}`}>
              {bit.text}
            </span>
          ))}
        </p>
      )}
      {g.line3.length > 0 && (
        <p className="ab-glance-line ab-glance-soft">
          {g.line3.map((bit, i) => (
            <span key={`${bit}:${i}`} className="ab-glance-bit">
              {bit}
            </span>
          ))}
        </p>
      )}
      {g.outage && (
        <button type="button" className="ab-glance-outage" onClick={() => showCard('outage', onShowCard)} title={t('Show the tickets')}>
          <span aria-hidden="true">!</span> {g.outage.line}
        </button>
      )}
      {quickBar}
    </section>
  );
}

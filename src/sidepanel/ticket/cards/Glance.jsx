import { useEffect, useId, useRef, useState } from 'react';
import { buildGlance } from '../../../insights/glance.js';
import { agoText, storedTime } from '../../../insights/time.js';
import { PRIORITY_ACCOUNT_MARK, isPriorityAccount } from '../../../insights/priorityAccount.js';
import { Icon } from '../../ui/icons.jsx';
import { useTicketFacts } from './data.js';
import { isolate, t } from '../../../i18n/index.js';

// N1, the ticket at the top of the Ticket screen, compact, with no box around it (the 2026-11-05 layout: the Insights / AI Assist switch
// comes right under it):
//   INC0010023  Priority 2 - High                                [v]   (the chevron: "Ticket details")
//   Email not syncing on mobile after password change…                 (one line; the whole title on hover)
//   [In Progress] [SLA 1h 20m] [Unassigned] [VIP]                      (chips; a breached SLA is red)
// "Ticket details" opens the other facts: who has it (and the group), the caller, when it was opened and last changed, the service and
// the configuration item. What needs the agent now (the SLA, a customer waiting, a possible outage) is the first rows of Insights.
//
// The header comes from the shell (number, title, state, priority); the rest from the `glance` read, which every Insights card shares.
// It reads again when the shell's header is read again (after a Save the page reloads) and when the panel comes back into view after
// a while, but never more often than every 20 seconds.
//
// props: { page, eff, record, header, headPhase, active? }   active: the Ticket screen is on show

const AGAIN_AFTER_MS = 20000;
const BACK_AFTER_MS = 120000;

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// "Ticket details" open or shut is remembered while the panel stays open (the next ticket shows them the same way); nothing is stored.
let detailsOpen = false;

// The person the ticket is for, by the column the kind uses (the first one that has a name).
const CALLERS = [
  ['caller_id', () => t('Caller')],
  ['requested_for', () => t('Requested for')],
  ['contact', () => t('Contact')],
  ['consumer', () => t('Contact')],
];

/**
 * The facts behind "Ticket details", from the `glance` read's pack: [{ key, label, value }]. People are left out of an HR record (as
 * the owner always was: buildGlance), and a fact the read did not bring is left out, never guessed. Pure.
 */
export function glanceDetails(pack, now) {
  if (!pack || typeof pack !== 'object') return [];
  const f = pack.fields || {};
  const rows = [];
  if (!pack.sensitive) {
    rows.push({ key: 'assigned', label: t('Assigned to'), value: text(f.assigned_to) || t('Nobody yet') });
    if (text(f.assignment_group)) rows.push({ key: 'group', label: t('Group'), value: text(f.assignment_group) });
    const caller = CALLERS.find(([name]) => text(f[name]));
    if (caller) rows.push({ key: 'caller', label: caller[1](), value: text(f[caller[0]]) });
  }
  const opened = storedTime(pack, 'opened_at');
  if (Number.isFinite(opened)) rows.push({ key: 'opened', label: t('Opened'), value: agoText(Math.max(0, now - opened)) });
  const updated = storedTime(pack, 'sys_updated_on');
  if (Number.isFinite(updated)) rows.push({ key: 'updated', label: t('Updated'), value: agoText(Math.max(0, now - updated)) });
  if (text(f.business_service)) rows.push({ key: 'service', label: t('Service'), value: text(f.business_service) });
  if (text(f.cmdb_ci)) rows.push({ key: 'ci', label: t('Configuration item'), value: text(f.cmdb_ci) });
  return rows;
}

/**
 * The chips under the title: the state, the SLA (in its tone), "Unassigned" when nobody is (only from a record that could be read,
 * never on an HR record, whose people are not shown), then the VIP and priority account marks. Pure.
 * @param {{ g: object, state: string, pack: object|null, priorityAccount?: boolean }} input   g: buildGlance's answer
 */
export function glanceChips({ g, state = '', pack = null, priorityAccount = false }) {
  const unassigned = Boolean(pack && !pack.sensitive && !text(pack.fields?.assigned_to));
  return [
    state && { key: 'state', text: state, tone: 'neutral' },
    g?.sla?.text && { key: 'sla', text: g.sla.text, tone: g.sla.tone || 'neutral', icon: 'clock' },
    unassigned && { key: 'unassigned', text: t('Unassigned'), tone: 'warn' },
    g?.vip && { key: 'vip', text: t('VIP'), tone: 'warn', title: t('The caller is marked VIP in ServiceNow.'), vip: true },
    priorityAccount && { key: 'account', text: PRIORITY_ACCOUNT_MARK.text, tone: 'warn', title: PRIORITY_ACCOUNT_MARK.title, vip: true },
  ].filter(Boolean);
}

export default function Glance({ page, eff, record, header, headPhase, active = true }) {
  const facts = useTicketFacts({ page, record, eff, active: true, maxAgeMs: AGAIN_AFTER_MS });
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(detailsOpen);
  const detailsId = `ab-glance-details${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
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
  const pack = facts.data?.pack && typeof facts.data.pack === 'object' ? facts.data.pack : null;
  const fields = pack?.fields || {};
  const state = text(header?.state) || text(fields.state);
  const priority = text(header?.priority) || text(fields.priority);
  // N28: a case whose account the organisation names as a priority account (the account comes with the same read; nothing more is read).
  const priorityAccount = isPriorityAccount(fields.account, eff?.policy?.priorityAccounts);
  const chips = glanceChips({ g, state, pack, priorityAccount });
  const details = glanceDetails(pack, now);
  const titleClass = `ab-glance-title${g.titleKind === 'text' ? '' : ' ab-muted'}`;
  const toggle = () => {
    detailsOpen = !open;
    setOpen(!open);
  };

  return (
    <section className="ab-glance" aria-label={t('Ticket at a glance')}>
      <div className="ab-glance-top">
        <p className="ab-glance-id">
          <span className="ab-record-number">{g.number}</span>
          {priority && <span className="ab-glance-priority">{t('Priority {priority}', { priority: isolate(priority) })}</span>}
        </p>
        {details.length > 0 && (
          <button type="button" className="ab-glance-more" aria-expanded={open} aria-controls={detailsId} aria-label={t('Ticket details')} title={t('Ticket details')} onClick={toggle}>
            <Icon name="chevronDown" size={16} className="ab-chevron" />
          </button>
        )}
      </div>
      <h2 className={titleClass} dir="auto" title={g.titleKind === 'text' ? g.title : undefined}>
        {g.title}
      </h2>
      {chips.length > 0 && (
        <p className="ab-glance-line ab-chips ab-glance-chips">
          {chips.map((c) => (
            <span key={c.key} className={`ab-chip ab-chip-${c.tone}${c.vip ? ' ab-glance-vip' : ''}`} title={c.title} data-chip={c.key}>
              {c.icon && <Icon name={c.icon} size={13} />}
              {c.text}
            </span>
          ))}
        </p>
      )}
      {details.length > 0 && (
        <dl id={detailsId} className="ab-glance-details" hidden={!open}>
          {details.map((d) => (
            <div key={d.key} className="ab-glance-fact" data-fact={d.key}>
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

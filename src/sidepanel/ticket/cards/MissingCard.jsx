import { ShowMore } from '../../ui/primitives.jsx';
import { SHORT, missingDetails } from '../../../insights/missing.js';
import { stateBucket } from '../../../insights/order.js';
import { useTicketFacts } from './data.js';
import { useReport } from './useInsight.js';
import { ReadState } from './bits.jsx';
import { t } from '../../../i18n/index.js';

// N11, missing details: key facts that are empty or vague (configuration item, who else is affected, the error text, a way to reach
// the caller, steps to reproduce), each with why it matters. Plain rules on the `glance` read. The AI "questions to ask" is in AI Assist.

export default function MissingCard({ page, eff, record, header, active, setSummary, setAttention }) {
  const ticket = useTicketFacts({ page, record, eff, active });
  const pack = ticket.data?.pack;
  const result = pack ? missingDetails(pack) : null;
  const n = result?.items.length || 0;
  // Details whose column did not come back with the ticket (a field the user may not read) are not "missing": the card says it could
  // not check them, and is not green while that is so (R-14).
  const unchecked = result?.unchecked || [];
  const couldNot = unchecked.map((id) => SHORT[id] || id).join(t(', '));
  useReport(setSummary, result ? (n ? t('{n} to ask about: {list}', { n, list: `${result.items.slice(0, 2).map((i) => i.short).join(t(', '))}${n > 2 ? '…' : ''}` }) : unchecked.length ? t('Nothing obvious missing; could not check {list}', { list: couldNot }) : t('Nothing obvious missing')) : '');
  useReport(setAttention, n >= 2 && stateBucket(header, record) === 'new' ? 'warn' : result && !n && !unchecked.length ? 'clear' : '');

  if (!result) return <ReadState state={ticket} what={t('this ticket')} onRetry={ticket.reload} />;
  return (
    <>
      {!result.textRead && <p className="ab-hint">{t('The text of this ticket is not read (it is sensitive), so only its fields are checked.')}</p>}
      {!n && !unchecked.length && <p className="ab-hint">{t('The key details are there: a configuration item, a description with the error, who is affected and how to reach them.')}</p>}
      {unchecked.length > 0 && <p className="ab-hint">{t('Could not check: {list}. That part of the ticket is hidden from you.', { list: couldNot })}</p>}
      {n > 0 && (
        <ShowMore
          items={result.items}
          className="ab-chk-list"
          render={(i) => (
            <div key={i.id} className="ab-chk-item">
              <span className="ab-chk-item-main">{i.title}</span>
              <span className="ab-hint">{i.why}</span>
            </div>
          )}
        />
      )}
    </>
  );
}

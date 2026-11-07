import { useMemo } from 'react';
import { buildCheckView, currentCloseCode, readyLine } from '../../../checks/resolutionCheck.js';
import { closeCodeFact, closeCodeVote, closeWellLine, repeatOfCaller } from '../../../insights/closeCode.js';
import { fixFor } from '../../../insights/fixes.js';
import { stateBucket } from '../../../insights/order.js';
import { plainNote } from '../../plainAccess.js';
import RecordLink from '../../RecordLink.jsx';
import { ShowMore } from '../../ui/primitives.jsx';
import { Tag } from '../../checks/Bits.jsx';
import { allowSensitiveOf, read, useHistory, useLookalikes, useTicketFacts } from './data.js';
import { recordKey, useInsight, useReport } from './useInsight.js';
import { CardJump, QuietButton, ReadState } from './bits.jsx';
import { isolate, t } from '../../../i18n/index.js';

// N4, "Ready to resolve?": what is worth a second look before the ticket is resolved (notes, close code, did the customer answer,
// open child work, a linked problem or article, personal data in the text, a hold reason). It reads what is typed on the form and
// not saved yet where the page has a form it can read (on a Workspace page: the notes boxes only), and reads again each time the
// card is shown (the agent keeps typing).
// Advice only: nothing is blocked or changed. Each finding points to where it is fixed. (The AI rewrite of the notes is in AI Assist.)
//
// Round 4 (docs/round4.md), the "Close well" row: two facts more, no AI, from reads the Insights half makes anyway:
//   Close code          "Suggested: Solved (Work Around). 4 of 5 look-alikes used it." (the solved look-alikes' vote; nothing
//                       when there is none; a quiet line when the ticket has that code already)
//   Looks like a repeat "INC0010019 from the same caller is the same issue: link it, or raise a problem if it comes back." with
//                       "Open INC0010019" (a new tab: the ticket being closed is never replaced)
// and the row's line says where the ticket stands: "Not yet: the caller has not confirmed · close code suggested".
// "Prepare to close" (AI Assist) shows the same facts through useCloseWell.

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

// What comes after the notes, for the kinds that are closed by a state and not by a code (F13): the state is the step nobody names.
// (The state's label is the base system's; an instance may have renamed it.)
// (the names are what the form's State list shows, so they go in as data and are not translated: isolate keeps them whole)
const STATE_NAMES = { done: isolate('Closed Complete'), notDone: isolate('Closed Incomplete') };
const nextStep = (kind) =>
  ({
    requested_item: t('When the notes are in, set the state to {done} (or {notDone} if it was not delivered), then press Save.', STATE_NAMES),
    catalog_task: t('When the notes are in, set the state to {done} (or {notDone} if it was not delivered), then press Save.', STATE_NAMES),
  })[kind] || '';

/** The resolve check's read (the saved ticket and what is typed on the form), shared by this card and Prepare to close. */
export function useResolveCheck({ page, eff, record, active }) {
  const ref = { table: record?.table, sysId: record?.sysId };
  return useInsight({
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
}

/**
 * Everything the Close well row knows, without AI: the resolve check (`state`, `view`), the close code the solved look-alikes used
 * (`vote`, closeCodeVote) and an earlier ticket of the same caller about the same issue (`repeat`, repeatOfCaller). Each comes from
 * a read the Insights half shares (panel memory), made only while `active`. A read that failed or is not there yet leaves its part
 * out (no vote, no repeat), never "none".
 */
export function useCloseWell({ page, eff, record, active }) {
  const state = useResolveCheck({ page, eff, record, active });
  const looks = useLookalikes({ page, record, eff, active });
  const history = useHistory({ page, record, eff, active });
  const ticket = useTicketFacts({ page, record, eff, active });
  const data = state.data;
  const view = useMemo(() => (data ? buildCheckView(data.pack, data.facts, { now: data.at }) : null), [data]);
  const hits = looks.data && !looks.error ? looks.data.hits : null;
  const vote = useMemo(() => (hits ? closeCodeVote(hits, { current: data ? currentCloseCode(data.pack, data.facts) : '' }) : null), [hits, data]);
  const fields = ticket.data?.pack?.fields || null;
  const past = history.data && !history.error ? history.data : null;
  const pack = ticket.data?.pack || null;
  // (the repeat names the person as the kind does: the same requester, the same employee, F11)
  const repeat = useMemo(() => (fields && past ? repeatOfCaller(fields, past, pack) : null), [fields, past, pack]);
  return { state, view, vote, repeat };
}

/** The two facts (close code, repeat): a short list, or nothing when there is neither. */
export function CloseFacts({ page, vote, repeat }) {
  const code = closeCodeFact(vote);
  if (!code && !repeat) return null;
  return (
    <ul className="ab-close-facts">
      {code && (
        <li className={`ab-close-fact${vote.matchesCurrent === true ? ' is-quiet' : ''}`} data-fact="code">
          <span className="ab-close-fact-k">{t('Close code')}</span>
          <span className="ab-close-fact-v">{code}</span>
        </li>
      )}
      {repeat && (
        <li className="ab-close-fact" data-fact="repeat">
          <span className="ab-close-fact-k">{t('Looks like a repeat')}</span>
          <span className="ab-close-fact-v">{repeat.line}</span>
          {repeat.sysId && (
            <RecordLink page={page} item={{ table: repeat.table, sysId: repeat.sysId }} newTab className="ab-btn ab-btn-sm ab-close-open">
              {t('Open {number}', { number: repeat.number })}
            </RecordLink>
          )}
        </li>
      )}
    </ul>
  );
}

export default function ResolveCard({ page, eff, record, header, active, setSummary, setAttention, onShowCard }) {
  const { state, view, vote, repeat } = useCloseWell({ page, eff, record, active });
  const warn = view?.summary.warn || 0;
  useReport(setSummary, view ? closeWellLine({ ready: readyLine(view), vote, repeat }) : '');
  useReport(setAttention, warn && ['resolved', 'closed'].includes(stateBucket(header, record)) ? 'warn' : '');

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
              const fix = fixFor(c, view.kind);
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
          <CloseFacts page={page} vote={vote} repeat={repeat} />
          {nextStep(view.kind) && <p className="ab-hint ab-close-next">{nextStep(view.kind)}</p>}
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

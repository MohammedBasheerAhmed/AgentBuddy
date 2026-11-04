import { useEffect, useMemo, useRef, useState } from 'react';
import { read } from '../ask.js';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { headerPhase } from '../recordHeader.js';
import { aiNeedsText, isAiReady } from '../aiReady.js';
import { launchIsForPage } from '../../lib/launch.js';
import { QUICK_CARDS, isQuickCard } from '../../features/quick.js';
import { aiAvailable, aiOffByPolicy } from '../../profiles/profiles.js';
import { HalfPanel, HalfRule, HalfSwitch } from '../ui/primitives.jsx';
import { ModelSwitch, ProfileHint, useHalf } from '../shell/shellParts.jsx';
import { Glance, INSIGHT_CARDS } from './cards/index.js';
import { QuickBar } from './assist/actions/index.js';
import { nextStep, offeredFeatures } from './assist/actions/plan.js';
import { useAnswers } from './assist/answers/index.js';
import { useCardReports } from './cardReports.js';
import NextStep from './NextStep.jsx';
import TicketInsights, { cardsFor } from './TicketInsights.jsx';
import TicketAssist from './TicketAssist.jsx';
import { t } from '../../i18n/index.js';

export const SAVE_SETTLE_MS = 1500;

/**
 * The Ticket screen for an open record (TRACKER.md 2.1). From the top: the ticket (no box), "Needs you now" when something does, the
 * one main step (the action the ticket's state suggests first) and the quick actions; then the Insights / AI Assist tabs and the two
 * halves. While AI Assist is on show the top shrinks to the number, the title and the chips (AI Assist has its own first step).
 * Owner: the lead; the cards, the actions and the answers plug in (docs/round3.md).
 *
 * The answers belong to the screen, not to a half: an action started from the main step, the quick bar or the bar on the ServiceNow
 * page shows its answer in AI Assist, which comes forward. A half that was opened stays mounted while the other one shows. What the
 * Insights cards report (their one line, their status) is kept here, per record, so "Needs you now" and the Insights rows say the same.
 *
 * props: page (a record page), eff, active (the Ticket screen is on show), launch / onLaunchDone (an action the bar on the
 * ServiceNow page asked for; used once)
 */
export default function TicketView({ page, eff, active = true, launch = null, onLaunchDone = () => {} }) {
  const { record } = page;
  const key = `${record.table}:${record.sysId}`;
  const kind = record.kind || 'other';
  // The header with the record it was read for. What the screen uses is always this record's: on the first draw after the record
  // changed (before its own read has even started) there is no header yet, never the last record's, and a read of another record
  // that answers late (below) is dropped.
  const [head, setHead] = useState(() => ({ key, phase: 'loading', header: null }));
  const { phase, header } = head.key === key ? head : { phase: 'loading', header: null };
  const assist = useAnswers({ page, eff, record });
  const reports = useCardReports(key);
  const aiOn = !aiOffByPolicy(eff);
  const [half, setHalf] = useHalf('ticket', eff);
  const shown = aiOn ? half : 'insights';
  const [visited, setVisited] = useState(() => new Set([shown]));
  const [openCard, setOpenCard] = useState(null); // { id, at }: a request to open one card (from the quick bar)
  const [launchNote, setLaunchNote] = useState('');
  const ready = aiOn && aiAvailable(eff) && isAiReady(eff);

  const choose = (next) => {
    setHalf(next);
    setVisited((v) => (v.has(next) ? v : new Set([...v, next])));
  };
  // Any AI action, wherever it was started, answers in AI Assist.
  const runAi = (feature, options) => {
    if (aiOn) choose('assist');
    return assist.run(feature, options);
  };
  const showCard = (id) => {
    choose('insights');
    setOpenCard({ id, at: Date.now() });
  };

  // The header: read for every record, and again when the screen comes back after a while (the agent may have saved the form in the
  // meantime: new state, priority, owner). The Glance reads its extra facts itself and follows a new header object.
  const lastRead = useRef(0);
  const readHeader = (fresh) => {
    const forKey = key;
    if (fresh) setHead({ key: forKey, phase: 'loading', header: null });
    lastRead.current = Date.now();
    let cancelled = false;
    // An answer lands only while the header is still this record's (the tab may have moved on while it was on its way).
    const land = (next) => !cancelled && setHead((h) => (h.key === forKey ? { key: forKey, ...next } : h));
    read(page.tabId, 'header', { table: record.table, sysId: record.sysId, allowSensitive: Boolean(eff.policy?.allowHrContent) })
      .then((h) => land({ phase: headerPhase(h), header: h }))
      .catch(() => fresh && land({ phase: 'failed', header: null }));
    return () => {
      cancelled = true;
    };
  };
  useEffect(() => {
    setLaunchNote('');
    return readHeader(true);
    // readHeader only reads; the record's identity is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page.tabId, record.table, record.sysId]);
  // (A new record stops a re-read still on its way: the cleanup. The read above has just been made, so none starts here then.)
  useEffect(() => {
    if (active && lastRead.current && Date.now() - lastRead.current > 60000) return readHeader(false);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);
  // Saved on the page (N1): the form reloaded after Save, or a Workspace's Save was pressed (formStamp, src/content/index.js). The
  // header of the SAME record is read again, after a short wait so a Workspace has finished saving; a new record is read above.
  const stamp = useRef({ key, value: page.formStamp });
  useEffect(() => {
    const was = stamp.current;
    stamp.current = { key, value: page.formStamp };
    if (was.key !== key || !was.value || !page.formStamp || was.value === page.formStamp) return undefined;
    let stop = () => {};
    const timer = setTimeout(() => {
      stop = readHeader(false);
    }, SAVE_SETTLE_MS);
    return () => {
      clearTimeout(timer);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page.formStamp]);

  // The bar on the ServiceNow page asked for an action on THIS record: start it exactly as a click in the panel would (same
  // permission, masking, preview and policy). If the record on screen is not the one it named, it waits until it is, or expires.
  const busyRef = useRef(assist.busy);
  busyRef.current = assist.busy;
  useEffect(() => {
    if (!launchIsForPage(launch, page)) return;
    onLaunchDone();
    // An Insights item ('card:ready'): no AI, just bring that card forward.
    if (isQuickCard(launch.featureId)) {
      setLaunchNote('');
      showCard(QUICK_CARDS[launch.featureId].card);
      return;
    }
    // The same list the AI Assist half offers for this record (kind, policy, state, profiles); a refusal by the pipeline (HR,
    // privacy mode) still happens in the run itself, with its audit entry. Right after the record changed its header is not known
    // yet (null: a state rule hides nothing then), never the last record's.
    const feature = offeredFeatures({ record, header, eff }).find((f) => f.id === launch.featureId);
    if (!feature) setLaunchNote(t('That action is not available for this record.'));
    else if (!aiOn) setLaunchNote(t('Your organisation has switched AI Assist off.'));
    else if (!ready) setLaunchNote(aiNeedsText(eff, 'this action') || t('Set up AI Assist in Settings to use this action.'));
    else if (busyRef.current) setLaunchNote(t('An answer is on its way. Choose the action again when it has arrived.'));
    else {
      setLaunchNote('');
      runAi(feature);
    }
    // Only a new request, or the page it names arriving, matters here; the rest is read as it is at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch, page.tabId, key]);

  // The one main step: the action the ticket's state suggests first (the first row of AI Assist, the quick bar's first AI item).
  // Nothing when AI cannot be used now: the note in AI Assist says how to set it up.
  const step = useMemo(() => (ready ? nextStep({ record, header, eff }) : null), [ready, record, header, eff]);
  // While AI Assist is on show the top shrinks: AI Assist starts with its own suggestions, the first of them this same step.
  const compact = shown === 'assist';
  // The Insights cards of this record (their titles and ids), for "Needs you now" to name the card an item came from.
  const cards = cardsFor(INSIGHT_CARDS, record, header, eff).map((c) => ({ id: c.id, title: c.title }));

  return (
    <div className="ab-pane ab-ticket">
      <ErrorBoundary resetKey={key}>
        <Glance page={page} eff={eff} record={record} header={header} headPhase={phase} active={active} compact={compact} onShowCard={showCard} needs={compact ? null : { cards, reports: reports.cards }} />
      </ErrorBoundary>
      {!compact && step && <NextStep feature={step} eff={eff} busy={assist.busy} onRun={(f) => runAi(f)} />}
      {!compact && (
        <ErrorBoundary resetKey={`${key}:quick`}>
          <QuickBar page={page} eff={eff} record={record} header={header} busy={assist.busy} aiReady={ready} exclude={step ? [step.id] : []} onRun={(f) => runAi(f)} onShowCard={showCard} />
        </ErrorBoundary>
      )}
      <ProfileHint kind={kind} eff={eff} />
      {launchNote && <p className="ab-note ab-note-warn" role="status">{launchNote}</p>}

      {aiOn && <HalfSwitch idBase="ab-ticket-half" value={shown} onChange={choose} assistNote={eff.values?.aiSkipped ? t('off') : ''} />}

      <HalfPanel idBase="ab-ticket-half" half="insights" hidden={shown !== 'insights'} switched={Boolean(aiOn)}>
        {(visited.has('insights') || shown === 'insights') && (
          <TicketInsights page={page} eff={eff} record={record} header={header} active={active && shown === 'insights'} openCard={openCard} onShowCard={showCard} reports={reports} />
        )}
        {aiOn && <HalfRule half="insights" />}
      </HalfPanel>
      {aiOn && (
        <HalfPanel idBase="ab-ticket-half" half="assist" hidden={shown !== 'assist'}>
          {(visited.has('assist') || shown === 'assist') && (
            <TicketAssist page={page} eff={eff} record={record} header={header} assist={assist} ready={ready} active={active && shown === 'assist'} onRun={runAi} />
          )}
          {/* At the end, out of the way: where text goes, in one sentence without the address (the check before sending names the
              destination), and the model in use, to switch without opening Settings. */}
          {!eff.values?.aiSkipped && (
            <div className="ab-halfrule-row ab-ticket-foot">
              <HalfRule half="assist" />
              {ready && <ModelSwitch eff={eff} />}
            </div>
          )}
        </HalfPanel>
      )}
    </div>
  );
}

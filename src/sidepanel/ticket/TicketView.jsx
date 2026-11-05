import { useEffect, useRef, useState } from 'react';
import { read } from '../ask.js';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { headerPhase } from '../recordHeader.js';
import { aiNeedsText, isAiReady } from '../aiReady.js';
import { launchIsForPage } from '../../lib/launch.js';
import { QUICK_CARDS, isQuickCard } from '../../features/quick.js';
import { aiAvailable, aiOffByPolicy } from '../../profiles/profiles.js';
import { HalfPanel, HalfRule, HalfSwitch } from '../ui/primitives.jsx';
import { ModelSwitch, ProfileHint, useHalf } from '../shell/shellParts.jsx';
import { useRailPublish } from '../shell/SideRail.jsx';
import { Glance, INSIGHT_CARDS } from './cards/index.js';
import { offeredFeatures, useActionPlan } from './assist/actions/index.js';
import { useAnswers } from './assist/answers/index.js';
import { useCardReports } from './cardReports.js';
import { needsCount } from './needsNow.js';
import { useNeeds } from './useNeeds.js';
import { ALL_INSIGHTS, SUGGESTED, answerAction, assistRail, insightsRail, reveal } from './ticketRail.js';
import TicketInsights, { cardsFor } from './TicketInsights.jsx';
import TicketAssist from './TicketAssist.jsx';
import { t } from '../../i18n/index.js';

export const SAVE_SETTLE_MS = 1500;

/**
 * The Ticket screen for an open record (TRACKER.md 2.1; the 2026-11-05 layout, docs/rail-layout.md A). From the top: the ticket, compact
 * (its number, title and chips; "Ticket details" opens the rest), then straight away the Insights / AI Assist tabs and the two halves.
 * Insights starts with what needs the agent now (the SLA, a customer waiting, a possible outage) and then its cards. The side rail
 * lists everything the half on show offers: every Insights card (a click shows that card alone, with "All insights" to go back), or
 * every AI action this record offers (a click starts it exactly as in AI Assist: preview first). Owner: the lead; the cards, the
 * actions and the answers plug in (docs/round3.md).
 *
 * The answers belong to the screen, not to a half: an action started from the rail or the bar on the ServiceNow page shows its answer
 * in AI Assist, which comes forward. A half that was opened stays mounted while the other one shows. What the Insights cards report
 * (their one line, their status) is kept here, per record, so their rows and the rail say the same.
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
  // The card Insights shows alone ({ key, id, at, from }: `at` changes with every request; `from`: the card that was alone before the
  // person went back to the list). It belongs to its record: another record starts on the list.
  const [view, setView] = useState(() => ({ key, id: null, at: 0, from: null }));
  const [launchNote, setLaunchNote] = useState('');
  const ready = aiOn && aiAvailable(eff) && isAiReady(eff);
  const root = useRef(null);

  // The Insights cards of this record, what needs the agent now (the first rows of Insights, and the number on its tab), and what AI
  // Assist offers (worked out once, for the half and for the rail). The checklist action needs one read to know whether it is offered:
  // made only once AI Assist has been opened, as before the rail (its actions are in the rail only while AI Assist is on show).
  const cards = cardsFor(INSIGHT_CARDS, record, header, eff);
  const cardIds = cards.map((c) => c.id);
  const needs = useNeeds({ page, record, eff, header, headPhase: phase, cards });
  const plan = useActionPlan({ page, eff, record, header, aiReady: ready && (shown === 'assist' || visited.has('assist')) });
  const focus = view.key === key ? view : null;
  const focusId = focus?.id && cardIds.includes(focus.id) ? focus.id : null;

  const choose = (next) => {
    setHalf(next);
    setVisited((v) => (v.has(next) ? v : new Set([...v, next])));
  };
  // Any AI action, wherever it was started, answers in AI Assist.
  const runAi = (feature, options) => {
    if (aiOn) choose('assist');
    return assist.run(feature, options);
  };
  // One card alone in Insights (the rail, the bar on the ServiceNow page, a link in another card). A card this record does not show
  // (a profile without it) leaves Insights on its list.
  const showCard = (id) => {
    choose('insights');
    if (cardIds.includes(id)) setView({ key, id, at: Date.now(), from: null });
  };
  const showAll = () => setView((v) => ({ key, id: null, at: Date.now(), from: v.key === key ? v.id : null }));
  // "Suggested": back to the top of AI Assist (the tabs in view), the focus on its suggestions.
  const toSuggested = () => {
    const box = root.current;
    if (!box) return;
    reveal([...box.children].find((el) => el.classList?.contains('ab-halfswitch')) || box.querySelector('#ab-ticket-half-panel-assist'));
    const heading = box.querySelector('#ab-ticket-half-panel-assist .ab-act-head');
    if (!heading) return;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
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
    // An Insights item ('card:ready'): no AI, just that card, alone in Insights.
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

  // The side rail of the half on show (docs/rail-layout.md A4, A5), arranged as the person chose in Settings > Side rail. An AI action
  // waits while AI cannot be used now or an answer is on its way (AI Assist says why); a click on one is a click in AI Assist.
  const layout = eff.values?.railLayout;
  const aiOff = !ready || assist.busy || Boolean(plan.block);
  const startFromRail = (id) => {
    const item = plan.items.find((it) => it.feature.id === id);
    if (item && !item.reason && ready && !assist.busy) runAi(item.feature);
  };
  const rail =
    shown === 'assist'
      ? {
          title: t('AI Assist'),
          items: assistRail({ items: plan.items, kind, stage: plan.stage, byState: eff.values?.railByState !== false, layout, current: answerAction(assist.answers?.[0]), off: aiOff }).map((it) => ({
            ...it,
            onSelect: it.id === SUGGESTED ? toSuggested : () => startFromRail(it.id),
          })),
        }
      : {
          title: t('Insights'),
          items: insightsRail({ cards, reports: reports.cards, layout, kind, focus: focusId }).map((it) => ({
            ...it,
            onSelect: it.id === ALL_INSIGHTS ? showAll : () => showCard(it.id),
          })),
        };
  useRailPublish('ticket', rail, active);

  return (
    <div className="ab-pane ab-ticket" ref={root}>
      <ErrorBoundary resetKey={key}>
        <Glance page={page} eff={eff} record={record} header={header} headPhase={phase} active={active} />
      </ErrorBoundary>
      <ProfileHint kind={kind} eff={eff} />
      {launchNote && <p className="ab-note ab-note-warn" role="status">{launchNote}</p>}

      {aiOn && <HalfSwitch idBase="ab-ticket-half" value={shown} onChange={choose} assistNote={eff.values?.aiSkipped ? t('off') : ''} count={needsCount({ needs, cards, reports: reports.cards })} />}

      <HalfPanel idBase="ab-ticket-half" half="insights" hidden={shown !== 'insights'} switched={Boolean(aiOn)}>
        {(visited.has('insights') || shown === 'insights') && (
          <TicketInsights page={page} eff={eff} record={record} header={header} active={active && shown === 'insights'} needs={needs} focus={focus} onBack={showAll} onShowCard={showCard} reports={reports} />
        )}
        {aiOn && <HalfRule half="insights" />}
      </HalfPanel>
      {aiOn && (
        <HalfPanel idBase="ab-ticket-half" half="assist" hidden={shown !== 'assist'}>
          {(visited.has('assist') || shown === 'assist') && <TicketAssist page={page} eff={eff} record={record} assist={assist} plan={plan} ready={ready} active={active && shown === 'assist'} onRun={runAi} />}
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

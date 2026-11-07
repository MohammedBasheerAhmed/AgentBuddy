import { useEffect, useMemo, useRef, useState } from 'react';
import { read } from '../ask.js';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { headerPhaseFor, phaseOfError } from '../recordHeader.js';
import { aiNeedsText, isAiReady } from '../aiReady.js';
import { launchIsForPage } from '../../lib/launch.js';
import { aiAvailable, aiOffByPolicy } from '../../profiles/profiles.js';
import { HalfPanel, HalfRule, HalfSwitch } from '../ui/primitives.jsx';
import { ModelSwitch, ProfileHint, useHalf } from '../shell/shellParts.jsx';
import { useRailPublish } from '../shell/SideRail.jsx';
import { shareTicketHeader, useAllTools } from '../palette/allToolsContext.js';
import { Glance, INSIGHT_CARDS } from './cards/index.js';
import { useTicketFacts } from './cards/data.js';
import { recordWithReads, requesterCanRead } from '../../domain/requesterReads.js';
import { offeredFeatures, useActionPlan } from './assist/actions/index.js';
import { forgetAnswers, useAnswers } from './assist/answers/index.js';
import { useClearOnUserChange } from './cards/useInsight.js';
import { useCardReports } from './cardReports.js';
import { groupOfCard, insightGroups, lookCount, readLaunch } from './focusView.js';
import { useNeeds } from './useNeeds.js';
import { ALL_TOOLS, answerAction, assistRail, insightsRail } from './ticketRail.js';
import TicketInsights, { cardsFor } from './TicketInsights.jsx';
import TicketAssist from './TicketAssist.jsx';
import { t } from '../../i18n/index.js';

export const SAVE_SETTLE_MS = 1500;

/**
 * The Ticket screen for an open record (TRACKER.md 2.1; the focus layout, docs/focus-layout.md A). From the top: the ticket, compact
 * (its number, title and chips; "Ticket details" opens the rest), then straight away the Insights / AI Assist tabs and the two halves.
 * Each half shows five things, one per pain point (understand the ticket, find the fix, the same caller, reply, close well):
 * Insights five rows ("Understand the ticket" starts with what needs the agent now: the SLA, a customer waiting, a possible outage),
 * AI Assist five actions. Everything else the record has is one step away in All tools. The side rail (when Settings shows it) lists
 * the five of the half on show and ends with All tools. Owner: the lead; the cards, the actions and the answers plug in.
 *
 * The answers belong to the screen, not to a half: an action started from the rail, All tools or the bar on the ServiceNow page shows
 * its answer in AI Assist, which comes forward. A half that was opened stays mounted while the other one shows. What the Insights
 * cards report (their one line, their status) is kept here, per record, so the rows, the tab and the rail say the same.
 *
 * props: page (a record page), eff, active (the Ticket screen is on show), launch / onLaunchDone (what All tools, a shortcut or the
 * bar on the ServiceNow page asked for: an AI action, a card alone, "Ask about this ticket"; used once)
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
  // A different person signed in (signed out and in again, or an administrator acting as someone): what was read for the one before goes.
  useClearOnUserChange(page, forgetAnswers);
  const assist = useAnswers({ page, eff, record });
  // Can the requester read the comments on this catalog task? ONE boolean from the ticket's own read (the Glance's, joined: no new read), for
  // the wording of the comment choices and their caution (src/lib/fillable.js catalogCommentCaution; src/domain/requesterReads.js). true when the
  // person who opened the task is the requester, false when someone else did, null when it cannot be told or the kind is another: the careful
  // wording then. It travels on the record the answers are drawn for.
  const facts = useTicketFacts({ page, record, eff, active: Boolean(active) && kind === 'catalog_task' });
  const reads = kind === 'catalog_task' ? requesterCanRead(facts.data?.pack) : null;
  const assistRecord = useMemo(() => recordWithReads(record, reads), [record, reads]);
  const reports = useCardReports(key);
  const aiOn = !aiOffByPolicy(eff);
  const [half, setHalf] = useHalf('ticket', eff);
  const shown = aiOn ? half : 'insights';
  const [visited, setVisited] = useState(() => new Set([shown]));
  // What Insights shows ({ key, id, at, from, group }): `id` the card shown alone, or null for the five; `at` changes with every
  // request; `from`: the card that was alone before the person went back; `group`: a row of the five to open and bring into view (the
  // side rail). It belongs to its record: another record starts on the five.
  const [view, setView] = useState(() => ({ key, id: null, at: 0, from: null, group: null }));
  // "Ask about this ticket" asked for ({ key, at }): drawn at the top of AI Assist from then on, for that record.
  const [ask, setAsk] = useState(() => ({ key: null, at: 0 }));
  const [launchNote, setLaunchNote] = useState('');
  const ready = aiOn && aiAvailable(eff) && isAiReady(eff);
  const openAllTools = useAllTools();

  // The Insights cards of this record and its five rows, what needs the agent now (the first rows of "Understand the ticket", and with
  // the cards' reports the number on the Insights tab), and what AI Assist offers (worked out once, for the half and for the rail).
  // The checklist action needs one read to know whether it is offered: made only once AI Assist has been opened.
  const cards = cardsFor(INSIGHT_CARDS, record, header, eff);
  const cardIds = cards.map((c) => c.id);
  // (Only the cards of the five are drawn in the list: a possible outage is said among the facts unless one of them says it.)
  const listed = insightGroups({ cards }).groups.flatMap((g) => g.cards);
  const needs = useNeeds({ page, record, eff, header, headPhase: phase, cards: listed });
  const { groups } = insightGroups({ cards, reports: reports.cards, needs });
  const plan = useActionPlan({ page, eff, record: assistRecord, header, aiReady: ready && (shown === 'assist' || visited.has('assist')) });
  // All tools lists this record's cards and actions beyond the five: it takes the same header (a `when` rule may ask for the priority)
  // and the same actions (one may need a read first: the checklist from the instructions).
  const offeredIds = plan.items.map((it) => it.feature.id).join(',');
  useEffect(() => {
    shareTicketHeader(key, header, offeredIds ? offeredIds.split(',') : []);
  }, [key, header, offeredIds]);
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
  // One card alone in Insights (All tools, the bar on the ServiceNow page, a link in another card). A card this record does not show
  // (a profile without it) leaves Insights on its five.
  const showCard = (id) => {
    choose('insights');
    if (cardIds.includes(id)) setView({ key, id, at: Date.now(), from: null, group: null });
  };
  const showAll = () => setView((v) => ({ key, id: null, at: Date.now(), from: v.key === key ? v.id : null, group: null }));
  // A row of the five (the side rail): open in place, in view, its button focused; a card that was alone goes back to its place.
  const openGroup = (id) => {
    choose('insights');
    setView({ key, id: null, at: Date.now(), from: null, group: id });
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
    // (a failure is said by its cause: only a refusal is "not available to you"; src/sidepanel/recordHeader.js)
    read(page.tabId, 'header', { table: record.table, sysId: record.sysId, allowSensitive: Boolean(eff.policy?.allowHrContent) })
      .then((h) => land({ phase: headerPhaseFor(h, record, eff.policy?.sensitiveTablePrefixes), header: h }))
      .catch((err) => fresh && land({ phase: phaseOfError(err), header: null }));
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

  // All tools, a shortcut or the bar on the ServiceNow page asked for something on THIS record: an AI action starts exactly as a
  // click in the panel would (same permission, masking, preview and policy). If the record on screen is not the one it named, it
  // waits until it is, or expires.
  const busyRef = useRef(assist.busy);
  busyRef.current = assist.busy;
  useEffect(() => {
    if (!launchIsForPage(launch, page)) return;
    onLaunchDone();
    const asked = readLaunch(launch.featureId);
    // An Insights item ('card:ready'): no AI, just that card, alone in Insights.
    if (asked.kind === 'quick') {
      setLaunchNote('');
      showCard(asked.card);
      return;
    }
    // Any Insights card of the record ('show:knownErrors', All tools): that card alone. A card this record does not have is ignored.
    if (asked.kind === 'show') {
      if (!cardIds.includes(asked.card)) return;
      setLaunchNote('');
      showCard(asked.card);
      return;
    }
    // "Ask about this ticket": AI Assist, the question box at its top with the focus in it (it stays for this record). Nothing is
    // sent until the person asks; the same notes as for an action when AI cannot be used.
    if (asked.kind === 'ask') {
      if (!aiOn) setLaunchNote(t('Your organisation has switched AI Assist off.'));
      else if (!ready) setLaunchNote(aiNeedsText(eff, 'this action') || t('Set up AI Assist in Settings to use this action.'));
      else {
        setLaunchNote('');
        choose('assist');
        setAsk({ key, at: Date.now() });
      }
      return;
    }
    // The same list the AI Assist half offers for this record (kind, policy, state, profiles), the five and the rest alike; a refusal
    // by the pipeline (HR, privacy mode) still happens in the run itself, with its audit entry. Right after the record changed its
    // header is not known yet (null: a state rule hides nothing then), never the last record's.
    const feature = offeredFeatures({ record, header, eff }).find((f) => f.id === asked.id);
    if (!feature) setLaunchNote(t('That action is not available for this ticket.'));
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

  // The side rail of the half on show: its five, then All tools (at that half's group). An AI action waits while AI cannot be used now
  // or an answer is on its way (AI Assist says why); a click on one is a click in AI Assist. The shell draws it or not (Settings).
  const aiOff = !ready || assist.busy || Boolean(plan.block);
  const startFromRail = (id) => {
    const item = plan.items.find((it) => it.feature.id === id);
    if (item && !item.reason && ready && !assist.busy) runAi(item.feature);
  };
  const rail =
    shown === 'assist'
      ? {
          title: t('AI Assist'),
          items: assistRail({ five: plan.five, current: answerAction(assist.answers?.[0]), off: aiOff }).map((it) => ({
            ...it,
            onSelect: it.id === ALL_TOOLS ? () => openAllTools('ticket-assist') : () => startFromRail(it.id),
          })),
        }
      : {
          title: t('Insights'),
          items: insightsRail({ groups, current: groupOfCard(groups, focusId)?.id || '' }).map((it) => ({
            ...it,
            onSelect: it.id === ALL_TOOLS ? () => openAllTools('ticket-insights') : () => openGroup(it.id),
          })),
        };
  useRailPublish('ticket', rail, active);

  return (
    <div className="ab-pane ab-ticket">
      <ErrorBoundary resetKey={key}>
        <Glance page={page} eff={eff} record={record} header={header} headPhase={phase} active={active} />
      </ErrorBoundary>
      <ProfileHint kind={kind} eff={eff} />
      {launchNote && <p className="ab-note ab-note-warn" role="status">{launchNote}</p>}

      {aiOn && <HalfSwitch idBase="ab-ticket-half" value={shown} onChange={choose} assistNote={eff.values?.aiSkipped ? t('off') : ''} count={lookCount(groups)} />}

      <HalfPanel idBase="ab-ticket-half" half="insights" hidden={shown !== 'insights'} switched={Boolean(aiOn)}>
        {(visited.has('insights') || shown === 'insights') && (
          <TicketInsights page={page} eff={eff} record={record} header={header} active={active && shown === 'insights'} needs={needs} focus={focus} onBack={showAll} onShowCard={showCard} reports={reports} />
        )}
        {aiOn && <HalfRule half="insights" />}
      </HalfPanel>
      {aiOn && (
        <HalfPanel idBase="ab-ticket-half" half="assist" hidden={shown !== 'assist'}>
          {(visited.has('assist') || shown === 'assist') && (
            <TicketAssist page={page} eff={eff} record={assistRecord} assist={assist} plan={plan} ready={ready} active={active && shown === 'assist'} onRun={runAi} ask={ask.key === key ? ask : null} />
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

import React, { useEffect, useRef, useState } from 'react';
import { read } from '../ask.js';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { headerPhase } from '../recordHeader.js';
import { aiNeedsText, isAiReady } from '../aiReady.js';
import { launchIsForPage } from '../../lib/launch.js';
import { QUICK_CARDS, isQuickCard } from '../../features/quick.js';
import { aiAvailable, aiOffByPolicy } from '../../profiles/profiles.js';
import { HalfPanel, HalfRule, HalfSwitch } from '../ui/primitives.jsx';
import { ModelSwitch, ProfileHint, destinationOf, useHalf } from '../shell/shellParts.jsx';
import { Glance } from './cards/index.js';
import { QuickBar } from './assist/actions/index.js';
import { offeredFeatures } from './assist/actions/plan.js';
import { useAnswers } from './assist/answers/index.js';
import TicketInsights from './TicketInsights.jsx';
import TicketAssist from './TicketAssist.jsx';
import { t } from '../../i18n/index.js';

export const SAVE_SETTLE_MS = 1500;

/**
 * The Ticket screen for an open record (TRACKER.md 2.1): the ticket at a glance (with the quick-actions bar), then the Insights /
 * AI Assist switch and the two halves. Owner: the lead; the cards, the actions and the answers plug in (docs/round3.md).
 *
 * The answers belong to the screen, not to a half: an action started from the quick bar or the bar on the ServiceNow page shows its
 * answer in AI Assist, which comes forward. A half that was opened stays mounted while the other one shows.
 *
 * props: page (a record page), eff, active (the Ticket screen is on show), launch / onLaunchDone (an action the bar on the
 * ServiceNow page asked for; used once)
 */
export default function TicketView({ page, eff, active = true, launch = null, onLaunchDone = () => {} }) {
  const { record } = page;
  const key = `${record.table}:${record.sysId}`;
  const kind = record.kind || 'other';
  const [head, setHead] = useState({ phase: 'loading', header: null });
  const assist = useAnswers({ page, eff, record });
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
    if (fresh) setHead({ phase: 'loading', header: null });
    lastRead.current = Date.now();
    let cancelled = false;
    read(page.tabId, 'header', { table: record.table, sysId: record.sysId })
      .then((h) => !cancelled && setHead({ phase: headerPhase(h), header: h }))
      .catch(() => !cancelled && fresh && setHead({ phase: 'failed', header: null }));
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
  useEffect(() => {
    if (active && lastRead.current && Date.now() - lastRead.current > 60000) return readHeader(false);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
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
    // privacy mode) still happens in the run itself, with its audit entry.
    const feature = offeredFeatures({ record, header: head.header, eff }).find((f) => f.id === launch.featureId);
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

  const quickBar = <QuickBar page={page} eff={eff} record={record} header={head.header} busy={assist.busy} aiReady={ready} onRun={(f) => runAi(f)} onShowCard={showCard} />;

  return (
    <div className="ab-pane ab-ticket">
      <ErrorBoundary resetKey={key}>
        <Glance page={page} eff={eff} record={record} header={head.header} headPhase={head.phase} quickBar={quickBar} active={active} onShowCard={showCard} />
      </ErrorBoundary>
      <ProfileHint kind={kind} eff={eff} />
      {launchNote && <p className="ab-note ab-note-warn" role="status">{launchNote}</p>}

      {aiOn && <HalfSwitch idBase="ab-ticket-half" value={shown} onChange={choose} assistNote={eff.values?.aiSkipped ? 'off' : ''} />}
      {aiOn && (
        <div className="ab-halfrule-row">
          <HalfRule half={shown} destination={destinationOf(eff)} />
          {shown === 'assist' && ready && <ModelSwitch eff={eff} />}
        </div>
      )}

      <HalfPanel idBase="ab-ticket-half" half="insights" hidden={shown !== 'insights'} switched={Boolean(aiOn)}>
        {(visited.has('insights') || shown === 'insights') && (
          <TicketInsights page={page} eff={eff} record={record} header={head.header} active={active && shown === 'insights'} openCard={openCard} onShowCard={showCard} />
        )}
      </HalfPanel>
      {aiOn && (
        <HalfPanel idBase="ab-ticket-half" half="assist" hidden={shown !== 'assist'}>
          {(visited.has('assist') || shown === 'assist') && (
            <TicketAssist page={page} eff={eff} record={record} header={head.header} assist={assist} ready={ready} active={active && shown === 'assist'} onRun={runAi} />
          )}
        </HalfPanel>
      )}
    </div>
  );
}

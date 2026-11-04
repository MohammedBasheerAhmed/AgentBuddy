import { useMemo, useRef, useState } from 'react';
import { read } from '../ask.js';
import { useGroupSearch } from './useGroupSearch.js';
import ErrorNote from '../ErrorNote.jsx';
import Summary from './Summary.jsx';
import { useRun } from '../useRun.js';
import { COACHING_LIMITS, COACHING_REMINDER, buildCoachingPack, checkCoachingAnswer, coachingBlockedBy, formatDay, rangeFromDays } from '../../reports/ai/coaching.js';
import { PER_PERSON_NOTE, flagPerPersonScoring } from '../../reports/ai/scoring.js';
import { AiBlocked, AiButton, AiResult, AiShell, RunProgress, AiKeyLine, featureState, isAiReady } from './aiShared.jsx';
import { isSensitiveReportTable } from '../../reports/engine/constants.js';
import { isolate, t, tn } from '../../i18n/index.js';
import { shown as shownText } from '../../reports/shown.js';

const FEATURE_ID = 'coaching-snapshot';
const DAY = 86400000;
const SAMPLE_CHOICES = [4, 6, 8, 10];

/**
 * Why coaching is not available to this person right now, or '' when it is. The order is the order a person would fix things:
 * the organisation's switch first, then the privacy mode, then blocked fields.
 */
export function coachingGate(eff) {
  const policy = eff.policy;
  const { available } = featureState(FEATURE_ID, policy);
  if (!available) {
    return (policy?.disabledFeatures || []).includes(FEATURE_ID) ? 'off' : 'not-enabled';
  }
  return '';
}

export function coachingNeeds(eff) {
  const mode = eff.values?.piiMode;
  if (mode !== 'strict' && mode !== 'local-only') return t('Coaching needs Strict privacy mode. Change it in Settings.');
  return coachingBlockedBy(eff.policy?.blockedFields) || '';
}

/** The card the tool sits in on a dashboard; none when it is drawn inside the Team screen's AI Assist card (`bare`). */
function Frame({ bare, children }) {
  if (bare) return <div className="ab-coach">{children}</div>;
  return (
    <AiShell title={t('Coaching snapshot')} help={t('A rubric review of a sample of tickets one group resolved, for its team lead.')}>
      {children}
    </AiShell>
  );
}

/** One group: your own groups as choices, or a search by name. Calls `onPick({ id, name })`. */
function OneGroupPicker({ tabId, blocked, myGroups, groupsNote, value, onPick }) {
  const { text, setText, found } = useGroupSearch(tabId, blocked);

  const choice = (g) => (
    <button key={g.id} type="button" className="ab-btn ab-btn-sm ab-seg-btn" aria-pressed={value?.id === g.id} onClick={() => onPick(g)}>
      {g.name}
    </button>
  );

  return (
    <div className="ab-picker">
      {myGroups?.length > 0 ? (
        <div className="ab-chips" role="group" aria-label={t('Your groups')}>
          <span className="ab-hint">{t('Your groups:')}</span>
          {myGroups.map(choice)}
        </div>
      ) : (
        groupsNote && <p className="ab-hint">{shownText(groupsNote)}</p>
      )}
      <label className="ab-label" htmlFor="ab-coach-group-search">{t('Or find a group by name')}</label>
      <input id="ab-coach-group-search" className="ab-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Type at least two letters')} autoComplete="off" />
      {found.note && <p className="ab-hint" role="status">{shownText(found.note)}</p>}
      {found.groups.length > 0 && <div className="ab-chips" role="group" aria-label={t('Groups found')}>{found.groups.map(choice)}</div>}
    </div>
  );
}

/** What the read found and what was picked, in words (numbers and ticket numbers only; no text of any ticket). */
export function CoachingSample({ result, dayLabel }) {
  if (!result) return null;
  if (result.ok === false) return <p className="ab-note ab-note-warn" role="alert">{shownText(result.reason)}</p>;
  const n = result.tickets.length;
  const missingComments = result.tickets.filter((x) => !x.comments.length).length;
  // "3 were picked, spread evenly ...: {numbers}." — the numbers are a code span, so the sentence is cut at the slot, not in the middle of a word.
  const picked = tn(n, '{n} was picked, spread evenly over those days, whoever worked on them: {numbers}.', '{n} were picked, spread evenly over those days, whoever worked on them: {numbers}.').split('{numbers}');
  return (
    <div className="ab-coach-sample">
      {n === 0 ? (
        <p className="ab-note ab-note-warn">{t('No ticket resolved by {name} in these days could be read, so there is nothing to review.', { name: isolate(result.group.name) })}</p>
      ) : (
        <>
          <p className="ab-note ab-note-ok">
            {tn(result.candidates, '{group} resolved {n} ticket {days}.', '{group} resolved {n} tickets {days}.', { group: isolate(result.group.name), days: dayLabel })}{' '}
            {picked[0]}
            <span className="ab-mono">{result.tickets.map((x) => x.number).join(', ')}</span>
            {picked[1]}
          </p>
          <p className="ab-hint">
            {t('For each, Agent Buddy read the close notes, the close code and the customer-visible comments written by agents of this group. Work notes and descriptions were not read.')}
            {missingComments ? ` ${tn(missingComments, '{n} ticket had no such comment.', '{n} tickets had no such comment.')}` : ''}
          </p>
        </>
      )}
      {[...(result.notes || []), ...(result.access || []).map((a) => a.note)].filter(Boolean).map((note) => (
        <p key={note} className="ab-hint">{shownText(note)}</p>
      ))}
    </div>
  );
}

// F6. Opt-in, policy-gated, group-level. See src/reports/ai/coaching.js for what makes it safe to offer.
export default function CoachingView({ env, eff }) {
  const gate = coachingGate(eff);
  const needs = gate ? '' : coachingNeeds(eff);
  if (gate) {
    return (
      <AiShell title={t('Coaching snapshot')} help={t('A rubric review of the written work of a group, for its team lead.')}>
        <AiBlocked>{gate === 'off' ? t('Your organisation has turned the coaching snapshot off.') : t('Your organisation has not switched coaching on.')}</AiBlocked>
      </AiShell>
    );
  }
  return <CoachingTool env={env} eff={eff} needs={needs} />;
}

/**
 * The coaching tool itself (AI30), for a person the gate lets through (coachingGate above: the organisation's coachingEnabled;
 * coachingNeeds: Strict mode and no blocked field it needs). `env` carries { page, tables, blocked, myGroups, groupsNote }.
 */
export function CoachingTool({ env, eff, needs, bare = false }) {
  const run = useRun({ page: env.page, eff, record: null });
  const offset = useMemo(() => new Date().getTimezoneOffset(), []);
  const [group, setGroup] = useState(null);
  const [toDay, setToDay] = useState(() => formatDay(Date.now(), new Date().getTimezoneOffset()));
  const [fromDay, setFromDay] = useState(() => formatDay(Date.now() - 13 * DAY, new Date().getTimezoneOffset()));
  const [size, setSize] = useState(COACHING_LIMITS.sampleDefault);
  const [sample, setSample] = useState({ phase: 'idle', result: null, error: '' });
  // The sample read still wanted: a new question (another group, other days, another size) or a new read makes an older read's
  // answer count for nothing, so a late sample of one group never shows (or goes to the AI) under another.
  const asked = useRef(0);
  const aiReady = isAiReady(eff);
  const { feature } = featureState(FEATURE_ID, eff.policy);

  const range = rangeFromDays(fromDay, toDay, offset);
  const rangeProblem = !range
    ? t('Choose the first and the last day.')
    : range.toMs - range.fromMs > COACHING_LIMITS.rangeDaysMax * DAY
      ? t('Choose at most {days} days.', { days: COACHING_LIMITS.rangeDaysMax })
      : '';
  const dayLabel = t('between {from} and {to}', { from: fromDay, to: toDay });

  // Anything that changes the question makes the sample (and any answer) out of date.
  const invalidate = () => {
    asked.current += 1;
    setSample({ phase: 'idle', result: null, error: '' });
    run.reset();
  };

  async function pick() {
    if (!group || !range || rangeProblem) return;
    asked.current += 1;
    const mine = asked.current;
    run.reset();
    setSample({ phase: 'reading', result: null, error: '' });
    try {
      // HR cases are never coached on: they are not even asked for (the page refuses them too).
      const tables = (env.tables || []).filter((table) => !isSensitiveReportTable(table, eff.policy?.sensitiveTablePrefixes));
      const result = await read(env.page.tabId, 'coachingSample', { groupId: group.id, groupName: group.name, fromMs: range.fromMs, toMs: range.toMs, sample: size, tables, blocked: env.blocked });
      if (mine === asked.current) setSample({ phase: 'ready', result, error: '' });
    } catch (err) {
      if (mine !== asked.current) return;
      setSample({ phase: 'error', result: null, error: err.code === 'SESSION_EXPIRED' ? t('Your ServiceNow session has expired. Log in again, then try again.') : shownText(err.message) || t('The sample could not be read.') });
    }
  }

  const ready = sample.phase === 'ready' && sample.result?.ok !== false && sample.result?.tickets?.length > 0;

  function go() {
    if (!ready || !feature) return;
    const picked = sample.result;
    run.run(feature, {
      // The sample is already on screen: the run builds its pack from it and reads nothing more.
      getPack: async () => {
        const pack = buildCoachingPack(picked, { blockedFields: eff.policy?.blockedFields || [], periodLabel: `${fromDay} to ${toDay}` });
        if (!pack) throw new Error(t('There is nothing to review yet.'));
        return pack;
      },
    });
  }

  const shown = run.phase === 'done' && run.active?.id === FEATURE_ID;
  const verdict = shown ? flagPerPersonScoring(run.result, { people: run.people }) : null;
  const checks = shown ? checkCoachingAnswer(run.result) : null;
  const notice = checks?.missing.length ? [t('The answer is missing: {missing}', { missing: checks.missing.join(' ') })] : [];

  return (
    <Frame bare={bare}>
      <p className="ab-note ab-note-warn ab-coach-reminder">{shownText(COACHING_REMINDER)}</p>
      <details className="ab-details">
        <Summary>{t('What it reads and sends')}</Summary>
        <p className="ab-hint">
        {t("You pick one group and some days. Agent Buddy picks up to {sampleMax} resolved tickets by a fixed rule (evenly over the dates, whoever worked on them), reads only their close notes, close code and the customer-visible comments the group's agents wrote, and asks the AI to rate the writing and to find group-level themes. The AI is told not to name, score or rank people, and its answer is checked for that. Nothing is stored.", { sampleMax: COACHING_LIMITS.sampleMax })}
        </p>
      </details>
      {needs && <p className="ab-note ab-note-warn" role="status">{needs}</p>}

      <fieldset className="ab-fieldset">
        <legend className="ab-label">{t('Group')}</legend>
        <OneGroupPicker
          tabId={env.page.tabId}
          blocked={env.blocked}
          myGroups={env.myGroups}
          groupsNote={env.groupsNote}
          value={group}
          onPick={(g) => {
            setGroup(g);
            invalidate();
          }}
        />
        <p className="ab-hint">{group ? t('Chosen: {name}', { name: isolate(group.name) }) : t('Choose one group.')}</p>
      </fieldset>

      <div className="ab-row ab-coach-controls">
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-coach-from">{t('First day')}</label>
          <input id="ab-coach-from" type="date" className="ab-input" value={fromDay} max={toDay} onChange={(e) => { setFromDay(e.target.value); invalidate(); }} />
        </div>
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-coach-to">{t('Last day')}</label>
          <input id="ab-coach-to" type="date" className="ab-input" value={toDay} min={fromDay} onChange={(e) => { setToDay(e.target.value); invalidate(); }} />
        </div>
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-coach-size">{t('Tickets to review')}</label>
          <select id="ab-coach-size" className="ab-select" value={size} onChange={(e) => { setSize(Number(e.target.value)); invalidate(); }}>
            {SAMPLE_CHOICES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>
      {rangeProblem && <p className="ab-hint">{rangeProblem}</p>}

      <div className="ab-row">
        <button type="button" className="ab-btn ab-btn-sm" disabled={!group || Boolean(rangeProblem) || sample.phase === 'reading' || Boolean(needs)} onClick={pick}>
          {t('Pick the sample')}
        </button>
        <AiButton eff={eff} disabled={!ready || !aiReady || run.busy || Boolean(needs)} onClick={go}>
          {t('Write the coaching snapshot')}
        </AiButton>
      </div>
      {!aiReady && <AiKeyLine eff={eff} />}
      {sample.phase === 'reading' && <p className="ab-note" role="status">{t('Reading the sample with your session…')}</p>}
      {sample.phase === 'error' && <ErrorNote error={sample.error} onRetry={pick} />}
      <CoachingSample result={sample.result} dayLabel={dayLabel} />

      <RunProgress run={run} eff={eff} page={env.page} readingText={t('Getting ready…')} />
      <AiResult
        run={run}
        eff={eff}
        featureId={FEATURE_ID}
        heading={t('Coaching snapshot')}
        notice={notice}
        withhold={verdict?.tripped ? { note: shownText(PER_PERSON_NOTE), findings: verdict.findings } : null}
      />
      {shown && <p className="ab-note ab-coach-reminder">{shownText(COACHING_REMINDER)}</p>}
    </Frame>
  );
}

import { useCallback, useMemo, useState } from 'react';
import ErrorNote from '../ErrorNote.jsx';
import { Icon } from '../ui/icons.jsx';
import { activeProfiles } from '../../profiles/profiles.js';
import { isFeatureEnabled } from '../../policy/policy.js';
import { instanceKey } from '../../reports/dashboards.js';
import { shown } from '../../reports/shown.js';
import { buildWeeklyPack } from '../../reports/weekly/ai.js';
import { exportFileName, tablesToCsv } from '../../reports/exportTables.js';
import { copyText, downloadText } from '../reports/download.js';
import { useDashboards } from '../reports/hooks.js';
import { clock } from '../reports/format.js';
import { modelToTables, modelToText, readFooter, readNotes, siteName, teamModel } from '../reports/weekly/model.js';
import { useWeeklyRead } from '../reports/weekly/useWeeklyRead.js';
import { useOwnEnv } from '../reports/weekly/useOwnEnv.js';
import WeekAi from '../reports/weekly/WeekAi.jsx';
import { Decisions, MissingNote, PdfPage, Tiles, WeekToggle, printHost, usePdfHost } from '../reports/weekly/WeekParts.jsx';
import { t, isolate } from '../../i18n/index.js';

// The weekly report (round 5, docs/round5.md, boards D and E): the week in short, five numbers against the week before, what needs a
// decision, and the PDF, the CSV and the text for an email. Opened from the "Weekly report" button at the top of Team's first screen. It
// counts the same groups the Team screen shows (the active dashboard's scope and ticket types, src/sidepanel/reports/hooks.js), reads
// with the person's own session (src/content/ops/weekly.js, GET only) and stores nothing.
//   onBack()   goes back to Team's first screen
//   page, eff  (optional) the page and the effective settings, as Team has them; when the screen that opens this view does not pass them
//              it finds them itself (useOwnEnv)
// The numbers and the three rule-based decisions never wait for the AI paragraph: with the AI off the report shows everything but it.

const WEEKS = () => [
  { id: 'last', label: t('Last week') },
  { id: 'this', label: t('This week so far') },
];

const scopeWords = (scope, groups) => {
  if (!scope || scope.kind === 'mine') return t('Mine');
  const n = Array.isArray(groups) ? groups.length : scope.groupIds?.length || 0;
  return scope.kind === 'chosen' ? t('Chosen groups ({count})', { count: n }) : t('My groups ({n})', { n });
};

function Back({ onBack, children }) {
  return (
    <button type="button" className="ab-weekly-back" onClick={onBack}>
      <Icon name="chevronLeft" size={14} className="ab-flip" />
      {children}
    </button>
  );
}

function WeeklyReportView({ page, eff, onBack }) {
  const [which, setWhich] = useState('last');
  const [aiText, setAiText] = useState('');
  const [note, setNote] = useState('');
  const host = usePdfHost();
  const lead = activeProfiles(eff).includes('lead');
  const { ready, state } = useDashboards({ instance: instanceKey(page?.href), lead });
  const dash = ready ? state.dashboards.find((d) => d.id === state.activeId) || state.dashboards[0] : null;
  const scopeJson = JSON.stringify(dash?.scope || null);
  const tablesJson = JSON.stringify(dash?.tables || []);
  const blockedJson = JSON.stringify(eff.policy?.blockedTables || []);
  const args = useMemo(() => (page?.tabId && dash ? { which, scope: JSON.parse(scopeJson), tables: JSON.parse(tablesJson), blocked: JSON.parse(blockedJson) } : null), [page?.tabId, dash, which, scopeJson, tablesJson, blockedJson]);
  const read = useWeeklyRead({ tabId: page?.tabId, op: 'weeklyReport', args });
  const result = read.result;
  const data = result?.data;
  const ok = Boolean(data) && data.available !== false;
  const scope = ok ? scopeWords(dash?.scope, result.scope?.groups) : '';
  const model = ok ? teamModel(result, { paragraph: aiText, scope }) : null;
  const onText = useCallback((text) => setAiText(text), []);
  const say = (text) => {
    setNote(text);
    setTimeout(() => setNote(''), 5000);
  };
  const notes = ok ? readNotes(result) : [];

  if (!isFeatureEnabled('reports', eff.policy)) {
    return (
      <div className="ab-weekly">
        <Back onBack={onBack}>{t('Team')}</Back>
        <p className="ab-note">{t('Your organisation has turned reports off.')}</p>
      </div>
    );
  }

  return (
    <div className="ab-weekly" aria-busy={read.busy}>
      <div className="ab-weekly-top">
        <Back onBack={onBack}>{t('Team')}</Back>
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" disabled={read.busy} onClick={read.refresh}>
          {t('Refresh')}
        </button>
      </div>
      <div className="ab-weekly-titlebar">
        <h1 className="ab-weekly-title">{t('Weekly report')}</h1>
        <WeekToggle value={which} onChange={setWhich} options={WEEKS()} label={t('Which week')} />
      </div>
      {model && (
        <p className="ab-weekly-period">
          {[model.period, model.scope, t('read at {time}', { time: clock(result.readAt) })].filter(Boolean).join(' · ')}
        </p>
      )}

      {!ready && <p className="ab-note" role="status">{t('Loading your dashboards…')}</p>}
      {ready && read.busy && !model && <p className="ab-note" role="status">{t('Reading the week…')}</p>}
      {read.phase === 'error' && <ErrorNote error={shown(read.error)} onRetry={read.reload} />}
      {data && data.available === false && <p className="ab-note">{shown(data.reason) || t('The week could not be read.')}</p>}

      {model && (
        <>
          <WeekAi featureId="weekly-summary" page={page} eff={eff} result={result} buildPack={buildWeeklyPack} heading={t('The week in short')} runLabel={t('Write the week in short')} onText={onText} />
          <Tiles tiles={model.tiles} compact />
          {model.tiles.length > 0 && <p className="ab-hint ab-weekly-compared">{t('Compared with {period}.', { period: model.comparedWith })}</p>}
          <MissingNote missing={model.missing} />
          <section className="ab-weekly-section" aria-label={t('Needs a decision')}>
            <h2 className="ab-weekly-h">{t('Needs a decision')}</h2>
            {model.decisions.length > 0 ? <Decisions decisions={model.decisions} /> : <p className="ab-hint">{t('Nothing in the numbers needs a decision this week.')}</p>}
          </section>
          {notes.length > 0 && <p className="ab-hint ab-weekly-notes">{notes.join(' ')}</p>}
          <p className="ab-hint">{t('The closed tickets by area and the oldest open tickets are in the PDF.')}</p>
          <div className="ab-weekly-actions">
            <button type="button" className="ab-btn ab-btn-primary" onClick={() => printHost(host)}>
              {t('Download PDF')}
            </button>
            <button type="button" className="ab-btn" onClick={() => { downloadText(exportFileName(`${model.title} ${model.period}`), tablesToCsv(modelToTables(model))); say(t('CSV saved to your downloads.')); }}>
              {t('Download CSV')}
            </button>
            <button type="button" className="ab-btn" onClick={async () => say((await copyText(modelToText(model))) ? t('Copied. Paste it into your email.') : t('Could not copy. Use Download instead.'))}>
              {t('Copy for email')}
            </button>
          </div>
          <p className="ab-hint ab-weekly-copied" role="status">{note}</p>
          <PdfPage host={host} model={model} kicker={t('{site} · Service Desk', { site: isolate(siteName(page)) })} footer={readFooter(result.readAt)} />
        </>
      )}
    </div>
  );
}

function Standalone({ onBack }) {
  const env = useOwnEnv();
  if (!env.ready) {
    return (
      <div className="ab-weekly">
        <Back onBack={onBack}>{t('Team')}</Back>
        <p className="ab-note" role="status">{t('Open a ServiceNow page to read the weekly report.')}</p>
      </div>
    );
  }
  return <WeeklyReportView page={env.page} eff={env.eff} onBack={onBack} />;
}

export default function WeeklyReport({ onBack, page, eff }) {
  return page && eff ? <WeeklyReportView page={page} eff={eff} onBack={onBack} /> : <Standalone onBack={onBack} />;
}

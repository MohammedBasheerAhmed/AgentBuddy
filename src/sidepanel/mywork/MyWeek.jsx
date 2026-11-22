import { useCallback, useMemo, useState } from 'react';
import ErrorNote from '../ErrorNote.jsx';
import { Icon } from '../ui/icons.jsx';
import { isFeatureEnabled } from '../../policy/policy.js';
import { shown } from '../../reports/shown.js';
import { buildMyWeekPack } from '../../reports/weekly/ai.js';
import { copyText } from '../reports/download.js';
import { mineModel, modelToText, readFooter, readNotes, siteName } from '../reports/weekly/model.js';
import { useWeeklyRead } from '../reports/weekly/useWeeklyRead.js';
import { useOwnEnv } from '../reports/weekly/useOwnEnv.js';
import WeekAi from '../reports/weekly/WeekAi.jsx';
import { Bars, MissingNote, PdfPage, Tiles, WeekToggle, printHost, usePdfHost } from '../reports/weekly/WeekParts.jsx';
import { t, isolate } from '../../i18n/index.js';

// "My week" (round 5, docs/round5.md, board B): the signed-in person's own week in five numbers, where it went, and one line to try. Opened
// from the "My week" row at the foot of My work's first screen. Reads with the person's own session (src/content/ops/weekly.js, GET only);
// nothing is stored; "Share with my lead" only copies text the person pastes where they like; "Download PDF" is the browser's own print.
//   onBack()   goes back to My work's first screen
//   page, eff  (optional) the page and the effective settings, as My work has them; when the screen that opens this view does not pass them
//              it finds them itself (useOwnEnv)
// A number that cannot be read honestly is left out (never shown as zero), and the fold under the numbers says which and why.

const WEEKS = () => [
  { id: 'this', label: t('This week') },
  { id: 'last', label: t('Last week') },
];

function Back({ onBack, children }) {
  return (
    <button type="button" className="ab-weekly-back" onClick={onBack}>
      <Icon name="chevronLeft" size={14} className="ab-flip" />
      {children}
    </button>
  );
}

function MyWeekView({ page, eff, onBack }) {
  const [which, setWhich] = useState('this');
  const [aiText, setAiText] = useState('');
  const [note, setNote] = useState('');
  const host = usePdfHost();
  const args = useMemo(() => (page?.tabId ? { which, blocked: eff.policy?.blockedTables || [] } : null), [page?.tabId, which, eff.policy?.blockedTables]);
  const read = useWeeklyRead({ tabId: page?.tabId, op: 'myWeek', args });
  const result = read.result;
  const data = result?.data;
  const ok = Boolean(data) && data.available !== false;
  const model = ok ? mineModel(result, { paragraph: aiText }) : null;
  const onText = useCallback((text) => setAiText(text), []);
  const say = (text) => {
    setNote(text);
    setTimeout(() => setNote(''), 5000);
  };
  const notes = ok ? readNotes(result) : [];

  if (!isFeatureEnabled('reports', eff.policy)) {
    return (
      <div className="ab-myweek ab-weekly">
        <Back onBack={onBack}>{t('My work')}</Back>
        <p className="ab-note">{t('Your organisation has turned reports off.')}</p>
      </div>
    );
  }

  return (
    <div className="ab-myweek ab-weekly" aria-busy={read.busy}>
      <div className="ab-weekly-top">
        <Back onBack={onBack}>{t('My work')}</Back>
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" disabled={read.busy} onClick={read.refresh}>
          {t('Refresh')}
        </button>
      </div>
      <div className="ab-weekly-titlebar">
        <h1 className="ab-weekly-title">{t('My week')}</h1>
        <WeekToggle value={which} onChange={setWhich} options={WEEKS()} label={t('Which week')} />
      </div>
      {model && <p className="ab-weekly-period">{t('{period}. Only you see this unless you share it.', { period: model.period })}</p>}

      {read.busy && !model && <p className="ab-note" role="status">{t('Reading your week…')}</p>}
      {read.phase === 'error' && <ErrorNote error={shown(read.error)} onRetry={read.reload} />}
      {data && data.available === false && <p className="ab-note">{shown(data.reason) || t('Your week could not be read.')}</p>}

      {model && (
        <>
          <Tiles tiles={model.tiles} />
          <MissingNote missing={model.missing} />
          <Bars areas={model.areas} heading={t('Where your week went')} />
          <WeekAi featureId="my-week-tip" page={page} eff={eff} result={result} buildPack={buildMyWeekPack} heading={t('One thing to try')} runLabel={t('Write one thing to try')} onText={onText} />
          {notes.length > 0 && <p className="ab-hint ab-weekly-notes">{notes.join(' ')}</p>}
          <div className="ab-weekly-actions">
            <button
              type="button"
              className="ab-btn ab-btn-primary"
              onClick={async () => say((await copyText(modelToText(model))) ? t('Copied. Paste it into a message to your lead.') : t('Could not copy. Use Download PDF instead.'))}
            >
              {t('Share with my lead')}
            </button>
            <button type="button" className="ab-btn" onClick={() => printHost(host)}>
              {t('Download PDF')}
            </button>
          </div>
          <p className="ab-hint ab-weekly-copied" role="status">{note}</p>
          <PdfPage host={host} model={model} kicker={isolate(siteName(page))} footer={readFooter(result.readAt)} />
        </>
      )}
    </div>
  );
}

function Standalone({ onBack }) {
  const env = useOwnEnv();
  if (!env.ready) {
    return (
      <div className="ab-myweek ab-weekly">
        <Back onBack={onBack}>{t('My work')}</Back>
        <p className="ab-note" role="status">{t('Open a ServiceNow page to read your week.')}</p>
      </div>
    );
  }
  return <MyWeekView page={env.page} eff={env.eff} onBack={onBack} />;
}

export default function MyWeek({ onBack, page, eff }) {
  return page && eff ? <MyWeekView page={page} eff={eff} onBack={onBack} /> : <Standalone onBack={onBack} />;
}

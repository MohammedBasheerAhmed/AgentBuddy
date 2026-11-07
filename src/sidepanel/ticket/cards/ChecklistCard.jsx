import { useMemo, useState } from 'react';
import { checklistProgress, stepsFromPack } from '../../../checks/checklist.js';
import { answersModel } from '../../../checks/requestView.js';
import { Facts, Hints } from '../../checks/Bits.jsx';
import { ProgressBar, StepList } from '../../checks/ChecklistSteps.jsx';
import { panelChecklistStore } from '../../checks/panelStore.js';
import { allowSensitiveOf, read } from './data.js';
import { readFully, recordKey, useInsight, useReport } from './useInsight.js';
import { Group, QuietButton, ReadState } from './bits.jsx';
import { plainNote } from '../../plainAccess.js';
import { t } from '../../../i18n/index.js';

// N6, the fulfilment checklist of a catalog task or requested item: steps found in the written instructions, ticked off by the agent.
// The ONLY thing kept is which steps are ticked, as short hashes in the browser's session storage next to a salted record hash, never
// the step text (src/checks/checklistStore.js). No AI here: a proposed list is in AI Assist.

export default function ChecklistCard({ page, eff, record, active, setSummary, setAttention }) {
  const store = useMemo(() => panelChecklistStore(), []);
  const allowSensitive = allowSensitiveOf(eff);
  const state = useInsight({
    key: `${recordKey(page, record)}|checklist`,
    load: async () => {
      const readPack = (target) => read(page.tabId, 'pack', { table: target.table, sysId: target.sysId, feature: 'fulfilment-checklist', allowSensitive });
      const own = await readPack(record);
      // A catalog task does not hold the answers to the request questions: its requested item does.
      let parent = null;
      let note = '';
      if (record.kind === 'catalog_task') {
        const target = await read(page.tabId, 'requestTarget', { table: record.table, sysId: record.sysId }).catch(() => null);
        if (target?.table === 'sc_req_item') parent = await readPack(target).catch(() => null);
        note = target?.note || (target && !parent ? t('You cannot see the requested item, so its answers are not included.') : '');
      }
      return { own, parent, note };
    },
    active,
    maxAgeMs: 120000,
  });
  // The ticks are read from the browser when the steps are; a tick made here replaces them.
  const ticks = useInsight({ key: `${recordKey(page, record)}|ticks`, load: () => store.load(record.sysId).catch(() => []), active, maxAgeMs: 0 });
  const [mine, setMine] = useState(null);
  const [message, setMessage] = useState('');
  const data = state.data;
  const done = mine ?? (Array.isArray(ticks.data) ? ticks.data : []);
  const steps = useMemo(() => (data ? stepsFromPack(data.own) : []), [data]);
  const progress = checklistProgress(steps, done);
  const answers = useMemo(() => (data ? answersModel(data.parent || data.own) : null), [data]);
  useReport(setSummary, data ? (steps.length ? progress.text : t('No written steps found')) : '');
  useReport(setAttention, data && !steps.length && readFully(data.access) ? 'clear' : '');

  async function toggle(step, on) {
    const before = done;
    setMessage('');
    setMine(on ? [...before.filter((x) => x !== step.id), step.id] : before.filter((x) => x !== step.id));
    try {
      setMine(await store.set(record.sysId, step.id, on));
    } catch {
      setMine(before);
      setMessage(t('Could not keep that tick on this computer.'));
    }
  }

  async function clearTicks() {
    setMessage('');
    try {
      await store.clear(record.sysId);
      setMine([]);
    } catch {
      setMessage(t('Could not clear the ticks.'));
    }
  }

  if (!data) return <ReadState state={state} what={t('the instructions')} onRetry={state.reload} />;
  return (
    <>
      {data.note && <p className="ab-note ab-note-warn">{plainNote(data.note)}</p>}
      {steps.length > 0 ? (
        <>
          <ProgressBar progress={progress} />
          <StepList steps={steps} done={done} onToggle={toggle} />
          {progress.complete && <p className="ab-note ab-note-ok" role="status">{t('Every step is ticked. Close the task when you are ready.')}</p>}
          <p className="ab-hint">{t('Your ticks are kept in this browser until it closes (not the step text).')}</p>
        </>
      ) : (
        <p className="ab-hint">{t('No steps were found in the written instructions. AI Assist can propose a list.')}</p>
      )}
      {message && <p className="ab-note ab-note-danger" role="alert">{message}</p>}
      {answers?.applicable && answers.available && answers.rows.length > 0 && (
        <Group title={t('Request details')} count={answers.rows.length}>
          <Facts rows={answers.rows.map((r) => ({ label: r.question, value: r.value, hidden: r.hidden }))} />
          <Hints lines={[plainNote(answers.note)]} />
        </Group>
      )}
      <div className="ab-ins-foot">
        {steps.length > 0 && (
          <QuietButton onClick={clearTicks} disabled={!done.length}>
            {t('Clear ticks')}
          </QuietButton>
        )}
        <QuietButton onClick={state.reload} disabled={state.phase === 'loading'}>
          {t('Refresh')}
        </QuietButton>
      </div>
    </>
  );
}

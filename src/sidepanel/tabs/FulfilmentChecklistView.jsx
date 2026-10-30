import { useMemo, useState } from 'react';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import { buildChecklist, checklistProgress, stepsFromPack } from '../../checks/checklist.js';
import { mergeParentPack } from '../../checks/checklistParts.js';
import { answersModel } from '../../checks/requestView.js';
import { read } from '../ask.js';
import { Facts, Hints, LoadNotes, Section } from '../checks/Bits.jsx';
import { ProgressBar, StepList } from '../checks/ChecklistSteps.jsx';
import { panelChecklistStore } from '../checks/panelStore.js';
import { useLoader } from '../checks/useLoader.js';

// G6, fulfilment checklist for a catalog task or a requested item. The steps are worked out on this computer from the written
// instructions (no AI needed); the agent ticks them off. The ONLY thing saved is which steps are ticked, as short hashes next
// to the record's id: never the step text or anything else from the ticket. The optional AI button proposes a cleaner list,
// which lives in this panel only while it is open.
//
// props: { page, eff, record, header, run, aiReady }

const feature = featureById('fulfilment-checklist');

export default function FulfilmentChecklistView({ page, eff, record, run, aiReady, active = true }) {
  const allowSensitive = Boolean(eff.policy?.allowHrContent);
  const store = useMemo(() => panelChecklistStore(), []);
  const readPack = (target) => read(page.tabId, 'pack', { table: target.table, sysId: target.sysId, feature: 'fulfilment-checklist', allowSensitive });

  const [state, reload] = useLoader(async () => {
    const own = await readPack(record);
    // A catalog task does not hold the answers to the request questions: its requested item does.
    let parent = null;
    let note = '';
    if (record.kind === 'catalog_task') {
      const target = await read(page.tabId, 'requestTarget', { table: record.table, sysId: record.sysId }).catch(() => null);
      if (target?.table === 'sc_req_item') parent = await readPack(target).catch(() => null);
      note = target?.note || (target && !parent ? 'You cannot see the requested item, so its answers are not included.' : '');
    }
    const done = await store.load(record.sysId).catch(() => []);
    return { own, parent, note, done };
  }, [page.tabId, record.table, record.sysId, record.kind, allowSensitive], { active });

  const data = state.data;
  // The ticks come from storage with the data; a tick the agent makes replaces them. (RecordView gives each record its own
  // copy of this view, so nothing here carries over from one record to the next.)
  const [ticks, setTicks] = useState({ source: null, value: [] });
  const done = ticks.source === data && data ? ticks.value : data?.done || [];
  const setDone = (value) => setTicks({ source: data, value });
  const [aiSteps, setAiSteps] = useState(null); // the list the agent chose to use instead of the written one (kept in memory only)
  const [message, setMessage] = useState('');

  const written = useMemo(() => (data ? stepsFromPack(data.own) : []), [data]);
  const steps = aiSteps || written;
  const progress = checklistProgress(steps, done);
  const answers = useMemo(() => (data ? answersModel(data.parent || data.own) : null), [data]);

  async function toggle(step, on) {
    const before = done;
    setMessage('');
    setDone(on ? [...before.filter((x) => x !== step.id), step.id] : before.filter((x) => x !== step.id)); // at once; saved after
    try {
      setDone(await store.set(record.sysId, step.id, on));
    } catch {
      setDone(before);
      setMessage('Could not save that tick on this computer.');
    }
  }

  async function clearTicks() {
    setMessage('');
    try {
      await store.clear(record.sysId);
      setDone([]);
    } catch {
      setMessage('Could not clear the ticks.');
    }
  }

  // The AI's answer, as steps. It becomes the checklist only when the agent says so.
  const proposed = useMemo(() => {
    if (run.phase !== 'done' || run.active?.id !== feature?.id || typeof run.result !== 'string') return [];
    return buildChecklist([{ label: 'Proposed', text: run.result }]);
  }, [run.phase, run.active, run.result]);
  const sameAsShown = aiSteps && proposed.length === aiSteps.length && proposed.every((s, i) => s.id === aiSteps[i].id);

  const canPropose = Boolean(feature) && isFeatureAvailable(feature, eff.policy);

  return (
    <>
      <section className="ab-card">
        <div className="ab-row ab-chk-between">
          <h2 className="ab-h ab-chk-h">Fulfilment checklist</h2>
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={reload} disabled={state.phase === 'loading'}>Refresh</button>
        </div>
        <p className="ab-sub">
          {aiSteps ? 'The steps your AI proposed.' : 'Steps found in the written instructions.'} Your ticks are kept on this computer (not the step text).
        </p>
        {data?.note && <p className="ab-note ab-note-warn" role="note">{data.note}</p>}
      </section>

      <LoadNotes state={state} onRetry={reload} />

      {data && (
        <section className="ab-card" aria-label="Checklist">
          {steps.length > 0 ? (
            <>
              <ProgressBar progress={progress} />
              <StepList steps={steps} done={done} onToggle={toggle} />
              {progress.complete && <p className="ab-note ab-note-ok" role="status">Every step is ticked. Close the task when you are ready.</p>}
              <div className="ab-row">
                <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={clearTicks} disabled={done.length === 0}>Clear ticks</button>
                {aiSteps && <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => setAiSteps(null)}>Back to the written steps</button>}
              </div>
            </>
          ) : (
            <p className="ab-hint">
              No steps were found in the written instructions{canPropose ? '. You can ask the AI to propose a list from the instructions and the answers' : ''}.
            </p>
          )}
          {message && <p className="ab-note ab-note-danger" role="alert">{message}</p>}
        </section>
      )}

      {proposed.length > 0 && !sameAsShown && (
        <p className="ab-note" role="status">
          The AI proposed {proposed.length} step{proposed.length === 1 ? '' : 's'}.{' '}
          <button type="button" className="ab-btn ab-btn-sm" onClick={() => setAiSteps(proposed)}>Use this list</button>
        </p>
      )}

      {canPropose && data && (
        <section className="ab-card" aria-label="Propose a checklist">
          <p className="ab-sub">Not happy with the list? The AI can write a cleaner one from the instructions and the answers. You choose whether to use it.</p>
          <div className="ab-row">
            <button type="button" className="ab-btn" disabled={!aiReady || run.busy} onClick={() => run.run(feature, { getPack: async () => mergeParentPack(data.own, data.parent) })}>
              {feature.title}
            </button>
          </div>
          {!aiReady && <p className="ab-hint">Add an AI key in Settings to use this button. The checklist above works without one.</p>}
        </section>
      )}

      {answers?.applicable && answers.available && answers.rows.length > 0 && (
        <Section title="Request details" count={answers.rows.length} defaultOpen={false}>
          <Facts rows={answers.rows.map((r) => ({ label: r.question, value: r.value, hidden: r.hidden }))} />
          <Hints lines={[answers.note]} />
        </Section>
      )}
    </>
  );
}

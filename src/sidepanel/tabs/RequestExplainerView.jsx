import { useMemo } from 'react';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import { buildRequestView } from '../../checks/requestView.js';
import { read } from '../ask.js';
import { LoadNotes } from '../checks/Bits.jsx';
import { RequestBody } from '../checks/RequestBody.jsx';
import { useLoader } from '../checks/useLoader.js';

// A9, "Where is this request?" on a request, a requested item or a catalog task. Everything on this tab is read with the
// person's own session and worked out locally: no AI key is needed and nothing is sent anywhere. The one AI button writes a
// short message for the requester; it goes through the same preview and privacy checks as every other AI action.
//
// props: { page, eff, record, header, run, aiReady }. `run` comes from RecordView, which also shows its preview and result.

const feature = featureById('request-explain');
const isNotVisible = (err) => err?.code === 'NOT_FOUND' || err?.code === 'ACCESS_DENIED';

export default function RequestExplainerView({ page, eff, record, header, run, aiReady }) {
  const allowSensitive = Boolean(eff.policy?.allowHrContent);
  const readPack = (target, spec) => read(page.tabId, 'pack', { table: target.table, sysId: target.sysId, feature: spec, allowSensitive });

  const [state, reload] = useLoader(async () => {
    // A catalog task is one step of a requested item: the question "where is it?" is about the item.
    let target = { table: record.table, sysId: record.sysId, note: '' };
    if (record.kind === 'catalog_task') target = await read(page.tabId, 'requestTarget', { table: record.table, sysId: record.sysId });
    try {
      return { target, pack: await readPack(target, 'request-status') };
    } catch (err) {
      if (target.table === record.table || !isNotVisible(err)) throw err;
      // The item the task belongs to cannot be read by this user: show the task on its own, and say so.
      const own = { table: record.table, sysId: record.sysId };
      return { target: { ...own, note: 'You cannot see the requested item this task belongs to. Showing the task on its own.' }, pack: await readPack(own, 'request-status') };
    }
  }, [page.tabId, record.table, record.sysId, record.kind, allowSensitive]);

  const data = state.data;
  const view = useMemo(() => (data ? buildRequestView(data.pack, { currentNumber: record.number || header?.number || '' }) : null), [data, record.number, header?.number]);
  const canExplain = Boolean(feature) && isFeatureAvailable(feature, eff.policy);

  return (
    <>
      <section className="ab-card">
        <div className="ab-row ab-chk-between">
          <h2 className="ab-h ab-chk-h">Where is this request?</h2>
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={reload} disabled={state.phase === 'loading'}>Refresh</button>
        </div>
        <p className="ab-sub">Found with your own session. Nothing here is sent to an AI.</p>
        {data?.target.note && <p className="ab-note ab-note-warn" role="note">{data.target.note}</p>}
        {data && data.target.table !== record.table && (
          <p className="ab-hint">This task belongs to {data.pack.fields?.number || 'a requested item'}; the status below is for that item.</p>
        )}
      </section>

      <LoadNotes state={state} />
      {view && <RequestBody view={view} />}

      {canExplain && data && (
        <section className="ab-card" aria-label="Message for the requester">
          <h2 className="ab-h ab-chk-h">Tell the requester</h2>
          <p className="ab-sub">Writes a short, friendly status message in plain words. You read it and send it yourself.</p>
          <div className="ab-row">
            <button
              type="button"
              className="ab-btn ab-btn-primary"
              disabled={!aiReady || run.busy}
              onClick={() => run.run(feature, { getPack: () => readPack(data.target, 'request-explain') })}
            >
              {feature.title}
            </button>
          </div>
          {!aiReady && <p className="ab-hint">Add an AI key in Settings to use this button. Everything above works without one.</p>}
        </section>
      )}
    </>
  );
}

import { useMemo } from 'react';
import { contextFor, featureById, isFeatureAvailable } from '../../features/registry.js';
import { buildCheckView, withCurrentNotes } from '../../checks/resolutionCheck.js';
import { read } from '../ask.js';
import { LoadNotes } from '../checks/Bits.jsx';
import { CheckList, CheckSummary } from '../checks/CheckList.jsx';
import { useLoader } from '../checks/useLoader.js';
import { t, t as tr } from '../../i18n/index.js';

// C2, "Check before you resolve". Reads the saved ticket and, where the page has a classic form, what has been typed on it but
// not saved yet (on a Workspace page: the notes boxes only), and lists what is worth a second look. It only advises: nothing is blocked, changed or sent. The optional AI
// button rewrites the notes the agent has started (preview and privacy checks apply as for every AI action).
//
// props: { page, eff, record, header, run, aiReady }

const improve = featureById('resolution-improve');

export default function QualityGateView({ page, eff, record, run, aiReady, active = true }) {
  const allowSensitive = Boolean(eff.policy?.allowHrContent);
  const ref = { table: record.table, sysId: record.sysId };
  // A failed facts read must not hide the checks: the saved ticket is still worth checking.
  const readFacts = () => read(page.tabId, 'resolutionFacts', ref).catch(() => ({ form: null, links: null }));

  const [state, reload] = useLoader(async () => {
    const [pack, facts] = await Promise.all([read(page.tabId, 'pack', { ...ref, feature: 'resolution-check', allowSensitive }), readFacts()]);
    return { pack, facts, at: Date.now() };
  }, [page.tabId, record.table, record.sysId, allowSensitive], { active });

  const data = state.data;
  const view = useMemo(() => (data ? buildCheckView(data.pack, data.facts, { now: data.at }) : null), [data]);
  const canImprove = Boolean(improve) && isFeatureAvailable(improve, eff.policy);

  // The notes typed on the form are read again at the click, so the AI sees what is there now, not what was there when the tab opened.
  const getImprovePack = async () => {
    const [pack, facts] = await Promise.all([read(page.tabId, 'pack', { ...ref, feature: contextFor(improve), allowSensitive }), readFacts()]);
    return withCurrentNotes(pack, facts.form);
  };

  return (
    <>
      <section className="ab-card">
        <div className="ab-row ab-chk-between">
          <h2 className="ab-h ab-chk-h">{t('Check before you resolve')}</h2>
          <button type="button" className="ab-btn ab-btn-sm" onClick={reload} disabled={state.phase === 'loading'}>{t('Check again')}</button>
        </div>
        <p className="ab-sub">{t('Advice only: nothing is blocked or changed. Worked out on this computer; nothing is sent to an AI.')}</p>
        {view && (
          <p className="ab-hint" role="note">
            {view.formSource === 'boxes'
              ? t('Checked the notes typed on this page, plus the saved ticket.')
              : view.usedForm
                ? t('Checked against what is on the form right now, plus the saved ticket.')
                : t('Checked the saved ticket only. This page has no form Agent Buddy can read, so anything you have typed and not saved is not included.')}
          </p>
        )}
      </section>

      <LoadNotes state={state} onRetry={reload} />
      {view && (
        <section className="ab-card" aria-label={t('Results')}>
          <CheckSummary summary={view.summary} />
          <CheckList checks={view.checks} />
        </section>
      )}

      {canImprove && data && (
        <section className="ab-card" aria-label={t('Resolution notes')}>
          <h2 className="ab-h ab-chk-h">{t('Resolution notes')}</h2>
          <p className="ab-sub">{t('Rewrites the notes you have started into cause, fix and verification, using only what the ticket says.')}</p>
          <div className="ab-row">
            <button type="button" className="ab-btn" disabled={!aiReady || run.busy} onClick={() => run.run(improve, { getPack: getImprovePack })}>
              {tr(improve.title)}
            </button>
          </div>
          {!aiReady && <p className="ab-hint">{t('Add an AI key in Settings to use this button. The checks above work without one.')}</p>}
        </section>
      )}
    </>
  );
}

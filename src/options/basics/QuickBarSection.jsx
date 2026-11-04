// Settings, Basics: the quick-actions bar, on the ServiceNow page (pageBar, which the organisation can lock) and at the top of the side
// panel (quickBarOpen). Which actions it holds is chosen in the panel itself.
import { Locked, Status, useSaveSetting } from '../fields.jsx';
import { t } from '../../i18n/index.js';

export function QuickBarSection({ eff, reload }) {
  const v = eff.values;
  const { status, save: change } = useSaveSetting(reload);
  return (
    <section className="ab-section" aria-labelledby="h-quick">
      <h2 className="ab-h" id="h-quick">{t('Quick actions')}</h2>
      <p className="ab-sub">
        {t('A short bar of the main actions for the ticket that is open: at the top of the side panel, and as a small tab on the edge of the ServiceNow page. Choose which actions it holds with Choose in the panel.')}
      </p>
      <label className="ab-check">
        <input id="page-bar" type="checkbox" checked={v.pageBar !== false} disabled={Boolean(eff.locked.pageBar)} onChange={(e) => change({ pageBar: e.target.checked })} />
        <span>{t('Show the bar on ServiceNow pages. A click opens the side panel and starts the action there.')}</span>
      </label>
      <Locked why={eff.locked.pageBar} />
      <label className="ab-check" style={{ marginTop: 6 }}>
        <input id="panel-bar" type="checkbox" checked={v.quickBarOpen !== false} onChange={(e) => change({ quickBarOpen: e.target.checked })} />
        <span>{t('Keep the bar open at the top of the side panel.')}</span>
      </label>
      <Status status={status} />
    </section>
  );
}

// Settings, Basics: the quick-actions bar, on the ServiceNow page (pageBar, which the organisation can lock) and at the top of the side
// panel (quickBarOpen). Which actions it holds is chosen in the panel itself.
import { Locked, SectionHead, Status, Switch, useSaveSetting } from '../fields.jsx';
import { t } from '../../i18n/index.js';

export function QuickBarSection({ eff, reload }) {
  const v = eff.values;
  const { status, save: change } = useSaveSetting(reload);
  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-quick">
      <SectionHead id="h-quick" title={t('Quick actions')}>
        {t('A short bar of the main actions for the ticket that is open: at the top of the side panel, and as a small tab on the edge of the ServiceNow page. Choose which actions it holds with Choose in the panel.')}
      </SectionHead>
      <div className="ab-set-switches">
        <div>
          <Switch id="page-bar" checked={v.pageBar !== false} disabled={Boolean(eff.locked.pageBar)} onChange={(on) => change({ pageBar: on })}>
            {t('Show the bar on ServiceNow pages. A click opens the side panel and starts the action there.')}
          </Switch>
          <Locked why={eff.locked.pageBar} />
        </div>
        <Switch id="panel-bar" checked={v.quickBarOpen !== false} onChange={(on) => change({ quickBarOpen: on })}>
          {t('Keep the bar open at the top of the side panel.')}
        </Switch>
      </div>
      <Status status={status} />
    </section>
  );
}

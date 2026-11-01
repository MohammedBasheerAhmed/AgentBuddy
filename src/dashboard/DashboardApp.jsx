import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useEffective } from '../sidepanel/useEffective.js';
import ReportsDashboard from '../sidepanel/reports/ReportsDashboard.jsx';
import { checkSourceTab, nextSource, parseTabId } from './sourceTab.js';
import { t, tm, t as tr } from '../i18n/index.js';
import { useLanguage } from '../i18n/useLanguage.js';
import { useTheme } from '../ui/useTheme.js';

const MESSAGES = {
  'no-tab': tm('This page needs a ServiceNow tab to read from. Open ServiceNow, open the Agent Buddy side panel, choose Team and press "Open full page".'),
  gone: tm('The ServiceNow tab this dashboard was opened for has been closed. Open ServiceNow again, open the Agent Buddy side panel, choose Team and press "Open full page".'),
  'not-enabled': tm('Agent Buddy cannot reach that ServiceNow tab. Open ServiceNow, make sure Agent Buddy is turned on for it, reload the ServiceNow tab, then press "Check again".'),
};

// The Team dashboard on a page of its own: the same components as the side panel, with room for several columns. It reads
// through the ServiceNow tab it was opened for (the address says which); it has no connection of its own to the instance.
export default function DashboardApp() {
  const eff = useEffective();
  const lang = useLanguage(eff.values?.language);
  useTheme(eff.values?.theme);
  const tabId = useMemo(() => parseTabId(window.location.search), []);
  const [source, setSource] = useState({ status: 'checking' });

  // A dashboard that is showing stays while the ServiceNow tab loads its next page (nextSource), so its widgets do not start over.
  const check = useCallback(async () => {
    const checked = await checkSourceTab(tabId, chrome);
    setSource((previous) => nextSource(previous, checked));
  }, [tabId]);

  useEffect(() => {
    document.title = t('Agent Buddy team dashboard');
    check();
  }, [check]);

  // Follow the ServiceNow tab: closed, or moved to another page of the instance.
  useEffect(() => {
    if (!tabId) return undefined;
    const onRemoved = (id) => id === tabId && setSource({ status: 'gone' });
    const onUpdated = (id, info) => id === tabId && (info.url || info.status === 'complete') && check();
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [tabId, check]);

  let origin = '';
  try {
    origin = source.page ? new URL(source.page.href).host : '';
  } catch {
    /* no address */
  }

  return (
    <main className="ab-dashboard-page" key={lang}>
      <div className="ab-dashboard-head">
        <h1>{t('Agent Buddy: team dashboard')}</h1>
        {origin && <span className="ab-sub">{t('Reading from {origin} with your own session', { origin })}</span>}
      </div>
      {source.status === 'checking' || !eff.ready ? (
        <p className="ab-sub" role="status">{t('Checking the ServiceNow tab…')}</p>
      ) : source.status === 'ready' ? (
        <>
          {source.reconnecting && (
            <p className="ab-note ab-note-warn" role="status">
              {t('The ServiceNow tab is not answering right now (it may be loading a page). The numbers below stay as they were. When the tab is back, press Refresh for new numbers.')}
            </p>
          )}
          <ReportsDashboard page={source.page} eff={eff} layout="page" />
        </>
      ) : (
        <section className="ab-card" role="alert">
          <h2 className="ab-h">{t('Open ServiceNow and reload')}</h2>
          <p className="ab-sub">{tr(MESSAGES[source.status])}</p>
          <button type="button" className="ab-btn" onClick={check}>{t('Check again')}</button>
        </section>
      )}
    </main>
  );
}

import { useState } from 'react';
import { MSG } from '../lib/messages.js';
import { instancePattern, isInstanceAllowed } from '../policy/policy.js';
import { isAiReady } from './aiReady.js';
import { plainError } from './ask.js';
import { firstRunSteps } from './firstRun.js';
import { useActiveInstances, useSiteCheck } from './usePage.js';
import { t, tm, t as tr } from '../i18n/index.js';
import { tx } from '../i18n/jsx.jsx';

// What the browser said when it did not turn the site on, and the next step. A refused prompt and a prompt that never appeared (an
// organisation's browser policy can block site access) look the same from here, so both are named.
export const REFUSED_TEXT = tm(
  'The browser did not turn Agent Buddy on for this site. Press the button again and choose Allow. If no question appears, your IT team may block it: ask them, or add the address in Settings.',
);

/**
 * Turn Agent Buddy on for the site of the active tab: one button straight from the click (the browser asks for the site), then the
 * service worker registers the content scripts. Offered as the main action only on a ServiceNow page (its address, or the marks a
 * one-time look at the page found); anywhere else it says "This does not look like ServiceNow" and keeps a small "Turn on anyway"
 * for an instance on a custom domain.
 *
 * props: page (a 'not-enabled' page with its origin), eff, onChanged (look at the page again), primary (the screen's one filled button)
 */
export function TurnOnSite({ page, eff, onChanged = () => {}, primary = true }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const verdict = useSiteCheck(page);

  async function enable() {
    setError('');
    setBusy(true);
    try {
      // The permission request must run straight from the click.
      let granted = false;
      try {
        granted = await chrome.permissions.request({ origins: [instancePattern(page.origin)] });
      } catch {
        granted = false; // a build with fixed sites, or a browser policy that blocks the prompt
      }
      if (!granted) {
        setError(tr(REFUSED_TEXT));
        return;
      }
      const answer = await chrome.runtime.sendMessage({ type: MSG.ENABLE_INSTANCE, origin: page.origin });
      if (answer?.error) throw new Error(answer.error.message);
      onChanged();
    } catch (err) {
      setError(plainError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!page?.origin) {
    return <p className="ab-sub">{t('Open your ServiceNow instance in this tab, then click the Agent Buddy button in the browser toolbar. You can also add its address in Settings.')}</p>;
  }
  if (!isInstanceAllowed(page.origin, eff?.policy)) return <p className="ab-note ab-note-warn">{t('Your organisation has not approved this site for Agent Buddy.')}</p>;

  const host = page.origin.replace('https://', '');
  const errorNote = error ? (
    <p className="ab-note ab-note-danger" role="alert">
      {error}
    </p>
  ) : null;

  if (verdict === 'checking') return <p className="ab-sub" role="status">{t('Checking this page…')}</p>;
  if (verdict === 'servicenow') {
    return (
      <div className="ab-turnon">
        <p className="ab-sub">
          {tx('Agent Buddy reads only what you can already see on {host}, including its portal pages. Nothing is written to ServiceNow.', { host: <span className="ab-mono">{host}</span> })}
        </p>
        <div className="ab-row">
          <button type="button" className={`ab-btn${primary ? ' ab-btn-primary ab-btn-lg' : ''}`} disabled={busy} onClick={enable}>
            {t('Turn on for this site')}
          </button>
        </div>
        {errorNote}
      </div>
    );
  }
  return (
    <div className="ab-turnon">
      <p className="ab-sub">
        {verdict === 'other' ? t('This does not look like ServiceNow.') : t('Agent Buddy could not check this page.')}{' '}
        {t('Open your ServiceNow instance in this tab, then click the Agent Buddy button in the browser toolbar.')}
      </p>
      <p className="ab-hint ab-turnon-anyway">
        {tx('Is {host} your ServiceNow on its own web address?', { host: <span className="ab-mono">{host}</span> })}{' '}
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" disabled={busy} onClick={enable}>
          {t('Turn on anyway')}
        </button>
      </p>
      {errorNote}
    </div>
  );
}

/**
 * The Ticket screen when the active tab is not a ticket: the site is not turned on yet, or it is on and no record is open. The first
 * run's steps (turn on, what you work on, AI, open a ticket) are the "Getting started" card (FirstRun.jsx, drawn just above): whatever
 * that card offers is not repeated here.
 *
 * props: page, eff, lastSeen?, onChanged (look at the page again), onOpenScreen?(id) (switch the panel to another screen)
 */
export default function SetupView({ page, eff, lastSeen = null, onChanged = () => {}, onOpenScreen = null }) {
  const activeInstances = useActiveInstances(eff);
  const firstRun = firstRunSteps({ page, lastSeen, aiReady: isAiReady(eff), eff, activeInstances });

  if (page.status === 'no-record') {
    if (firstRun.show) return null; // "Open a ticket" is the card's last step
    return (
      <section className="ab-card ab-setup-open">
        <h2 className="ab-h">{t('Open a ticket')}</h2>
        <p className="ab-sub">
          {page.surface === 'portal'
            ? t('Open a ticket, request or case on this portal and Agent Buddy offers help for it here.')
            : t('Open an incident, request, catalog task or case and Agent Buddy offers help for it here.')}
        </p>
        {onOpenScreen && (
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => onOpenScreen('mywork')}>
              {t('See my work')}
            </button>
          </div>
        )}
      </section>
    );
  }

  if (page.status === 'not-enabled') {
    // The card turns the site on while that is its next step (on a tab whose address the panel can see); a second site, or one turned
    // off later, is turned on here. A tab whose address cannot be seen gets the "open your instance" help here, never in the card.
    if (page.origin && firstRun.show && firstRun.next === 'site') return null;
    return (
      <section className="ab-card ab-setup-site">
        <h2 className="ab-h">{t('Not turned on for this page')}</h2>
        <TurnOnSite page={page} eff={eff} onChanged={onChanged} primary={!firstRun.show} />
      </section>
    );
  }
  return null;
}

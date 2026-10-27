import { useState } from 'react';
import { MSG } from '../lib/messages.js';
import { instancePattern, isInstanceAllowed } from '../policy/policy.js';
import MyDayView from './MyDayView.jsx';
import { isAiReady } from './aiReady.js';
import { plainError } from './ask.js';

// Shown when the active tab is not a ticket: the site is not enabled yet, or it is enabled but no record is open.
export default function SetupView({ page, eff, onChanged }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // A local model (Ollama, or a server on this computer) needs no key.
  const aiReady = isAiReady(eff);

  async function enable() {
    setError('');
    setBusy(true);
    try {
      // The permission request must run straight from the click.
      const granted = await chrome.permissions.request({ origins: [instancePattern(page.origin)] });
      if (!granted) throw new Error('The browser did not grant access to this site.');
      const answer = await chrome.runtime.sendMessage({ type: MSG.ENABLE_INSTANCE, origin: page.origin });
      if (answer?.error) throw new Error(answer.error.message);
      onChanged();
    } catch (err) {
      setError(plainError(err));
    } finally {
      setBusy(false);
    }
  }

  const allowed = page.origin ? isInstanceAllowed(page.origin, eff.policy) : false;

  return (
    <>
      {page.status === 'no-record' && (
        <>
          <MyDayView page={page} />
          <section className="ab-card">
            <h2 className="ab-h">Open a ticket</h2>
            <p className="ab-sub">
              {page.surface === 'portal'
                ? 'Open a ticket, request or case on this portal and Agent Buddy will offer help for it here.'
                : 'Open an incident, request, catalog task or case, in the platform, in a workspace or on a portal ticket page (Service Portal, Employee Center, customer service portal), and Agent Buddy will offer help for it here.'}
            </p>
          </section>
        </>
      )}

      {page.status === 'not-enabled' && (
        <section className="ab-card">
          <h2 className="ab-h">Not turned on for this page</h2>
          {page.origin ? (
            allowed ? (
              <>
                <p className="ab-sub">
                  Agent Buddy only works on sites you turn it on for. Turning it on lets it read tickets you can already see on <span className="ab-mono">{page.origin.replace('https://', '')}</span>, including its portal pages. A portal that has its own web address is turned on separately.
                </p>
                <div className="ab-row">
                  <button type="button" className="ab-btn ab-btn-primary" disabled={busy} onClick={enable}>
                    Turn on for this site
                  </button>
                </div>
              </>
            ) : (
              <p className="ab-note ab-note-warn">Your organisation has not approved this site for Agent Buddy.</p>
            )
          ) : (
            <p className="ab-sub">
              Open your ServiceNow instance in this tab, then click the Agent Buddy button in the toolbar. You can also add the address in Settings.
            </p>
          )}
          {error && <p className="ab-note ab-note-danger" role="alert">{error}</p>}
        </section>
      )}

      {!aiReady && (
        <section className="ab-card">
          <h2 className="ab-h">{eff.keyLocked ? 'Unlock your AI key' : 'Add an AI key'}</h2>
          <p className="ab-sub">
            {eff.keyLocked
              ? 'Your key is encrypted. Enter your passphrase in Settings to use it in this browser session.'
              : 'Agent Buddy works with the AI provider you choose. Add a key in Settings. Personal data is masked before anything is sent.'}
          </p>
          <div className="ab-row">
            <button type="button" className="ab-btn" onClick={() => chrome.runtime.openOptionsPage()}>
              Open Settings
            </button>
          </div>
        </section>
      )}
    </>
  );
}

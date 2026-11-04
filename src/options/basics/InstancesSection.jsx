// Settings, Basics: the ServiceNow instances Agent Buddy runs on. Turning one on asks the browser for the site (straight from the
// click), then the service worker registers the page scripts; the sites the organisation turns on itself are listed, not offered.
import { useEffect, useState } from 'react';
import { MSG } from '../../lib/messages.js';
import { instancePattern, normalizeInstance, isInstanceAllowed } from '../../policy/policy.js';
import { hostAccessMode } from '../policyNotes.js';
import { FieldError, Locked, SectionHead, onEnter } from '../fields.jsx';
import { t, tm, isolate, t as tr } from '../../i18n/index.js';

// What Settings says when the browser did not turn a site on: the next step, for a refused question and for one that never appeared.
export const SITE_REFUSED_TEXT = tm('The browser did not turn Agent Buddy on for this site. Press Turn on again and choose Allow. If no question appears, your IT team may block it: ask them.');

/** 'granted' in a build whose hosts were granted at install (enterprise), 'prompt' when the browser asks site by site. */
function hostAccess() {
  try {
    return hostAccessMode(chrome.runtime.getManifest());
  } catch {
    return 'prompt';
  }
}

/** The sites the organisation turns on itself (exact addresses in its policy, already allowed by the browser), from the service worker. */
function useManagedSites(eff) {
  const [managed, setManaged] = useState([]);
  const key = JSON.stringify([eff.values.instances || [], eff.policy?.allowedInstances || null]);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => chrome.runtime.sendMessage({ type: MSG.LIST_INSTANCES }))
      .then((answer) => {
        const listed = Array.isArray(answer?.listed) ? answer.listed : [];
        if (live) setManaged(listed.filter((x) => x && x.managed === true && typeof x.origin === 'string').map((x) => x.origin));
      })
      .catch(() => live && setManaged([]));
    return () => {
      live = false;
    };
  }, [key]);
  return managed;
}

export function InstancesSection({ eff, reload }) {
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const instances = eff.values.instances || [];
  const managed = useManagedSites(eff).filter((o) => !instances.includes(o));

  async function add() {
    setError('');
    const origin = normalizeInstance(address);
    setBusy(true);
    try {
      if (!origin) throw new Error(t('Enter the https address of your ServiceNow instance, for example https://acme.service-now.com'));
      if (!isInstanceAllowed(origin, eff.policy)) throw new Error(t('Your organisation has not approved this instance.'));
      let granted = false;
      try {
        granted = await chrome.permissions.request({ origins: [instancePattern(origin)] });
      } catch {
        // A build with fixed host access (enterprise) cannot ask for a site it was not built for.
        throw new Error(t('This build of Agent Buddy cannot be turned on for that site. Your organisation decides which instances it works on.'));
      }
      if (!granted) throw new Error(tr(SITE_REFUSED_TEXT));
      const answer = await chrome.runtime.sendMessage({ type: MSG.ENABLE_INSTANCE, origin });
      if (answer?.error) throw new Error(answer.error.message);
      setAddress('');
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(origin) {
    setError('');
    try {
      const answer = await chrome.runtime.sendMessage({ type: MSG.DISABLE_INSTANCE, origin });
      if (answer?.error) throw new Error(answer.error.message);
    } catch (err) {
      setError(t('Could not turn off {origin}: {message}', { origin: isolate(origin), message: err.message }));
    }
    reload();
  }

  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-instances">
      <SectionHead id="h-instances" title={t('ServiceNow instances')}>
        {hostAccess() === 'granted'
          ? t('Agent Buddy only runs on instances you turn on. This build was given access to the instances your organisation approved when it was installed, so the browser does not ask.')
          : t('Agent Buddy only runs on instances you turn on. The browser asks you to confirm each one the first time.')}
      </SectionHead>
      {instances.length === 0 && managed.length === 0 && <p className="ab-note ab-set-empty">{t('No instance is turned on yet.')}</p>}
      {instances.length + managed.length > 0 && (
        <ul className="ab-set-list">
          {instances.map((o) => (
            <li key={o} className="ab-set-item ab-set-site">
              <span className="ab-dot ab-dot-ok" aria-hidden="true" />
              <span className="ab-mono ab-set-item-main">{o}</span>
              <button type="button" className="ab-btn ab-btn-sm" onClick={() => remove(o)} aria-label={t('Turn off {site}', { site: o })}>{t('Turn off')}</button>
            </li>
          ))}
          {managed.map((o) => (
            <li key={o} className="ab-set-item ab-set-site">
              <span className="ab-dot ab-dot-ok" aria-hidden="true" />
              <span className="ab-mono ab-set-item-main">{o}</span>
              <span className="ab-locked">{t('Turned on by your organisation')}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="ab-field">
        <label className="ab-label" htmlFor="instance">{t('Instance address')}</label>
        <div className="ab-set-inputrow">
          <input
            id="instance"
            className="ab-input ab-mono"
            placeholder={t('https://yourcompany.service-now.com')}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={onEnter(() => !busy && add())}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'instance-error' : undefined}
          />
          <button type="button" className="ab-btn ab-btn-primary" onClick={add} disabled={busy}>{t('Turn on')}</button>
        </div>
        {eff.locked.instances && <Locked why={eff.locked.instances} />}
        <FieldError id="instance-error" text={error} />
      </div>
    </section>
  );
}

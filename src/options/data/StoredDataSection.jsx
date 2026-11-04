// Settings, Basics: everything Agent Buddy keeps in this browser (src/lib/storedData.js describes each key), and "Clear everything"
// behind a confirmation: the sites turned on are turned off first, then browser storage, memory and the key vault are emptied.
import { useCallback, useEffect, useRef, useState } from 'react';
import { USAGE_KEY } from '../../lib/aiUsage.js';
import { loadSettings, keyVault } from '../../lib/storage.js';
import { MSG } from '../../lib/messages.js';
import { clearAllStored, summarizeStored } from '../../lib/storedData.js';
import { t, t as tr } from '../../i18n/index.js';

// "saved now", "nothing saved", and for what lives in memory only "..., memory only"
function storedState(item) {
  const state = item.present ? t('saved now') : t('nothing saved');
  return item.area === 'session' ? t('{state}, memory only', { state }) : state;
}

/**
 * props:
 *   eff        the effective settings
 *   onCleared  called after "Clear everything" (Options then draws every section again from what is left)
 */
export function StoredDataSection({ eff, onCleared }) {
  const [items, setItems] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const confirmButton = useRef(null);

  const load = useCallback(async () => {
    try {
      const local = Object.keys((await chrome.storage.local.get(null)) || {});
      const session = chrome.storage.session ? Object.keys((await chrome.storage.session.get(null)) || {}) : [];
      const vault = keyVault() ? Object.keys((await keyVault().get(null)) || {}) : [];
      setItems(summarizeStored(local, session, vault));
    } catch {
      setItems(summarizeStored([], []));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  // The confirmation takes the keyboard focus, so a keyboard user lands on the choice it asks for.
  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
  }, [confirming]);

  // While the organisation counts a daily token budget from the usage log, clearing everything leaves that log (it holds no text):
  // otherwise "Clear everything" would also reset today's count.
  const budgeted = Number(eff.policy?.tokenBudgetPerDay) > 0;

  async function clearEverything() {
    setBusy(true);
    setResult(null);
    try {
      // The sites you turned on are turned off first, so the browser permission and the page scripts go with the setting. All of
      // them, as saved: eff.values.instances leaves out a site the organisation's allowedInstances does not list (turned on before the
      // policy came), and its browser permission would stay.
      const saved = await loadSettings().catch(() => null);
      const sites = Array.isArray(saved?.instances) ? saved.instances.filter((o) => typeof o === 'string') : eff.values.instances || [];
      for (const origin of sites) {
        try {
          // eslint-disable-next-line no-await-in-loop -- a handful of sites at most
          await chrome.runtime.sendMessage({ type: MSG.DISABLE_INSTANCE, origin });
        } catch {
          /* the settings below are removed anyway */
        }
      }
      const done = await clearAllStored(
        { local: chrome.storage.local, session: chrome.storage.session, vault: keyVault() },
        { keep: budgeted ? [USAGE_KEY] : [] }
      );
      const kept = done.kept?.length ? ` ${t("The AI usage log was kept: your organisation's daily limit is counted from it.")}` : '';
      setResult(done.remaining.length ? { kind: 'danger', text: t('Some things could not be removed. Try again, or remove the extension.') } : { kind: 'ok', text: `${t('Everything stored by Agent Buddy was removed.')}${kept}` });
    } catch {
      setResult({ kind: 'danger', text: t('The browser did not let Agent Buddy remove everything. Try again.') });
    } finally {
      setConfirming(false);
      setBusy(false);
      load();
      onCleared();
    }
  }

  return (
    <section className="ab-section" aria-labelledby="h-stored">
      <h2 className="ab-h" id="h-stored">{t('Stored data')}</h2>
      <p className="ab-sub">
        {t("This is everything Agent Buddy keeps in this browser. It never keeps ticket text, names or the AI's answers.")}
      </p>
      {items === null ? <p className="ab-sub">{t('Loading…')}</p> : (
        <ul style={{ paddingInlineStart: 18 }}>
          {items.map((item) => (
            <li key={item.id}>
              <strong>{tr(item.title)}</strong>{' '}
              <span className="ab-sub">({storedState(item)})</span>
              <div className="ab-hint">{tr(item.detail)}</div>
            </li>
          ))}
        </ul>
      )}
      {!confirming ? (
        <div className="ab-row">
          <button type="button" className="ab-btn" onClick={() => { setResult(null); setConfirming(true); }}>{t('Clear everything stored by Agent Buddy')}</button>
        </div>
      ) : (
        <div className="ab-note ab-note-warn" role="alertdialog" aria-labelledby="clear-title" aria-describedby="clear-text">
          <strong id="clear-title">{t('Remove everything?')}</strong>{' '}
          <span id="clear-text">
            {t('Your settings, the saved AI key, snippets, the usage and activity logs, saved dashboards and checklist ticks are deleted, and the ServiceNow sites you turned on are turned off. This cannot be undone.')}
            {budgeted ? ` ${t('The AI usage log stays while your organisation sets a daily limit.')}` : ''}
          </span>
          <div className="ab-row" style={{ marginTop: 8 }}>
            <button type="button" ref={confirmButton} className="ab-btn ab-btn-danger ab-btn-sm" onClick={clearEverything} disabled={busy}>{busy ? t('Removing…') : t('Yes, remove everything')}</button>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => setConfirming(false)} disabled={busy}>{t('Cancel')}</button>
          </div>
        </div>
      )}
      {result && <p className={`ab-note ab-note-${result.kind}`} role="status" style={{ marginTop: 8 }}>{result.text}</p>}
    </section>
  );
}

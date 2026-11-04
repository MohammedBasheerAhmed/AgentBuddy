// Settings, AI Assist: the AI provider, its address, the model and the key (where it is kept, saved, moved, unlocked, removed), with
// "Test connection" and "Load models" (./useConnectionCheck.js). The Azure OpenAI fields are in ./AzureFields.jsx and the line under
// the key box in ./SavedKeyLine.jsx. The organisation's policy can choose the provider, the address, the model, where the key is kept,
// or supply the key itself.
import { useEffect, useState } from 'react';
import { PROVIDERS } from '../../providers/config.js';
import { validateBaseUrl, isAzureHost } from '../../lib/aiUsage.js';
import { keyStore } from '../../lib/storage.js';
import { cleanKey, MIN_PASSPHRASE } from '../../lib/keyStore.js';
import { canListModels } from '../../providers/models.js';
import { modelChoices } from '../../lib/modelChoices.js';
import { KEY_STORAGE_MODES } from '../../policy/policy.js';
import { allowedProviderIds } from '../policyNotes.js';
import { DraftInput, FieldError, Locked, SectionHead, Status, describedBy, onEnter, useSaveSetting } from '../fields.jsx';
import { Icon } from '../../sidepanel/ui/icons.jsx';
import { AzureFields } from './AzureFields.jsx';
import { SavedKeyLine } from './SavedKeyLine.jsx';
import { useConnectionCheck } from './useConnectionCheck.js';
import { KEY_MODE_LABEL, KEY_MODE_TEXT, KEY_WHERE } from './keyPlaces.js';
import { t, tn, t as tr } from '../../i18n/index.js';
import { tx } from '../../i18n/jsx.jsx';

const SHOW_SAVED_MS = 20000; // a saved key that was shown in full hides itself again after this long

export function ProviderSection({ eff, reload }) {
  const v = eff.values;
  const def = PROVIDERS[v.provider] || PROVIDERS.anthropic;
  const [key, setKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [unlockPass, setUnlockPass] = useState('');
  // A field saved here leaves the status line as it is: the result of a test or a key move stays in view while the model or the address
  // saves on leaving its box.
  const { status, setStatus, save: change } = useSaveSetting(reload, { keepStatus: true });
  const [busy, setBusy] = useState(''); // '' | 'test' | 'models' | 'key'
  const [showTyped, setShowTyped] = useState(false); // the box shows what was typed instead of dots
  const [showSaved, setShowSaved] = useState(false); // the saved key is shown in full (hides itself again)
  const store = () => keyStore(); // made when used, never while drawing
  // Where the saved key is kept comes with the settings (Options' reload reads it with the key), so every action below that moves,
  // saves, unlocks or removes the key shows its new place as soon as it calls reload(). Read here, from the key string alone, it went
  // stale: moving a key into memory or encrypting it leaves the key itself unchanged.
  const keyMode = eff.keyMode || 'none';
  const needsEncryption = eff.needsEncryption === true;

  // The saved key is shown only on request, only for a moment, and never for another provider's key.
  useEffect(() => {
    setShowSaved(false);
  }, [v.provider, eff.apiKey]);
  useEffect(() => {
    if (!showSaved) return undefined;
    const timer = setTimeout(() => setShowSaved(false), SHOW_SAVED_MS);
    return () => clearTimeout(timer);
  }, [showSaved]);
  const connection = useConnectionCheck({ eff, typedKey: key, setBusy, setStatus, change });

  const baseUrlTyped = v.baseUrls?.[v.provider] || '';
  const model = v.models?.[v.provider] || def.defaultModel;
  const needsAddress = v.provider === 'custom'; // there is no public API to fall back on

  async function saveKey() {
    setStatus(null);
    // An empty box never removes a saved key by accident: that is what "Remove saved key" is for.
    if (!cleanKey(key)) {
      setStatus({ kind: 'warn', text: keyMode === 'none' ? t('Paste your key in the key box first, then press Save key.') : t('The key box is empty. To remove the saved key, press "Remove saved key".') });
      return;
    }
    setBusy('key');
    try {
      if (v.keyStorage === 'encrypted' && passphrase.length < MIN_PASSPHRASE) throw new Error(t('Choose a passphrase of at least {min} characters to encrypt the key.', { min: MIN_PASSPHRASE }));
      await store().save({ provider: v.provider, key, mode: v.keyStorage, passphrase });
      setKey('');
      setPassphrase('');
      setStatus({ kind: 'ok', text: t('Key saved. ({chars})', { chars: tn(cleanKey(key).length, '{n} character', '{n} characters') }) });
      setShowTyped(false);
      reload();
    } catch (err) {
      setStatus({ kind: 'danger', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function removeKey() {
    setStatus(null);
    try {
      await store().remove(v.provider);
      setStatus({ kind: 'ok', text: t('Key removed.') });
      reload();
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not let Agent Buddy remove the key. Try again.') });
    }
  }

  async function unlock() {
    setStatus(null);
    setBusy('key');
    try {
      await store().unlock(v.provider, unlockPass);
      setUnlockPass('');
      setStatus({ kind: 'ok', text: needsEncryption ? t('The saved key is now encrypted with your passphrase, and unlocked for this browser session.') : t('Unlocked for this browser session.') });
      reload();
    } catch (err) {
      setStatus({ kind: 'danger', text: err.message });
    } finally {
      setBusy('');
    }
  }

  // "Where to keep the key" moves a key that is already saved, so the choice is never only a label: memory only really means memory
  // only. Encrypting needs a passphrase first, so that move waits for it.
  async function changeKeyStorage(next) {
    setStatus(null);
    if (!(await change({ keyStorage: next }))) return;
    if (keyMode === 'none' || keyMode === next) return;
    if (next === 'encrypted') {
      setStatus({ kind: 'warn', text: t('Your saved key is still kept as before. Choose a passphrase below and press "Encrypt the saved key".') });
      return;
    }
    try {
      await store().changeMode({ provider: v.provider, mode: next });
      setStatus({ kind: 'ok', text: t('The saved key was moved: it is now kept in {where}.', { where: tr(KEY_WHERE[next]) }) });
      reload();
    } catch (err) {
      setStatus({ kind: 'danger', text: t('{message} The saved key was not moved.', { message: err.message }) });
    }
  }

  async function encryptSaved() {
    setStatus(null);
    setBusy('key');
    try {
      if (passphrase.length < MIN_PASSPHRASE) throw new Error(t('Choose a passphrase of at least {min} characters.', { min: MIN_PASSPHRASE }));
      await store().changeMode({ provider: v.provider, mode: 'encrypted', passphrase });
      setPassphrase('');
      setStatus({ kind: 'ok', text: t('The saved key is now encrypted with your passphrase.') });
      reload();
    } catch (err) {
      setStatus({ kind: 'danger', text: err.message });
    } finally {
      setBusy('');
    }
  }

  const loadedModels = Array.isArray(v.modelLists?.[v.provider]) ? v.modelLists[v.provider] : [];
  const choices = modelChoices({ def, current: model, loaded: loadedModels, allowed: eff.policy?.allowedModels });
  const baseCheck = validateBaseUrl(baseUrlTyped);
  const typedHost = baseCheck.ok && baseCheck.url ? new URL(baseCheck.url).host : '';
  const listable = canListModels(v.provider);
  // The organisation's allowedProviders: only those are offered. A provider saved before the policy came is said plainly, not hidden.
  const offered = allowedProviderIds(Object.keys(PROVIDERS), eff.policy);
  const saved = eff.savedProvider && PROVIDERS[eff.savedProvider] ? eff.savedProvider : '';
  let providerNote = '';
  if (Array.isArray(eff.policy?.allowedProviders) && !eff.locked.provider) {
    if (!offered.length) providerNote = t('Your organisation allows no AI provider that this version of Agent Buddy knows. Ask your administrator.');
    else if (saved && !offered.includes(saved)) {
      providerNote = t('Your organisation does not allow {blocked}, which you chose before. Agent Buddy uses {used} instead; choose one of the providers in the list.', { blocked: PROVIDERS[saved].label, used: def.label });
    }
  }

  const testButtons = (
    <>
      <button type="button" className="ab-btn" onClick={connection.test} disabled={Boolean(busy)}>{busy === 'test' ? t('Testing…') : t('Test connection')}</button>
      {busy === 'test' && (
        <button type="button" className="ab-btn ab-btn-quiet" onClick={connection.cancel}>{t('Cancel')}</button>
      )}
    </>
  );

  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-provider">
      <SectionHead id="h-provider" title={t('AI provider')}>{t('Use any provider you have a key for, Azure OpenAI, a company gateway, or a model on this computer.')}</SectionHead>

      <div className="ab-field ab-set-pick">
        <label className="ab-label" htmlFor="provider">{t('Provider')}</label>
        <select id="provider" className="ab-select" value={v.provider} disabled={Boolean(eff.locked.provider)} aria-describedby={providerNote ? 'provider-note' : undefined} onChange={(e) => { setStatus(null); change({ provider: e.target.value }); }}>
          {offered.map((id) => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
          {!offered.includes(v.provider) && <option value={v.provider} disabled>{t('{label} (not allowed)', { label: def.label })}</option>}
        </select>
        {providerNote && <span className="ab-note ab-note-warn" id="provider-note" role="status">{providerNote}</span>}
        <Locked why={eff.locked.provider} />
      </div>

      {def.azure ? (
        <AzureFields eff={eff} change={change} model={model} setStatus={setStatus} />
      ) : (
        <>
          {/* A provider with its own fixed address: that address is a technical detail, folded. */}
          {!def.userBaseUrl && def.baseUrl && (
            <details className="ab-more ab-set-fold">
              <summary>{t('Technical details: the address requests go to')}<Icon name="chevronDown" className="ab-chevron" /></summary>
              <p className="ab-hint">
                {tx("{address} (the provider's own address). Only masked text is sent there, after you have seen it.", { address: <span className="ab-mono">{def.baseUrl}</span> })}
              </p>
            </details>
          )}
          {/* A provider whose address the person may give (a provider has either this or its own fixed address, never both). */}
          {def.userBaseUrl && (
            <div className="ab-field">
              <label className="ab-label" htmlFor="baseurl">{needsAddress ? t('Address (required)') : t('Address (optional)')}</label>
              <DraftInput
                id="baseurl"
                className="ab-input ab-mono"
                value={baseUrlTyped}
                readOnly={Boolean(eff.locked.baseUrl)}
                placeholder={t('https://your-gateway.example.com/v1')}
                aria-invalid={!baseCheck.ok ? true : undefined}
                aria-describedby={describedBy('baseurl-hint', !baseCheck.ok && 'baseurl-error')}
                onSave={(text) => change({ baseUrls: { ...v.baseUrls, [v.provider]: text } })}
              />
              <FieldError id="baseurl-error" text={baseCheck.ok ? '' : baseCheck.error} />
              <span className="ab-hint" id="baseurl-hint">
                {needsAddress
                  ? t('The address of your OpenAI-compatible server, for example http://localhost:1234/v1.')
                  : t("Leave empty to use the provider's own API. A company gateway goes here (the address it gave out, usually ending in /v1).")}
                {v.provider === 'openai' && isAzureHost(typedHost) ? ` ${t('This looks like an Azure OpenAI address: choose the provider "Azure OpenAI" so the key is sent the way Azure expects.')}` : ''}
              </span>
              <Locked why={eff.locked.baseUrl} />
            </div>
          )}

          <div className="ab-field">
            <label className="ab-label" htmlFor="model">{t('Model')}</label>
            <DraftInput id="model" className="ab-input ab-mono" list="models" value={model} disabled={Boolean(eff.locked.model)} aria-describedby="model-hint" onSave={(text) => change({ models: { ...v.models, [v.provider]: text.trim() } })} />
            <datalist id="models">{choices.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
            {listable && !eff.locked.model && (
              <div className="ab-set-actions">
                {loadedModels.length > 0 && (
                  <select id="model-pick" className="ab-select" aria-label={t('Pick a model from the list')} value={choices.some((c) => c.id === model) ? model : ''} onChange={(e) => e.target.value && change({ models: { ...v.models, [v.provider]: e.target.value } })}>
                    {!choices.some((c) => c.id === model) && <option value="">{t('Pick a model…')}</option>}
                    {choices.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                )}
                <button type="button" id="load-models" className="ab-btn" onClick={connection.loadModels} disabled={Boolean(busy)}>{busy === 'models' ? t('Loading…') : loadedModels.length ? t('Reload the list') : t('Load models from the server')}</button>
                {busy === 'models' && <button type="button" className="ab-btn ab-btn-quiet" onClick={connection.cancel}>{t('Cancel')}</button>}
              </div>
            )}
            <span className="ab-hint" id="model-hint">
              {listable
                ? t('Your server may offer several models. Load the list to pick one, or type the exact name your administrator gave you.')
                : t('Pick one from the list (start typing), or type the exact model id, for example claude-sonnet-5-5.')}
            </span>
            <Locked why={eff.locked.model} />
          </div>
        </>
      )}

      {/* The key, where it is kept, and the check that it works: a part of its own, which the menu beside the page names. */}
      <h3 className="ab-set-subtitle" id="h-key" tabIndex={-1}>{t('Key and connection')}</h3>
      {eff.locked.apiKey ? (
        <>
          <p className="ab-note ab-note-ok">{t('The AI key is provided by your organisation. It is never shown here.')}</p>
          <div className="ab-set-actions">{testButtons}</div>
        </>
      ) : (
        <>
          <div className="ab-field ab-set-pick">
            <label className="ab-label" htmlFor="keystorage">{t('Where to keep the key')}</label>
            <select id="keystorage" className="ab-select" value={v.keyStorage} disabled={Boolean(eff.locked.keyStorage)} aria-describedby="keystorage-hint" onChange={(e) => changeKeyStorage(e.target.value)}>
              {KEY_STORAGE_MODES.map((m) => <option key={m} value={m}>{tr(KEY_MODE_LABEL[m])}</option>)}
            </select>
            <span className="ab-hint" id="keystorage-hint">{tr(KEY_MODE_TEXT[v.keyStorage])}</span>
            <Locked why={eff.locked.keyStorage} />
          </div>

          {eff.keyLocked && (
            <div className="ab-field">
              <label className="ab-label" htmlFor="unlock">{needsEncryption ? t('Choose a passphrase to encrypt your saved key') : t('Passphrase to unlock the saved key')}</label>
              <div className="ab-set-inputrow">
                <input id="unlock" type="password" className="ab-input" value={unlockPass} onChange={(e) => setUnlockPass(e.target.value)} onKeyDown={onEnter(() => unlockPass && unlock())} autoComplete={needsEncryption ? 'new-password' : 'off'} aria-describedby={needsEncryption ? 'unlock-hint' : undefined} />
                <button type="button" className="ab-btn" onClick={unlock} disabled={!unlockPass || Boolean(busy)}>{needsEncryption ? t('Encrypt') : t('Unlock')}</button>
              </div>
              {needsEncryption && (
                <span className="ab-hint" id="unlock-hint">
                  {t('Your organisation requires the key to be encrypted, so the key saved earlier is not used until it has a passphrase (at least {MIN_PASSPHRASE} characters).', { MIN_PASSPHRASE })}
                </span>
              )}
            </div>
          )}

          <div className="ab-field">
            <label className="ab-label" htmlFor="key">{def.keyLabel}</label>
            <div className="ab-set-inputrow">
              <input
                id="key"
                type={showTyped ? 'text' : 'password'}
                className="ab-input ab-mono"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={onEnter(() => cleanKey(key) && saveKey())}
                autoComplete="off"
                spellCheck={false}
                placeholder={keyMode === 'none' ? def.keyPlaceholder || '' : t('A key is saved. Type a new one to replace it.')}
                aria-describedby="key-hint key-saved"
              />
              <button type="button" className="ab-btn" onClick={() => setShowTyped((on) => !on)} aria-pressed={showTyped} aria-controls="key">{showTyped ? t('Hide') : t('Show')}</button>
            </div>
            <span className="ab-hint" id="key-hint">{def.keyHint}</span>
            {cleanKey(key) && <span className="ab-hint" id="key-unsaved" role="status">{t('Typed, not saved yet ({chars}). Press Save key to keep it.', { chars: tn(cleanKey(key).length, '{n} character', '{n} characters') })}</span>}
            <SavedKeyLine def={def} keyMode={keyMode} wanted={v.keyStorage} apiKey={eff.apiKey} shown={showSaved} onToggle={() => setShowSaved((on) => !on)} />
          </div>
          {v.keyStorage === 'encrypted' && (
            <div className="ab-field">
              <label className="ab-label" htmlFor="pass">{t('Passphrase')}</label>
              <input id="pass" type="password" className="ab-input" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} onKeyDown={onEnter(() => cleanKey(key) && saveKey())} autoComplete="new-password" aria-describedby="pass-hint" />
              <span className="ab-hint" id="pass-hint">
                {t('At least {MIN_PASSPHRASE} characters; a few words are easy to remember and hard to guess. There is no way to recover a forgotten passphrase: you would enter the key again.', { MIN_PASSPHRASE })}
              </span>
              {(keyMode === 'local' || keyMode === 'session') && !cleanKey(key) && (
                <div className="ab-set-actions">
                  <button type="button" className="ab-btn" onClick={encryptSaved} disabled={!passphrase || Boolean(busy)}>{t('Encrypt the saved key')}</button>
                </div>
              )}
            </div>
          )}
          <div className="ab-set-actions">
            <button type="button" className="ab-btn ab-btn-primary" onClick={saveKey} disabled={busy === 'key'}>{t('Save key')}</button>
            {keyMode !== 'none' && (
              <button type="button" className="ab-btn ab-set-danger" onClick={removeKey}>
                {t('Remove saved key')}
              </button>
            )}
            {testButtons}
          </div>
        </>
      )}
      <Status status={status} />
    </section>
  );
}

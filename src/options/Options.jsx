import { useCallback, useEffect, useRef, useState } from 'react';
import { PROVIDERS } from '../providers/config.js';
import { validateBaseUrl, splitAzureAddress, azureOptions, isAzureHost, AZURE_DEFAULT_API_VERSION, summarize, tokensUsedToday, USAGE_KEY } from '../lib/aiUsage.js';
import { testConnection, loadModelList } from '../lib/connectionCheck.js';
import { loadEffective, loadSettings, saveSettings, keyStore, keyVault, readAudit, clearAudit } from '../lib/storage.js';
import { cleanKey, keyPreview, MIN_PASSPHRASE } from '../lib/keyStore.js';
import { canListModels } from '../providers/models.js';
import { readBudgetState, saveCaps } from '../providers/budget.js';
import { modelChoices } from '../lib/modelChoices.js';
import { auditToCsv } from '../audit/auditLog.js';
import { MSG } from '../lib/messages.js';
import { clearAllStored, summarizeStored } from '../lib/storedData.js';
import { instancePattern, normalizeInstance, isInstanceAllowed, PII_MODES, PREVIEW_MODES, KEY_STORAGE_MODES } from '../policy/policy.js';
import { allowedProviderIds, dailyTokenLimit, hostAccessMode, looserThanFloor, parseDeployments, parseLimit, unknownDisabledFeatures } from './policyNotes.js';
import { diagnosticsText } from './diagnostics.js';
import { settingsChangeMatters } from '../lib/settingsChanges.js';
import ProfilePicker from './ProfilePicker.jsx';
import { FormatsSection } from './FormatsSection.jsx';
import Tabs from '../sidepanel/Tabs.jsx';
import { panelId, tabId } from '../sidepanel/tabKeys.js';
import { t, tm, tn, isolate, t as tr } from '../i18n/index.js';
import { tx } from '../i18n/jsx.jsx';
import { useLanguage } from '../i18n/useLanguage.js';
import { THEMES, useTheme } from '../ui/useTheme.js';
import { LANGUAGES } from '../i18n/index.js';

// (English texts marked with tm(); each is shown with tr(), the translation function, at the moment it is used)
const KEY_MODE_TEXT = {
  local: tm("Kept in Agent Buddy's own storage in this browser. ServiceNow pages cannot read it, but anyone who can read your browser profile on disk can. Use a key with a spend limit."),
  session: tm('Kept in memory only and forgotten when the browser closes. Nothing is written to disk. You enter it again next time.'),
  encrypted: tm('Kept encrypted with a passphrase. You enter the passphrase once per browser session.'),
};
const KEY_MODE_LABEL = { local: tm('This browser (simple)'), session: tm('Memory only (forgotten on close)'), encrypted: tm('Encrypted with a passphrase') };
const KEY_WHERE = { local: tm('this browser'), session: tm('memory only'), encrypted: tm('this browser, encrypted') };
const SHOW_SAVED_MS = 20000; // a saved key that was shown in full hides itself again after this long
const TEST_TIMEOUT_MS = 45000; // "Test connection" asks for one word; it should not keep the page waiting for minutes
const PII_TEXT = {
  standard: tm('Masks detected personal data (names on the ticket, emails, phone and card numbers, IDs, secrets).'),
  strict: tm('Also refuses sensitive fields and keeps HR free text out entirely.'),
  'local-only': tm('Only allows an AI model running on this computer. Nothing leaves it.'),
};
const PREVIEW_TEXT = { always: tm('Show the exact outgoing text every time'), first: tm('Show it the first time for each action'), never: tm('Do not show it') };
const PII_LABEL = { standard: tm('Standard'), strict: tm('Strict'), 'local-only': tm('Local model only') };

/** 'granted' in a build whose hosts were granted at install (enterprise), 'prompt' when the browser asks site by site. */
function hostAccess() {
  try {
    return hostAccessMode(chrome.runtime.getManifest());
  } catch {
    return 'prompt';
  }
}

function Locked({ why }) {
  return why ? <span className="ab-locked">{why}</span> : null;
}

/** A problem with one field, shown right under it and announced. */
function FieldError({ id, text }) {
  return text ? (
    <span id={id} className="ab-note ab-note-danger" role="alert">
      {text}
    </span>
  ) : null;
}

/** The result of the last action of a section, under its buttons. Errors are announced at once. */
function Status({ status }) {
  if (!status) return null;
  return (
    <p className={`ab-note ab-note-${status.kind}`} role={status.kind === 'danger' ? 'alert' : 'status'} style={{ marginTop: 8 }}>
      {status.text}
    </p>
  );
}

const describedBy = (...ids) => ids.filter(Boolean).join(' ') || undefined;
const onEnter = (fn) => (e) => {
  if (e.key === 'Enter' && !e.nativeEvent?.isComposing) {
    e.preventDefault();
    fn();
  }
};

/**
 * A text box that keeps what is typed in the box itself and saves a moment later (and on leaving it, or on Enter). Saving on every
 * keystroke and drawing the box again from storage loses characters whenever typing is faster than the save, which corrupts an address.
 */
function DraftInput({ value, onSave, delay = 300, ...rest }) {
  const [draft, setDraft] = useState(value);
  const pending = useRef(null); // the text waiting to be saved, or null
  const timer = useRef(0);
  const save = useRef(onSave);
  save.current = onSave;

  // A change from outside (another provider chosen, a policy applied) shows up unless the person is mid-edit.
  useEffect(() => {
    if (pending.current === null) setDraft(value);
  }, [value]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    const text = pending.current;
    pending.current = null;
    save.current(text);
  }, []);
  useEffect(() => flush, [flush]); // leaving the page saves what was typed

  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        pending.current = e.target.value;
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, delay);
      }}
      onBlur={flush}
      onKeyDown={onEnter(flush)}
    />
  );
}

// What is saved for this provider, so a person can see that the key was really taken: a short preview and its length, and on request
// the whole key (hidden again after a few seconds). Never offered for a key the organisation supplies (that branch has no key box).
function SavedKeyLine({ def, keyMode, wanted, apiKey, shown, onToggle }) {
  if (keyMode === 'none') return <span className="ab-hint" id="key-saved">{t('No key is saved for {label}.', { label: def.label })}</span>;
  if (!apiKey) return <span className="ab-hint" id="key-saved">{t('A key is saved but locked. Unlock it above with your passphrase.')}</span>;
  const { preview, length } = keyPreview(apiKey);
  return (
    <span className="ab-hint" id="key-saved">
      {tx('Saved: {preview} ({chars}), kept in {where}.', { preview: preview ? <code className="ab-mono">{preview}</code> : '', chars: tn(length, '{n} character', '{n} characters'), where: tr(KEY_WHERE[keyMode] || KEY_WHERE.local) })}
      {wanted && keyMode !== wanted ? ` ${t('That is not where you chose to keep it ("{label}"): see below.', { label: tr(KEY_MODE_LABEL[wanted]) })}` : ''}{' '}
      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={onToggle} aria-pressed={shown} aria-controls="key-full">{shown ? t('Hide saved key') : t('Show saved key')}</button>
      {shown && <code className="ab-mono" id="key-full" style={{ display: 'block', marginTop: 4, wordBreak: 'break-all' }}>{apiKey}</code>}
    </span>
  );
}

/** The Azure OpenAI fields: the resource, the API form and version, the deployment(s). */
function AzureFields({ eff, change, model, setStatus }) {
  const v = eff.values;
  const az = azureOptions(v.azure);
  const typed = v.baseUrls?.azure || '';
  const [addressError, setAddressError] = useState('');
  const check = validateBaseUrl(typed);
  const host = check.ok && check.url ? new URL(check.url).host : '';
  const lockedAddress = Boolean(eff.locked.baseUrl);
  const otherIds = Array.isArray(v.modelLists?.azure) ? v.modelLists.azure : [];
  const [deploymentsError, setDeploymentsError] = useState('');

  async function saveAddress(text) {
    setAddressError('');
    const split = splitAzureAddress(text);
    if (!split) {
      await change({ baseUrls: { ...v.baseUrls, azure: text } });
      return;
    }
    if (!split.ok) {
      setAddressError(split.error);
      return;
    }
    // A whole address was pasted: each part goes to its own field, and the address keeps no path or query of its own.
    await change({
      baseUrls: { ...v.baseUrls, azure: split.base },
      ...(split.deployment ? { models: { ...v.models, azure: split.deployment } } : {}),
      azure: { ...(v.azure || {}), ...(split.form ? { form: split.form } : {}), ...(split.apiVersion ? { apiVersion: split.apiVersion } : {}) },
    });
    setStatus({ kind: 'ok', text: t('The address you pasted was split into its parts: the resource address, the form, the version and the deployment below.') });
  }

  async function saveDeployments(text) {
    const { ids, bad } = parseDeployments(text);
    setDeploymentsError(bad.length ? t('Not a deployment name Azure allows: {names}. Use letters, digits, - _ and .', { names: bad.join(', ') }) : '');
    await change({ modelLists: { ...v.modelLists, azure: ids } });
  }

  const addressProblem = addressError || (!check.ok ? check.error : '');
  return (
    <>
      <div className="ab-field">
        <label className="ab-label" htmlFor="baseurl">{t('Resource address (required)')}</label>
        <DraftInput
          id="baseurl"
          className="ab-input ab-mono"
          value={typed}
          readOnly={lockedAddress}
          placeholder={t('https://your-resource.openai.azure.com')}
          aria-invalid={addressProblem ? true : undefined}
          aria-describedby={describedBy('baseurl-hint', addressProblem && 'baseurl-error')}
          onSave={saveAddress}
        />
        <FieldError id="baseurl-error" text={addressProblem} />
        <span className="ab-hint" id="baseurl-hint">
          {t('The "Endpoint" of your Azure OpenAI resource, from "Keys and Endpoint" in the Azure portal. You can also paste a whole address that ends in ?api-version=...: it is split into the fields below.')}
          {host && !isAzureHost(host) ? ` ${t('This is not an Azure OpenAI address (…openai.azure.com). That is fine for a company gateway in front of Azure.')}` : ''}
        </span>
        <Locked why={eff.locked.baseUrl} />
      </div>

      {/* Technical details, folded: most resources use the recommended form. Open when the older form is chosen or its version is wrong. */}
      <details className="ab-more" open={az.form === 'deployment' && !az.apiVersionOk}>
        <summary>{t('Technical details: how Agent Buddy calls Azure')}</summary>
        <div className="ab-field">
          <label className="ab-label" htmlFor="azure-form">{t('How to call it')}</label>
          <select id="azure-form" className="ab-select" value={az.form} aria-describedby="azure-form-hint" onChange={(e) => change({ azure: { ...(v.azure || {}), form: e.target.value } })}>
            <option value="v1">{t('v1 API (recommended): /openai/v1')}</option>
            <option value="deployment">{t('Deployment address with an api-version (older resources)')}</option>
          </select>
          <span className="ab-hint" id="azure-form-hint">
            {az.form === 'v1'
              ? t('Sends to <resource>/openai/v1/chat/completions with the deployment name as the model.')
              : t('Sends to <resource>/openai/deployments/<deployment>/chat/completions?api-version=<version>.')}
          </span>
        </div>

        {az.form === 'deployment' && (
          <div className="ab-field">
            <label className="ab-label" htmlFor="azure-version">{t('API version')}</label>
            <DraftInput
              id="azure-version"
              className="ab-input ab-mono"
              value={v.azure?.apiVersion || ''}
              placeholder={AZURE_DEFAULT_API_VERSION}
              aria-invalid={!az.apiVersionOk ? true : undefined}
              aria-describedby={describedBy('azure-version-hint', !az.apiVersionOk && 'azure-version-error')}
              onSave={(text) => change({ azure: { ...(v.azure || {}), apiVersion: text.trim() } })}
            />
            <FieldError id="azure-version-error" text={az.apiVersionOk ? '' : t('An API version looks like 2024-10-21 or 2025-04-01-preview.')} />
            <span className="ab-hint" id="azure-version-hint">{t('Leave empty for {AZURE_DEFAULT_API_VERSION}. Use the version your administrator gave you if it differs.', { AZURE_DEFAULT_API_VERSION })}</span>
          </div>
        )}
      </details>

      <div className="ab-field">
        <label className="ab-label" htmlFor="model">{t('Deployment name (required)')}</label>
        <DraftInput
          id="model"
          className="ab-input ab-mono"
          value={model}
          disabled={Boolean(eff.locked.model)}
          aria-describedby="model-hint"
          onSave={(text) => change({ models: { ...v.models, azure: text.trim() } })}
        />
        <span className="ab-hint" id="model-hint">
          {t('The name of the deployment in Azure AI Foundry, under Deployments (it can differ from the model\'s name). Azure does not give a key a list of deployments, so there is no "Load models" here.')}
        </span>
        <Locked why={eff.locked.model} />
      </div>

      {!eff.locked.model && (
        <div className="ab-field">
          <label className="ab-label" htmlFor="azure-deployments">{t('Other deployments to switch between (optional)')}</label>
          <DraftInput
            id="azure-deployments"
            className="ab-input ab-mono"
            value={otherIds.join(', ')}
            placeholder={t('gpt-5-mini, gpt-5')}
            aria-invalid={deploymentsError ? true : undefined}
            aria-describedby={describedBy('azure-deployments-hint', deploymentsError && 'azure-deployments-error')}
            onSave={saveDeployments}
          />
          <FieldError id="azure-deployments-error" text={deploymentsError} />
          <span className="ab-hint" id="azure-deployments-hint">{t('Separate names with commas. They appear in the model switch at the top of the side panel.')}</span>
        </div>
      )}
    </>
  );
}

export function ProviderSection({ eff, reload }) {
  const v = eff.values;
  const def = PROVIDERS[v.provider] || PROVIDERS.anthropic;
  const [key, setKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [unlockPass, setUnlockPass] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(''); // '' | 'test' | 'models' | 'key'
  const [showTyped, setShowTyped] = useState(false); // the box shows what was typed instead of dots
  const [showSaved, setShowSaved] = useState(false); // the saved key is shown in full (hides itself again)
  const running = useRef(null); // the AbortController of a test or a list that is running
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
  // Leaving the page (or another provider) stops a test or a list that is still running.
  useEffect(() => () => running.current?.abort(), [v.provider]);

  const baseUrlTyped = v.baseUrls?.[v.provider] || '';
  const model = v.models?.[v.provider] || def.defaultModel;
  const needsAddress = v.provider === 'custom'; // there is no public API to fall back on

  async function change(patch) {
    try {
      await saveSettings(patch);
      reload();
      return true;
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not save that change. Try again.') });
      return false;
    }
  }

  // The key that a test uses: one typed in the box and not saved yet is the one the person wants tested; otherwise the saved one.
  const keyForUse = () => cleanKey(key) || eff.apiKey;

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

  // Runs a test or a list with a Cancel; the browser permission is asked first, straight from the click.
  async function withCancel(kind, work) {
    setStatus(null);
    setBusy(kind);
    const controller = new AbortController();
    running.current = controller;
    try {
      await work(controller.signal);
    } catch (err) {
      if (err?.code === 'CANCELLED') setStatus({ kind: 'warn', text: t('Cancelled.') });
      else setStatus({ kind: 'danger', text: err?.message || t('Something went wrong.') });
    } finally {
      if (running.current === controller) running.current = null;
      setBusy('');
    }
  }

  // The checks (the organisation's rules, the address, the privacy mode), the browser permission, the firewall and the call are all in
  // src/lib/connectionCheck.js: the same refusals as every run, made before the browser is asked for permission. This only shows it.
  const test = () =>
    withCancel('test', async (signal) => {
      const reply = await testConnection({ values: v, policy: eff.policy, apiKey: keyForUse(), signal, timeoutMs: TEST_TIMEOUT_MS });
      const typed = cleanKey(key);
      const unsaved = typed && typed !== eff.apiKey ? ` ${t('This key is not saved yet: press Save key to keep it.')}` : '';
      const cut = reply.note ? ` ${reply.note}` : '';
      setStatus({ kind: 'ok', text: `${t('Connected. The model answered: {answer}', { answer: isolate(reply.answer) })}${unsaved}${cut}` });
    });

  // The models the server offers, so one can be picked instead of typed. Only the key goes out (to the address chats go to).
  const loadModels = () =>
    withCancel('models', async (signal) => {
      const ids = await loadModelList({ values: v, policy: eff.policy, apiKey: keyForUse(), signal });
      if (!(await change({ modelLists: { ...v.modelLists, [v.provider]: ids } }))) return;
      setStatus({ kind: 'ok', text: t('Found {models}. Pick one from the list, or type a name.', { models: tn(ids.length, '{n} model', '{n} models') }) });
    });

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
      <button type="button" className="ab-btn" onClick={test} disabled={Boolean(busy)}>{busy === 'test' ? t('Testing…') : t('Test connection')}</button>
      {busy === 'test' && (
        <button type="button" className="ab-btn ab-btn-quiet" onClick={() => running.current?.abort()}>{t('Cancel')}</button>
      )}
    </>
  );

  return (
    <section className="ab-section" aria-labelledby="h-provider">
      <h2 className="ab-h" id="h-provider">{t('AI provider')}</h2>
      <p className="ab-sub">{t('Use any provider you have a key for, Azure OpenAI, a company gateway, or a model on this computer.')}</p>

      <div className="ab-field">
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
            <details className="ab-more">
              <summary>{t('Technical details: the address requests go to')}</summary>
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
              <div className="ab-row" style={{ marginTop: 6 }}>
                {loadedModels.length > 0 && (
                  <select id="model-pick" className="ab-select" aria-label={t('Pick a model from the list')} value={choices.some((c) => c.id === model) ? model : ''} onChange={(e) => e.target.value && change({ models: { ...v.models, [v.provider]: e.target.value } })}>
                    {!choices.some((c) => c.id === model) && <option value="">{t('Pick a model…')}</option>}
                    {choices.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                )}
                <button type="button" id="load-models" className="ab-btn" onClick={loadModels} disabled={Boolean(busy)}>{busy === 'models' ? t('Loading…') : loadedModels.length ? t('Reload the list') : t('Load models from the server')}</button>
                {busy === 'models' && <button type="button" className="ab-btn ab-btn-quiet" onClick={() => running.current?.abort()}>{t('Cancel')}</button>}
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

      {eff.locked.apiKey ? (
        <>
          <p className="ab-note ab-note-ok">{t('The AI key is provided by your organisation. It is never shown here.')}</p>
          <div className="ab-row" style={{ marginTop: 8 }}>{testButtons}</div>
        </>
      ) : (
        <>
          <div className="ab-field">
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
              <div className="ab-row">
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
            <div className="ab-row">
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
                <div className="ab-row" style={{ marginTop: 6 }}>
                  <button type="button" className="ab-btn" onClick={encryptSaved} disabled={!passphrase || Boolean(busy)}>{t('Encrypt the saved key')}</button>
                </div>
              )}
            </div>
          )}
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-primary" onClick={saveKey} disabled={busy === 'key'}>{t('Save key')}</button>
            {keyMode !== 'none' && (
              <button type="button" className="ab-btn" onClick={removeKey}>
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

/** Today's use and the daily limits, the person's own and the organisation's (`tokenBudgetPerDay`), with the one that applies. */
export function UsageSection({ eff }) {
  const [state, setState] = useState(null);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null);
  const load = useCallback(() => readBudgetState().then(setState).catch(() => setState({ log: [], prices: {}, caps: {} })), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!state) return null;

  const { today, month } = summarize(state.log);
  const own = state.caps || {};
  const limit = dailyTokenLimit({ policyBudget: eff.policy?.tokenBudgetPerDay, ownCap: own.dailyTokens, usedToday: tokensUsedToday(state.log) });

  async function saveLimit(field, text) {
    const parsed = parseLimit(text);
    setErrors((e) => ({ ...e, [field]: parsed.ok ? '' : parsed.error }));
    if (!parsed.ok) return;
    try {
      await saveCaps({ [field]: parsed.value });
      setStatus(null);
      load();
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not save the limit. Try again.') });
    }
  }

  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  return (
    <section className="ab-section" aria-labelledby="h-usage">
      <h2 className="ab-h" id="h-usage">{t('Usage and limits')}</h2>
      <p className="ab-sub">
        {t('Counted on this computer from the usage log (no text is kept). Today: {todayCalls}, {todayTokens}. This month: {monthCalls}, {monthTokens}.', {
          todayCalls: tn(today.calls, '{n} call', '{n} calls', { n: fmt(today.calls) }),
          todayTokens: tn(today.tokens, '{n} token', '{n} tokens', { n: fmt(today.tokens) }),
          monthCalls: tn(month.calls, '{n} call', '{n} calls', { n: fmt(month.calls) }),
          monthTokens: tn(month.tokens, '{n} token', '{n} tokens', { n: fmt(month.tokens) }),
        })}
      </p>
      <p className={`ab-note ${limit.left === 0 ? 'ab-note-warn' : ''}`} id="limit-applies" role="status">{limit.text}</p>
      <div className="ab-field" style={{ marginTop: 12 }}>
        <label className="ab-label" htmlFor="cap-tokens">{t('Your own daily token limit')}</label>
        <DraftInput
          id="cap-tokens"
          className="ab-input"
          inputMode="numeric"
          value={own.dailyTokens ? String(own.dailyTokens) : ''}
          placeholder={t('No limit')}
          aria-invalid={errors.dailyTokens ? true : undefined}
          aria-describedby={describedBy('cap-tokens-hint', errors.dailyTokens && 'cap-tokens-error')}
          onSave={(text) => saveLimit('dailyTokens', text)}
        />
        <FieldError id="cap-tokens-error" text={errors.dailyTokens} />
        <span className="ab-hint" id="cap-tokens-hint">{t("Nothing is sent once today's tokens reach it. Leave empty for no limit of your own.")}</span>
      </div>
      <div className="ab-field">
        <label className="ab-label" htmlFor="cap-calls">{t('Your own daily limit of AI calls')}</label>
        <DraftInput
          id="cap-calls"
          className="ab-input"
          inputMode="numeric"
          value={own.dailyCalls ? String(own.dailyCalls) : ''}
          placeholder={t('No limit')}
          aria-invalid={errors.dailyCalls ? true : undefined}
          aria-describedby={errors.dailyCalls ? 'cap-calls-error' : undefined}
          onSave={(text) => saveLimit('dailyCalls', text)}
        />
        <FieldError id="cap-calls-error" text={errors.dailyCalls} />
      </div>
      <Status status={status} />
    </section>
  );
}

// The organisation's piiMode and previewMode are floors: the person may choose anything at or above them, never below. The select
// stays usable and only the looser choices are switched off, with a note saying what the minimum is. (The policy marks these two
// settings locked only together with a floor, src/policy/policy.js effectiveSettings, so the floor is all there is to show.)
export function PrivacySection({ eff, reload }) {
  const v = eff.values;
  const [status, setStatus] = useState(null);
  const piiFloor = eff.floors?.piiMode || '';
  const previewFloor = eff.floors?.previewMode || '';
  const change = async (patch) => {
    try {
      await saveSettings(patch);
      setStatus(null);
      reload();
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not save that change. Try again.') });
    }
  };
  return (
    <section className="ab-section" aria-labelledby="h-privacy">
      <h2 className="ab-h" id="h-privacy">{t('Privacy')}</h2>
      <p className="ab-sub">{t('Before anything goes to an AI, Agent Buddy hides names, email addresses, phone and card numbers and other personal data. These two choices say how strictly, and when you see the text first.')}</p>
      <div className="ab-field">
        <label className="ab-label" htmlFor="pii">{t('Personal-data protection')}</label>
        <select
          id="pii"
          className="ab-select"
          value={v.piiMode}
          aria-describedby={describedBy('pii-hint', piiFloor && 'pii-floor')}
          onChange={(e) => !looserThanFloor('piiMode', e.target.value, piiFloor) && change({ piiMode: e.target.value })}
        >
          {PII_MODES.map((m) => <option key={m} value={m} disabled={looserThanFloor('piiMode', m, piiFloor)}>{tr(PII_LABEL[m])}</option>)}
        </select>
        <span className="ab-hint" id="pii-hint">{tr(PII_TEXT[v.piiMode])}</span>
        {piiFloor ? <span className="ab-locked" id="pii-floor">{t('Your organisation requires at least {level}.', { level: tr(PII_LABEL[piiFloor]) })}</span> : null}
      </div>
      <div className="ab-field">
        <label className="ab-label" htmlFor="preview">{t('Check what is sent')}</label>
        <select
          id="preview"
          className="ab-select"
          value={v.previewMode}
          aria-describedby={previewFloor ? 'preview-floor' : undefined}
          onChange={(e) => !looserThanFloor('previewMode', e.target.value, previewFloor) && change({ previewMode: e.target.value, previewSeen: [] })}
        >
          {PREVIEW_MODES.map((m) => <option key={m} value={m} disabled={looserThanFloor('previewMode', m, previewFloor)}>{tr(PREVIEW_TEXT[m])}</option>)}
        </select>
        {previewFloor ? <span className="ab-locked" id="preview-floor">{t('Your organisation requires at least: {level}.', { level: tr(PREVIEW_TEXT[previewFloor]) })}</span> : null}
      </div>
      <Status status={status} />
    </section>
  );
}

function QuickBarSection({ eff, reload }) {
  const v = eff.values;
  const [status, setStatus] = useState(null);
  const change = async (patch) => {
    try {
      await saveSettings(patch);
      setStatus(null);
      reload();
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not save that change. Try again.') });
    }
  };
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

// What Settings says when the browser did not turn a site on: the next step, for a refused question and for one that never appeared.
export const SITE_REFUSED_TEXT = tm('The browser did not turn Agent Buddy on for this site. Press Turn on again and choose Allow. If no question appears, your IT team may block it: ask them.');

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
    <section className="ab-section" aria-labelledby="h-instances">
      <h2 className="ab-h" id="h-instances">{t('ServiceNow instances')}</h2>
      <p className="ab-sub">
        {hostAccess() === 'granted'
          ? t('Agent Buddy only runs on instances you turn on. This build was given access to the instances your organisation approved when it was installed, so the browser does not ask.')
          : t('Agent Buddy only runs on instances you turn on. The browser asks you to confirm each one the first time.')}
      </p>
      {instances.length === 0 && managed.length === 0 && <p className="ab-note">{t('No instance is turned on yet.')}</p>}
      <ul className="ab-sites">
        {instances.map((o) => (
          <li key={o} className="ab-row ab-site">
            <span className="ab-mono">{o}</span>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => remove(o)} aria-label={t('Turn off {site}', { site: o })}>{t('Turn off')}</button>
          </li>
        ))}
        {managed.map((o) => (
          <li key={o} className="ab-row ab-site">
            <span className="ab-mono">{o}</span>
            <span className="ab-locked">{t('Turned on by your organisation')}</span>
          </li>
        ))}
      </ul>
      <label className="ab-label" htmlFor="instance">{t('Instance address')}</label>
      <div className="ab-row">
        <input
          id="instance"
          className="ab-input ab-mono"
          style={{ flex: 1 }}
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
    </section>
  );
}

/** What the organisation's policy switches off, and the ids in it that match nothing (a typo switches nothing off). */
export function PolicySection({ eff }) {
  const off = Array.isArray(eff.policy?.disabledFeatures) ? eff.policy.disabledFeatures : [];
  if (!off.length) return null;
  const unknown = unknownDisabledFeatures(off);
  const known = off.filter((id) => !unknown.includes(String(id).trim().toLowerCase()));
  return (
    <section className="ab-section" aria-labelledby="h-policy">
      <h2 className="ab-h" id="h-policy">{t("Your organisation's policy")}</h2>
      {known.length > 0 && (
        <p className="ab-sub">
          {tx('Switched off by your organisation: {features}.', { features: <span className="ab-mono">{known.join(', ')}</span> })}
        </p>
      )}
      {unknown.length > 0 && (
        <p className="ab-note ab-note-warn" id="policy-unknown-features">
          {unknown.length === 1
            ? tx("The policy's disabledFeatures names an id that matches no feature, so nothing is switched off by it: {ids}. Check the spelling against the list in the deployment guide.", { ids: <span className="ab-mono">{unknown.join(', ')}</span> })
            : tx("The policy's disabledFeatures names ids that match no feature, so nothing is switched off by them: {ids}. Check the spelling against the list in the deployment guide.", { ids: <span className="ab-mono">{unknown.join(', ')}</span> })}
        </p>
      )}
    </section>
  );
}

function AuditSection({ eff }) {
  const [log, setLog] = useState([]);
  const [status, setStatus] = useState(null);
  const load = useCallback(() => readAudit().then((l) => setLog(l.slice().reverse())).catch(() => setLog([])), []);
  useEffect(() => { load(); }, [load]);
  const canExport = eff.policy?.auditExport !== false;

  function exportCsv() {
    const blob = new Blob([auditToCsv(log.slice().reverse())], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agent-buddy-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function clear() {
    try {
      await clearAudit();
      setStatus({ kind: 'ok', text: t('The activity log was cleared.') });
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not let Agent Buddy clear the log. Try again.') });
    }
    load();
  }

  return (
    <section className="ab-section" aria-labelledby="h-audit">
      <h2 className="ab-h" id="h-audit">{t('Activity log')}</h2>
      <p className="ab-sub">
        {t("A local record of what Agent Buddy did: which action, which table, how many items were masked, tokens and outcome. It never stores ticket text, names or the AI's answers.")}
      </p>
      <div className="ab-row" style={{ marginBottom: 8 }}>
        <button type="button" className="ab-btn ab-btn-sm" onClick={exportCsv} disabled={!canExport || !log.length}>{t('Export CSV')}</button>
        <button type="button" className="ab-btn ab-btn-sm" onClick={clear} disabled={!log.length}>{t('Clear log')}</button>
        {!canExport && <span className="ab-locked">{t('Export is switched off by your organisation.')}</span>}
      </div>
      <Status status={status} />
      {log.length === 0 ? <p className="ab-note">{t('Nothing yet.')}</p> : (
        <table className="ab-table">
          <thead><tr><th scope="col">{t('Time')}</th><th scope="col">{t('Action')}</th><th scope="col">{t('Table')}</th><th scope="col">{t('Masked')}</th><th scope="col">{t('Outcome')}</th></tr></thead>
          <tbody>
            {log.slice(0, 40).map((e, i) => (
              <tr key={i}><td>{String(e.time || '').replace('T', ' ').slice(0, 16)}</td><td><code data-ltr>{e.feature}</code></td><td><code data-ltr>{e.table}</code></td><td>{e.masked}</td><td>{OUTCOME_WORDS[e.outcome] ? t(OUTCOME_WORDS[e.outcome]) : e.outcome}{e.reason ? <> (<code data-ltr>{e.reason}</code>)</> : ''}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// "saved now", "nothing saved", and for what lives in memory only "..., memory only"
function storedState(item) {
  const state = item.present ? t('saved now') : t('nothing saved');
  return item.area === 'session' ? t('{state}, memory only', { state }) : state;
}

function StoredDataSection({ eff, onCleared }) {
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

/**
 * What you work on (work profiles), "Show everything" and "Skip AI for now". Profiles decide which cards and actions the panel shows
 * first; the organisation can limit or lock them (allowedProfiles, lockedProfiles) and approves HR work.
 */
export function ProfilesSection({ eff, reload }) {
  const v = eff.values;
  const [status, setStatus] = useState(null);
  const aiOffByOrg = eff.policy?.aiEnabled === false;
  // Throws when the browser did not save: the profile boxes say so themselves (and go back to what is saved), so they never show
  // "Saved." for a change that was lost.
  const save = async (patch) => {
    await saveSettings(patch);
    setStatus(null);
    reload();
  };
  const change = async (patch) => {
    try {
      await save(patch);
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not save that change. Try again.') });
    }
  };
  return (
    <section className="ab-section" aria-labelledby="h-profiles">
      <h2 className="ab-h" id="h-profiles">{t('What you work on')}</h2>
      <p className="ab-sub">{t('Agent Buddy shows the tools for this work first. Tick everything that applies.')}</p>
      <ProfilePicker eff={eff} onSave={save} instant idBase="profile" />
      <label className="ab-check" htmlFor="show-everything">
        <input id="show-everything" type="checkbox" checked={v.showEverything === true} onChange={(e) => change({ showEverything: e.target.checked })} />
        <span>{t('Show everything: every card and action, whatever you work on.')}</span>
      </label>
      {!aiOffByOrg && (
        <label className="ab-check" htmlFor="ai-skipped">
          <input id="ai-skipped" type="checkbox" checked={v.aiSkipped === true} onChange={(e) => change({ aiSkipped: e.target.checked })} />
          <span>{t('Skip AI for now: use Agent Buddy without AI. Everything under Insights still works.')}</span>
        </label>
      )}
      <Status status={status} />
    </section>
  );
}

/** Language: the language of the panel and this page, and the language the AI writes in. Saved at once, shown at once. */
export function LanguageSection({ eff, reload }) {
  const [status, setStatus] = useState(null);
  const aiOn = eff.policy?.aiEnabled !== false;
  async function change(patch) {
    try {
      await saveSettings(patch);
      setStatus(null);
      reload();
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not save that change. Try again.') });
    }
  }
  return (
    <section className="ab-section" aria-labelledby="h-language">
      <h2 className="ab-h" id="h-language">{t('Language')}</h2>
      <div className="ab-field">
        <label className="ab-label" htmlFor="language-choice">{t('Language of the panel and this page')}</label>
        <select id="language-choice" className="ab-select" value={eff.values.language} aria-describedby="language-hint" onChange={(e) => change({ language: e.target.value })}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>{l.id === 'auto' ? t('Same as the browser') : l.name}</option>
          ))}
        </select>
        <span className="ab-hint" id="language-hint">{t('The panel, this page and the team page. What is in a ticket is never translated.')}</span>
      </div>
      {aiOn && (
        <div className="ab-field">
          <label className="ab-label" htmlFor="answer-language">{t('Language of AI answers')}</label>
          <select id="answer-language" className="ab-select" value={eff.values.answerLanguage} aria-describedby="answer-language-hint" onChange={(e) => change({ answerLanguage: e.target.value })}>
            <option value="ticket">{t('The language of the ticket')}</option>
            <option value="panel">{t('The language of the panel')}</option>
          </select>
          <span className="ab-hint" id="answer-language-hint">{t("A reply to an Arabic ticket is written in Arabic, and one to an English ticket in English. Choose the panel's language to always get answers in it.")}</span>
        </div>
      )}
      <Status status={status} />
    </section>
  );
}

const THEME_WORDS = { system: tm('Same as the computer'), light: tm('Light'), dark: tm('Dark') };

/** Light, dark, or the computer's own setting: the panel, this page, the team page and the bar on the ServiceNow page follow it. */
export function AppearanceSection({ eff, reload }) {
  const [status, setStatus] = useState(null);
  async function change(theme) {
    try {
      await saveSettings({ theme });
      setStatus(null);
      reload();
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not save that change. Try again.') });
    }
  }
  return (
    <section className="ab-section" aria-labelledby="h-appearance">
      <h2 className="ab-h" id="h-appearance">{t('Appearance')}</h2>
      <div className="ab-field">
        <label className="ab-label" htmlFor="theme-choice">{t('Colours')}</label>
        <select id="theme-choice" className="ab-select" value={eff.values.theme} aria-describedby="theme-hint" onChange={(e) => change(e.target.value)}>
          {THEMES.map((id) => (
            <option key={id} value={id}>{t(THEME_WORDS[id])}</option>
          ))}
        </select>
        <span className="ab-hint" id="theme-hint">{t('The panel, this page, the team page and the bar on the ServiceNow page. The sun and moon button in the panel switches it too.')}</span>
      </div>
      <Status status={status} />
    </section>
  );
}

// What the activity log says happened to a run (src/audit/auditLog.js OUTCOMES); the action and the table are codes, shown as they are.
const OUTCOME_WORDS = { sent: tm('sent'), blocked: tm('blocked'), error: tm('error'), cancelled: tm('cancelled'), inserted: tm('inserted'), copied: tm('copied') };

// The keyboard shortcuts of the manifest (src/background/commands.js): the name each one is shown by.
const SHORTCUT_NAMES = { 'open-panel': tm('Open Agent Buddy'), summarise: tm('Summarise this ticket'), reply: tm('Draft a reply') };

/** The keyboard shortcuts as the browser has them now (the person may have changed them), and the way to the browser's own page to change them. */
export function ShortcutsSection() {
  const [commands, setCommands] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const all = await chrome.commands.getAll();
        if (alive) setCommands(all.filter((c) => SHORTCUT_NAMES[c.name]));
      } catch {
        if (alive) setCommands([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  const edge = typeof navigator !== 'undefined' && /\bEdg\//.test(navigator.userAgent);
  const openBrowserPage = () => {
    try {
      chrome.tabs.create({ url: edge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' });
    } catch {
      /* the browser did not open it: the address is in the hint */
    }
  };
  return (
    <section className="ab-section" aria-labelledby="h-shortcuts">
      <h2 className="ab-h" id="h-shortcuts">{t('Keyboard shortcuts')}</h2>
      <p className="ab-sub">{t('Summarise and Draft a reply open the panel and start on the ticket that is open. You still see what will be sent before anything is.')}</p>
      {commands && commands.length > 0 && (
        <ul className="ab-shortcut-list">
          {commands.map((c) => (
            <li key={c.name}>
              <span>{t(SHORTCUT_NAMES[c.name])}</span>{' '}
              {c.shortcut ? <kbd data-ltr className="ab-mono">{c.shortcut}</kbd> : <span className="ab-hint">{t('Not set')}</span>}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="ab-btn ab-btn-sm" onClick={openBrowserPage}>{t('Change the shortcuts in the browser')}</button>
      <span className="ab-hint">{t('The browser keeps your own choice when Agent Buddy updates.')}</span>
    </section>
  );
}

export const FOLLOW_UP_CHOICES = Object.freeze([2, 3, 5, 7]);

/** My work: after how many days a customer who is waiting (or has not answered) counts as a follow-up due. */
export function FollowUpSection({ eff, reload }) {
  const [status, setStatus] = useState(null);
  const current = Number(eff.values.followUpDays);
  const value = FOLLOW_UP_CHOICES.includes(current) ? current : 3;
  async function change(text) {
    const days = Number(text);
    if (!FOLLOW_UP_CHOICES.includes(days)) return;
    try {
      await saveSettings({ followUpDays: days });
      setStatus(null);
      reload();
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not save that change. Try again.') });
    }
  }
  return (
    <section className="ab-section" aria-labelledby="h-followup">
      <h2 className="ab-h" id="h-followup">{t('My work')}</h2>
      <div className="ab-field">
        <label className="ab-label" htmlFor="follow-up-days">{t('Follow-ups due after')}</label>
        <select id="follow-up-days" className="ab-select" value={String(value)} aria-describedby="follow-up-hint" onChange={(e) => change(e.target.value)}>
          {FOLLOW_UP_CHOICES.map((d) => (
            <option key={d} value={String(d)}>{tn(d, '{n} day', '{n} days')}</option>
          ))}
        </select>
        <span className="ab-hint" id="follow-up-hint">{t('A customer who has not had an update, or has not answered, for this long shows under follow-ups in My work.')}</span>
      </div>
      <Status status={status} />
    </section>
  );
}

/**
 * "Copy diagnostics": versions, settings without any key, the policy in short, the sites, and the last problems of the activity log,
 * as plain text for support (src/options/diagnostics.js decides what goes in). Shown before it is copied.
 */
export function DiagnosticsSection({ eff }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState(null);

  async function build() {
    const [keyMode, listed, audit] = await Promise.all([
      eff.values.providedApiKey ? Promise.resolve('none') : keyStore().mode(eff.values.provider).catch(() => 'none'),
      Promise.resolve()
        .then(() => chrome.runtime.sendMessage({ type: MSG.LIST_INSTANCES }))
        .catch(() => null),
      readAudit().catch(() => []),
    ]);
    let manifest = {};
    try {
      manifest = chrome.runtime.getManifest();
    } catch {
      manifest = {};
    }
    return diagnosticsText({ manifest, userAgent: navigator.userAgent, eff, keyMode, instances: Array.isArray(listed?.instances) ? listed.instances : eff.values.instances || [], audit });
  }

  async function copy() {
    setStatus(null);
    try {
      const made = await build();
      setText(made);
      await navigator.clipboard.writeText(made);
      setStatus({ kind: 'ok', text: t('Copied. Paste it into your message to support. It holds no key and no ticket content.') });
    } catch {
      setStatus({ kind: 'warn', text: t('The browser did not let Agent Buddy copy it. Select the text below and copy it yourself.') });
    }
  }

  return (
    <section className="ab-section" aria-labelledby="h-diagnostics">
      <h2 className="ab-h" id="h-diagnostics">{t('Help from support')}</h2>
      <p className="ab-sub">{t("Copies the versions, your settings without any key, your organisation's policy in short and the last problems. No ticket content.")}</p>
      <div className="ab-row">
        <button type="button" className="ab-btn" onClick={copy}>{t('Copy diagnostics')}</button>
      </div>
      <Status status={status} />
      {text && (
        <details className="ab-more">
          <summary>{t('What was copied')}</summary>
          <pre className="ab-diagnostics" tabIndex={0}>{text}</pre>
        </details>
      )}
    </section>
  );
}

/** Which page of Settings the address asks for: '#ai' is AI Assist, anything else Basics. */
export const settingsPageFromHash = (hash) => (String(hash || '').replace(/^#/, '').toLowerCase() === 'ai' ? 'ai' : 'basics');

// (made when the page is drawn, so the labels follow the language)
const pages = () => [
  { id: 'basics', label: t('Basics') },
  { id: 'ai', label: t('AI Assist') },
];

/** The AI Assist page: the provider, its key, the model and the limits; when the organisation switched AI off, only that. */
export function AiAssistPage({ eff, reload, epoch }) {
  if (eff.policy?.aiEnabled === false) {
    return (
      <section className="ab-section" aria-labelledby="h-ai-off">
        <h2 className="ab-h" id="h-ai-off">{t('AI is switched off')}</h2>
        <p className="ab-sub">
          {t('Your organisation has switched off AI in Agent Buddy. Everything under Insights still works: facts, lists, checks and templates, read from ServiceNow with your own session. Nothing is sent anywhere.')}
        </p>
      </section>
    );
  }
  return (
    <>
      <p className="ab-sub ab-page-intro">
        {t('AI Assist writes summaries, replies and notes with the AI provider you choose. Personal data is masked first, and you can see what is sent.')}
        {eff.values.aiSkipped ? ` ${t('You chose to skip AI for now: untick it under Basics, "What you work on", to use it.')}` : ''}
      </p>
      <ProviderSection eff={eff} reload={reload} />
      <FormatsSection eff={eff} reload={reload} />
      <UsageSection key={`usage-${epoch}`} eff={eff} />
    </>
  );
}

export default function Options() {
  const [eff, setEff] = useState(null);
  const lang = useLanguage(eff?.values?.language); // before anything below draws a text
  useTheme(eff?.values?.theme);
  useEffect(() => {
    document.title = t('Agent Buddy settings'); // the tab's name, in the language of the page
  }, [lang]);
  const [failed, setFailed] = useState('');
  const [epoch, setEpoch] = useState(0); // bumped after "clear everything" so every section shows what is left
  // Reads overlap (a save, its storage event and a key move each ask for one) and can finish in any order: only the newest is shown.
  const newest = useRef(0);
  const reload = useCallback(async () => {
    newest.current += 1;
    const mine = newest.current;
    try {
      const [e, raw] = await Promise.all([loadEffective(), loadSettings()]);
      const store = keyStore();
      const provider = e.values.provider;
      const provided = e.values.providedApiKey;
      const apiKey = provided || (await store.load(provider));
      const keyLocked = !apiKey && (await store.isLocked(provider));
      // Where the saved key is kept, read with the key itself: the line under the key box follows every save, move, unlock and
      // removal, here or in another page. (A key the organisation supplies has no key box.)
      const keyMode = provided ? 'none' : await store.mode(provider);
      const needsEncryption = !provided && (await store.needsEncryption(provider));
      if (mine !== newest.current) return; // a newer read started meanwhile: what it finds is the one to show
      setFailed('');
      // floors: the policy's minimum for a setting the person may still raise; savedProvider: the person's own choice, before policy.
      setEff({ values: e.values, locked: e.locked, floors: e.floors || {}, policy: e.policy, apiKey, keyLocked, keyMode, needsEncryption, savedProvider: String(raw?.provider || '') });
    } catch (err) {
      if (mine !== newest.current) return;
      setFailed(err?.message || t('The settings could not be read.'));
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  // Another page (the side panel, a second settings tab) changed the settings, the policy or the key: show it. Only those
  // (src/lib/settingsChanges.js): the logs written on every AI call change nothing here.
  useEffect(() => {
    const onChange = (changes, areaName) => {
      if (settingsChangeMatters(changes, areaName)) reload();
    };
    try {
      chrome.storage.onChanged.addListener(onChange);
      return () => chrome.storage.onChanged.removeListener(onChange);
    } catch {
      return undefined;
    }
  }, [reload]);

  if (failed) return <div className="ab-page"><p className="ab-note ab-note-danger" role="alert">{t('{failed} Close this tab and open Settings again.', { failed })}</p></div>;
  if (!eff) return <div className="ab-page"><p className="ab-sub">{t('Loading…')}</p></div>;
  return (
    <main className="ab-page" key={lang}>
      <h1 className="ab-h ab-page-title">{t('Agent Buddy settings')}</h1>
      <SettingsPages eff={eff} reload={reload} epoch={epoch} onCleared={() => { setEpoch((n) => n + 1); reload(); }} />
    </main>
  );
}

/**
 * Settings in two pages (TRACKER.md F2): Basics (where it works, what you work on, privacy in plain words, what it keeps) and AI Assist
 * (the provider, key, model and limits). The page is part of the address (options.html#ai), so the side panel can open the AI page
 * straight away and a reload stays where it was.
 */
export function SettingsPages({ eff, reload, epoch = 0, onCleared = () => {}, initial }) {
  const [page, setPage] = useState(() => initial || settingsPageFromHash(typeof location !== 'undefined' ? location.hash : ''));
  useEffect(() => {
    const onHash = () => setPage(settingsPageFromHash(location.hash));
    try {
      window.addEventListener('hashchange', onHash);
      return () => window.removeEventListener('hashchange', onHash);
    } catch {
      return undefined;
    }
  }, []);
  const choose = (id) => {
    setPage(id);
    try {
      history.replaceState(null, '', id === 'ai' ? '#ai' : `${location.pathname}${location.search}`);
    } catch {
      /* the address stays as it was; the page still changes */
    }
  };
  const managedNote = Object.keys(eff.locked).some((k) => !eff.floors?.[k]);
  return (
    <>
      <Tabs idBase="ab-settings" label={t('Settings pages')} className="ab-row ab-settings-tabs" tabs={pages()} value={page} onChange={choose} />
      {managedNote && <p className="ab-note ab-note-warn">{t('Some settings are managed by your organisation and cannot be changed.')}</p>}
      <div id={panelId('ab-settings', 'basics')} role="tabpanel" aria-labelledby={tabId('ab-settings', 'basics')} hidden={page !== 'basics'}>
        <p className="ab-sub ab-page-intro">{t('Where Agent Buddy works, what you work on, how personal data is protected, and what it keeps on this computer.')}</p>
        <AppearanceSection eff={eff} reload={reload} />
        <LanguageSection eff={eff} reload={reload} />
        <InstancesSection eff={eff} reload={reload} />
        <ProfilesSection eff={eff} reload={reload} />
        <FollowUpSection eff={eff} reload={reload} />
        <ShortcutsSection />
        <QuickBarSection eff={eff} reload={reload} />
        {Object.keys(eff.floors || {}).length > 0 && <p className="ab-note">{t('Your organisation sets a minimum for some privacy settings. You can always choose a stricter one.')}</p>}
        <PrivacySection eff={eff} reload={reload} />
        <PolicySection eff={eff} />
        <AuditSection key={`audit-${epoch}`} eff={eff} />
        {/* Not keyed by epoch like its neighbours: it reads what is left itself after clearing, and a new one would lose the outcome. */}
        <StoredDataSection eff={eff} onCleared={onCleared} />
        <DiagnosticsSection eff={eff} />
        <section className="ab-section" aria-labelledby="h-leaves">
          <h2 className="ab-h" id="h-leaves">{t('What leaves your computer')}</h2>
          <p className="ab-sub">
            {t('Only two things: reads from your own ServiceNow instance, and the masked text sent to the AI address you chose. Agent Buddy has no server, no analytics and no tracking. It never saves or changes a ServiceNow record by itself: when you choose Insert it fills the field on the open form and you press Save.')}
          </p>
        </section>
      </div>
      <div id={panelId('ab-settings', 'ai')} role="tabpanel" aria-labelledby={tabId('ab-settings', 'ai')} hidden={page !== 'ai'}>
        <AiAssistPage eff={eff} reload={reload} epoch={epoch} />
      </div>
    </>
  );
}

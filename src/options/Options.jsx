import { useCallback, useEffect, useRef, useState } from 'react';
import { PROVIDERS, resolveProviderConfig } from '../providers/config.js';
import { sendChat, truncationNote } from '../providers/index.js';
import { createFirewall } from '../pii/index.js';
import { validateBaseUrl, splitAzureAddress, azureOptions, isAzureHost, AZURE_DEFAULT_API_VERSION, summarize, tokensUsedToday, USAGE_KEY } from '../lib/aiUsage.js';
import { ensureAiPermission } from '../lib/aiPermission.js';
import { loadEffective, loadSettings, saveSettings, keyStore, keyVault, readAudit, clearAudit } from '../lib/storage.js';
import { cleanKey, keyPreview, MIN_PASSPHRASE } from '../lib/keyStore.js';
import { listModels, canListModels } from '../providers/models.js';
import { readBudgetState, saveCaps } from '../providers/budget.js';
import { modelChoices } from '../lib/modelChoices.js';
import { auditToCsv } from '../audit/auditLog.js';
import { connectionProblem } from '../lib/pipeline.js';
import { MSG } from '../lib/messages.js';
import { clearAllStored, summarizeStored } from '../lib/storedData.js';
import { instancePattern, normalizeInstance, isInstanceAllowed, checkProviderAllowed, PII_MODES, PREVIEW_MODES, KEY_STORAGE_MODES } from '../policy/policy.js';
import { allowedProviderIds, dailyTokenLimit, hostAccessMode, looserThanFloor, parseDeployments, parseLimit, unknownDisabledFeatures } from './policyNotes.js';
import { diagnosticsText } from './diagnostics.js';
import ProfilePicker from './ProfilePicker.jsx';
import Tabs from '../sidepanel/Tabs.jsx';
import { panelId, tabId } from '../sidepanel/tabKeys.js';

const KEY_MODE_TEXT = {
  local: "Kept in Agent Buddy's own storage in this browser. ServiceNow pages cannot read it, but anyone who can read your browser profile on disk can. Use a key with a spend limit.",
  session: 'Kept in memory only and forgotten when the browser closes. Nothing is written to disk. You enter it again next time.',
  encrypted: 'Kept encrypted with a passphrase. You enter the passphrase once per browser session.',
};
const KEY_MODE_LABEL = { local: 'This browser (simple)', session: 'Memory only (forgotten on close)', encrypted: 'Encrypted with a passphrase' };
const KEY_WHERE = { local: 'this browser', session: 'memory only', encrypted: 'this browser, encrypted' };
const SHOW_SAVED_MS = 20000; // a saved key that was shown in full hides itself again after this long
const TEST_TIMEOUT_MS = 45000; // "Test connection" asks for one word; it should not keep the page waiting for minutes
const PII_TEXT = {
  standard: 'Masks detected personal data (names on the ticket, emails, phone and card numbers, IDs, secrets).',
  strict: 'Also refuses sensitive fields and keeps HR free text out entirely.',
  'local-only': 'Only allows an AI model running on this computer. Nothing leaves it.',
};
const PREVIEW_TEXT = { always: 'Show the exact outgoing text every time', first: 'Show it the first time for each action', never: 'Do not show it' };
const PII_LABEL = { standard: 'Standard', strict: 'Strict', 'local-only': 'Local model only' };

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
  if (keyMode === 'none') return <span className="ab-hint" id="key-saved">No key is saved for {def.label}.</span>;
  if (!apiKey) return <span className="ab-hint" id="key-saved">A key is saved but locked. Unlock it above with your passphrase.</span>;
  const { preview, length } = keyPreview(apiKey);
  return (
    <span className="ab-hint" id="key-saved">
      Saved: {preview ? <code className="ab-mono">{preview}</code> : null} ({length} characters), kept in {KEY_WHERE[keyMode] || 'this browser'}.
      {wanted && keyMode !== wanted ? ` That is not where you chose to keep it ("${KEY_MODE_LABEL[wanted]}"): see below.` : ''}{' '}
      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={onToggle} aria-pressed={shown} aria-controls="key-full">{shown ? 'Hide saved key' : 'Show saved key'}</button>
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
    setStatus({ kind: 'ok', text: 'The address you pasted was split into its parts: the resource address, the form, the version and the deployment below.' });
  }

  async function saveDeployments(text) {
    const { ids, bad } = parseDeployments(text);
    setDeploymentsError(bad.length ? `Not a deployment name Azure allows: ${bad.join(', ')}. Use letters, digits, - _ and .` : '');
    await change({ modelLists: { ...v.modelLists, azure: ids } });
  }

  const addressProblem = addressError || (!check.ok ? check.error : '');
  return (
    <>
      <div className="ab-field">
        <label className="ab-label" htmlFor="baseurl">Resource address (required)</label>
        <DraftInput
          id="baseurl"
          className="ab-input ab-mono"
          value={typed}
          readOnly={lockedAddress}
          placeholder="https://your-resource.openai.azure.com"
          aria-invalid={addressProblem ? true : undefined}
          aria-describedby={describedBy('baseurl-hint', addressProblem && 'baseurl-error')}
          onSave={saveAddress}
        />
        <FieldError id="baseurl-error" text={addressProblem} />
        <span className="ab-hint" id="baseurl-hint">
          The &quot;Endpoint&quot; of your Azure OpenAI resource, from &quot;Keys and Endpoint&quot; in the Azure portal. You can also paste a whole
          address that ends in ?api-version=...: it is split into the fields below.
          {host && !isAzureHost(host) ? ' This is not an Azure OpenAI address (…openai.azure.com). That is fine for a company gateway in front of Azure.' : ''}
        </span>
        <Locked why={eff.locked.baseUrl} />
      </div>

      {/* Technical details, folded: most resources use the recommended form. Open when the older form is chosen or its version is wrong. */}
      <details className="ab-more" open={az.form === 'deployment' && !az.apiVersionOk}>
        <summary>Technical details: how Agent Buddy calls Azure</summary>
        <div className="ab-field">
          <label className="ab-label" htmlFor="azure-form">How to call it</label>
          <select id="azure-form" className="ab-select" value={az.form} aria-describedby="azure-form-hint" onChange={(e) => change({ azure: { ...(v.azure || {}), form: e.target.value } })}>
            <option value="v1">v1 API (recommended): /openai/v1</option>
            <option value="deployment">Deployment address with an api-version (older resources)</option>
          </select>
          <span className="ab-hint" id="azure-form-hint">
            {az.form === 'v1'
              ? 'Sends to <resource>/openai/v1/chat/completions with the deployment name as the model.'
              : 'Sends to <resource>/openai/deployments/<deployment>/chat/completions?api-version=<version>.'}
          </span>
        </div>

        {az.form === 'deployment' && (
          <div className="ab-field">
            <label className="ab-label" htmlFor="azure-version">API version</label>
            <DraftInput
              id="azure-version"
              className="ab-input ab-mono"
              value={v.azure?.apiVersion || ''}
              placeholder={AZURE_DEFAULT_API_VERSION}
              aria-invalid={!az.apiVersionOk ? true : undefined}
              aria-describedby={describedBy('azure-version-hint', !az.apiVersionOk && 'azure-version-error')}
              onSave={(text) => change({ azure: { ...(v.azure || {}), apiVersion: text.trim() } })}
            />
            <FieldError id="azure-version-error" text={az.apiVersionOk ? '' : 'An API version looks like 2024-10-21 or 2025-04-01-preview.'} />
            <span className="ab-hint" id="azure-version-hint">Leave empty for {AZURE_DEFAULT_API_VERSION}. Use the version your administrator gave you if it differs.</span>
          </div>
        )}
      </details>

      <div className="ab-field">
        <label className="ab-label" htmlFor="model">Deployment name (required)</label>
        <DraftInput
          id="model"
          className="ab-input ab-mono"
          value={model}
          disabled={Boolean(eff.locked.model)}
          aria-describedby="model-hint"
          onSave={(text) => change({ models: { ...v.models, azure: text.trim() } })}
        />
        <span className="ab-hint" id="model-hint">
          The name of the deployment in Azure AI Foundry, under Deployments (it can differ from the model&apos;s name). Azure does not give a key a
          list of deployments, so there is no &quot;Load models&quot; here.
        </span>
        <Locked why={eff.locked.model} />
      </div>

      {!eff.locked.model && (
        <div className="ab-field">
          <label className="ab-label" htmlFor="azure-deployments">Other deployments to switch between (optional)</label>
          <DraftInput
            id="azure-deployments"
            className="ab-input ab-mono"
            value={otherIds.join(', ')}
            placeholder="gpt-5-mini, gpt-5"
            aria-invalid={deploymentsError ? true : undefined}
            aria-describedby={describedBy('azure-deployments-hint', deploymentsError && 'azure-deployments-error')}
            onSave={saveDeployments}
          />
          <FieldError id="azure-deployments-error" text={deploymentsError} />
          <span className="ab-hint" id="azure-deployments-hint">Separate names with commas. They appear in the model switch at the top of the side panel.</span>
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
  const [keyMode, setKeyMode] = useState('none');
  const [needsEncryption, setNeedsEncryption] = useState(false);
  const [busy, setBusy] = useState(''); // '' | 'test' | 'models' | 'key'
  const [showTyped, setShowTyped] = useState(false); // the box shows what was typed instead of dots
  const [showSaved, setShowSaved] = useState(false); // the saved key is shown in full (hides itself again)
  const running = useRef(null); // the AbortController of a test or a list that is running
  const store = () => keyStore(); // made when used, never while drawing

  useEffect(() => {
    let live = true;
    const s = store();
    Promise.all([s.mode(v.provider), s.needsEncryption(v.provider)])
      .then(([mode, enc]) => {
        if (!live) return;
        setKeyMode(mode);
        setNeedsEncryption(enc);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [v.provider, eff.apiKey, eff.keyLocked]);

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
      setStatus({ kind: 'danger', text: 'The browser did not save that change. Try again.' });
      return false;
    }
  }

  // The key that a test uses: one typed in the box and not saved yet is the one the person wants tested; otherwise the saved one.
  const keyForUse = () => cleanKey(key) || eff.apiKey;

  async function saveKey() {
    setStatus(null);
    // An empty box never removes a saved key by accident: that is what "Remove saved key" is for.
    if (!cleanKey(key)) {
      setStatus({ kind: 'warn', text: keyMode === 'none' ? 'Paste your key in the key box first, then press Save key.' : 'The key box is empty. To remove the saved key, press "Remove saved key".' });
      return;
    }
    setBusy('key');
    try {
      if (v.keyStorage === 'encrypted' && passphrase.length < MIN_PASSPHRASE) throw new Error(`Choose a passphrase of at least ${MIN_PASSPHRASE} characters to encrypt the key.`);
      await store().save({ provider: v.provider, key, mode: v.keyStorage, passphrase });
      setKey('');
      setPassphrase('');
      setStatus({ kind: 'ok', text: `Key saved. (${cleanKey(key).length} characters)` });
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
      setStatus({ kind: 'ok', text: 'Key removed.' });
      reload();
    } catch {
      setStatus({ kind: 'danger', text: 'The browser did not let Agent Buddy remove the key. Try again.' });
    }
  }

  async function unlock() {
    setStatus(null);
    setBusy('key');
    try {
      await store().unlock(v.provider, unlockPass);
      setUnlockPass('');
      setStatus({ kind: 'ok', text: needsEncryption ? 'The saved key is now encrypted with your passphrase, and unlocked for this browser session.' : 'Unlocked for this browser session.' });
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
      setStatus({ kind: 'warn', text: 'Your saved key is still kept as before. Choose a passphrase below and press "Encrypt the saved key".' });
      return;
    }
    try {
      await store().changeMode({ provider: v.provider, mode: next });
      setStatus({ kind: 'ok', text: `The saved key was moved: it is now kept in ${KEY_WHERE[next]}.` });
      reload();
    } catch (err) {
      setStatus({ kind: 'danger', text: `${err.message} The saved key was not moved.` });
    }
  }

  async function encryptSaved() {
    setStatus(null);
    setBusy('key');
    try {
      if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Choose a passphrase of at least ${MIN_PASSPHRASE} characters.`);
      await store().changeMode({ provider: v.provider, mode: 'encrypted', passphrase });
      setPassphrase('');
      setStatus({ kind: 'ok', text: 'The saved key is now encrypted with your passphrase.' });
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
      if (err?.code === 'CANCELLED') setStatus({ kind: 'warn', text: 'Cancelled.' });
      else setStatus({ kind: 'danger', text: err?.message || 'Something went wrong.' });
    } finally {
      if (running.current === controller) running.current = null;
      setBusy('');
    }
  }

  const test = () =>
    withCancel('test', async (signal) => {
      const useKey = keyForUse();
      const cfg = resolveProviderConfig(v, useKey);
      // The same refusal as every real send: no address for "my own server" must never fall back to a public API with this key.
      const problem = connectionProblem(cfg);
      if (problem) throw new Error(problem);
      // The organisation's provider, address and model rules apply to a test as to every run: the key never goes to an address
      // the policy does not allow, and the browser is not even asked for permission to contact it.
      const permitted = checkProviderAllowed(cfg, eff.policy);
      if (!permitted.ok) throw new Error(permitted.reason);
      if (def.azure && !cfg.model) throw new Error('Enter the name of your Azure deployment first.');
      if (!useKey && !cfg.keyOptional) throw new Error(`There is no ${def.label} key yet. Paste it in the key box, press Save key, then test again.`);
      // A hosted provider needs the browser's permission for its address first (requested from this click).
      await ensureAiPermission(cfg);
      // The test goes through the same firewall as everything else: there is no side door to the provider.
      const fw = createFirewall({ mode: 'standard', people: [], blockedFields: [], endpointIsLocal: cfg.local });
      const request = fw.buildRequest({ feature: 'connection-test', table: '', system: 'Reply with the single word OK.', userInstruction: 'ping', parts: [] });
      const reply = await sendChat(cfg, request, { kind: 'validate', skipBudget: true, signal, timeoutMs: cfg.local ? undefined : TEST_TIMEOUT_MS });
      const typed = cleanKey(key);
      const unsaved = typed && typed !== eff.apiKey ? ' This key is not saved yet: press Save key to keep it.' : '';
      const cut = reply.truncated ? ` ${truncationNote(reply)}` : '';
      setStatus({ kind: 'ok', text: `Connected. The model answered: ${String(reply.content).slice(0, 40)}${unsaved}${cut}` });
    });

  // The models the server offers, so one can be picked instead of typed. Only the key goes out (to the address chats go to).
  const loadModels = () =>
    withCancel('models', async (signal) => {
      const cfg = resolveProviderConfig(v, keyForUse());
      const problem = connectionProblem(cfg);
      if (problem) throw new Error(problem);
      // The list call carries the key too: same provider and address rules. The model is not checked here (the list is cut to the
      // allowed models below), so allowedModels is left out of this check.
      const permitted = checkProviderAllowed({ provider: cfg.provider, baseUrl: cfg.baseUrl, model: '' }, { ...eff.policy, allowedModels: null });
      if (!permitted.ok) throw new Error(permitted.reason);
      if (!cfg.apiKey && !cfg.keyOptional) throw new Error(`There is no ${def.label} key yet. Paste it in the key box, press Save key, then load the models.`);
      await ensureAiPermission(cfg);
      let ids = await listModels(cfg, undefined, { signal });
      const allowed = eff.policy?.allowedModels;
      if (allowed?.length) ids = ids.filter((id) => allowed.includes(id));
      if (!(await change({ modelLists: { ...v.modelLists, [v.provider]: ids } }))) return;
      setStatus({ kind: 'ok', text: `Found ${ids.length} model${ids.length === 1 ? '' : 's'}. Pick one from the list, or type a name.` });
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
    if (!offered.length) providerNote = 'Your organisation allows no AI provider that this version of Agent Buddy knows. Ask your administrator.';
    else if (saved && !offered.includes(saved)) {
      providerNote = `Your organisation does not allow ${PROVIDERS[saved].label}, which you chose before. Agent Buddy uses ${def.label} instead; choose one of the providers in the list.`;
    }
  }

  const testButtons = (
    <>
      <button type="button" className="ab-btn" onClick={test} disabled={Boolean(busy)}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
      {busy === 'test' && (
        <button type="button" className="ab-btn ab-btn-quiet" onClick={() => running.current?.abort()}>Cancel</button>
      )}
    </>
  );

  return (
    <section className="ab-section" aria-labelledby="h-provider">
      <h2 className="ab-h" id="h-provider">AI provider</h2>
      <p className="ab-sub">Use any provider you have a key for, Azure OpenAI, a company gateway, or a model on this computer.</p>

      <div className="ab-field">
        <label className="ab-label" htmlFor="provider">Provider</label>
        <select id="provider" className="ab-select" value={v.provider} disabled={Boolean(eff.locked.provider)} aria-describedby={providerNote ? 'provider-note' : undefined} onChange={(e) => { setStatus(null); change({ provider: e.target.value }); }}>
          {offered.map((id) => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
          {!offered.includes(v.provider) && <option value={v.provider} disabled>{def.label} (not allowed)</option>}
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
              <summary>Technical details: the address requests go to</summary>
              <p className="ab-hint">
                <span className="ab-mono">{def.baseUrl}</span> (the provider&apos;s own address). Only masked text is sent there, after you have seen it.
              </p>
            </details>
          )}
          {def.userBaseUrl && (
            <div className="ab-field">
              <label className="ab-label" htmlFor="baseurl">Address {def.userBaseUrl ? (needsAddress ? '(required)' : '(optional)') : ''}</label>
              <DraftInput
                id="baseurl"
                className="ab-input ab-mono"
                value={def.baseUrl || baseUrlTyped}
                readOnly={!def.userBaseUrl || Boolean(eff.locked.baseUrl)}
                placeholder="https://your-gateway.example.com/v1"
                aria-invalid={!baseCheck.ok ? true : undefined}
                aria-describedby={describedBy('baseurl-hint', !baseCheck.ok && 'baseurl-error')}
                onSave={(text) => change({ baseUrls: { ...v.baseUrls, [v.provider]: text } })}
              />
              <FieldError id="baseurl-error" text={baseCheck.ok ? '' : baseCheck.error} />
              <span className="ab-hint" id="baseurl-hint">
                {!def.userBaseUrl
                  ? "This provider's own address."
                  : needsAddress
                    ? 'The address of your OpenAI-compatible server, for example http://localhost:1234/v1.'
                    : "Leave empty to use the provider's own API. A company gateway goes here (the address it gave out, usually ending in /v1)."}
                {v.provider === 'openai' && isAzureHost(typedHost) ? ' This looks like an Azure OpenAI address: choose the provider "Azure OpenAI" so the key is sent the way Azure expects.' : ''}
              </span>
              <Locked why={eff.locked.baseUrl} />
            </div>
          )}

          <div className="ab-field">
            <label className="ab-label" htmlFor="model">Model</label>
            <DraftInput id="model" className="ab-input ab-mono" list="models" value={model} disabled={Boolean(eff.locked.model)} aria-describedby="model-hint" onSave={(text) => change({ models: { ...v.models, [v.provider]: text.trim() } })} />
            <datalist id="models">{choices.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
            {listable && !eff.locked.model && (
              <div className="ab-row" style={{ marginTop: 6 }}>
                {loadedModels.length > 0 && (
                  <select id="model-pick" className="ab-select" aria-label="Pick a model from the list" value={choices.some((c) => c.id === model) ? model : ''} onChange={(e) => e.target.value && change({ models: { ...v.models, [v.provider]: e.target.value } })}>
                    {!choices.some((c) => c.id === model) && <option value="">Pick a model…</option>}
                    {choices.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                )}
                <button type="button" id="load-models" className="ab-btn" onClick={loadModels} disabled={Boolean(busy)}>{busy === 'models' ? 'Loading…' : loadedModels.length ? 'Reload the list' : 'Load models from the server'}</button>
                {busy === 'models' && <button type="button" className="ab-btn ab-btn-quiet" onClick={() => running.current?.abort()}>Cancel</button>}
              </div>
            )}
            <span className="ab-hint" id="model-hint">
              {listable
                ? 'Your server may offer several models. Load the list to pick one, or type the exact name your administrator gave you.'
                : 'Pick one from the list (start typing), or type the exact model id, for example claude-sonnet-5-5.'}
            </span>
            <Locked why={eff.locked.model} />
          </div>
        </>
      )}

      {eff.locked.apiKey ? (
        <>
          <p className="ab-note ab-note-ok">The AI key is provided by your organisation. It is never shown here.</p>
          <div className="ab-row" style={{ marginTop: 8 }}>{testButtons}</div>
        </>
      ) : (
        <>
          <div className="ab-field">
            <label className="ab-label" htmlFor="keystorage">Where to keep the key</label>
            <select id="keystorage" className="ab-select" value={v.keyStorage} disabled={Boolean(eff.locked.keyStorage)} aria-describedby="keystorage-hint" onChange={(e) => changeKeyStorage(e.target.value)}>
              {KEY_STORAGE_MODES.map((m) => <option key={m} value={m}>{KEY_MODE_LABEL[m]}</option>)}
            </select>
            <span className="ab-hint" id="keystorage-hint">{KEY_MODE_TEXT[v.keyStorage]}</span>
            <Locked why={eff.locked.keyStorage} />
          </div>

          {eff.keyLocked && (
            <div className="ab-field">
              <label className="ab-label" htmlFor="unlock">{needsEncryption ? 'Choose a passphrase to encrypt your saved key' : 'Passphrase to unlock the saved key'}</label>
              <div className="ab-row">
                <input id="unlock" type="password" className="ab-input" value={unlockPass} onChange={(e) => setUnlockPass(e.target.value)} onKeyDown={onEnter(() => unlockPass && unlock())} autoComplete={needsEncryption ? 'new-password' : 'off'} aria-describedby={needsEncryption ? 'unlock-hint' : undefined} />
                <button type="button" className="ab-btn" onClick={unlock} disabled={!unlockPass || Boolean(busy)}>{needsEncryption ? 'Encrypt' : 'Unlock'}</button>
              </div>
              {needsEncryption && (
                <span className="ab-hint" id="unlock-hint">
                  Your organisation requires the key to be encrypted, so the key saved earlier is not used until it has a passphrase (at least {MIN_PASSPHRASE} characters).
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
                placeholder={keyMode === 'none' ? def.keyPlaceholder || '' : 'A key is saved. Type a new one to replace it.'}
                aria-describedby="key-hint key-saved"
              />
              <button type="button" className="ab-btn" onClick={() => setShowTyped((on) => !on)} aria-pressed={showTyped} aria-controls="key">{showTyped ? 'Hide' : 'Show'}</button>
            </div>
            <span className="ab-hint" id="key-hint">{def.keyHint}</span>
            {cleanKey(key) && <span className="ab-hint" id="key-unsaved" role="status">Typed, not saved yet ({cleanKey(key).length} characters). Press Save key to keep it.</span>}
            <SavedKeyLine def={def} keyMode={keyMode} wanted={v.keyStorage} apiKey={eff.apiKey} shown={showSaved} onToggle={() => setShowSaved((on) => !on)} />
          </div>
          {v.keyStorage === 'encrypted' && (
            <div className="ab-field">
              <label className="ab-label" htmlFor="pass">Passphrase</label>
              <input id="pass" type="password" className="ab-input" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} onKeyDown={onEnter(() => cleanKey(key) && saveKey())} autoComplete="new-password" aria-describedby="pass-hint" />
              <span className="ab-hint" id="pass-hint">
                At least {MIN_PASSPHRASE} characters; a few words are easy to remember and hard to guess. There is no way to recover a forgotten passphrase: you would enter the key again.
              </span>
              {(keyMode === 'local' || keyMode === 'session') && !cleanKey(key) && (
                <div className="ab-row" style={{ marginTop: 6 }}>
                  <button type="button" className="ab-btn" onClick={encryptSaved} disabled={!passphrase || Boolean(busy)}>Encrypt the saved key</button>
                </div>
              )}
            </div>
          )}
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-primary" onClick={saveKey} disabled={busy === 'key'}>Save key</button>
            {keyMode !== 'none' && (
              <button type="button" className="ab-btn" onClick={removeKey}>
                Remove saved key
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
      setStatus({ kind: 'danger', text: 'The browser did not save the limit. Try again.' });
    }
  }

  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  return (
    <section className="ab-section" aria-labelledby="h-usage">
      <h2 className="ab-h" id="h-usage">Usage and limits</h2>
      <p className="ab-sub">
        Counted on this computer from the usage log (no text is kept). Today: {fmt(today.calls)} call{today.calls === 1 ? '' : 's'}, {fmt(today.tokens)} tokens.
        This month: {fmt(month.calls)} calls, {fmt(month.tokens)} tokens.
      </p>
      <p className={`ab-note ${limit.left === 0 ? 'ab-note-warn' : ''}`} id="limit-applies" role="status">{limit.text}</p>
      <div className="ab-field" style={{ marginTop: 12 }}>
        <label className="ab-label" htmlFor="cap-tokens">Your own daily token limit</label>
        <DraftInput
          id="cap-tokens"
          className="ab-input"
          inputMode="numeric"
          value={own.dailyTokens ? String(own.dailyTokens) : ''}
          placeholder="No limit"
          aria-invalid={errors.dailyTokens ? true : undefined}
          aria-describedby={describedBy('cap-tokens-hint', errors.dailyTokens && 'cap-tokens-error')}
          onSave={(text) => saveLimit('dailyTokens', text)}
        />
        <FieldError id="cap-tokens-error" text={errors.dailyTokens} />
        <span className="ab-hint" id="cap-tokens-hint">Nothing is sent once today&apos;s tokens reach it. Leave empty for no limit of your own.</span>
      </div>
      <div className="ab-field">
        <label className="ab-label" htmlFor="cap-calls">Your own daily limit of AI calls</label>
        <DraftInput
          id="cap-calls"
          className="ab-input"
          inputMode="numeric"
          value={own.dailyCalls ? String(own.dailyCalls) : ''}
          placeholder="No limit"
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
// stays usable and only the looser choices are switched off, with a note saying what the minimum is.
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
      setStatus({ kind: 'danger', text: 'The browser did not save that change. Try again.' });
    }
  };
  return (
    <section className="ab-section" aria-labelledby="h-privacy">
      <h2 className="ab-h" id="h-privacy">Privacy</h2>
      <p className="ab-sub">Before anything goes to an AI, Agent Buddy hides names, email addresses, phone and card numbers and other personal data. These two choices say how strictly, and when you see the text first.</p>
      <div className="ab-field">
        <label className="ab-label" htmlFor="pii">Personal-data protection</label>
        <select
          id="pii"
          className="ab-select"
          value={v.piiMode}
          disabled={Boolean(eff.locked.piiMode) && !piiFloor}
          aria-describedby={describedBy('pii-hint', piiFloor && 'pii-floor')}
          onChange={(e) => !looserThanFloor('piiMode', e.target.value, piiFloor) && change({ piiMode: e.target.value })}
        >
          {PII_MODES.map((m) => <option key={m} value={m} disabled={looserThanFloor('piiMode', m, piiFloor)}>{PII_LABEL[m]}</option>)}
        </select>
        <span className="ab-hint" id="pii-hint">{PII_TEXT[v.piiMode]}</span>
        {piiFloor ? <span className="ab-locked" id="pii-floor">Your organisation requires at least {PII_LABEL[piiFloor]}.</span> : <Locked why={eff.locked.piiMode} />}
      </div>
      <div className="ab-field">
        <label className="ab-label" htmlFor="preview">Check what is sent</label>
        <select
          id="preview"
          className="ab-select"
          value={v.previewMode}
          disabled={Boolean(eff.locked.previewMode) && !previewFloor}
          aria-describedby={previewFloor ? 'preview-floor' : undefined}
          onChange={(e) => !looserThanFloor('previewMode', e.target.value, previewFloor) && change({ previewMode: e.target.value, previewSeen: [] })}
        >
          {PREVIEW_MODES.map((m) => <option key={m} value={m} disabled={looserThanFloor('previewMode', m, previewFloor)}>{PREVIEW_TEXT[m]}</option>)}
        </select>
        {previewFloor ? <span className="ab-locked" id="preview-floor">Your organisation requires at least: {PREVIEW_TEXT[previewFloor]}.</span> : <Locked why={eff.locked.previewMode} />}
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
      setStatus({ kind: 'danger', text: 'The browser did not save that change. Try again.' });
    }
  };
  return (
    <section className="ab-section" aria-labelledby="h-quick">
      <h2 className="ab-h" id="h-quick">Quick actions</h2>
      <p className="ab-sub">
        A short bar of the main actions for the ticket that is open: at the top of the side panel, and as a small tab on the edge of the ServiceNow
        page. Choose which actions it holds with Choose in the panel.
      </p>
      <label className="ab-check">
        <input id="page-bar" type="checkbox" checked={v.pageBar !== false} disabled={Boolean(eff.locked.pageBar)} onChange={(e) => change({ pageBar: e.target.checked })} />
        <span>Show the bar on ServiceNow pages. A click opens the side panel and starts the action there.</span>
      </label>
      <Locked why={eff.locked.pageBar} />
      <label className="ab-check" style={{ marginTop: 6 }}>
        <input id="panel-bar" type="checkbox" checked={v.quickBarOpen !== false} onChange={(e) => change({ quickBarOpen: e.target.checked })} />
        <span>Keep the bar open at the top of the side panel.</span>
      </label>
      <Status status={status} />
    </section>
  );
}

// What Settings says when the browser did not turn a site on: the next step, for a refused question and for one that never appeared.
export const SITE_REFUSED_TEXT =
  'The browser did not turn Agent Buddy on for this site. Press Turn on again and choose Allow. If no question appears, your IT team may block it: ask them.';

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
      if (!origin) throw new Error('Enter the https address of your ServiceNow instance, for example https://acme.service-now.com');
      if (!isInstanceAllowed(origin, eff.policy)) throw new Error('Your organisation has not approved this instance.');
      let granted = false;
      try {
        granted = await chrome.permissions.request({ origins: [instancePattern(origin)] });
      } catch {
        // A build with fixed host access (enterprise) cannot ask for a site it was not built for.
        throw new Error('This build of Agent Buddy cannot be turned on for that site. Your organisation decides which instances it works on.');
      }
      if (!granted) throw new Error(SITE_REFUSED_TEXT);
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
      setError(`Could not turn off ${origin}: ${err.message}`);
    }
    reload();
  }

  return (
    <section className="ab-section" aria-labelledby="h-instances">
      <h2 className="ab-h" id="h-instances">ServiceNow instances</h2>
      <p className="ab-sub">
        {hostAccess() === 'granted'
          ? 'Agent Buddy only runs on instances you turn on. This build was given access to the instances your organisation approved when it was installed, so the browser does not ask.'
          : 'Agent Buddy only runs on instances you turn on. The browser asks you to confirm each one the first time.'}
      </p>
      {instances.length === 0 && managed.length === 0 && <p className="ab-note">No instance is turned on yet.</p>}
      <ul className="ab-sites">
        {instances.map((o) => (
          <li key={o} className="ab-row ab-site">
            <span className="ab-mono">{o}</span>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => remove(o)} aria-label={`Turn off ${o}`}>Turn off</button>
          </li>
        ))}
        {managed.map((o) => (
          <li key={o} className="ab-row ab-site">
            <span className="ab-mono">{o}</span>
            <span className="ab-locked">Turned on by your organisation</span>
          </li>
        ))}
      </ul>
      <label className="ab-label" htmlFor="instance">Instance address</label>
      <div className="ab-row">
        <input
          id="instance"
          className="ab-input ab-mono"
          style={{ flex: 1 }}
          placeholder="https://yourcompany.service-now.com"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={onEnter(() => !busy && add())}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'instance-error' : undefined}
        />
        <button type="button" className="ab-btn ab-btn-primary" onClick={add} disabled={busy}>Turn on</button>
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
      <h2 className="ab-h" id="h-policy">Your organisation&apos;s policy</h2>
      {known.length > 0 && (
        <p className="ab-sub">
          Switched off by your organisation: <span className="ab-mono">{known.join(', ')}</span>.
        </p>
      )}
      {unknown.length > 0 && (
        <p className="ab-note ab-note-warn" id="policy-unknown-features">
          The policy&apos;s disabledFeatures names {unknown.length === 1 ? 'an id' : 'ids'} that match{unknown.length === 1 ? 'es' : ''} no feature, so nothing is switched off
          by {unknown.length === 1 ? 'it' : 'them'}: <span className="ab-mono">{unknown.join(', ')}</span>. Check the spelling against the list in the deployment guide.
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
      setStatus({ kind: 'ok', text: 'The activity log was cleared.' });
    } catch {
      setStatus({ kind: 'danger', text: 'The browser did not let Agent Buddy clear the log. Try again.' });
    }
    load();
  }

  return (
    <section className="ab-section" aria-labelledby="h-audit">
      <h2 className="ab-h" id="h-audit">Activity log</h2>
      <p className="ab-sub">
        A local record of what Agent Buddy did: which action, which table, how many items were masked, tokens and outcome. It never stores ticket
        text, names or the AI&apos;s answers.
      </p>
      <div className="ab-row" style={{ marginBottom: 8 }}>
        <button type="button" className="ab-btn ab-btn-sm" onClick={exportCsv} disabled={!canExport || !log.length}>Export CSV</button>
        <button type="button" className="ab-btn ab-btn-sm" onClick={clear} disabled={!log.length}>Clear log</button>
        {!canExport && <span className="ab-locked">Export is switched off by your organisation.</span>}
      </div>
      <Status status={status} />
      {log.length === 0 ? <p className="ab-note">Nothing yet.</p> : (
        <table className="ab-table">
          <thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Table</th><th scope="col">Masked</th><th scope="col">Outcome</th></tr></thead>
          <tbody>
            {log.slice(0, 40).map((e, i) => (
              <tr key={i}><td>{String(e.time || '').replace('T', ' ').slice(0, 16)}</td><td>{e.feature}</td><td>{e.table}</td><td>{e.masked}</td><td>{e.outcome}{e.reason ? ` (${e.reason})` : ''}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
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
      // The sites you turned on are turned off first, so the browser permission and the page scripts go with the setting.
      for (const origin of eff.values.instances || []) {
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
      const kept = done.kept?.length ? " The AI usage log was kept: your organisation's daily limit is counted from it." : '';
      setResult(done.remaining.length ? { kind: 'danger', text: 'Some things could not be removed. Try again, or remove the extension.' } : { kind: 'ok', text: `Everything stored by Agent Buddy was removed.${kept}` });
    } catch {
      setResult({ kind: 'danger', text: 'The browser did not let Agent Buddy remove everything. Try again.' });
    } finally {
      setConfirming(false);
      setBusy(false);
      load();
      onCleared();
    }
  }

  return (
    <section className="ab-section" aria-labelledby="h-stored">
      <h2 className="ab-h" id="h-stored">Stored data</h2>
      <p className="ab-sub">
        This is everything Agent Buddy keeps in this browser. It never keeps ticket text, names or the AI&apos;s answers.
      </p>
      {items === null ? <p className="ab-sub">Loading…</p> : (
        <ul style={{ paddingLeft: 18 }}>
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.title}</strong>{' '}
              <span className="ab-sub">({item.present ? 'saved now' : 'nothing saved'}{item.area === 'session' ? ', memory only' : ''})</span>
              <div className="ab-hint">{item.detail}</div>
            </li>
          ))}
        </ul>
      )}
      {!confirming ? (
        <div className="ab-row">
          <button type="button" className="ab-btn" onClick={() => { setResult(null); setConfirming(true); }}>Clear everything stored by Agent Buddy</button>
        </div>
      ) : (
        <div className="ab-note ab-note-warn" role="alertdialog" aria-labelledby="clear-title" aria-describedby="clear-text">
          <strong id="clear-title">Remove everything?</strong>{' '}
          <span id="clear-text">
            Your settings, the saved AI key, snippets, the usage and activity logs, saved dashboards and checklist ticks are deleted, and the ServiceNow
            sites you turned on are turned off. This cannot be undone.{budgeted ? " The AI usage log stays while your organisation sets a daily limit." : ''}
          </span>
          <div className="ab-row" style={{ marginTop: 8 }}>
            <button type="button" ref={confirmButton} className="ab-btn ab-btn-danger ab-btn-sm" onClick={clearEverything} disabled={busy}>{busy ? 'Removing…' : 'Yes, remove everything'}</button>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
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
  const change = async (patch) => {
    try {
      await saveSettings(patch);
      setStatus(null);
      reload();
    } catch {
      setStatus({ kind: 'danger', text: 'The browser did not save that change. Try again.' });
    }
  };
  return (
    <section className="ab-section" aria-labelledby="h-profiles">
      <h2 className="ab-h" id="h-profiles">What you work on</h2>
      <p className="ab-sub">Agent Buddy shows the tools for this work first. Tick everything that applies.</p>
      <ProfilePicker eff={eff} onSave={change} instant idBase="profile" />
      <label className="ab-check" htmlFor="show-everything">
        <input id="show-everything" type="checkbox" checked={v.showEverything === true} onChange={(e) => change({ showEverything: e.target.checked })} />
        <span>Show everything: every card and action, whatever you work on.</span>
      </label>
      {!aiOffByOrg && (
        <label className="ab-check" htmlFor="ai-skipped">
          <input id="ai-skipped" type="checkbox" checked={v.aiSkipped === true} onChange={(e) => change({ aiSkipped: e.target.checked })} />
          <span>Skip AI for now: use Agent Buddy without AI. Everything under Insights still works.</span>
        </label>
      )}
      <Status status={status} />
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
      setStatus({ kind: 'danger', text: 'The browser did not save that change. Try again.' });
    }
  }
  return (
    <section className="ab-section" aria-labelledby="h-followup">
      <h2 className="ab-h" id="h-followup">My work</h2>
      <div className="ab-field">
        <label className="ab-label" htmlFor="follow-up-days">Follow-ups due after</label>
        <select id="follow-up-days" className="ab-select" value={String(value)} aria-describedby="follow-up-hint" onChange={(e) => change(e.target.value)}>
          {FOLLOW_UP_CHOICES.map((d) => (
            <option key={d} value={String(d)}>{d} days</option>
          ))}
        </select>
        <span className="ab-hint" id="follow-up-hint">A customer who has not had an update, or has not answered, for this long shows under follow-ups in My work.</span>
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
      setStatus({ kind: 'ok', text: 'Copied. Paste it into your message to support. It holds no key and no ticket content.' });
    } catch {
      setStatus({ kind: 'warn', text: 'The browser did not let Agent Buddy copy it. Select the text below and copy it yourself.' });
    }
  }

  return (
    <section className="ab-section" aria-labelledby="h-diagnostics">
      <h2 className="ab-h" id="h-diagnostics">Help from support</h2>
      <p className="ab-sub">Copies the versions, your settings without any key, your organisation&apos;s policy in short and the last problems. No ticket content.</p>
      <div className="ab-row">
        <button type="button" className="ab-btn" onClick={copy}>Copy diagnostics</button>
      </div>
      <Status status={status} />
      {text && (
        <details className="ab-more">
          <summary>What was copied</summary>
          <pre className="ab-diagnostics" tabIndex={0}>{text}</pre>
        </details>
      )}
    </section>
  );
}

/** Which page of Settings the address asks for: '#ai' is AI Assist, anything else Basics. */
export const settingsPageFromHash = (hash) => (String(hash || '').replace(/^#/, '').toLowerCase() === 'ai' ? 'ai' : 'basics');

const PAGES = [
  { id: 'basics', label: 'Basics' },
  { id: 'ai', label: 'AI Assist' },
];

/** The AI Assist page: the provider, its key, the model and the limits; when the organisation switched AI off, only that. */
export function AiAssistPage({ eff, reload, epoch }) {
  if (eff.policy?.aiEnabled === false) {
    return (
      <section className="ab-section" aria-labelledby="h-ai-off">
        <h2 className="ab-h" id="h-ai-off">AI is switched off</h2>
        <p className="ab-sub">
          Your organisation has switched off AI in Agent Buddy. Everything under Insights still works: facts, lists, checks and templates, read
          from ServiceNow with your own session. Nothing is sent anywhere.
        </p>
      </section>
    );
  }
  return (
    <>
      <p className="ab-sub ab-page-intro">
        AI Assist writes summaries, replies and notes with the AI provider you choose. Personal data is masked first, and you can see what is sent.
        {eff.values.aiSkipped ? ' You chose to skip AI for now: untick it under Basics, "What you work on", to use it.' : ''}
      </p>
      <ProviderSection eff={eff} reload={reload} />
      <UsageSection key={`usage-${epoch}`} eff={eff} />
    </>
  );
}

export default function Options() {
  const [eff, setEff] = useState(null);
  const [failed, setFailed] = useState('');
  const [epoch, setEpoch] = useState(0); // bumped after "clear everything" so every section shows what is left
  const reload = useCallback(async () => {
    try {
      const [e, raw] = await Promise.all([loadEffective(), loadSettings()]);
      const store = keyStore();
      const apiKey = e.values.providedApiKey || (await store.load(e.values.provider));
      const keyLocked = !apiKey && (await store.isLocked(e.values.provider));
      setFailed('');
      // floors: the policy's minimum for a setting the person may still raise; savedProvider: the person's own choice, before policy.
      setEff({ values: e.values, locked: e.locked, floors: e.floors || {}, policy: e.policy, apiKey, keyLocked, savedProvider: String(raw?.provider || '') });
    } catch (err) {
      setFailed(err?.message || 'The settings could not be read.');
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  // Another page (the side panel, a second settings tab) changed something: show it.
  useEffect(() => {
    const onChange = () => reload();
    try {
      chrome.storage.onChanged.addListener(onChange);
      return () => chrome.storage.onChanged.removeListener(onChange);
    } catch {
      return undefined;
    }
  }, [reload]);

  if (failed) return <div className="ab-page"><p className="ab-note ab-note-danger" role="alert">{failed} Close this tab and open Settings again.</p></div>;
  if (!eff) return <div className="ab-page"><p className="ab-sub">Loading…</p></div>;
  return (
    <main className="ab-page">
      <h1 className="ab-h ab-page-title">Agent Buddy settings</h1>
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
      <Tabs idBase="ab-settings" label="Settings pages" className="ab-row ab-settings-tabs" tabs={PAGES} value={page} onChange={choose} />
      {managedNote && <p className="ab-note ab-note-warn">Some settings are managed by your organisation and cannot be changed.</p>}
      <div id={panelId('ab-settings', 'basics')} role="tabpanel" aria-labelledby={tabId('ab-settings', 'basics')} hidden={page !== 'basics'}>
        <p className="ab-sub ab-page-intro">Where Agent Buddy works, what you work on, how personal data is protected, and what it keeps on this computer.</p>
        <InstancesSection eff={eff} reload={reload} />
        <ProfilesSection eff={eff} reload={reload} />
        <FollowUpSection eff={eff} reload={reload} />
        <QuickBarSection eff={eff} reload={reload} />
        {Object.keys(eff.floors || {}).length > 0 && <p className="ab-note">Your organisation sets a minimum for some privacy settings. You can always choose a stricter one.</p>}
        <PrivacySection eff={eff} reload={reload} />
        <PolicySection eff={eff} />
        <AuditSection key={`audit-${epoch}`} eff={eff} />
        <StoredDataSection key={`stored-${epoch}`} eff={eff} onCleared={onCleared} />
        <DiagnosticsSection eff={eff} />
        <section className="ab-section" aria-labelledby="h-leaves">
          <h2 className="ab-h" id="h-leaves">What leaves your computer</h2>
          <p className="ab-sub">
            Only two things: reads from your own ServiceNow instance, and the masked text sent to the AI address you chose. Agent Buddy has no server,
            no analytics and no tracking. It never saves or changes a ServiceNow record by itself: when you choose Insert it fills the field on the open
            form and you press Save.
          </p>
        </section>
      </div>
      <div id={panelId('ab-settings', 'ai')} role="tabpanel" aria-labelledby={tabId('ab-settings', 'ai')} hidden={page !== 'ai'}>
        <AiAssistPage eff={eff} reload={reload} epoch={epoch} />
      </div>
    </>
  );
}

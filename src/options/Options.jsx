import { useCallback, useEffect, useState } from 'react';
import { PROVIDERS, resolveProviderConfig } from '../providers/config.js';
import { sendChat } from '../providers/index.js';
import { createFirewall } from '../pii/index.js';
import { validateBaseUrl } from '../lib/aiUsage.js';
import { ensureAiPermission } from '../lib/aiPermission.js';
import { loadEffective, saveSettings, keyStore, readAudit, clearAudit } from '../lib/storage.js';
import { auditToCsv } from '../audit/auditLog.js';
import { MSG } from '../lib/messages.js';
import { instancePattern, normalizeInstance, isInstanceAllowed, PII_MODES, PREVIEW_MODES, KEY_STORAGE_MODES } from '../policy/policy.js';

const KEY_MODE_TEXT = {
  local: 'Stored in this browser. Simple, but anyone who can read your browser profile can read it. Use a key with a spend limit.',
  session: 'Kept in memory only and forgotten when the browser closes. Nothing is written to disk. You enter it again next time.',
  encrypted: 'Stored encrypted with a passphrase. You enter the passphrase once per browser session.',
};
const PII_TEXT = {
  standard: 'Masks detected personal data (names on the ticket, emails, phone and card numbers, IDs, secrets).',
  strict: 'Also refuses sensitive fields and keeps HR free text out entirely.',
  'local-only': 'Only allows an AI model running on this computer. Nothing leaves it.',
};
const PREVIEW_TEXT = { always: 'Show the exact outgoing text every time', first: 'Show it the first time for each action', never: 'Do not show it' };

function Locked({ why }) {
  return why ? <span className="ab-locked">{why}</span> : null;
}

function ProviderSection({ eff, reload }) {
  const v = eff.values;
  const def = PROVIDERS[v.provider];
  const [key, setKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [unlockPass, setUnlockPass] = useState('');
  const [status, setStatus] = useState(null);
  const [keyMode, setKeyMode] = useState('none');
  const [busy, setBusy] = useState(false);
  const store = keyStore();

  useEffect(() => {
    store.mode(v.provider).then(setKeyMode);
  }, [v.provider, eff.apiKey]);

  const baseUrlTyped = v.baseUrls?.[v.provider] || '';
  const model = v.models?.[v.provider] || def.defaultModel;

  async function change(patch) {
    await saveSettings(patch);
    reload();
  }

  async function saveKey() {
    setStatus(null);
    try {
      if (v.keyStorage === 'encrypted' && !passphrase) throw new Error('Choose a passphrase to encrypt the key.');
      await store.save({ provider: v.provider, key, mode: v.keyStorage, passphrase });
      setKey('');
      setPassphrase('');
      setStatus({ kind: 'ok', text: key ? 'Key saved.' : 'Key removed.' });
      reload();
    } catch (err) {
      setStatus({ kind: 'danger', text: err.message });
    }
  }

  async function unlock() {
    try {
      await store.unlock(v.provider, unlockPass);
      setUnlockPass('');
      setStatus({ kind: 'ok', text: 'Unlocked for this browser session.' });
      reload();
    } catch (err) {
      setStatus({ kind: 'danger', text: err.message });
    }
  }

  async function test() {
    setStatus(null);
    setBusy(true);
    try {
      const cfg = resolveProviderConfig(v, eff.apiKey);
      // A hosted provider needs the browser's permission for its address first (requested from this click).
      await ensureAiPermission(cfg);
      // The test goes through the same firewall as everything else: there is no side door to the provider.
      const fw = createFirewall({ mode: 'standard', people: [], blockedFields: [], endpointIsLocal: cfg.local });
      const request = fw.buildRequest({ feature: 'connection-test', table: '', system: 'Reply with the single word OK.', userInstruction: 'ping', parts: [] });
      const reply = await sendChat(cfg, request, { kind: 'validate', skipBudget: true });
      setStatus({ kind: 'ok', text: `Connected. The model answered: ${String(reply.content).slice(0, 40)}` });
    } catch (err) {
      setStatus({ kind: 'danger', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const baseCheck = validateBaseUrl(baseUrlTyped);

  return (
    <section className="ab-section">
      <h2 className="ab-h">AI provider</h2>
      <p className="ab-sub">Use any provider you have a key for, a company gateway, or a model on this computer.</p>

      <div className="ab-field">
        <label className="ab-label" htmlFor="provider">Provider</label>
        <select id="provider" className="ab-select" value={v.provider} disabled={Boolean(eff.locked.provider)} onChange={(e) => change({ provider: e.target.value })}>
          {Object.entries(PROVIDERS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
        </select>
        <Locked why={eff.locked.provider} />
      </div>

      {(def.userBaseUrl || def.baseUrl) && (
        <div className="ab-field">
          <label className="ab-label" htmlFor="baseurl">Address {def.userBaseUrl ? '(optional)' : ''}</label>
          <input
            id="baseurl"
            className="ab-input ab-mono"
            value={def.baseUrl || baseUrlTyped}
            readOnly={!def.userBaseUrl || Boolean(eff.locked.baseUrl)}
            placeholder="https://your-gateway.example.com/v1"
            onChange={(e) => change({ baseUrls: { ...v.baseUrls, [v.provider]: e.target.value } })}
          />
          {!baseCheck.ok && <span className="ab-locked" role="alert">{baseCheck.error}</span>}
          <span className="ab-hint">Leave empty to use the provider's own API. Azure OpenAI and internal gateways go here.</span>
          <Locked why={eff.locked.baseUrl} />
        </div>
      )}

      <div className="ab-field">
        <label className="ab-label" htmlFor="model">Model</label>
        {def.freeModel || def.userBaseUrl ? (
          <input id="model" className="ab-input ab-mono" list="models" value={model} disabled={Boolean(eff.locked.model)} onChange={(e) => change({ models: { ...v.models, [v.provider]: e.target.value } })} />
        ) : (
          <select id="model" className="ab-select" value={model} disabled={Boolean(eff.locked.model)} onChange={(e) => change({ models: { ...v.models, [v.provider]: e.target.value } })}>
            {def.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
        <datalist id="models">{def.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
        <Locked why={eff.locked.model} />
      </div>

      {eff.locked.apiKey ? (
        <p className="ab-note ab-note-ok">The AI key is provided by your organisation.</p>
      ) : (
        <>
          <div className="ab-field">
            <label className="ab-label" htmlFor="keystorage">Where to keep the key</label>
            <select id="keystorage" className="ab-select" value={v.keyStorage} disabled={Boolean(eff.locked.keyStorage)} onChange={(e) => change({ keyStorage: e.target.value })}>
              {KEY_STORAGE_MODES.map((m) => <option key={m} value={m}>{{ local: 'This browser (simple)', session: 'Memory only (forgotten on close)', encrypted: 'Encrypted with a passphrase' }[m]}</option>)}
            </select>
            <span className="ab-hint">{KEY_MODE_TEXT[v.keyStorage]}</span>
            <Locked why={eff.locked.keyStorage} />
          </div>

          {eff.keyLocked && (
            <div className="ab-field">
              <label className="ab-label" htmlFor="unlock">Passphrase to unlock the saved key</label>
              <div className="ab-row">
                <input id="unlock" type="password" className="ab-input" value={unlockPass} onChange={(e) => setUnlockPass(e.target.value)} autoComplete="off" />
                <button type="button" className="ab-btn" onClick={unlock} disabled={!unlockPass}>Unlock</button>
              </div>
            </div>
          )}

          <div className="ab-field">
            <label className="ab-label" htmlFor="key">{def.keyLabel}</label>
            <input id="key" type="password" className="ab-input ab-mono" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder={keyMode === 'none' ? def.keyPlaceholder || '' : 'A key is saved. Type a new one to replace it.'} />
            <span className="ab-hint">{def.keyHint}</span>
          </div>
          {v.keyStorage === 'encrypted' && (
            <div className="ab-field">
              <label className="ab-label" htmlFor="pass">Passphrase</label>
              <input id="pass" type="password" className="ab-input" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" />
              <span className="ab-hint">There is no way to recover a forgotten passphrase. You would enter the key again.</span>
            </div>
          )}
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-primary" onClick={saveKey}>Save key</button>
            {keyMode !== 'none' && (
              <button type="button" className="ab-btn" onClick={async () => { await store.remove(v.provider); setStatus({ kind: 'ok', text: 'Key removed.' }); reload(); }}>
                Remove saved key
              </button>
            )}
            <button type="button" className="ab-btn" onClick={test} disabled={busy}>{busy ? 'Testing…' : 'Test connection'}</button>
          </div>
        </>
      )}
      {status && <p className={`ab-note ab-note-${status.kind}`} role="status" style={{ marginTop: 8 }}>{status.text}</p>}
    </section>
  );
}

function PrivacySection({ eff, reload }) {
  const v = eff.values;
  const change = async (patch) => {
    await saveSettings(patch);
    reload();
  };
  return (
    <section className="ab-section">
      <h2 className="ab-h">Privacy</h2>
      <div className="ab-field">
        <label className="ab-label" htmlFor="pii">Personal-data protection</label>
        <select id="pii" className="ab-select" value={v.piiMode} disabled={Boolean(eff.locked.piiMode)} onChange={(e) => change({ piiMode: e.target.value })}>
          {PII_MODES.map((m) => <option key={m} value={m}>{{ standard: 'Standard', strict: 'Strict', 'local-only': 'Local model only' }[m]}</option>)}
        </select>
        <span className="ab-hint">{PII_TEXT[v.piiMode]}</span>
        <Locked why={eff.locked.piiMode} />
      </div>
      <div className="ab-field">
        <label className="ab-label" htmlFor="preview">Check what is sent</label>
        <select id="preview" className="ab-select" value={v.previewMode} disabled={Boolean(eff.locked.previewMode)} onChange={(e) => change({ previewMode: e.target.value, previewSeen: [] })}>
          {PREVIEW_MODES.map((m) => <option key={m} value={m}>{PREVIEW_TEXT[m]}</option>)}
        </select>
        <Locked why={eff.locked.previewMode} />
      </div>
    </section>
  );
}

function InstancesSection({ eff, reload }) {
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const instances = eff.values.instances || [];

  async function add() {
    setError('');
    const origin = normalizeInstance(address);
    try {
      if (!origin) throw new Error('Enter the https address of your ServiceNow instance, for example https://acme.service-now.com');
      if (!isInstanceAllowed(origin, eff.policy)) throw new Error('Your organisation has not approved this instance.');
      const granted = await chrome.permissions.request({ origins: [instancePattern(origin)] });
      if (!granted) throw new Error('The browser did not grant access to this site.');
      const answer = await chrome.runtime.sendMessage({ type: MSG.ENABLE_INSTANCE, origin });
      if (answer?.error) throw new Error(answer.error.message);
      setAddress('');
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(origin) {
    await chrome.runtime.sendMessage({ type: MSG.DISABLE_INSTANCE, origin });
    reload();
  }

  return (
    <section className="ab-section">
      <h2 className="ab-h">ServiceNow instances</h2>
      <p className="ab-sub">Agent Buddy only runs on instances you turn on. The browser asks you to confirm each one.</p>
      {instances.length === 0 && <p className="ab-note">No instance is turned on yet.</p>}
      <ul style={{ paddingLeft: 18 }}>
        {instances.map((o) => (
          <li key={o} className="ab-row" style={{ justifyContent: 'space-between' }}>
            <span className="ab-mono">{o}</span>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => remove(o)}>Turn off</button>
          </li>
        ))}
      </ul>
      <div className="ab-row">
        <input className="ab-input ab-mono" style={{ flex: 1 }} placeholder="https://yourcompany.service-now.com" value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Instance address" />
        <button type="button" className="ab-btn ab-btn-primary" onClick={add}>Turn on</button>
      </div>
      {eff.locked.instances && <Locked why={eff.locked.instances} />}
      {error && <p className="ab-note ab-note-danger" role="alert" style={{ marginTop: 8 }}>{error}</p>}
    </section>
  );
}

function AuditSection({ eff }) {
  const [log, setLog] = useState([]);
  const load = useCallback(() => readAudit().then((l) => setLog(l.slice().reverse())), []);
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

  return (
    <section className="ab-section">
      <h2 className="ab-h">Activity log</h2>
      <p className="ab-sub">
        A local record of what Agent Buddy did: which action, which table, how many items were masked, tokens and outcome. It never stores ticket
        text, names or the AI's answers.
      </p>
      <div className="ab-row" style={{ marginBottom: 8 }}>
        <button type="button" className="ab-btn ab-btn-sm" onClick={exportCsv} disabled={!canExport || !log.length}>Export CSV</button>
        <button type="button" className="ab-btn ab-btn-sm" onClick={async () => { await clearAudit(); load(); }} disabled={!log.length}>Clear log</button>
        {!canExport && <span className="ab-locked">Export is switched off by your organisation.</span>}
      </div>
      {log.length === 0 ? <p className="ab-note">Nothing yet.</p> : (
        <table className="ab-table">
          <thead><tr><th>Time</th><th>Action</th><th>Table</th><th>Masked</th><th>Outcome</th></tr></thead>
          <tbody>
            {log.slice(0, 40).map((e, i) => (
              <tr key={i}><td>{e.time.replace('T', ' ').slice(0, 16)}</td><td>{e.feature}</td><td>{e.table}</td><td>{e.masked}</td><td>{e.outcome}{e.reason ? ` (${e.reason})` : ''}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function Options() {
  const [eff, setEff] = useState(null);
  const reload = useCallback(async () => {
    const e = await loadEffective();
    const store = keyStore();
    const apiKey = e.values.providedApiKey || (await store.load(e.values.provider));
    const keyLocked = !apiKey && (await store.isLocked(e.values.provider));
    setEff({ values: e.values, locked: e.locked, policy: e.policy, apiKey, keyLocked });
  }, []);
  useEffect(() => { reload(); }, [reload]);

  if (!eff) return <div className="ab-page"><p className="ab-sub">Loading…</p></div>;
  return (
    <div className="ab-page">
      <h1 className="ab-h" style={{ fontSize: 20 }}>Agent Buddy settings</h1>
      {Object.keys(eff.locked).length > 0 && <p className="ab-note ab-note-warn">Some settings are managed by your organisation and cannot be changed.</p>}
      <ProviderSection eff={eff} reload={reload} />
      <PrivacySection eff={eff} reload={reload} />
      <InstancesSection eff={eff} reload={reload} />
      <AuditSection eff={eff} />
      <section className="ab-section">
        <h2 className="ab-h">What leaves your computer</h2>
        <p className="ab-sub">
          Only two things: reads from your own ServiceNow instance, and the masked text sent to the AI address you chose. Agent Buddy has no server,
          no analytics and no tracking. It never saves or changes a ServiceNow record by itself: when you choose Insert it fills the field on the open
          form and you press Save.
        </p>
      </section>
    </div>
  );
}

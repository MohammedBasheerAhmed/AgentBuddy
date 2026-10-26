import { useCallback, useEffect, useRef, useState } from 'react';
import { MSG } from '../lib/messages.js';
import { featuresFor } from '../features/registry.js';
import { peopleFor } from '../features/parts.js';
import { prepareRun, executeRun, previewRequired, auditBlocked, auditCancelled, RunBlocked } from '../lib/pipeline.js';
import { resolveProviderConfig } from '../providers/config.js';
import { ensureAiPermission } from '../lib/aiPermission.js';
import { sendChat } from '../providers/index.js';
import { createFirewall } from '../pii/index.js';
import { logAudit, saveSettings } from '../lib/storage.js';
import PreviewDialog from './PreviewDialog.jsx';
import ResultView from './ResultView.jsx';
import RelatedView from './RelatedView.jsx';

const ask = async (tabId, message) => {
  const answer = await chrome.tabs.sendMessage(tabId, message);
  if (answer?.error) {
    const err = new Error(answer.error.message);
    err.code = answer.error.code;
    throw err;
  }
  return answer;
};

export default function RecordView({ page, eff }) {
  const { record } = page;
  const [header, setHeader] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | reading | preview | sending | done | error
  const [active, setActive] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [result, setResult] = useState(null);
  const [people, setPeople] = useState([]); // everyone on the record, for the safe-to-send check on what gets inserted
  const [scan, setScan] = useState(null); // the firewall's scan(): also recognises values it masked on the way out
  const [error, setError] = useState('');
  const [tab, setTab] = useState('actions'); // 'actions' | 'related'
  const token = useRef(0); // a newer run (or Close) invalidates an older one still in flight

  const key = `${record.table}:${record.sysId}`;
  const aiReady = Boolean(eff.apiKey) || Boolean(eff.values.providedApiKey) || ['ollama'].includes(eff.values.provider);
  const config = resolveProviderConfig(eff.values, eff.apiKey);
  const host = (() => {
    try { return new URL(page.href).host; } catch { return ''; }
  })();

  // A different record means a different conversation: drop anything from the previous one.
  useEffect(() => {
    token.current += 1;
    setPhase('idle');
    setResult(null);
    setPrepared(null);
    setError('');
    setHeader(null);
    setTab('actions');
    let cancelled = false;
    ask(page.tabId, { type: MSG.READ, op: 'header', args: { table: record.table, sysId: record.sysId } })
      .then((h) => !cancelled && setHeader(h))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, page.tabId, record.table, record.sysId]);

  const reset = useCallback(() => {
    token.current += 1;
    setPhase('idle');
    setPrepared(null);
    setResult(null);
    setError('');
  }, []);

  const fail = useCallback((err) => {
    setError(err?.message || 'Something went wrong.');
    setPhase('error');
  }, []);

  async function send(p, cfg, previewShown, mine) {
    setPhase('sending');
    try {
      const out = await executeRun({ prepared: p, config: cfg, values: eff.values, host, previewShown, sendChat, logAudit });
      if (mine !== token.current) return;
      setPeople(peopleFor(p.pack));
      setScan(() => (text) => p.firewall.scan(text)); // (a function stored in state: wrapped so React does not call it)
      setResult(out.text);
      setPhase('done');
    } catch (err) {
      if (mine === token.current) fail(err);
    }
  }

  async function run(feature) {
    token.current += 1;
    const mine = token.current;
    setActive(feature);
    setResult(null);
    setError('');
    setPhase('reading');
    let pack;
    let p;
    const cfg = resolveProviderConfig(eff.values, eff.apiKey);
    try {
      // First, while the click is fresh: the browser's permission for the AI address (a prompt only the first time).
      await ensureAiPermission(cfg);
      pack = await ask(page.tabId, { type: MSG.READ, op: 'pack', args: { table: record.table, sysId: record.sysId, feature: feature.id, allowSensitive: Boolean(eff.policy?.allowHrContent) } });
      if (mine !== token.current) return;
      p = prepareRun({ feature, pack, values: eff.values, policy: eff.policy, config: cfg, createFirewall });
    } catch (err) {
      // Refused by policy or by the firewall (fail closed): nothing was sent. Record that.
      if (err instanceof RunBlocked || err?.name === 'FirewallError') {
        await auditBlocked({ feature, pack, config: cfg, values: eff.values, err, logAudit });
      }
      if (mine === token.current) fail(err);
      return;
    }
    if (previewRequired(eff.values.previewMode, feature.id, eff.values.previewSeen || [])) {
      setPrepared({ p, cfg });
      setPhase('preview');
    } else {
      await send(p, cfg, false, mine);
    }
  }

  async function confirmPreview() {
    const { p, cfg } = prepared;
    const mine = token.current;
    // "first time per feature": remember that this one has been checked.
    if (eff.values.previewMode === 'first') {
      const seen = [...new Set([...(eff.values.previewSeen || []), p.feature.id])];
      saveSettings({ previewSeen: seen }).catch(() => {});
    }
    setPrepared(null);
    await send(p, cfg, true, mine);
  }

  async function cancelPreview() {
    const { p, cfg } = prepared;
    await auditCancelled({ feature: p.feature, pack: p.pack, config: cfg, values: eff.values, stats: p.stats, logAudit });
    reset();
  }

  const features = featuresFor(record.kind || 'other', eff.policy);

  return (
    <>
      <section className="ab-card ab-record">
        <span className="ab-record-number">{record.number || header?.number || record.table}</span>
        <span className="ab-record-title">{header?.short_description || 'Loading…'}</span>
        <div className="ab-tags">
          <span className="ab-tag">{record.table}</span>
          {header?.state && <span className="ab-tag">{header.state}</span>}
          {header?.priority && <span className="ab-tag">{header.priority}</span>}
        </div>
      </section>

      {!aiReady && (
        <p className="ab-note ab-note-warn">
          {eff.keyLocked ? 'Your AI key is locked. Unlock it in Settings.' : 'Add an AI key in Settings to use these actions.'}
        </p>
      )}

      <div className="ab-row" role="tablist" aria-label="Panel sections">
        {[['actions', 'Actions'], ['related', 'Related']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`ab-btn ab-btn-sm${tab === id ? ' ab-btn-primary' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'related' && <RelatedView key={key} page={page} eff={eff} />}

      {tab === 'actions' && (phase === 'idle' || phase === 'error') && (
        <section className="ab-features" aria-label="Actions">
          {features.map((f) => (
            <button key={f.id} type="button" className="ab-feature" disabled={!aiReady} onClick={() => run(f)}>
              <span className="ab-feature-title">{f.title}</span>
              <span className="ab-feature-desc">{f.description}</span>
            </button>
          ))}
        </section>
      )}

      {(phase === 'reading' || phase === 'sending') && (
        <p className="ab-note" role="status">
          {phase === 'reading' ? 'Reading the ticket with your session…' : 'Waiting for the AI…'}
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={reset} style={{ marginLeft: 8 }}>Cancel</button>
        </p>
      )}

      {phase === 'error' && <p className="ab-note ab-note-danger" role="alert">{error}</p>}

      {phase === 'preview' && prepared && (
        <PreviewDialog
          feature={prepared.p.feature}
          prepared={prepared.p}
          config={prepared.cfg}
          canSkipNext={eff.values.previewMode === 'first'}
          onSend={confirmPreview}
          onCancel={cancelPreview}
        />
      )}

      {phase === 'done' && result !== null && (
        <ResultView
          feature={active}
          text={result}
          page={page}
          people={people}
          scan={scan}
          onAgain={() => run(active)}
          onClose={reset}
          audit={(outcome) => logAudit({ feature: active.id, table: record.table, sysId: record.sysId, provider: config.provider, model: config.model, mode: eff.values.piiMode, outcome })}
        />
      )}
    </>
  );
}

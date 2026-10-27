import { useCallback, useRef, useState } from 'react';
import { contextFor } from '../features/registry.js';
import { peopleFor } from '../features/parts.js';
import { prepareRun, executeRun, previewRequired, auditBlocked, auditCancelled } from '../lib/pipeline.js';
import { resolveProviderConfig } from '../providers/config.js';
import { ensureAiPermission } from '../lib/aiPermission.js';
import { sendChat } from '../providers/index.js';
import { createFirewall } from '../pii/index.js';
import { logAudit, saveSettings } from '../lib/storage.js';
import { tokensTodayReader } from '../lib/aiUsage.js';
import { readBudgetState } from '../providers/budget.js';
import { read, plainError } from './ask.js';
import { internalTextsOf } from '../safeSend/review.js';
import { lastPackOf, makeTokens, seenAfterConfirm } from './runLogic.js';
import { prepareFlow, sendFlow } from './runFlow.js';

// What the flows need from the outside world (src/sidepanel/runFlow.js takes them as arguments so tests can replace them).
// Tokens used today across providers, for the organisation's daily budget (policy.tokenBudgetPerDay).
const tokensUsedToday = tokensTodayReader(async () => (await readBudgetState()).log);

const DEPS = { ensureAiPermission, prepareRun, previewRequired, auditBlocked, createFirewall, logAudit, executeRun, sendChat };

/**
 * The one way a view runs an AI feature. It owns the whole flow and nothing can skip a step:
 *
 *   run(feature, { getPack })   permission for the AI address -> read the pack -> policy + firewall (mask, seal)
 *                               -> preview (when required) -> provider -> re-hydrate -> audit
 *
 * `getPack` is `async () => ContextPack`. The default reads the open record's pack with the feature's context spec. A view
 * that works on something other than one record (a queue report, text the agent pasted, a chat) builds a ContextPack-shaped
 * object itself: { table, sysId, number?, kind?, fields, people, journal, related, access }. `table` and `sysId` only
 * label the audit entry (use a made-up table such as 'report' for non-record input). Whatever text is in `fields`, `journal`
 * or custom `feature.parts(pack)` goes through the firewall like everything else.
 *
 * Render the returned `run` object with <RunPanel run={run} ... />.
 *
 * A run the person abandons (Cancel, Close, another record) cannot be called back from the AI provider, so the request may still
 * complete and be audited as sent; its answer is dropped and never shown (the steps and decisions are in runFlow.js / runLogic.js).
 */
export function useRun({ page, eff, record }) {
  const [phase, setPhase] = useState('idle'); // idle | reading | preview | sending | done | error
  const [active, setActive] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [result, setResult] = useState(null);
  const [people, setPeople] = useState([]); // everyone on the pack, for the safe-to-send check on what gets inserted
  const [scan, setScan] = useState(null); // the firewall's scan(): also recognises values it masked on the way out
  const [error, setError] = useState('');
  const [lastPack, setLastPack] = useState(null);
  const tokens = useRef(null); // a newer run (or reset) invalidates an older one still in flight
  if (!tokens.current) tokens.current = makeTokens();
  const lastGetPack = useRef(undefined); // so "Try again" re-reads the same thing

  const host = (() => {
    try {
      return new URL(page.href).host;
    } catch {
      return '';
    }
  })();

  const reset = useCallback(() => {
    tokens.current.drop();
    setPhase('idle');
    setPrepared(null);
    setResult(null);
    setError('');
  }, []);

  const fail = useCallback((err) => {
    setError(plainError(err));
    setPhase('error');
  }, []);

  async function send(p, cfg, previewShown, mine) {
    setPhase('sending');
    const out = await sendFlow({ prepared: p, config: cfg, values: eff.values, host, previewShown, policy: eff.policy, tokensUsedToday, isCurrent: () => tokens.current.isCurrent(mine), deps: DEPS });
    if (out.status === 'abandoned') return;
    if (out.status === 'failed') {
      fail(out.error);
      return;
    }
    setPeople(peopleFor(p.pack));
    setScan(() => (text) => p.firewall.scan(text)); // (a function stored in state: wrapped so React does not call it)
    setLastPack(lastPackOf(p.pack, internalTextsOf));
    setResult(out.text);
    setPhase('done');
  }

  async function run(feature, { getPack } = {}) {
    const mine = tokens.current.next();
    lastGetPack.current = getPack;
    setActive(feature);
    setResult(null);
    setError('');
    setPhase('reading');
    const allowSensitive = Boolean(eff.policy?.allowHrContent);
    const cfg = resolveProviderConfig(eff.values, eff.apiKey);
    const out = await prepareFlow({
      feature,
      getPack,
      readPack: () => read(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: contextFor(feature), allowSensitive }),
      readOp: (op, args) => read(page.tabId, op, args),
      allowSensitive,
      config: cfg,
      values: eff.values,
      policy: eff.policy,
      pageTable: page.record?.table || page.newRecord?.table || '',
      isCurrent: () => tokens.current.isCurrent(mine),
      deps: DEPS,
    });
    if (out.status === 'abandoned') return;
    if (out.status === 'failed') {
      fail(out.error);
      return;
    }
    if (out.preview) {
      setPrepared({ p: out.prepared, cfg });
      setPhase('preview');
    } else {
      await send(out.prepared, cfg, false, mine);
    }
  }

  async function confirmPreview() {
    const { p, cfg } = prepared;
    const mine = tokens.current.current();
    // "first time per feature" (or per group of features): remember that this one has been checked.
    const before = eff.values.previewSeen || [];
    const seen = seenAfterConfirm({ previewMode: eff.values.previewMode, feature: p.feature, seen: before });
    if (seen !== before) saveSettings({ previewSeen: seen }).catch(() => {});
    setPrepared(null);
    await send(p, cfg, true, mine);
  }

  async function cancelPreview() {
    const { p, cfg } = prepared;
    await auditCancelled({ feature: p.feature, pack: p.pack, config: cfg, values: eff.values, stats: p.stats, logAudit });
    reset();
  }

  return {
    phase,
    active,
    prepared,
    result,
    people,
    scan,
    error,
    lastPack,
    busy: phase === 'reading' || phase === 'sending' || phase === 'preview',
    run,
    again: () => (active ? run(active, { getPack: lastGetPack.current }) : undefined),
    reset,
    confirmPreview,
    cancelPreview,
  };
}

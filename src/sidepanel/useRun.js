import { useCallback, useRef, useState } from 'react';
import { contextFor } from '../features/registry.js';
import { peopleFor } from '../features/parts.js';
import { prepareRun, executeRun, previewRequired, auditBlocked, auditCancelled, RunBlocked } from '../lib/pipeline.js';
import { resolveProviderConfig } from '../providers/config.js';
import { ensureAiPermission } from '../lib/aiPermission.js';
import { sendChat } from '../providers/index.js';
import { createFirewall } from '../pii/index.js';
import { logAudit, saveSettings } from '../lib/storage.js';
import { read } from './ask.js';

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
  const token = useRef(0); // a newer run (or reset) invalidates an older one still in flight
  const lastGetPack = useRef(undefined); // so "Try again" re-reads the same thing

  const host = (() => {
    try {
      return new URL(page.href).host;
    } catch {
      return '';
    }
  })();

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
      setLastPack({ table: p.pack.table, sysId: p.pack.sysId });
      setResult(out.text);
      setPhase('done');
    } catch (err) {
      if (mine === token.current) fail(err);
    }
  }

  async function run(feature, { getPack } = {}) {
    token.current += 1;
    const mine = token.current;
    lastGetPack.current = getPack;
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
      pack = await (getPack
        ? getPack()
        : read(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: contextFor(feature), allowSensitive: Boolean(eff.policy?.allowHrContent) }));
      if (mine !== token.current) return;
      // A feature may add more to its pack first (similar solved tickets, an account's other cases...). Whatever it adds is
      // untrusted text like the rest and reaches the AI only through feature.parts() and the firewall.
      if (typeof feature.enrich === 'function') {
        pack = await feature.enrich(pack, { read: (op, args) => read(page.tabId, op, args), allowSensitive: Boolean(eff.policy?.allowHrContent) });
        if (mine !== token.current) return;
      }
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

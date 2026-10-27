import { useCallback, useEffect, useState } from 'react';
import { read as ask } from './ask.js';
import { openRecord } from './openRecord.js';
import Notes from './knowledge/Notes.jsx';

// A2, A3, C4 and the outage check (E2): what happened before for this person, tickets solved like this one, open tickets on
// the same service, and knowledge that may help. All of it is read with the person's own session and ranked locally: no AI
// call, no key needed, nothing leaves the browser. Items open in the same tab.

const CALLER_ROLES = ['caller', 'requested_for', 'contact', 'opened_by', 'requester'];

const clip = (text, n) => (text && text.length > n ? `${text.slice(0, n).trimEnd()}…` : text || '');

function Section({ title, count, children, defaultOpen = true }) {
  return (
    <details className="ab-card" open={defaultOpen}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        {title} {count !== undefined && <span className="ab-tag">{count}</span>}
      </summary>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </details>
  );
}

function Item({ page, item, line, extra }) {
  return (
    <button type="button" className="ab-feature" onClick={() => openRecord(page, item)} title="Opens in this tab">
      <span className="ab-record-number">{item.number}</span>
      <span className="ab-feature-title">{item.short_description}</span>
      {line && <span className="ab-feature-desc">{line}</span>}
      {extra && <span className="ab-feature-desc">{extra}</span>}
    </button>
  );
}

export default function RelatedView({ page, eff }) {
  const { record } = page;
  const [state, setState] = useState({ phase: 'loading', pack: null, history: null, similar: null, duplicates: null, knowledge: null, error: '' });
  const allowSensitive = Boolean(eff.policy?.allowHrContent);

  const load = useCallback(async () => {
    setState({ phase: 'loading', pack: null, history: null, similar: null, duplicates: null, knowledge: null, error: '' });
    try {
      // The 'similar' pack carries only what the look-alike search needs, not who the caller is (that column is not on its
      // allowlist), so the caller comes from the 'caller-history' pack.
      const [searchPack, whoPack] = await Promise.all([
        ask(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: 'similar', allowSensitive }),
        ask(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: 'caller-history', allowSensitive }),
      ]);
      const pack = { ...searchPack, people: whoPack.people || [] };
      setState((s) => ({ ...s, pack }));
      const caller = (pack.people || []).find((p) => p.sysId && CALLER_ROLES.includes(p.role)) || (pack.people || []).find((p) => p.sysId);
      const slim = { table: pack.table, sysId: pack.sysId, number: pack.number, fields: pack.fields };
      const settle = (promise, key) =>
        promise.then(
          (value) => setState((s) => ({ ...s, [key]: { value } })),
          (err) => setState((s) => ({ ...s, [key]: { error: err.message } }))
        );
      await Promise.all([
        caller ? settle(ask(page.tabId, 'history', { callerSysId: caller.sysId, excludeSysId: pack.sysId, allowSensitive }), 'history') : settle(Promise.resolve({ items: [], signals: null, access: [] }), 'history'),
        settle(ask(page.tabId, 'similar', { pack: slim, resolvedOnly: true, allowSensitive }), 'similar'),
        settle(ask(page.tabId, 'duplicates', { pack: slim, windowHours: 24, allowSensitive }), 'duplicates'),
        settle(ask(page.tabId, 'knowledge', { pack: slim }), 'knowledge'),
      ]);
      setState((s) => ({ ...s, phase: 'ready' }));
    } catch (err) {
      setState((s) => ({ ...s, phase: 'error', error: err.message }));
    }
  }, [page.tabId, record.table, record.sysId, allowSensitive]);

  useEffect(() => {
    load();
  }, [load]);

  const { history, similar, duplicates, knowledge } = state;
  const sig = history?.value?.signals;
  const callerName = (state.pack?.people || []).find((p) => CALLER_ROLES.includes(p.role))?.name;

  return (
    <>
      <div className="ab-row" style={{ justifyContent: 'space-between' }}>
        <span className="ab-sub">Found with your own session. Nothing here is sent to an AI. Each ticket opens in this tab.</span>
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={load} disabled={state.phase === 'loading'}>Refresh</button>
      </div>
      {state.phase === 'loading' && !state.pack && <p className="ab-note" role="status">Looking…</p>}
      {state.phase === 'error' && <p className="ab-note ab-note-danger" role="alert">{state.error}</p>}

      {duplicates?.value?.hits?.length > 0 && (
        <p className="ab-note ab-note-warn" role="status">
          {duplicates.value.hits.length} other open ticket{duplicates.value.hits.length === 1 ? '' : 's'} on the same service in the last {duplicates.value.windowHours} hours. This could be a wider issue.
        </p>
      )}

      {history && (
        <Section title={callerName ? `Earlier tickets from ${callerName}` : 'Earlier tickets from this person'} count={history.value?.items?.length}>
          {history.error && <p className="ab-note ab-note-danger">{history.error}</p>}
          {sig && (
            <p className="ab-sub">
              {history.value.items.length} earlier · {sig.openCount} still open{sig.daysSinceLast !== null ? ` · last one ${sig.daysSinceLast === 0 ? 'today' : `${sig.daysSinceLast} day${sig.daysSinceLast === 1 ? '' : 's'} ago`}` : ''}
            </p>
          )}
          {sig?.reopenedHint?.later && <p className="ab-note ab-note-warn">Looks like a repeat: {sig.reopenedHint.later}{sig.reopenedHint.earlier ? ` came ${sig.reopenedHint.days} days after ${sig.reopenedHint.earlier} was resolved` : ' was reopened'}.</p>}
          {sig?.repeats?.length > 0 && (
            <div className="ab-tags">
              {sig.repeats.slice(0, 4).map((r) => <span key={`${r.kind}:${r.key}`} className="ab-tag">{r.key} ×{r.count}</span>)}
            </div>
          )}
          {sig?.lastResolved && (
            <div className="ab-note ab-note-ok">
              <strong>Last fix that worked ({sig.lastResolved.number}):</strong> {clip(sig.lastResolved.close_notes, 260)}
            </div>
          )}
          {[...(history.value?.items || [])].reverse().slice(0, 6).map((item) => (
            <Item key={item.sysId} page={page} item={item} line={`${item.state}${item.opened_at ? ` · opened ${item.opened_at.slice(0, 10)}` : ''}`} />
          ))}
          {history.value?.items?.length === 0 && !history.error && <p className="ab-hint">No earlier tickets found for this person.</p>}
          <Notes access={history.value?.access} />
        </Section>
      )}

      {similar && (
        <Section title="Solved before" count={similar.value?.hits?.length}>
          {similar.error && <p className="ab-note ab-note-danger">{similar.error}</p>}
          {(similar.value?.hits || []).map((h) => (
            <Item key={h.sysId} page={page} item={h} line={h.why?.join('; ')} extra={h.close_notes ? `Fix: ${clip(h.close_notes, 200)}` : ''} />
          ))}
          {similar.value?.hits?.length === 0 && !similar.error && <p className="ab-hint">No similar solved tickets found.</p>}
          <Notes access={similar.value?.access} />
        </Section>
      )}

      {duplicates?.value?.hits?.length > 0 && (
        <Section title="Same service, still open" count={duplicates.value.hits.length}>
          {duplicates.value.hits.map((h) => (
            <Item key={h.sysId} page={page} item={h} line={`${h.state} · ${h.hoursAgo}h ago${h.assignment_group ? ` · ${h.assignment_group}` : ''}`} />
          ))}
          <Notes access={duplicates.value.access} />
        </Section>
      )}

      {knowledge && (
        <Section title="Knowledge that may help" count={knowledge.value?.hits?.length}>
          {knowledge.error && <p className="ab-note ab-note-danger">{knowledge.error}</p>}
          {(knowledge.value?.hits || []).map((h) => (
            <Item key={h.sysId} page={page} item={{ ...h, table: 'kb_knowledge' }} line={h.knowledgeBase} extra={clip(h.excerpt, 180)} />
          ))}
          {knowledge.value?.hits?.length === 0 && !knowledge.error && <p className="ab-hint">No matching published articles.</p>}
          <Notes access={knowledge.value?.access} />
        </Section>
      )}
    </>
  );
}

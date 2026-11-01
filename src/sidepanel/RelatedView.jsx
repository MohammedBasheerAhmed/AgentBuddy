import { useCallback, useEffect, useRef, useState } from 'react';
import { read as ask } from './ask.js';
import RecordLink from './RecordLink.jsx';
import Notes from './knowledge/Notes.jsx';
import ErrorNote from './ErrorNote.jsx';
import { readFailure } from './plainAccess.js';

// A2, A3, C4 and the outage check (E2): what happened before for this person, tickets solved like this one, open tickets on
// the same service, and knowledge that may help. All of it is read with the person's own session and ranked locally: no AI
// call, no key needed, nothing leaves the browser. Items are real links that open in a new tab next to the ticket, so the ticket
// being worked on is never replaced (the Ticket screen's cards in src/sidepanel/ticket/cards replace this view).

const CALLER_ROLES = ['caller', 'requested_for', 'contact', 'consumer', 'opened_by', 'requester'];

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
    <RecordLink page={page} item={item} newTab className="ab-feature">
      <span className="ab-record-number">{item.number}</span>
      <span className="ab-feature-title">{item.short_description}</span>
      {line && <span className="ab-feature-desc">{line}</span>}
      {extra && <span className="ab-feature-desc">{extra}</span>}
    </RecordLink>
  );
}

/** A part that could not be read: "not available to you" as a plain line, anything else as an error. */
function Failed({ failure }) {
  if (!failure) return null;
  return failure.kind === 'error' ? <p className="ab-note ab-note-danger">{failure.text}</p> : <p className="ab-hint">{failure.text}</p>;
}

const EMPTY = { phase: 'loading', pack: null, history: null, similar: null, duplicates: null, knowledge: null, error: null };

export default function RelatedView({ page, eff }) {
  const { record } = page;
  const [state, setState] = useState(EMPTY);
  const allowSensitive = Boolean(eff.policy?.allowHrContent);
  // Every load takes a number; an answer for an older load (the person pressed Refresh, or the policy changed while it was
  // reading) is dropped, so it can never overwrite what a newer load found.
  const token = useRef(0);

  const load = useCallback(async () => {
    token.current += 1;
    const mine = token.current;
    const apply = (fn) => mine === token.current && setState(fn);
    setState(EMPTY);
    try {
      // The 'similar' pack carries only what the look-alike search needs, not who the caller is (that column is not on its
      // allowlist), so the caller comes from the 'caller-history' pack.
      const [searchPack, whoPack] = await Promise.all([
        ask(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: 'similar', allowSensitive }),
        ask(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: 'caller-history', allowSensitive }),
      ]);
      if (mine !== token.current) return;
      const pack = { ...searchPack, people: Array.isArray(whoPack?.people) ? whoPack.people : [] };
      apply((s) => ({ ...s, pack }));
      const caller = pack.people.find((p) => p.sysId && CALLER_ROLES.includes(p.role)) || pack.people.find((p) => p.sysId);
      const slim = { table: pack.table, sysId: pack.sysId, number: pack.number, fields: pack.fields };
      const settle = (promise, key, what) =>
        promise.then(
          (value) => apply((s) => ({ ...s, [key]: { value } })),
          (err) => apply((s) => ({ ...s, [key]: { failure: readFailure(err, what) } }))
        );
      await Promise.all([
        caller
          ? settle(ask(page.tabId, 'history', { callerSysId: caller.sysId, excludeSysId: pack.sysId, allowSensitive }), 'history', 'Earlier tickets from this person')
          : settle(Promise.resolve({ items: [], signals: null, access: [] }), 'history', ''),
        settle(ask(page.tabId, 'similar', { pack: slim, resolvedOnly: true, allowSensitive }), 'similar', 'Solved tickets like this one'),
        settle(ask(page.tabId, 'duplicates', { pack: slim, windowHours: 24, allowSensitive }), 'duplicates', 'Open tickets on the same service'),
        settle(ask(page.tabId, 'knowledge', { pack: slim }), 'knowledge', 'Knowledge articles'),
      ]);
      apply((s) => ({ ...s, phase: 'ready' }));
    } catch (err) {
      apply((s) => ({ ...s, phase: 'error', error: readFailure(err, 'This ticket') }));
    }
  }, [page.tabId, record.table, record.sysId, allowSensitive]);

  useEffect(() => {
    load();
    return () => {
      token.current += 1;
    };
  }, [load]);

  const { history, similar, duplicates, knowledge } = state;
  const sig = history?.value?.signals;
  const callerName = (state.pack?.people || []).find((p) => CALLER_ROLES.includes(p.role))?.name;
  // (the answers come from the page: a list that is missing is an empty one, never a crash)
  const items = (part, key) => (Array.isArray(part?.value?.[key]) ? part.value[key] : []);
  const openHits = items(duplicates, 'hits');

  return (
    <>
      <div className="ab-row" style={{ justifyContent: 'space-between' }}>
        <span className="ab-sub">Found with your own session. Nothing here is sent to an AI. A ticket opens in a new tab next to this one.</span>
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={load} disabled={state.phase === 'loading'}>Refresh</button>
      </div>
      {state.phase === 'loading' && !state.pack && <p className="ab-note" role="status">Looking…</p>}
      {state.phase === 'error' && state.error?.kind === 'error' && <ErrorNote error={state.error.text} onRetry={load} />}
      {state.phase === 'error' && state.error && state.error.kind !== 'error' && <p className="ab-note" role="status">{state.error.text}</p>}

      {openHits.length > 0 && (
        <p className="ab-note ab-note-warn" role="status">
          {openHits.length} other open ticket{openHits.length === 1 ? '' : 's'} on the same service in the last {duplicates.value.windowHours} hours. This could be a wider issue.
        </p>
      )}
      {duplicates?.failure && (
        <p className={duplicates.failure.kind === 'error' ? 'ab-note ab-note-warn' : 'ab-hint'} role="status">
          {duplicates.failure.kind === 'error' ? 'Open tickets on the same service could not be checked. Press Refresh to try again.' : duplicates.failure.text}
        </p>
      )}

      {history && (
        <Section title={callerName ? `Earlier tickets from ${callerName}` : 'Earlier tickets from this person'} count={history.value ? items(history, 'items').length : undefined}>
          <Failed failure={history.failure} />
          {sig && (
            <p className="ab-sub">
              {items(history, 'items').length} earlier · {sig.openCount} still open{sig.daysSinceLast !== null ? ` · last one ${sig.daysSinceLast === 0 ? 'today' : `${sig.daysSinceLast} day${sig.daysSinceLast === 1 ? '' : 's'} ago`}` : ''}
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
          {[...items(history, 'items')].reverse().slice(0, 6).map((item) => (
            <Item key={item.sysId} page={page} item={item} line={`${item.state}${item.opened_at ? ` · opened ${item.opened_at.slice(0, 10)}` : ''}`} />
          ))}
          {history.value && items(history, 'items').length === 0 && <p className="ab-hint">No earlier tickets found for this person.</p>}
          <Notes access={history.value?.access} />
        </Section>
      )}

      {similar && (
        <Section title="Solved before" count={similar.value ? items(similar, 'hits').length : undefined}>
          <Failed failure={similar.failure} />
          {items(similar, 'hits').map((h) => (
            <Item key={h.sysId} page={page} item={h} line={Array.isArray(h.why) ? h.why.join('; ') : ''} extra={h.close_notes ? `Fix: ${clip(h.close_notes, 200)}` : ''} />
          ))}
          {similar.value && items(similar, 'hits').length === 0 && <p className="ab-hint">No similar solved tickets found.</p>}
          <Notes access={similar.value?.access} />
        </Section>
      )}

      {openHits.length > 0 && (
        <Section title="Same service, still open" count={openHits.length}>
          {openHits.map((h) => (
            <Item key={h.sysId} page={page} item={h} line={`${h.state} · ${h.hoursAgo}h ago${h.assignment_group ? ` · ${h.assignment_group}` : ''}`} />
          ))}
          <Notes access={duplicates.value.access} />
        </Section>
      )}

      {knowledge && (
        <Section title="Knowledge that may help" count={knowledge.value ? items(knowledge, 'hits').length : undefined}>
          <Failed failure={knowledge.failure} />
          {items(knowledge, 'hits').map((h) => (
            <Item key={h.sysId} page={page} item={{ ...h, table: 'kb_knowledge' }} line={h.knowledgeBase} extra={clip(h.excerpt, 180)} />
          ))}
          {knowledge.value && items(knowledge, 'hits').length === 0 && <p className="ab-hint">No matching published articles.</p>}
          <Notes access={knowledge.value?.access} />
        </Section>
      )}
    </>
  );
}

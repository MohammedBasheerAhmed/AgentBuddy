import { useCallback, useEffect, useState } from 'react';
import { read } from '../ask.js';
import { describeMinutes } from '../../chat/stats.js';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import Notes from '../knowledge/Notes.jsx';
import { aiNeedsText } from '../aiReady.js';

// D1, D2: the facts about this chat (who, how many messages, how long the customer has waited, what they said last) with no
// AI, and one-click buttons for the two AI features. The messages are read with the person's own session; when the chat tables
// are not readable the tab says so instead of showing an empty chat.
// props: { page, eff, record, header, run, aiReady }

const WAITING_WARN_MINUTES = 5;
const ROLE = { customer: 'customer', agent: 'agent', opened_for: 'customer', assigned_to: 'agent', journal_author: 'in the chat' };

export default function ChatRecordView({ page, eff, record, run, aiReady }) {
  const [state, setState] = useState({ phase: 'loading', data: null, error: '' });
  const summary = featureById('chat-summary');
  const reply = featureById('chat-reply');

  const load = useCallback(async () => {
    setState({ phase: 'loading', data: null, error: '' });
    try {
      const data = await read(page.tabId, 'chatOverview', { table: record.table, sysId: record.sysId });
      setState({ phase: 'ready', data, error: '' });
    } catch (err) {
      setState({ phase: 'error', data: null, error: err?.message || 'The chat could not be read.' });
    }
  }, [page.tabId, record.table, record.sysId]);

  useEffect(() => {
    load();
  }, [load]);

  const { phase, data, error } = state;
  const o = data?.overview;
  const chatEntry = (data?.access || []).find((a) => a.source === 'chat');
  const noMessages = phase === 'ready' && o.count === 0;

  const button = (feature, primary) => (
    <button
      key={feature.id}
      type="button"
      className={`ab-btn${primary ? ' ab-btn-primary' : ''}`}
      disabled={!aiReady || run.busy || !isFeatureAvailable(feature, eff.policy) || noMessages}
      onClick={() => run.run(feature)}
    >
      {feature.title}
    </button>
  );

  return (
    <>
      <section className="ab-card">
        <div className="ab-row ab-kb-head">
          <h2 className="ab-h">This chat</h2>
          <span className="ab-spacer" />
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={load} disabled={phase === 'loading'}>Refresh</button>
        </div>
        <p className="ab-sub">Read with your own session. Nothing here is sent to an AI.</p>
        {phase === 'loading' && <p className="ab-note" role="status">Reading the conversation…</p>}
        {phase === 'error' && <p className="ab-note ab-note-danger" role="alert">{error}</p>}

        {noMessages && (
          <p className="ab-note ab-note-warn" role="status">
            {chatEntry?.note || 'No chat messages are available to you.'}
          </p>
        )}

        {phase === 'ready' && !noMessages && (
          <>
            <div className="ab-tags">
              <span className="ab-tag">{o.count} message{o.count === 1 ? '' : 's'}</span>
              {o.canTellSides && <span className="ab-tag">{o.byCustomer} from the customer</span>}
              {o.canTellSides && <span className="ab-tag">{o.byAgent} from agents</span>}
              {o.byBot > 0 && <span className="ab-tag">{o.byBot} from a bot</span>}
              <span className="ab-tag">{o.ended ? 'chat ended' : 'chat open'}</span>
            </div>
            {o.waitingMinutes !== null && (
              <p className={`ab-note ${o.waitingMinutes >= WAITING_WARN_MINUTES ? 'ab-note-warn' : ''}`} role="status">
                The customer has been waiting {describeMinutes(o.waitingMinutes)} for an answer.
              </p>
            )}
            {!o.canTellSides && <p className="ab-hint">This instance does not say who sent each message, so waiting time cannot be worked out.</p>}
            <dl className="ab-kb-facts">
              {o.durationMinutes !== null && (
                <>
                  <dt>Lasted</dt>
                  <dd>{describeMinutes(o.durationMinutes)}</dd>
                </>
              )}
              {o.firstResponseMinutes !== null && (
                <>
                  <dt>First reply after</dt>
                  <dd>{describeMinutes(o.firstResponseMinutes)}</dd>
                </>
              )}
              {o.participants.length > 0 && (
                <>
                  <dt>Taking part</dt>
                  <dd>{o.participants.map((p) => `${p.name}${ROLE[p.role] ? ` (${ROLE[p.role]})` : ''}`).join(', ')}</dd>
                </>
              )}
            </dl>
            {(o.lastCustomer || o.lastMessage) && (
              <blockquote className="ab-kb-quote">
                <span className="ab-kb-quote-head">{o.lastCustomer ? "The customer's last message" : 'Last message'}</span>
                {(o.lastCustomer || o.lastMessage).text}
              </blockquote>
            )}
          </>
        )}
        {phase === 'ready' && chatEntry && chatEntry.status === 'ok' && chatEntry.note && /newest/.test(chatEntry.note) && <p className="ab-hint">{chatEntry.note}</p>}
        {phase === 'ready' && <Notes access={(data.access || []).filter((a) => a.source !== 'chat' || !noMessages)} />}
      </section>

      <section className="ab-card">
        <h2 className="ab-h">With AI</h2>
        <p className="ab-sub">The chat goes through the privacy filter first. Replies are never sent for you: copy the one you want into the chat.</p>
        {/* A disabled button says why, next to it (greyed text alone does not). */}
        {!aiReady && <p className="ab-hint">{aiNeedsText(eff, 'these buttons') || 'Add an AI key in Settings to use these buttons.'}</p>}
        {aiReady && noMessages && <p className="ab-hint">There are no messages to work with.</p>}
        <div className="ab-row">
          {button(summary, true)}
          {button(reply, false)}
        </div>
      </section>
    </>
  );
}

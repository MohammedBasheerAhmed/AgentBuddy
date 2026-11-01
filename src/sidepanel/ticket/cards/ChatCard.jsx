import React from 'react';
import { describeMinutes } from '../../../chat/stats.js';
import { CHAT_WAITING_WARN_MINUTES, chatOverviewOf } from '../../../insights/chat.js';
import { read } from './data.js';
import { recordKey, useInsight, useReport } from './useInsight.js';
import { Notes, QuietButton, ReadState } from './bits.jsx';

// N8, chat facts: how many messages, from whom, how long the customer has waited, how long it lasted, who takes part, and the
// customer's last message. Read with the person's own session; when the chat tables are not readable it says so instead of showing an
// empty chat. Read again each time the card is shown (new messages may have arrived). (Summaries and reply ideas are in AI Assist.)

const ROLE = { customer: 'customer', agent: 'agent', opened_for: 'customer', assigned_to: 'agent', journal_author: 'in the chat' };

export default function ChatCard({ page, record, active, setSummary, setAttention }) {
  const state = useInsight({
    key: `${recordKey(page, record)}|chat`,
    load: async () => chatOverviewOf(await read(page.tabId, 'chatOverview', { table: record.table, sysId: record.sysId })),
    active,
    maxAgeMs: 15000,
    refreshOnShow: true,
  });
  const o = state.data?.overview;
  const access = state.data?.access || [];
  const chatEntry = access.find((a) => a.source === 'chat');
  const noMessages = Boolean(o) && o.count === 0;
  const waiting = o && !o.ended && o.waitingMinutes !== null ? o.waitingMinutes : null;
  useReport(setSummary, o ? (noMessages ? 'No messages available' : [`${o.count} message${o.count === 1 ? '' : 's'}`, waiting !== null ? `customer waiting ${describeMinutes(waiting)}` : o.ended ? 'ended' : ''].filter(Boolean).join(' · ')) : '');
  useReport(setAttention, waiting !== null && waiting >= CHAT_WAITING_WARN_MINUTES ? 'warn' : '');

  if (!o) return <ReadState state={state} what="the conversation" onRetry={state.reload} />;
  return (
    <>
      {noMessages ? (
        <p className="ab-note ab-note-warn" role="status">{chatEntry?.note || 'No chat messages are available to you.'}</p>
      ) : (
        <>
          <div className="ab-tags">
            <span className="ab-tag">{o.count} message{o.count === 1 ? '' : 's'}</span>
            {o.canTellSides && <span className="ab-tag">{o.byCustomer} from the customer</span>}
            {o.canTellSides && <span className="ab-tag">{o.byAgent} from agents</span>}
            {o.byBot > 0 && <span className="ab-tag">{o.byBot} from a bot</span>}
            <span className="ab-tag">{o.ended ? 'chat ended' : 'chat open'}</span>
          </div>
          {o.waitingMinutes !== null && (
            <p className={`ab-note ${o.waitingMinutes >= CHAT_WAITING_WARN_MINUTES ? 'ab-note-warn' : ''}`} role="status">
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
      {chatEntry && chatEntry.status === 'ok' && chatEntry.note && /newest/.test(chatEntry.note) && <p className="ab-hint">{chatEntry.note}</p>}
      <Notes access={access.filter((a) => a.source !== 'chat' || !noMessages)} />
      <div className="ab-ins-foot">
        <QuietButton onClick={state.reload} disabled={state.phase === 'loading'}>
          Refresh
        </QuietButton>
      </div>
    </>
  );
}

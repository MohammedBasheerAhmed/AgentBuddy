import { read } from '../ask.js';
import { describeMinutes } from '../../chat/stats.js';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import Notes from '../knowledge/Notes.jsx';
import ErrorNote from '../ErrorNote.jsx';
import { aiNeedsText } from '../aiReady.js';
import { useLoader } from '../checks/useLoader.js';
import { chatOverviewOf } from '../../insights/chat.js';
import { t } from '../../i18n/index.js';

// D1, D2: the facts about this chat (who, how many messages, how long the customer has waited, what they said last) with no
// AI, and one-click buttons for the two AI features. The messages are read with the person's own session; when the chat tables
// are not readable the tab says so instead of showing an empty chat.
// props: { page, eff, record, header, run, aiReady, active }. `active`: the tab is on show (it reads again when it comes back into view:
// new messages may have arrived).

const WAITING_WARN_MINUTES = 5;
const ROLE = { customer: 'customer', agent: 'agent', opened_for: 'customer', assigned_to: 'agent', journal_author: 'in the chat' };
// The answer check lives in src/insights/chat.js (the Ticket screen's chat card uses it too); kept exported here for older imports.
export { chatOverviewOf };

export default function ChatRecordView({ page, eff, record, run, aiReady, active = true }) {
  const summary = featureById('chat-summary');
  const reply = featureById('chat-reply');

  const [state, load] = useLoader(async () => chatOverviewOf(await read(page.tabId, 'chatOverview', { table: record.table, sysId: record.sysId })), [page.tabId, record.table, record.sysId], { active });

  // While it reads again the last answer stays on screen.
  const { data, error } = state;
  const phase = data ? 'ready' : state.phase;
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
          <h2 className="ab-h">{t('This chat')}</h2>
          <span className="ab-spacer" />
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={load} disabled={state.phase === 'loading'}>{t('Refresh')}</button>
        </div>
        <p className="ab-sub">{t('Read with your own session. Nothing here is sent to an AI.')}</p>
        {phase === 'loading' && <p className="ab-note" role="status">{t('Reading the conversation…')}</p>}
        {phase === 'error' && <ErrorNote error={error} onRetry={load} />}

        {noMessages && (
          <p className="ab-note ab-note-warn" role="status">
            {chatEntry?.note || 'No chat messages are available to you.'}
          </p>
        )}

        {phase === 'ready' && !noMessages && (
          <>
            <div className="ab-tags">
              <span className="ab-tag">{o.count} message{o.count === 1 ? '' : 's'}</span>
              {o.canTellSides && <span className="ab-tag">{t('{byCustomer} from the customer', { byCustomer: o.byCustomer })}</span>}
              {o.canTellSides && <span className="ab-tag">{t('{byAgent} from agents', { byAgent: o.byAgent })}</span>}
              {o.byBot > 0 && <span className="ab-tag">{t('{byBot} from a bot', { byBot: o.byBot })}</span>}
              <span className="ab-tag">{o.ended ? 'chat ended' : 'chat open'}</span>
            </div>
            {o.waitingMinutes !== null && (
              <p className={`ab-note ${o.waitingMinutes >= WAITING_WARN_MINUTES ? 'ab-note-warn' : ''}`} role="status">
                The customer has been waiting {describeMinutes(o.waitingMinutes)} for an answer.
              </p>
            )}
            {!o.canTellSides && <p className="ab-hint">{t('This instance does not say who sent each message, so waiting time cannot be worked out.')}</p>}
            <dl className="ab-kb-facts">
              {o.durationMinutes !== null && (
                <>
                  <dt>{t('Lasted')}</dt>
                  <dd>{describeMinutes(o.durationMinutes)}</dd>
                </>
              )}
              {o.firstResponseMinutes !== null && (
                <>
                  <dt>{t('First reply after')}</dt>
                  <dd>{describeMinutes(o.firstResponseMinutes)}</dd>
                </>
              )}
              {o.participants.length > 0 && (
                <>
                  <dt>{t('Taking part')}</dt>
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
        <h2 className="ab-h">{t('With AI')}</h2>
        <p className="ab-sub">{t('The chat goes through the privacy filter first. Replies are never sent for you: copy the one you want into the chat.')}</p>
        {/* A disabled button says why, next to it (greyed text alone does not). */}
        {!aiReady && <p className="ab-hint">{aiNeedsText(eff, 'these buttons') || 'Add an AI key in Settings to use these buttons.'}</p>}
        {aiReady && noMessages && <p className="ab-hint">{t('There are no messages to work with.')}</p>}
        <div className="ab-row">
          {button(summary, true)}
          {button(reply, false)}
        </div>
      </section>
    </>
  );
}

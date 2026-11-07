import { describeMinutes } from '../../../chat/stats.js';
import { CHAT_WAITING_WARN_MINUTES, chatOverviewOf } from '../../../insights/chat.js';
import { read } from './data.js';
import { recordKey, useInsight, useReport } from './useInsight.js';
import { Notes, QuietButton, ReadState } from './bits.jsx';
import { plainNote } from '../../plainAccess.js';
import { t, tn, isolate } from '../../../i18n/index.js';

// N8, chat facts: how many messages, from whom, how long the customer has waited, how long it lasted, who takes part, and the
// customer's last message. Read with the person's own session; when the chat tables are not readable it says so instead of showing an
// empty chat. Read again each time the card is shown (new messages may have arrived). (Summaries and reply ideas are in AI Assist.)

const roleWord = (role) => ({ customer: t('customer'), agent: t('agent'), opened_for: t('customer'), assigned_to: t('agent'), journal_author: t('in the chat') })[role];

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
  useReport(
    setSummary,
    o ? (noMessages ? t('No messages available') : [tn(o.count, '{n} message', '{n} messages'), waiting !== null ? t('customer waiting {time}', { time: describeMinutes(waiting) }) : o.ended ? t('ended') : ''].filter(Boolean).join(' · ')) : ''
  );
  useReport(setAttention, waiting !== null && waiting >= CHAT_WAITING_WARN_MINUTES ? 'warn' : '');

  if (!o) return <ReadState state={state} what={t('the conversation')} onRetry={state.reload} />;
  return (
    <>
      {noMessages ? (
        <p className="ab-note ab-note-warn" role="status">{plainNote(chatEntry?.note) || t('No chat messages are available to you.')}</p>
      ) : (
        <>
          <div className="ab-tags">
            <span className="ab-tag">{tn(o.count, '{n} message', '{n} messages')}</span>
            {o.canTellSides && <span className="ab-tag">{t('{byCustomer} from the customer', { byCustomer: o.byCustomer })}</span>}
            {o.canTellSides && <span className="ab-tag">{t('{byAgent} from agents', { byAgent: o.byAgent })}</span>}
            {o.byBot > 0 && <span className="ab-tag">{t('{byBot} from a bot', { byBot: o.byBot })}</span>}
            <span className="ab-tag">{o.ended ? t('chat ended') : t('chat open')}</span>
          </div>
          {o.waitingMinutes !== null && (
            <p className={`ab-note ${o.waitingMinutes >= CHAT_WAITING_WARN_MINUTES ? 'ab-note-warn' : ''}`} role="status">
              {t('The customer has been waiting {time} for an answer.', { time: describeMinutes(o.waitingMinutes) })}
            </p>
          )}
          {!o.canTellSides && <p className="ab-hint">{t('ServiceNow does not say who sent each message here, so waiting time cannot be worked out.')}</p>}
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
                <dd>{o.participants.map((p) => (roleWord(p.role) ? t('{name} ({role})', { name: isolate(p.name), role: roleWord(p.role) }) : isolate(p.name))).join(t(', '))}</dd>
              </>
            )}
          </dl>
          {(o.lastCustomer || o.lastMessage) && (
            <blockquote className="ab-kb-quote">
              <span className="ab-kb-quote-head">{o.lastCustomer ? t("The customer's last message") : t('Last message')}</span>
              {(o.lastCustomer || o.lastMessage).text}
            </blockquote>
          )}
        </>
      )}
      {chatEntry && chatEntry.status === 'ok' && chatEntry.note && /newest/.test(chatEntry.note) && <p className="ab-hint">{plainNote(chatEntry.note)}</p>}
      <Notes access={access.filter((a) => a.source !== 'chat' || !noMessages)} />
      <div className="ab-ins-foot">
        <QuietButton onClick={state.reload} disabled={state.phase === 'loading'}>
          {t('Refresh')}
        </QuietButton>
      </div>
    </>
  );
}

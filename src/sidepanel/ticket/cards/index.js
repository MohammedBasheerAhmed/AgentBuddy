// The Ticket screen's Insights half: its cards and the ticket-at-a-glance header (owner: Insights agent, docs/round3.md).
//
// INSIGHT_CARDS: [{ id, title, kinds, profiles, order(record, header), defaultOpen, openWhen(record, header), Card }]
//   Card props: { page, eff, record, header, active, open, setSummary(text), setAttention(status), onShowCard? }
//     setSummary: the card's one-line answer, shown on its row without opening it
//     setAttention: the card's status: 'danger' | 'warn' (it needs a look: its row comes first, and the row of the five it is in has
//       a dot, in the list and in the side rail, and counts on the Insights tab), 'ok' (good news: a fix was found), 'clear' (nothing
//       to report), '' (plain)
//   Which of the five rows a card is drawn in, if any, is src/features/focus.js PAIN_POINTS; the others are under All tools.
//   order: a function of the ticket's state (src/insights/order.js): New tickets put missing details and routing first, resolved ones
//          "Ready to resolve?", tickets on hold the right email.
//   defaultOpen: a card that is the record's own main view (request status, the checklist, article checks, chat facts) opens on first
//     view where openWhen says it is worth it for the ticket's state; every other row starts folded, its one line showing.
// Glance props: { page, eff, record, header, headPhase, active? }
//
// No card carries an AI mark or sends anything anywhere: every read is a GET with the agent's own session, kept in panel memory.
import { openFor, rankFor } from '../../../insights/order.js';
import { recordKey } from './useInsight.js';
import Glance from './Glance.jsx';
import RelatedCard from './RelatedCard.jsx';
import CallerCard from './CallerCard.jsx';
import KnowledgeCard from './KnowledgeCard.jsx';
import ResolveCard from './ResolveCard.jsx';
import RequestCard from './RequestCard.jsx';
import ChecklistCard from './ChecklistCard.jsx';
import ArticleCard from './ArticleCard.jsx';
import ChatCard from './ChatCard.jsx';
import RiskCard from './RiskCard.jsx';
import RoutingCard from './RoutingCard.jsx';
import MissingCard from './MissingCard.jsx';
import StepsCard from './StepsCard.jsx';
import FulfilledCard from './FulfilledCard.jsx';
import EmailCard from './EmailCard.jsx';
import JourneyCard from './JourneyCard.jsx';
import ChangesCard from './ChangesCard.jsx';
import KnownErrorsCard from './KnownErrorsCard.jsx';
import AccountCard from './AccountCard.jsx';
import OutageCard from './OutageCard.jsx';
import { t } from '../../../i18n/index.js';

// The shell keeps one card component per card id and passes the record as a prop; keying on the record gives every ticket a fresh
// card (ticks, a chosen email kind, folded groups), as a new tab of the browser would.
function perRecord(Inner, name) {
  function Keyed(props) {
    return <Inner key={recordKey(props.page, props.record)} {...props} />;
  }
  Keyed.displayName = name;
  return Keyed;
}

const TICKETS = ['incident', 'problem', 'change', 'request', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task'];
const FAULTS = ['incident', 'problem', 'case', 'task'];
const WITH_CI = ['incident', 'problem', 'case'];

// `title` is a function: the card list is built once at import, the text must follow the language the person has now (a getter).
const card = (id, title, kinds, profiles, Card, defaultOpen = false) => ({
  id,
  get title() {
    return title();
  },
  kinds,
  profiles,
  order: (record, header) => rankFor(id, header, record),
  defaultOpen,
  openWhen: (record, header) => openFor(id, header, record),
  Card: perRecord(Card, `${id}Card`),
});

export const INSIGHT_CARDS = Object.freeze([
  card('request', () => t('Request status'), ['request', 'requested_item', 'catalog_task'], ['req', 'it'], RequestCard, true), // N5
  card('checklist', () => t('Fulfilment checklist'), ['catalog_task', 'requested_item'], ['req'], ChecklistCard, true), // N6
  card('article', () => t('Article checks'), ['knowledge'], ['km'], ArticleCard, true), // N7
  card('chat', () => t('Chat facts'), ['chat'], ['csm', 'it'], ChatCard, true), // N8
  card('account', () => t('Account at a glance'), ['case'], ['csm'], AccountCard), // N28
  card('missing', () => t('Missing details'), FAULTS, ['it', 'csm'], MissingCard), // N11
  card('routing', () => t('Where similar tickets went'), ['incident', 'case'], ['it', 'csm'], RoutingCard), // N10
  // (wave 6: what the last tasks of this kind that were done say; one card inside the Find the fix row; no AI, one limited read)
  card('fulfilled', () => t('Fulfilled before'), ['requested_item', 'catalog_task'], ['req', 'it'], FulfilledCard),
  card('steps', () => t('Steps that worked before'), ['incident', 'problem', 'case', 'requested_item', 'catalog_task', 'task'], ['it', 'csm', 'req'], StepsCard), // N12
  card('caller', () => t("Caller's other tickets"), TICKETS, ['all'], CallerCard), // N2, the caller's half (the "Same caller" row)
  card('related', () => t('Related tickets'), TICKETS, ['all'], RelatedCard), // N2
  card('knowledge', () => t('Knowledge for this ticket'), TICKETS.filter((k) => k !== 'change'), ['all'], KnowledgeCard), // N3
  card('changes', () => t('Recent changes on this CI or service'), WITH_CI, ['it', 'mpc'], ChangesCard), // N25
  card('knownErrors', () => t('Known errors and open problems'), WITH_CI, ['it', 'mpc'], KnownErrorsCard), // N26
  card('risk', () => t('Risk signals'), ['incident', 'case', 'problem', 'requested_item', 'catalog_task', 'task'], ['it', 'csm'], RiskCard), // N9
  card('email', () => t('Which email fits'), TICKETS, ['all'], EmailCard), // N20
  card('journey', () => t('Ticket journey'), TICKETS, ['all'], JourneyCard), // N24
  card('outage', () => t('Outage spotter'), WITH_CI, ['it'], OutageCard), // N29
  // (a change and an HR case have a close too: W-09, W-10; an HR case's checks are honest about the text it was read without)
  card('resolve', () => t('Ready to resolve?'), ['incident', 'problem', 'change', 'request', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task'], ['all'], ResolveCard), // N4
]);

export { Glance };

// The Ticket screen's Insights half: its cards and the ticket-at-a-glance header (owner: Insights agent, docs/round3.md).
//
// INSIGHT_CARDS: [{ id, title, kinds, profiles, order(record, header), defaultOpen, openWhen(record, header), Card }]
//   Card props: { page, eff, record, header, active, setSummary(text), setAttention('' | 'warn' | 'danger'), onShowCard? }
//   order: a function of the ticket's state (src/insights/order.js): New tickets put missing details and routing first, resolved ones
//          "Ready to resolve?", tickets on hold the right email.
//   defaultOpen: the open state when the shell does not use openWhen; openWhen: the cards worth opening for the ticket's state.
// Glance props: { page, eff, record, header, headPhase, quickBar, onShowCard? }   (quickBar: the node to draw inside the header)
//
// No card carries an AI mark or sends anything anywhere: every read is a GET with the agent's own session, kept in panel memory.
import React from 'react';
import { openFor, rankFor } from '../../../insights/order.js';
import { recordKey } from './useInsight.js';
import Glance from './Glance.jsx';
import RelatedCard from './RelatedCard.jsx';
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
import EmailCard from './EmailCard.jsx';
import JourneyCard from './JourneyCard.jsx';
import ChangesCard from './ChangesCard.jsx';
import KnownErrorsCard from './KnownErrorsCard.jsx';
import AccountCard from './AccountCard.jsx';
import OutageCard from './OutageCard.jsx';

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

const card = (id, title, kinds, profiles, Card, defaultOpen = false) => ({
  id,
  title,
  kinds,
  profiles,
  order: (record, header) => rankFor(id, header),
  defaultOpen,
  openWhen: (record, header) => openFor(id, header),
  Card: perRecord(Card, `${id}Card`),
});

export const INSIGHT_CARDS = Object.freeze([
  card('request', 'Request status', ['request', 'requested_item', 'catalog_task'], ['req', 'it'], RequestCard, true), // N5
  card('checklist', 'Fulfilment checklist', ['catalog_task', 'requested_item'], ['req'], ChecklistCard, true), // N6
  card('article', 'Article checks', ['knowledge'], ['km'], ArticleCard, true), // N7
  card('chat', 'Chat facts', ['chat'], ['csm', 'it'], ChatCard, true), // N8
  card('account', 'Account at a glance', ['case'], ['csm'], AccountCard), // N28
  card('missing', 'Missing details', FAULTS, ['it', 'csm'], MissingCard), // N11
  card('routing', 'Where similar tickets went', ['incident', 'case'], ['it', 'csm'], RoutingCard), // N10
  card('steps', 'Steps that worked before', ['incident', 'problem', 'case', 'requested_item', 'catalog_task', 'task'], ['it', 'csm', 'req'], StepsCard, true), // N12
  card('related', 'Related tickets', TICKETS, ['all'], RelatedCard), // N2
  card('knowledge', 'Knowledge for this ticket', TICKETS.filter((k) => k !== 'change'), ['all'], KnowledgeCard), // N3
  card('changes', 'Recent changes on this CI or service', WITH_CI, ['it', 'mpc'], ChangesCard), // N25
  card('knownErrors', 'Known errors and open problems', WITH_CI, ['it', 'mpc'], KnownErrorsCard), // N26
  card('risk', 'Risk signals', ['incident', 'case', 'problem', 'requested_item', 'catalog_task', 'task'], ['it', 'csm'], RiskCard), // N9
  card('email', 'Which email fits', TICKETS, ['all'], EmailCard), // N20
  card('journey', 'Ticket journey', TICKETS, ['all'], JourneyCard), // N24
  card('outage', 'Outage spotter', WITH_CI, ['it'], OutageCard), // N29
  card('resolve', 'Ready to resolve?', ['incident', 'problem', 'request', 'requested_item', 'catalog_task', 'case', 'task'], ['all'], ResolveCard), // N4
]);

export { Glance };

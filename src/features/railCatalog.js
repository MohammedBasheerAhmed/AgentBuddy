// The Insights cards of the Ticket screen as plain data: id, title, the kinds of record and the work profiles each is for. Settings >
// Side rail lists what a kind of record offers without a record open, and must not carry the card components (React views, their reads)
// into the Settings page, so it reads this light copy instead of src/sidepanel/ticket/cards/index.js INSIGHT_CARDS.
//
// It is a copy, so it is kept honest by a test: tests/rail-catalog.test.js checks it against INSIGHT_CARDS (same ids in the same order,
// the same titles, kinds and profiles). A card added there and not here fails that test.
//
// (core.js, not index.js: this file stays as light as the cards' own table; the page that shows it registers the Arabic texts.)
import { rankFor } from '../insights/order.js';
import { shownFor } from '../profiles/profiles.js';
import { t } from '../i18n/core.js';

const TICKETS = ['incident', 'problem', 'change', 'request', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task'];
const FAULTS = ['incident', 'problem', 'case', 'task'];
const WITH_CI = ['incident', 'problem', 'case'];

// `title` is a getter, as in INSIGHT_CARDS: the words follow the language the page has when they are read.
const card = (id, title, kinds, profiles) => Object.freeze({
  id,
  get title() {
    return title();
  },
  kinds: Object.freeze([...kinds]),
  profiles: Object.freeze([...profiles]),
});

export const RAIL_CARDS = Object.freeze([
  card('request', () => t('Request status'), ['request', 'requested_item', 'catalog_task'], ['req', 'it']),
  card('checklist', () => t('Fulfilment checklist'), ['catalog_task', 'requested_item'], ['req']),
  card('article', () => t('Article checks'), ['knowledge'], ['km']),
  card('chat', () => t('Chat facts'), ['chat'], ['csm', 'it']),
  card('account', () => t('Account at a glance'), ['case'], ['csm']),
  card('missing', () => t('Missing details'), FAULTS, ['it', 'csm']),
  card('routing', () => t('Where similar tickets went'), ['incident', 'case'], ['it', 'csm']),
  card('steps', () => t('Steps that worked before'), ['incident', 'problem', 'case', 'requested_item', 'catalog_task', 'task'], ['it', 'csm', 'req']),
  card('related', () => t('Related tickets'), TICKETS, ['all']),
  card('knowledge', () => t('Knowledge for this ticket'), TICKETS.filter((k) => k !== 'change'), ['all']),
  card('changes', () => t('Recent changes on this CI or service'), WITH_CI, ['it', 'mpc']),
  card('knownErrors', () => t('Known errors and open problems'), WITH_CI, ['it', 'mpc']),
  card('risk', () => t('Risk signals'), ['incident', 'case', 'problem', 'requested_item', 'catalog_task', 'task'], ['it', 'csm']),
  card('email', () => t('Which email fits'), TICKETS, ['all']),
  card('journey', () => t('Ticket journey'), TICKETS, ['all']),
  card('outage', () => t('Outage spotter'), WITH_CI, ['it']),
  card('resolve', () => t('Ready to resolve?'), ['incident', 'problem', 'request', 'requested_item', 'catalog_task', 'case', 'task'], ['all']),
]);

/**
 * The cards a kind of record offers to this person (its kinds, their work profiles or "Show everything"), in the order a ticket that is
 * being worked shows them (src/insights/order.js, no state known). What the Ticket screen shows for an open record also depends on the
 * record (its state moves cards up; a card may not apply to it); this is the list Settings can arrange.
 * @param {string} kind
 * @param {object} eff the effective settings ({ values })
 * @returns {{ id: string, title: string }[]}
 */
export function railCardsFor(kind, eff) {
  return RAIL_CARDS.map((c, i) => ({ c, i }))
    .filter(({ c }) => c.kinds.includes(kind) && shownFor(c.profiles, eff))
    .sort((a, b) => rankFor(a.c.id, null) - rankFor(b.c.id, null) || a.i - b.i)
    .map(({ c }) => c);
}

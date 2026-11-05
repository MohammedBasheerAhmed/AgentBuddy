// What All tools (the command palette, grown into the place where everything beyond the five lives: docs/focus-layout.md) offers right
// now. Pure: the panel passes in what it knows (settings, the screens this person has, the screen on show, the record on screen) and
// gets a flat list back. Every command is in one group; All tools draws the groups under their headings in this order:
//
//   'ticket-insights'  More for this ticket: Insights    the record's Insights cards that are not among the five
//   'ticket-assist'    More for this ticket: AI Assist   "Ask about this ticket", then the AI actions that are not among the five
//   'go'               Go to                             the screens
//   'panel'            Panel                             Insights / AI Assist, Settings, the colours, the language
//
// The first two only on the Ticket screen with a record on it (src/features/focus.js sorts the five from the rest; which cards and
// actions the record has at all is decided where it always was). Their ids are also the places a screen can open All tools at
// (useAllTools('ticket-insights'), allToolsContext.js).
//
// Each command carries a plain description of what it does (`action`), which the panel carries out with the same code paths its
// buttons use, so a command can never do something a button could not:
//
//   { type: 'screen', id }               show a screen
//   { type: 'half', screen, half }       show Insights or AI Assist on a screen
//   { type: 'run', featureId }           a launch for the record on screen, the same the keyboard shortcuts and the bar on the ServiceNow
//                                        page send (src/lib/launch.js): an AI action ('reply-draft': permission, masking, preview and
//                                        policy as for a click on it), an Insights card alone ('show:knownErrors') or AI Assist with
//                                        "Ask about this ticket" open ('ask:ticket')
//   { type: 'settings' }                 open the settings page
//   { type: 'theme', value }             'system' | 'light' | 'dark'
//   { type: 'language', value }          'auto' | 'en' | 'ar'
//
// Nothing here reads a ticket or sends anything: choosing an AI action opens the same preview a click on its button opens.
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import { focusActions, focusCards } from '../../features/focus.js';
import { aiOffByPolicy, profilesOfFeature, shownFor } from '../../profiles/profiles.js';
import { offeredFeatures, recordBlock } from '../ticket/assist/actions/plan.js';
import { cardsFor } from '../ticket/TicketInsights.jsx';
import { INSIGHT_CARDS } from '../ticket/cards/index.js';
import { cardIcon, featureIcon } from '../ui/featureIcons.js';
import { t } from '../../i18n/index.js';

const SCREEN_ICONS = { ticket: 'ticket', mywork: 'inbox', team: 'users', write: 'pen', knowledge: 'book' };
const WITH_ASSIST = ['ticket', 'team', 'write', 'knowledge']; // the screens that have an AI Assist half (My work has one half)

/** The groups of All tools, in the order they are drawn. */
export const GROUPS = Object.freeze(['ticket-insights', 'ticket-assist', 'go', 'panel']);

/** The heading of a group of commands. */
export function groupLabel(id) {
  return {
    'ticket-insights': t('More for this ticket: Insights'),
    'ticket-assist': t('More for this ticket: AI Assist'),
    go: t('Go to'),
    panel: t('Panel'),
  }[id] || '';
}

// What each Insights card that is not among the five shows, in a few words: the line under its name in All tools. Only these cards
// are ever listed there (the others are the five rows on the Ticket screen); tests/palette.test.js checks that each one has its line.
const CARD_HINTS = {
  missing: () => t('Facts the ticket still lacks, and why they matter.'),
  routing: () => t('Which groups solved tickets like this one.'),
  related: () => t('Solved look-alikes and open tickets on the same item.'),
  changes: () => t('Changes on the same item or service, recent and coming.'),
  knownErrors: () => t('A fix or workaround that may already exist.'),
  risk: () => t('Signs the ticket may escalate, each with why.'),
  outage: () => t('Other open tickets on the same item right now.'),
};

/** The line under an Insights card's name in All tools ('' for a card that has none). */
export const cardHint = (id) => (Object.prototype.hasOwnProperty.call(CARD_HINTS, id) ? CARD_HINTS[id]() : '');

// 'knownErrors' -> 'known errors': a card's id as words, so typing them finds it in English whatever the language of its name.
const idWords = (id) => String(id).replace(/([A-Z])/g, ' $1').replace(/-/g, ' ').toLowerCase();

/**
 * "Ask about this ticket" when it can run on this record, else null: the rule the question box itself follows (AskBox.jsx), so
 * 'ask:ticket' never opens a box that is not there.
 */
function askFeature(record, eff) {
  const ask = featureById('ask-ticket');
  if (!ask || !isFeatureAvailable(ask, eff?.policy || {}) || !shownFor(profilesOfFeature(ask), eff) || recordBlock({ record, eff })) return null;
  return ask;
}

/** "More for this ticket": the record's cards and AI actions beyond the five, as commands. */
function ticketCommands(record, eff, aiOn, header = null, offered = null) {
  const out = [];
  for (const card of focusCards(cardsFor(INSIGHT_CARDS, record, header, eff)).rest) {
    out.push({
      id: `run:show:${card.id}`,
      group: 'ticket-insights',
      label: card.title,
      hint: cardHint(card.id),
      keywords: `${idWords(card.id)} insights card`,
      icon: cardIcon(card.id),
      action: { type: 'run', featureId: `show:${card.id}` },
    });
  }
  if (!aiOn) return out;
  const ask = askFeature(record, eff);
  if (ask) {
    out.push({ id: 'run:ask:ticket', group: 'ticket-assist', label: ask.title, hint: ask.description, keywords: 'ask question', icon: 'message', ai: true, action: { type: 'run', featureId: 'ask:ticket' } });
  }
  // The actions the Ticket screen offers when it has said (it knows what needs a read first, such as the checklist from the
  // instructions); else what the record's kind, the policy, the profiles and the `when` rules allow.
  const features = offeredFeatures({ record, header, eff }).filter((f) => !Array.isArray(offered) || offered.includes(f.id));
  const { rest } = focusActions(features.map((feature) => ({ feature })));
  for (const { feature: f } of rest) {
    out.push({
      id: `run:${f.id}`,
      group: 'ticket-assist',
      label: f.title,
      hint: f.description,
      keywords: idWords(f.id),
      icon: featureIcon(f.id),
      ai: true,
      action: { type: 'run', featureId: f.id },
    });
  }
  return out;
}

/**
 * @param {{ eff: object, screens: { id: string, label: string }[], active: string, recordPage: object|null }} input
 *   active: the id of the screen on show; recordPage: the page of the record the Ticket screen shows (null when there is none, or
 *   when the Ticket screen cannot show it)
 */
export function buildCommands({ eff, screens = [], active = 'ticket', recordPage = null, header = null, offered = null }) {
  const out = [];
  const aiOn = !aiOffByPolicy(eff);

  // "More for this ticket" belongs to the Ticket screen: on another screen All tools is about that screen and the panel.
  if (active === 'ticket' && recordPage?.record) out.push(...ticketCommands(recordPage.record, eff, aiOn, header, offered));

  for (const s of screens) {
    out.push({
      id: `go:${s.id}`,
      group: 'go',
      label: t('Go to {screen}', { screen: s.label }),
      keywords: `${s.id} open show screen`,
      icon: SCREEN_ICONS[s.id] || 'search',
      action: { type: 'screen', id: s.id },
    });
  }

  if (aiOn && WITH_ASSIST.includes(active)) {
    out.push({ id: 'half:insights', group: 'panel', label: t('Show Insights'), keywords: 'insights numbers facts', icon: 'shield', action: { type: 'half', screen: active, half: 'insights' } });
    out.push({ id: 'half:assist', group: 'panel', label: t('Show AI Assist'), keywords: 'ai assist assistant', icon: 'spark', action: { type: 'half', screen: active, half: 'assist' } });
  }
  out.push({ id: 'settings', group: 'panel', label: t('Open Settings'), keywords: 'settings preferences options key', icon: 'gear', action: { type: 'settings' } });

  const theme = eff?.values?.theme || 'system';
  const colours = [
    ['light', t('Use light colours'), 'sun'],
    ['dark', t('Use dark colours'), 'moon'],
    ['system', t("Use the computer's colours"), 'monitor'],
  ];
  for (const [value, label, icon] of colours) {
    if (value !== theme) out.push({ id: `theme:${value}`, group: 'panel', label, keywords: 'theme colours mode appearance light dark', icon, action: { type: 'theme', value } });
  }

  const language = eff?.values?.language || 'auto';
  const languages = [
    ['en', t('Language: {name}', { name: 'English' })],
    ['ar', t('Language: {name}', { name: 'العربية' })],
    ['auto', t('Language: same as the browser')],
  ];
  for (const [value, label] of languages) {
    if (value !== language) out.push({ id: `language:${value}`, group: 'panel', label, keywords: 'language arabic english عربي', icon: 'globe', action: { type: 'language', value } });
  }
  return out;
}

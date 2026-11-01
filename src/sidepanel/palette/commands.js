// What the command palette offers right now. Pure: the panel passes in what it knows (settings, the screens this person has, the screen
// on show, the record on screen) and gets a flat list back. Each command carries a plain description of what it does (`action`), which
// the panel carries out with the same code paths its buttons use, so a command can never do something a button could not:
//
//   { type: 'screen', id }               show a screen
//   { type: 'half', screen, half }       show Insights or AI Assist on a screen
//   { type: 'run', featureId }           an AI action or an Insights card of the record on screen (the same "launch" the keyboard
//                                        shortcuts and the bar on the ServiceNow page use: permission, masking, preview, policy)
//   { type: 'settings' }                 open the settings page
//   { type: 'theme', value }             'system' | 'light' | 'dark'
//   { type: 'language', value }          'auto' | 'en' | 'ar'
//
// Nothing here reads a ticket or sends anything: choosing an AI action opens the same preview a click on its button opens.
import { QUICK_CARDS } from '../../features/quick.js';
import { aiOffByPolicy } from '../../profiles/profiles.js';
import { offeredFeatures } from '../ticket/assist/actions/plan.js';
import { featureIcon } from '../ui/featureIcons.js';
import { t } from '../../i18n/index.js';

const SCREEN_ICONS = { ticket: 'ticket', mywork: 'inbox', team: 'users', write: 'pen', knowledge: 'book' };
const WITH_ASSIST = ['ticket', 'team', 'write', 'knowledge']; // the screens that have an AI Assist half (My work has one half)

/** The heading of a group of commands. */
export function groupLabel(id) {
  return { go: t('Go to'), ticket: t('This ticket'), panel: t('Panel') }[id] || '';
}

/**
 * @param {{ eff: object, screens: { id: string, label: string }[], active: string, recordPage: object|null }} input
 *   active: the id of the screen on show; recordPage: the page of the record the Ticket screen shows (null when there is none)
 */
export function buildCommands({ eff, screens = [], active = 'ticket', recordPage = null }) {
  const out = [];
  const aiOn = !aiOffByPolicy(eff);

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

  if (recordPage?.record) {
    if (aiOn) {
      for (const f of offeredFeatures({ record: recordPage.record, header: null, eff })) {
        out.push({
          id: `run:${f.id}`,
          group: 'ticket',
          label: f.title,
          hint: f.description,
          keywords: f.id.replace(/-/g, ' '),
          icon: featureIcon(f.id),
          ai: true,
          action: { type: 'run', featureId: f.id },
        });
      }
    }
    for (const [id, card] of Object.entries(QUICK_CARDS)) {
      out.push({
        id: `run:${id}`,
        group: 'ticket',
        label: card.label,
        hint: t('Opens the card in Insights. Stays in ServiceNow.'),
        keywords: `${card.card} insights card`,
        icon: featureIcon(id),
        action: { type: 'run', featureId: id },
      });
    }
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

// AI features of "My week" and the weekly report (round 5, docs/round5.md): "The week in short" (Team > Weekly report) and "One thing to
// try" (My work > My week). Both have `kinds: []`: neither is on a record's Actions list, the two views run them through useRun() with a pack
// they build from the weekly numbers (src/reports/weekly/ai.js). They are written from COUNTS and TICKET NUMBERS only: no name of a person,
// no ticket text, no short description. The prompts are fixed text with no data in them; the figures arrive only as parts, which the
// firewall masks and wraps as untrusted. Policy applies as everywhere: `disabledFeatures` can name each id.
import { buildWeeklyPack, buildMyWeekPack, weeklyParts, myWeekParts, WEEKLY_MAX_WORDS, TIP_MAX_WORDS } from '../../reports/weekly/ai.js';
import { LANGUAGE_AGENT } from '../../prompts/rules.js';
import { t } from '../../i18n/index.js';

// Said in both prompts: only facts in the data, gaps are named.
const DATA_RULES =
  'Use only facts in the data and never invent a ticket, a number, a name, a cause or a time. Write "Not stated" when the data does not say. ' +
  'Keep any bracketed placeholder exactly as written. ';

export { buildWeeklyPack, buildMyWeekPack };

export default [
  {
    id: 'weekly-summary',
    get title() {
      return t('Write the week in short');
    },
    get description() {
      return t('One short paragraph for the top of the weekly report, from the week\'s counts and ticket numbers only.');
    },
    wave: 3,
    kinds: [],
    // No Insert: this is a team report, not a ticket field. The view shows the paragraph, and the PDF and the copied text carry it.
    parts: weeklyParts,
    system:
      'You help a service desk team lead write the short paragraph at the top of the weekly report.\n' +
      'The data holds counts for one week and the week it is compared with: tickets that came in and were closed, the change in the backlog, the share of SLAs kept, closed tickets that were reopened, the closed tickets by area, and up to three findings from fixed rules. ' +
      'It holds no names and no ticket text.\n' +
      `Write one paragraph of plain sentences, at most ${WEEKLY_MAX_WORDS} words, in this order: what came in against what was closed and what that did to the backlog; how the SLAs went; the one thing most worth the lead's attention, from the findings if there are any. ` +
      'Compare with the week before only where the data gives it. Mention a ticket number only when a finding gives it, exactly as written. Do not blame or rank anyone. ' +
      DATA_RULES +
      LANGUAGE_AGENT,
    instruction: 'Write the week in short.',
  },
  {
    id: 'my-week-tip',
    get title() {
      return t('One thing to try');
    },
    get description() {
      return t('One suggestion for next week, from your own week\'s counts and ticket numbers only.');
    },
    wave: 3,
    kinds: [],
    parts: myWeekParts,
    system:
      'You help a service desk agent look back on their own week.\n' +
      'The data holds counts of the tickets the agent closed in one week and the week before: how many, the typical time to resolve, the average first reply, how many came back, how many were answered inside the SLA, the closed tickets by area, and how many closed tickets carried no fix note. ' +
      'It holds no names and no ticket text.\n' +
      `Write one suggestion for next week of at most ${TIP_MAX_WORDS} words, in plain, kind, practical language, from the one figure in the data that most deserves it. If every figure is steady or better, say what went well instead. ` +
      'Agent Buddy has an action called "Prepare to close" that asks for a fix note before a ticket is closed: you may suggest it only when the data shows closed tickets with no fix note, or reopened tickets. ' +
      'Mention a ticket number only when the data gives it, exactly as written. Do not compare the agent with other people. ' +
      DATA_RULES +
      LANGUAGE_AGENT,
    instruction: 'Write one thing to try next week.',
  },
];

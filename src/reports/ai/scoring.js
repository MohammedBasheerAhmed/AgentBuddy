// F6, the output check: does a coaching answer rate, rank or name individual people? Pure, local, run on the answer after the names are
// back in. It lives apart from src/reports/ai/coaching.js because only the panel needs it (the content script, which reads the
// sample, imports coaching.js and must not carry the word list from the PII module).
import { COMMON_WORDS } from '../../pii/dictionary.js';
import { oneLine } from '../../context/util.js';
import { line } from './common.js';

export const PER_PERSON_NOTE =
  'The AI\'s answer may rank, score or name individual people. This tool is for patterns in the work of a group, not for judging people, so it is held back. Use the group themes only, and do not share lines about individuals.';

// Words that rate or rank. Used with a person's name, a label such as "Agent A", or a placeholder in the same sentence.
const RATING = new RegExp(
  '\\b(?:\\d+(?:\\.\\d+)?\\s*(?:/|out of)\\s*\\d+|scor(?:e|es|ed|ing)|rating|rated|grad(?:e|es|ed|ing)|rank(?:s|ed|ing)?|best|worst|weakest|strongest|top|bottom|under-?perform\\w*|out-?perform\\w*|needs work|poor|poorly|excellent|exceptional|outstanding|better|worse|strong|weak|adequate)\\b',
  'i'
);

// Ranking and rating language that needs no name: it is about people by its nature.
const RANKING = [
  /\bleague table\b/i,
  /\branking\b/i,
  /\b(?:top|best|worst|bottom|weakest|strongest|lowest|highest)[- ](?:performing |scoring |rated |ranked )?(?:agents?|performers?|analysts?|engineers?|technicians?|members?|people|persons?|individuals?|resolvers?|employees?)\b/i,
  /\brank(?:s|ed)?\b[^.\n]{0,40}\b(?:agents?|people|individuals?|members?|analysts?|engineers?|employees?|from best|from worst|highest|lowest)\b/i,
  /\b(?:out|under)-?perform\w*/i,
  /\b(?:better|worse) than (?:the )?(?:other|others|rest|colleagues|peers|average|her|him|them)\b/i,
  /\b(?:performance|overall)\s+(?:rating|score|grade|ranking)\b/i,
  /\b(?:agent|analyst|engineer|person|employee)'?s? (?:overall )?(?:score|grade|rating)\b/i,
];

// "Agent A", "Analyst 2", "Person #3": a label that stands for one person.
// The word may be in any case ("Agent A", "agent A"); the letter that follows must be a capital, so "Agent notes" is not a label.
const LABEL_WORDS = ['agent', 'analyst', 'engineer', 'technician', 'resolver', 'member', 'person', 'colleague', 'employee', 'rep', 'representative'];
const PERSON_LABEL = new RegExp(`\\b(?:${LABEL_WORDS.map((w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`).join('|')})\\s+(?:[A-Z]|\\d{1,3}|#\\d{1,3})\\b`);
const PLACEHOLDER = /\[PERSON_\d+\]/;
// People who are not on the team: a customer named in a quote is not a judgement of anyone.
const NOT_TEAM = new Set(['requester', 'caller', 'customer', 'contact', 'named']);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (word) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(word)}(?![\\p{L}\\p{N}])`, 'iu');

function teamMatchers(people) {
  const out = [];
  for (const p of Array.isArray(people) ? people : []) {
    const name = oneLine(p?.name || '', 80);
    if (name.length < 2 || NOT_TEAM.has(String(p?.role || '').toLowerCase())) continue;
    const tokens = name.split(/[\s,.\-]+/).filter((t) => t.length >= 3 && !COMMON_WORDS.has(t.toLowerCase()));
    out.push([wholeWord(name), ...tokens.map(wholeWord)]);
  }
  return out;
}

/**
 * Does the answer rate, rank or name individual people? Looks for ranking language, labels such as "Agent A", leftover
 * [PERSON_n] placeholders and the names of the group's own people (the pack's `people` that are not requesters), each next to
 * a rating word in the same sentence. A customer's name inside a quote is not flagged. Heuristic and local: it can miss, and it
 * can flag a harmless sentence; the view holds the text back and lets the lead choose.
 * @param {string} text the answer as the lead would read it (real names back in)
 * @param {{ people?: { name?: string, role?: string }[] }} [options]
 * @returns {{ tripped: boolean, findings: { kind: 'ranking'|'person-rating'|'agent-label', excerpt: string }[] }}
 */
export function flagPerPersonScoring(text, { people = [] } = {}) {
  const body = String(text ?? '');
  const findings = [];
  const add = (kind, segment) => {
    const excerpt = line(segment, 140);
    if (!findings.some((f) => f.kind === kind && f.excerpt === excerpt)) findings.push({ kind, excerpt });
  };
  const team = teamMatchers(people);
  for (const segment of body.split(/\r?\n|(?<=[.!?])\s+/)) {
    if (!segment.trim()) continue;
    if (RANKING.some((re) => re.test(segment))) add('ranking', segment);
    const rates = RATING.test(segment);
    if (rates && PERSON_LABEL.test(segment)) add('agent-label', segment);
    if (rates && PLACEHOLDER.test(segment)) add('person-rating', segment);
    if (rates && team.some((matchers) => matchers.some((re) => re.test(segment)))) add('person-rating', segment);
  }
  return { tripped: findings.length > 0, findings };
}

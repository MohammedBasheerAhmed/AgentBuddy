// Translate the caller's message (round 4, docs/round4.md; the "Understand the ticket" pain point). The caller wrote in another
// language than the agent reads: the newest of their customer-visible comments and the short description, translated faithfully
// into the language of the agent's panel. Insights offers it as "Translate" next to the caller's message when that message is in
// another script than the panel's language (src/insights/sinceLooked.js needsTranslation); the button starts this action in AI Assist
// (src/sidepanel/ticket/TicketInsights.jsx launchFromInsights), where the check before sending comes first, as for every action. It
// is not one of the five AI slots (src/features/focus.js): AI Assist and All tools list it with the rest.
//
// Same engine as every feature (docs/contracts.md, "Feature definition"): the prompt is fixed text, the ticket's words arrive as parts,
// and everything goes through prepareRun and the PII firewall. The columns it reads are in src/context/specs/understand.js.
//
// WHAT THIS SENDS: the short description, and the caller's newest customer-visible comments (1 to 3, oldest first; without the quoted
// mail thread and signature), each as written. No work note, no other comment, no author, no time, no other field. Names and emails
// of everyone on the ticket are masked wherever the words mention them. When the record names no customer (so no author can be told
// to be the caller), the newest customer-visible comments are sent instead, under the plain label "Customer-visible comment".

import { columnText, noteText } from '../parts.js';
import { WORKABLE } from './kinds.js';
import { hasCustomer } from '../stages.js';
import { authorRole, identities } from '../../context/identity.js';
import { ONLY_OUTPUT, rulesFor } from '../../prompts/rules.js';
import { getLanguage, t } from '../../i18n/index.js';

export const TRANSLATE_ID = 'translate-message';

/** How many of the caller's newest messages are sent (the newest first to stay when a request is cut to fit the model). */
export const MAX_MESSAGES = 3;

/**
 * The comments to translate: the caller's newest customer-visible comments (at most MAX_MESSAGES, oldest first), as { entry, label }.
 * When the record names no customer, the newest customer-visible comments. Pure.
 */
export function callerMessages(pack, max = MAX_MESSAGES) {
  const comments = (Array.isArray(pack?.journal) ? pack.journal : []).filter((e) => e && e.type === 'comment' && noteText(e));
  const ids = identities(pack || {});
  const pick = ids.known ? comments.filter((e) => authorRole(e.by, ids) === 'customer') : comments;
  const label = ids.known ? "Caller's message" : 'Customer-visible comment';
  return pick.slice(-Math.max(1, max)).map((entry) => ({ entry, label }));
}

/** The parts: the short description, then the caller's newest messages. Nothing else of the pack. Pure. */
export function translateParts(pack) {
  const parts = [];
  const title = columnText('short_description', pack?.fields?.short_description);
  if (title) parts.push({ label: 'Short description', field: 'short_description', text: title, inline: true });
  // (field 'comments': a journal part, so the oldest goes first when the request must be cut to fit the model)
  for (const { entry, label } of callerMessages(pack)) parts.push({ label, field: 'comments', text: noteText(entry) });
  return parts;
}

// The language each panel language is named by in the prompt: fixed words from this list, never ticket data.
const TARGET_NAMES = Object.freeze({ en: 'English', ar: 'Arabic' });

/** The target-language rule: the PANEL's language (not the ticket's, and not "Language of AI answers"), said last. */
export function targetRule(language = getLanguage()) {
  const name = TARGET_NAMES[language] || TARGET_NAMES.en;
  return (
    `Translate into ${name}, the language of the agent's panel, whatever language the data is written in; this replaces any earlier instruction about the language. ` +
    'Keep the labels "Short description:" and "Message:" exactly as written, in English.'
  );
}

const TASK =
  "You help a service desk agent read what the caller of a ticket wrote, in the agent's own language.\n" +
  "Translate the data faithfully: the short description first, then each of the caller's messages in the order given (oldest first).\n" +
  'Write exactly these labels, each at the start of its own line and followed by a colon: "Short description:" before the translation of the short description, then "Message:" before the translation of each message. ' +
  'When the data has no message, end with the line "Message: none in the data".\n' +
  'Rules: translate only. Add nothing and leave nothing out; do not answer, summarise, explain, correct or judge the text, and keep its tone, its line breaks and its lists. ' +
  'Keep every redaction token (a word in capital letters and a number inside square brackets), record number, error code, address, product name and technical term exactly as written. ' +
  'A part already written in the target language is repeated unchanged. A part of the data that says what could not be read is not translated. At most 900 words. ';

const translateMessage = {
  id: TRANSLATE_ID,
  get title() {
    return t("Translate the caller's message");
  },
  get description() {
    return t('In your language, after the check before sending');
  },
  wave: 3,
  // Every kind a reply can go to (as reply-draft): a record with a customer. Not a task of a problem or a change (nobody outside
  // wrote on it), not a change, an article or "other". A closed ticket too: the caller may write after it was closed.
  kinds: WORKABLE,
  when: (record) => hasCustomer(record),
  group: 'understand',
  primary: 'copy',
  journal: MAX_MESSAGES,
  parts: translateParts,
  // The prompt is fixed text; only the panel's language (a word from TARGET_NAMES) changes with it, read when the request is built.
  get system() {
    return `${TASK}${rulesFor('agent')} ${ONLY_OUTPUT} ${targetRule()}`;
  },
  instruction: "Translate the caller's message for the agent.",
};

export default [translateMessage];

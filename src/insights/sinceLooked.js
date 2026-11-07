// "Understand the ticket", round 4 (docs/round4.md): what changed since the agent last opened this ticket in the panel, and what the
// caller wrote last. The first facts inside the row; the change is also the row's one line ("Since you looked: the caller wrote twice").
// Pure: no read of its own, no AI. It works from what the panel reads anyway: the `glance` read's pack (notes and comments with their
// times and authors, the record's stored update time), the journey's field history (`journey` read: state, group and priority
// changes, when the agent's user may read sys_audit) and the SLA rows; and the time the panel last showed the ticket
// (src/lib/lastViewed.js).
//
// It says only what it can stand behind (as the Glance and the journey do): without the field history it never claims "not
// reassigned" or a state change; a customer it cannot tell apart from the agents is never "the caller"; "Nothing new" only when the
// record's own update time (or the field history and the notes together) show it.
//
//   sinceLooked({ previous, pack, audit, slas, now })   null (first visit, nothing to compare with) or { text, sub, line, changed, ... }
//   latestCallerMessage(pack, now)                      the caller's newest customer-visible comment, as read, or null
//   needsTranslation(text, language)                    the message is written in another script than the panel's language
//   clockText(ms, now)                                  "today 09:14", "yesterday 17:05", "3 Nov 17:05" in the agent's own time zone

import { authorRole, identities } from '../context/identity.js';
import { cleanEmailText } from '../context/journal.js';
import { parseSnTime } from '../context/util.js';
import { scriptOf } from '../lib/scriptDetect.js';
import { agoText, noteInstant, storedTime } from './time.js';
import { personWords } from './personWords.js';
import { getLanguage, isRtl, isolate, t, tn } from '../i18n/index.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const pad = (n) => String(n).padStart(2, '0');
// The line cleanEmailText (src/context/journal.js) puts where it cut a quoted mail thread.
const QUOTE_CUT = /\n?\(earlier quoted email left out\)\s*$/;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * When something happened, in the agent's own time zone (the panel's clock): "today 09:14", "yesterday 17:05", "3 Nov 17:05" (with
 * the year when it is not this year). A time ahead of `now` is "today". '' when either is not a time.
 */
export function clockText(ms, now) {
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return '';
  const d = new Date(Math.min(ms, now));
  const today = new Date(now);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay(d, today)) return t('today {time}', { time });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(d, yesterday)) return t('yesterday {time}', { time });
  const options = d.getFullYear() === today.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  // (the digits stay 0-9 in Arabic, as in ServiceNow itself)
  return `${d.toLocaleDateString(isRtl() ? 'ar-u-nu-latn' : 'en-GB', options)} ${time}`;
}

// Did the panel's read see the notes and comments (whether or not there are any)? Not when the customer's comments, or the work notes,
// may be hidden from this user (their column did not come back: R-18, R-19): "nothing new" is not said of what could not be seen.
const journalRead = (pack) =>
  (Array.isArray(pack?.access) ? pack.access : []).some((a) => a?.source === 'journal' && (a.status === 'ok' || a.status === 'empty') && a.commentsHidden !== true && a.workNotesHidden !== true);

/**
 * What changed on the ticket since the agent last opened it in the panel.
 * @param {{
 *   previous: number|null,   when the panel last showed this ticket (ms), null the first time
 *   pack: object|null,       the `glance` read's pack
 *   audit?: { available: boolean, changes?: { field, from, to, atUtc }[] }|null,   the `journey` read; null while it is not there
 *   slas?: object[]|null,    the SLA rows (readSlaTimes items), null when they could not be read
 *   now: number,
 * }} input
 * @returns {null | {
 *   at: number, when: string,            the previous time, and as it is said ("yesterday 17:05")
 *   changed: boolean,                    something new was found
 *   text: string,                        "Since you last looked (yesterday 17:05)" or "Nothing new since you looked (yesterday 17:05)"
 *   sub: string,                         "2 messages from the caller · moved to In Progress · not reassigned" ('' when nothing changed)
 *   line: string,                        the row's line: "Since you looked: the caller wrote twice" ('' when nothing changed)
 *   bits: { id: string, text: string, line: string, quiet?: boolean }[],
 *   history: 'read' | 'unreadable' | 'unknown',
 * }}
 *   null: the first visit, no pack yet, or nothing can honestly be said (neither the notes nor the update time could be read).
 */
export function sinceLooked({ previous, pack, audit = null, slas = null, now }) {
  if (!Number.isFinite(previous) || !pack || typeof pack !== 'object') return null;
  const when = clockText(previous, now);
  const after = (ms) => Number.isFinite(ms) && ms > previous;
  const ids = identities(pack);
  const entries = (Array.isArray(pack.journal) ? pack.journal : [])
    .filter((e) => e && typeof e === 'object' && text(e.text))
    .filter((e) => after(noteInstant(e, pack).ms));
  const comments = entries.filter((e) => e.type === 'comment');
  const roles = comments.map((e) => (ids.known ? authorRole(e.by, ids) : 'unknown'));
  const fromCaller = roles.filter((r) => r === 'customer').length;
  const replies = roles.filter((r) => r === 'support').length;
  const unknown = roles.filter((r) => r === 'unknown').length;
  const workNotes = entries.filter((e) => e.type === 'work_note').length;

  const bits = [];
  const add = (id, said, line = said, quiet = false) => bits.push(quiet ? { id, text: said, line: '', quiet: true } : { id, text: said, line });
  // (the person is named as the kind names them: the requester of a requested item, the employee of an HR case, F11)
  const words = personWords(pack);
  if (fromCaller) add('caller', words.messagesFrom(fromCaller), words.wrote(fromCaller));
  if (replies) add('replies', words.repliesTo(replies));
  if (unknown) add('comments', tn(unknown, '{n} new comment', '{n} new comments'));
  if (workNotes) add('notes', tn(workNotes, '{n} new work note', '{n} new work notes'));

  // The field history: only when the `journey` read could see it. Without it nothing is said about the state or the group.
  const history = !audit || typeof audit !== 'object' ? 'unknown' : audit.available === true ? 'read' : 'unreadable';
  let groups = [];
  if (history === 'read') {
    const changes = (Array.isArray(audit.changes) ? audit.changes : []).filter((c) => c && after(parseSnTime(c.atUtc)));
    // (a change to a value no choice names is a change all the same: it is said without the value, never as "State 10")
    const lastOf = (field) => changes.filter((c) => c.field === field && (text(c.to) || c.toUnlabelled)).pop();
    groups = changes.filter((c) => c.field === 'assignment_group');
    const state = lastOf('state');
    if (state) add('state', t('moved to {state}', { state: state.toUnlabelled ? t('a state') : isolate(text(state.to)) }));
    const priority = lastOf('priority');
    if (priority) add('priority', priority.toUnlabelled ? t('priority changed') : t('priority now {priority}', { priority: isolate(text(priority.to)) }));
    const group = lastOf('assignment_group');
    if (group) add('reassigned', t('reassigned to {group}', { group: group.toUnlabelled ? t('a group you cannot see') : isolate(text(group.to)) }));
    else if (groups.length) add('reassigned', t('reassigned'));
  }
  // An SLA that breached since.
  const breached = (Array.isArray(slas) ? slas : []).some((s) => s && s.breached === true && !/cancel/i.test(`${s.stage} ${s.stageValue}`) && after(parseSnTime(s.plannedEndUtc)));
  if (breached) add('sla', t('SLA breached'));
  // The record changed in a way none of the above explains (a field the history does not follow, or no history to read).
  const updated = storedTime(pack, 'sys_updated_on');
  if (!bits.length && after(updated)) add('updated', t('updated {when}', { when: clockText(updated, now) }), t('the ticket was updated'));

  if (bits.length) {
    // Said only next to a change, and only when the history was read: "not reassigned" is a fact then, a guess otherwise.
    if (history === 'read' && !groups.length) add('notReassigned', t('not reassigned'), '', true);
    if (history === 'unreadable') add('noHistory', t('state and group changes not readable'), '', true);
    const first = bits.find((b) => !b.quiet);
    return {
      at: previous,
      when,
      changed: true,
      text: t('Since you last looked ({when})', { when }),
      sub: bits.map((b) => b.text).join(' · '),
      line: t('Since you looked: {what}', { what: first.line }),
      bits,
      history,
    };
  }
  // Nothing found. "Nothing new" when the record's own update time says so (it moves with every change, a note included), or when
  // the field history and the notes were both read; "No new messages" when only the notes were; otherwise nothing is said.
  const quiet = (said) => ({ at: previous, when, changed: false, text: said, sub: '', line: '', bits: [], history });
  if ((Number.isFinite(updated) && !after(updated)) || (history === 'read' && journalRead(pack))) return quiet(t('Nothing new since you looked ({when})', { when }));
  if (journalRead(pack)) return quiet(t('No new messages since you looked ({when})', { when }));
  return null;
}

/**
 * The caller's newest customer-visible comment, as the panel read it (in memory only): { text, heading, at, approx, script }, or
 * null when there is none or the caller cannot be told apart from the agents (src/context/identity.js). `text` is the message without
 * the quoted mail thread and signature (cleanEmailText; the pack keeps the whole text). `heading`: "The caller wrote, today 09:14";
 * "about 3 h ago" when the note's time may be off by the reader's time zone.
 */
export function latestCallerMessage(pack, now) {
  if (!pack || typeof pack !== 'object') return null;
  const ids = identities(pack);
  if (!ids.known) return null;
  const comments = (Array.isArray(pack.journal) ? pack.journal : []).filter((e) => e && e.type === 'comment' && text(e.text));
  const entry = [...comments].reverse().find((e) => authorRole(e.by, ids) === 'customer');
  if (!entry) return null;
  // (cleanEmailText marks a cut thread with a line of its own in English: not the caller's words, and not their script either)
  const message = cleanEmailText(text(entry.text)).replace(QUOTE_CUT, '').trim() || text(entry.text);
  const at = noteInstant(entry, pack);
  const words = personWords(pack);
  let heading = words.heading();
  if (Number.isFinite(at.ms) && at.approx) heading = words.heading(t('about {when}', { when: agoText(Math.max(0, now - at.ms)) }));
  else if (Number.isFinite(at.ms)) heading = words.heading(clockText(at.ms, now));
  return { text: message, heading, at: at.ms, approx: at.approx, script: scriptOf(message) };
}

// The script each language of the panel is written in.
const PANEL_SCRIPT = Object.freeze({ en: 'latin', ar: 'arabic' });

/**
 * Is the message written in another script than the panel's language (an Arabic message with an English panel, a Latin one with an
 * Arabic panel, or any other script)? A message too short to tell, or in both scripts, is not.
 * @param {string} message  @param {string} [language] the panel's language ('en' | 'ar'), the current one by default
 */
export function needsTranslation(message, language = getLanguage()) {
  const script = scriptOf(message);
  if (!script || script === 'mixed') return false;
  return script !== (PANEL_SCRIPT[language] || 'latin');
}

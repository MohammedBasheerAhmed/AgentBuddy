// Which email fits this ticket right now? Pure and deterministic: no AI, no clock unless the caller passes `now`.
//
// Input is the context pack read with the 'email-compose' spec (record fields, notes and comments, SLAs, approvals). The
// output is up to three suggested kinds of email, each with a one-line reason the agent can read, plus a few plain "facts"
// that show what the suggestion is based on. The AI only comes in afterwards, to write the draft the agent picks.
//
// Everything here reads the pack defensively: a column that is not on the pack (the spec is intersected with what the
// kind allows) just means that signal is not available, never an error.

import { parseSnTime } from '../context/util.js';
import { emailFormLink } from '../lib/snLinks.js';
import { authorRole, identities } from '../context/identity.js';
import { isLocalTime } from '../context/journal.js';
import { isolate, t, tm, tn } from '../i18n/index.js';
import { scriptOf } from '../lib/scriptDetect.js';
import { looksEnglish } from '../safeSend/replyChecks.js';
import { classifyState, waitsOn } from '../domain/states.js';

// label and blurb are shown to the person: marked with tm() here, shown with t() on the property.
export const EMAIL_TYPES = Object.freeze([
  Object.freeze({ id: 'ask-info', featureId: 'email-ask-info', label: tm('Ask for information'), blurb: tm('Ask the person for what is still needed, or remind them.') }),
  Object.freeze({ id: 'status-update', featureId: 'email-status-update', label: tm('Status update'), blurb: tm('Tell the person where things stand and what happens next.') }),
  Object.freeze({ id: 'resolution', featureId: 'email-resolution', label: tm('Resolution'), blurb: tm('Tell the person it is resolved and ask them to confirm.') }),
  Object.freeze({ id: 'approval-nudge', featureId: 'email-approval-nudge', label: tm('Approval reminder'), blurb: tm('Remind someone that an approval is still waiting.') }),
  Object.freeze({ id: 'apology', featureId: 'email-apology', label: tm('Apology for the wait'), blurb: tm('Say sorry for the delay and what is being done.') }),
  Object.freeze({ id: 'closure', featureId: 'email-closure', label: tm('Closure'), blurb: tm('Let the person know the ticket is closed.') }),
]);

export const emailTypeById = (id) => EMAIL_TYPES.find((type) => type.id === id) || null;

const HOUR = 3600000;
const DAY = 24 * HOUR;
const MIN_SCORE = 30; // below this a suggestion is noise
const MAX_PICKS = 3;

const text = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

function ms(when) {
  const at = parseSnTime(text(when));
  return Number.isFinite(at) ? at : null;
}

// Which clock the customer-visible comments' times are on (only comments are compared with the record's dates). Read from
// sys_journal_field they are stored UTC; read from the record's own comments column (the fallback, src/context/journal.js) they are
// in the reader's time zone, like every field value. When the comments and the work notes came from different places, the
// journal's access entry says which (isLocalTime).
const commentsAreLocal = (pack) => isLocalTime({ type: 'comment' }, pack.access);

/**
 * A date of the record on the same clock as the comments and the clock of this computer: the stored UTC value the pack carries
 * (related.times, the 'email-compose' spec asks for it) unless the comments are in local time, then the display value.
 * Comparing a UTC note time with a display value was off by the reader's UTC offset ("told after it was resolved" or not).
 */
function dateOf(pack, name) {
  const stored = pack.related?.times && typeof pack.related.times === 'object' ? text(pack.related.times[name]) : '';
  return stored && !commentsAreLocal(pack) ? ms(stored) : ms(pack.fields?.[name]);
}

/** "3 hours", "2 days" - rough on purpose. */
export function ago(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  const hours = milliseconds / HOUR;
  if (hours < 1) return 'less than an hour ago';
  if (hours < 48) {
    const n = Math.round(hours);
    return `${n} hour${n === 1 ? '' : 's'} ago`;
  }
  const n = Math.floor(hours / 24);
  return `${n} days ago`;
}

// The same two phrases for the person to read ("3 hours ago" and "3 hours"). `ago` above stays English: it goes into the
// status lines that are sent to the AI, which must not change with the language of the panel.
function agoShown(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  const hours = milliseconds / HOUR;
  if (hours < 1) return t('less than an hour ago');
  if (hours < 48) return tn(Math.round(hours), '{n} hour ago', '{n} hours ago');
  return tn(Math.floor(hours / 24), '{n} day ago', '{n} days ago');
}

function spanShown(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  const hours = milliseconds / HOUR;
  if (hours < 1) return t('less than an hour');
  if (hours < 48) return tn(Math.round(hours), '{n} hour', '{n} hours');
  return tn(Math.floor(hours / 24), '{n} day', '{n} days');
}

// ---- Reading the pack ----------------------------------------------------------------------------------------------

function lastMessage(pack, now) {
  const journal = Array.isArray(pack.journal) ? pack.journal : [];
  const comments = journal.filter((e) => e && typeof e === 'object' && e.type === 'comment' && text(e.text));
  const access = Array.isArray(pack.access) ? pack.access : [];
  // "No messages" is only a fact when the notes could be read (or were confirmed empty).
  const known = journal.length > 0 || access.some((a) => a && a.source === 'journal' && (a.status === 'ok' || a.status === 'empty'));
  if (!comments.length) return { known, direction: known ? 'none' : 'unknown', ageMs: null, atMs: null, count: 0 };

  // The customer by name (in any script, in any order), email or login (src/context/identity.js). A display name that is not the
  // customer's is someone else, so the service desk. A login or address that matches no one is not a reason to guess either way.
  const last = comments[comments.length - 1];
  const direction = { customer: 'customer', support: 'agent' }[authorRole(last.by, identities(pack))] || 'unknown';
  const atMs = ms(last.when);
  return { known: true, direction, ageMs: atMs === null ? null : Math.max(0, now - atMs), atMs, count: comments.length };
}

function approvalState(pack, now) {
  const list = Array.isArray(pack.related?.approvals) ? pack.related.approvals : [];
  const pending = list.filter((a) => a && /^(requested|waiting|pending)/i.test(text(a.state)));
  const rejected = list.some((a) => a && /reject/i.test(text(a.state)));
  const fieldValue = text(pack.fields?.approval);
  const ages = pending.map((a) => ms(a.updated)).filter((at) => at !== null).map((at) => Math.max(0, now - at));
  return {
    pending: pending.length || (list.length === 0 && /^(requested|waiting)/i.test(fieldValue) ? 1 : 0),
    rejected: rejected || (list.length === 0 && /reject/i.test(fieldValue)),
    oldestMs: ages.length ? Math.max(...ages) : null,
  };
}

function slaState(pack) {
  const list = Array.isArray(pack.related?.slas) ? pack.related.slas : [];
  const live = list.filter((s) => s && typeof s === 'object' && !/cancel/i.test(text(s.stage)));
  const breached = live.some((s) => text(s.breached) === 'true');
  const open = live.filter((s) => !/complet/i.test(text(s.stage)) && text(s.breached) !== 'true');
  const pcts = open.map((s) => Number.parseFloat(text(s.percentage))).filter(Number.isFinite);
  const worst = pcts.length ? Math.max(...pcts) : null;
  return { known: live.length > 0, breached, atRisk: !breached && worst !== null && worst >= 75, worstPercent: worst };
}

/** Everything the rules look at, as plain data (also what the draft prompt is told, in words). */
export function readSignals(pack, now = Date.now()) {
  const p = pack && typeof pack === 'object' ? pack : {};
  const f = p.fields && typeof p.fields === 'object' ? p.fields : {};
  const state = text(f.state) || text(f.request_state) || text(f.stage);
  const reason = /^(none|-- none --)$/i.test(text(f.hold_reason)) ? '' : text(f.hold_reason);

  // With no readable state, the dates decide.
  const closedByDate = !state && Boolean(text(f.closed_at));
  // What the state means is read in one place (src/domain/states.js, docs/states.md): the stored value by table when the pack has it,
  // else the words of the label in English, German and Arabic.
  const asked = { table: p.table || p.kind || '', value: f.state_value, label: state, stage: text(f.stage) };
  const meaning = state ? classifyState(asked) : 'unknown';
  const closed = meaning === 'closed' || meaning === 'cancelled' || closedByDate;
  const resolved = !closed && (meaning === 'resolved' || (!state && Boolean(text(f.resolved_at))));
  // The STATE decides whether it is on hold; the hold reason only says for whom (as in src/mywork/states.js). A reason left filled
  // in after the ticket went back to In Progress is stale: it is neither "on hold" nor said. With no state, the reason is all there is.
  const onHold = !closed && !resolved && (state ? meaning === 'waiting' : Boolean(reason));
  const hold = onHold ? reason : '';
  // For whom it waits: the hold reason says (or the state's own words: "Awaiting Caller"); with no state, the reason alone.
  const waitingOnCustomer = onHold && waitsOn({ ...asked, label: state || 'on hold', holdReason: reason }) === 'customer';

  const resolvedAt = dateOf(p, 'resolved_at') ?? dateOf(p, 'closed_at');
  const openedAt = dateOf(p, 'opened_at');
  const message = lastMessage(p, now);
  return {
    kind: text(p.kind),
    state,
    hold,
    closed,
    cancelled: closed && /cancel/i.test(state),
    resolved,
    onHold,
    waitingOnCustomer,
    resolvedMs: resolvedAt === null ? null : Math.max(0, now - resolvedAt),
    resolvedAtMs: resolvedAt,
    openMs: openedAt === null ? null : Math.max(0, now - openedAt),
    descriptionLength: text(f.description).length,
    message,
    approval: approvalState(p, now),
    sla: slaState(p),
  };
}

// ---- Facts shown next to the suggestions ---------------------------------------------------------------------------

function factsFor(s) {
  const facts = [];
  if (s.state) facts.push(s.hold ? `${s.state}: ${s.hold}` : s.state);
  if (s.resolved && s.resolvedMs !== null) facts.push(t('Resolved {when}', { when: agoShown(s.resolvedMs) }));
  const m = s.message;
  if (m.direction === 'none') facts.push(t('No message to the person yet'));
  else if (m.direction === 'customer') facts.push(m.ageMs !== null ? t('They wrote {when}', { when: agoShown(m.ageMs) }) : t('They wrote last'));
  else if (m.direction === 'agent') facts.push(m.ageMs !== null ? t('You wrote {when}', { when: agoShown(m.ageMs) }) : t('You wrote last'));
  if (s.approval.pending) {
    facts.push(
      s.approval.oldestMs !== null
        ? tn(s.approval.pending, '{n} approval waiting ({span})', '{n} approvals waiting ({span})', { span: spanShown(s.approval.oldestMs) })
        : tn(s.approval.pending, '{n} approval waiting', '{n} approvals waiting'),
    );
  }
  if (s.approval.rejected) facts.push(t('An approval was rejected'));
  if (s.sla.breached) facts.push(t('Service level missed'));
  else if (s.sla.atRisk) facts.push(t('Service level {percent}% used', { percent: Math.round(s.sla.worstPercent) }));
  return facts;
}

/**
 * Plain sentences about the record's status, worked out locally. They go to the draft as one more (masked) part, so the
 * model knows the same things the suggestion was based on. No names are ever in them.
 */
export function statusLines(pack, now = Date.now()) {
  const s = readSignals(pack, now);
  const lines = [];
  if (s.closed) lines.push(s.cancelled ? 'The ticket has been cancelled.' : 'The ticket is closed.');
  else if (s.resolved) lines.push(s.resolvedMs !== null ? `The ticket was marked resolved ${ago(s.resolvedMs)}.` : 'The ticket is marked resolved.');
  if (s.waitingOnCustomer) lines.push('The ticket is waiting for a reply from the person.');
  else if (s.onHold) lines.push(`The ticket is on hold${s.hold ? ` (${s.hold})` : ''}.`);
  const m = s.message;
  if (m.direction === 'none') lines.push('No message has been sent to the person yet.');
  else if (m.direction === 'customer') lines.push(`The last message came from the person${m.ageMs !== null ? `, ${ago(m.ageMs)}` : ''}.`);
  else if (m.direction === 'agent') lines.push(`The last message was sent by the service desk${m.ageMs !== null ? `, ${ago(m.ageMs)}` : ''}.`);
  if (s.approval.pending) lines.push(`${s.approval.pending} approval${s.approval.pending === 1 ? ' is' : 's are'} still waiting${s.approval.oldestMs !== null ? ` (for about ${ago(s.approval.oldestMs).replace(' ago', '')})` : ''}.`);
  if (s.approval.rejected) lines.push('An approval was rejected.');
  if (s.sla.breached) lines.push('A service level target for this ticket has been missed.');
  else if (s.sla.atRisk) lines.push('A service level target for this ticket is close to being missed.');
  return lines;
}

// ---- The suggestions -----------------------------------------------------------------------------------------------

/**
 * @param {object} pack ContextPack read with the 'email-compose' spec
 * @param {{ now?: number, max?: number, minScore?: number }} [options]
 * @returns {{ picks: {id: string, featureId: string, label: string, blurb: string, why: string, score: number}[], others: object[], facts: string[], note: string }}
 */
export function recommendEmails(pack, { now = Date.now(), max = MAX_PICKS, minScore = MIN_SCORE } = {}) {
  const s = readSignals(pack, now);
  const candidates = [];
  const add = (id, score, why) => candidates.push({ id, score, why });
  let note = '';
  const m = s.message;
  const hours = m.ageMs === null ? null : m.ageMs / HOUR;
  const openDays = s.openMs === null ? null : s.openMs / DAY;

  if (s.closed) {
    add('closure', s.cancelled ? 45 : 50, s.cancelled ? t('The ticket was cancelled. Tell the person so they are not left waiting.') : t('The ticket is closed. A short note confirms the outcome.'));
  } else if (s.resolved) {
    // Has the person been told? Only an agent message written after the resolution counts.
    const told = m.direction === 'agent' && m.atMs !== null && s.resolvedAtMs !== null && m.atMs >= s.resolvedAtMs - HOUR;
    const maybeTold = m.direction === 'agent' && !told && (m.atMs === null || s.resolvedAtMs === null);
    if (m.direction === 'customer' && m.atMs !== null && s.resolvedAtMs !== null && m.atMs > s.resolvedAtMs) {
      note = t('The person wrote after it was resolved. A reply (the Draft a reply action on This page) may fit better than a new email.');
    }
    if (told) add('resolution', 35, t('The person was already told after it was resolved. Send another only if needed.'));
    else if (maybeTold) add('resolution', 60, t('It is marked resolved. Check that the person knows.'));
    else add('resolution', 90, t('It is marked resolved and the person has not been told yet.'));

    if (s.resolvedMs !== null && s.resolvedMs >= 3 * DAY && m.direction !== 'customer') {
      add('closure', 80, t('Resolved {when} with no reply from the person. A closing note is due.', { when: agoShown(s.resolvedMs) }));
    } else if (m.direction !== 'customer') {
      add('closure', 45, t('When it is time to close, a closing note helps.'));
    }
  } else {
    // ---- waiting on the person ----
    if (s.waitingOnCustomer) {
      if (m.direction === 'agent') {
        if (hours !== null && hours >= 48) add('ask-info', 85, t("You are waiting for the person's reply. Your last message was {when}. A friendly reminder may help.", { when: agoShown(m.ageMs) }));
        else if (hours !== null) add('ask-info', 55, t("You are waiting for the person's reply (you wrote {when}). A reminder may be early.", { when: agoShown(m.ageMs) }));
        else add('ask-info', 60, t("You are waiting for the person's reply."));
      } else if (m.direction === 'none') {
        add('ask-info', 70, t('The ticket is waiting for the person, but no message has gone to them yet.'));
      } else if (m.direction === 'customer') {
        add('status-update', 45, t('The person replied. Tell them what happens next.'));
      } else {
        add('ask-info', 55, t("The ticket is waiting for the person's reply."));
      }
    } else if (s.onHold) {
      add(
        'status-update',
        75,
        s.hold
          ? t('The ticket is on hold ({reason}). Let the person know why it is waiting.', { reason: isolate(s.hold) })
          : t('The ticket is on hold. Let the person know why it is waiting.'),
      );
    }

    // A thin description on a fresh ticket: ask before work starts.
    const thinKinds = ['incident', 'case', 'task'];
    if (!s.waitingOnCustomer && !s.onHold && thinKinds.includes(s.kind) && s.descriptionLength < 40 && m.direction === 'none') {
      add('ask-info', 60, t('The description is short. Ask for what is needed to start.'));
    }

    // ---- approvals ----
    if (s.approval.pending) {
      const n = s.approval.pending;
      if (s.approval.oldestMs !== null && s.approval.oldestMs >= 2 * DAY) {
        add('approval-nudge', 85, tn(n, '{n} approval is still waiting after {span}.', '{n} approvals are still waiting after {span}.', { span: spanShown(s.approval.oldestMs) }));
      } else if (s.approval.oldestMs !== null) {
        add('approval-nudge', 45, tn(n, '{n} approval is waiting since {when}. A reminder may be early.', '{n} approvals are waiting since {when}. A reminder may be early.', { when: agoShown(s.approval.oldestMs) }));
      } else {
        add('approval-nudge', 65, tn(n, '{n} approval is still waiting.', '{n} approvals are still waiting.'));
      }
    }
    if (s.approval.rejected) add('status-update', 80, t('An approval was rejected. Tell the person what happens next.'));

    // ---- service levels ----
    if (s.sla.breached) add('apology', 85, t('A service level target was missed. A short apology and a clear next step help.'));
    else if (s.sla.atRisk) add('status-update', 65, t('A service level target is close ({percent}% used). A progress update helps.', { percent: Math.round(s.sla.worstPercent) }));

    // ---- how long since the last message ----
    if (m.direction === 'customer' && hours !== null) {
      if (hours >= 48) add('apology', 75, t('The person wrote {when} and has had no reply.', { when: agoShown(m.ageMs) }));
      else if (hours >= 24) add('status-update', 60, t('The person wrote {when} and is waiting for an answer.', { when: agoShown(m.ageMs) }));
    }
    if (m.direction === 'agent' && !s.waitingOnCustomer && hours !== null && hours >= 72) {
      add('status-update', 70, t('Your last message was {when}. A short update keeps the person informed.', { when: agoShown(m.ageMs) }));
    }
    if (m.direction === 'none' && !s.waitingOnCustomer && openDays !== null && openDays >= 1) {
      add('status-update', 60, t('No message has gone to the person yet.'));
    }
    if (openDays !== null && openDays >= 14) {
      const days = Math.floor(openDays);
      add('apology', 50, t('The ticket has been open for {days} days. Acknowledge the wait.', { days }));
      add('status-update', 65, t('The ticket has been open for {days} days. The person will want an update.', { days }));
    }
    add('status-update', 40, t('A short update keeps the person informed.'));
  }

  // The best reason per kind of email, strongest first; ties keep the order of EMAIL_TYPES.
  const best = new Map();
  for (const c of candidates) if (!best.has(c.id) || c.score > best.get(c.id).score) best.set(c.id, c);
  const order = EMAIL_TYPES.map((type) => type.id);
  const picks = [...best.values()]
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score || order.indexOf(a.id) - order.indexOf(b.id))
    .slice(0, Math.max(0, max))
    .map((c) => ({ ...emailTypeById(c.id), why: c.why, score: c.score }));
  const picked = new Set(picks.map((c) => c.id));
  return { picks, others: EMAIL_TYPES.filter((type) => !picked.has(type.id)), facts: factsFor(s), note };
}

// ---- The caller's language (round 4) -------------------------------------------------------------------------------

const LANGUAGE_OF_SCRIPT = { arabic: 'ar' };

/** 'ar', 'en' or '' (another language, a mix of scripts, or too few letters to tell) for one text. No AI: the script and common words. */
export function languageOfText(value) {
  const s = text(value);
  const script = scriptOf(s);
  if (LANGUAGE_OF_SCRIPT[script]) return LANGUAGE_OF_SCRIPT[script];
  return script === 'latin' && looksEnglish(s) ? 'en' : '';
}

/**
 * The language the caller writes in: that of the latest comment the caller wrote (the customer-visible notes, by name, email or
 * login, src/context/identity.js), else that of the description, else that of the title. The AI's reply follows the same text by
 * default (src/prompts/rules.js LANGUAGE_CUSTOMER: "the language the customer used in their most recent message").
 * @returns {'ar' | 'en' | ''}
 */
export function callerLanguage(pack) {
  const p = pack && typeof pack === 'object' ? pack : {};
  const journal = Array.isArray(p.journal) ? p.journal : [];
  const ids = identities(p);
  for (let i = journal.length - 1; i >= 0; i -= 1) {
    const entry = journal[i];
    if (!entry || typeof entry !== 'object' || entry.type !== 'comment' || !text(entry.text)) continue;
    if (authorRole(entry.by, ids) === 'customer') return languageOfText(entry.text);
  }
  for (const name of ['description', 'short_description']) {
    const value = text(p.fields?.[name]);
    if (scriptOf(value)) return languageOfText(value);
  }
  return '';
}

/**
 * What the Reply row says about the language, true for the setting "Language of AI answers" (Settings > Language): 'ticket' (the
 * default) writes in the customer's language, 'panel' in the panel's (src/prompts/rules.js answerLanguageRule). Said only when the
 * caller writes in another language than the panel's: an English ticket in an English panel needs no line.
 * @param {{ caller: 'ar'|'en'|'', setting?: string, panel?: string, ai?: boolean }} options
 *   caller: callerLanguage(pack); setting: settings.answerLanguage; panel: the panel's language now; ai: Draft a reply is available
 * @returns {{ reply: string, fact: string, line: string }} reply: the language Draft a reply writes in ('' when not known); fact: the
 *   sentence for the card; line: the words added to the row's line
 */
export function replyLanguage({ caller, setting = 'ticket', panel = 'en', ai = true } = {}) {
  if ((caller !== 'ar' && caller !== 'en') || caller === panel) return { reply: caller === 'ar' || caller === 'en' ? caller : '', fact: '', line: '' };
  const reply = setting === 'panel' && (panel === 'ar' || panel === 'en') ? panel : caller;
  const arabic = caller === 'ar';
  let fact;
  if (!ai) fact = arabic ? t('The caller writes in Arabic.') : t('The caller writes in English.');
  else if (reply === caller) {
    fact = arabic
      ? t('The caller writes in Arabic. Draft a reply writes in Arabic too, unless you choose English.')
      : t('The caller writes in English. Draft a reply writes in English too, unless you choose Arabic.');
  } else {
    fact = arabic
      ? t('The caller writes in Arabic. Draft a reply writes in English (your setting).')
      : t('The caller writes in English. Draft a reply writes in Arabic (your setting).');
  }
  return { reply, fact, line: arabic ? t('the caller writes in Arabic') : t('the caller writes in English') };
}

// ---- The draft ---------------------------------------------------------------------------------------------------

// "Subject: ..." possibly dressed up as markdown ("**Subject:** ...", "## Subject: ...").
const SUBJECT_LINE = /^[\s#>*_-]*subject[\s*_]*:[\s*_]*(.+?)[\s*_]*$/i;

/**
 * Splits a drafted email into its subject and body. The model is asked for a `Subject:` line first; when the line is not
 * in the first few lines the whole text is the body.
 * @returns {{ subject: string, body: string }}
 */
export function parseEmailDraft(input) {
  const lines = String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
  const at = lines.slice(0, 6).findIndex((l) => SUBJECT_LINE.test(l));
  if (at < 0) return { subject: '', body: lines.join('\n').trim() };
  const subject = SUBJECT_LINE.exec(lines[at])[1].replace(/\s+/g, ' ').replace(/^["'`]+|["'`]+$/g, '').trim().slice(0, 200);
  const rest = [...lines.slice(0, at), ...lines.slice(at + 1)];
  const body = rest.join('\n').replace(/^\s*(?:-{3,}|\*{3,})\s*\n/, '').trim();
  return { subject, body };
}

/**
 * The classic email client for a record, on the instance the page is on ('' when the table or id is not valid).
 * The panel opens it in a new tab with openInNewTab(), which refuses any other origin.
 */
export function emailFormUrl(pageHref, { table, sysId } = {}) {
  return emailFormLink({ href: pageHref }, { table, sysId }); // (the address shapes live in src/lib/snLinks.js)
}

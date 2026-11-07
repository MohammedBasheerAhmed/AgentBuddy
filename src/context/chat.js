// The messages of a chat, as { when, by, type, text, side } entries, oldest first (newest last).
//
// WHERE THEY LIVE depends on the product, and none of it could be verified against a real instance (docs/live-questions/
// knowledge.md, questions 1-6). So this reader is a list of plausible places tried in order, GET-only and ACL-aware:
//
//   Agent Workspace chat / Advanced Work Assignment / Virtual Agent:  sys_cs_conversation  ->  sys_cs_message
//   Connect Support:                                                  live_group_profile   ->  live_message
//
// The record on screen is the interaction (or the conversation itself). A conversation is found from it by asking each
// holder table for rows that point back at the record; the messages are then read by the conversation id. Every answer is
// checked against the id that was asked for, because ServiceNow ignores a condition on a column that does not exist and then
// answers with unrelated rows. Whatever worked is recorded in `access` (strategy); whatever did not is reported, never hidden.
//
// A message becomes { when (UTC), by (display name or login), type: 'comment', text, side } : 'comment' because a chat is
// the customer-facing exchange, `side` ('customer' | 'agent' | 'bot' | '') so a view can tell who said what. System events
// (joined, left, typing) are dropped: they say nothing the summary needs.

import { LIMITS } from './allowlists.js';
import { NOTE_TEXT, STATUS, confirmEmptyIsReallyEmpty, entry as accessEntry, softRead, tm } from './access.js';
import { SYS_ID_RE, clipText, disp, journalText, oneLine, raw, uniq } from './util.js';

export const CHAT_SOURCE = 'chat';
export const CHAT_MAX_MESSAGES = 80;

// What the chat's access entries say (the sentences name no table: the panel words them with the plain label of the source).
const CHAT_NOTE = Object.freeze({
  noneYouCanRead: tm('This chat has no messages that you can see.'),
  noText: tm('The messages found held no text.'),
  utc: tm('Times are UTC.'),
  newest: tm('Showing the newest {n} messages.'),
  // The honest "nothing": chat tables differ by product and a role may not read them, so this does not prove the chat is empty.
  unreadable: tm('You cannot see the chat messages. Your role may not allow it, so the chat may not be empty.'),
});

// A record of one of these tables IS the conversation: its messages point straight at it.
const OWN_MESSAGES = Object.freeze({
  sys_cs_conversation: { table: 'sys_cs_message', link: 'conversation' },
  live_group_profile: { table: 'live_message', link: 'group' },
});

// Tables that hold a conversation and may point back at the record on screen, and the columns they might do it with.
const HOLDERS = Object.freeze([
  { table: 'sys_cs_conversation', links: ['interaction', 'document_id'], messages: OWN_MESSAGES.sys_cs_conversation },
  { table: 'live_group_profile', links: ['document', 'interaction'], messages: OWN_MESSAGES.live_group_profile },
]);

// Last resort for a record that no holder points back at: a message table that is keyed by the interaction itself.
const DIRECT = Object.freeze({ table: 'sys_cs_message', link: 'interaction' });

// Columns asked of a message table. The tables differ, so this is the union of the names they are known or likely to use;
// a column that a table does not have is not returned.
const MESSAGE_FIELDS = Object.freeze([
  'sys_id', 'sys_created_on', 'sys_created_by', 'message', 'formatted_message', 'text', 'body', 'value', 'payload',
  'direction', 'message_type', 'sender_type', 'type', 'sender', 'author', 'profile', 'user',
]);

const TEXT_COLUMNS = ['message', 'text', 'body', 'value', 'formatted_message', 'payload'];
const NAME_COLUMNS = ['sender', 'author', 'profile', 'user'];
const SYSTEM_LOGINS = new Set(['system', 'guest', 'nobody', '']);

// ---- Mapping one row (pure) ----------------------------------------------------------------------

const fold = (text) => String(text || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();

// The text of a message inside a JSON payload (Virtual Agent keeps rich messages that way). Bounded depth, strings only.
function textFromJson(value, depth = 0) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || depth > 3) return '';
  for (const key of ['value', 'text', 'message', 'body', 'data', 'content']) {
    if (key in value) {
      const found = textFromJson(value[key], depth + 1);
      if (found) return found;
    }
  }
  return '';
}

/** The plain text of a message row, or ''. HTML is stripped; a JSON payload is searched for its text. */
export function messageText(row) {
  for (const column of TEXT_COLUMNS) {
    const value = disp(row?.[column]).trim();
    if (!value) continue;
    let text = value;
    if (/^[[{]/.test(value)) {
      try {
        text = textFromJson(JSON.parse(value));
      } catch {
        text = column === 'payload' ? '' : value;
      }
    } else if (column === 'payload') {
      text = value;
    }
    const clean = clipText(journalText(text), LIMITS.journalEntry);
    if (clean) return clean;
  }
  return '';
}

/** Who sent it: { name } when a name column says so, else { login } from the row's creator, else {}. */
export function messageSender(row) {
  for (const column of NAME_COLUMNS) {
    const shown = disp(row?.[column]).trim();
    if (shown && !SYS_ID_RE.test(shown)) return { name: oneLine(shown, 80) };
  }
  const login = raw(row?.sys_created_by).trim();
  return SYSTEM_LOGINS.has(login.toLowerCase()) ? {} : { login: oneLine(login, 80) };
}

/** 'system' | 'bot' | 'customer' | 'agent' | '' from the row's own direction and type columns (never from a guess). */
export function messageSide(row) {
  const kind = fold([raw(row?.sender_type), raw(row?.message_type), raw(row?.type)].join(' '));
  if (/system|notification|event|join|leave|transfer|typing|presence/.test(kind)) return 'system';
  if (/\b(bot|virtual|automated)\b/.test(kind)) return 'bot';
  const direction = fold(raw(row?.direction));
  if (['inbound', 'in', 'incoming', 'user', 'customer', 'consumer', 'visitor'].includes(direction)) return 'customer';
  if (['outbound', 'out', 'outgoing', 'agent'].includes(direction)) return 'agent';
  return '';
}

/**
 * One chat entry from a message row (read with display values), or null for a system event or an empty message.
 * `by` is a display name, a login (when that is all the row has; see `login`), or '' for a bot.
 */
export function mapChatRow(row) {
  const side = messageSide(row);
  if (side === 'system') return null;
  const text = messageText(row);
  if (!text) return null;
  const sender = messageSender(row);
  const by = side === 'bot' ? '' : sender.name || sender.login || '';
  return { when: raw(row.sys_created_on), by, type: 'comment', text, side, login: !sender.name && Boolean(sender.login) && side !== 'bot' };
}

/**
 * Fill in `side` where the row did not say, from who the record names as the customer and the agent. A name that matches
 * neither stays unclassified: it is not guessed. Returns new entries.
 * @param {{ customers?: string[], agents?: string[] }} who display names
 */
export function assignSides(entries, { customers = [], agents = [] } = {}) {
  const customerSet = new Set(customers.map(fold).filter(Boolean));
  const agentSet = new Set(agents.map(fold).filter(Boolean));
  return entries.map((entry) => {
    if (entry.side) return entry;
    const name = fold(entry.by);
    if (name && customerSet.has(name) && !agentSet.has(name)) return { ...entry, side: 'customer' };
    if (name && agentSet.has(name) && !customerSet.has(name)) return { ...entry, side: 'agent' };
    return entry;
  });
}

// ---- Reading -------------------------------------------------------------------------------------

const idOf = (row) => raw(row?.sys_id).toLowerCase();

// Find the conversations that belong to the record, one holder table at a time.
async function findConversations({ table, sysId }, deps, attempts) {
  const plans = [];
  const own = OWN_MESSAGES[table];
  if (own) return [{ ...own, ids: [sysId], via: `the ${table} record` }];

  for (const holder of HOLDERS) {
    for (const link of holder.links) {
      // eslint-disable-next-line no-await-in-loop -- a handful of small reads, kept sequential.
      const { rows, failure } = await softRead(deps, holder.table, `${link}=${sysId}`, ['sys_id', link], { limit: 5, displayValue: false });
      if (failure) {
        attempts.push(accessEntry(holder.table, failure.status, failure.note));
        break; // the table itself is the problem (denied, not on this instance): another column will not help
      }
      const mine = rows.filter((row) => raw(row[link]).toLowerCase() === sysId);
      if (rows.length && rows.every((row) => !raw(row[link]))) {
        // No row has the column at all: the instance ignored the condition because this table cannot point at the record that way.
        attempts.push(accessEntry(holder.table, STATUS.EMPTY_OR_HIDDEN, NOTE_TEXT.ignoredFilter));
        continue;
      }
      if (mine.length < rows.length) {
        attempts.push(accessEntry(holder.table, STATUS.ERROR, NOTE_TEXT.ignoredFilter));
        continue;
      }
      if (mine.length) {
        // Ids that go back into a query are checked again: whatever the instance answered is untrusted.
        const ids = mine.map(idOf).filter((value) => SYS_ID_RE.test(value));
        if (ids.length) plans.push({ ...holder.messages, ids, via: `${holder.table}.${link}` });
        break;
      }
    }
  }
  return plans;
}

// Read one plan's messages. Returns { entries (newest first), total } or null when nothing usable came back.
async function readPlan(plan, deps, max, attempts, memo) {
  const fields = [...MESSAGE_FIELDS, plan.link];
  const query = `${plan.link}IN${plan.ids.join(',')}^ORDERBYDESCsys_created_on`;
  const { rows, failure } = await softRead(deps, plan.table, query, fields, { limit: max + 1, displayValue: true });
  if (failure) {
    attempts.push(accessEntry(plan.table, failure.status, failure.note));
    return null;
  }
  const wanted = new Set(plan.ids);
  if (rows.length && rows.every((row) => !raw(row[plan.link]))) {
    attempts.push(accessEntry(plan.table, STATUS.EMPTY_OR_HIDDEN, NOTE_TEXT.ignoredFilter));
    return null;
  }
  if (rows.some((row) => !wanted.has(raw(row[plan.link]).toLowerCase()))) {
    attempts.push(accessEntry(plan.table, STATUS.ERROR, NOTE_TEXT.ignoredFilter));
    return null;
  }
  const entries = rows.map(mapChatRow).filter(Boolean);
  if (!entries.length) {
    if (!rows.length) {
      const seen = await confirmEmptyIsReallyEmpty(plan.table, deps, memo);
      attempts.push(accessEntry(plan.table, seen.status, seen.status === STATUS.EMPTY ? CHAT_NOTE.noneYouCanRead : seen.note));
    } else {
      attempts.push(accessEntry(plan.table, STATUS.EMPTY, CHAT_NOTE.noText));
    }
    return null;
  }
  return { entries, truncated: rows.length > max };
}

/**
 * Read the messages of the conversation a record stands for.
 * @param {{ table: string, sysId: string }} record
 * @param {{ queryTable: Function }} deps
 * @param {{ max?: number, memo?: Map }} [options]
 * @returns {Promise<{ entries: object[], loginNames: string[], names: string[], access: object[] }>}
 *   entries: oldest first, at most `max`; loginNames: senders known only by login (the caller turns them into names);
 *   names: display names of the senders. access[0] says what happened: status 'ok' with `strategy` naming the tables that
 *   worked, or 'denied' / 'error' / 'empty-or-hidden' with the honest sentence "No chat messages are available to you...".
 */
export async function readChatMessages({ table, sysId }, deps, { max = CHAT_MAX_MESSAGES, memo } = {}) {
  const id = String(sysId || '').toLowerCase();
  if (!SYS_ID_RE.test(id)) throw new TypeError('A chat needs a record id.');
  const attempts = [];
  const plans = await findConversations({ table, sysId: id }, deps, attempts);
  if (!plans.length && !OWN_MESSAGES[table]) plans.push({ ...DIRECT, ids: [id], via: `${DIRECT.table}.${DIRECT.link}` });

  const got = [];
  const strategies = [];
  let truncated = false;
  for (const plan of plans) {
    // eslint-disable-next-line no-await-in-loop -- one or two reads.
    const result = await readPlan(plan, deps, max, attempts, memo);
    if (!result) continue;
    got.push(...result.entries);
    strategies.push(`${plan.table} via ${plan.via}`);
    truncated = truncated || result.truncated;
  }

  // Newest first from the instance; one list, oldest first, stable for equal times (UTC 'YYYY-MM-DD HH:MM:SS' sorts as text).
  const ordered = got
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.when.localeCompare(b.entry.when) || b.index - a.index)
    .map((x) => x.entry);
  const kept = ordered.slice(-max);

  if (!kept.length) return { entries: [], loginNames: [], names: [], access: [noMessages(attempts)] };

  const notes = [CHAT_NOTE.utc];
  if (truncated || ordered.length > max) notes.push(CHAT_NOTE.newest.replace('{n}', String(max)));
  const tried = attempts.filter((a) => a.status === STATUS.DENIED || a.status === STATUS.ERROR).map((a) => `${a.source}: ${a.status}`);
  const entries = kept.map(({ login, ...entry }) => entry);
  return {
    entries,
    loginNames: uniq(kept.filter((e) => e.login).map((e) => e.by)),
    names: uniq(kept.filter((e) => !e.login).map((e) => e.by)),
    access: [accessEntry(CHAT_SOURCE, STATUS.OK, notes.join(' '), { strategy: strategies.join(' + '), tried })],
  };
}

// The honest "nothing" entry. Several sources may have failed in different ways; the worst reason leads.
function noMessages(attempts) {
  const status = attempts.some((a) => a.status === STATUS.DENIED)
    ? STATUS.DENIED
    : attempts.some((a) => a.status === STATUS.ERROR)
      ? STATUS.ERROR
      : STATUS.EMPTY_OR_HIDDEN;
  // The note is one fixed sentence; what each place answered stays in `tried` (technical, never drawn) for whoever debugs a product.
  const tried = attempts.map((a) => `${a.source}: ${a.status}`);
  return accessEntry(CHAT_SOURCE, status, status === STATUS.ERROR ? NOTE_TEXT.error : CHAT_NOTE.unreadable, { strategy: 'none', tried });
}

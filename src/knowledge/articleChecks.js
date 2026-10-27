// Deterministic checks on one knowledge article, before any AI: title, length, structure, freshness, keywords. Pure.
//
// Input is the article as a person would describe it (see articleFromPack). Output is a list of findings, worst first, each
// with a short plain-language reason. Nothing here is a verdict: a finding is a prompt to look, not proof of a fault.

import { parseSnTime } from '../context/util.js';

const DAY = 86400000;

export const LIMITS = Object.freeze({
  titleMinChars: 15,
  titleMinWords: 3,
  titleMaxChars: 100,
  textMinChars: 300,
  textMaxChars: 8000,
  noHeadingsAfterChars: 1500,
  staleDays: 365,
  veryStaleDays: 730,
  expiresSoonDays: 30,
  expiresLaterDays: 60,
  lowViews: 10,
  lowViewsAfterDays: 180,
  minKeywords: 3,
});

const GENERIC_TITLE = /^(issue|problem|error|info|information|question|questions|help|faq|notes?|misc|miscellaneous|test|draft|untitled|new article|article|howto|how to)$/i;
const TICKET_NUMBER = /\b(?:INC|REQ|RITM|SCTASK|CHG|PRB|TASK|CS|HRC|CTASK|PTASK)\d{5,}\b/;
const INSTRUCTION_VERB = /\b(click|select|open|go to|navigate|enter|type|press|install|run|restart|reboot|reset|log ?in|sign ?in|choose|tap|download|uninstall)\b/gi;
const NUMBERED_LINE = /^\s*(?:\d+[.)]|step \d+)/im;
const PREREQUISITE = /\b(before you (?:begin|start)|prerequisites?|requirements?|you(?:'ll| will)? need|make sure|ensure that|permissions? required|what you need)\b/i;
const PLACEHOLDER = /\b(TODO|TBD|lorem ipsum|XXX|FIXME)\b/;

const LEVEL_ORDER = { problem: 0, warn: 1, info: 2 };

const num = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
};

// A stored UTC time first; otherwise the display text when it is year-first or has a month written as a word. Else NaN.
function toMs(stored, shown) {
  const direct = parseSnTime(stored);
  if (Number.isFinite(direct)) return direct;
  const fromShown = parseSnTime(shown);
  if (Number.isFinite(fromShown)) return fromShown;
  if (/[A-Za-z]{3}/.test(String(shown || ''))) {
    const ms = Date.parse(shown);
    if (Number.isFinite(ms)) return ms;
  }
  return NaN;
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The article as the checks want it, from a ContextPack of kind 'knowledge' (feature 'article-check'). */
export function articleFromPack(pack) {
  const f = pack?.fields || {};
  const times = pack?.related?.times || {};
  const stats = pack?.related?.article || null;
  return {
    title: f.short_description || '',
    text: f.text || '',
    meta: f.meta || '',
    articleType: String(f.article_type || '').toLowerCase(),
    state: String(f.workflow_state || '').toLowerCase(),
    views: num(f.sys_view_count) ?? num(f.view_count),
    stats: stats
      ? Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, num(v) ?? 0]))
      : null,
    updatedMs: toMs(times.sys_updated_on, f.sys_updated_on),
    publishedMs: toMs(times.published, f.published),
    validToMs: toMs(times.valid_to, f.valid_to),
  };
}

/**
 * @param {{ title?: string, text?: string, meta?: string, articleType?: string, state?: string, views?: number|null,
 *   stats?: object|null, updatedMs?: number, publishedMs?: number, validToMs?: number }} article
 *   text is plain; stats (headings, orderedLists, listItems, images, textLength...) come from the HTML when it was read.
 * @param {{ now?: number, scanSecrets?: (text: string) => number }} [options] scanSecrets: how many passwords, keys or card
 *   numbers the text seems to hold (injected so this module stays free of the privacy code)
 * @returns {{ findings: { id: string, level: 'problem'|'warn'|'info', title: string, detail: string }[],
 *   counts: { problem: number, warn: number, info: number }, facts: object }}
 */
export function checkArticle(article, { now = Date.now(), scanSecrets } = {}) {
  const a = article || {};
  const title = String(a.title || '').trim();
  const text = String(a.text || '');
  const stats = a.stats || null;
  const chars = stats?.textLength ?? text.trim().length;
  const words = stats?.words ?? (text.trim() ? text.trim().split(/\s+/).length : 0);
  const findings = [];
  const add = (id, level, headline, detail) => findings.push({ id, level, title: headline, detail });

  // ---- Title ----
  const titleWords = title ? title.split(/\s+/).length : 0;
  if (!title) {
    add('title-missing', 'problem', 'No title', 'The article has no title, so nobody can find it by what it is about.');
  } else {
    if (GENERIC_TITLE.test(title)) add('title-vague', 'warn', 'The title says nothing about the topic', `"${title}" does not tell a reader what the article is for. Say what it helps with, for example "Reset your VPN password".`);
    else if (title.length < LIMITS.titleMinChars || titleWords < LIMITS.titleMinWords) add('title-short', 'warn', 'The title is very short', `${title.length} characters, ${titleWords} word${titleWords === 1 ? '' : 's'}. People search by what they want to do; a title of three or more words that says it is found more often.`);
    if (title.length > LIMITS.titleMaxChars) add('title-long', 'warn', 'The title is very long', `${title.length} characters. Search results cut long titles off; keep it under ${LIMITS.titleMaxChars}.`);
    if (TICKET_NUMBER.test(title)) add('title-ticket', 'warn', 'The title contains a ticket number', 'A ticket number means nothing to a reader. Name the problem or the task instead.');
    const letters = title.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 8 && letters === letters.toUpperCase()) add('title-caps', 'info', 'The title is in capital letters', 'Capitals are harder to read and look like shouting. Use normal sentence case.');
  }

  // ---- Text: size ----
  if (!chars) {
    if (a.articleType === 'wiki') add('text-wiki', 'info', 'The text could not be read', 'This looks like a wiki-format article; its body is not read by Agent Buddy, so size and structure were not checked.');
    else add('text-empty', 'problem', 'No text', 'The article has no body text.');
  } else {
    if (chars < LIMITS.textMinChars) add('text-short', 'warn', 'The text is very short', `${chars} characters. Check that it gives the reader enough to solve the problem without asking.`);
    if (chars > LIMITS.textMaxChars) add('text-long', 'warn', 'The text is very long', `About ${words} words (${chars} characters). Long articles are rarely read to the end; consider splitting it into smaller articles.`);
    if (PLACEHOLDER.test(text)) add('text-placeholder', 'warn', 'Unfinished text', 'The text contains a marker such as TODO, TBD or lorem ipsum.');
  }

  // ---- Structure ----
  if (chars) {
    const instructional = (text.match(INSTRUCTION_VERB) || []).length >= 3;
    const numbered = (stats?.orderedLists ?? 0) > 0 || NUMBERED_LINE.test(text);
    if (stats && stats.headings === 0 && chars > LIMITS.noHeadingsAfterChars) add('structure-headings', 'warn', 'No headings', 'A long text without headings is hard to scan. Headings such as "Symptoms", "Resolution" or "Steps" help readers jump to the part they need.');
    if (instructional && !numbered) add('structure-steps', 'warn', 'No numbered steps', 'The text reads like instructions, but has no numbered steps. Numbered steps are easier to follow and to check off.');
    if (instructional && !PREREQUISITE.test(text)) add('structure-prerequisites', 'info', 'No prerequisites', 'If the reader needs access, a tool or a permission first, say so before the steps ("Before you begin").');
    if (stats && stats.images >= 3 && chars < 500) add('structure-images', 'info', 'Mostly pictures', 'Search cannot read screenshots. Describe the steps in words as well.');
  }

  // ---- Keywords ----
  const keywords = String(a.meta || '').split(/[,;\n]+/).map((k) => k.trim()).filter(Boolean);
  if (!keywords.length) add('keywords-none', 'warn', 'No search keywords', 'Add the words people would type when they look for this: product names, error messages and the way users describe the problem.');
  else if (keywords.length < LIMITS.minKeywords) add('keywords-thin', 'info', 'Few search keywords', `Only ${keywords.length}. Add synonyms and the words users use, not just the official names.`);

  // ---- Freshness ----
  const updatedDays = Number.isFinite(a.updatedMs) ? Math.floor((now - a.updatedMs) / DAY) : null;
  if (updatedDays !== null) {
    if (updatedDays > LIMITS.veryStaleDays) add('stale-very', 'problem', 'Not changed for over two years', `Last changed ${day(a.updatedMs)}. Steps, screens and product names may no longer match.`);
    else if (updatedDays > LIMITS.staleDays) add('stale', 'warn', 'Not changed for over a year', `Last changed ${day(a.updatedMs)}. Check that the steps still match what users see.`);
  }
  const untilExpiry = Number.isFinite(a.validToMs) ? Math.ceil((a.validToMs - now) / DAY) : null;
  if (untilExpiry !== null) {
    if (untilExpiry < 0) add('expired', 'problem', 'The article has expired', `Valid until ${day(a.validToMs)}. It may no longer be shown to readers.`);
    else if (untilExpiry <= LIMITS.expiresSoonDays) add('expires-soon', 'warn', 'The article expires soon', `Valid until ${day(a.validToMs)} (${untilExpiry} day${untilExpiry === 1 ? '' : 's'}). Review it or extend the date.`);
    else if (untilExpiry <= LIMITS.expiresLaterDays) add('expires-later', 'info', 'The article expires in about two months', `Valid until ${day(a.validToMs)}.`);
  }
  const liveDays = Number.isFinite(a.publishedMs) ? Math.floor((now - a.publishedMs) / DAY) : updatedDays;
  if (a.views !== null && a.views !== undefined && a.views < LIMITS.lowViews && liveDays !== null && liveDays > LIMITS.lowViewsAfterDays) {
    add('views-low', 'info', 'Hardly anyone reads it', `${a.views} view${a.views === 1 ? '' : 's'} in ${Math.floor(liveDays / 30)} months. The title or keywords may not match what people search for.`);
  }

  // ---- State and content that should not be there ----
  if (a.state && a.state !== 'published') add('not-published', 'info', `This article is not published (${a.state})`, 'Readers cannot see it yet.');
  if (typeof scanSecrets === 'function' && chars) {
    const secrets = scanSecrets(text);
    if (secrets > 0) add('secrets', 'problem', 'May contain a password, key or card number', `${secrets} value${secrets === 1 ? '' : 's'} in the text look like credentials or payment data. Remove them before anyone else reads the article.`);
  }

  findings.sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level]);
  const counts = { problem: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.level] += 1;
  return {
    findings,
    counts,
    facts: {
      chars,
      words,
      headings: stats ? stats.headings : null,
      views: a.views ?? null,
      updatedDaysAgo: updatedDays,
      daysToExpiry: untilExpiry,
      keywords: keywords.length,
    },
  };
}

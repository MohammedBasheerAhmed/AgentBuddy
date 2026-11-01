// N11, missing details: the key facts a ticket usually needs before work can start, checked with plain rules (no AI). Empty or
// vague: the configuration item, how many people are affected, the error text, who to contact, the steps that lead to the problem.
// Each item says why it matters. Pure.
//
// A field the pack could not read is not "missing": on a sensitive (HR) record free text is not read at all, and then the text
// rules are skipped instead of reporting every text as empty.

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// Kinds where a fault is being worked (a request or a change has other key facts).
export const MISSING_KINDS = Object.freeze(['incident', 'problem', 'case', 'task']);

const VAGUE_TITLE = /^(?:(?:it|issue|issues|problem|problems|help|urgent|error|not working|doesn'?t work|broken|question|request|ticket|please help|asap|fix|support|na|n\/a|test|[a-z]+ (?:issue|problem|not working|broken))[\s!.?]*)$/i;
const SCOPE = /\b(?:only me|just me|everyone|everybody|all (?:users|staff|of us)|whole (?:team|office|site|floor|department)|several|many users|multiple users|\d+\s*(?:users|people|colleagues|staff)|my team|our team|the team|nobody else|no one else|others|colleagues|department|site[- ]wide|company[- ]wide)\b/i;
const ERROR_TEXT = /\berror\b|\bcode\b|\bmessage\b|\bexception\b|\bfail(?:s|ed|ure|ing)?\b|\bdenied\b|\btime[- ]?out\b|\bcrash(?:es|ed)?\b|0x[0-9a-f]{3,}|\b\d{3,5}\b|["'][^"'\n]{6,}["']/i;
const STEPS = /\bsteps?\b|\breproduce\b|^\s*(?:\d+[.)]|[-*])\s+\S|\bwhen i\b|\bafter i\b|\bwhenever\b|\bevery time\b|\beach time\b|\bi tried\b|\btried to\b|\bthen\b.{0,40}\bthen\b/im;
const CUSTOMER_ROLES = ['caller', 'requested_for', 'contact', 'consumer'];

// A word or two per item, for the card's one-line summary.
export const SHORT = Object.freeze({ title: 'title', description: 'description', ci: 'CI', impact: 'who is affected', error: 'error text', contact: 'contact', steps: 'steps', category: 'category' });

const item = (id, title, why) => ({ id, title, why, short: SHORT[id] || id });

/**
 * @param {object} pack ContextPack read with the 'insights-ticket' spec
 * @returns {{ applicable: boolean, items: { id, title, why }[], textRead: boolean }}
 */
export function missingDetails(pack) {
  const kind = text(pack?.kind);
  if (!MISSING_KINDS.includes(kind)) return { applicable: false, items: [], textRead: false };
  const f = pack?.fields || {};
  // A minimised pack (HR, or a task whose class is unknown) has no free text by design.
  const textRead = !pack?.sensitive && !(Array.isArray(pack?.access) ? pack.access : []).some((a) => a?.status === 'skipped' && /free text/i.test(text(a?.note)));
  const title = text(f.short_description);
  const body = text(f.description);
  const all = `${title}\n${body}`;
  const items = [];

  if (textRead) {
    const words = title.split(/\s+/).filter(Boolean);
    if (!title) items.push(item('title', 'No short description', 'A clear title is what the next person and the search for look-alikes start from.'));
    else if (words.length < 3 || VAGUE_TITLE.test(title)) items.push(item('title', 'The short description is vague', 'Say what fails and where, for example "VPN drops every 10 minutes on the London profile".'));
    if (!body) items.push(item('description', 'No description', 'Ask what happened, since when, and what the person was doing.'));
    else if (body.length < 40) items.push(item('description', 'The description is very short', 'A few more sentences save a round trip to the customer.'));
  }
  if (['incident', 'problem', 'case'].includes(kind) && !text(f.cmdb_ci) && !text(f.asset) && !text(f.product)) {
    items.push(item('ci', 'No configuration item', 'Without it, outages, recent changes and known errors on the same item cannot be checked.'));
  }
  if (textRead && ['incident', 'case', 'task'].includes(kind) && !SCOPE.test(all)) {
    items.push(item('impact', 'Not clear who else is affected', `Ask whether colleagues have the same problem.${text(f.impact) ? ` The impact is set to ${text(f.impact)}.` : ''}`));
  }
  if (textRead && ['incident', 'problem', 'case'].includes(kind) && (title || body) && !ERROR_TEXT.test(all)) {
    items.push(item('error', 'No error message quoted', 'The exact error text (or a screenshot) is often the fastest way to the fix.'));
  }
  const people = Array.isArray(pack?.people) ? pack.people : [];
  const customer = people.find((p) => CUSTOMER_ROLES.includes(p?.role));
  // An email that could not be read (sys_user refused) is not an email that is missing.
  const usersRead = !(Array.isArray(pack?.access) ? pack.access : []).some((a) => a?.source === 'sys_user' && a?.status !== 'ok' && a?.status !== 'empty');
  if (textRead && kind !== 'problem') {
    if (!customer) items.push(item('contact', 'No caller or contact', 'Nobody is named as the person to keep informed.'));
    else if (!text(customer.email) && usersRead) items.push(item('contact', 'No email address for the caller', 'Check how to reach them before you promise an update.'));
  }
  if (textRead && ['incident', 'problem', 'case'].includes(kind) && body && !STEPS.test(body)) {
    items.push(item('steps', 'No steps to reproduce', 'Ask what they do just before it happens, so you can see it yourself.'));
  }
  if (['incident', 'problem', 'case'].includes(kind) && !text(f.category)) {
    items.push(item('category', 'No category', 'The category drives routing and reports.'));
  }
  return { applicable: true, items, textRead };
}

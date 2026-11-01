// N20, a plain email template per kind of email (no AI), filled from the ticket: the person's first name, the ticket number and
// its title, the agent's name. What only the agent knows stays a [placeholder in brackets] for them to fill. Pure.
//
// The six kinds are the ones src/compose/emailRecommend.js recommends (EMAIL_TYPES); this file never changes which one fits.

import { EMAIL_TYPES } from '../compose/emailRecommend.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const CUSTOMER_ROLES = ['caller', 'requested_for', 'contact', 'consumer', 'opened_for'];
const MAX_TITLE = 120;

// {first_name} {number} {title} {agent} {state}: filled from the ticket. [Brackets]: left for the agent.
export const EMAIL_TEMPLATES = Object.freeze({
  'ask-info': {
    subject: '{number}: we need a little more information',
    body: [
      '{greeting}',
      '',
      'Thank you for contacting us about "{title}" ({number}).',
      '',
      'To move this forward, could you please send us:',
      '- [what you need, for example the exact error message or a screenshot]',
      '- [when it started, and whether anyone else is affected]',
      '',
      'As soon as we have this, we will continue.',
      '',
      'Kind regards,',
      '{agent}',
    ],
  },
  'status-update': {
    subject: 'Update on {number}: {title}',
    body: [
      '{greeting}',
      '',
      'A short update on your ticket {number} ("{title}").',
      '',
      'Where it stands: [what has been done so far].',
      'Next step: [what happens next, and when you expect it].',
      '',
      'We will update you again by [date].',
      '',
      'Kind regards,',
      '{agent}',
    ],
  },
  resolution: {
    subject: '{number} is resolved: {title}',
    body: [
      '{greeting}',
      '',
      'Good news: your ticket {number} ("{title}") has been resolved.',
      '',
      'What we did: [the fix, in one or two plain sentences].',
      '',
      'Could you please check that everything works for you and let us know? If we do not hear back, the ticket will close automatically after [number] days.',
      '',
      'Kind regards,',
      '{agent}',
    ],
  },
  'approval-nudge': {
    subject: 'Approval waiting for {number}: {title}',
    body: [
      'Hello [approver name],',
      '',
      'The request {number} ("{title}") is waiting for your approval.',
      '',
      'You can approve or reject it in [where to approve]. The person is waiting for it to go ahead.',
      '',
      'Thank you,',
      '{agent}',
    ],
  },
  apology: {
    subject: 'Sorry for the wait on {number}',
    body: [
      '{greeting}',
      '',
      'I am sorry that your ticket {number} ("{title}") is taking longer than it should.',
      '',
      'What we are doing: [the current step].',
      'When to expect news: [date or time].',
      '',
      'Thank you for your patience.',
      '',
      'Kind regards,',
      '{agent}',
    ],
  },
  closure: {
    subject: '{number} is closed: {title}',
    body: [
      '{greeting}',
      '',
      'Your ticket {number} ("{title}") is now closed.',
      '',
      'If the problem comes back, reply to this message or open a new ticket and mention {number}.',
      '',
      'Kind regards,',
      '{agent}',
    ],
  },
});

/** The person the email is for: the caller (or requester, contact) on the pack, as { firstName, name }; null when nobody is named. */
export function recipientOf(pack) {
  const people = Array.isArray(pack?.people) ? pack.people : [];
  for (const role of CUSTOMER_ROLES) {
    const p = people.find((x) => x?.role === role && text(x.name));
    if (p) return { firstName: text(p.firstName) || text(p.name).split(/\s+/)[0], name: text(p.name) };
  }
  return null;
}

/**
 * A filled template.
 * @param {string} typeId one of EMAIL_TYPES' ids
 * @param {{ pack: object, agentName?: string, number?: string }} input
 * @returns {{ subject: string, body: string, placeholders: number } | null} null for an unknown kind
 */
export function fillEmailTemplate(typeId, { pack, agentName = '', number = '' } = {}) {
  const template = EMAIL_TEMPLATES[typeId];
  if (!template || !EMAIL_TYPES.some((t) => t.id === typeId)) return null;
  const who = recipientOf(pack);
  let title = text(pack?.fields?.short_description).replace(/\s+/g, ' ');
  if (title.length > MAX_TITLE) title = `${title.slice(0, MAX_TITLE - 1).trimEnd()}…`;
  const values = {
    greeting: who?.firstName ? `Hello ${who.firstName},` : 'Hello,',
    number: text(pack?.fields?.number) || text(pack?.number) || text(number) || '[ticket number]',
    title: title || '[short description]',
    agent: text(agentName) || '[your name]',
    state: text(pack?.fields?.state) || '[state]',
  };
  // One pass over the template: a value that itself contains "{...}" (a title with braces) is never filled in again.
  const fill = (line) => line.replace(/\{(greeting|number|title|agent|state)\}/g, (_, k) => values[k]);
  const subject = fill(template.subject);
  const body = template.body.map(fill).join('\n');
  const placeholders = (`${subject}\n${body}`.match(/\[[^\]\n]{2,80}\]/g) || []).length;
  return { subject, body, placeholders };
}

/** Subject and body as one text for the clipboard. */
export const emailAsText = (filled) => (filled ? `Subject: ${filled.subject}\n\n${filled.body}` : '');

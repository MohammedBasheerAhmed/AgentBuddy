// The caller briefing (docs/focus-layout.md, part B; the "Same caller" pain point): what the caller of this ticket raised before,
// whether this looks like the same issue, and what fixed it last time. Same engine as every feature (docs/contracts.md, "Feature
// definition"): the prompt is fixed text, the ticket and the caller's other tickets arrive as parts, and everything goes through
// prepareRun and the PII firewall. The columns it reads are in src/context/specs/caller.js; the list is cleaned and turned into text
// by src/domain/callerTickets.js.
//
// WHAT THIS SENDS: this ticket's short fields (number, short description, state, priority, category, item, opened); and, for each of
// the caller's other tickets your user can see (at most 10, newest first): its number, type, state, short description, opened and
// resolved dates, close code and close notes. Who the caller is goes as the column they are in ("Caller", "Requested for"...),
// never as a name; their name and email, and everyone else on the ticket, are masked wherever a ticket's wording mentions them.
// The honest limit (as for every pack with other tickets' text): someone named only inside another ticket's close notes, who is not on
// this ticket, is masked only by pattern. That is why the person sees what is sent every time this list has tickets (requirePreview).
import { domainParts } from '../../domain/parts.js';
import { callerOf, callerTicketsFailed, callerTicketsNoCaller, isHrTicket, mergeCallerTickets } from '../../domain/callerTickets.js';
import { SYS_ID_RE } from '../../context/util.js';
import { rulesFor } from '../../prompts/rules.js';
import { t, tm } from '../../i18n/index.js';

// Every kind whose record names the person it is for (src/context/people.js PERSON_FIELDS: caller_id, requested_for, contact, consumer,
// opened_for) or at least who opened it. A chat (the interaction record) names its customer in opened_for, as an HR case does. Not a
// change (it is requested, not raised by a caller), not an article, not 'other'.
export const CALLER_KINDS = Object.freeze(['incident', 'problem', 'request', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task', 'chat']);

const callerBriefing = {
  id: 'caller-briefing',
  get title() {
    return t('Brief me on this caller');
  },
  get description() {
    return t('What this caller raised before, and what fixed it.');
  },
  wave: 3,
  kinds: CALLER_KINDS,
  group: 'understand',
  primary: 'copy',
  journal: 0,
  insert: { field: 'work_notes', get label() { return t('Add to work notes'); }, fieldLabel: tm('Work notes') },
  // The caller's other tickets are read through the existing `history` read (src/content/reads.js): GET only, the person's own
  // session, every row checked against the caller again, at most 10. Its HR cases are read only on an HR ticket and only when HR content
  // is allowed (allowSensitive, which the content script lowers to the managed policy again): a caller's HR cases have nothing to say
  // about an incident's fix, and on an HR ticket the run is already gated as HR (Strict mode, an approved AI endpoint).
  // No caller: the briefing says so. A read that fails: the briefing still works and says the history was not available. A lost
  // session is the person's to fix, so it stops the run.
  enrich: async (pack, { read, allowSensitive = false } = {}) => {
    const caller = callerOf(pack);
    if (!caller) return callerTicketsNoCaller(pack);
    const allowHr = allowSensitive === true && isHrTicket(pack);
    let answer;
    try {
      answer = await read('history', { callerSysId: caller.sysId, excludeSysId: SYS_ID_RE.test(String(pack.sysId || '')) ? pack.sysId : '', allowSensitive: allowHr });
    } catch (err) {
      if (err?.code === 'SESSION_EXPIRED') throw err;
      return callerTicketsFailed(pack);
    }
    return mergeCallerTickets(pack, answer, { caller, allowHr });
  },
  parts: (pack) => domainParts(pack, { journal: 0, related: ['callerTickets'] }),
  system:
    'You help a service desk agent see what the caller of this ticket has raised before and what fixed it, so the agent does not start from zero.\n' +
    'Write exactly these headings, in this order, each on its own line and followed by a colon:\n' +
    'Caller: who the caller is by their role on this ticket (as the data says it) and how many of their other tickets the data lists. No name.\n' +
    'Before: up to three bullet points about their earlier tickets, most relevant to this ticket first, each with its ticket number.\n' +
    'Same issue?: whether this ticket looks like a repeat of one of them, naming that ticket\'s number and why in a few words, or "No sign of a repeat".\n' +
    'What fixed it: the fix that worked last time for a similar issue, with its ticket number, or "Not stated".\n' +
    'Watch out for: up to two bullet points (a ticket that came back soon after it was resolved, many tickets in a short time, tickets still open, frustration in their wording), or "Nothing flagged".\n' +
    'Rules: use only facts in the data and write "Not stated" when something is missing. ' +
    'When the data says the caller\'s other tickets could not be read, or that no caller was found, say so under Before and write "Not available" under Same issue? and What fixed it; never present the history as empty. ' +
    'Refer to people by their role, never by name. Plain language, at most 150 words. ' +
    rulesFor('agent'),
  instruction: 'Write the caller briefing for the agent working on this ticket.',
};

export default [callerBriefing];

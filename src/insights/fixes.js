// N4 and N5 helpers. Pure.
//
// fixFor: where each finding of "Ready to resolve?" (src/checks/resolutionCheck.js) can be put right. Another Insights card when
// one helps (an email that asks the customer to confirm, an article to link), or a short line saying where on the form it is.
// chaseLine: N5's "who to chase" one-liner on top of the request status.

const text = (v) => (typeof v === 'string' ? v.trim() : '');

const FIXES = {
  notes: { where: 'Resolution notes are on the form, usually under Resolution information.' },
  code: { where: 'The close code is on the form, next to the resolution notes.' },
  customer: { card: 'email', label: 'Which email fits' },
  links: { card: 'knowledge', label: 'Knowledge for this ticket' },
  hold: { where: 'Clear the hold reason on the form and move the state off On hold.' },
};

/** { card, label } (open that Insights card), { where } (a line about the form), or null. Only for a finding that needs a look. */
export function fixFor(check) {
  if (!check || check.status === 'ok') return null;
  return FIXES[check.id] || null;
}

const STATE_WORD = {
  approval: 'approval',
  rejected: 'rejected approval',
  hold: 'on hold',
  task: 'open work',
  progress: 'owner',
};

/**
 * "Chase: Beth Anglin (approval)" from requestStatus() (src/checks/requestStatus.js). Finished requests have nobody to chase.
 * @returns {{ text: string, tone: '' | 'warn' | 'ok' }}
 */
export function chaseLine(status) {
  const state = text(status?.state);
  if (state === 'done') return { text: 'Nothing to chase: it is finished.', tone: 'ok' };
  if (state === 'ended') return { text: 'Nothing to chase: it was closed without being completed.', tone: '' };
  const owner = text(status?.owner);
  const why = STATE_WORD[state] || 'owner';
  if (owner) return { text: `Chase: ${owner} (${why})`, tone: state === 'approval' || state === 'rejected' || state === 'hold' ? 'warn' : '' };
  if (state === 'approval') return { text: 'Chase: the approver (not visible to you)', tone: 'warn' };
  return { text: 'Nobody is named to chase yet.', tone: 'warn' };
}

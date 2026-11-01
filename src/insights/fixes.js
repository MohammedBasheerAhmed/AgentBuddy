// N4 and N5 helpers. Pure.
//
// fixFor: where each finding of "Ready to resolve?" (src/checks/resolutionCheck.js) can be put right. Another Insights card when
// one helps (an email that asks the customer to confirm, an article to link), or a short line saying where on the form it is.
// chaseLine: N5's "who to chase" one-liner on top of the request status.

import { isolate, t } from '../i18n/index.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');

const fixes = () => ({
  notes: { where: t('Resolution notes are on the form, usually under Resolution information.') },
  code: { where: t('The close code is on the form, next to the resolution notes.') },
  customer: { card: 'email', label: t('Which email fits') },
  links: { card: 'knowledge', label: t('Knowledge for this ticket') },
  hold: { where: t('Clear the hold reason on the form and move the state off On hold.') },
});

/** { card, label } (open that Insights card), { where } (a line about the form), or null. Only for a finding that needs a look. */
export function fixFor(check) {
  if (!check || check.status === 'ok') return null;
  return fixes()[check.id] || null;
}

const stateWord = (state) => ({ approval: t('approval'), rejected: t('rejected approval'), hold: t('on hold'), task: t('open work'), progress: t('owner') })[state];

/**
 * "Chase: Beth Anglin (approval)" from requestStatus() (src/checks/requestStatus.js). Finished requests have nobody to chase.
 * @returns {{ text: string, tone: '' | 'warn' | 'ok' }}
 */
export function chaseLine(status) {
  const state = text(status?.state);
  if (state === 'done') return { text: t('Nothing to chase: it is finished.'), tone: 'ok' };
  if (state === 'ended') return { text: t('Nothing to chase: it was closed without being completed.'), tone: '' };
  const owner = text(status?.owner);
  const why = stateWord(state) || t('owner');
  if (owner) return { text: t('Chase: {owner} ({why})', { owner: isolate(owner), why }), tone: state === 'approval' || state === 'rejected' || state === 'hold' ? 'warn' : '' };
  if (state === 'approval') return { text: t('Chase: the approver (not visible to you)'), tone: 'warn' };
  return { text: t('Nobody is named to chase yet.'), tone: 'warn' };
}

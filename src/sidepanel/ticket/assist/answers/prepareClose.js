// "Prepare to close" on the Ticket screen (round 4, docs/round4.md): what its answer card shows and inserts besides the AI's notes.
// Pure; tests/close-*.test.js. The view is PrepareClose.jsx; the facts come from useCloseWell (src/sidepanel/ticket/cards/ResolveCard.jsx).
//
//   closeSections(...)   the answer's sections in order, each with where it came from: Ready to resolve? (From ServiceNow), Close code
//                        (From look-alikes; only with a vote), the notes (Written by your AI), Repeat issue (From the caller's
//                        tickets; only when there is one). Only the notes come from the AI; the rest is worked out here and is never
//                        sent to it (the feature's parts are those of "Write resolution notes": src/features/packs/close.js).
//   codeTargetFor(...)   the close code's box, as an insert target
//   closePlan(...)       what ONE Insert does on this record: the code to fill (by its stored value) or to pick by hand, and the
//                        line said before the click ("Insert fills Close code and Resolution notes on the open form. ...")
import { describeInsert } from '../../../../lib/fillable.js';
import { PREPARE_CLOSE } from '../../../../features/packs/close.js';
import { closeCodeFact } from '../../../../insights/closeCode.js';
import { openFindings } from '../../../../checks/resolutionCheck.js';
import { pickResolutionNotes } from '../../../../features/picks.js';
import { isolate, t, tm, t as tr } from '../../../../i18n/index.js';

export { PREPARE_CLOSE };

/** Is this answer's feature Prepare to close? */
export const isPrepareClose = (feature) => feature?.id === PREPARE_CLOSE;

// The kinds whose form keeps its close code in close_code (an incident). A case and a problem keep theirs in resolution_code, which
// Agent Buddy does not fill: their suggested code is said, to be picked by hand.
export const CODE_KINDS = Object.freeze(['incident']);

const CODE_LABEL = tm('Close code');
const NOTES_LABEL = tm('Resolution notes');

/** The close code's box as an insert target (the shape of insertFlow insertTargets), for the check before the click and the Insert. */
export function codeTargetFor({ kind = '', surface = 'classic' } = {}) {
  const spec = { field: 'close_code', fieldLabel: CODE_LABEL, mode: 'replace' };
  const told = describeInsert({ field: 'close_code', fieldLabel: CODE_LABEL, mode: 'replace', kind, surface });
  return { key: 'close_code:code', feature: PREPARE_CLOSE, spec, field: 'close_code', label: t('Insert the close code'), fieldLabel: CODE_LABEL, table: '', mode: 'replace', modes: ['replace'], ...told, blocked: '', box: '' };
}

const both = (a, b) => t('{names} and {last}', { names: a, last: b });

/**
 * What one Insert does here.
 * @param {{
 *   kind: string, surface?: string,
 *   vote: object|null,           closeCodeVote over the solved look-alikes (value: the STORED value a choice takes; label: its name)
 *   notes: object|null,          the notes' target (insertTargets, field states applied)
 *   code: object|null,           the code's target (codeTargetFor, field states applied), or null on a kind without close_code
 *   form?: string,               what the page said it is ('gform' | 'workspace' | 'portal' | 'none'; readFieldStates)
 * }} input
 * @returns {{ code: { target: object, value: string, label: string } | null, byHand: string, line: string }}
 *   code: filled first, by its value; byHand: the code to pick by hand ('' when none is suggested or it is filled)
 */
export function closePlan({ kind = '', surface = 'classic', vote = null, notes = null, code = null, form = 'none' } = {}) {
  const wanted = vote?.enough && vote.matchesCurrent !== true && typeof vote.value === 'string' && vote.value.trim() ? vote : null;
  // A choice is set through the form's own g_form only: a Workspace or a portal page is told to pick it by hand, without trying.
  const page = !['workspace', 'portal'].includes(surface) && !['workspace', 'portal'].includes(form);
  const fill = Boolean(wanted && code && CODE_KINDS.includes(kind) && page && !code.blocked);
  const byHand = wanted && !fill ? wanted.label || wanted.value : '';
  const notesName = notes ? tr(notes.fieldLabel || notes.label || '') : '';
  let line = '';
  if (notes && !notes.blocked) {
    line = fill
      ? t('Insert fills {fields} on the open form. Nothing is saved until you press Save.', { fields: both(tr(CODE_LABEL), notesName) })
      : t('Insert fills {field} on the open form. Nothing is saved until you press Save.', { field: notesName });
    if (byHand) line = `${line} ${t('Choose the close code {code} yourself.', { code: isolate(byHand) })}`;
  } else if (notes?.blocked) line = notes.blocked;
  return { code: fill ? { target: code, value: wanted.value, label: wanted.label } : null, byHand, line };
}

/**
 * The answer's sections, in order. `notes` is the AI's text for the notes box (without a close-code line).
 * @param {{ view: object|null, vote: object|null, repeat: object|null, notesLabel: string, notes: string, loading?: boolean }} input
 *   view: buildCheckView (null while it is read); vote: closeCodeVote; repeat: repeatOfCaller
 * @returns {{ id: 'ready'|'code'|'notes'|'repeat', title: string, source: string, ai: boolean, items?: object[], text?: string,
 *   quiet?: boolean, link?: object }[]}
 */
export function closeSections({ view = null, vote = null, repeat = null, notesLabel = '', notes = '', loading = false } = {}) {
  const out = [];
  const findings = openFindings(view);
  out.push({
    id: 'ready',
    title: t('Ready to resolve?'),
    source: t('From ServiceNow'),
    ai: false,
    items: findings.map((c) => ({ id: c.id, status: c.status, title: c.title, hint: c.hint })),
    text: view ? (findings.length ? '' : t('Nothing stands out. This looks ready to resolve')) : loading ? t('Looking…') : t('The resolve check could not be read. Open "Close well" in Insights to see it.'),
  });
  const code = closeCodeFact(vote);
  if (code) out.push({ id: 'code', title: tr(CODE_LABEL), source: t('From look-alikes'), ai: false, text: code, quiet: vote.matchesCurrent === true });
  out.push({ id: 'notes', title: tr(notesLabel || NOTES_LABEL), source: t('Written by your AI'), ai: true, text: notes });
  if (repeat) out.push({ id: 'repeat', title: t('Repeat issue'), source: t("From the caller's tickets"), ai: false, text: repeat.line, link: repeat.sysId ? { table: repeat.table, sysId: repeat.sysId, number: repeat.number } : null });
  return out;
}

/** The AI's notes as the card shows them and Copy copies them: without a close-code line (the code comes from ServiceNow). */
export function notesOf(plain) {
  const text = String(plain ?? '');
  return pickResolutionNotes(text) || text.trim();
}

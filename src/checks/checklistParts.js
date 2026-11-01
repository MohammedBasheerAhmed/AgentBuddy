// The AI proposal for the fulfilment checklist reads the task's own text plus the answers to the request questions. A
// catalog task does not hold the answers (its requested item does), so the panel reads the item too and merges the two here.
// Pure: no I/O. Whatever these functions return is untrusted ticket text that the firewall masks before it leaves.

import { packToParts } from '../features/parts.js';

const text = (v) => String(v ?? '').trim();

/**
 * The task's pack with the answers (and the item's name) of its requested item added. The task's own fields win; people and
 * access notes are joined so the firewall masks everyone and the panel can still say what could not be read.
 * @param {object} own ContextPack of the catalog task (or of the requested item itself)
 * @param {object | null} parent ContextPack of its requested item, when it is another record
 */
export function mergeParentPack(own, parent) {
  if (!parent || parent === own) return own;
  const people = [...(own.people || [])];
  for (const p of parent.people || []) if (!people.some((q) => text(q.name).toLowerCase() === text(p.name).toLowerCase() && text(q.name))) people.push(p);
  const fields = { ...own.fields };
  if (parent.fields?.cat_item && !fields.cat_item) fields.cat_item = parent.fields.cat_item;
  return {
    ...own,
    fields,
    people,
    related: { ...(own.related || {}), ...(parent.related?.variables ? { variables: parent.related.variables } : {}) },
    access: [...(own.access || []), ...(parent.access || [])],
  };
}

/**
 * Parts for 'fulfilment-checklist': the ordinary fields (no notes) and the answers, one line each in one part (a block per answer
 * cost more in wrappers than the answers themselves).
 */
export function checklistParts(pack) {
  // The assignee and the person who opened it are known to the firewall (the pack holds them) but are not sent as fields.
  const parts = packToParts(pack, { journal: 0, journalTypes: [], skipFields: ['assigned_to', 'opened_by'] });
  const answers = Array.isArray(pack?.related?.variables) ? pack.related.variables : [];
  const lines = [];
  for (const a of answers) {
    const question = text(a?.question);
    const value = text(a?.value);
    // One line per answer: a multi-line answer is squeezed, so it cannot start a line that looks like another question.
    if (question && value) lines.push(`- ${question.replace(/\s+/g, ' ')}: ${value.replace(/\s+/g, ' ')}`);
  }
  if (lines.length) parts.push({ label: 'Answers to the request questions', field: 'variables', text: lines.join('\n') });
  return parts;
}

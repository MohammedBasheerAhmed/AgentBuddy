// Turn a ContextPack (src/context) into the untrusted "parts" the firewall wraps and masks, and collect everyone whose
// name must be masked. Pure. Only data already on the pack is used, and the pack only holds allowlisted fields.

const LABELS = {
  number: 'Number',
  short_description: 'Short description',
  description: 'Description',
  state: 'State',
  priority: 'Priority',
  impact: 'Impact',
  urgency: 'Urgency',
  category: 'Category',
  subcategory: 'Subcategory',
  assignment_group: 'Assignment group',
  assigned_to: 'Assigned to',
  caller_id: 'Caller',
  opened_by: 'Opened by',
  requested_for: 'Requested for',
  contact: 'Contact',
  account: 'Account',
  cmdb_ci: 'Configuration item',
  business_service: 'Business service',
  opened_at: 'Opened',
  resolved_at: 'Resolved',
  close_code: 'Close code',
  close_notes: 'Close notes',
  contact_type: 'Contact type',
  cat_item: 'Catalog item',
  stage: 'Stage',
  due_date: 'Due date',
  product: 'Product',
  type: 'Type',
  risk: 'Risk',
};

export const labelFor = (field) => LABELS[field] || String(field).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * @param {object} pack ContextPack
 * @param {{ journal?: number, skipFields?: string[], journalTypes?: string[] }} [options]
 * @returns {Array<{ label: string, field: string, text: string }>}
 */
export function packToParts(pack, { journal = 12, skipFields = [], journalTypes } = {}) {
  const parts = [];
  Object.entries(pack?.fields || {}).forEach(([field, value]) => {
    const text = String(value ?? '').trim();
    if (!text || skipFields.includes(field)) return;
    parts.push({ label: labelFor(field), field, text });
  });

  let entries = Array.isArray(pack?.journal) ? pack.journal : [];
  if (journalTypes) entries = entries.filter((e) => journalTypes.includes(e.type));
  // Newest entries matter most; keep them in chronological order for reading.
  // (slice(-0) would keep everything, so a depth of 0 is handled on its own.)
  entries = journal > 0 ? entries.slice(-journal) : [];
  entries.forEach((e) => {
    const text = String(e.text ?? '').trim();
    if (!text) return;
    // The author goes inside the masked text, not in the label, so a name can never slip out through trusted markup.
    const kind = e.type === 'work_note' ? 'Work note' : 'Customer-visible comment';
    parts.push({ label: kind, field: e.type === 'work_note' ? 'work_notes' : 'comments', text: `[${e.when || ''}] ${e.by || 'Unknown'}: ${text}` });
  });
  return parts;
}

/** Everyone whose name/email must be masked: the pack's people plus every journal author. */
export function peopleFor(pack) {
  const byKey = new Map();
  const out = [];
  const add = (p) => {
    if (!p.name && !p.email) return;
    // The same person appears as caller, as journal author, as assignee: one entry, with the email if any source had it.
    const key = (p.name || p.email).toLowerCase();
    const known = byKey.get(key);
    if (known) {
      if (!known.email && p.email) known.email = p.email;
      return;
    }
    const copy = { ...p };
    byKey.set(key, copy);
    out.push(copy);
  };
  (pack?.people || []).forEach(add);
  (pack?.journal || []).forEach((e) => e.by && add({ role: 'author', name: e.by }));
  return out;
}

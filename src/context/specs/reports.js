// Context specs for the reports area (see docs/contracts.md, "Context specs").
//
// Only the coaching snapshot needs one: it is the one report feature that reads the text of tickets (the shift handover and
// "Explain this dashboard" work from numbers the reports engine already produced). It reads, for tickets a group resolved:
// the number, the closing information, the resolution date and the people on the ticket (the people only so the firewall
// can mask their names; they are never sent as authors or subjects). It does NOT read descriptions, short descriptions, work
// notes, priorities, groups or SLAs. Customer-visible comments are read through the journal switch below, by
// src/reports/engine/coaching.js, which keeps only the ones an agent of the chosen group wrote and drops their author names.
// HR-family tables are not offered to coaching at all (the engine's table list has none, and the request check refuses them).
const PEOPLE = ['caller_id', 'requested_for', 'contact', 'consumer', 'opened_by', 'requested_by', 'assigned_to'];

export default {
  spec: {
    'coaching-snapshot': {
      common: ['number', 'resolved_at', 'closed_at', 'close_code', 'close_notes', ...PEOPLE],
      by: { problem: ['resolution_code'], case: ['resolution_code'] },
    },
  },
  journal: { 'coaching-snapshot': true },
  related: { 'coaching-snapshot': [] },
  fieldsByKind: {},
  extendFields: {},
};

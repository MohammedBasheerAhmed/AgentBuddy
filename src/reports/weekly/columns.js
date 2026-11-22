// The columns the weekly views ask ServiceNow for, and why (docs/build-rules.md rule 8: the allowlist is the contract). Everything is a
// GET through the reports engine's reader (src/reports/engine/reader.js), with the person's own session; nothing here is stored.
// tests/round5-weekly-read.test.js fails when a read asks for a column that is not on this list.
//
// The ticket tables' own columns come from the engine's table list (src/reports/engine/constants.js): `opened_at`, the closed date
// (`resolved_at`, else `closed_at`), `category`, `cmdb_ci`, `reopen_count`, `assigned_to`. This list holds the columns the weekly views
// add to those, and the other tables they read.
export const WEEKLY_COLUMNS = Object.freeze({
  // The ticket tables, for what each number is.
  tickets: Object.freeze({
    sys_id: 'tells one ticket from another (the SLA and comment reads are by id); never shown',
    number: 'the ticket number: the oldest open tickets in the PDF, the reopened tickets of "My week", the numbers the AI line is written from',
    short_description: 'the oldest open tickets of the PDF (one line a person recognises it by); never sent to the AI',
    opened_at: 'came in this week; the time to resolve; the first reply counts from it',
    sys_class_name: 'which type an oldest-open ticket is (its link)',
    resolved_at: 'closed this week (incidents, cases, problems)',
    closed_at: 'closed this week (every other type)',
    reopen_count: 'closed tickets that came back (incidents): a count, nothing else',
    category: 'the area a closed ticket belongs to ("where the week went")',
    cmdb_ci: 'tickets that share one configuration item (one likely cause)',
    assigned_to: 'how the open tickets are spread over people (counted, never named)',
    close_notes: 'whether a fix note was written: asked ONLY as "is empty", so no note text is read (docs/live-questions/weekly.md question 6)',
    'caller_id.user_name': 'the customer\'s login, to tell the customer\'s own comment from a reply (kept in the content script, never returned); other types name their own customer column (src/mywork/tables.js)',
  }),
  // task_sla: one SLA of one ticket.
  task_sla: Object.freeze({
    task: 'which ticket the SLA belongs to',
    has_breached: 'was it breached: the share of SLAs kept',
    stage: 'a cancelled or paused SLA is not counted',
    planned_end_time: 'the week an SLA came due in',
    percentage: 'the oldest open tickets of the PDF say whether their SLA is at risk (the same line My work draws)',
    business_percentage: 'the same, in business time',
    sla: 'the same (the row\'s own name, as the other SLA reads ask it)',
    active: 'the oldest open tickets of the PDF: the SLAs still running',
  }),
  // sys_journal_field: only WHO wrote and WHEN, never the text (as My work reads it).
  sys_journal_field: Object.freeze({
    element: 'only the customer-visible comments (element = comments)',
    element_id: 'which ticket the comment is on',
    sys_created_on: 'when it was written: the first reply',
    sys_created_by: 'who wrote it (a login), to tell the customer from the person who answered',
  }),
  sys_user: Object.freeze({ time_zone: 'the person\'s own time zone, so the week is theirs (src/reports/engine/constants.js USER_ZONE_FIELDS)' }),
});

/** Every column name the weekly views may ask for, across all tables. */
export const ALLOWED_WEEKLY_COLUMNS = Object.freeze(
  new Set([...Object.keys(WEEKLY_COLUMNS.tickets), ...Object.keys(WEEKLY_COLUMNS.task_sla), ...Object.keys(WEEKLY_COLUMNS.sys_journal_field), ...Object.keys(WEEKLY_COLUMNS.sys_user)])
);

/** Is this column one the weekly views may ask for? A customer column of another type ('requested_for.user_name') passes as the customer login. */
export const isAllowedWeeklyColumn = (name) => ALLOWED_WEEKLY_COLUMNS.has(name) || /^[a-z_.]+\.user_name$/.test(String(name));

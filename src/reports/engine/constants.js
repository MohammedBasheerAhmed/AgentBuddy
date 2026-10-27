// What the reports engine knows about the tables it may read, and the fixed numbers it works with.
//
// Reports read only aggregates and a few columns per table, always with the person's own session (ACLs decide what comes
// back). This is the whole list of columns they ever ask for; nothing here is sent anywhere.
import { AT_RISK_PERCENT } from '../myDay.js';

/**
 * The ticket tables a report can cover. `resolvedFields` are tried in order: the first one that exists on the instance is
 * the "resolved or closed at" column. `quality` says which extra columns that table offers to the Quality section.
 */
export const REPORT_TABLES = Object.freeze({
  incident: {
    label: 'Incidents',
    singular: 'incident',
    resolvedFields: ['resolved_at', 'closed_at'],
    quality: { category: 'category', ci: 'cmdb_ci', caller: 'caller_id', reopen: 'reopen_count', reassign: 'reassignment_count' },
    optional: ['reassignment_count', 'reopen_count', 'resolved_at', 'closed_at', 'category', 'cmdb_ci', 'caller_id'],
  },
  sc_req_item: {
    label: 'Requested items',
    singular: 'requested item',
    resolvedFields: ['closed_at'],
    quality: {},
    optional: ['closed_at', 'reassignment_count'],
  },
  sc_task: {
    label: 'Catalog tasks',
    singular: 'catalog task',
    resolvedFields: ['closed_at'],
    quality: {},
    optional: ['closed_at', 'reassignment_count'],
  },
  sn_customerservice_case: {
    label: 'Cases',
    singular: 'case',
    resolvedFields: ['resolved_at', 'closed_at'],
    quality: { category: 'category' },
    optional: ['reassignment_count', 'resolved_at', 'closed_at', 'category'],
  },
  problem: {
    label: 'Problems',
    singular: 'problem',
    resolvedFields: ['resolved_at', 'closed_at'],
    quality: { category: 'category', ci: 'cmdb_ci' },
    optional: ['reassignment_count', 'resolved_at', 'closed_at', 'category', 'cmdb_ci'],
  },
  change_request: {
    label: 'Changes',
    singular: 'change',
    resolvedFields: ['closed_at'],
    quality: { category: 'category', ci: 'cmdb_ci' },
    optional: ['reassignment_count', 'closed_at', 'category', 'cmdb_ci'],
  },
});

export const REPORT_TABLE_IDS = Object.freeze(Object.keys(REPORT_TABLES));

export const tableLabel = (table) => REPORT_TABLES[table]?.label || table;

/** Columns on every ticket row the engine reads (all are columns of the task table). */
export const TICKET_FIELDS = Object.freeze(['sys_id', 'number', 'short_description', 'priority', 'state', 'assigned_to', 'assignment_group', 'opened_at', 'sys_updated_on', 'sys_class_name']);

// Ageing buckets by whole days since a ticket was opened. `from` is inclusive, `to` exclusive (null = no end).
export const AGE_BUCKETS = Object.freeze([
  { key: 'd0-1', label: '0-1 days', from: 0, to: 2 },
  { key: 'd2-3', label: '2-3 days', from: 2, to: 4 },
  { key: 'd4-7', label: '4-7 days', from: 4, to: 8 },
  { key: 'd8-14', label: '8-14 days', from: 8, to: 15 },
  { key: 'd15+', label: '15+ days', from: 15, to: null },
]);

export const LIMITS = Object.freeze({
  // Parallel requests to the instance, shared by everything the page is asked for.
  concurrency: 4,
  // How long one section may take before the rest of its numbers are given up on.
  sectionTimeoutMs: 45000,
  cacheTtlMs: 60000,
  cacheEntries: 400,
  // Rows per page and the most rows one date read may take.
  pageSize: 1000,
  dateRowsMax: 3000,
  // SLA rows read in one go, and how many tickets get their details looked up.
  slaRowsMax: 1000,
  slaTicketsMax: 200,
  maxGroups: 25,
  maxTables: 6,
  topN: 10,
  // At or above this share of its time used, an SLA is "at risk" (the same line My Day draws).
  slaAtRiskPercent: AT_RISK_PERCENT,
  dueSoonHours: 4,
  staleDays: 3,
  repeatCallerMin: 3,
  repeatCallerDays: 30,
  pingPongMin: 3,
});

/** The scopes a person can pick. */
export const SCOPE_KINDS = Object.freeze(['mine', 'groups', 'chosen']);

/** Section ids the engine can run (the panel's registry in src/sidepanel/reports/sections.js uses the same ids). */
export const SECTION_IDS = Object.freeze(['overview', 'workload', 'sla', 'quality', 'fulfilment']);

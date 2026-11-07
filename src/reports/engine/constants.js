// What the reports engine knows about the tables it may read, and the fixed numbers it works with.
//
// Reports read only aggregates and a few columns per table, always with the person's own session (ACLs decide what comes
// back). This is the whole list of columns they ever ask for; nothing here is sent anywhere.
import { AT_RISK_PERCENT } from '../myDay.js';
import { tm } from './say.js';
import { tableLabel } from '../../lib/tableLabels.js';

// The words of a table the reports added later (audit of 2026-11-07, F20): the shared label, in English, as everywhere else in the engine.
const words = (table, options = {}) => tableLabel(table, { english: true, ...options });
// What a task table offers: the closing time and the reassignment count (columns of every task), nothing for the Quality section.
const taskTable = (table, extra = {}) => ({
  label: words(table, { plural: true, sentenceCase: true }),
  singular: words(table),
  resolvedFields: ['closed_at'],
  quality: {},
  optional: ['closed_at', 'reassignment_count'],
  ...extra,
});

/**
 * The ticket tables a report can cover. `resolvedFields` are tried in order: the first one that exists on the instance is
 * the "resolved or closed at" column. `quality` says which extra columns that table offers to the Quality section.
 */
export const REPORT_TABLES = Object.freeze({
  incident: {
    label: tm('Incidents'),
    singular: 'incident',
    resolvedFields: ['resolved_at', 'closed_at'],
    quality: { category: 'category', ci: 'cmdb_ci', caller: 'caller_id', reopen: 'reopen_count', reassign: 'reassignment_count' },
    optional: ['reassignment_count', 'reopen_count', 'resolved_at', 'closed_at', 'category', 'cmdb_ci', 'caller_id'],
  },
  sc_req_item: {
    label: tm('Requested items'),
    singular: 'requested item',
    resolvedFields: ['closed_at'],
    quality: {},
    optional: ['closed_at', 'reassignment_count'],
  },
  sc_task: {
    label: tm('Catalog tasks'),
    singular: 'catalog task',
    resolvedFields: ['closed_at'],
    quality: {},
    optional: ['closed_at', 'reassignment_count'],
  },
  sn_customerservice_case: {
    label: tm('Cases'),
    singular: 'case',
    resolvedFields: ['resolved_at', 'closed_at'],
    quality: { category: 'category' },
    optional: ['reassignment_count', 'resolved_at', 'closed_at', 'category'],
  },
  problem: {
    label: tm('Problems'),
    singular: 'problem',
    resolvedFields: ['resolved_at', 'closed_at'],
    quality: { category: 'category', ci: 'cmdb_ci' },
    optional: ['reassignment_count', 'resolved_at', 'closed_at', 'category', 'cmdb_ci'],
  },
  change_request: {
    label: tm('Changes'),
    singular: 'change',
    resolvedFields: ['closed_at'],
    quality: { category: 'category', ci: 'cmdb_ci' },
    optional: ['reassignment_count', 'closed_at', 'category', 'cmdb_ci'],
  },
  // The work a change is split into: what implementers and change leads hold day to day.
  change_task: {
    label: tm('Change tasks'),
    singular: 'change task',
    resolvedFields: ['closed_at'],
    quality: {},
    optional: ['closed_at', 'reassignment_count'],
  },
  // The requests that hold requested items, and the tasks of an incident, a problem, a case and an HR case: what a lead of a group that works
  // them day to day sees nothing of otherwise. (Other task classes, a custom one for instance, are counted by the fulfilment section.)
  sc_request: taskTable('sc_request'),
  incident_task: taskTable('incident_task'),
  problem_task: taskTable('problem_task'),
  sn_customerservice_task: taskTable('sn_customerservice_task'),
  // HR cases (sn_hr_core_case and its child tables, which the Aggregate API counts with it). SENSITIVE: offered only when the
  // person works with the HR profile and the organisation's policy allows HR content (the panel asks with allowSensitive, the
  // content script lowers that unless the managed policy agrees). Never offered to coaching.
  sn_hr_core_case: {
    label: tm('HR cases'),
    singular: 'HR case',
    resolvedFields: ['closed_at'],
    quality: {},
    optional: ['closed_at', 'reassignment_count'],
    sensitive: true,
  },
  // The tasks of an HR case: SENSITIVE like the case.
  sn_hr_core_task: taskTable('sn_hr_core_task', { sensitive: true }),
});

export const REPORT_TABLE_IDS = Object.freeze(Object.keys(REPORT_TABLES));

/**
 * A table in the middle of a report sentence, in English, plural and lower case ('incidents', 'SLAs', 'catalog tasks'): the report's
 * own word for the eight report tables, the shared label (src/lib/tableLabels.js) for any other. The engine writes English and the
 * panel shows it in its language (src/reports/shown.js), so a raw table name must never be put into a sentence.
 */
export const tableWords = (table) => REPORT_TABLES[String(table)]?.label.toLowerCase() || tableLabel(table, { plural: true, english: true });

/** Is this report table sensitive (HR family)? Its own flag, the `sn_hr_` prefix, or a prefix the organisation's policy adds. */
export function isSensitiveReportTable(table, prefixes = []) {
  const name = String(table || '').toLowerCase();
  if (REPORT_TABLES[name]?.sensitive) return true;
  return ['sn_hr_', ...(Array.isArray(prefixes) ? prefixes : [])].some((p) => typeof p === 'string' && p && name.startsWith(p.toLowerCase()));
}

/** The report tables anyone may be offered: every one that is not sensitive. */
export const STANDARD_TABLE_IDS = Object.freeze(REPORT_TABLE_IDS.filter((t) => !isSensitiveReportTable(t)));

/**
 * The one column of the signed-in person's OWN user record the reports read: their ServiceNow time zone, so 'today' and 'this week'
 * are their days (src/content/ops/reports.js readUserZone; a soft read, the browser's zone when it fails).
 */
export const USER_ZONE_FIELDS = Object.freeze(['sys_id', 'time_zone']);

/** Columns on every ticket row the engine reads (all are columns of the task table). */
export const TICKET_FIELDS = Object.freeze(['sys_id', 'number', 'short_description', 'priority', 'state', 'assigned_to', 'assignment_group', 'opened_at', 'sys_updated_on', 'sys_class_name']);

// Ageing buckets by whole days since a ticket was opened. `from` is inclusive, `to` exclusive (null = no end).
export const AGE_BUCKETS = Object.freeze([
  { key: 'd0-1', label: tm('0-1 days'), from: 0, to: 2 },
  { key: 'd2-3', label: tm('2-3 days'), from: 2, to: 4 },
  { key: 'd4-7', label: tm('4-7 days'), from: 4, to: 8 },
  { key: 'd8-14', label: tm('8-14 days'), from: 8, to: 15 },
  { key: 'd15+', label: tm('15+ days'), from: 15, to: null },
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
  // A scope holds at most this many groups (the query stays short); a person's memberships are read up to membershipMax.
  maxGroups: 25,
  membershipMax: 200,
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

/**
 * Section ids the panel's registry (src/sidepanel/reports/sections.js) and a saved dashboard can hold. The engine runs the first
 * seven (SECTIONS in ./index.js; 'attention' is composed from what the others read). 'coaching' and 'insights' have no engine section:
 * they are panel sections that build their own input (a separate read operation for coaching, the widgets' loaded results for
 * insights), so runReport refuses those two ids.
 */
export const SECTION_IDS = Object.freeze(['attention', 'overview', 'workload', 'sla', 'quality', 'fulfilment', 'handover', 'coaching', 'insights']);

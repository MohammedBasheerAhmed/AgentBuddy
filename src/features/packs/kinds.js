// Record-kind groups shared by the feature packs.
// (core.js, not index.js: the service worker loads this file through features/visibility.js and carries no Arabic catalogue; the panel registers
// the catalogue on the same core, so the label below is still shown in the person's language there.)
import { t } from '../../i18n/core.js';

export const ALL_TASKS = ['incident', 'problem', 'change', 'request', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task', 'other'];
export const WORKABLE = ['incident', 'problem', 'request', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task'];
export const CUSTOMER_FACING = ['incident', 'request', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task'];
// Where "Additional comments" reaches the person who raised the ticket (audit of 2026-11-07, W-02): on an incident, a request, a requested
// item and a case (the customer service and HR cases too). On a catalog task, or any other task, the requester is assumed NOT to see
// them (src/insights/stages.js assumes it too), so a draft for the customer goes into the work notes there and the comment is the second
// choice, said to be one the requester may not see. A problem has no customer at all: nothing is offered for one (stages.js hasCustomer).
export const CUSTOMER_COMMENT_KINDS = ['incident', 'request', 'requested_item', 'case', 'hr_case'];
export const NOTE_FIRST_KINDS = ['catalog_task', 'task'];
/**
 * The label of the comment choice on a task: "Insert as a comment (the requester may not see it)", or, on a catalog task whose opener is the
 * requester (who can then read its comments: src/domain/requesterReads.js), "(the requester can read it)". A feature's insert carries it as
 * `label` (the careful one) and `labelFor` (the one the ticket's own read decides); the Insert path asks labelFor with the ticket's
 * requesterCanRead: true, false or null (not known), and null or false keep the careful words.
 */
export const requesterCommentLabel = (requesterCanRead = null) =>
  requesterCanRead === true ? t('Insert as a comment (the requester can read it)') : t('Insert as a comment (the requester may not see it)');
// A change has no customer to reply to (its requester is not waiting for an answer on it), but the next person on it needs a hand-off (W-10).
export const HANDOFF_KINDS = [...WORKABLE, 'change'];
// The kinds whose form has a notes box for how it ended: close_notes. A request has none on its ceiling; a problem has cause_notes and fix_notes
// instead. HR cases and changes have close_notes (W-09, W-10; whether an HR form calls it that is docs/live-questions/audit-1107-fit.md, 4).
export const CLOSE_NOTES_KINDS = ['incident', 'problem', 'change', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task'];

// A Customer Service case: account, contact (a sys_user row), product, entitlement, SLAs and a child task.

import { v } from './sn-fakeDeps.js';
import { BETH, ERIN } from './sn-users.js';

export const CASE_ID = '0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d';
export const CASE_NUMBER = 'CS0001001';

const GROUP_SUPPORT = v('9f8e7d6c5b4a43928170615243342516', 'Customer Support L2');

export function caseRow() {
  return {
    sys_id: v(CASE_ID),
    number: v(CASE_NUMBER),
    short_description: v('Cloud Gateway returns 502 for Acme Corp users'),
    description: v('<p>Erin from Acme reports intermittent 502 errors since the weekend. Reach her at erin@acme.example.com or +1 555-0177.</p>'),
    state: v('10', 'Open'),
    priority: v('2', '2 - High'),
    category: v('technical', 'Technical'),
    subcategory: v('api', 'API'),
    account: v('acct1', 'Acme Corp'),
    contact: v(ERIN.sysId, ERIN.name),
    consumer: v('', ''),
    product: v('prod1', 'Cloud Gateway'),
    asset: v('', ''),
    entitlement: v('ent1', 'Gold Support'),
    cmdb_ci: v('', ''),
    assignment_group: GROUP_SUPPORT,
    assigned_to: v(BETH.sysId, BETH.name),
    opened_by: v(BETH.sysId, BETH.name),
    opened_at: v('2026-10-25 09:00:00', '2026-10-25 11:00:00'),
    sys_updated_on: v('2026-10-26 09:00:00', '2026-10-26 11:00:00'),
    resolved_at: v('', ''),
    resolution_code: v('', ''),
    close_notes: v('', ''),
    contact_type: v('email', 'Email'),
    parent: v('', ''),
    // Not on any allowlist:
    u_internal_risk_score: v('RISK-LEAK-87'),
    u_account_arr: v('1200000', 'ARR-LEAK'),
    sys_created_by: v(BETH.login),
    comments: v('', '2026-10-26 10:00:00 - Beth Anglin (Additional comments)\nHi Erin, we are investigating the 502 errors.'),
    work_notes: v('', '2026-10-26 10:30:00 - Beth Anglin (Work notes)\nUpstream pool shows 2 unhealthy nodes. Escalating to platform.'),
  };
}

export function caseSlaRows() {
  return [
    {
      sys_id: v('csla1'),
      task: v(CASE_ID, CASE_NUMBER),
      sla: v('sladefc1', 'Gold response 1 hour'),
      stage: v('in_progress', 'In progress'),
      has_breached: v('true', 'true'),
      percentage: v('140'),
      business_percentage: v('130'),
      planned_end_time: v('2026-10-25 10:00:00', '2026-10-25 12:00:00'),
      sys_created_on: v('2026-10-25 09:00:01'),
    },
  ];
}

export function caseTables() {
  return { sn_customerservice_case: [caseRow()], task_sla: caseSlaRows() };
}

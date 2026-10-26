// An HR case: everything in it is sensitive, so a pack built without { allowSensitive: true } must carry none of the
// free text or identities below.

import { v } from './sn-fakeDeps.js';
import { HANA, JANE } from './sn-users.js';

export const HR_CASE_ID = 'd3e4f5a6b7c84d9e0f1a2b3c4d5e6f70';
export const HR_CASE_NUMBER = 'HRC0001001';

export const HR_SECRET_TEXT = 'maternity leave';

export function hrCaseRow() {
  return {
    sys_id: v(HR_CASE_ID),
    number: v(HR_CASE_NUMBER),
    short_description: v('Maternity leave request for Jane Doe'),
    description: v('<p>Jane Doe (jane.doe@example.com) is requesting maternity leave from 2027-01-10. Doctor note attached; medical details in the private note.</p>'),
    state: v('10', 'Open'),
    priority: v('3', '3 - Moderate'),
    hr_service: v('svc1', 'Parental Leave'),
    subject_person: v(JANE.sysId, JANE.name),
    opened_for: v(JANE.sysId, JANE.name),
    opened_by: v(JANE.sysId, JANE.name),
    assignment_group: v('hrgrp1', 'HR Benefits'),
    assigned_to: v(HANA.sysId, HANA.name),
    opened_at: v('2026-10-20 08:00:00', '2026-10-20 10:00:00'),
    sys_updated_on: v('2026-10-25 08:00:00', '2026-10-25 10:00:00'),
    resolved_at: v('', ''),
    close_notes: v('', ''),
    // Not on any allowlist:
    u_salary_band: v('SALARY-LEAK-L5'),
    u_medical_notes: v('Medical details SHOULD NEVER APPEAR'),
    comments: v('', '2026-10-21 09:00:00 - Hana Rivera (Additional comments)\nHi Jane, your leave starts 2027-01-10.'),
    work_notes: v('', '2026-10-21 09:05:00 - Hana Rivera (Work notes)\nDoctor note says high-risk pregnancy; handle with care.'),
  };
}

export function hrCaseSlaRows() {
  return [
    {
      sys_id: v('hsla1'),
      task: v(HR_CASE_ID, HR_CASE_NUMBER),
      sla: v('sladefh1', 'HR response 3 days'),
      stage: v('in_progress', 'In progress'),
      has_breached: v('false', 'false'),
      percentage: v('20'),
      business_percentage: v('15'),
      planned_end_time: v('2026-10-27 08:00:00', '2026-10-27 10:00:00'),
      sys_created_on: v('2026-10-20 08:00:01'),
    },
  ];
}

/** An older HR case of the same person, for the history tests. */
export function hrHistoryRow() {
  return {
    sys_id: v('d3e4f5a6b7c84d9e0f1a2b3c4d5e6f71'),
    number: v('HRC0000900'),
    short_description: v('Address change for Jane Doe'),
    state: v('3', 'Closed Complete'),
    active: v('false'),
    opened_for: v(JANE.sysId, JANE.name),
    opened_at: v('2026-03-01 08:00:00'),
    resolved_at: v('2026-03-02 08:00:00'),
    close_notes: v('Updated the address in the HR profile.'),
  };
}

export function hrCaseTables() {
  return { sn_hr_core_case: [hrCaseRow(), hrHistoryRow()], task_sla: hrCaseSlaRows() };
}

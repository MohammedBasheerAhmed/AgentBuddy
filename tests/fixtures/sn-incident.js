// An incident with PII in its text, the notes that go with it (as sys_journal_field rows AND as the record's own
// display strings), SLAs, a child task, the caller's earlier tickets, other people's similar tickets and KB articles.
// Today in these fixtures is 2026-10-26 12:00 UTC. The instance shows times two hours ahead (UTC+2) in display values.

import { v } from './sn-fakeDeps.js';
import { ABEL, BETH, CHARLIE, MARIA } from './sn-users.js';

export const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);

export const INCIDENT_ID = '9de5069c5afe602b2d6d343a7c50b3e4';
export const INCIDENT_NUMBER = 'INC0010001';

const GROUP_NETWORK = v('d625dccec0a8016700a222a0f7900d06', 'Network Support');
const CI_VPN_EU = v('0c1d2e3f4a5b4c6d8e7f9a0b1c2d3e4f', 'VPN Gateway EU');
const SERVICE_REMOTE = v('1d2e3f4a5b6c4d7e8f9a0b1c2d3e4f50', 'Remote Access');

const stamp = (utc) => {
  // Display value of a stored UTC time for a user at UTC+2.
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  return new Date(d.getTime() + 2 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
};
const time = (utc) => v(utc, utc ? stamp(utc) : '');

export const COMMENTS_STRING = [
  '2026-10-26 10:20:41 - Beth Anglin (Additional comments)',
  'Hi Abel, I can see the gateway logs. Could you send me your client version? Call me on 555-0199 if easier.',
  '',
  '2026-10-26 09:58:03 - Abel Tuter (Additional comments)',
  'It dropped again at 09:50. Same as yesterday.',
].join('\n');

export const WORK_NOTES_STRING = [
  '2026-10-26 10:25:00 - Beth Anglin (Work notes)',
  "Gateway EU-2 shows 14 session resets. Checking certificate expiry. Customer's manager is María-José O'Neil.",
].join('\n');

/** The full incident row, with columns that are NOT on any allowlist (they must never reach a pack). */
export function incidentRow() {
  return {
    sys_id: v(INCIDENT_ID),
    number: v(INCIDENT_NUMBER),
    short_description: v('VPN keeps disconnecting for Abel Tuter (abel.tuter@example.com)'),
    description: v(
      '<p>Hi, my VPN drops every 10 minutes since Monday.</p><p>Please call me on +1 555-0134. My employee id is E12345 &amp; I am on the <b>London</b> VPN profile.</p>'
    ),
    state: v('2', 'In Progress'),
    hold_reason: v('', ''),
    priority: v('2', '2 - High'),
    impact: v('2', '2 - Medium'),
    urgency: v('2', '2 - Medium'),
    category: v('network', 'Network'),
    subcategory: v('vpn', 'VPN'),
    assignment_group: GROUP_NETWORK,
    assigned_to: v(BETH.sysId, BETH.name),
    caller_id: v(ABEL.sysId, ABEL.name),
    opened_by: v(ABEL.sysId, ABEL.name),
    cmdb_ci: CI_VPN_EU,
    business_service: SERVICE_REMOTE,
    opened_at: time('2026-10-26 07:55:12'),
    sys_updated_on: time('2026-10-26 08:25:00'),
    resolved_at: v('', ''),
    close_code: v('', ''),
    close_notes: v('', ''),
    contact_type: v('phone', 'Phone'),
    parent: v('', ''),
    // Not on any allowlist:
    u_employee_id: v('EMP-LEAK-1'),
    u_ssn_last4: v('SSN-LEAK-2'),
    watch_list: v(`${ABEL.sysId},${MARIA.sysId}`, `${ABEL.name}, ${MARIA.name}`),
    work_notes_list: v(BETH.sysId, BETH.name),
    location: v('c3b2a1', 'LOCATION-LEAK London HQ'),
    sys_created_by: v(ABEL.login),
    correlation_id: v('CORR-LEAK-3'),
    comments_and_work_notes: v('', 'SHOULD NEVER APPEAR'),
    comments: v('', COMMENTS_STRING),
    work_notes: v('', WORK_NOTES_STRING),
  };
}

/** sys_journal_field rows: raw UTC times, logins as authors, rich text wrapped in [code]. */
export function journalRows() {
  const row = (n, element, when, by, value) => ({ sys_id: `j${n}`, name: 'incident', element_id: INCIDENT_ID, element, sys_created_on: when, sys_created_by: by, value });
  return [
    row(1, 'comments', '2026-10-26 07:58:03', ABEL.login, 'It dropped again at 09:50. Same as yesterday.'),
    row(2, 'comments', '2026-10-26 08:20:41', BETH.login, '[code]<p>Hi Abel, I can see the gateway logs.</p><p>Could you send me your client version? Call me on 555-0199 if easier.</p>[/code]'),
    row(3, 'work_notes', '2026-10-26 08:25:00', BETH.login, "Gateway EU-2 shows 14 session resets.&nbsp;Checking certificate expiry. Customer's manager is María-José O&#39;Neil."),
    // Another record's note: must be ignored.
    { sys_id: 'j9', name: 'incident', element_id: 'ffffffffffffffffffffffffffffffff', element: 'comments', sys_created_on: '2026-10-26 08:30:00', sys_created_by: CHARLIE.login, value: 'not this record' },
  ];
}

export function slaRows() {
  const row = (n, sla, stage, breached, pct, bpct, end) => ({
    sys_id: v(`sla${n}`),
    task: v(INCIDENT_ID, INCIDENT_NUMBER),
    sla: v(`sladef${n}`, sla),
    stage: v(stage.toLowerCase().replace(' ', '_'), stage),
    has_breached: v(String(breached), breached ? 'true' : 'false'),
    percentage: v(String(pct)),
    business_percentage: v(String(bpct)),
    planned_end_time: time(end),
    sys_created_on: time('2026-10-26 07:55:13'),
  });
  return [
    row(1, 'P2 resolution 8 hours', 'In progress', false, 118, 62, '2026-10-26 17:55:12'),
    row(2, 'P2 response 2 hours', 'Achieved', false, 100, 40, '2026-10-26 09:55:12'),
    // An SLA of another task: must be ignored if it ever appears.
  ];
}

export function taskRows() {
  return [
    {
      sys_id: v('task1'),
      number: v('TASK0010005'),
      sys_class_name: v('incident_task', 'Incident Task'),
      short_description: v('Check gateway certificate'),
      state: v('1', 'Open'),
      assigned_to: v(BETH.sysId, BETH.name),
      assignment_group: GROUP_NETWORK,
      active: v('true', 'true'),
      parent: v(INCIDENT_ID, INCIDENT_NUMBER),
      sys_created_on: time('2026-10-26 08:30:00'),
    },
    {
      sys_id: v('task2'),
      number: v('TASK0010099'),
      sys_class_name: v('incident_task', 'Incident Task'),
      short_description: v('A different incident task'),
      state: v('1', 'Open'),
      assigned_to: v('', ''),
      assignment_group: v('', ''),
      active: v('true', 'true'),
      parent: v('ffffffffffffffffffffffffffffffff', 'INC9999999'),
      sys_created_on: time('2026-10-26 08:31:00'),
    },
  ];
}

// ---- Other tickets ------------------------------------------------------------------------------------

let counter = 0;
function ticket({ number, desc, opened, resolved = '', state = 'Closed', code = '', notes = '', category = 'Network', ci = CI_VPN_EU, caller = ABEL, active = false, group = GROUP_NETWORK, extra = {} }) {
  counter += 1;
  const stateValue = { Closed: '7', Resolved: '6', 'In Progress': '2', New: '1' }[state] || '2';
  return {
    sys_id: v(`1c0${counter.toString(16).padStart(29, '0')}`),
    number: v(number),
    short_description: v(desc),
    state: v(stateValue, state),
    active: v(String(active), String(active)),
    caller_id: v(caller.sysId, caller.name),
    category: v(category.toLowerCase(), category),
    cmdb_ci: ci ? ci : v('', ''),
    business_service: SERVICE_REMOTE,
    assignment_group: group,
    opened_at: time(opened),
    resolved_at: time(resolved),
    close_code: v(code.toLowerCase(), code),
    close_notes: v(notes),
    sys_updated_on: time(resolved || opened),
    ...extra,
  };
}

/** Incidents of the caller (Abel) and of other people, in the incident table. The first fixture row is the open one. */
export function otherIncidentRows() {
  counter = 0;
  return [
    // Abel's own history
    ticket({ number: 'INC0009001', desc: 'VPN keeps disconnecting on home wifi', opened: '2026-06-02 08:00:00', resolved: '2026-06-03 10:00:00', code: 'Solution provided', notes: 'Reinstalled the VPN client v5.2 and cleared the cached profile. Verified stable for 24h.' }),
    ticket({ number: 'INC0009150', desc: 'Cannot connect to VPN after password change', opened: '2026-08-11 07:30:00', resolved: '2026-08-11 12:00:00', code: 'Solution provided', notes: 'Reset the VPN token; user re-enrolled MFA.' }),
    ticket({ number: 'INC0009377', desc: 'Outlook crashes on startup', opened: '2026-09-14 09:00:00', resolved: '2026-09-14 11:00:00', code: 'Solution provided', notes: 'Repaired Office installation.', category: 'Software', ci: v('ci-outlook', 'Microsoft Outlook') }),
    ticket({ number: 'INC0009588', desc: 'VPN timeout error 619', opened: '2026-10-05 08:15:00', resolved: '2026-10-06 07:00:00', state: 'Resolved', code: 'Solution provided', notes: 'Updated gateway cipher policy; no recurrence expected.', active: true }),
    ticket({ number: 'INC0009640', desc: 'VPN disconnects every 10 minutes', opened: '2026-10-12 08:00:00', resolved: '2026-10-12 15:00:00', code: 'Solution provided', notes: 'Replaced the expired gateway certificate on EU-2.' }),
    ticket({ number: 'INC0009702', desc: 'Laptop battery drains quickly', opened: '2026-10-20 10:00:00', state: 'In Progress', active: true, category: 'Hardware', ci: v('ci-laptop', 'ThinkPad X1 (LT-4471)') }),

    // Other callers, similar problems
    ticket({ number: 'INC0008800', desc: 'VPN disconnects randomly on wifi', opened: '2026-08-30 08:00:00', resolved: '2026-09-01 09:00:00', code: 'Workaround', notes: 'Pinned the client to TCP mode via the profile; stable since.', caller: CHARLIE }),
    ticket({ number: 'INC0008812', desc: 'Slow VPN throughput to datacenter', opened: '2026-09-02 08:00:00', resolved: '2026-09-02 15:00:00', notes: '', caller: CHARLIE, ci: v('ci-vpn-us', 'VPN Gateway US') }),
    ticket({ number: 'INC0008900', desc: 'Printer queue stuck on floor 3', opened: '2026-09-05 08:00:00', resolved: '2026-09-05 09:00:00', notes: 'Cleared the spooler.', caller: CHARLIE, category: 'Hardware', ci: v('ci-printer', 'Printer 3F') }),

    // Open tickets on the same CI / service (duplicates check). now = 2026-10-26 12:00 UTC.
    ticket({ number: 'INC0010002', desc: 'Cannot reach intranet over VPN', opened: '2026-10-26 07:30:00', state: 'New', active: true, caller: CHARLIE }),
    ticket({ number: 'INC0010003', desc: 'VPN login fails with certificate error', opened: '2026-10-25 06:00:00', state: 'New', active: true, caller: MARIA }),
    ticket({ number: 'INC0010004', desc: 'Remote desktop gateway slow', opened: '2026-10-26 08:00:00', state: 'In Progress', active: true, caller: MARIA, ci: v('ci-rdp', 'RDP Gateway') }),
  ];
}

export function knowledgeRows() {
  const article = (n, number, title, text, { views = 0, base = 'IT Knowledge Base', validTo = '2027-12-31', state = 'published', updated = '2026-09-01 10:00:00' } = {}) => ({
    sys_id: v(`kb${n}`),
    number: v(number),
    short_description: v(title),
    text: v(text),
    workflow_state: v(state, state === 'published' ? 'Published' : 'Draft'),
    kb_knowledge_base: v(`kbb${n}`, base),
    view_count: v(String(views)),
    valid_to: v(validTo),
    sys_updated_on: time(updated),
  });
  return [
    article(1, 'KB0010001', 'Troubleshooting VPN disconnects', '<h2>Symptoms</h2><p>The VPN keeps disconnecting every few minutes.</p><ol><li>Check the client version</li><li>Switch the profile to TCP mode</li></ol><p>If the gateway certificate has expired, contact Network Support.</p>', { views: 482 }),
    article(2, 'KB0010002', 'VPN client installation guide', '<p>Download the client from the software portal and install it. Restart before first use.</p>', { views: 900 }),
    article(3, 'KB0010003', 'Old VPN guide (retired)', '<p>Retired VPN instructions.</p>', { views: 5000, validTo: '2024-01-01' }),
    article(4, 'KB0010004', 'How to reset your password', '<p>Use the self-service portal. Not related to remote access.</p>', { views: 100 }),
    article(5, 'KB0010005', 'VPN timeout troubleshooting (draft)', '<p>Work in progress.</p>', { views: 0, state: 'draft' }),
  ];
}

/** Rows for every table this fixture touches. */
export function incidentTables() {
  return {
    incident: [incidentRow(), ...otherIncidentRows()],
    sys_journal_field: journalRows(),
    task_sla: slaRows(),
    task: taskRows(),
    kb_knowledge: knowledgeRows(),
  };
}

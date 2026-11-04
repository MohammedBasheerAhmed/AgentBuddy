// More rows for the fake instance, for the scenarios that exercise the newer areas (ITSM and domain features, the Write tab,
// the record tabs, knowledge and chat, the team reports). It is an ES module like data.entry.js (which calls addMoreTables).
//
// WHAT IS SEEDED HERE AND WHY (every name below is also in the leak detector, e2e/leaks.js):
//   problem PRB0040001      assigned to Beth; two linked incidents; a problem task; a work note with a second card-less secret
//   change CHG0030001       requested by Dave; approvals (Charlie approved, Dave still to answer); a change task; a conflicting change
//   case CS0001001          now belongs to an account with a REAL 32-character id, and the account has two more cases
//   three incidents whose state decides which email the Write tab recommends (resolved, on hold awaiting the caller, SLA missed)
//   knowledge articles      three near-duplicates (the last has a person's name, email and phone in its text), two others, in a base
//                           that has real 32-character ids (the older fixture articles do not)
//   resolved incidents      some with an article linked (m2m_kb_task), some without: the "articles to write" radar
//   chat                    an interaction with a conversation (sys_cs_conversation) and messages (sys_cs_message), and a second
//                           interaction whose messages live only in Connect Support tables (live_group_profile / live_message)
//   reporting data          what the Team reports read: more incidents and SLAs in the last weeks, group memberships, requests
// Times are RELATIVE to the moment the run starts, so "resolved two hours ago" stays true whenever the test is run.
import { v } from '../tests/fixtures/sn-fakeDeps.js';
import { ABEL, BETH, CHARLIE, DAVE, ERIN, MARIA } from '../tests/fixtures/sn-users.js';

const HOUR = 3600000;
const RUN_START = Date.now();
const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
/** UTC time `hours` before the run started. */
export const hoursAgo = (hours) => utc(RUN_START - hours * HOUR);
export const daysAgo = (days) => hoursAgo(days * 24);
/** A time cell: the stored UTC value, and the display value two hours ahead (the instance's time zone in the fixtures). */
const time = (u) => (u ? v(u, utc(Date.parse(`${u.replace(' ', 'T')}Z`) + 2 * HOUR)) : v('', ''));

const hexId = (n) => `e2e0${String(n).padStart(4, '0')}${'0'.repeat(24)}`.slice(0, 32);

// ---- ids ----------------------------------------------------------------------------------------------------------
export const PROBLEM_ID = hexId(1);
export const PROBLEM_NUMBER = 'PRB0040001';
export const CHANGE_ID = hexId(2);
export const CHANGE_NUMBER = 'CHG0030001';
export const ACCOUNT_ID = hexId(3);
export const EMAIL_RESOLVED_ID = hexId(10);
export const EMAIL_HOLD_ID = hexId(11);
export const EMAIL_SLA_ID = hexId(12);
export const KB_BASE_ID = hexId(20);
export const KB_CATEGORY_ID = hexId(21);
export const KB_BASE_2_ID = hexId(22);
export const INTERACTION_ID = hexId(30);
export const CONVERSATION_ID = hexId(31);
export const INTERACTION_2_ID = hexId(32);
export const GROUP_PROFILE_ID = hexId(33);
export const INTERACTION_3_ID = hexId(34);
export const GROUP_NETWORK = v('d625dccec0a8016700a222a0f7900d06', 'Network Support');
export const GROUP_DESKTOP_ID = 'a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d';
const CI_VPN_EU = v('0c1d2e3f4a5b4c6d8e7f9a0b1c2d3e4f', 'VPN Gateway EU');
const SERVICE_REMOTE = v('1d2e3f4a5b6c4d7e8f9a0b1c2d3e4f50', 'Remote Access');

/** Personal data seeded into the NEW records (on top of SEED in data.entry.js). Nothing in here may reach the AI. */
export const MORE_SEED = {
  secret: 'Gate2026!Probe#4', // after "password:" in a problem work note
  chatEmail: 'abel.tuter.private@example.com', // typed by the customer in the chat
  chatPhone: '+1 555-0155',
  articleEmail: 'dave.loftus@example.com', // inside the text of the third near-duplicate article
  articlePhone: '+1 555-0166',
  articleSecret: 'Guest2026!Wifi#2', // a password written into a published article (the Article tab must flag it, never show it)
  rewriteCard: '5500 0000 0000 0004', // pasted by the agent into Rewrite (a Luhn-valid test number)
  rewriteName: 'Priya Raman', // typed under "Names to hide" in Rewrite
  rewriteEmail: 'priya.raman@example.com',
  rewritePhone: '+44 20 7946 0958',
  rewritePassword: 'Spring2026!Reset#8',
};
MORE_SEED.mustNotLeak = [
  MORE_SEED.secret, MORE_SEED.articleSecret, MORE_SEED.chatEmail, MORE_SEED.chatPhone, MORE_SEED.articleEmail, MORE_SEED.articlePhone,
  MORE_SEED.rewriteCard, MORE_SEED.rewriteName, MORE_SEED.rewriteEmail, MORE_SEED.rewritePhone, MORE_SEED.rewritePassword,
];

const journalRow = (id, table, recordId, element, when, by, value) => ({ sys_id: id, name: table, element_id: recordId, element, sys_created_on: when, sys_created_by: by.login, value });

/** Adds the rows to `tables` (the object buildTables() made) and returns it. */
export function addMoreTables(tables) {
  const add = (table, ...rows) => {
    tables[table] = [...(tables[table] || []), ...rows];
  };

  // ---- 1. A problem with linked incidents and a problem task --------------------------------------------------------
  add('problem', {
    sys_id: v(PROBLEM_ID),
    number: v(PROBLEM_NUMBER),
    short_description: v('Recurring VPN session resets on gateway EU-2'),
    description: v('<p>Several users report that the VPN drops every ten minutes. The gateway log shows session resets after the certificate was rotated. First reported by abel.tuter@example.com.</p>'),
    state: v('102', 'Root Cause Analysis'),
    priority: v('3', '3 - Moderate'),
    impact: v('2', '2 - Medium'),
    urgency: v('2', '2 - Medium'),
    category: v('network', 'Network'),
    subcategory: v('vpn', 'VPN'),
    assignment_group: GROUP_NETWORK,
    assigned_to: v(BETH.sysId, BETH.name),
    opened_by: v(BETH.sysId, BETH.name),
    cmdb_ci: CI_VPN_EU,
    business_service: SERVICE_REMOTE,
    opened_at: time(daysAgo(6)),
    sys_updated_on: time(daysAgo(1)),
    resolved_at: v('', ''),
    known_error: v('false', 'false'),
    cause_notes: v('', ''),
    workaround: v('Switch the client profile to TCP mode.'),
    fix_notes: v('', ''),
    resolution_code: v('', ''),
    close_notes: v('', ''),
    comments: v('', ''),
    work_notes: v('', ''),
  });
  add(
    'sys_journal_field',
    journalRow('e2ejp1', 'problem', PROBLEM_ID, 'work_notes', daysAgo(4), BETH, `Certificate on EU-2 was renewed last Tuesday. The service account password: ${MORE_SEED.secret} was used for the check.`),
    journalRow('e2ejp2', 'problem', PROBLEM_ID, 'work_notes', daysAgo(2), BETH, 'Reproduced with the TCP profile switched off. Two more users confirmed.')
  );
  // Two linked incidents (INC0009001 and INC0009640 are solved look-alikes in the shared fixtures).
  for (const row of tables.incident) {
    const number = row.number?.value;
    if (number === 'INC0009001' || number === 'INC0009640') row.problem_id = v(PROBLEM_ID, PROBLEM_NUMBER);
  }
  add('task', {
    sys_id: v(hexId(4)),
    number: v('PTASK0040002'),
    sys_class_name: v('problem_task', 'Problem Task'),
    short_description: v('Compare the gateway certificate chain with EU-1'),
    state: v('1', 'Open'),
    assigned_to: v(BETH.sysId, BETH.name),
    assignment_group: GROUP_NETWORK,
    active: v('true', 'true'),
    parent: v(PROBLEM_ID, PROBLEM_NUMBER),
    sys_created_on: time(daysAgo(3)),
  });

  // ---- 2. A change with approvals, a task and a conflicting change ---------------------------------------------------
  const start = hoursAgo(-50); // the planned window starts in about two days
  const end = hoursAgo(-54);
  add(
    'change_request',
    {
      sys_id: v(CHANGE_ID),
      number: v(CHANGE_NUMBER),
      short_description: v('Rotate the VPN gateway certificates on EU-2'),
      description: v('Replace the expiring gateway certificate on EU-2 during the maintenance window.'),
      state: v('-4', 'Authorize'),
      priority: v('3', '3 - Moderate'),
      impact: v('2', '2 - Medium'),
      type: v('normal', 'Normal'),
      risk: v('moderate', 'Moderate'),
      category: v('network', 'Network'),
      assignment_group: GROUP_NETWORK,
      assigned_to: v(BETH.sysId, BETH.name),
      requested_by: v(DAVE.sysId, DAVE.name),
      cmdb_ci: CI_VPN_EU,
      business_service: SERVICE_REMOTE,
      opened_at: time(daysAgo(5)),
      sys_updated_on: time(daysAgo(1)),
      start_date: time(start),
      end_date: time(end),
      approval: v('requested', 'Requested'),
      conflict_status: v('', 'Not Run'),
      active: v('true', 'true'),
      justification: v('The current certificate expires on Friday; an expired certificate would stop all remote access.'),
      implementation_plan: v('1. Import the new certificate. 2. Restart the gateway service. 3. Test a connection from two sites.'),
      backout_plan: v('', ''),
      test_plan: v('Connect from the London and Berlin offices and check the session stays up for 30 minutes.'),
      risk_impact_analysis: v('Remote access is unavailable for about 10 minutes while the service restarts.'),
      cab_date: time(daysAgo(-1)),
      comments: v('', ''),
      work_notes: v('', ''),
    },
    {
      sys_id: v(hexId(5)),
      number: v('CHG0030002'),
      short_description: v('Patch the VPN gateway firmware on EU-2'),
      description: v('Firmware patch for the same gateway.'),
      state: v('-4', 'Authorize'),
      priority: v('3', '3 - Moderate'),
      impact: v('2', '2 - Medium'),
      type: v('normal', 'Normal'),
      risk: v('high', 'High'),
      category: v('network', 'Network'),
      assignment_group: GROUP_NETWORK,
      assigned_to: v('', ''),
      requested_by: v(CHARLIE.sysId, CHARLIE.name),
      cmdb_ci: CI_VPN_EU,
      business_service: SERVICE_REMOTE,
      opened_at: time(daysAgo(4)),
      sys_updated_on: time(daysAgo(1)),
      start_date: time(hoursAgo(-49)),
      end_date: time(hoursAgo(-52)),
      approval: v('approved', 'Approved'),
      active: v('true', 'true'),
    }
  );
  const approval = (n, approver, state, when) => ({
    sys_id: v(`e2eappr${n}`),
    sysapproval: v(CHANGE_ID, CHANGE_NUMBER),
    approver: v(approver.sysId, approver.name),
    group: v('', ''),
    state: v(state.toLowerCase(), state),
    sys_updated_on: time(when),
    sys_created_on: time(when),
  });
  add('sysapproval_approver', approval(1, CHARLIE, 'Approved', daysAgo(2)), approval(2, DAVE, 'Requested', daysAgo(4)));
  add('change_task', {
    sys_id: v(hexId(6)),
    number: v('CTASK0030011'),
    short_description: v('Import the certificate on the staging gateway'),
    state: v('1', 'Open'),
    assigned_to: v(CHARLIE.sysId, CHARLIE.name),
    assignment_group: GROUP_NETWORK,
    change_task_type: v('implementation', 'Implementation'),
    active: v('true', 'true'),
    change_request: v(CHANGE_ID, CHANGE_NUMBER),
  });

  // ---- 3. The customer service case gets an account with a real id and two more cases -------------------------------------
  for (const row of tables.sn_customerservice_case) {
    if (row.number?.value === 'CS0001001') {
      row.account = v(ACCOUNT_ID, 'Acme Corp');
      row.active = v('true'); // the other cases below carry an active flag, so this one must too (a query on it would drop a row without one)
    }
  }
  const csCase = (n, number, desc, state, active, priority, opened) => ({
    sys_id: v(hexId(40 + n)),
    number: v(number),
    short_description: v(desc),
    state: v(state === 'Closed' ? '3' : '10', state),
    active: v(String(active)),
    priority: v(priority[0], priority),
    account: v(ACCOUNT_ID, 'Acme Corp'),
    contact: v(ERIN.sysId, ERIN.name),
    assigned_to: v(DAVE.sysId, DAVE.name),
    opened_at: time(opened),
    resolved_at: time(state === 'Closed' ? daysAgo(2) : ''),
    sys_updated_on: time(daysAgo(1)),
  });
  add(
    'sn_customerservice_case',
    csCase(1, 'CS0001002', 'Acme Corp invoices not syncing', 'Open', true, '3 - Moderate', daysAgo(9)),
    csCase(2, 'CS0000990', 'Acme Corp: SSO login loop', 'Closed', false, '2 - High', daysAgo(20))
  );

  // ---- 4. Incidents that decide the Write tab's email suggestions --------------------------------------------------------
  const base = tables.incident.find((r) => r.number?.value === 'INC0010001');
  const incident = (id, number, desc, extra) => ({
    ...base,
    sys_id: v(id),
    number: v(number),
    short_description: v(desc),
    description: v(`${desc}. This was reported through the self-service portal.`),
    assigned_to: v(DAVE.sysId, DAVE.name), // not Beth: these must not appear in My Day
    comments: v('', ''),
    work_notes: v('', ''),
    problem_id: v('', ''),
    ...extra,
  });
  add(
    'incident',
    incident(EMAIL_RESOLVED_ID, 'INC0020001', 'Cannot print from the Finance floor', {
      state: v('6', 'Resolved'),
      active: v('false', 'false'),
      opened_at: time(daysAgo(1)),
      resolved_at: time(hoursAgo(2)),
      close_code: v('solution provided', 'Solution provided'),
      close_notes: v('Restarted the print spooler on the floor print server.'),
      sys_updated_on: time(hoursAgo(2)),
    }),
    incident(EMAIL_HOLD_ID, 'INC0020002', 'Laptop dock is not detected', {
      state: v('3', 'On Hold'),
      hold_reason: v('1', 'Awaiting Caller'),
      active: v('true', 'true'),
      opened_at: time(daysAgo(5)),
      sys_updated_on: time(daysAgo(3)),
    }),
    incident(EMAIL_SLA_ID, 'INC0020003', 'Shared mailbox is missing from Outlook', {
      state: v('2', 'In Progress'),
      active: v('true', 'true'),
      opened_at: time(daysAgo(2)),
      sys_updated_on: time(hoursAgo(10)),
    })
  );
  add(
    'sys_journal_field',
    journalRow('e2ejm1', 'incident', EMAIL_RESOLVED_ID, 'comments', hoursAgo(6), ABEL, 'The printer on the second floor is still offline, can you help?'),
    journalRow('e2ejm2', 'incident', EMAIL_HOLD_ID, 'comments', daysAgo(3), BETH, 'Could you tell me the model of the dock? It is printed on the underside.'),
    journalRow('e2ejm3', 'incident', EMAIL_SLA_ID, 'comments', hoursAgo(30), ABEL, 'I am still waiting for the mailbox to show up.')
  );
  add('task_sla', {
    sys_id: v('sla-e2e-mail'),
    task: v(EMAIL_SLA_ID, 'INC0020003'),
    sla: v('sladef-mail', 'P3 resolution 5 days'),
    stage: v('breached', 'Breached'),
    has_breached: v('true', 'true'),
    percentage: v('130'),
    business_percentage: v('130'),
    planned_end_time: time(hoursAgo(5)),
    sys_created_on: time(daysAgo(2)),
  });

  // ---- 5. Knowledge: a base with real ids, near-duplicates, and resolved incidents with and without an article -----------------
  const article = (n, number, title, text, { views = 0, updated = daysAgo(40), base = KB_BASE_ID, baseName = 'IT Knowledge Base', author = BETH, validTo = '2028-12-31' } = {}) => ({
    sys_id: v(hexId(50 + n)),
    number: v(number),
    short_description: v(title),
    text: v(text),
    workflow_state: v('published', 'Published'),
    kb_knowledge_base: v(base, baseName),
    kb_category: v(KB_CATEGORY_ID, 'Remote access'),
    article_type: v('html', 'HTML'),
    meta: v('vpn password reset'),
    published: time(daysAgo(200)),
    valid_to: v(validTo),
    sys_updated_on: time(updated),
    sys_view_count: v(String(views)),
    view_count: v(String(views)),
    author: v(author.sysId, author.name),
  });
  add(
    'kb_knowledge',
    article(1, 'KB0020001', 'How to reset your VPN password', '<h2>Reset it</h2><p>Open the self-service portal, choose Remote access, then Reset password. You get an email with a link that works for one hour.</p><ol><li>Open the portal</li><li>Choose Reset password</li><li>Follow the link in the email</li></ol>', { views: 1200 }),
    article(2, 'KB0020002', 'Reset your VPN password', '<p>To reset the VPN password, open the self-service portal, choose Remote access and then Reset password. You will get an email with a link that works for one hour.</p><ol><li>Open the portal</li><li>Choose Reset password</li><li>Follow the link in the email</li></ol>', { views: 310 }),
    article(3, 'KB0020003', 'VPN password reset steps', `<p>Reset the VPN password in the self-service portal: Remote access, then Reset password. If the link does not arrive call ${DAVE.name} (${MORE_SEED.articleEmail}) on ${MORE_SEED.articlePhone}.</p>`, { views: 45, author: DAVE }),
    article(4, 'KB0020004', 'Set up a shared printer on Windows', '<p>Open Settings, choose Printers and scanners, then Add device.</p>', { views: 200 }),
    article(6, 'KB0020006', 'Guest Wi-Fi', `<p>Connect to the guest network and open a browser. TODO add the screenshots. The sign-in password: ${MORE_SEED.articleSecret} is changed every month.</p>`, { views: 0, updated: daysAgo(500) }),
    article(5, 'KB0020005', 'Request a new laptop', '<p>Order a laptop from the service catalog and wait for approval.</p>', { views: 80, base: KB_BASE_2_ID, baseName: 'HR Knowledge Base' })
  );
  // Resolved incidents in the last weeks. Three about the same thing (two with an article), one about printers (no article).
  const resolved = (n, number, desc, { days, ci = 'ci-mail', category = 'Software', notes = 'Rebuilt the mail profile and the problem went away for good.' } = {}) => ({
    ...base,
    sys_id: v(hexId(70 + n)),
    number: v(number),
    short_description: v(desc),
    description: v(desc),
    state: v('6', 'Resolved'),
    active: v('false', 'false'),
    category: v(category.toLowerCase(), category),
    cmdb_ci: v(ci, ci === 'ci-mail' ? 'Exchange Online' : 'Print Server 2F'),
    caller_id: v(MARIA.sysId, MARIA.name),
    assigned_to: v(DAVE.sysId, DAVE.name),
    opened_at: time(daysAgo(days + 1)),
    resolved_at: time(daysAgo(days)),
    close_code: v('solution provided', 'Solution provided'),
    close_notes: v(notes),
    sys_updated_on: time(daysAgo(days)),
    comments: v('', ''),
    work_notes: v('', ''),
    problem_id: v('', ''),
  });
  const gapRows = [
    resolved(1, 'INC0030001', 'Outlook keeps asking for the password after the update', { days: 5 }),
    resolved(2, 'INC0030002', 'Outlook asks for the password again after update', { days: 8 }),
    resolved(3, 'INC0030003', 'Outlook password prompt keeps coming back after an update', { days: 12 }),
    resolved(4, 'INC0030004', 'Second floor printer queue is stuck', { days: 6, ci: 'ci-print', category: 'Hardware', notes: '' }),
    resolved(5, 'INC0030005', 'Second floor printer stuck again', { days: 9, ci: 'ci-print', category: 'Hardware', notes: '' }),
  ];
  add('incident', ...gapRows);
  // INC0030001 and INC0030002 already have an article attached; the third one has none, and neither do the printer tickets.
  add('m2m_kb_task', { sys_id: v('e2em2m1'), task: v(gapRows[0].sys_id.value, 'INC0030001'), kb_knowledge: v(hexId(51), 'KB0020001') });
  // (src/context/knowledge.js and src/content/ops/checks.js both read kb_use.task_id; docs/live-questions/knowledge.md question 21.)
  add('kb_use', { sys_id: v('e2eku1'), task_id: v(gapRows[1].sys_id.value, 'INC0030002'), article: v(hexId(51), 'KB0020001') });

  // ---- 6. Chat: an interaction with a conversation and messages, and one that lives only in Connect Support tables -----------
  const customerSays = (n, when, text) => ({
    sys_id: v(hexId(80 + n)),
    conversation: v(CONVERSATION_ID),
    sys_created_on: v(when),
    sys_created_by: v(ABEL.login),
    message: v(text),
    direction: v('inbound', 'Inbound'),
    sender_type: v('consumer', 'Consumer'),
    sender: v(ABEL.sysId, ABEL.name),
  });
  const agentSays = (n, when, text) => ({
    sys_id: v(hexId(80 + n)),
    conversation: v(CONVERSATION_ID),
    sys_created_on: v(when),
    sys_created_by: v(BETH.login),
    message: v(text),
    direction: v('outbound', 'Outbound'),
    sender_type: v('agent', 'Agent'),
    sender: v(BETH.sysId, BETH.name),
  });
  add('interaction', {
    sys_id: v(INTERACTION_ID),
    number: v('INT0000101'),
    short_description: v('Chat: VPN keeps dropping'),
    state: v('open', 'Open'),
    type: v('chat', 'Chat'),
    opened_at: time(hoursAgo(1)),
    closed_at: v('', ''),
    assigned_to: v(BETH.sysId, BETH.name),
    opened_for: v(ABEL.sysId, ABEL.name),
  });
  add('sys_cs_conversation', { sys_id: v(CONVERSATION_ID), interaction: v(INTERACTION_ID, 'INT0000101'), document_id: v('', '') });
  add(
    'sys_cs_message',
    customerSays(1, hoursAgo(0.9), `Hi, my VPN keeps dropping. My email is ${MORE_SEED.chatEmail} and you can call me on ${MORE_SEED.chatPhone}.`),
    agentSays(2, hoursAgo(0.8), 'Hello Abel, I am sorry to hear that. Which VPN client version do you use?'),
    customerSays(3, hoursAgo(0.5), 'Version 5.2. It disconnects every ten minutes, still not working after a restart.'),
    // a system event: dropped by the reader
    { sys_id: v(hexId(84)), conversation: v(CONVERSATION_ID), sys_created_on: v(hoursAgo(0.4)), sys_created_by: v('system'), message: v('Agent joined'), message_type: v('notification', 'Notification') }
  );
  // A second chat, held in Connect Support tables only.
  add('interaction', {
    sys_id: v(INTERACTION_2_ID),
    number: v('INT0000102'),
    short_description: v('Chat: invoice question'),
    state: v('closed', 'Closed'),
    type: v('chat', 'Chat'),
    opened_at: time(hoursAgo(5)),
    closed_at: time(hoursAgo(4)),
    assigned_to: v(BETH.sysId, BETH.name),
    opened_for: v(ABEL.sysId, ABEL.name),
  });
  add('live_group_profile', { sys_id: v(GROUP_PROFILE_ID), document: v(INTERACTION_2_ID, 'INT0000102'), interaction: v('', '') });
  add(
    'live_message',
    { sys_id: v(hexId(90)), group: v(GROUP_PROFILE_ID), sys_created_on: v(hoursAgo(4.9)), sys_created_by: v(ABEL.login), message: v('Where can I find my last invoice?'), direction: v('inbound', 'Inbound'), sender: v(ABEL.sysId, ABEL.name) },
    { sys_id: v(hexId(91)), group: v(GROUP_PROFILE_ID), sys_created_on: v(hoursAgo(4.8)), sys_created_by: v(BETH.login), message: v('You can download it from the billing page under Documents.'), direction: v('outbound', 'Outbound'), sender: v(BETH.sysId, BETH.name) }
  );
  // A third interaction with no readable messages at all (the access note must say so instead of showing an empty chat).
  add('interaction', {
    sys_id: v(INTERACTION_3_ID),
    number: v('INT0000103'),
    short_description: v('Chat: nothing readable'),
    state: v('open', 'Open'),
    type: v('chat', 'Chat'),
    opened_at: time(hoursAgo(1)),
    assigned_to: v(BETH.sysId, BETH.name),
    opened_for: v(ABEL.sysId, ABEL.name),
  });

  // ---- 7. What the Team reports read ---------------------------------------------------------------------------------------
  // Group membership: Beth is in Network Support (the shared incidents are assigned to that group) and in Desktop Support.
  add('sys_user_group', { sys_id: v(GROUP_NETWORK.value, 'Network Support'), name: v('Network Support'), active: v('true') }, { sys_id: v(GROUP_DESKTOP_ID), name: v('Desktop Support'), active: v('true') });
  add(
    'sys_user_grmember',
    { sys_id: v('e2egm1'), user: v(BETH.sysId, BETH.name), group: v(GROUP_NETWORK.value, 'Network Support') },
    { sys_id: v('e2egm2'), user: v(BETH.sysId, BETH.name), group: v(GROUP_DESKTOP_ID, 'Desktop Support') },
    { sys_id: v('e2egm3'), user: v(DAVE.sysId, DAVE.name), group: v(GROUP_NETWORK.value, 'Network Support') },
    { sys_id: v('e2egm4'), user: v(CHARLIE.sysId, CHARLIE.name), group: v(GROUP_NETWORK.value, 'Network Support') }
  );
  addChecklistTask(tables);
  return tables;
}

/** Adds a catalog task with written instructions (the Checklist tab turns them into steps). Called from addMoreTables. */
export function addChecklistTask(tables) {
  const row = {
    sys_id: v(hexId(100)),
    number: v('SCTASK0020070'),
    short_description: v('Prepare and hand over the laptop'),
    description: v('Laptop for the new starter, needed by Friday.'),
    special_instructions: v('1. Image the laptop with the standard build\n2. Add it to the asset register\n3. Send the delivery note to the requester'),
    state: v('2', 'Work in Progress'),
    priority: v('3', '3 - Moderate'),
    assigned_to: v(DAVE.sysId, DAVE.name),
    assignment_group: v(GROUP_DESKTOP_ID, 'Desktop Support'),
    active: v('true'),
    request_item: v('e3f4a5b6c7d84e9fa0b1c2d3e4f5a6b7', 'RITM0010050'),
    opened_at: time(daysAgo(2)),
    sys_updated_on: time(daysAgo(1)),
    due_date: time(daysAgo(-2)),
  };
  tables.sc_task = [...(tables.sc_task || []), row];
  return tables;
}
export const CHECKLIST_TASK_ID = hexId(100);
export const CHECKLIST_TASK_NUMBER = 'SCTASK0020070';
export const CHECKLIST_STEPS = ['Image the laptop with the standard build', 'Add it to the asset register', 'Send the delivery note to the requester'];

/** The sys_id of fixture article KB00200nn (n = 1..6). */
export const kbArticleId = (n) => hexId(50 + n);

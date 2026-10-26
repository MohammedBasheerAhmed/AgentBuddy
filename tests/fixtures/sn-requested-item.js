// A catalog requested item (RITM) with variables (one masked, one a reference, layout rows), approvals, catalog tasks and
// its request. Variable rows are sc_item_option_mtom rows with the dotted columns the pack reads.

import { v } from './sn-fakeDeps.js';
import { BETH, CHARLIE, DAVE } from './sn-users.js';

export const RITM_ID = 'e3f4a5b6c7d84e9fa0b1c2d3e4f5a6b7';
export const RITM_NUMBER = 'RITM0010050';
export const REQUEST_ID = 'f4a5b6c7d8e94fa0b1c2d3e4f5a6b7c8';
export const REQUEST_NUMBER = 'REQ0010030';

const GROUP_DESKTOP = v('a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d', 'Desktop Support');

export function requestedItemRow() {
  return {
    sys_id: v(RITM_ID),
    number: v(RITM_NUMBER),
    short_description: v('Standard Laptop for Charlie Whitherspoon'),
    description: v('Laptop for a new starter. Needs to be ready by Friday. Contact charlie.w@example.com'),
    state: v('2', 'Work in Progress'),
    stage: v('fulfillment', 'Fulfillment'),
    approval: v('approved', 'Approved'),
    priority: v('3', '3 - Moderate'),
    cat_item: v('ci1', 'Standard Laptop'),
    request: v(REQUEST_ID, REQUEST_NUMBER),
    requested_for: v(CHARLIE.sysId, CHARLIE.name),
    opened_by: v(DAVE.sysId, DAVE.name),
    assignment_group: GROUP_DESKTOP,
    assigned_to: v(BETH.sysId, BETH.name),
    cmdb_ci: v('', ''),
    opened_at: v('2026-10-23 09:00:00', '2026-10-23 11:00:00'),
    sys_updated_on: v('2026-10-26 08:00:00', '2026-10-26 10:00:00'),
    closed_at: v('', ''),
    due_date: v('2026-10-30 15:00:00', '2026-10-30 17:00:00'),
    quantity: v('1'),
    close_notes: v('', ''),
    // Not on any allowlist:
    u_cost_center: v('CC-LEAK-4411'),
    price: v('1450', 'PRICE-LEAK'),
    sys_created_by: v(DAVE.login),
    watch_list: v(CHARLIE.sysId, CHARLIE.name),
    comments: v('', '2026-10-24 09:00:00 - Dave Loftus (Additional comments)\nPlease prioritise, new starter on Monday.'),
    work_notes: v('', ''),
  };
}

export function requestRow() {
  return {
    sys_id: v(REQUEST_ID),
    number: v(REQUEST_NUMBER),
    short_description: v('Request for a laptop'),
    description: v(''),
    state: v('1', 'Open'),
    request_state: v('in_process', 'In Process'),
    stage: v('fulfillment', 'Fulfillment'),
    approval: v('approved', 'Approved'),
    priority: v('3', '3 - Moderate'),
    requested_for: v(CHARLIE.sysId, CHARLIE.name),
    opened_by: v(DAVE.sysId, DAVE.name),
    opened_at: v('2026-10-23 09:00:00', '2026-10-23 11:00:00'),
    sys_updated_on: v('2026-10-24 08:00:00', '2026-10-24 10:00:00'),
    closed_at: v('', ''),
    due_date: v('', ''),
    special_instructions: v('Deliver to the 3rd floor.'),
    price: v('1450', 'PRICE-LEAK'),
  };
}

// One variable answer: question text, stored value, display of the type, and (for references) the table.
function option(n, { question, name, value, type, typeCode = '6', reference = '', order = n }) {
  return {
    sys_id: v(`mtom${n}`),
    request_item: v(RITM_ID, RITM_NUMBER),
    'sc_item_option.value': v(value),
    'sc_item_option.order': v(String(order)),
    'sc_item_option.item_option_new.question_text': v(question),
    'sc_item_option.item_option_new.name': v(name),
    'sc_item_option.item_option_new.type': v(typeCode, type),
    'sc_item_option.item_option_new.reference': v(reference),
  };
}

export function variableRows() {
  return [
    option(3, { question: 'Manager', name: 'manager', value: DAVE.sysId, type: 'Reference', typeCode: '8', reference: 'sys_user' }),
    option(1, { question: 'Operating system', name: 'os', value: 'Windows 11', type: 'Select Box', typeCode: '5' }),
    option(2, { question: 'Business justification', name: 'justification', value: 'New starter; replaces a retired laptop. Contact charlie.w@example.com', type: 'Multi Line Text', typeCode: '2' }),
    option(4, { question: 'Local admin password', name: 'u_local_admin_password', value: 'hunter2-Secret!', type: 'Masked', typeCode: '25' }),
    option(5, { question: 'Section break', name: 'break1', value: '', type: 'Break', typeCode: '12' }),
    option(6, { question: 'Needed by', name: 'needed_by', value: '2026-11-01', type: 'Date', typeCode: '9' }),
    // Named like a secret even though its type is a plain text box:
    option(7, { question: 'Recovery PIN for the laptop', name: 'recovery_pin', value: '4417', type: 'Single Line Text', typeCode: '6' }),
    // A reference whose table the user cannot read, so the name cannot be shown:
    option(8, { question: 'Cost centre owner', name: 'cc_owner', value: '99999999999999999999999999999999', type: 'Reference', typeCode: '8', reference: 'u_cost_center_owner' }),
  ];
}

export function approvalRows() {
  const row = (n, approver, group, state, updated) => ({
    sys_id: v(`appr${n}`),
    sysapproval: v(RITM_ID, RITM_NUMBER),
    approver: approver ? v(approver.sysId, approver.name) : v('', ''),
    group: group ? v('grp1', group) : v('', ''),
    state: v(state.toLowerCase(), state),
    sys_updated_on: v(updated, updated),
    sys_created_on: v(updated, updated),
  });
  return [
    row(1, DAVE, '', 'Approved', '2026-10-23 12:00:00'),
    row(2, null, 'IT Procurement', 'Requested', '2026-10-24 08:00:00'),
    {
      sys_id: v('appr9'),
      sysapproval: v('ffffffffffffffffffffffffffffffff', 'CHG9999999'),
      approver: v(BETH.sysId, BETH.name),
      group: v('', ''),
      state: v('approved', 'Approved'),
      sys_updated_on: v('2026-10-01 00:00:00'),
      sys_created_on: v('2026-10-01 00:00:00'),
    },
  ];
}

export function catalogTaskRows() {
  const row = (n, number, desc, state, active, assignee) => ({
    sys_id: v(`sct${n}`),
    number: v(number),
    short_description: v(desc),
    state: v(state === 'Closed Complete' ? '3' : '2', state),
    assigned_to: assignee ? v(assignee.sysId, assignee.name) : v('', ''),
    assignment_group: GROUP_DESKTOP,
    active: v(String(active)),
    request_item: v(RITM_ID, RITM_NUMBER),
  });
  return [
    row(1, 'SCTASK0010060', 'Image the laptop', 'Closed Complete', false, BETH),
    row(2, 'SCTASK0010061', 'Deliver the laptop', 'Work in Progress', true, BETH),
  ];
}

export function requestedItemTables() {
  return {
    sc_req_item: [requestedItemRow()],
    sc_request: [requestRow()],
    sc_item_option_mtom: variableRows(),
    sysapproval_approver: approvalRows(),
    sc_task: catalogTaskRows(),
    // the sys_user lookup behind the "Manager" reference answer is served from the users table
  };
}

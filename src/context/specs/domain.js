// Context specs for the domain features: HR case brief, account briefing, engineering escalation, problem RCA, CAB brief
// (see docs/contracts.md, "Context specs"). Every feature works on ONE kind, so the columns are listed under `by` for that kind
// and `common` is just the record number: asked about any other kind, a feature reads nothing else.
//
// Columns marked "masking only" are read so the person is on the pack's `people` list and is masked by name wherever they are
// mentioned in the notes; the feature's parts() leave the column itself out (see src/features/packs/domain.js).

export default {
  spec: {
    'hr-case-brief': {
      common: ['number'],
      by: {
        hr_case: [
          'state', 'priority', 'hr_service', 'short_description', 'description', 'assignment_group', 'opened_at', 'sys_updated_on',
          'resolved_at', 'due_date', 'close_notes',
          // masking only: who the case is about, who raised it, who is handling it
          'subject_person', 'opened_for', 'opened_by', 'assigned_to',
        ],
      },
    },
    'account-briefing': {
      common: ['number'],
      by: {
        case: [
          'short_description', 'description', 'state', 'priority', 'category', 'subcategory', 'account', 'contact', 'consumer', 'product',
          'asset', 'entitlement', 'cmdb_ci', 'assignment_group', 'opened_at', 'sys_updated_on', 'contact_type',
          // masking only
          'assigned_to',
        ],
      },
    },
    'case-eng-escalation': {
      common: ['number'],
      by: {
        case: [
          'short_description', 'description', 'state', 'priority', 'category', 'subcategory', 'account', 'product', 'asset', 'entitlement',
          'cmdb_ci', 'assignment_group', 'opened_at', 'sys_updated_on', 'contact_type',
          // masking only
          'contact', 'consumer', 'assigned_to',
        ],
      },
    },
    'problem-rca': {
      common: ['number'],
      by: {
        problem: [
          'short_description', 'description', 'state', 'priority', 'impact', 'urgency', 'category', 'subcategory', 'assignment_group',
          'cmdb_ci', 'business_service', 'opened_at', 'sys_updated_on', 'resolved_at', 'known_error', 'cause_notes', 'workaround',
          'fix_notes', 'resolution_code', 'close_notes',
          // masking only
          'assigned_to',
        ],
      },
    },
    'change-cab-brief': {
      common: ['number'],
      by: {
        change: [
          'short_description', 'description', 'state', 'priority', 'impact', 'type', 'risk', 'category', 'assignment_group', 'cmdb_ci',
          'business_service', 'opened_at', 'sys_updated_on', 'start_date', 'end_date', 'approval', 'conflict_status',
          // the change's own text, for the CAB (added to the change ceiling below)
          'justification', 'implementation_plan', 'backout_plan', 'test_plan', 'risk_impact_analysis', 'cab_date',
          // who owns and who requested the change: sent as placeholders, and on the people list for masking
          'assigned_to', 'requested_by',
        ],
      },
    },
  },

  // Notes and comments. The HR brief needs them (what was done and what is pending lives there); the context engine reads
  // them on an HR table only when the organisation allows HR content.
  journal: {
    'hr-case-brief': true,
    'account-briefing': true,
    'case-eng-escalation': true,
    'problem-rca': true,
    'change-cab-brief': true,
  },

  // Extras (src/context/related.js). linkedIncidents, conflicts and recentChanges are new; the others already existed.
  related: {
    'hr-case-brief': ['slas', 'childTasks'],
    'account-briefing': ['slas', 'recentChanges'],
    'case-eng-escalation': ['slas', 'childTasks'],
    'problem-rca': ['linkedIncidents', 'childTasks'],
    'change-cab-brief': ['approvals', 'changeTasks', 'conflicts'],
  },

  fieldsByKind: {},

  // Additive only: columns the base ceilings do not have yet, each with its reason.
  extendFields: {
    // "Status and due date" is part of the HR brief; due_date is a plain date on every task and is not an HR_HIDDEN column.
    hr_case: ['due_date'],
    // What a CAB reads: why (justification), the three plans, the recorded risk assessment, and when the CAB meets.
    // They are standard columns of change_request, but an instance can have removed them: the reader tolerates a missing column.
    change: ['justification', 'implementation_plan', 'backout_plan', 'test_plan', 'risk_impact_analysis', 'cab_date'],
  },

  // These plans and justifications are long text; the default of 300 characters would cut them in the middle of a step.
  limits: {
    justification: 1500,
    implementation_plan: 2000,
    backout_plan: 2000,
    test_plan: 2000,
    risk_impact_analysis: 1500,
  },
};

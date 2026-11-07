// Less by default (wave 6, team lead): the Team overview was about fifteen sections, all open. Now the new section and the five that
// answer a lead's questions are open; the rest are folded under the title they already had. The open set is pinned here; every part
// is drawn through one table (src/sidepanel/reports/folds.js), so flipping one word moves a part in or out of its fold. And the
// ready-made Team overview starts with Needs attention now, also for a dashboard saved before.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import { SECTION_FOLDS, OPEN_BY_DEFAULT, isOpenByDefault } from '../src/sidepanel/reports/folds.js';
import Foldable from '../src/sidepanel/reports/Foldable.jsx';
import { AttentionBody } from '../src/sidepanel/reports/AttentionView.jsx';
import { OverviewBody } from '../src/sidepanel/reports/OverviewView.jsx';
import { SlaBody } from '../src/sidepanel/reports/SlaView.jsx';
import { WorkloadBody } from '../src/sidepanel/reports/WorkloadView.jsx';
import { FulfilmentBody } from '../src/sidepanel/reports/FulfilmentView.jsx';
import { QualityBody } from '../src/sidepanel/reports/QualityView.jsx';
import { HandoverBody } from '../src/sidepanel/reports/HandoverView.jsx';
import {
  ADDED_SECTIONS, PRESETS, createDashboardStore, defaultState, removeWidget, sanitizeState, CAPS, addWidget,
} from '../src/reports/dashboards.js';
import { fakeInstance, cell, group, group2, count, USER, GROUP_A, NOW } from './reports-fixtures.js';

const h = React.createElement;
const html = (node) => renderToStaticMarkup(node);
const id = (n) => String(n).padStart(32, '0');

// ---- the table -----------------------------------------------------------------------------------------------------------------------

test('the parts open by default are exactly Needs attention, Overview, Closest to breaking, Open work, Approvals waiting and Shift handover', () => {
  assert.deepEqual([...OPEN_BY_DEFAULT], ['attention', 'overview', 'closest', 'workload', 'approvals', 'handover']);
  assert.equal(OPEN_BY_DEFAULT.length, 6);
  // everything else in the table is folded
  const folded = Object.keys(SECTION_FOLDS).filter((key) => !isOpenByDefault(key));
  assert.deepEqual(folded.sort(), ['ageing', 'fulfilment-oldest', 'fulfilment-other', 'fulfilment-state', 'handover-waiting', 'overview-by-type', 'quality', 'reassigned', 'sla-who'].sort());
  // the table says 'open' or 'fold' and nothing else, and a part nobody listed is folded (new things start out of the way)
  assert.ok(Object.values(SECTION_FOLDS).every((v) => v === 'open' || v === 'fold'));
  assert.equal(isOpenByDefault('a-section-added-later'), false);
  assert.ok(Object.isFrozen(SECTION_FOLDS));
});

test('a folded part is the Team screen\'s fold (a details with its own title, closed); an open part is drawn as it is', () => {
  const folded = html(h(Foldable, { id: 'ageing', title: 'Ageing of open work' }, h('p', null, 'inside')));
  assert.match(folded, /^<details class="ab-details" data-fold="ageing"><summary class="ab-summary"><span>Ageing of open work<\/span>/);
  assert.ok(!/<details[^>]*\sopen/.test(folded), 'closed');
  assert.match(folded, /<p>inside<\/p>/);
  const open = html(h(Foldable, { id: 'overview', title: 'Overview' }, h('p', null, 'inside')));
  assert.equal(open, '<p>inside</p>');
  assert.ok(!/details/.test(html(h(Foldable, { id: 'attention', title: 'x' }, 'y'))));
  assert.match(html(h(Foldable, { id: 'nobody-listed-me', title: 'T' }, 'y')), /<details/, 'unknown: folded');
});

// ---- the screen: every body, as the panel draws it -------------------------------------------------------------------------------------

const env = { openList() {}, openTicket() {}, scopeKind: 'groups', mask: false, setMask() {}, canEdit: true, setWidgetParams() {}, noteRead() {}, blocked: [], page: { tabId: 1, href: 'https://acme.service-now.com/nav_to.do', surface: 'classic' } };
const slaRow = (task, pct, breached) => ({ task: cell(task), sla: cell('s', 'Resolution'), stage: cell('in_progress', 'In progress'), has_breached: cell(breached ? 'true' : 'false'), percentage: cell(String(pct)), planned_end_time: cell('2026-10-28 09:00:00') });
const world = () =>
  fakeInstance({
    rules: [
      { when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'task_sla', then: count(40) },
      { when: (c) => c.kind === 'query' && c.table === 'task_sla', then: [slaRow(id(1), 130, true), slaRow(id(2), 88, false)] },
      { when: (c) => c.kind === 'query' && c.table === 'task' && c.query.includes('sys_idIN'), then: [1, 2].map((n) => ({ sys_id: cell(id(n)), number: cell(`INC${n}`), short_description: cell(`Ticket ${n}`), priority: cell('2', '2 - High'), state: cell('2', 'In Progress'), assigned_to: cell('a1', 'Ann Lee'), assignment_group: cell(GROUP_A, 'Service Desk'), sys_class_name: cell('incident') })) },
      // a custom class of ticket in scope (the "other kinds of ticket")
      { when: (c) => c.kind === 'aggregate' && c.table === 'task' && c.groupBy.join() === 'sys_class_name', then: [group('sys_class_name', 'u_custom_task', 'Custom task', 3)] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.length === 2, then: (c) => [group2(c.groupBy[0], 'a1', 'Ann Lee', c.groupBy[1], '2', 'In Progress', 4), group2(c.groupBy[0], 'b1', 'Bo Ray', c.groupBy[1], '3', 'On Hold', 2)] },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.length === 1, then: (c) => [group(c.groupBy[0], '2', c.groupBy[0] === 'state' ? 'In Progress' : 'Hardware', 3), group(c.groupBy[0], '3', c.groupBy[0] === 'state' ? 'On Hold' : 'Network', 2)] },
      { when: (c) => c.kind === 'aggregate' && c.avgFields.length, then: { stats: { count: '5', avg: { reassignment_count: '1.2' } } } },
      { when: (c) => c.kind === 'aggregate', then: count(5) },
      { when: (c) => c.kind === 'query' && c.query !== '' && c.fields.join() === 'opened_at', then: [{ opened_at: '2026-10-27 09:00:00' }, { opened_at: '2026-10-26 09:00:00' }] },
      { when: (c) => c.kind === 'query' && c.query !== '' && c.fields.join() === 'resolved_at,opened_at', then: [{ resolved_at: '2026-10-27 10:00:00', opened_at: '2026-10-27 08:00:00' }] },
      { when: (c) => c.kind === 'query' && c.query !== '' && c.query.includes('ORDERBYopened_at'), then: [{ sys_id: cell(id(9)), number: cell('RITM9'), short_description: cell('Old'), state: cell('2', 'Work in Progress'), assigned_to: cell('a1', 'Ann Lee'), assignment_group: cell(GROUP_A, 'Service Desk'), opened_at: cell('2026-10-01 08:00:00'), sys_class_name: cell('sc_req_item') }] },
      { when: (c) => c.kind === 'query' && c.query !== '' && c.query.includes('reassignment_count>='), then: [{ sys_id: cell(id(1)), number: cell('INC1'), short_description: cell('Ticket 1'), assigned_to: cell('a1', 'Ann Lee'), assignment_group: cell(GROUP_A, 'Service Desk'), reassignment_count: cell('6') }] },
    ],
  });
const section = async (name) => (await runReport({ section: name, scope: { kind: 'groups' }, tables: ['incident', 'sc_req_item', 'sc_task'], params: {} }, { deps: world().deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0 })).data;

/** Every <details> of a markup: its fold id, its title and whether it is open. */
const foldsOf = (markup) => [...markup.matchAll(/<details([^>]*)><summary class="ab-summary"><span>([^<]*)<\/span>/g)].map((m) => ({ id: /data-fold="([^"]+)"/.exec(m[1])?.[1], title: m[2], open: /\sopen(=|\s|$)/.test(m[1]) }));
/** The markup with every fold taken out: what is on the screen before anything is opened. */
const withoutFolds = (markup) => markup.replace(/<details[\s\S]*?<\/details>/g, '');

test('the Team overview as a person first sees it: the six open parts in the page, every other part a closed fold with its title', async () => {
  const bodies = {
    attention: html(h(AttentionBody, { d: (await section('attention')), env, now: NOW })),
    overview: html(h(OverviewBody, { d: await section('overview'), env })),
    sla: html(h(SlaBody, { d: await section('sla'), env, now: NOW })),
    workload: html(h(WorkloadBody, { d: await section('workload'), env: { ...env, sections: ['attention', 'overview'] } })),
    fulfilment: html(h(FulfilmentBody, { d: await section('fulfilment'), env })),
    quality: html(h(QualityBody, { d: await section('quality'), env })),
    handover: html(h(HandoverBody, { d: await section('handover'), env, now: NOW })),
  };
  const seen = {};
  for (const [name, markup] of Object.entries(bodies)) {
    for (const f of foldsOf(markup)) {
      assert.equal(f.open, false, `${name}: "${f.title}" is closed when the screen is first shown`);
      assert.equal(SECTION_FOLDS[f.id], 'fold', `${name}: "${f.title}" (${f.id}) is a folded part in the table`);
      seen[f.id] = f.title;
    }
  }
  // every folded part of the table is on the screen somewhere, under the title it already had (no dead entry in the table)
  assert.deepEqual(Object.keys(seen).sort(), Object.keys(SECTION_FOLDS).filter((key) => SECTION_FOLDS[key] === 'fold').sort());
  assert.deepEqual(seen, {
    'overview-by-type': 'By ticket type',
    'sla-who': 'Who holds the risk',
    ageing: 'Ageing of open work',
    reassigned: 'Tickets reassigned 3+ times',
    'fulfilment-state': 'By state',
    'fulfilment-other': 'Other kinds of ticket',
    'fulfilment-oldest': 'Oldest open items',
    quality: 'Quality measures',
    'handover-waiting': 'Waiting by state',
  });
  // and the open parts are in the page itself, with no fold in front of them
  const page = Object.fromEntries(Object.entries(bodies).map(([name, markup]) => [name, withoutFolds(markup)]));
  assert.match(page.attention, /Nothing needs attention right now|ab-tlist|ab-chip/);
  assert.match(page.overview, /ab-tile/);
  assert.match(page.sla, /Closest to breaking/);
  assert.match(page.workload, /Open work by person/);
  assert.match(page.fulfilment, /Waiting for your approval/);
  assert.match(page.handover, /Waiting on others/);
  // what was folded is not in the page before it is opened
  assert.ok(!/How long tickets have been open/.test(page.workload));
  assert.ok(!/Reassigned 3\+ times/.test(page.workload));
  assert.ok(!/Top categories|Time to resolve/.test(page.quality));
  assert.ok(!/SLA risk by owner/.test(page.sla));
  assert.ok(!/Oldest open items|Other kinds of ticket by|by state/i.test(page.fulfilment.replace(/Waiting for your approval/, '')));
});

test('the Shift handover dashboard\'s block with the same name is not drawn twice when Needs attention is on the dashboard', async () => {
  const d = await section('handover');
  const alone = html(h(HandoverBody, { d, env, now: NOW }));
  const together = html(h(HandoverBody, { d, env: { ...env, sections: ['attention', 'handover'] }, now: NOW }));
  assert.match(alone, /Needs attention now/);
  assert.ok(!/Needs attention now/.test(together), 'one list, said once');
  assert.match(together, /Waiting on others/, 'the rest of the hand-over stays');
});

// ---- the ready-made Team overview ------------------------------------------------------------------------------------------------------

test('the ready-made Team overview starts with Needs attention now; My numbers and the Shift handover do not', () => {
  const team = PRESETS.find((p) => p.id === 'preset-team');
  assert.deepEqual(team.widgets.map((w) => w.section), ['attention', 'overview', 'workload', 'sla', 'quality', 'fulfilment']);
  assert.ok(!PRESETS.find((p) => p.id === 'preset-my-day').widgets.some((w) => w.section === 'attention'));
  assert.ok(!PRESETS.find((p) => p.id === 'preset-handover').widgets.some((w) => w.section === 'attention'));
  let n = 0;
  const makeId = (prefix) => `${prefix}-${String((n += 1)).padStart(4, '0')}`;
  const first = defaultState(makeId, { lead: true });
  assert.equal(first.dashboards.find((d) => d.id === first.activeId).widgets[0].section, 'attention', 'a lead opens on it');
  assert.deepEqual(first.offered, ['attention'], 'and it is not offered again');
});

const savedBefore = () => ({
  version: 1,
  activeId: 'preset-team',
  dashboards: [
    { id: 'preset-my-day', name: 'My numbers', scope: { kind: 'mine' }, tables: null, widgets: [{ id: 'w-a', type: 'section', section: 'overview' }] },
    { id: 'preset-team', name: 'Team overview', scope: { kind: 'groups' }, tables: null, widgets: ['overview', 'workload', 'sla', 'quality', 'fulfilment'].map((s, i) => ({ id: `w-t${i}`, type: 'section', section: s })) },
    { id: 'd-mine', name: 'Team overview', scope: { kind: 'groups' }, tables: null, widgets: [{ id: 'w-m', type: 'section', section: 'sla' }] },
  ],
});

test('a Team overview saved before gets Needs attention now once, at the front; the others are left alone', () => {
  let n = 0;
  const makeId = (prefix) => `${prefix}-${String((n += 1)).padStart(4, '0')}`;
  const { state, status } = sanitizeState(savedBefore(), makeId);
  assert.equal(status, 'ok');
  const team = state.dashboards.find((d) => d.id === 'preset-team');
  assert.deepEqual(team.widgets.map((w) => w.section), ['attention', 'overview', 'workload', 'sla', 'quality', 'fulfilment']);
  assert.deepEqual(team.widgets.slice(1).map((w) => w.id), ['w-t0', 'w-t1', 'w-t2', 'w-t3', 'w-t4'], 'their own widgets keep their ids');
  assert.deepEqual(state.dashboards.find((d) => d.id === 'preset-my-day').widgets.map((w) => w.section), ['overview']);
  assert.deepEqual(state.dashboards.find((d) => d.id === 'd-mine').widgets.map((w) => w.section), ['sla'], 'a dashboard of the person\'s own, even with the same name, is theirs');
  assert.deepEqual(state.offered, ['attention']);
  // loading what was saved again changes nothing
  assert.deepEqual(sanitizeState(state, makeId).state, state);
  assert.equal(ADDED_SECTIONS.length, 1);
});

test('a person who removes Needs attention now is not given it back', async () => {
  let n = 0;
  const makeId = (prefix) => `${prefix}-${String((n += 1)).padStart(4, '0')}`;
  let state = sanitizeState(savedBefore(), makeId).state;
  const team = state.dashboards.find((d) => d.id === 'preset-team');
  state = removeWidget(state, team.id, team.widgets[0].id);
  assert.ok(!state.dashboards.find((d) => d.id === 'preset-team').widgets.some((w) => w.section === 'attention'));
  // saved and loaded again, as storage does
  const data = new Map();
  const storage = { get: async (k) => data.get(k), set: async (k, v) => { data.set(k, JSON.parse(JSON.stringify(v))); } };
  const store = createDashboardStore({ storage, makeId, instance: 'https://acme.service-now.com' });
  assert.equal(await store.save(state), true);
  const again = (await createDashboardStore({ storage, makeId, instance: 'https://acme.service-now.com' }).load()).state;
  assert.ok(!again.dashboards.find((d) => d.id === 'preset-team').widgets.some((w) => w.section === 'attention'), 'still gone');
  assert.deepEqual(again.offered, ['attention']);
});

test('what is stored about it is configuration only: known section ids, once each; nothing else comes through', () => {
  let n = 0;
  const makeId = (prefix) => `${prefix}-${String((n += 1)).padStart(4, '0')}`;
  const dirty = { ...savedBefore(), offered: ['attention', 'attention', '<script>', { rows: [1] }, 'overview'], secret: 'ticket text' };
  const { state } = sanitizeState(dirty, makeId);
  assert.deepEqual(state.offered, ['attention']);
  assert.equal(state.secret, undefined);
  // offered already: not put back
  const team = dirty.dashboards[1];
  const offeredAlready = sanitizeState({ ...savedBefore(), offered: ['attention'] }, makeId).state;
  assert.ok(!offeredAlready.dashboards.find((d) => d.id === team.id).widgets.some((w) => w.section === 'attention'));
});

test('a Team overview that is full, or already has it, is left as it is (and counted as offered)', () => {
  let n = 0;
  const makeId = (prefix) => `${prefix}-${String((n += 1)).padStart(4, '0')}`;
  const full = savedBefore();
  full.dashboards[1].widgets = Array.from({ length: CAPS.widgets }, (_, i) => ({ id: `w-f${i}`, type: 'section', section: 'overview' }));
  const a = sanitizeState(full, makeId).state;
  assert.equal(a.dashboards[1].widgets.length, CAPS.widgets);
  assert.ok(!a.dashboards[1].widgets.some((w) => w.section === 'attention'));
  const has = savedBefore();
  has.dashboards[1].widgets.splice(2, 0, { id: 'w-x', type: 'section', section: 'attention' });
  const b = sanitizeState(has, makeId).state;
  assert.equal(b.dashboards[1].widgets.filter((w) => w.section === 'attention').length, 1);
  assert.equal(b.dashboards[1].widgets[2].id, 'w-x', 'where the person put it');
  // a new one added in Customize still works
  const c = addWidget(b, 'preset-team', { type: 'section', section: 'attention' }, makeId);
  assert.equal(c.dashboards[1].widgets.filter((w) => w.section === 'attention').length, 2);
});

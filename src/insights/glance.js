// N1, the ticket at a glance: three short lines over the Ticket screen (number and title; state, priority and the SLA; who has it,
// how long the customer has waited, when it last changed), plus the VIP and outage marks. Pure: the panel passes the header read,
// the `glance` read (src/content/ops/insights.js) and the clock.
//
// It says only what it can stand behind: an SLA that could not be read is left out (never "no SLA"), a customer who cannot be told
// apart from the agents is never "waiting", and a time that may be off by the reader's time zone is said in days, not hours.

import { identities, roleOfEntry } from '../itsm/sentiment.js';
import { describeHeader } from '../sidepanel/recordHeader.js';
import { outageSignal } from './outage.js';
import { TIME, agoText, noteInstant, shortSpan, storedTime } from './time.js';
import { parseSnTime } from '../context/util.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const SOON = TIME.HOUR; // an SLA with less than this left is a warning

const isCancelled = (s) => /cancel/i.test(`${s.stage} ${s.stageValue}`);
const isFinished = (s) => /complet|achiev|cancel/i.test(`${s.stage} ${s.stageValue}`);
const isPaused = (s) => /pause/i.test(`${s.stage} ${s.stageValue}`);

/**
 * The SLA that matters most for the glance.
 * @param {{ name, stage, stageValue, breached: boolean, plannedEndUtc, percentage }[]|null} slas null when they could not be read
 * @returns {{ kind: 'breached'|'running'|'paused'|'missed'|'met'|'none'|'unknown', text: string, tone: ''|'warn'|'danger', leftMs: number|null, name: string }}
 */
export function pickSla(slas, now) {
  if (!Array.isArray(slas)) return { kind: 'unknown', text: '', tone: '', leftMs: null, name: '' };
  const live = slas.filter((s) => s && typeof s === 'object' && !isCancelled(s));
  if (!live.length) return { kind: 'none', text: '', tone: '', leftMs: null, name: '' };
  const open = live.filter((s) => !isFinished(s));
  const breachedOpen = open.find((s) => s.breached === true);
  if (breachedOpen) return { kind: 'breached', text: 'SLA breached', tone: 'danger', leftMs: null, name: text(breachedOpen.name) };
  const running = open
    .filter((s) => !isPaused(s))
    .map((s) => ({ s, end: parseSnTime(s.plannedEndUtc) }))
    .filter((x) => Number.isFinite(x.end))
    .sort((a, b) => a.end - b.end)[0];
  if (running) {
    const left = running.end - now;
    if (left <= 0) return { kind: 'breached', text: 'SLA past due', tone: 'danger', leftMs: left, name: text(running.s.name) };
    return { kind: 'running', text: `SLA ${shortSpan(left)}`, tone: left < SOON ? 'warn' : '', leftMs: left, name: text(running.s.name) };
  }
  const paused = open.find(isPaused);
  if (paused) return { kind: 'paused', text: 'SLA paused', tone: '', leftMs: null, name: text(paused.name) };
  if (open.length) return { kind: 'running', text: 'SLA running', tone: '', leftMs: null, name: text(open[0].name) };
  const missed = live.find((s) => s.breached === true);
  if (missed) return { kind: 'missed', text: 'SLA was breached', tone: '', leftMs: null, name: text(missed.name) };
  return { kind: 'met', text: '', tone: '', leftMs: null, name: '' };
}

/**
 * How long the customer has been waiting for an answer: the customer wrote last, and nobody from support replied since. Waiting runs
 * from the FIRST of the customer's messages that are still unanswered.
 * @returns {{ waiting: boolean, sinceMs: number|null, approx: boolean, messages: number, known: boolean }}
 *   known: false when the customer could not be told apart from the agents (then nothing is claimed)
 */
export function customerWaiting(pack, now) {
  const ids = identities(pack);
  const none = { waiting: false, sinceMs: null, approx: false, messages: 0, known: ids.known };
  if (!ids.known) return none;
  const comments = (Array.isArray(pack?.journal) ? pack.journal : []).filter((e) => e && e.type === 'comment' && text(e.text));
  let run = [];
  for (const entry of comments) {
    const role = roleOfEntry(entry, ids);
    if (role === 'customer') run.push(entry);
    else if (role === 'support') run = [];
    else run = []; // an author that cannot be told: claim nothing about the messages before it
  }
  if (!run.length) return none;
  const last = comments[comments.length - 1];
  if (run[run.length - 1] !== last) return none;
  const first = noteInstant(run[0], pack);
  if (!Number.isFinite(first.ms)) return { ...none, waiting: true, messages: run.length };
  return { waiting: true, sinceMs: Math.max(0, now - first.ms), approx: first.approx, messages: run.length };
}

/** "Customer waiting 4 d" ("about" when the time may be off by the time zone). '' when nobody is waiting. */
export function waitingText(wait) {
  if (!wait?.waiting) return '';
  if (wait.sinceMs === null) return 'Customer waiting for a reply';
  if (wait.approx) return wait.sinceMs >= TIME.DAY ? `Customer waiting about ${Math.round(wait.sinceMs / TIME.DAY)} d` : 'Customer waiting today';
  return `Customer waiting ${shortSpan(wait.sinceMs)}`;
}

/** The owner as the glance says it: the assignee, else the group, else "Unassigned" (only when the record was readable). */
export function ownerText(fields) {
  const who = text(fields?.assigned_to);
  const group = text(fields?.assignment_group);
  if (who) return who;
  if (group) return `${group} (no one assigned)`;
  return 'Unassigned';
}

/**
 * Everything the Glance draws.
 * @param {{ record: object, header: object|null, headPhase: string, answer: object|null, now: number }} input
 *   answer: the `glance` read ({ pack, slas: { items, access }, vip, outage }) or null while it loads or when it failed
 * @returns {{ number, title, titleKind, vip: boolean, line2: {text, tone}[], line3: string[], outage: object|null, sla: object }}
 */
export function buildGlance({ record, header, headPhase, answer, now }) {
  const pack = answer?.pack && typeof answer.pack === 'object' ? answer.pack : null;
  const fields = pack?.fields || {};
  const card = describeHeader({ phase: headPhase, header }, record);
  // The header read decides the title while it is the only read; the glance read's own fields fill in what the header lacks.
  const title = card.titleKind === 'text' || !text(fields.short_description) ? card.title : text(fields.short_description);
  const titleKind = card.titleKind === 'text' || !text(fields.short_description) ? card.titleKind : 'text';
  const state = text(header?.state) || text(fields.state);
  const priority = text(header?.priority) || text(fields.priority);
  const sla = pickSla(Array.isArray(answer?.slas?.items) && slaReadable(answer.slas) ? answer.slas.items : null, now);

  const line2 = [state && { text: state, tone: '' }, priority && { text: priority, tone: '' }, sla.text && { text: sla.text, tone: sla.tone }].filter(Boolean);

  const line3 = [];
  if (pack && !pack.sensitive) line3.push(ownerText(fields));
  const wait = pack ? customerWaiting(pack, now) : null;
  const waiting = waitingText(wait);
  if (waiting) line3.push(waiting);
  const updated = pack ? storedTime(pack, 'sys_updated_on') : NaN;
  if (Number.isFinite(updated)) line3.push(`Updated ${agoText(Math.max(0, now - updated))}`);

  const outage = pack && answer?.outage ? outageSignal(answer.outage, pack) : null;
  return {
    number: card.number,
    title,
    titleKind,
    vip: answer?.vip?.status === 'yes',
    line2,
    line3,
    waiting: wait,
    sla,
    outage: outage && outage.over ? outage : null,
  };
}

// The SLA list is a fact only when task_sla could be read (an empty list from a table the user cannot see proves nothing).
const slaReadable = (slas) => (Array.isArray(slas?.access) ? slas.access : []).every((a) => a?.status === 'ok' || a?.status === 'empty');

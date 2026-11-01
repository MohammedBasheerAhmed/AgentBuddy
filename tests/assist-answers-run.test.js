import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunController, IDLE_RUN, isBusyPhase } from '../src/sidepanel/useRun.js';

// The run controller behind useRun and the answer area (src/sidepanel/useRun.js createRunController), with every outside step
// replaced: the order of the steps, the try count after a busy provider, what a short check is audited as, and that a run the view
// gave up on never sends.

const page = { tabId: 7, href: 'https://acme.service-now.com/incident.do?sys_id=x', record: { table: 'incident', sysId: 'a'.repeat(32), number: 'INC0010001' } };
const eff = (values = {}) => ({ values: { previewMode: 'never', previewSeen: [], provider: 'anthropic', models: {}, ...values }, policy: {}, apiKey: 'sk-ant-test' });

function harness({ preview = false, values = {}, sleeps = 0, holdRead = null } = {}) {
  const log = [];
  const states = [];
  const deps = {
    ensureAiPermission: async () => log.push('permission'),
    prepareRun: ({ feature, pack }) => {
      log.push('prepare');
      return { feature, pack, request: { preview: 'x' }, firewall: { scan: () => [] }, stats: { counts: {} } };
    },
    previewRequired: () => preview,
    auditBlocked: async () => log.push('audit-blocked'),
    auditCancelled: async () => log.push('audit-cancelled'),
    createFirewall: () => ({}),
    logAudit: async () => {},
    sendChat: async (config, request, opts) => {
      for (let i = 0; i < sleeps; i++) await opts.sleep(1, opts.signal);
      return { content: 'ok' };
    },
    executeRun: async ({ prepared, previewShown, sendChat, signal }) => {
      log.push(`send:${previewShown ? 'shown' : 'skipped'}`);
      await sendChat({}, prepared.request, { signal });
      return { text: 'The answer.', notice: '' };
    },
  };
  const ctl = createRunController({
    getEnv: () => ({ page, eff: eff(values), record: page.record }),
    onChange: (s) => states.push(s),
    deps,
    tokensUsed: async () => 0,
    rememberSeen: (seen) => log.push(`seen:${seen.join(',')}`),
  });
  const getPack = async () => {
    log.push('read');
    if (holdRead) await holdRead;
    return { table: 'incident', sysId: 'a'.repeat(32), fields: {}, people: [], journal: [], related: {}, access: [] };
  };
  return { ctl, log, states, getPack };
}

test('the steps in order: permission, read, prepare, send; the answer and the record it is for', async () => {
  const h = harness();
  await h.ctl.run({ id: 'record-summary' }, { getPack: h.getPack, meta: { label: 'x' } });
  assert.deepEqual(h.log, ['permission', 'read', 'prepare', 'send:skipped']);
  const s = h.ctl.getState();
  assert.equal(s.phase, 'done');
  assert.equal(s.result, 'The answer.');
  assert.deepEqual(s.meta, { label: 'x' });
  assert.deepEqual(s.source, { expect: { table: 'incident', sysId: 'a'.repeat(32) }, number: 'INC0010001' });
  assert.deepEqual(h.states.map((x) => x.phase).filter((p, i, a) => p !== a[i - 1]), ['reading', 'sending', 'done']);
  assert.ok(h.states.find((x) => x.phase === 'sending').since > 0, 'the clock starts when the AI is asked');
});

test('a busy provider: each new try is counted, so the panel can say "try 2 of 3"', async () => {
  const h = harness({ sleeps: 2 });
  await h.ctl.run({ id: 'record-summary' }, { getPack: h.getPack });
  const tries = h.states.filter((s) => s.phase === 'sending').map((s) => s.attempt);
  assert.deepEqual([...new Set(tries)], [1, 2, 3]);
  assert.equal(IDLE_RUN.attempts, 3);
});

test('the check before sending: confirmed in full is audited "shown", the short check "skipped"; "first" mode remembers it', async () => {
  const full = harness({ preview: true, values: { previewMode: 'first' } });
  await full.ctl.run({ id: 'next-best-action' }, { getPack: full.getPack });
  assert.equal(full.ctl.getState().phase, 'preview');
  assert.ok(isBusyPhase('preview'));
  await full.ctl.confirmPreview({ shown: true });
  assert.ok(full.log.includes('send:shown'));
  assert.ok(full.log.includes('seen:next-best-action'));
  const short = harness({ preview: true, values: { previewMode: 'first', previewSeen: ['next-best-action'] } });
  await short.ctl.run({ id: 'next-best-action' }, { getPack: short.getPack });
  await short.ctl.confirmPreview({ shown: false });
  assert.ok(short.log.includes('send:skipped'));
  // a click event (the old way of calling it) counts as shown
  const old = harness({ preview: true });
  await old.ctl.run({ id: 'x' }, { getPack: old.getPack });
  await old.ctl.confirmPreview({ type: 'click' });
  assert.ok(old.log.includes('send:shown'));
});

test('Cancel in the check is audited and sends nothing; a second Send does nothing', async () => {
  const h = harness({ preview: true });
  await h.ctl.run({ id: 'x' }, { getPack: h.getPack });
  await h.ctl.cancelPreview();
  assert.ok(h.log.includes('audit-cancelled'));
  assert.ok(!h.log.some((l) => l.startsWith('send')));
  assert.equal(h.ctl.getState().phase, 'idle');
  await h.ctl.confirmPreview();
  assert.ok(!h.log.some((l) => l.startsWith('send')));
});

test('a run the view gave up on while it was still reading never sends (dispose, reset, a newer run)', async () => {
  let release;
  const held = new Promise((r) => {
    release = r;
  });
  const h = harness({ holdRead: held });
  const running = h.ctl.run({ id: 'x' }, { getPack: h.getPack });
  h.ctl.dispose();
  release();
  await running;
  assert.ok(!h.log.includes('prepare') && !h.log.some((l) => l.startsWith('send')), h.log.join(','));
});

test('an error keeps its code for the next step; Try again runs the same thing again', async () => {
  const h = harness();
  let fail = true;
  const getPack = async () => {
    if (fail) {
      fail = false;
      const err = new Error('The record could not be read.');
      err.code = 'ACCESS_DENIED';
      throw err;
    }
    return { table: 'incident', sysId: 'a'.repeat(32), fields: {}, people: [], journal: [], related: {}, access: [] };
  };
  await h.ctl.run({ id: 'x' }, { getPack });
  assert.equal(h.ctl.getState().phase, 'error');
  assert.equal(h.ctl.getState().errorCode, 'ACCESS_DENIED');
  assert.equal(h.ctl.getState().error, 'The record could not be read.');
  await h.ctl.again();
  assert.equal(h.ctl.getState().phase, 'done');
  assert.equal(h.ctl.getState().errorCode, '');
});

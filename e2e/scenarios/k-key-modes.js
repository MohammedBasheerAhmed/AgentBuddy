// k. Where the AI key lives. Three modes (local, memory-only, passphrase-encrypted): each must work end to end for the side
//    panel, and the encrypted one must never keep the key in clear on disk and must lock again after a "browser restart"
//    (chrome.storage.session is emptied then).
const { findLeaks } = require('../leaks.js');
const { clickButton, waitForText, runFeature, waitForRecord } = require('../ui.js');

const PASS = 'correct horse battery staple';

module.exports = {
  id: 'k',
  title: 'Key storage modes: memory-only, encrypted with a passphrase, locked after restart, unlock',
  async run(t, ctx) {
    const { ai, inst, data, KEYS } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.ensureEnabled();
    const slot = KEYS.keyFor('custom');
    const encSlot = 'agentbuddy_keyenc_custom';
    const base = { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, piiMode: 'standard', previewMode: 'never', instances: [inst.origin] };
    const keys = async () => ({ ...(await ctx.ext(async (a, b) => ({ local: await chrome.storage.local.get([a, b]), session: await chrome.storage.session.get([a]) }), slot, encSlot)), vault: await ctx.vault('get', [slot, encSlot]) });

    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-classic');

    // ---- 1. Memory-only: the key exists only in chrome.storage.session ---------------------------------------------------
    await ctx.configure({ ...base, keyStorage: 'session' });
    await ctx.ext(async (s, e) => { await chrome.storage.local.remove([s, e]); }, slot, encSlot);
    await ctx.vault('remove', [slot, encSlot]);
    await ctx.ext(async (s, k) => { await chrome.storage.session.set({ [s]: k }); }, slot, ai.key);
    let panel = await ctx.openPanel();
    await waitForRecord(panel.page);
    const run1 = await runFeature(panel.page, /^Summarise this ticket/);
    t.check('memory-only key: the panel finds it and the request goes out with it', Boolean(run1.result) && ai.requests.length === 1 && ai.requests[0].auth === `Bearer ${ai.key}`, run1.error || '');
    const memOnly = await keys();
    t.check('memory-only key: nothing about it on disk (chrome.storage.local or the vault)', !memOnly.local[slot] && !memOnly.local[encSlot] && !memOnly.vault[slot] && !memOnly.vault[encSlot]);
    await panel.close();

    // ---- 2. Encrypted: save through the real settings page ---------------------------------------------------------------
    const page = await ctx.newPage('options-keys');
    await page.goto(ctx.extUrl('options.html'), { waitUntil: 'load' });
    await page.waitForSelector('#keystorage');
    await page.select('#keystorage', 'encrypted');
    await page.waitForSelector('#pass');
    await page.type('#key', ai.key, { delay: 5 });
    await page.type('#pass', PASS, { delay: 5 });
    await clickButton(page, /^Save key/);
    await waitForText(page, 'Key saved.', { timeout: 15000 });
    let stored = await keys();
    t.check('encrypted key: an encrypted blob is in the vault and the clear key is on disk nowhere', Boolean(stored.vault[encSlot]?.ct) && !stored.vault[slot] && !stored.local[slot] && !stored.local[encSlot] && !JSON.stringify({ l: stored.local, v: stored.vault }).includes(ai.key), JSON.stringify(Object.keys(stored.vault[encSlot] || {})));
    t.check('encrypted key: unlocked for this browser session (clear key only in session storage)', stored.session[slot] === ai.key);

    // ---- 3. "Browser restart": session storage is emptied, the key is locked ---------------------------------------------------
    await ctx.ext(async (s) => { await chrome.storage.session.remove([s]); }, slot);
    await waitForText(page, /Passphrase to unlock the saved key/, { timeout: 8000 }).catch(() => {}); // the page redraws on a storage change
    await ticket.bringToFront(); // the panel reads the active tab: the ticket, not the settings page
    panel = await ctx.openPanel();
    await waitForRecord(panel.page);
    const lockedText = await panel.text();
    t.check('locked: the panel says the key is locked and offers no AI action', /Your AI key is locked/.test(lockedText) && (await panel.page.$$eval('button.ab-feature', (bs) => bs.every((b) => b.disabled))));
    ai.requests.length = 0;

    // Wrong passphrase first, then the right one, in the settings page.
    await page.bringToFront();
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#unlock');
    await page.type('#unlock', 'not the passphrase', { delay: 5 });
    await clickButton(page, /^Unlock$/);
    await waitForText(page, /Wrong passphrase/, { timeout: 15000 });
    t.check('wrong passphrase: a plain message, still locked', (await keys()).session[slot] === undefined);
    await page.focus('#unlock');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('#unlock', PASS, { delay: 5 });
    await clickButton(page, /^Unlock$/);
    await waitForText(page, 'Unlocked for this browser session.', { timeout: 15000 });
    t.check('right passphrase: unlocked for this browser session', (await keys()).session[slot] === ai.key);

    await ticket.bringToFront();
    await ctx.sleep(600); // the panel follows the storage change
    const run2 = await runFeature(panel.page, /^Summarise this ticket/);
    t.check('after unlocking, the panel works again and the request carries the decrypted key', Boolean(run2.result) && ai.requests.length === 1 && ai.requests[0].auth === `Bearer ${ai.key}`, run2.error || '');
    t.check('the request is masked in every key mode', ai.requests.every((r) => findLeaks(r.raw, data).critical.length === 0));
    await panel.close();
    await page.close();

    // Back to the plain local key the other scenarios expect.
    await ctx.configure({ keyStorage: 'local', previewMode: 'always' });
    await ctx.ext(async (s, e) => { await chrome.storage.local.remove([e]); await chrome.storage.session.remove([s]); }, slot, encSlot);
    await ctx.vault('remove', [slot, encSlot]);
    await ctx.ext(async (s, k) => { await chrome.storage.local.set({ [s]: k }); }, slot, ai.key); // moved into the vault on first read
    await ticket.close();
  },
};

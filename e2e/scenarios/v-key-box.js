// v. The key box in Settings: a person can see that the key was really taken. Typed text can be shown; what is saved shows as a short
//    preview and a length (the whole key only on request, and hidden again); "Test connection" tests the key that was typed even if
//    it is not saved yet; a pasted key loses its quotes and "Bearer ".
const { clickButton, waitForText } = require('../ui.js');

module.exports = {
  id: 'v',
  title: 'Settings key box: show the typed key, saved-key preview, test before saving, paste clean-up',
  async run(t, ctx) {
    const { ai, KEYS } = ctx;
    ai.reset();
    await ctx.ensureEnabled();
    const slot = KEYS.keyFor('custom');
    const storedKey = async () => (await ctx.vault('get', [slot]))[slot] || '';

    await ctx.ext(async (settingsKey, keySlot, baseUrl) => {
      await chrome.storage.local.remove([keySlot]);
      const cur = (await chrome.storage.local.get(settingsKey))[settingsKey] || {};
      await chrome.storage.local.remove(['agentbuddy_key_deepseek']);
      await chrome.storage.local.set({ [settingsKey]: { ...cur, provider: 'deepseek', baseUrls: { custom: baseUrl }, models: { custom: 'test-model' }, keyStorage: 'local' } });
    }, KEYS.settings, slot, ai.baseUrl);
    await ctx.vault('remove', [slot, 'agentbuddy_key_deepseek', 'agentbuddy_keyenc_deepseek']);

    const page = await ctx.newPage('options-key-box');
    await page.goto(ctx.extUrl('options.html'), { waitUntil: 'load' });
    await page.waitForSelector('#key');
    const text = () => page.evaluate(() => document.body.innerText);

    // A provider that needs a key (DeepSeek), nothing saved, nothing typed: the page says so, and Test connection explains instead of
    // sending anything or asking the browser for permission. (A server on this computer needs no key, so it is not used for this.)
    t.check('no key yet: the page says no key is saved for DeepSeek', /No key is saved for DeepSeek/.test(await page.$eval('#key-saved', (el) => el.innerText)));
    await clickButton(page, /^Test connection/);
    await waitForText(page, /There is no DeepSeek key yet\. Paste it in the key box, press Save key/, { timeout: 8000 });
    await ctx.sleep(300);
    t.check('Test connection with no key at all: a plain sentence naming what to do, and nothing was sent', ai.requests.length === 0 && !ctx.net.some((n) => /api\.deepseek\.com/.test(n.url)), `${ai.requests.length} requests`);

    // The rest uses the fake AI server, reached through "Other (OpenAI-compatible server)".
    await page.select('#provider', 'custom');
    await page.waitForFunction(() => /Other/.test(document.querySelector('label[for="key"]')?.innerText || '') || /No key is saved for Other/.test(document.querySelector('#key-saved')?.innerText || ''), { timeout: 8000 });

    // Typing: dots by default, the text on request, and a reminder that it is not saved yet.
    await page.type('#key', ai.key, { delay: 5 });
    t.check('the typed key is hidden (dots) until asked', (await page.$eval('#key', (el) => el.type)) === 'password');
    t.check('the page says the typed key is not saved yet, with its length', new RegExp(`Typed, not saved yet \\(${ai.key.length} characters\\)`).test(await page.$eval('#key-unsaved', (el) => el.innerText)));
    await clickButton(page, /^Show$/);
    t.check('Show: the box now shows exactly what was typed', (await page.$eval('#key', (el) => el.type)) === 'text' && (await page.$eval('#key', (el) => el.value)) === ai.key);
    await clickButton(page, /^Hide$/);
    t.check('Hide: back to dots', (await page.$eval('#key', (el) => el.type)) === 'password');

    // Test before saving: the typed key is the one that is tried, and the page says it is not kept.
    await clickButton(page, /^Test connection/);
    await waitForText(page, /Connected\. The model answered/, { timeout: 15000 });
    t.check('Test connection with a typed, unsaved key: connected, and it says the key is not saved yet', /This key is not saved yet: press Save key to keep it\./.test(await text()));
    t.check('the AI received the typed key', ai.requests.length === 1 && ai.requests[0].auth === `Bearer ${ai.key}`, ai.requests[0]?.auth || 'no request');
    t.check('testing did not save the key', (await storedKey()) === '');

    // Save: the page shows what it took, never the whole key unless asked.
    await clickButton(page, /^Save key/);
    await waitForText(page, 'Key saved.', { timeout: 8000 });
    await page.waitForFunction(() => /Saved:/.test(document.querySelector('#key-saved')?.innerText || ''), { timeout: 8000 });
    const saved = await page.$eval('#key-saved', (el) => el.innerText);
    t.check('after saving: "Saved:", the length and where it is kept', saved.includes(`(${ai.key.length} characters)`) && /kept in this browser/.test(saved), saved.replace(/\s+/g, ' '));
    t.check('the preview shows the ends of the key, not the whole of it', saved.includes(`${ai.key.slice(0, 4)}…${ai.key.slice(-4)}`) && !(await text()).includes(ai.key));
    t.check('the typing box was emptied after saving', (await page.$eval('#key', (el) => el.value)) === '');
    t.check('and it is stored', (await storedKey()) === ai.key);

    // The whole saved key, on request.
    t.check('the saved key is not on the page until asked', (await page.$('#key-full')) === null);
    await clickButton(page, /^Show saved key/);
    await page.waitForSelector('#key-full', { timeout: 5000 });
    t.check('Show saved key: the whole saved key is shown, exactly', (await page.$eval('#key-full', (el) => el.innerText)) === ai.key);
    await clickButton(page, /^Hide saved key/);
    await ctx.sleep(200);
    t.check('Hide saved key: gone again', (await page.$('#key-full')) === null && !(await text()).includes(ai.key));

    // Test with the saved key (nothing typed): it is the saved one that is used.
    ai.reset();
    await clickButton(page, /^Test connection/);
    await waitForText(page, /Connected\. The model answered/, { timeout: 15000 });
    t.check('Test connection with a saved key and nothing typed: uses the saved key, no "not saved" remark', ai.requests.length === 1 && ai.requests[0].auth === `Bearer ${ai.key}` && !/not saved yet: press Save key to keep it/.test(await text()));

    // A pasted key: quotes and "Bearer " are not part of it.
    await clickButton(page, /^Remove saved key/);
    await waitForText(page, 'Key removed.', { timeout: 8000 });
    t.check('Remove saved key: the page says none is saved again', await page.waitForFunction(() => /No key is saved for/.test(document.querySelector('#key-saved')?.innerText || ''), { timeout: 8000 }).then(() => true, () => false));
    await page.type('#key', `  "Bearer ${ai.key}"  `, { delay: 5 });
    await clickButton(page, /^Save key/);
    await waitForText(page, 'Key saved.', { timeout: 8000 });
    t.check('a pasted key with quotes, "Bearer " and spaces is saved clean', (await storedKey()) === ai.key, JSON.stringify(await storedKey()));

    await page.close();
  },
};

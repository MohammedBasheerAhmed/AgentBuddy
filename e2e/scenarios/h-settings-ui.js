// h. The settings page, driven like a person would: choose the provider, type the address, model and key, save, and press
//    "Test connection". The test goes through the PII firewall like everything else.
const { findLeaks } = require('../leaks.js');
const { clickButton, waitForText } = require('../ui.js');

module.exports = {
  id: 'h',
  title: 'Settings page: configure the AI provider through the real UI and test the connection',
  async run(t, ctx) {
    const { ai, data, KEYS } = ctx;
    ai.reset();
    await ctx.ensureEnabled();

    // Start from a state where nothing is configured for the custom provider.
    await ctx.ext(async (settingsKey, keySlot) => {
      await chrome.storage.local.remove([keySlot]);
      const cur = (await chrome.storage.local.get(settingsKey))[settingsKey] || {};
      await chrome.storage.local.set({ [settingsKey]: { ...cur, provider: 'anthropic', baseUrls: {}, models: {}, keyStorage: 'local' } });
    }, KEYS.settings, KEYS.keyFor('custom'));

    const page = await ctx.newPage('options-ui');
    await page.goto(ctx.extUrl('options.html'), { waitUntil: 'load' });
    await page.waitForSelector('#provider');
    await page.select('#provider', 'custom');
    await page.waitForSelector('#baseurl');

    // "Other (OpenAI-compatible server)" has no public API behind it. With no address, Test connection must refuse: before the
    // fix the provider layer fell back to api.openai.com and the key meant for the person's own server went there.
    await page.type('#key', ai.key, { delay: 5 });
    await clickButton(page, /^Save key/);
    await waitForText(page, 'Key saved.', { timeout: 8000 });
    await clickButton(page, /^Test connection/);
    await waitForText(page, /address of your AI server/, { timeout: 8000 });
    await ctx.sleep(500);
    t.check('custom provider without an address: Test connection refuses with a plain sentence and sends nothing', ai.requests.length === 0 && !ctx.net.some((n) => /api\.openai\.com/.test(n.url)), ctx.net.filter((n) => /api\.openai\.com/.test(n.url)).map((n) => `${n.method} ${n.url}`).join(' | '));

    // Typing quickly (a keystroke every 8 ms): every keystroke used to be saved and the box redrawn from storage, which dropped
    // characters (an address came out as "htp://ocalhot:5533/1").
    await page.type('#baseurl', ai.baseUrl, { delay: 8 });
    await page.waitForSelector('#model');
    await page.type('#model', 'test-model', { delay: 8 });
    await page.$eval('#model', (el) => el.blur()); // leaving the box saves it at once
    await ctx.sleep(400);

    let settings = await ctx.settings();
    t.check('provider, address and model typed fast in the UI reach storage intact (no dropped keystrokes)', settings.provider === 'custom' && settings.baseUrls?.custom === ai.baseUrl && settings.models?.custom === 'test-model', JSON.stringify({ p: settings.provider, b: settings.baseUrls, m: settings.models }));
    t.check('what is typed is still what the boxes show', (await page.$eval('#baseurl', (el) => el.value)) === ai.baseUrl && (await page.$eval('#model', (el) => el.value)) === 'test-model');

    t.check('the key field is a password field', (await page.$eval('#key', (el) => el.type)) === 'password');
    const stored = await ctx.ext((slot) => chrome.storage.local.get(slot), KEYS.keyFor('custom'));
    t.check("the key is stored where the key store's 'local' mode keeps it", stored[KEYS.keyFor('custom')] === ai.key);
    const shown = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll('input')].map((i) => i.value).join(' '));
    t.check('after saving, the key is not shown anywhere on the page', !shown.includes(ai.key));

    await clickButton(page, /^Test connection/);
    await waitForText(page, /Connected\. The model answered/, { timeout: 15000 });
    t.check('"Test connection" reaches the fake AI and reports success', ai.requests.length === 1, `${ai.requests.length} requests`);
    const req = ai.requests[0];
    t.check('the connection test used the saved key and the typed model', req?.auth === `Bearer ${ai.key}` && req.body?.model === 'test-model');
    t.check('the connection test also went through the firewall (sealed system+user messages, no tools)', JSON.stringify((req?.body?.messages || []).map((m) => m.role)) === '["system","user"]' && !req.body.tools && /Rules set by the application/.test(req.raw));
    t.check('the connection test carries no personal data', findLeaks(req?.raw || '', data).critical.length === 0);

    // The "Check what is sent" and privacy selectors write to storage too.
    await page.select('#preview', 'always');
    await page.select('#pii', 'strict');
    await ctx.sleep(300);
    settings = await ctx.settings();
    t.check('the privacy selectors save (preview always, strict mode)', settings.previewMode === 'always' && settings.piiMode === 'strict', `${settings.previewMode} / ${settings.piiMode}`);
    await page.select('#pii', 'standard');
    await ctx.sleep(300);

    // The activity log on the same page: the entries of the whole run, with no content.
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.ab-table, .ab-note');
    const logText = await page.evaluate(() => document.querySelector('.ab-table')?.innerText || '');
    t.check('the activity log table lists actions and outcomes only', /record-summary|reply-draft/.test(logText) && !/Abel|Tuter|555-|4111|Winter2026/.test(logText), logText.replace(/\s+/g, ' ').slice(0, 160));
    await page.close();
  },
};

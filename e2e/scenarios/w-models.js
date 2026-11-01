// w. A company gateway (an OpenAI-style address and a model name such as gpt-5-mini-preprod) and switching models: type the model, load
//    the server's list, pick another in Settings, switch it from the panel (AI Assist half), and the next request uses what was chosen.
const { clickButton, waitForText, runFeature, waitForRecord, openHalf } = require('../ui.js');

module.exports = {
  id: 'w',
  title: 'Company gateway and models: typed model name, load the list, pick in Settings, switch in the panel',
  async run(t, ctx) {
    const { ai, inst, data } = ctx;
    ai.reset();
    inst.setBehaviour();
    await ctx.ensureEnabled();
    await ctx.configure(
      { provider: 'openai', models: {}, modelLists: {}, baseUrls: { openai: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', previewMode: 'never', instances: [inst.origin] },
      { key: { provider: 'openai', value: ai.key } }
    );
    const modelNow = async () => (await ctx.settings()).models?.openai;
    const listingsBefore = ai.listings.length;

    // ---- Settings: the address and the model name a company gives out are typed as they are -----------------------------------
    const page = await ctx.newPage('options-models');
    await page.goto(ctx.extUrl('options.html#ai'), { waitUntil: 'load' }); // the model is on the AI Assist page
    await page.waitForSelector('#model');
    t.check('the provider is "OpenAI / Azure OpenAI / company gateway" with the company address typed in', (await page.$eval('#provider', (el) => el.value)) === 'openai' && (await page.$eval('#baseurl', (el) => el.value)) === ai.baseUrl);
    await page.focus('#model');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.type('#model', 'gpt-5-mini-preprod', { delay: 5 });
    await page.$eval('#model', (el) => el.blur());
    await ctx.sleep(500);
    t.check('a model name that is on no list (gpt-5-mini-preprod) is saved as typed', (await modelNow()) === 'gpt-5-mini-preprod', String(await modelNow()));

    await clickButton(page, /^Test connection/);
    await waitForText(page, /Connected\. The model answered/, { timeout: 15000 });
    const sent = ai.requests.at(-1);
    t.check('the connection test asked the company address for exactly that model, with the key', sent?.body?.model === 'gpt-5-mini-preprod' && sent.auth === `Bearer ${ai.key}`, JSON.stringify([sent?.body?.model, sent?.auth]));
    t.check('a gpt-5 style model is sent without a temperature (those models reject one)', sent && !('temperature' in sent.body), JSON.stringify(Object.keys(sent?.body || {})));

    // ---- Settings: load what the server offers, and pick ------------------------------------------------------------------
    t.check('no list is shown before it is loaded', (await page.$('#model-pick')) === null);
    await page.click('#load-models');
    await waitForText(page, /Found 4 models\./, { timeout: 15000 });
    await page.waitForSelector('#model-pick', { timeout: 5000 });
    const offered = await page.$$eval('#model-pick option', (os) => os.map((o) => o.value));
    t.check('the server was asked once for its list, with only the key (a GET, no body)', ai.listings.length === listingsBefore + 1 && ai.listings.at(-1).auth === `Bearer ${ai.key}` && ai.listings.at(-1).bodyLength === 0, JSON.stringify(ai.listings.at(-1)));
    t.check('the list offers what the server gave, once each, and the model in use', ['gpt-5-mini-preprod', 'gpt-5-mini', 'gpt-5', 'text-embedding-3-small'].every((id) => offered.includes(id)) && new Set(offered).size === offered.length, offered.join(', '));
    t.check('the list was saved as names only', JSON.stringify((await ctx.settings()).modelLists?.openai) === JSON.stringify(['gpt-5', 'gpt-5-mini', 'gpt-5-mini-preprod', 'text-embedding-3-small']), JSON.stringify((await ctx.settings()).modelLists));
    await page.select('#model-pick', 'gpt-5');
    await ctx.sleep(500);
    t.check('picking from the list changes the model, and the box shows it', (await modelNow()) === 'gpt-5' && (await page.$eval('#model', (el) => el.value)) === 'gpt-5', `${await modelNow()} / ${await page.$eval('#model', (el) => el.value)}`);

    // A server that gives no list: a plain sentence, the typed name still works.
    ai.setModels([]);
    await page.click('#load-models');
    await waitForText(page, /answered, but with no models\. Type the model name instead\./, { timeout: 15000 });
    t.check('a server that lists nothing: a plain sentence, and the model in use is untouched', (await modelNow()) === 'gpt-5');
    ai.setModels(['gpt-5-mini-preprod', 'gpt-5-mini', 'gpt-5', 'text-embedding-3-small']);

    // ---- The panel: switch without opening Settings (round 3: the switch sits in the Ticket screen's AI Assist half) -----------
    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-classic');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForRecord(p);
    await openHalf(p, 'assist');
    const switchSel = 'select[aria-label="AI model"]';
    await p.waitForSelector(switchSel, { timeout: 8000 });
    const headerOptions = await p.$$eval(`${switchSel} option`, (os) => os.map((o) => o.value));
    t.check('the panel offers the model in use and the loaded ones, with the one in use selected', (await p.$eval(switchSel, (el) => el.value)) === 'gpt-5' && ['gpt-5', 'gpt-5-mini', 'gpt-5-mini-preprod'].every((id) => headerOptions.includes(id)), headerOptions.join(', '));
    await p.select(switchSel, 'gpt-5-mini-preprod');
    await ctx.sleep(600);
    t.check('switching in the panel saves the choice', (await modelNow()) === 'gpt-5-mini-preprod', String(await modelNow()));
    t.check('...and the switch follows (and Settings shows it too after a reload)', (await p.$eval(switchSel, (el) => el.value)) === 'gpt-5-mini-preprod');
    const before = ai.requests.length;
    const run = await runFeature(p, /^Summarise this ticket/);
    t.check('the next run uses the model chosen in the panel', Boolean(run.result) && ai.requests.length === before + 1 && ai.requests.at(-1).body.model === 'gpt-5-mini-preprod', run.error || ai.requests.at(-1)?.body?.model || '');

    await panel.close();
    await ticket.close();
    await page.close();
  },
};

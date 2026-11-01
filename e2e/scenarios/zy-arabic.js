// zy. Arabic (TRACKER R6): the panel, the settings page and the Team page in Arabic, right to left. Every screen and half is opened with
//     the language set to Arabic and checked: the page says lang="ar" dir="rtl", nothing scrolls sideways at 320 px, the text is Arabic
//     (no English word is left that is not ticket data, a brand or a code), and the language can be changed back and forth while the
//     panel is open. Screenshots of each view are kept next to the run's other files (AB_E2E_TMP) for a person to look at.
const { auditPage } = require('../a11y.js');
const { barDriver } = require('../barDriver.js');
const { prepare } = require('../common.js');
const { openScreen, openHalf, waitForText } = require('../ui.js');

// English words that may stay in the Arabic: names of products and standards, units.
const OK_WORDS = new Set(
  ('agent buddy servicenow chrome edge google microsoft deepseek openai anthropic claude azure gemini mistral groq openrouter ollama ' +
    'localhost http https ctrl workspace workspaces portal javascript sysid').split(/\s+/)
);

module.exports = {
  id: 'zy',
  title: 'Arabic: every screen and half right to left, no English text left over, the language changes while the panel is open',
  timeoutMs: 240000,
  async run(t, ctx) {
    const { data } = ctx;
    await prepare(ctx);
    await ctx.configure({ language: 'ar', profiles: ['it', 'lead', 'km'], profilesConfirmed: true, halves: {} });
    // The words of the fake tickets are data, not interface: a word that appears in them is allowed.
    const vocabulary = [...new Set((JSON.stringify(data.buildTables()).match(/[A-Za-z][A-Za-z'’-]{3,}/g) || []).map((w) => w.toLowerCase()))];

    const ticket = await ctx.openInstancePage(`/incident.do?sys_id=${data.INCIDENT_ID}`, 'ticket-arabic');
    const panel = await ctx.openPanel();
    const p = panel.page;
    await waitForText(p, data.INCIDENT_NUMBER, { timeout: 25000 });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

    /** What the page looks like to a person who reads Arabic: direction, language, sideways scroll, English left over. */
    const inspect = (page) =>
      page.evaluate(
        (vocab, ok) => {
          const known = new Set(vocab);
          const okWords = new Set(ok);
          const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
          const english = [];
          const check = (text, where) => {
            const bad = (text.replace(/\b[A-Za-z_]+\/[A-Za-z_]+\b/g, ' ').match(/[A-Za-z][A-Za-z'’-]{3,}/g) || []).filter((w) => !known.has(w.toLowerCase()) && !okWords.has(w.toLowerCase()));
            if (bad.length) english.push(`${where}: ${text.replace(/\s+/g, ' ').trim().slice(0, 70)} -> ${bad.slice(0, 3).join(', ')}`);
          };
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const el = n.parentElement;
            if (!el || !shown(el) || el.closest('script, style, [data-ltr], .ab-mono, code, pre, textarea')) continue;
            check(n.textContent, 'text');
          }
          for (const el of document.querySelectorAll('[aria-label], [title], [placeholder]')) {
            if (!shown(el) || el.closest('[data-ltr], .ab-mono, code')) continue;
            for (const attr of ['aria-label', 'title', 'placeholder']) if (el.getAttribute(attr)) check(el.getAttribute(attr), attr);
          }
          const root = document.documentElement;
          return { lang: root.lang, dir: root.dir, scroll: root.scrollWidth - window.innerWidth, english: [...new Set(english)] };
        },
        vocabulary,
        [...OK_WORDS]
      );

    const view = async (page, label, { shot = true } = {}) => {
      await settle();
      const r = await inspect(page);
      t.check(`Arabic / ${label}: lang="ar" dir="rtl"`, r.lang === 'ar' && r.dir === 'rtl', `${r.lang} ${r.dir}`);
      t.check(`Arabic / ${label}: no English text left over`, r.english.length === 0, r.english.slice(0, 3).join(' || '));
      for (const line of r.english.slice(0, 30)) console.log(`        [Arabic / ${label}] ${line}`);
      // the same audit as scenario zz (contrast, names, labels, focus, target size ...), in Arabic
      await page.keyboard.press('Shift');
      const found = await page.evaluate(auditPage, {});
      t.check(`Arabic / ${label}: no accessibility or colour problem`, found.length === 0, found.slice(0, 2).map((x) => `${x.rule}: ${x.where}: ${x.detail}`).join(' || '));
      for (const x of found.slice(0, 20)) console.log(`        [Arabic / ${label}] ${x.rule}: ${x.where}: ${x.detail}`);
      if (shot) await ctx.shot(page, `arabic-${label.replace(/[^a-z0-9]+/gi, '-')}`);
      return r;
    };

    // ---- every screen and half in Arabic --------------------------------------------------------------------------------------------------
    const stops = [
      ['Ticket', 'insights', /Related|المرتبطة/, 'Ticket Insights'],
      ['Ticket', 'assist', null, 'Ticket AI Assist'],
      ['My work', 'insights', null, 'My work'],
      ['Team', 'insights', null, 'Team Insights'],
      ['Team', 'assist', null, 'Team AI Assist'],
      ['Write', 'insights', null, 'Write Insights'],
      ['Write', 'assist', null, 'Write AI Assist'],
      ['Knowledge', 'insights', null, 'Knowledge Insights'],
      ['Knowledge', 'assist', null, 'Knowledge AI Assist'],
    ];
    for (const [screen, half, , label] of stops) {
      await openScreen(p, screen).catch(() => openScreen(p, screen === 'My work' ? 'My work' : screen));
      await openHalf(p, half);
      await view(p, label);
    }

    // ---- 320 px: nothing scrolls sideways in Arabic either ---------------------------------------------------------------------------------
    const cdp = await p.createCDPSession();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 820, deviceScaleFactor: 1, mobile: false });
    for (const [screen, half, , label] of stops) {
      await openScreen(p, screen);
      await openHalf(p, half);
      await settle();
      const r = await inspect(p);
      t.check(`Arabic at 320 px / ${label}: does not scroll sideways`, r.scroll <= 1, `${r.scroll} px too wide`);
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.detach().catch(() => {});

    // ---- the settings page and the team page ------------------------------------------------------------------------------------------------
    const settings = await ctx.newPage('settings-arabic');
    await settings.goto(ctx.extUrl('options.html'), { waitUntil: 'load' });
    await settings.waitForSelector('.ab-page', { timeout: 10000 });
    await view(settings, 'Settings Basics');
    await settings.click('#ab-settings-tab-ai');
    await view(settings, 'Settings AI Assist');
    await settings.close();

    // ---- the bar on the ServiceNow page: the worker tells it the language, and the labels of its actions come in it -----------------------
    const arabic = /[؀-ۿ]/;
    const bar = await barDriver(ticket);
    await ctx.waitUntil('the bar to appear', async () => (await bar.view()).visible, { timeout: 20000 });
    const handle = await bar.find('handle');
    const barRoot = await bar.find('bar');
    t.check('Arabic / the bar on the page: right to left, and the tab is named in Arabic', barRoot?.attrs.dir === 'rtl' && arabic.test(handle?.attrs['aria-label'] || ''), JSON.stringify({ dir: barRoot?.attrs.dir, label: handle?.attrs['aria-label'] }));
    await bar.click(handle);
    await ctx.waitUntil('the bar to open', async () => (await bar.view()).cardShown, { timeout: 8000 });
    const opened = await bar.view();
    t.check('Arabic / the bar on the page: every action is named in Arabic', opened.actions.length > 0 && opened.actions.every((a) => arabic.test(a)), JSON.stringify(opened.actions));
    const fold = (await bar.elements()).find((e) => e.tag === 'button' && e.cls.split(/s+/).includes('icon'));
    if (fold) await bar.click(fold);

    // ---- changing the language while the panel is open ---------------------------------------------------------------------------------------
    await ctx.configure({ language: 'en' });
    await ctx.waitUntil('the panel to turn to English', async () => (await p.evaluate(() => document.documentElement.dir)) === 'ltr', { timeout: 10000 });
    const english = await p.evaluate(() => ({ lang: document.documentElement.lang, text: document.body.innerText }));
    t.check('changed to English while open: lang="en", dir="ltr", the panel speaks English', english.lang === 'en' && /Ticket|My work|Insights/.test(english.text), english.lang);
    await ctx.configure({ language: 'auto' });
    await ctx.waitUntil('the panel to follow the browser language', async () => (await p.evaluate(() => document.documentElement.lang)) === 'en', { timeout: 10000 });
    t.check('"Same as the browser": the test browser is English, so the panel is English', true);
    await ctx.configure({ language: 'ar' });
    await ctx.waitUntil('the panel to turn to Arabic again', async () => (await p.evaluate(() => document.documentElement.dir)) === 'rtl', { timeout: 10000 });
    t.check('back to Arabic while open: dir="rtl" again', true);

    await ctx.configure({ language: 'en' }); // the next scenarios are in English
    await panel.close();
    await ticket.close();
  },
};

// Draws the leadership-guide pictures.
//
//   node docs/leadership-guide/images/src/make.cjs
//
// Writes one HTML file per picture into this folder, then renders each to a PNG in docs/leadership-guide/images/ with the
// repo's pinned puppeteer-core and the Chrome (or Edge) on this computer (CHROME_PATH overrides). The five screen pictures
// are real screenshots of the built extension against the test ServiceNow (docs/leadership-guide/images/screens/).
const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const OUT = path.join(SRC, '..');

const C = { ink: '#1a1f1d', grey: '#5b6561', line: '#c9d1cd', light: '#f4f6f5', green: '#1d6b52', greenL: '#e6f2ed', amber: '#8a5a00', amberL: '#fff4d6', red: '#b3261e', redL: '#fde8e6', white: '#ffffff' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const page = (w, h, body, extraCss = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{width:${w}px;height:${h}px;font-family:"Segoe UI",system-ui,-apple-system,Inter,sans-serif;color:${C.ink};overflow:hidden;position:relative}
.title{position:absolute;left:60px;top:40px;font-size:36px;font-weight:700;letter-spacing:-.01em}
.sub{position:absolute;left:60px;top:90px;font-size:19px;color:${C.grey}}
${extraCss}
</style></head><body>${body}</body></html>`;

// ---------- SVG helpers ----------
const lines = (arr, x, y, size, color, weight = 400, lh = 1.3, anchor = 'middle') =>
  arr.map((t, i) => `<text x="${x}" y="${y + i * size * lh}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${esc(t)}</text>`).join('');
const box = (x, y, w, h, title, body, o = {}) => {
  const fill = o.fill || C.white, stroke = o.stroke || C.line, tc = o.tc || C.ink, bc = o.bc || C.grey;
  const dash = o.dash ? ' stroke-dasharray="8 6"' : '';
  const tsz = o.tsz || 20, bsz = o.bsz || 16;
  const tl = Array.isArray(title) ? title : [title];
  const ty = y + 14 + tsz;
  const by = ty + (tl.length - 1) * tsz * 1.3 + 12 + bsz;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="${o.sw || 2}"${dash}/>` +
    lines(tl, x + w / 2, ty, tsz, tc, 700) + lines(body || [], x + w / 2, by, bsz, bc, 400);
};
const badge = (cx, cy, n) => `<circle cx="${cx}" cy="${cy}" r="16" fill="${C.green}"/><text x="${cx}" y="${cy + 6}" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${n}</text>`;
const arrow = (d, o = {}) => `<path d="${d}" fill="none" stroke="${o.color || C.green}" stroke-width="${o.sw || 3}" ${o.dash ? 'stroke-dasharray="7 6"' : ''} marker-end="url(#ah${o.red ? 'r' : ''})"/>`;
const defs = `<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.green}"/></marker><marker id="ahr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.red}"/></marker></defs>`;

const pictures = [];

// =====================================================================================================================
// 1. The five screens (real screenshots)
// =====================================================================================================================
{
  const W = 2080, H = 1130;
  const shots = [
    ['ticket', 'Ticket', 'Five rows, one per pain point: understand it, find the fix, same caller, reply, close well.'],
    ['my-work', 'My work', 'Your queue, most urgent first, with what is at risk and who replied.'],
    ['team', 'Team', 'What needs a lead now, who carries the load, causes that keep coming back, and a one-click weekly report.'],
    ['write', 'Write', 'A safe-to-send check before text reaches a customer, plus snippets, replies and emails.'],
    ['knowledge', 'Knowledge', 'Articles matched to the ticket, search, and tools for article quality and gaps.'],
  ];
  const pw = 340, gap = 40, x0 = (W - (5 * pw + 4 * gap)) / 2;
  const ph = Math.round(pw * (1720 / 800));
  const cards = shots.map(([f, name, cap], i) => `
    <div style="position:absolute;left:${x0 + i * (pw + gap)}px;top:150px;width:${pw}px">
      <img src="../screens/${f}.png" style="width:${pw}px;height:${ph}px;display:block;border-radius:14px;border:2px solid ${C.line};box-shadow:0 6px 22px rgba(26,31,29,.12)">
      <div style="margin-top:16px;font-size:22px;font-weight:700;color:${C.green}">${name}</div>
      <div style="margin-top:4px;font-size:16px;line-height:1.35;color:${C.grey}">${esc(cap)}</div>
    </div>`).join('');
  const body = `<div class="title">Five screens, five rows each</div>
    <div class="sub">The side panel sits next to the ServiceNow page. Pick a screen from the bar at the bottom; everything else is one tap away in "All tools".</div>
    ${cards}
    <div style="position:absolute;left:60px;bottom:22px;font-size:15px;color:${C.grey}">Screens captured from the built extension running against a test ServiceNow with sample data. Names and tickets shown are not real.</div>`;
  pictures.push(['01-five-screens', W, H, page(W, H, body)]);
}

// =====================================================================================================================
// 2. Architecture and data flow
// =====================================================================================================================
{
  const W = 1400, H = 1010;
  const y1 = 215, h1 = 150, y2 = 470, h2 = 130, bw = 210;
  const X = [65, 330, 595, 860, 1125];
  let s = defs;
  // zone: browser
  s += `<rect x="305" y="165" width="790" height="470" rx="20" fill="${C.greenL}" stroke="${C.green}" stroke-width="2.5"/>`;
  s += `<text x="330" y="196" font-size="18" font-weight="700" fill="${C.green}">THE PERSON'S BROWSER: everything AgentBuddy does runs here</text>`;
  // outside boxes
  s += `<text x="${X[0] + bw / 2}" y="196" font-size="16" font-weight="700" fill="${C.grey}" text-anchor="middle">OUTSIDE · YOURS</text>`;
  s += `<text x="${X[4] + bw / 2}" y="196" font-size="16" font-weight="700" fill="${C.grey}" text-anchor="middle">OUTSIDE · YOURS</text>`;
  s += box(X[0], y1, bw, h1, ['Your ServiceNow', 'instance'], ['Tickets, knowledge,', 'approvals. Your roles', 'and ACLs apply'], { fill: C.light, stroke: C.ink, sw: 2.5 });
  s += box(X[4], y1, bw, h1, ['Your AI endpoint'], ['Azure OpenAI, company', 'gateway, Anthropic,', 'Gemini, local model…'], { fill: C.light, stroke: C.ink, sw: 2.5 });
  // inside boxes, top row
  s += box(X[1], y1, bw, h1, ['Page reader'], ['Reads the open ticket,', 'GET only, with the', "person's own session"]);
  s += box(X[2], y1, bw, h1, ['Side panel'], ['The five screens, the', 'preview and the answer'], {});
  s += box(X[3], y1, bw, h1, ['PII firewall'], ['Masks names, emails and', 'numbers. Seals the', 'request. Shows the preview'], { stroke: C.green, sw: 3 });
  // bottom row
  s += box(X[0], y2, bw, h2, ['ServiceNow form'], ['The person presses Save'], { fill: C.light, stroke: C.ink, sw: 2.5 });
  s += box(X[1], y2, bw, h2, ['Page bridge'], ['Fills ONE field.', 'Insert has an Undo'], {});
  s += box(X[2], y2, bw, h2, ['Answer'], ['The person reviews it', 'before anything is inserted'], {});
  s += box(X[3], y2, bw, h2, ['Restore on device'], ['Real names and values', 'put back, locally'], { stroke: C.green, sw: 3 });
  // arrows top row
  const ym = y1 + h1 / 2;
  const gapMid = (i) => (X[i] + bw + X[i + 1]) / 2;
  s += arrow(`M${X[0] + bw + 4} ${ym} L${X[1] - 6} ${ym}`);
  s += arrow(`M${X[1] + bw + 4} ${ym} L${X[2] - 6} ${ym}`);
  s += arrow(`M${X[2] + bw + 4} ${ym} L${X[3] - 6} ${ym}`);
  s += arrow(`M${X[3] + bw + 4} ${ym} L${X[4] - 6} ${ym}`, { color: C.green });
  s += badge(gapMid(0), ym - 28, 1) + badge(gapMid(1), ym - 28, 2) + badge(gapMid(2), ym - 28, 3) + badge(gapMid(3), ym - 28, 5);
  // 4: preview marker on the firewall
  s += badge(X[3] + bw - 18, y1 + h1 + 2, 4);
  // return path: AI endpoint down to Restore box
  const ym2 = y2 + h2 / 2;
  s += arrow(`M${X[4] + bw / 2} ${y1 + h1 + 4} L${X[4] + bw / 2} ${ym2} L${X[3] + bw + 6} ${ym2}`);
  s += badge(X[4] + bw / 2, y1 + h1 + 48, 6);
  s += arrow(`M${X[3] - 4} ${ym2} L${X[2] + bw + 6} ${ym2}`);
  s += badge(gapMid(2), ym2 - 28, 7);
  s += arrow(`M${X[2] - 4} ${ym2} L${X[1] + bw + 6} ${ym2}`);
  s += badge(gapMid(1), ym2 - 28, 8);
  s += arrow(`M${X[1] - 4} ${ym2} L${X[0] + bw + 6} ${ym2}`);
  s += badge(gapMid(0), ym2 - 28, 9);
  // legend
  const steps = [
    ['1', "Read the open ticket with the person's own session (GET only)"],
    ['2', 'The panel gets the record and its thread'],
    ['3', 'The text goes to the PII firewall'],
    ['4', 'The person sees exactly what will be sent, and can mask more'],
    ['5', 'Only the masked text goes to the AI endpoint'],
    ['6', 'The answer comes back with placeholders'],
    ['7', 'Real values are restored on the device'],
    ['8', 'The person reviews the answer and presses Insert'],
    ['9', 'One field is filled; the person presses Save'],
  ];
  const col = (arr, x, y0) => arr.map(([n, t], i) => `${badge(x, y0 + i * 40, n)}<text x="${x + 28}" y="${y0 + i * 40 + 6}" font-size="18" fill="${C.ink}">${esc(t)}</text>`).join('');
  s += col(steps.slice(0, 5), 85, 690);
  s += col(steps.slice(5), 760, 690);
  // ribbon
  s += `<rect x="60" y="925" width="1280" height="52" rx="12" fill="${C.ink}"/>`;
  s += `<text x="700" y="958" font-size="20" font-weight="600" fill="#fff" text-anchor="middle">Two destinations only. No AgentBuddy server · no account · no analytics · nothing installed in ServiceNow</text>`;
  const body = `<div class="title">How one request flows</div><div class="sub">Nine steps, two outside destinations, nothing written back without the person pressing Save.</div>
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0;font-family:'Segoe UI',system-ui,sans-serif">${s}</svg>`;
  pictures.push(['02-how-one-request-flows', W, H, page(W, H, body)]);
}

// =====================================================================================================================
// 3. What the AI sees (masking)
// =====================================================================================================================
{
  const W = 1400, H = 760;
  const cw = 290, gap = 50, x0 = 55, top = 175, ch = 330;
  const hl = (t, kind) => `<span style="background:${kind === 'amber' ? C.amberL : C.greenL};color:${kind === 'amber' ? C.amber : C.green};font-weight:700;border-radius:5px;padding:0 2px">${esc(t)}</span>`;
  const cards = [
    { n: 1, h: 'In ServiceNow', sub: 'The ticket as written', bg: C.light, border: C.line, txt: `VPN keeps disconnecting for ${hl('Abel Tuter', 'amber')} (${hl('abel.tuter@example.com', 'amber')}). It drops every few minutes. Please call ${hl('Abel', 'amber')} back today.` },
    { n: 2, h: 'What leaves the browser', sub: 'Masked. The person previews it', bg: C.greenL, border: C.green, txt: `VPN keeps disconnecting for ${hl('[PERSON_1]', 'green')} (${hl('[EMAIL_1]', 'green')}). It drops every few minutes. Please call ${hl('[PERSON_1]', 'green')} back today.` },
    { n: 3, h: 'What the AI sends back', sub: 'It only ever saw placeholders', bg: C.greenL, border: C.green, txt: `Hi ${hl('[PERSON_1]', 'green')}, sorry about the VPN drops. Please reset your VPN password in the self-service portal and tell us if it still drops.` },
    { n: 4, h: 'What the person sees', sub: 'Real values restored on the device', bg: C.light, border: C.line, txt: `Hi ${hl('Abel', 'amber')}, sorry about the VPN drops. Please reset your VPN password in the self-service portal and tell us if it still drops.` },
  ];
  let html = `<div class="title">What the AI sees, and what it does not</div><div class="sub">An example with invented sample data. Names and emails are swapped for placeholders before the text leaves the browser.</div>`;
  cards.forEach((c, i) => {
    const x = x0 + i * (cw + gap);
    html += `<div style="position:absolute;left:${x}px;top:${top}px;width:${cw}px;height:${ch}px;background:${c.bg};border:2.5px solid ${c.border};border-radius:16px;padding:20px 20px">
      <div style="display:flex;align-items:center;gap:10px"><div style="width:30px;height:30px;border-radius:50%;background:${C.green};color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center">${c.n}</div><div style="font-size:21px;font-weight:700;line-height:1.15">${esc(c.h)}</div></div>
      <div style="margin-top:6px;font-size:15px;color:${C.grey}">${esc(c.sub)}</div>
      <div style="margin-top:16px;font-size:19px;line-height:1.55">${c.txt}</div></div>`;
    if (i < 3) html += `<div style="position:absolute;left:${x + cw + 4}px;top:${top + ch / 2 - 16}px;width:${gap - 8}px;text-align:center;font-size:34px;color:${C.green};font-weight:700">→</div>`;
  });
  // boundary line over cards 2-3
  const bx1 = x0 + (cw + gap) - 12, bx2 = x0 + 2 * (cw + gap) + cw + 12;
  html += `<div style="position:absolute;left:${bx1}px;top:${top + ch + 22}px;width:${bx2 - bx1}px;height:0;border-top:4px solid ${C.green}"></div>
    <div style="position:absolute;left:${bx1}px;top:${top + ch + 34}px;width:${bx2 - bx1}px;text-align:center;font-size:19px;font-weight:700;color:${C.green}">Only this part goes to the AI endpoint</div>`;
  html += `<div style="position:absolute;left:60px;top:${top + ch + 100}px;width:1280px;display:flex;gap:28px">
    ${[['The person is in control', 'They see exactly what will be sent before pressing send, and can mask more.'], ['Secrets never come back', 'A password, card number or ID number the AI repeats is not put back into the answer.'], ['Strict mode for sensitive work', 'HR cases and security records use stricter masking, set by the organisation.']].map(([h, t]) => `<div style="flex:1;background:${C.white};border:2px solid ${C.line};border-radius:14px;padding:16px 18px"><div style="font-size:19px;font-weight:700;color:${C.green}">${esc(h)}</div><div style="margin-top:6px;font-size:16px;line-height:1.4;color:${C.grey}">${esc(t)}</div></div>`).join('')}
  </div>`;
  pictures.push(['03-what-the-ai-sees', W, H, page(W, H, html)]);
}

// =====================================================================================================================
// 4. Before and after, one ticket
// =====================================================================================================================
{
  const W = 1400, H = 790;
  const cols = [
    ['Understand the ticket', 'Read the whole thread and every work note', 'A summary and hand-off brief, what is missing, and the escalation risk'],
    ['Find the fix', 'Search old tickets and the knowledge base by hand', 'Similar solved tickets, "solved before by", and matching articles'],
    ['Same caller', "Look up the caller's other tickets", 'Their other tickets and a repeat-issue warning, in one row'],
    ['Reply', 'Type the reply and judge the tone yourself', 'A draft in the right tone, checked before it reaches the customer'],
    ['Close well', 'Write the notes, pick a close code from memory', 'A resolution check and a close code taken from look-alike tickets'],
  ];
  const lx = 190, cw = 224, gap = 14, top = 165;
  let html = `<div class="title">One ticket, today and with AgentBuddy</div><div class="sub">The same five jobs an agent does on every ticket. The columns are the five rows on the Ticket screen.</div>`;
  cols.forEach(([h, a, b], i) => {
    const x = lx + i * (cw + gap);
    html += `<div style="position:absolute;left:${x}px;top:${top}px;width:${cw}px;height:60px;background:${C.ink};color:#fff;border-radius:12px;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:700;font-size:19px;line-height:1.15;padding:0 10px">${esc(h)}</div>
    <div style="position:absolute;left:${x}px;top:${top + 80}px;width:${cw}px;height:150px;background:${C.light};border:2px solid ${C.line};border-radius:12px;padding:18px 16px;font-size:18px;line-height:1.4;color:${C.grey}">${esc(a)}</div>
    <div style="position:absolute;left:${x + cw / 2 - 14}px;top:${top + 236}px;font-size:30px;color:${C.green};font-weight:700;line-height:1">↓</div>
    <div style="position:absolute;left:${x}px;top:${top + 282}px;width:${cw}px;height:170px;background:${C.greenL};border:2.5px solid ${C.green};border-radius:12px;padding:18px 16px;font-size:18px;line-height:1.4;color:${C.ink};font-weight:600">${esc(b)}</div>`;
  });
  html += `<div style="position:absolute;left:55px;top:${top + 80}px;width:120px;height:150px;display:flex;align-items:center;font-size:24px;font-weight:700;color:${C.grey}">Today</div>
    <div style="position:absolute;left:55px;top:${top + 282}px;width:125px;height:170px;display:flex;align-items:center;font-size:24px;font-weight:700;color:${C.green};line-height:1.15">With Agent&shy;Buddy</div>`;
  html += `<div style="position:absolute;left:55px;top:${top + 480}px;width:1290px;background:${C.amberL};border:2px solid #e8c766;border-radius:12px;padding:16px 20px;font-size:18px;line-height:1.45;color:${C.ink}"><b>Time saved is not measured yet.</b> The pilot starts with a baseline from real agents (time to first response, reassignments, handle time) and takes the same numbers after. Vendor-sponsored estimates put search at 26% to 35% of an agent's time; we have not yet measured our own.</div>`;
  pictures.push(['04-today-and-with-agentbuddy', W, H, page(W, H, html)]);
}

// =====================================================================================================================
// 5. Roadmap
// =====================================================================================================================
{
  const W = 1400, H = 810;
  const built = [
    ['Oct 26', 'Foundation', 'PII firewall, safe-to-send check, first tests'],
    ['Oct 27', 'Feature waves', 'ITSM and domain packs, portals, reports, knowledge'],
    ['Oct 30', 'Security round', 'Second audit, review pack, enterprise build'],
    ['Nov 1', 'Insights and Arabic', 'Insights on every screen, Arabic, shortcuts'],
    ['Nov 5', 'Focused layout', 'Five rows per screen, the rest in All tools'],
    ['Nov 6', 'Firefox and round 4', 'Firefox support, pains ServiceNow cannot solve'],
    ['Nov 7', 'Agents audit', 'Names, honest access, one link rule'],
    ['Nov 22', 'Round 5', 'Calm first screens, weekly reports, "What goes in"'],
  ];
  const next = [
    ['Next', 'Live walk-through', 'Chrome, Edge and Firefox on a real instance'],
    ['Next', 'Pilot', 'Real agents, a lead, a knowledge manager, with a baseline'],
    ['Next', 'Release route', 'Store listing or install by managed policy'],
    ['Next', 'Licence', 'Decide the model, build the licence-key check'],
    ['Later', 'Safari', 'When a Mac with Xcode is available'],
  ];
  const band = (items, y, solid) => {
    const n = items.length, left = 70, right = 1330, step = (right - left) / n;
    let s = `<div style="position:absolute;left:${left}px;top:${y + 14}px;width:${right - left}px;height:0;border-top:4px ${solid ? 'solid' : 'dashed'} ${solid ? C.green : C.grey}"></div>`;
    items.forEach(([d, t, b], i) => {
      const x = left + i * step;
      s += `<div style="position:absolute;left:${x + 2}px;top:${y}px;width:32px;height:32px;border-radius:50%;background:${solid ? C.green : C.white};border:4px solid ${solid ? C.green : C.grey};${solid ? '' : ''}"></div>
      <div style="position:absolute;left:${x}px;top:${y + 44}px;width:${step - 14}px">
        <div style="font-size:15px;font-weight:700;color:${solid ? C.green : C.grey};letter-spacing:.02em">${esc(d)}</div>
        <div style="margin-top:3px;font-size:19px;font-weight:700;line-height:1.2">${esc(t)}</div>
        <div style="margin-top:6px;font-size:15px;line-height:1.4;color:${C.grey}">${esc(b)}</div></div>`;
    });
    return s;
  };
  let html = `<div class="title">Where the product stands</div><div class="sub">Built in a month, tested against a fake ServiceNow. The next steps need a real instance and real agents.</div>`;
  html += `<div style="position:absolute;left:70px;top:150px;font-size:17px;font-weight:700;color:${C.green}">BUILT · 2026-10-26 TO 2026-11-22 · all automated checks pass</div>` + band(built, 190, true);
  html += `<div style="position:absolute;left:70px;top:455px;font-size:17px;font-weight:700;color:${C.grey}">NEXT · needs a real instance, real agents and decisions from leadership</div>` + band(next, 495, false);
  html += `<div style="position:absolute;left:60px;top:700px;width:1280px;background:${C.light};border:2px solid ${C.line};border-radius:12px;padding:14px 20px;font-size:17px;line-height:1.45"><b>Decisions needed from leadership:</b> which team joins the pilot, which AI endpoint the organisation allows, and whether Team views may show per-person rows to managers only.</div>`;
  pictures.push(['05-roadmap', W, H, page(W, H, html)]);
}

// =====================================================================================================================
// write + render
// =====================================================================================================================
const files = [];
for (const [name, w, h, html] of pictures) {
  const f = path.join(SRC, `${name}.html`);
  fs.writeFileSync(f, html);
  files.push([f, path.join(OUT, `${name}.png`), w, h]);
}

(async () => {
  const puppeteer = require(path.join(SRC, '..', '..', '..', '..', 'node_modules', 'puppeteer-core'));
  const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
  const executablePath = candidates.find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('No Chrome or Edge found. Set CHROME_PATH.');
  const browser = await puppeteer.launch({ executablePath, headless: true });
  for (const [html, png, w, h] of files) {
    const p = await browser.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await p.goto('file:///' + html.split('\\').join('/'), { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 400));
    await p.screenshot({ path: png });
    await p.close();
    console.log('wrote', path.relative(process.cwd(), png));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

// Builds the page to paste into Confluence from docs/leadership-guide/00-overview.md.
//
//   node docs/leadership-guide/confluence/make-confluence-page.cjs
//
// Writes docs/leadership-guide/confluence/AgentBuddy-confluence-page.html: one self-contained web page (headings, tables, lists and
// the five pictures, embedded). Open it in Chrome, press Ctrl+A then Ctrl+C, and paste into the Confluence editor. The note at the top
// of that page is not selectable, so it is not copied.
//
// It only understands the small part of Markdown the overview uses. The repo-only parts of the overview (the note about the repo copy,
// the Mermaid block, the links to the other guide files) are left out on purpose.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..');
const md = fs.readFileSync(path.join(DIR, '00-overview.md'), 'utf8').replace(/\r\n/g, '\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    const file = path.join(DIR, src);
    const b64 = fs.readFileSync(file).toString('base64');
    return `<img src="data:image/png;base64,${b64}" alt="${alt.replace(/"/g, '&quot;')}" style="max-width:100%;height:auto">`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => (/^https?:/.test(href) ? `<a href="${href}">${text}</a>` : text));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  return s;
}

const lines = md.split('\n');
let html = '';
let i = 0;
const isTableRow = (l) => /^\|.*\|\s*$/.test(l);
let skipFence = false;

while (i < lines.length) {
  const l = lines[i];

  if (/^```/.test(l)) {
    // Mermaid and other code blocks stay in the repo copy only.
    i++;
    while (i < lines.length && !/^```/.test(lines[i])) i++;
    i++;
    continue;
  }
  if (l.startsWith('# ')) { i++; continue; } // the page title is set in Confluence
  if (l.startsWith('> ')) { while (i < lines.length && lines[i].startsWith('>')) i++; continue; } // note about the repo copy
  if (l.startsWith('The same flow as editable text')) { i++; continue; }
  if (l.startsWith('## The full guide')) break; // links to the other guide files; they are not in Confluence
  if (l.startsWith('## ')) { html += `<h2>${inline(l.slice(3))}</h2>\n`; i++; continue; }
  if (l.trim() === '') { i++; continue; }

  if (isTableRow(l)) {
    const rows = [];
    while (i < lines.length && isTableRow(lines[i])) { rows.push(lines[i]); i++; }
    const cells = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split(/\s\|\s|\|(?=\s)/).map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    html += '<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>\n';
    for (const r of body) html += '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>\n';
    html += '</tbody></table>\n';
    continue;
  }
  if (/^- /.test(l)) {
    html += '<ul>\n';
    while (i < lines.length && /^- /.test(lines[i])) { html += `<li>${inline(lines[i].slice(2))}</li>\n`; i++; }
    html += '</ul>\n';
    continue;
  }
  if (/^\d+\. /.test(l)) {
    html += '<ol>\n';
    while (i < lines.length && /^\d+\. /.test(lines[i])) { html += `<li>${inline(lines[i].replace(/^\d+\. /, ''))}</li>\n`; i++; }
    html += '</ol>\n';
    continue;
  }
  // paragraph (a picture on its own line, or text)
  let para = l;
  i++;
  while (i < lines.length && lines[i].trim() !== '' && !/^(#|>|\||- |\d+\. |```)/.test(lines[i])) { para += ' ' + lines[i]; i++; }
  html += /^!\[/.test(para) ? `<p>${inline(para)}</p>\n` : `<p>${inline(para)}</p>\n`;
}

const out = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>AgentBuddy: AI Task Page (for Confluence)</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#172b4d;max-width:980px;margin:0 auto;padding:24px 28px 80px;line-height:1.5;font-size:15px}
.note{user-select:none;-webkit-user-select:none;background:#e3fcef;border:1px solid #79f2c0;border-radius:6px;padding:12px 16px;margin-bottom:28px;font-size:14px}
h2{font-size:22px;margin:34px 0 10px}
table{border-collapse:collapse;width:100%;margin:12px 0 18px}
th,td{border:1px solid #c1c7d0;padding:7px 10px;text-align:left;vertical-align:top}
th{background:#f4f5f7}
img{display:block;margin:14px 0}
code{font-family:Consolas,monospace;background:#f4f5f7;padding:1px 4px;border-radius:3px}
</style></head><body>
<div class="note"><strong>To use this page:</strong> press <strong>Ctrl+A</strong>, then <strong>Ctrl+C</strong>, then paste (<strong>Ctrl+V</strong>) into the Confluence editor. This note is not copied. If a picture does not come across, drag the file with the same number from the <code>images</code> folder onto the page.</div>
${html}</body></html>
`;
const target = path.join(__dirname, 'AgentBuddy-confluence-page.html');
fs.writeFileSync(target, out);
console.log('wrote', path.relative(process.cwd(), target), Math.round(out.length / 1024) + ' KB');

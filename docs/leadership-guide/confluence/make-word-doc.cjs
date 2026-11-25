// Builds ONE Word document for Confluence from the leadership guide.
//
//   npm install docx --no-save          (once; it is not a dependency of the extension)
//   node docs/leadership-guide/confluence/make-word-doc.cjs
//
// Writes docs/leadership-guide/confluence/AgentBuddy-Confluence-Page.docx:
//   Part 1  the page in the AI task template: the 13 template headings (Heading 1), with the five pictures in place (00-overview.md)
//   Part 2  "The full guide" (Heading 1): the five guide files, each as a Heading 2 with its own sections below
//             01-getting-started.md, 02-ticket-screen.md, 03-my-work-and-team.md, 04-write-and-knowledge.md, 05-settings-and-admin.md
// Open it in Word, press Ctrl+A, Ctrl+C, and paste into the Confluence editor.
// Left out on purpose: the repo-only parts of the overview (repo note, Mermaid block, links to the other files) and README.md.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, HeadingLevel, WidthType, ShadingType, BorderStyle,
  AlignmentType, LevelFormat, ExternalHyperlink,
} = require('docx');

const DIR = path.join(__dirname, '..');
const FONT = 'Arial';
const CONTENT_W = 9638; // A4 with 2 cm margins, in DXA
const IMG_W = 620; // pixels
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

const warnings = [];
let orderedInstance = 0; // each numbered list restarts at 1: its own numbering instance

const pngSize = (file) => {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

// ---------- inline: `code`, \escapes, **bold**, [text](url) ----------
function runs(s, base = {}) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0001${codes.push(c) - 1}\u0002`);
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, (_, c) => `\u0003${c.charCodeAt(0)}\u0004`);
  const restore = (t) => t.replace(/\u0003(\d+)\u0004/g, (_, n) => String.fromCharCode(+n));
  const out = [];
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\u0001\d+\u0002)/g;
  let last = 0, m;
  const text = (t, extra = {}) => t && out.push(new TextRun({ text: restore(t), font: FONT, ...base, ...extra }));
  while ((m = re.exec(s))) {
    text(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('\u0001')) out.push(new TextRun({ text: codes[+t.slice(1, -1)], font: 'Consolas', ...base }));
    else if (t.startsWith('**')) {
      // bold, which may itself hold a code span
      const inner = t.slice(2, -2).replace(/\u0001(\d+)\u0002/g, (_, i) => codes[+i]);
      text(inner, { bold: true });
    } else {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(t);
      if (/^https?:/.test(href)) out.push(new ExternalHyperlink({ link: href, children: [new TextRun({ text: restore(label), style: 'Hyperlink', font: FONT, ...base })] }));
      else text(label);
    }
    last = m.index + t.length;
  }
  text(s.slice(last));
  return out.length ? out : [new TextRun({ text: '', font: FONT })];
}

// ---------- tables ----------
const border = { style: BorderStyle.SINGLE, size: 4, color: 'C1C7D0' };
const borders = { top: border, bottom: border, left: border, right: border };

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '', inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function table(rows, where) {
  const head = splitRow(rows[0]);
  const body = rows.slice(2).map(splitRow);
  const n = head.length;
  body.forEach((r, k) => { if (r.length !== n) warnings.push(`${where}: table row ${k + 1} has ${r.length} cells, header has ${n}: ${r[0].slice(0, 40)}`); });
  // Column widths follow how much text a column holds (never below 9% of the page).
  const weight = head.map((h, c) => Math.min(70, Math.max(10, Math.round([h, ...body.map((r) => r[c] || '')].reduce((a, x) => a + Math.min(x.length, 220), 0) / (body.length + 1)))));
  const total = weight.reduce((a, b) => a + b, 0);
  let widths = weight.map((w) => Math.max(Math.round(CONTENT_W * 0.09), Math.round((w / total) * CONTENT_W)));
  const diff = CONTENT_W - widths.reduce((a, b) => a + b, 0);
  widths[widths.indexOf(Math.max(...widths))] += diff;
  const size = n >= 4 ? 17 : 19;
  const cell = (text, w, isHead) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      borders,
      shading: isHead ? { fill: 'F4F5F7', type: ShadingType.CLEAR, color: 'auto' } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({ children: runs(text, { size, bold: isHead || undefined }) })],
    });
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: head.map((c, i) => cell(c, widths[i], true)) }), ...body.map((r) => new TableRow({ children: widths.map((w, i) => cell(r[i] || '', w, false)) }))],
  });
}

// ---------- one Markdown file -> Word paragraphs ----------
// opts.headings maps a Markdown heading marker to a Word heading level (1 to 6); a marker not listed is dropped.
// opts.overview: leave out the repo-only parts of 00-overview.md.
function convert(file, opts) {
  const where = path.basename(file);
  const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const listItem = (l) => /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(l);
  let i = 0;

  while (i < lines.length) {
    const l = lines[i];

    if (/^```/.test(l)) {
      const kind = l.slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i++; }
      i++;
      if (kind === 'mermaid') continue; // drawn as a picture in the overview
      body.forEach((b, k) =>
        out.push(new Paragraph({
          spacing: { after: k === body.length - 1 ? 160 : 0 },
          shading: { fill: 'F4F5F7', type: ShadingType.CLEAR, color: 'auto' },
          indent: { left: 120, right: 120 },
          children: [new TextRun({ text: b === '' ? ' ' : b, font: 'Consolas', size: 18 })],
        }))
      );
      continue;
    }

    const h = /^(#{1,6}) (.*)$/.exec(l);
    if (h) {
      const level = opts.headings[h[1]];
      if (opts.overview && h[2] === 'The full guide') break; // links to the other files; replaced by Part 2
      if (level) out.push(new Paragraph({ heading: HEADINGS[level - 1], keepNext: true, children: [new TextRun({ text: h[2].replace(/\\([<>*_`|])/g, '$1').replace(/`/g, ''), font: FONT })] }));
      i++;
      continue;
    }

    if (l.trim() === '') { i++; continue; }
    if (opts.overview && l.startsWith('> ')) { while (i < lines.length && lines[i].startsWith('>')) i++; continue; }
    if (opts.overview && l.startsWith('The same flow as editable text')) { i++; continue; }

    if (isRow(l)) {
      const rows = [];
      while (i < lines.length && isRow(lines[i])) { rows.push(lines[i]); i++; }
      out.push(table(rows, where));
      out.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
      continue;
    }

    if (listItem(l)) {
      // one list: top-level items (bullet or numbered) with nested items and wrapped continuation lines
      const ordered = /^\s*\d+\./.test(l) && !/^\s/.test(l);
      const inst = ordered ? ++orderedInstance : 0;
      const items = [];
      while (i < lines.length) {
        const li = listItem(lines[i]);
        if (li) {
          const level = li[1].length >= 2 ? 1 : 0;
          if (level === 0 && items.length && (/^\d+\./.test(li[2]) !== ordered)) break; // a different kind of list starts
          items.push({ level, text: li[3] });
          i++;
        } else if (/^\s+\S/.test(lines[i]) && items.length && !isRow(lines[i])) {
          items[items.length - 1].text += ' ' + lines[i].trim();
          i++;
        } else if (lines[i].trim() === '' && i + 1 < lines.length && (listItem(lines[i + 1]) && /^\s+/.test(lines[i + 1]) )) {
          i++; // a blank line inside a list before a nested item
        } else break;
      }
      for (const it of items) {
        const numbering = it.level === 1 ? { reference: ordered ? 'steps' : 'bullets', level: 1, ...(ordered ? { instance: inst } : {}) } : ordered ? { reference: 'steps', level: 0, instance: inst } : { reference: 'bullets', level: 0 };
        out.push(new Paragraph({ numbering, spacing: { after: 60 }, children: runs(it.text, { size: 21 }) }));
      }
      out.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
      continue;
    }

    const img = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(l);
    if (img) {
      const f = path.join(DIR, img[2]);
      const { w, h: ph } = pngSize(f);
      out.push(new Paragraph({ spacing: { before: 120, after: 160 }, children: [new ImageRun({ type: 'png', data: fs.readFileSync(f), transformation: { width: IMG_W, height: Math.round((IMG_W * ph) / w) }, altText: { title: img[1], description: img[1], name: path.basename(f) } })] }));
      i++;
      continue;
    }

    let para = l;
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|\||\s*([-*]|\d+\.)\s|```|!\[|>)/.test(lines[i])) { para += ' ' + lines[i]; i++; }
    out.push(new Paragraph({ spacing: { after: 120 }, children: runs(para, { size: 21 }) }));
  }
  return out;
}

// ---------- assemble ----------
const GUIDE = [
  ['01-getting-started.md', 'Install, turn it on for a ServiceNow site, add an AI key, the panel tour, shortcuts, browsers'],
  ['02-ticket-screen.md', 'Every Insights card and AI action on the Ticket screen'],
  ['03-my-work-and-team.md', 'The queue and the team-lead dashboards'],
  ['04-write-and-knowledge.md', 'Replies, emails, rewrites, snippets and the knowledge tools'],
  ['05-settings-and-admin.md', 'Settings, privacy, administrator policy, troubleshooting'],
];

const children = [];
children.push(...convert(path.join(DIR, '00-overview.md'), { overview: true, headings: { '##': 1 } }));

children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, keepNext: true, children: [new TextRun({ text: 'The full guide', font: FONT })] }));
children.push(new Paragraph({ spacing: { after: 120 }, children: runs('The detailed guide to every screen and setting. Each part below is a section of this page. It was written from the code and the docs, not from a live instance: where an entry says "not verified", the behaviour passed the automated tests against a fake ServiceNow but has not been checked on a real instance.', { size: 21 }) }));
for (const [f, what] of GUIDE) {
  const title = /^# (.*)$/m.exec(fs.readFileSync(path.join(DIR, f), 'utf8'))[1];
  children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text: `${title}: `, bold: true, font: FONT, size: 21 }), new TextRun({ text: what, font: FONT, size: 21 })] }));
}
for (const [f] of GUIDE) children.push(...convert(path.join(DIR, f), { headings: { '#': 2, '##': 3, '###': 4, '####': 5, '#####': 6 } }));

const headingStyle = (id, name, size, before, after, outlineLevel) => ({ id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size, bold: true, font: FONT, color: '172B4D' }, paragraph: { spacing: { before, after }, outlineLevel } });
const doc = new Document({
  creator: 'AgentBuddy',
  title: 'AgentBuddy: AI Task Page and full guide',
  styles: {
    default: { document: { run: { font: FONT, size: 21 } } },
    paragraphStyles: [
      headingStyle('Heading1', 'Heading 1', 34, 360, 120, 0),
      headingStyle('Heading2', 'Heading 2', 29, 320, 100, 1),
      headingStyle('Heading3', 'Heading 3', 25, 260, 80, 2),
      headingStyle('Heading4', 'Heading 4', 22, 200, 60, 3),
      headingStyle('Heading5', 'Heading 5', 21, 160, 60, 4),
      headingStyle('Heading6', 'Heading 6', 21, 140, 40, 5),
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 270 } } } },
      ] },
      { reference: 'steps', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 270 } } } },
      ] },
    ],
  },
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } }, children }],
});

Packer.toBuffer(doc).then((buf) => {
  const target = path.join(__dirname, 'AgentBuddy-Confluence-Page.docx');
  fs.writeFileSync(target, buf);
  console.log('wrote', path.relative(process.cwd(), target), Math.round(buf.length / 1024) + ' KB');
  if (warnings.length) console.log('WARNINGS:\n' + warnings.join('\n'));
});

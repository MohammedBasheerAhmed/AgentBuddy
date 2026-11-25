// Builds a Word version of the leadership page from docs/leadership-guide/00-overview.md.
//
//   npm install docx --no-save          (once; it is not a dependency of the extension)
//   node docs/leadership-guide/confluence/make-word-doc.cjs
//
// Writes docs/leadership-guide/confluence/AgentBuddy-AI-Task-Page.docx: the 13 template headings as Heading 1, tables, lists and the
// five pictures in place. Open it in Word, press Ctrl+A, Ctrl+C, and paste into the Confluence editor.
// Like make-confluence-page.cjs it leaves out the repo-only parts (repo note, Mermaid block, links to the other guide files).
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, HeadingLevel, WidthType, ShadingType, BorderStyle,
  AlignmentType, LevelFormat, ExternalHyperlink,
} = require('docx');

const DIR = path.join(__dirname, '..');
const md = fs.readFileSync(path.join(DIR, '00-overview.md'), 'utf8').replace(/\r\n/g, '\n');

const FONT = 'Arial';
const CONTENT_W = 9638; // A4 with 2 cm margins, in DXA
const IMG_W = 620; // pixels

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// **bold**, `code`, [text](url): text runs
function runs(s, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(new TextRun({ text: s.slice(last, m.index), font: FONT, ...base }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true, font: FONT, ...base }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas', ...base }));
    else {
      const [, text, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(t);
      if (/^https?:/.test(href)) out.push(new ExternalHyperlink({ link: href, children: [new TextRun({ text, style: 'Hyperlink', font: FONT, ...base })] }));
      else out.push(new TextRun({ text, font: FONT, ...base }));
    }
    last = m.index + t.length;
  }
  if (last < s.length) out.push(new TextRun({ text: s.slice(last), font: FONT, ...base }));
  return out;
}

const border = { style: BorderStyle.SINGLE, size: 4, color: 'C1C7D0' };
const borders = { top: border, bottom: border, left: border, right: border };

function table(rows) {
  const cells = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split(/\s\|\s|\|(?=\s)/).map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  const n = head.length;
  // Column widths: the first column of a two-column table is narrower; otherwise shares are even.
  const widths = n === 2 ? [Math.round(CONTENT_W * 0.28), CONTENT_W - Math.round(CONTENT_W * 0.28)] : Array.from({ length: n }, (_, i) => (i < n - 1 ? Math.floor(CONTENT_W / n) : CONTENT_W - Math.floor(CONTENT_W / n) * (n - 1)));
  const cell = (text, w, isHead) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      borders,
      shading: isHead ? { fill: 'F4F5F7', type: ShadingType.CLEAR, color: 'auto' } : undefined,
      margins: { top: 70, bottom: 70, left: 110, right: 110 },
      children: [new Paragraph({ children: runs(text, { size: 20, bold: isHead || undefined }) })],
    });
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: head.map((c, i) => cell(c, widths[i], true)) }), ...body.map((r) => new TableRow({ children: widths.map((w, i) => cell(r[i] || '', w, false)) }))],
  });
}

const children = [];
const lines = md.split('\n');
let i = 0;
const isRow = (l) => /^\|.*\|\s*$/.test(l);

while (i < lines.length) {
  const l = lines[i];
  if (/^```/.test(l)) { i++; while (i < lines.length && !/^```/.test(lines[i])) i++; i++; continue; }
  if (l.startsWith('# ')) { i++; continue; }
  if (l.startsWith('> ')) { while (i < lines.length && lines[i].startsWith('>')) i++; continue; }
  if (l.startsWith('The same flow as editable text')) { i++; continue; }
  if (l.startsWith('## The full guide')) break;
  if (l.startsWith('## ')) { children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 }, children: [new TextRun({ text: l.slice(3), font: FONT })] })); i++; continue; }
  if (l.trim() === '') { i++; continue; }
  if (isRow(l)) {
    const rows = [];
    while (i < lines.length && isRow(lines[i])) { rows.push(lines[i]); i++; }
    children.push(table(rows));
    children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    continue;
  }
  if (/^- /.test(l)) {
    while (i < lines.length && /^- /.test(lines[i])) { children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: runs(lines[i].slice(2), { size: 21 }) })); i++; }
    continue;
  }
  if (/^\d+\. /.test(l)) {
    while (i < lines.length && /^\d+\. /.test(lines[i])) { children.push(new Paragraph({ numbering: { reference: 'steps', level: 0 }, spacing: { after: 60 }, children: runs(lines[i].replace(/^\d+\. /, ''), { size: 21 }) })); i++; }
    continue;
  }
  const img = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(l);
  if (img) {
    const file = path.join(DIR, img[2]);
    const { w, h } = pngSize(file);
    children.push(new Paragraph({ spacing: { before: 120, after: 160 }, children: [new ImageRun({ type: 'png', data: fs.readFileSync(file), transformation: { width: IMG_W, height: Math.round((IMG_W * h) / w) }, altText: { title: img[1], description: img[1], name: path.basename(file) } })] }));
    i++;
    continue;
  }
  let para = l;
  i++;
  while (i < lines.length && lines[i].trim() !== '' && !/^(#|>|\||- |\d+\. |```|!\[)/.test(lines[i])) { para += ' ' + lines[i]; i++; }
  children.push(new Paragraph({ spacing: { after: 120 }, children: runs(para, { size: 21 }) }));
}

const doc = new Document({
  creator: 'AgentBuddy',
  title: 'AgentBuddy: AI Task Page',
  styles: {
    default: { document: { run: { font: FONT, size: 21 } } },
    paragraphStyles: [{ id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, font: FONT, color: '172B4D' }, paragraph: { spacing: { before: 360, after: 120 }, outlineLevel: 0 } }],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
      { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
    ],
  },
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } }, children }],
});

Packer.toBuffer(doc).then((buf) => {
  const target = path.join(__dirname, 'AgentBuddy-AI-Task-Page.docx');
  fs.writeFileSync(target, buf);
  console.log('wrote', path.relative(process.cwd(), target), Math.round(buf.length / 1024) + ' KB');
});

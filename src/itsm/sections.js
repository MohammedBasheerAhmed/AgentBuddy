// Reading the model's answer back: "Label: text" sections, and the parts of a knowledge article draft that go into the
// article form. Pure. The input is the plain text ResultView builds from the answer (toPlainText of parseSafeText), but
// the parser also accepts what models often write: bold labels (**Title:** x), heading labels ("## Symptoms" with the
// text underneath), a label in any case, extra spaces, and a colon outside the bold.
//
// A line is a section header only when a known label is at its start AND is followed by a colon or ends the line. So a
// sentence that happens to begin with "Steps taken were..." is text, not a header.

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Decoration around a label that is not part of it: markdown heading marks, a list dash, bold/italic markers.
const WRAP = String.raw`(?:\*\*|__|\*|_)?`;

function headerRegexes(labels) {
  const alternatives = labels.map((l) => escapeRegex(l.trim()).replace(/\s+/g, String.raw`\s+`)).join('|');
  const start = String.raw`^[ \t]*(?:#{1,6}[ \t]*)?(?:[-*+>][ \t]+)?${WRAP}[ \t]*(${alternatives})[ \t]*${WRAP}[ \t]*`;
  return {
    withColon: new RegExp(`${start}[:\\uFF1A][ \\t]*${WRAP}[ \\t]*(.*)$`, 'i'),
    bare: new RegExp(`${start}$`, 'i'),
  };
}

// Which of `labels` a captured header text is (the labels may be written with different spacing or case).
const canonical = (labels, found) => labels.find((l) => l.trim().toLowerCase().replace(/\s+/g, ' ') === String(found).trim().toLowerCase().replace(/\s+/g, ' ')) || found;

/**
 * Split an answer into labelled sections.
 * @param {string} text the answer, as plain text
 * @param {string[]} labels the section names to look for, for example ['Title', 'Symptoms', 'Applies to']
 * @returns {{ preamble: string, sections: Array<{ label: string, text: string, startLine: number, inline: boolean }> }}
 *   preamble: text before the first header. text: what follows the label, up to the next header, trimmed.
 *   startLine: the header's line number. inline: the text started on the header's own line ("Title: x").
 */
export function parseSections(text, labels) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const { withColon, bare } = headerRegexes(labels);
  const sections = [];
  const preamble = [];
  let current = null;
  lines.forEach((line, index) => {
    const colon = withColon.exec(line);
    const alone = colon ? null : bare.exec(line);
    if (colon || alone) {
      const inline = Boolean(colon && colon[2].trim());
      current = { label: canonical(labels, (colon || alone)[1].replace(/\s+/g, ' ')), lines: inline ? [colon[2]] : [], startLine: index, inline };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  });
  return {
    preamble: preamble.join('\n').trim(),
    sections: sections.map(({ label, lines: body, startLine, inline }) => ({
      label,
      text: body.join('\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim(),
      startLine,
      inline,
    })),
  };
}

// ---- Knowledge article draft ------------------------------------------------------------------------------

export const ARTICLE_LABELS = Object.freeze(['Title', 'Symptoms', 'Cause', 'Resolution', 'Steps', 'Applies to']);
const BODY_LABELS = ARTICLE_LABELS.filter((l) => l !== 'Title');

// The shortest title the form takes (kb_knowledge.short_description is 160 characters).
const TITLE_MAX = 160;

// Written as numbers so this file stays plain ASCII: curly quotes (U+201C, U+2018 / U+201D, U+2019) and the ellipsis (U+2026).
const QUOTE_PAIR = new RegExp(`^["'${String.fromCharCode(0x201c, 0x2018)}](.*)["'${String.fromCharCode(0x201d, 0x2019)}]$`);
const ELLIPSIS = String.fromCharCode(0x2026);

// Wrapping the model puts around a one-line value: **bold**, "quotes", `code`.
const unwrap = (value) =>
  String(value ?? '')
    .trim()
    .replace(/^(?:\*\*|__|\*|_|`)+|(?:\*\*|__|\*|_|`)+$/g, '')
    .replace(QUOTE_PAIR, '$1')
    .trim();

/** The article title: the first line of the Title section, without markup or quotes. '' when there is none. */
export function pickArticleTitle(plain) {
  const { sections } = parseSections(plain, ARTICLE_LABELS);
  const title = sections.find((s) => s.label === 'Title');
  const first = title ? title.text.split('\n').find((l) => l.trim()) : '';
  const value = unwrap(first);
  return value.length > TITLE_MAX ? `${value.slice(0, TITLE_MAX - 1).trimEnd()}${ELLIPSIS}` : value;
}

/**
 * The article body: from the first of Symptoms, Cause, Resolution, Steps, Applies to to the end of the last one, labels
 * included. The Title and any first line such as "Similar article exists: ..." are left out. '' when no body section exists.
 * The last section, when it is "Applies to", ends at its first blank line, so a closing remark from the model stays out.
 */
export function pickArticleBody(plain) {
  const source = String(plain ?? '').replace(/\r\n?/g, '\n');
  const { sections } = parseSections(source, ARTICLE_LABELS);
  const body = sections.filter((s) => BODY_LABELS.includes(s.label));
  if (!body.length) return '';
  const lines = source.split('\n');
  const first = body[0].startLine;
  const lastSection = sections[sections.length - 1];
  let end = lines.length;
  if (lastSection.label === 'Applies to') {
    // Stop at the first blank line after the content starts. A bare "Applies to" heading has its content on the lines
    // below, usually after one blank line, so that blank line does not count.
    let from = lastSection.startLine;
    if (!lastSection.inline) {
      while (from + 1 < lines.length && !lines[from + 1].trim()) from += 1;
      from += 1;
    }
    const blank = lines.findIndex((l, i) => i > from && !l.trim());
    if (blank !== -1) end = blank;
  } else if (lastSection.label === 'Title') {
    // A Title written after the body: the body ends where the title starts.
    end = lastSection.startLine;
  }
  return lines.slice(first, end).join('\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

const SIMILAR_LINE = /^\s*Similar article exists:\s*([A-Za-z]{2,12}\d{4,12})\s+(.+?)\.?\s*Consider updating it instead\.?\s*$/i;

/** { number, title } when the first line of the answer says a similar article exists, otherwise null. */
export function similarArticleLine(plain) {
  const first = String(plain ?? '').split('\n').find((l) => l.trim());
  const m = first ? SIMILAR_LINE.exec(first) : null;
  return m ? { number: m[1].toUpperCase(), title: m[2].trim() } : null;
}

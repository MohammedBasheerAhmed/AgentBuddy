// Pick one section out of an answer that has fixed headings ("Problem statement:", "Workaround:" ...), so an Insert button can
// put just that part into one form field. Pure: it works on the plain text the result view shows (toPlainText), but it also
// copes with the markdown a model sometimes adds anyway.
//
// A model does not always follow a layout exactly, so this is forgiving about what it reads and strict about what it returns:
//  - headings are found in any letter case, with odd spacing, a number in front ("2. Workaround:"), bold markers
//    ("**Workaround:**"), a "#" in front, or a bracketed note after the name ("Probable cause (hypothesis):")
//  - the text may follow the heading on the same line or start on the next line
//  - a section runs until the next heading from the list; a line that merely starts with the same words ("Workaround is to
//    restart") is not a heading, and a bullet ("- Workaround: ...") is never a heading
//  - a section that is missing, empty, or only says "Not stated" / "None" gives '' (nothing to insert), never a guess.

const EMPTY_ANSWER = /^(?:not stated|not stated in the data|none|none found|n\/a|na|not applicable|unknown|not known|not available|nothing|-+|\.+)\.?$/i;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Everything between the start of a line and the heading name: indentation, "#", a number, an emphasis marker.
// A bullet ("- " or "* " followed by a space) is deliberately not allowed, so a bullet is always content.
const LEAD = String.raw`[ \t]{0,3}(?:#{1,6}[ \t]+)?(?:\d{1,2}[.)][ \t]+)?(?:\*\*|__|\*(?=\S)|_(?=\S))?[ \t]*`;
// After the name: an optional bracketed note, closing emphasis, then a colon (with closing emphasis hugging it) or the end of
// the line, then the text of the section if it starts on the same line.
const COLON = `(?::|${String.fromCharCode(0xff1a)})`; // an ordinary colon or the full-width one
const TRAIL = String.raw`[ \t]*(?:\([^)\n]{0,80}\))?(?:\*\*|__|\*|_)?[ \t]*(?:${COLON}(?:\*\*|__|\*(?=\s|$)|_(?=\s|$))?|$)[ \t]*(.*)$`;

function headingPattern(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean).map(escapeRegex);
  return new RegExp(`^${LEAD}${words.join(String.raw`\s+`)}${TRAIL}`, 'i');
}

// Written as numbers so this file stays plain ASCII (no hidden characters in the source itself).
const ch = (n) => String.fromCharCode(n);
const charClass = (items) => new RegExp(`[${items.map((x) => (Array.isArray(x) ? `${ch(x[0])}-${ch(x[1])}` : ch(x))).join('')}]`, 'g');
const LINE_BREAKS = new RegExp(`${ch(13)}${ch(10)}?|${ch(0x2028)}|${ch(0x2029)}`, 'g'); // CR LF, a lone CR, LS, PS
const ODD_SPACES = charClass([0xa0, 0x1680, [0x2000, 0x200a], 0x202f, 0x205f, 0x3000]);
const INVISIBLE = charClass([[0x200b, 0x200d], 0x2060, 0xfeff]);

/** Odd spaces to plain ones, one kind of line break, no trailing blanks, no run of blank lines. */
export function tidy(text) {
  return String(text ?? '')
    .replace(LINE_BREAKS, '\n')
    .replace(ODD_SPACES, ' ')
    .replace(INVISIBLE, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True for an answer that says there is nothing ("Not stated", "None", "n/a"), so it should not be inserted anywhere. */
export const isEmptyAnswer = (text) => EMPTY_ANSWER.test(tidy(text).replace(/^[-*]\s+/, '').trim());

/**
 * Split an answer into its sections.
 * @param {string} text the answer as plain text
 * @param {string[]} headings the heading names, in any order
 * @returns {Record<string, string>} heading name (as given) -> section text (tidied; '' when the heading was found with nothing under it).
 *   A heading that is not in the text is not a key. If a heading occurs twice, the first one counts.
 */
export function splitSections(text, headings) {
  const names = [...new Set((headings || []).map((h) => String(h).trim()).filter(Boolean))];
  const patterns = names.map((name) => [name, headingPattern(name)]);
  const lines = tidy(text).split('\n');

  const out = {};
  let current = null;
  let buffer = [];
  const close = () => {
    if (current !== null && !(current in out)) out[current] = tidy(buffer.join('\n'));
    current = null;
    buffer = [];
  };

  for (const line of lines) {
    const hit = patterns.map(([name, re]) => [name, re.exec(line)]).find(([, m]) => m);
    if (hit) {
      close();
      current = hit[0];
      if (hit[1][1].trim()) buffer.push(hit[1][1].trim());
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  close();
  return out;
}

/**
 * The text of one section, or '' when it is missing, empty, or only says it is not stated.
 * @param {string} text the answer
 * @param {string} name the section to return
 * @param {string[]} headings every heading of the layout (so the section ends at the right place)
 * @param {{ keepEmptyAnswer?: boolean }} [options] keepEmptyAnswer: return "Not stated" as it is instead of ''
 */
export function pickSection(text, name, headings, { keepEmptyAnswer = false } = {}) {
  const all = (headings || []).includes(name) ? headings : [...(headings || []), name];
  const body = splitSections(text, all)[String(name).trim()] || '';
  if (!body) return '';
  return !keepEmptyAnswer && isEmptyAnswer(body) ? '' : body;
}

/** A `pick(plainText)` function for a feature's insert button: always the same section of the same layout. */
export const sectionPicker = (name, headings) => (text) => pickSection(text, name, headings);

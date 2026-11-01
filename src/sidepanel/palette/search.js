// The search of the command palette. Pure: no React, no chrome.* (tests/palette.test.js).
//
// A command is { id, label, hint?, keywords?, group, ... }. A query is split into words and EVERY word must match somewhere in the
// command: its label (best), its hint or its keywords. A word matches at the start of a word of the label (best), inside the label,
// or as letters in order ("rpl" finds "Draft a reply"). Arabic is compared without vowel marks, tatweel and the different shapes of
// alef, so a person need not type them. The ranking is stable: equal scores keep the order the commands came in.

/** Lower case, Arabic without marks and with one alef, one yeh and one heh: what two spellings of a word have in common. */
export function fold(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // vowel marks, dagger alef, tatweel
    .replace(/[آأإٱ]/g, 'ا') // alef with madda, hamza, or wasla -> alef
    .replace(/ى/g, 'ي') // alef maqsura -> yeh
    .replace(/ة/g, 'ه') // teh marbuta -> heh
    .replace(/\s+/g, ' ')
    .trim();
}

const wordsOf = (text) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Are the letters of `needle` in `haystack` in this order (not necessarily next to each other)? */
function inOrder(needle, haystack) {
  let at = 0;
  for (const ch of haystack) {
    if (ch === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return false;
}

/** How well one word of the query matches a command: 0 (no) or a score, higher is better. */
function scoreWord(word, parts) {
  const label = parts.label;
  if (parts.labelWords.some((w) => w === word)) return 120;
  if (parts.labelWords.some((w) => w.startsWith(word))) return 100;
  if (label.includes(word)) return 70;
  if (word.length >= 2 && inOrder(word, label)) return 35;
  if (parts.extraWords.some((w) => w.startsWith(word))) return 30;
  if (parts.extra.includes(word)) return 20;
  return 0;
}

/**
 * The commands that match the query, best first. An empty query keeps every command in the order given.
 * @param {{ id: string, label: string, hint?: string, keywords?: string, group: string }[]} commands
 * @param {string} query
 * @param {number} [limit]
 */
export function rankCommands(commands, query, limit = 60) {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return commands.slice(0, limit);
  const scored = [];
  commands.forEach((command, order) => {
    const extraText = `${command.hint || ''} ${command.keywords || ''}`;
    const parts = { label: fold(command.label), labelWords: wordsOf(command.label), extra: fold(extraText), extraWords: wordsOf(extraText) };
    let total = 0;
    for (const word of words) {
      const score = scoreWord(word, parts);
      if (!score) return;
      total += score;
    }
    scored.push({ command, total, order });
  });
  scored.sort((a, b) => b.total - a.total || a.order - b.order);
  return scored.slice(0, limit).map((s) => s.command);
}

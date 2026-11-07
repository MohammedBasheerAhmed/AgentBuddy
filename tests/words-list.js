// The words Agent Buddy never says to a person (docs/plain-words.md), and the helpers the word tests share.
// Not a test itself (tests/run.js runs *.test.js only).
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.join(__dirname, '..');

/** One entry per kind of word: `use` is what to say instead. A {name} slot is taken out before the text is looked at. */
export const BANNED = [
  { id: 'instance', re: /\binstances?\b/i, use: 'ServiceNow site' },
  { id: 'api-key', re: /\bAPI (?:keys?|versions?)\b|\bapi-(?:key|version)\b/i, use: 'AI key' },
  { id: 'endpoint', re: /\bendpoints?\b/i, use: 'AI service, AI address' },
  { id: 'provider', re: /\bproviders?\b/i, use: 'AI service' },
  { id: 'token', re: /\btokens?\b/i, use: 'daily AI limit, amount of text' },
  { id: 'your-user', re: /\b(?:your|this) user\b/i, use: 'you' },
  { id: 'acl', re: /\bACLs?\b|\baccess rules?\b/i, use: 'your role' },
  { id: 'database', re: /\bTable API\b|\bqueries\b|\bquery\b|\bcolumns?\b|\bjournal\b|\bJSON\b|\bsys_id\b|\b(?:sys|sn|u|x)_[a-z]/i, use: 'search, field, notes and comments, file' },
  { id: 'http-code', re: /\banswer \d{3}\b|\(\d{3}\)|\bHTTP\b(?!s?:)|\bstatus code\b/i, use: 'a plain clause and a next step' },
  { id: 'record', re: /\brecords?\b/i, use: 'ticket' },
  { id: 'session', re: /\b(?:your|own|ServiceNow|the) session\b|\bsession (?:has )?(?:expired|ended)\b/i, use: 'signed out, as you' },
  { id: 'log-in', re: /\blog(?:ged)? in\b|\blogin\b/i, use: 'sign in' },
  { id: 'it-team', re: /\bIT team\b/i, use: 'your administrator' },
];

/** Words banned only in the files of the words workstream (the rest of the product is cleaned up by the areas that own it). */
export const BANNED_OWN = [{ id: 'table', re: /\btables?\b/i, use: 'ticket type' }];

export const stripSlots = (text) => String(text).replace(/\$\{[^}]*\}/g, ' X ').replace(/\{[A-Za-z0-9_]+\}/g, ' ');

/** The ids of the banned words in a text. */
export const hitsOf = (text, list = BANNED) => {
  const clean = stripSlots(text);
  return list.filter(({ re }) => re.test(clean)).map(({ id }) => id);
};

// ---- Where a banned word is allowed ----------------------------------------------------------------------------------------------------
// Each entry names the files, the words allowed in them and why. A text is allowed only when EVERY file that uses it is on the list,
// and tests/words-banned.test.js fails when an entry has nothing left to allow.
export const ALLOWED = [
  // Settings > AI is the one place an administrator types provider, endpoint, API key, API version and tokens.
  { files: /^src\/options\/provider\//, ids: ['api-key', 'provider', 'endpoint', 'token'], why: 'Settings > AI: the fields an administrator fills in' },
  { files: /^src\/providers\/config\.js$/, ids: ['api-key', 'provider', 'endpoint'], why: 'the labels and hints of those fields (the vendor names its key "API key")' },
  { files: /^src\/lib\/aiUsage\.js$/, ids: ['api-key'], why: 'the address check of Settings > AI (an Azure address carries an api-version)' },
  { files: /^src\/options\/policyNotes\.js$/, ids: ['token'], why: 'the limit typed in Settings > AI > Usage and limits is a number of tokens' },
  { files: /^src\/options\/Options\.jsx$/, ids: ['provider'], why: 'the menu entry of the Settings > AI page ("AI provider")' },
  // A table that is not a ticket has no ticket noun: "vulnerability record" is the plain word for it.
  { files: /^src\/lib\/tableLabels\.js$/, ids: ['record'], why: 'the noun for a ServiceNow table that is not a ticket (a vulnerability, a security finding)' },
];

/** Files whose English is for IT and support, never shown in the panel (docs/plain-words.md rule 9). */
export const ADMIN_ONLY = [
  /^src\/options\/diagnostics\.js$/, // the text an administrator copies into a support message; English by design
  /^src\/policy\/enterprise\.js$/, // build-time checks of an enterprise build's policy file
];

export const allowedIn = (file, id) => ALLOWED.some((a) => a.files.test(file) && a.ids.includes(id));

// ---- The files of the words workstream ----------------------------------------------------------------------------------------------
export const isOwned = (file) =>
  [
    /^src\/providers\//,
    /^src\/options\//,
    /^src\/lib\/(aiUsage|keyStore|connectionCheck|messages)\.js$/,
    /^src\/policy\//,
    /^src\/sidepanel\/(AiKeyNote|SetupView|FirstRun)\.jsx$/,
    /^src\/sidepanel\/(shell|ui|palette|mywork)\//,
    /^src\/mywork\//,
    /^src\/content\/(bar|dock)[^/]*$/,
  ].some((re) => re.test(file));

export function walkSource(dir = path.join(ROOT, 'src'), out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSource(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** The files whose t() texts make the catalogue: everything but the catalogue itself and the PII patterns (as scripts/lib/i18nCheck.js). */
export const inScan = (full) => !/[\\/]src[\\/](?:i18n|pii)[\\/]/.test(full);

export const relative = (full) => path.relative(ROOT, full).replace(/\\/g, '/');

const CSS_CLASS = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/**
 * Every string in a source file that reads like a sentence: [{ line, text }]. A small scanner, not a pattern: it knows comments,
 * strings, template strings (and the strings inside their ${...}) and regular expressions, so a "//" inside a template or a quote inside
 * a regular expression does not confuse it. A list of CSS classes ("ab-table ab-set-table") is not a sentence.
 */
export function sentencesIn(code) {
  const out = [];
  const n = code.length;
  let line = 1;
  let i = 0;
  let depth = 0; // braces open in code
  const templates = []; // the brace depth at which a template's ${ was opened
  let prev = ''; // the last significant character of code: tells a division from a regular expression
  const add = (text, at) => {
    const clean = stripSlots(text);
    if (!/[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(clean)) return;
    if (clean.trim().split(/\s+/).every((word) => CSS_CLASS.test(word))) return;
    out.push({ line: at, text });
  };
  // the text of a template from the current position (after the backtick or the closing brace) to its end or to the next ${
  const readTemplate = () => {
    const at = line;
    let text = '';
    while (i < n) {
      const ch = code[i];
      if (ch === '\\') {
        text += code.slice(i, i + 2);
        i += 2;
      } else if (ch === '`') {
        i += 1;
        add(text, at);
        return;
      } else if (ch === '$' && code[i + 1] === '{') {
        i += 2;
        add(`${text} X `, at);
        templates.push(depth);
        depth += 1;
        return;
      } else {
        if (ch === '\n') line += 1;
        text += ch;
        i += 1;
      }
    }
    add(text, at);
  };
  while (i < n) {
    const ch = code[i];
    if (ch === '\n') {
      line += 1;
      i += 1;
    } else if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') i += 1;
    } else if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k += 1) if (code[k] === '\n') line += 1;
      i = stop;
    } else if (ch === "'" || ch === '"') {
      const at = line;
      let text = '';
      i += 1;
      while (i < n && code[i] !== ch && code[i] !== '\n') {
        if (code[i] === '\\') {
          text += code.slice(i, i + 2);
          i += 2;
        } else {
          text += code[i];
          i += 1;
        }
      }
      i += 1;
      add(text, at);
      prev = 'a';
    } else if (ch === '`') {
      i += 1;
      readTemplate();
      prev = 'a';
    } else if (ch === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      // a regular expression: up to the closing slash outside a character class
      i += 1;
      let inClass = false;
      while (i < n && code[i] !== '\n') {
        if (code[i] === '\\') {
          i += 2;
          continue;
        }
        if (code[i] === '[') inClass = true;
        else if (code[i] === ']') inClass = false;
        else if (code[i] === '/' && !inClass) break;
        i += 1;
      }
      i += 1;
      while (i < n && /[a-z]/.test(code[i])) i += 1;
      prev = 'a';
    } else {
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (templates.length && templates[templates.length - 1] === depth) {
          templates.pop();
          i += 1;
          readTemplate();
          prev = 'a';
          continue;
        }
      }
      prev = ch;
      i += 1;
    }
  }
  return out;
}

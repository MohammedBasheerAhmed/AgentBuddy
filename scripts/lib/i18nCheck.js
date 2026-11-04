// The check behind tests/i18n.test.js and `node scripts/i18n-check.js [folder or file ...]`: every text the code passes to t(), tn()
// or tm() has an Arabic entry, no entry is left over, and each entry has the same {name}s as its English text.
//
// The keys are read from the source with patterns, not by running the code, so a text has to be written out in full where it is
// passed: t('Open'), not t(label) or t('Open ' + x). Texts kept in a table are marked with tm('Open') where they are written (and
// shown with t(table[x])). A call that is not a plain text is listed as "dynamic" and fails the check.
const fs = require('fs');
const path = require('path');

// The repository root: this file is also bundled into a test, where __dirname is a temp folder, so look upwards for src/i18n.
function findRoot() {
  for (let dir = __dirname; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'src', 'i18n'))) return dir;
    if (path.dirname(dir) === dir) return process.cwd();
  }
}
const ROOT = findRoot();
// (a computed path keeps esbuild from bundling esbuild into a test)
const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
const SRC = path.join(ROOT, 'src');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function unescapeText(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (all, c) => {
    if (c[0] === 'u' && c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
    if (c[0] === 'x' && c.length === 3) return String.fromCharCode(parseInt(c.slice(1), 16));
    if (c === 'n') return '\n';
    if (c === 't') return '\t';
    if (c === '\n') return '';
    return c;
  });
}

const STR = '(?:\'((?:\\\\.|[^\'\\\\\\n])*)\'|"((?:\\\\.|[^"\\\\\\n])*)")';
// (`tr` is `t` imported under another name, in a file that has a variable called t.)
const CALL_ONE = new RegExp(`(?<![\\w.$])(t|tr|tm|tx)\\(\\s*${STR}`, 'g');
const CALL_PLURAL = new RegExp(`(?<![\\w.$])tn\\(\\s*[^,()]+(?:\\([^()]*\\))?[^,()]*,\\s*${STR}\\s*,\\s*${STR}`, 'g');
// A call that cannot be read: t(`..`), t(a + b), t(f(x)), and a tm() or tx() whose text is not written out. (t(NAME) and t(TABLE[key]) are
// fine: they show a text that was marked with tm() where it is written.)
const DYNAMIC = /(?<![\w.$])(?:(?:t|tr|tm|tx)\(\s*(?:`|[A-Za-z_$][\w$.]*\s*[+(]|[0-9({![])|(?:tm|tx)\((?!\s*['"]))/g;
const DYNAMIC_PLUS = new RegExp(`(?<![\\w.$])(?:t|tr|tm|tx)\\(\\s*${STR}\\s*\\+`, 'g');
const DYNAMIC_PLURAL = /(?<![\w.$])tn\(\s*[^,()]+(?:\([^()]*\))?[^,()]*,\s*(?!['"])[^\s]/g;

// Comments are not code: blank them out (keeping the line breaks, so the line numbers stay right).
const withoutComments = (code) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, before) => before);

const lineOf = (code, index) => code.slice(0, index).split('\n').length;
const paramsOf = (text) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort().join(',');

/** Every key used in the files: Map key -> [{ file, line, plural }] and the dynamic calls. */
function collect(files) {
  const keys = new Map();
  const dynamic = [];
  const add = (key, file, line, plural) => {
    if (!keys.has(key)) keys.set(key, []);
    keys.get(key).push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), line, plural });
  };
  for (const file of files) {
    const code = withoutComments(fs.readFileSync(file, 'utf8'));
    if (!/\b(?:t|tr|tm|tn|tx)\(/.test(code)) continue;
    for (const m of code.matchAll(CALL_ONE)) {
      const raw = m[2] !== undefined ? m[2] : m[3];
      add(unescapeText(raw), file, lineOf(code, m.index), false);
    }
    for (const m of code.matchAll(CALL_PLURAL)) {
      const one = unescapeText(m[1] !== undefined ? m[1] : m[2]);
      const other = unescapeText(m[3] !== undefined ? m[3] : m[4]);
      add(`${one}|${other}`, file, lineOf(code, m.index), true);
    }
    for (const re of [DYNAMIC, DYNAMIC_PLUS, DYNAMIC_PLURAL]) {
      for (const m of code.matchAll(re)) dynamic.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), line: lineOf(code, m.index), text: code.slice(m.index, m.index + 60).split('\n')[0] });
    }
  }
  return { keys, dynamic };
}

/** The Arabic catalogue, loaded from the source (it is an ES module). */
function loadCatalogue(language = 'ar') {
  const entry = path.join(SRC, 'i18n', language, 'index.js');
  const built = esbuild.buildSync({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const module_ = { exports: {} };
  new Function('module', 'exports', built.outputFiles[0].text)(module_, module_.exports);
  const table = module_.exports.AR || module_.exports[language.toUpperCase()] || Object.values(module_.exports)[0] || {};
  return table;
}

const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * @param {{ only?: string[], whole?: boolean }} [options] only: folders or files (relative to src or the repo) to look at;
 *   whole: also report entries no text uses (only meaningful when every file is read, so it is off with `only`)
 * @returns {{ missing, extra, params, dynamic, badPlural, used, entries }}
 */
function checkI18n(options = {}) {
  const only = (options.only || []).map((p) => path.resolve(ROOT, p.replace(/^src[\\/]/, 'src/'))).map((p) => (fs.existsSync(p) ? p : path.join(SRC, path.relative(ROOT, p).replace(/^src[\\/]/, ''))));
  const skip = ['i18n', 'pii'].map((d) => path.join(SRC, d) + path.sep); // pii: patterns that only look like calls
  const all = walk(SRC).filter((f) => !skip.some((s) => f.startsWith(s)));
  const files = only.length ? all.filter((f) => only.some((p) => f === p || f.startsWith(p + path.sep))) : all;
  const { keys, dynamic } = collect(files);
  const table = loadCatalogue();
  const missing = [];
  const params = [];
  const badPlural = [];
  for (const [key, where] of keys) {
    const entry = table[key];
    if (entry === undefined || entry === '' || entry === null) {
      missing.push({ key, where: where[0] });
      continue;
    }
    if (where[0].plural) {
      const [, other] = key.split('|');
      if (typeof entry !== 'object') {
        badPlural.push({ key, why: 'a text with a count needs an object with the plural forms (zero, one, two, few, many, other)' });
        continue;
      }
      const absent = PLURAL_CATEGORIES.filter((c) => !entry[c]);
      if (absent.length) badPlural.push({ key, why: `missing forms: ${absent.join(', ')}` });
      for (const form of Object.keys(entry)) if (!PLURAL_CATEGORIES.includes(form)) badPlural.push({ key, why: `unknown form "${form}"` });
      for (const [form, text] of Object.entries(entry)) {
        // A form may leave out {n} (Arabic says "تذكرة واحدة" and "تذكرتان" without a number) but may not use a name the English does not have.
        const have = new Set(paramsOf(other).split(',').filter(Boolean));
        const extra = paramsOf(String(text)).split(',').filter((name) => name && !have.has(name));
        if (extra.length) params.push({ key: `${key} [${form}]`, english: paramsOf(other), arabic: paramsOf(String(text)) });
      }
    } else if (typeof entry !== 'string') {
      badPlural.push({ key, why: 'an object is only for texts with a count (tn)' });
    } else if (paramsOf(entry) !== paramsOf(key)) {
      params.push({ key, english: paramsOf(key), arabic: paramsOf(entry) });
    }
  }
  const extra = options.whole && !only.length ? Object.keys(table).filter((k) => !keys.has(k)) : [];
  return { missing, extra, params, dynamic, badPlural, used: keys.size, entries: Object.keys(table).length };
}

/** Each catalogue file on its own: [{ file, table }] (to see whether two files give one English text two different translations). */
function loadCatalogueFiles(language = 'ar') {
  const dir = path.join(SRC, 'i18n', language);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.js') && name !== 'index.js')
    .sort()
    .map((name) => {
      const built = esbuild.buildSync({ entryPoints: [path.join(dir, name)], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
      const module_ = { exports: {} };
      new Function('module', 'exports', built.outputFiles[0].text)(module_, module_.exports);
      return { file: name, table: Object.values(module_.exports)[0] || {} };
    });
}

module.exports = { checkI18n, collect, loadCatalogue, loadCatalogueFiles, walk };

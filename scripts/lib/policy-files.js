// Reads Agent Buddy's managed policy out of the files administrators deploy, so scripts/check-policy.js and the tests can check them:
//
//   .reg          Windows registry: ...\Policies\<Google\Chrome | Microsoft\Edge>\3rdparty\extensions\<id>\policy, lists as subkeys
//                 with values "1", "2", ...; true/false and numbers as REG_DWORD
//   .mobileconfig / .plist   macOS: a payload whose PayloadType is com.google.Chrome.extensions.<id> or com.microsoft.Edge.extensions.<id>
//   .json         Linux managed-policy file ({"3rdparty": {"extensions": {"<id>": {...}}}}), the Google Admin console format
//                 ({"key": {"Value": ...}}), or a plain object of policy keys
//
// Pure apart from the caller reading the file; each reader takes the text. Returns [{ browser, extensionId, policy, browserPolicy }]:
// one entry per extension policy found. `browserPolicy` holds the browser-level keys found next to it (ExtensionInstallForcelist).
// Value types follow managed_schema.json (passed in), the way the browser converts registry values.

const BROWSERS = { 'google\\chrome': 'chrome', 'microsoft\\edge': 'edge', 'com.google.chrome': 'chrome', 'com.microsoft.edge': 'edge' };

// ---- Windows .reg ------------------------------------------------------------------------------------------------------------

function unquoteReg(text) {
  return text.replace(/\\(["\\])/g, '$1');
}

/** { '<key path, lower case>': { path, values: { name: { type, value } } } } */
function parseRegText(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!/^(Windows Registry Editor Version 5\.00|REGEDIT4)$/.test(lines[0].trim())) throw new Error('A .reg file starts with "Windows Registry Editor Version 5.00".');
  const keys = {};
  let current = null;
  lines.slice(1).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith(';')) return;
    const section = /^\[(-?)(.+)\]$/.exec(line);
    if (section) {
      if (section[1]) throw new Error(`line ${i + 2}: a sample must not delete keys ([-...]).`);
      const keyPath = section[2];
      current = keys[keyPath.toLowerCase()] || (keys[keyPath.toLowerCase()] = { path: keyPath, values: {} });
      return;
    }
    if (!current) throw new Error(`line ${i + 2}: a value before any [key].`);
    const value = /^"((?:[^"\\]|\\.)*)"=(?:"((?:[^"\\]|\\.)*)"|dword:([0-9a-fA-F]{8}))$/.exec(line);
    if (!value) throw new Error(`line ${i + 2}: only "name"="text" and "name"=dword:xxxxxxxx values are understood: ${line}`);
    current.values[unquoteReg(value[1])] = value[3] !== undefined ? { type: 'dword', value: parseInt(value[3], 16) } : { type: 'sz', value: unquoteReg(value[2]) };
  });
  return keys;
}

// A REG_DWORD is a number; the browser reads it as true/false where the schema says boolean.
const regValue = (entry, type) => (type === 'boolean' && entry.type === 'dword' ? entry.value !== 0 : entry.value);

const numbered = (values) =>
  Object.keys(values)
    .filter((n) => /^\d+$/.test(n))
    .sort((a, b) => Number(a) - Number(b))
    .map((n) => values[n].value);

function readReg(text, schema) {
  const keys = parseRegText(text);
  const found = new Map();
  const browserPolicy = {};
  for (const { path, values } of Object.values(keys)) {
    const ext = /\\Policies\\(Google\\Chrome|Microsoft\\Edge)\\3rdparty\\extensions\\([^\\]+)\\policy(?:\\([^\\]+))?$/i.exec(path);
    if (ext) {
      const id = `${BROWSERS[ext[1].toLowerCase()]}:${ext[2]}`;
      const item = found.get(id) || { browser: BROWSERS[ext[1].toLowerCase()], extensionId: ext[2], policy: {}, browserPolicy };
      found.set(id, item);
      if (ext[3]) item.policy[ext[3]] = numbered(values);
      else for (const [name, entry] of Object.entries(values)) item.policy[name] = regValue(entry, schema?.properties?.[name]?.type);
      continue;
    }
    const browserList = /\\Policies\\(Google\\Chrome|Microsoft\\Edge)\\(ExtensionInstallForcelist|ExtensionInstallAllowlist)$/i.exec(path);
    if (browserList) browserPolicy[browserList[2]] = numbered(values);
  }
  return [...found.values()];
}

// ---- macOS property lists -----------------------------------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]);

/** A small reader for the XML plist subset configuration profiles use: dict, array, key, string, integer, real, true, false. */
function parsePlist(text) {
  const body = String(text).replace(/^\uFEFF/, '').replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const tokens = [...body.matchAll(/<(\/?)([a-zA-Z]+)(?:\s+[^>]*?)?\s*(\/?)>|([^<]+)/g)].map((m) => (m[4] !== undefined ? { text: m[4] } : { close: Boolean(m[1]), tag: m[2], empty: Boolean(m[3]) }));
  if (/<(?![a-zA-Z/])/.test(body)) throw new Error('plist: a "<" that does not start a tag (write &lt;)');
  let i = 0;
  const skipSpace = () => {
    while (i < tokens.length && tokens[i].text !== undefined && !tokens[i].text.trim()) i += 1;
  };
  const expectClose = (tag) => {
    skipSpace();
    const t = tokens[i];
    if (!t || !t.close || t.tag !== tag) throw new Error(`plist: expected </${tag}>`);
    i += 1;
  };
  const textUntil = (tag) => {
    let out = '';
    while (i < tokens.length && tokens[i].text !== undefined) out += tokens[(i += 1) - 1].text;
    expectClose(tag);
    return decodeXml(out);
  };
  function value() {
    skipSpace();
    const t = tokens[i];
    if (!t || t.text !== undefined || t.close) throw new Error('plist: expected a value');
    i += 1;
    if (t.empty) {
      if (t.tag === 'true') return true;
      if (t.tag === 'false') return false;
      if (t.tag === 'string') return '';
      if (t.tag === 'array') return [];
      if (t.tag === 'dict') return {};
      throw new Error(`plist: <${t.tag}/> is not understood`);
    }
    switch (t.tag) {
      case 'plist': {
        const v = value();
        expectClose('plist');
        return v;
      }
      case 'dict': {
        const out = {};
        for (;;) {
          skipSpace();
          if (tokens[i]?.close && tokens[i].tag === 'dict') {
            i += 1;
            return out;
          }
          const k = tokens[i];
          if (!k || k.tag !== 'key' || k.close) throw new Error('plist: expected <key> in a <dict>');
          i += 1;
          const name = textUntil('key');
          out[name] = value();
        }
      }
      case 'array': {
        const out = [];
        for (;;) {
          skipSpace();
          if (tokens[i]?.close && tokens[i].tag === 'array') {
            i += 1;
            return out;
          }
          out.push(value());
        }
      }
      case 'string':
        return textUntil('string');
      case 'integer': {
        const n = Number(textUntil('integer').trim());
        if (!Number.isInteger(n)) throw new Error('plist: <integer> is not a whole number');
        return n;
      }
      case 'real':
        return Number(textUntil('real').trim());
      case 'true':
      case 'false':
        expectClose(t.tag);
        return t.tag === 'true';
      default:
        throw new Error(`plist: <${t.tag}> is not understood`);
    }
  }
  return value();
}

function readPlist(text) {
  const root = parsePlist(text);
  const payloads = Array.isArray(root?.PayloadContent) ? root.PayloadContent : [root];
  const browserPolicy = {};
  const out = [];
  for (const payload of payloads) {
    const type = String(payload?.PayloadType || '');
    const ext = /^(com\.google\.Chrome|com\.microsoft\.Edge)\.extensions\.(.+)$/i.exec(type);
    const strip = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('Payload')));
    if (ext) out.push({ browser: BROWSERS[ext[1].toLowerCase()], extensionId: ext[2], policy: strip(payload), browserPolicy });
    else if (/^(com\.google\.Chrome|com\.microsoft\.Edge)$/i.test(type)) Object.assign(browserPolicy, strip(payload));
  }
  return out;
}

// ---- JSON ---------------------------------------------------------------------------------------------------------------------

function readJson(text, { browser = '' } = {}) {
  const data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The JSON must be an object.');
  const { '3rdparty': third, ...rest } = data;
  if (third) {
    const exts = third?.extensions;
    if (!exts || typeof exts !== 'object') throw new Error('"3rdparty" must hold "extensions": { "<extension id>": { ...policy } }.');
    return Object.entries(exts).map(([extensionId, policy]) => ({ browser, extensionId, policy, browserPolicy: rest }));
  }
  const values = Object.values(data);
  // Google Admin console, "Policy for extensions": every key is { "Value": ... }.
  if (values.length && values.every((v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && 'Value' in v)) {
    return [{ browser: 'chrome', extensionId: '', policy: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.Value])), browserPolicy: {} }];
  }
  return [{ browser, extensionId: '', policy: data, browserPolicy: {} }];
}

/** The extension policies in a file, by its name and text. */
function readPolicyFile(name, text, schema) {
  const lower = String(name).toLowerCase();
  if (lower.endsWith('.reg')) return readReg(text, schema);
  if (lower.endsWith('.mobileconfig') || lower.endsWith('.plist')) return readPlist(text);
  if (lower.endsWith('.json')) return readJson(text, { browser: lower.includes('edge') ? 'edge' : lower.includes('chrome') ? 'chrome' : '' });
  throw new Error(`${name}: use a .reg, .mobileconfig, .plist or .json file.`);
}

module.exports = { readPolicyFile, parseRegText, parsePlist, readReg, readPlist, readJson };

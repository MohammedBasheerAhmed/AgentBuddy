// CycloneDX 1.5 SBOM from package-lock.json, without the network. Pure: the lockfile, package.json and the list of packages that end
// up inside the extension's bundles are passed in (scripts/sbom.js works the last one out from esbuild's metafile).
//
// Every package of the lockfile is listed. `scope` says how it is used: "required" for what the extension needs at run time, "excluded"
// for build and test tools (esbuild), "optional" for optional platform binaries. The property `agentbuddy:bundled` says whether the
// package's code is inside the shipped bundles (React, React DOM, scheduler); nothing else ships.
const crypto = require('crypto');

// The URL namespace of RFC 4122, for a name-based (version 5) serial number: the same lockfile always gives the same SBOM.
const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

function uuidV5(name) {
  const ns = Buffer.from(URL_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** "node_modules/@esbuild/win32-x64" -> "@esbuild/win32-x64" */
const nameOfKey = (key) => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);

const purlOf = (name, version) => `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${version}`;

// "sha512-<base64>" -> { alg: 'SHA-512', content: '<hex>' }
function hashOf(integrity) {
  const m = /^sha(512|384|256|1)-([A-Za-z0-9+/=]+)$/.exec(String(integrity || '').split(/\s+/)[0] || '');
  if (!m) return null;
  return { alg: m[1] === '1' ? 'SHA-1' : `SHA-${m[1]}`, content: Buffer.from(m[2], 'base64').toString('hex') };
}

const licenseOf = (license) => {
  const text = String(license || '').trim();
  if (!text) return undefined;
  return /^[A-Za-z0-9.+-]+$/.test(text) ? [{ license: { id: text } }] : [{ expression: text }];
};

// The lockfile entry a dependency `name` of the package at `fromKey` resolves to, the way Node looks it up (nearest node_modules first).
function resolveKey(packages, fromKey, name) {
  let base = fromKey;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return '';
    const at = base.lastIndexOf('/node_modules/');
    base = at >= 0 ? base.slice(0, at) : '';
  }
}

/**
 * @param {{ lock: object, pkg: object, bundled: string[], lockText: string }} input bundled: lockfile keys whose code is in the bundles
 * @returns {object} the SBOM, ready for JSON.stringify
 */
function buildSbom({ lock, pkg, bundled = [], lockText = '' }) {
  if (!lock || lock.lockfileVersion < 2 || !lock.packages) throw new Error('package-lock.json must be lockfileVersion 2 or 3 (npm 7 or later).');
  const packages = lock.packages;
  const inBundle = new Set(bundled);
  const keys = Object.keys(packages).filter((k) => k).sort();
  const refOf = new Map();
  const components = keys.map((key) => {
    const entry = packages[key];
    const name = entry.name || nameOfKey(key);
    const purl = purlOf(name, entry.version);
    let ref = purl;
    if ([...refOf.values()].includes(ref)) ref = `${purl}#${key}`;
    refOf.set(key, ref);
    const slash = name.startsWith('@') ? name.indexOf('/') : -1;
    const properties = [{ name: 'cdx:npm:package:path', value: key }];
    if (entry.dev) properties.push({ name: 'cdx:npm:package:development', value: 'true' });
    if (entry.optional) properties.push({ name: 'agentbuddy:optional-platform-binary', value: 'true' });
    properties.push({ name: 'agentbuddy:bundled', value: inBundle.has(key) ? 'true' : 'false' });
    const hash = hashOf(entry.integrity);
    return {
      type: 'library',
      'bom-ref': ref,
      ...(slash > 0 ? { group: name.slice(0, slash), name: name.slice(slash + 1) } : { name }),
      version: entry.version,
      scope: entry.dev ? 'excluded' : entry.optional ? 'optional' : 'required',
      ...(hash ? { hashes: [hash] } : {}),
      ...(licenseOf(entry.license) ? { licenses: licenseOf(entry.license) } : {}),
      purl,
      ...(entry.resolved ? { externalReferences: [{ type: 'distribution', url: entry.resolved }] } : {}),
      properties,
    };
  });

  const rootRef = purlOf(pkg.name, pkg.version);
  const depsOf = (fromKey, entry) => {
    const names = Object.keys({ ...(entry.dependencies || {}), ...(entry.optionalDependencies || {}), ...(entry.devDependencies || {}) });
    return [...new Set(names.map((n) => refOf.get(resolveKey(packages, fromKey, n))).filter(Boolean))].sort();
  };
  const dependencies = [
    { ref: rootRef, dependsOn: depsOf('', { dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }) },
    ...keys.map((key) => ({ ref: refOf.get(key), dependsOn: depsOf(key, packages[key]) })),
  ];

  const lockSha256 = crypto.createHash('sha256').update(lockText || JSON.stringify(lock)).digest('hex');
  return {
    $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${uuidV5(`agentbuddy-sbom:${pkg.version}:${lockSha256}:${[...inBundle].sort().join(',')}`)}`,
    version: 1,
    metadata: {
      tools: { components: [{ type: 'application', name: 'agentbuddy scripts/sbom.js', version: String(pkg.version) }] },
      component: {
        type: 'application',
        'bom-ref': rootRef,
        name: pkg.name,
        version: pkg.version,
        description: pkg.description || '',
        purl: rootRef,
      },
      properties: [
        { name: 'agentbuddy:lockfile-sha256', value: lockSha256 },
        { name: 'agentbuddy:note', value: 'Generated from package-lock.json without the network. scope "excluded" = build or test tool, not shipped; agentbuddy:bundled = the code is inside the extension bundles.' },
      ],
    },
    components,
    dependencies,
  };
}

/** Lockfile keys ("node_modules/react") of the packages whose files appear among esbuild metafile inputs. */
function bundledKeys(inputPaths) {
  const keys = new Set();
  for (const p of inputPaths) {
    const normal = String(p).replace(/\\/g, '/');
    const m = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(normal);
    if (m) keys.add(m[1].slice(m[1].indexOf('node_modules/')));
  }
  return [...keys].sort();
}

module.exports = { buildSbom, bundledKeys, uuidV5, purlOf };

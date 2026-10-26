// A throw-away self-signed certificate for https://localhost, so the fake ServiceNow instance can be served over HTTPS
// (the extension only enables https instances). Chrome is started with --ignore-certificate-errors.
//
// Tries, in order: the `openssl` on PATH, the openssl that ships with Git for Windows, then the `selfsigned` npm package
// (install it with `npm i --no-save selfsigned`). The certificate and key are written only to the temp directory.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OPENSSL_CANDIDATES = [
  'openssl',
  'C:/Program Files/Git/mingw64/bin/openssl.exe',
  'C:/Program Files/Git/usr/bin/openssl.exe',
  'C:/Program Files (x86)/Git/mingw64/bin/openssl.exe',
];

// A minimal config so the result does not depend on a machine-wide openssl.cnf (Git for Windows' one is often missing).
const CONFIG = `[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = localhost
[ext]
subjectAltName = DNS:localhost,IP:127.0.0.1,IP:::1
basicConstraints = CA:FALSE
`;

function withOpenssl(dir) {
  const keyFile = path.join(dir, 'localhost.key');
  const certFile = path.join(dir, 'localhost.crt');
  const confFile = path.join(dir, 'openssl.cnf');
  fs.writeFileSync(confFile, CONFIG);
  for (const exe of OPENSSL_CANDIDATES) {
    const r = spawnSync(exe, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '2', '-config', confFile], { encoding: 'utf8' });
    if (r.status === 0 && fs.existsSync(certFile)) return { key: fs.readFileSync(keyFile, 'utf8'), cert: fs.readFileSync(certFile, 'utf8'), via: exe };
  }
  return null;
}

async function withSelfsigned() {
  let selfsigned;
  try {
    selfsigned = require('selfsigned');
  } catch {
    return null;
  }
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const options = { days: 2, keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }] };
  const pems = await selfsigned.generate(attrs, options); // sync in v2, a promise in v3
  return { key: pems.private, cert: pems.cert, via: 'selfsigned' };
}

/** @returns {Promise<{ key: string, cert: string, via: string }>} */
async function makeCertificate(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const found = withOpenssl(dir) || (await withSelfsigned());
  if (!found) throw new Error('Could not create a TLS certificate: no openssl found and the `selfsigned` package is not installed (npm i --no-save selfsigned).');
  return found;
}

module.exports = { makeCertificate };

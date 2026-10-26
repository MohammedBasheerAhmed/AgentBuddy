// Public API of the PII firewall. seal() is deliberately NOT exported: only code inside src/pii/ can mint a sealed request
// (tests/seal.test.js walks src/ to prove it). The provider dispatcher gets assertSealed/isSealed and nothing else.

export { createFirewall, FirewallError } from './firewall.js';
export { detect, KINDS } from './detectors.js';
export { assertSealed, isSealed } from './seal.js';

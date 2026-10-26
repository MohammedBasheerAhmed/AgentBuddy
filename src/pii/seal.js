// The "sealed request" rule: nothing reaches an AI provider unless it was produced by the PII firewall.
//
// firewall.js builds every outgoing request, seals it here, and src/providers/index.js refuses anything that is not
// sealed. The registry is a module-private WeakSet, so a caller cannot forge a sealed request by copying fields or
// adding a flag: only the exact object that went through seal() passes isSealed().
//
// tests/seal.test.js checks that only src/pii/** imports seal(), so no other module can mint a sealed request.

const sealed = new WeakSet();

/** Freeze `request` and register it as produced by the firewall. Call from src/pii/** only. */
export function seal(request) {
  if (!request || typeof request !== 'object') throw new TypeError('seal() needs a request object.');
  if (!Array.isArray(request.messages) || !request.messages.length) throw new TypeError('A sealed request needs messages.');
  const frozen = Object.freeze({ ...request, messages: Object.freeze(request.messages.map((m) => Object.freeze({ ...m }))) });
  sealed.add(frozen);
  return frozen;
}

/** True only for an object returned by seal(). */
export function isSealed(request) {
  return Boolean(request) && typeof request === 'object' && sealed.has(request);
}

/** Throws unless the request came through the firewall. Used by the provider dispatcher as its first line. */
export function assertSealed(request) {
  if (!isSealed(request)) {
    throw new Error('Blocked: this request did not go through the PII firewall, so nothing was sent.');
  }
  return request;
}

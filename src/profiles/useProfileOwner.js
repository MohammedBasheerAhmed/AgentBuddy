// Who is signed in, as the short one-way hash the work profiles are confirmed under (W-18, audit of 2026-11-07): the panel passes it to
// withProfiles (src/profiles/profiles.js), which carries it as `eff.signedIn` to everything that saves a choice of profiles.
// The hash is the one "since you last looked" uses (userHash in src/lib/lastViewed.js: the first 8 bytes of SHA-256 over the site and the
// user id, 16 hexadecimal characters). The user id is read from the page's answer, hashed here, and never stored or logged.
import { useEffect, useState } from 'react';
import { instanceOf, userHash } from '../lib/lastViewed.js';
import { cleanProfilesFor } from './ids.js';

/**
 * What the hash is made from: the site (the page's address, as its origin) and the user id the page named. '' when either is missing:
 * then nobody is known and nothing is decided from it. Pure.
 */
export function profileOwnerKey(page) {
  const userId = String(page?.user?.userId || '').trim().toLowerCase();
  const instance = instanceOf(page?.href);
  return userId && instance ? `${instance}|${userId}` : '';
}

/**
 * The hash of the person at the screen, or '' until it is worked out (it is asynchronous: Web Crypto) and whenever the page does not say
 * who is signed in. While it is '' the stored profiles are kept as they are: not knowing never takes a choice away.
 * @param {{ href?: string, user?: { userId?: string }|null }|null} page  what usePage says about the active tab
 */
export function useProfileOwner(page) {
  const key = profileOwnerKey(page);
  const [done, setDone] = useState({ key: '', hash: '' });
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    const bar = key.indexOf('|');
    userHash(key.slice(bar + 1), key.slice(0, bar))
      .then((hash) => alive && setDone({ key, hash: cleanProfilesFor(hash) }))
      .catch(() => alive && setDone({ key, hash: '' }));
    return () => {
      alive = false;
    };
  }, [key]);
  return key && done.key === key ? done.hash : '';
}

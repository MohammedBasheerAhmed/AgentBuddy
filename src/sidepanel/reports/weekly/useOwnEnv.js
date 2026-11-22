import { useMemo } from 'react';
import { useEffective } from '../../useEffective.js';
import { usePage } from '../../usePage.js';
import { useProfileOwner } from '../../../profiles/useProfileOwner.js';
import { withProfiles } from '../../../profiles/profiles.js';

/**
 * The page and the effective settings, for a weekly view that was opened with only `onBack` (the screen that opens it may or may not pass
 * its own `page` and `eff`: when it does, this hook is not used). The same pieces App.jsx's Panel puts together: the settings with the
 * organisation's policy, the page the panel is looking at (a held answer counts), the profiles the person's roles call for.
 * @returns {{ ready: boolean, page: object|null, eff: object|null }} `ready` is false until the settings and the page are known
 */
export function useOwnEnv() {
  const base = useEffective();
  const { page, lastGood } = usePage(base.policy);
  const who = useProfileOwner(page);
  const eff = useMemo(() => (base.ready ? withProfiles(base, { roles: page?.user?.roles, kind: page?.record?.kind, who }) : null), [base, page?.user?.roles, page?.record?.kind, who]);
  // When the active tab is not a ServiceNow page the screens keep working on the last page that answered.
  const usable = page && page.tabId && page.status !== 'not-enabled' && page.status !== 'loading' ? page : lastGood || null;
  return { ready: Boolean(eff && usable), page: usable, eff };
}

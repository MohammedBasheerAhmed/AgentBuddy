// The ids of the work profiles and of the screens an organisation can switch off. Plain constants in their own file so the policy
// reader (which the content script also loads) can check policy values against them without loading the profile rules.

/** Work profiles (TRACKER.md 2.5). The first four are what a person works on; the last three are add-ons. */
export const PROFILE_IDS = Object.freeze(['it', 'req', 'csm', 'hr', 'lead', 'km', 'mpc']);

/** Screens of the panel a policy may hide (`disabledSections`). The Ticket screen is the base and cannot be hidden. */
export const HIDEABLE_SCREENS = Object.freeze(['mywork', 'team', 'write', 'knowledge']);

/**
 * Who confirmed the stored work profiles: the setting `profilesFor` holds one short one-way hash of the ServiceNow site and the
 * signed-in person's user id (userHash in src/lib/lastViewed.js: 16 lower-case hexadecimal characters). Never the user id itself.
 * Anything else, or nothing, is '' ("not known"), so the setting can never grow or carry text (build rule 7).
 */
export const PROFILES_FOR_RE = /^[0-9a-f]{16}$/;

/** The setting as it is kept: the 16-character hash, or '' for anything that is not exactly one. Pure. */
export function cleanProfilesFor(value) {
  const hash = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return PROFILES_FOR_RE.test(hash) ? hash : '';
}

// The ids of the work profiles and of the screens an organisation can switch off. Plain constants in their own file so the policy
// reader (which the content script also loads) can check policy values against them without loading the profile rules.

/** Work profiles (TRACKER.md 2.5). The first four are what a person works on; the last three are add-ons. */
export const PROFILE_IDS = Object.freeze(['it', 'req', 'csm', 'hr', 'lead', 'km', 'mpc']);

/** Screens of the panel a policy may hide (`disabledSections`). The Ticket screen is the base and cannot be hidden. */
export const HIDEABLE_SCREENS = Object.freeze(['mywork', 'team', 'write', 'knowledge']);

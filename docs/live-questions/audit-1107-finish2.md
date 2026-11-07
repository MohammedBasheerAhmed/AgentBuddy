# Profiles per person, and the leftover plain words (audit of 2026-11-07, last build wave, builder Q2)

Area: W-18 (the work profiles are confirmed by a person, not by a browser) and the leftover texts of J35 and J37 (`docs/plain-words.md`).
Tests: `tests/finish2-profiles.test.js`, `tests/finish2-words.test.js`. The Arabic is `src/i18n/ar/finish2.js`.

## How it behaves

- The setting `profilesFor` (in `agentbuddy_settings`, next to `profilesConfirmed`) holds one short one-way hash of the ServiceNow site
  and the signed-in person's user id: the same hash "since you last looked" uses (`userHash`, `src/lib/lastViewed.js`, 16 hex characters).
  The user id is never stored; with no user id the setting is empty. `effectiveSettings` keeps only exactly 16 hex characters, and only
  while `profilesConfirmed` is true. Settings > Stored data > Clear everything removes it with the rest of the settings.
- A different person is signed in when the hash differs from `profilesFor`. Then, and only when the page also told us the roles (a list,
  also an empty one; `null` is "not known"), `withProfiles` sets the stored choice aside: the profiles follow the roles, `profilesConfirmed`
  reads false, and the "Getting started" card asks "Choose what you work on" again with the roles' suggestion. Nothing on disk changes
  until the person answers; the answer saves their hash.
- Nothing triggers it when: no person is known (no user id on the page, or the hash is still being worked out), the roles are not known,
  nobody was recorded (every confirmation made before this change), or the organisation locked the profiles. The same person is never asked
  again; the person's own choice always wins.
- The Settings page cannot tell who is signed in (it has no page): a tick there saves the profiles and leaves `profilesFor` as it is.

## Questions to settle on a real site

1. **The user id on each surface.** Assumed: `page.user.userId` is present on a classic page and on the Workspace (the "Me" lookup in
   `src/content/sessionToken.js`), and absent where the page does not say; then nothing is decided. Check: with the panel open, sign in
   as one user and answer the question; then use Impersonate user (ITIL User, then Abel Tuter) in the same browser. Expected: the
   question comes back for each new person (their roles suggest the profile) and not on the next visit of the same person. If a surface
   gives no user id, the old behaviour (one choice for the browser) stays there.
2. **One slot per browser.** Assumed: two people who share a browser are rare enough that one stored choice is enough. With one slot
   the question comes back for the first person after the second answered. The same applies to ONE person who uses two sites (a
   sandbox and the live site) in the same browser: the user ids differ per site, so each switch of site asks once. If this is common,
   keep a short list of hashes (at most four) instead of one: confirming adds the person when the profiles are the same and replaces the
   list when they differ. The change is in `profilesConfirmedFor` and `confirmPatch` (`src/profiles/profiles.js`) and `cleanProfilesFor`.
3. **The page bar.** The bar on the ServiceNow page decides in the service worker (`barFeatureShown`, `src/features/visibility.js`), which
   does not know the person: it keeps using the stored choice for a different person until they answer in the panel. Only what is shown
   differs; nothing that decides what may be written or sent.
4. **An empty list of roles.** Assumed: a page that answers with an empty list means "asked, holds none of the roles looked for", so a
   different person with an empty list is asked again (the suggestion is IT, the default). If a surface answers with an empty list when it
   really could not read the roles, the card would be asked for nothing: change `profilesConfirmedFor` to require `rolesState(roles) === 'known'`.

## Wording (J35, J37)

- Finished in the files of this builder: the first-run hint of "Open a ticket" (no list of kinds of ticket), the portal line of the Ticket
  screen ("Open a ticket on this portal ..."), and the Stored data line for the settings. Earlier waves had finished SetupView's line,
  PrivacySection and JourneyCard.
- Left as they are on purpose: "Open a blank incident" (the button opens an incident form), "{n} linked incident(s)" (the incidents linked to
  a problem or a change), "Major incident update" (the action is for major incidents), "Incident" first in the My work lists (it is the incident
  list), "Strict" and "Local only" (the names of the privacy modes, used everywhere), and "titles" in the knowledge gaps line (the everyday word
  for a ticket's short description). "Show as table" labels a grid of numbers, not a database table; three tests and the Arabic of the reports
  use it.

## Changes in files that are not this builder's (for the lead)

| File | Change | Arabic |
|---|---|---|
| `src/sidepanel/App.jsx` line 355 | `import { useProfileOwner } from '../profiles/useProfileOwner.js';` then `const who = useProfileOwner(page);` before the memo, and `withProfiles(base, { roles: page?.user?.roles, kind: page?.record?.kind, who })` with `who` added to the memo's dependencies. Without this the feature is off (the panel works as before). | none |
| `src/sidepanel/shell/shellParts.jsx` line 92 (`ProfileHint`) | `saveSettings(confirmPatch([...new Set([...activeProfiles(eff), hint.profile.id])], eff))`, importing `confirmPatch` from `../../profiles/profiles.js`. Without it the "Show them" button saves no `profilesFor` and a different person's hint answer would be set aside at the next draw. | none |
| `src/i18n/ar/index.js` | `import { withFinish2 } from './finish2.js';` and `export const AR = withFinish2(withWords({ ... }));` (applied after `withWords`: the retired key "Your choices: AI service and model, privacy mode, which ServiceNow sites you turned on." is in `words.js`). | the file |
| `src/sidepanel/ticket/cards/OutageCard.jsx` line 26 (J35, optional) | `'{line}. This may be one outage: check for a parent ticket before working it alone.'` (the card is drawn on incidents, problems and cases, so "parent incident" is wrong on a case). Old key goes to the retired list. | `'{line}. قد يكون هذا انقطاعا واحدا: تحقق من وجود تذكرة أصلية قبل أن تعالج هذه التذكرة وحدك.'` |
| `src/context/pack.js` lines 274 and 275 (J37, optional) | "free text and identities were not read" becomes "descriptions, notes and names were not read". Also change `/free text/i` in `src/insights/missing.js` line 113 to `/free text|descriptions, notes and names/i`, and the three tests that match the old words (`tests/context-pack.test.js` 437, `tests/fit-closecheck.test.js` 100, `tests/payload-size.test.js` 206). Skipped by this builder because the note is matched by code. | `لم تُقرأ الأوصاف ولا الملاحظات ولا الأسماء.` in place of `لم تُقرأ النصوص الحرة ولا الهويات.` |
| `docs/build-rules.md` rule 7 | Add: "A second named exception (2026-11-07): the setting `profilesFor` holds the same one-way hash of instance and user id, to tell who confirmed the work profiles; never the user id; empty when it is not known; cleared by Clear everything." | none |
| `docs/contracts.md` line 295 | Add `profilesFor` after `profilesConfirmed` in the list of settings. | none |

# The side rail layout (2026-11-05)

The spec for the "screens at the bottom, everything a screen offers in the right rail" layout. Read `docs/build-rules.md` first: its
rules (own your files only, no commit, no `node build.js` or e2e, tests required, `--ab-*` tokens only, Arabic for every text) hold here.

## What the user decided

On a 400 px side panel the Ticket screen spent its first screen on the ticket's facts, "Needs you now", one "Summarise" step and a big
quick-actions block; Insights and AI Assist started near the bottom, under a floating dock. The user approved a mockup
(https://claude.ai/artifact/WMmZMaVbxigc1WP3UrUgj3) and said, in their words: the screens (My work, Team, Ticket, Write, Knowledge) stay
at the bottom; "in the right side we will have all the options": with Insights on, the rail lists every Insights option; with AI Assist on,
every AI action; and every other screen also lists its own options in the rail. Only four picked quick actions in a rail confused them
("where to check all those things"). Right-side panel only: no bottom docking, no own window.

## The layout

```
┌───────────────────────────────────────┬────┐
│ header (unchanged)                                 │
├───────────────────────────────────────┬────┤
│ INC0010023  Priority 2            [v] │ ≡  │  <- "All insights" / "Suggested"
│ Email not syncing on mobile after…    │ ── │
│ (In progress) (SLA 1h 20m) (Unassigned)│ ◷• │  <- one item per card / per AI action
│ ─ Insights 2 | AI Assist ──────────── │ ⇄  │     (a dot = needs a look)
│ ● The SLA is due in 1h 20m            │ …  │
│ ● The customer has waited 2 days      │    │
│ ○ Related tickets  3 similar…         │    │
│ ○ …                                   │ «  │  <- Show names (widens the rail over the screen)
├───────────────────────────────────────┴────┤
│ My work │ Team │ Ticket │ Write │ Knowledge  │  <- bar of screens, icon over name
└────────────────────────────────────────────┘
```

## The foundation (built by the lead; use it, do not change it; ask the lead for a change)

- `src/sidepanel/shell/SideRail.jsx`
  - `useRailPublish(screen, rail, active)`: a screen publishes `{ title, items }` on every render while it is on show. Items:
    `{ id, label, icon, attention: '' | 'warn' | 'danger', ai, current, disabled, separator, onSelect() }`. `separator`: a line above
    the item (use it on the item after the leading "All insights" / "Suggested"). Cheap: the shell redraws only when the picture changed.
  - `RailSectionsContext`, `useSectionRegistry()`, `useRailSection({ id, label, icon, attention, open })` returns a ref for the
    section's element; `goToSection(entry)`. ScreenView (lead) already gives each half of My work, Team, Write and Knowledge a
    registry and publishes the registered sections of the half on show; a section only has to call `useRailSection` and put the ref
    on its element. `open`: a function that opens a folded section (called before it is scrolled into view).
  - `railItemName(item)`: the screen-reader name ("Draft a reply (AI)", "SLA: needs a look").
- `src/sidepanel/shell/railStore.js`: the store (App.jsx makes one and draws the rail of the screen on show).
- `src/features/railLayout.js` (pure): `railPrefsFor(layout, kind, half)`, `arrangeRail(ids, prefs)` (person's order first, then the
  default order; hidden left out of `shown`; `all` for Settings), `assistDefaultOrder(ids, { kind, stage, byState })` (what fits the
  ticket's state first: quick.js quickDefaults), `setRailPrefs(layout, kind, half, prefs)`, `cleanRailLayout(layout)`, `RAIL_HALVES`.
- Settings (src/policy/policy.js DEFAULT_SETTINGS): `railNames` (bool, the wide rail; App.jsx saves it), `railLayout` ({} = defaults),
  `railByState` (true). `quickPins` and `pageBar` stay: they are the small tab on the ServiceNow page (src/content/bar.js,
  src/background/bar.js). `quickBarOpen` goes when the panel's quick bar goes (the lead removes the default at integration).
- Icons: `src/sidepanel/ui/featureIcons.js` `featureIcon(featureId)`, `cardIcon(cardId)` (every Insights card), `screenIcon(id)`;
  `src/sidepanel/ui/iconPaths.js` has `list`, `chevronLeft`, `chevronUp` now. Need another icon? Ask the lead (shared file).
- The bar of screens (App.jsx ScreenTabs) and the rail's CSS (`src/ui/areas/shell.css`) are the lead's.
- Labels of AI actions in the rail and in Settings: the short label `QUICK_LABELS[id]` (src/features/quick.js) when there is one, else
  the feature's own title.

## A. The Ticket screen (agent "ticket")

Own: `src/sidepanel/ticket/**`, `src/sidepanel/QuickBar.jsx` (delete it), `src/sidepanel/ui/primitives.jsx` (only to add an optional
count to HalfSwitch's Insights tab), `src/ui/areas/insights.css`, `quick.css`, `assist-actions.css`, `assist-answers.css`,
`src/i18n/ar/ticket.js`, `src/i18n/ar/ticketLogic.js`, the tests of these (`tests/quick-bar-view.test.js`, `ticket-needs-now`,
`assist-actions-view`, `insights-cards`, `panel-live-quick`, and new `tests/ticket-rail*.test.js`). Keep `src/features/quick.js` (the
page tab uses it; its tests stay green).

1. The top is always the compact header: number (and priority), the short description on one line (full text on hover), chips for the
   state, the SLA and "Unassigned" (when nobody is assigned). The other facts (assigned to, updated, opened, caller, service ... what
   the Glance shows today) are behind a chevron "Ticket details" (aria-expanded), remembered per session is enough.
2. "Needs you now" no longer sits at the top. Its Glance facts (the SLA, a customer waiting, a possible outage: `needsNow.js`) become
   the first rows of the Insights half, above the cards, as plain rows (dot, sentence, sub line), not as cards. The cards that need a
   look already come first among the cards (arrangeRows); do not repeat them.
3. The one next step (`NextStep.jsx`) and the quick-actions bar (`TicketQuickBar`, `src/sidepanel/QuickBar.jsx`) go from the panel.
   AI Assist keeps its suggested actions (SuggestedActions) and "More actions" as today, and its answers.
4. The rail, Insights on: "All insights" (icon `list`, id `all`), then one item per card this record shows (`cardsFor` order, then the
   person's arrangement: `arrangeRail(ids, railPrefsFor(eff.values.railLayout, kind, 'insights'))`, hidden ones not in the rail), icon
   `cardIcon(id)`, `attention` from the card's report (`warn`/`danger` only), separator on the first card. A click on a card: the half
   shows that card alone, open, with an "All insights" back button above it; every other card stays mounted (hidden) so it keeps
   reporting. "All insights" (or the back button) returns to the list. `current` = the card in focus, or `all`. A launch for a card
   from the page bar ('card:ready' / 'card:related': `showCard`) does the same.
5. The rail, AI Assist on: "Suggested" (icon `sparkle`, id `suggested`; returns to the top of AI Assist), then every AI action this
   record offers (the same list AI Assist offers: `offeredFeatures`, the checklist gate as in useActionPlan), ordered by
   `assistDefaultOrder(ids, { kind, stage, byState: eff.values.railByState !== false })` then the person's arrangement (`'assist'`),
   `ai: true`, icon `featureIcon(id)`. A click starts the action exactly like a click in AI Assist (`runAi`: preview first, same policy
   and masking). While an answer is on its way, or when AI cannot be used now (no key, skipped, a record or feature block), the AI items
   are `disabled` (AI Assist says why, as today). `current` = the action whose answer is on show.
6. AI switched off by the organisation: no AI Assist half, the rail is the Insights rail only.
7. Publish with `useRailPublish('ticket', rail, active)` where `active` is TicketView's `active` (the Ticket screen on show).
8. Optional, small: the Insights tab shows the number of rows that need a look (HalfSwitch, a count after the name, with a
   screen-reader text).
9. Report every selector or class you removed or renamed (the lead updates the e2e scenarios: x-quickbar, y-pagebar, z-pagelaunch,
   zw-screendock, and any scenario that clicks the quick bar, "Needs you now" or the next step).

## B. My work, Team, Write, Knowledge (agent "screens")

Own: `src/sidepanel/mywork/**`, `team/**`, `write/**`, `knowledgeScreen/**`, `knowledge/**`, `reports/**`, `compose/**`, `checks/**`,
`snippets` views if any, their CSS areas (`mywork.css`, `reports.css`, `knowledge.css`, `compose.css`, `checks.css`, `formats.css` only if
needed), `src/i18n/ar/write.js`, `src/i18n/ar/reports.js`, and new `tests/screens-rail*.test.js` plus the existing tests of these files.

1. Every section a person sees on these screens (each half) is listed in the rail: call `useRailSection({ id, label, icon })` in the
   section's component and put the ref on its outer element. Use the section's own visible heading as the label (no new wording where
   a heading exists). Pick a fitting icon from `iconPaths.js` per section, different icons within one rail where you can.
2. A section that folds gives `open` so the rail opens it before bringing it into view. A section with something that needs a look
   (an overdue count, a breach) may set `attention: 'warn'` (only where the screen already shows that as a warning).
3. Keep each screen's sections in one small table (id, label getter, icon) the components use, so a test can check ids are unique,
   icons can be drawn and labels are translated. Registration itself is checked by the lead in a real browser (effects do not run in a
   static render).
4. Do not change how the screens look or behave otherwise.

## C. Settings > Side rail (agent "settings")

Own: `src/options/**`, `src/ui/areas/options.css`, the Settings texts in `src/i18n/ar/shell.js` (add after the lead's lines; remove the
ones that become unused), `tests/options-*.test.js`, and a new pure `src/features/railCatalog.js` + its test.

1. `src/options/basics/QuickBarSection.jsx` becomes "Side rail" (menu label, heading, icon `command`): "The rail on the right of the
   Ticket screen lists everything Insights or AI Assist offers for the ticket that is open. Hide what you never use and put what you use
   most at the top, per kind of record."
2. A switch of record kinds (Incident, Request item, Change, Problem, Case; add Catalog task / HR case only if cheap) and a switch
   Insights | AI Assist. The list for that kind and half: one row per item (icon, name), a show/hide switch (role="switch",
   aria-checked, named after the item), Move up / Move down buttons (named after the item; the first cannot go up, the last cannot go
   down). "{n} of {m} shown". "Reset to the suggested order" for that kind and half. Saved as `railLayout` with `setRailPrefs`.
3. What a kind offers, without a record: Insights cards by kind and the person's profiles (a light catalog in
   `src/features/railCatalog.js`, ids/titles/kinds/profiles, with a test that it matches `INSIGHT_CARDS` exactly so it cannot drift;
   do not import the card components into the Settings bundle), AI actions by `featuresFor(kind, policy)` (src/features/registry.js)
   in `assistDefaultOrder` order.
4. The switch `railByState` (on): "When I have not arranged a kind, put what fits the ticket's state first."
5. "On the ServiceNow page": the existing `pageBar` switch (and its lock), and "Its actions for {kind} (up to 4)": pill toggles
   (aria-pressed) over the AI actions with a short label (`QUICK_LABELS`), saved as `quickPins` (`cleanPins`, `MAX_QUICK`); the rest
   disabled once 4 are on. This replaces the panel's old "Choose" (the panel's quick bar is gone).
6. Remove the "Keep the bar open at the top of the side panel" switch (`quickBarOpen`). Update `src/options/diagnostics.js` to say
   how many kinds have an arranged rail.

## For everyone

- Plain, short, kind text; no jargon; no emoji. Every new text in Arabic (`docs/i18n-arabic.md`); `node scripts/i18n-check.js` must say
  0 missing, 0 unused when you finish (remove the Arabic entries your change left unused).
- `node tests/run.js` green (whole suite), `node scripts/check-compile.js` green, `npx eslint <your files>` clean.
- The panel can be 320 px wide; the rail takes 48 px of it.
- Report: what you built, how it is tested, what is not verified, selectors you removed or renamed, any change you need in a file that
  is not yours (exact change).

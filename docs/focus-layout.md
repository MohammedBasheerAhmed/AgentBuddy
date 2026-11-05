# Focus layout: five pain points first, everything else in All tools (2026-11-05)

**Why.** The user showed Agent Buddy to their leaders: "looks promising but has too many features and looks cluttered"; solve the main
pain points, three to five at most, and keep the rest separate. The user chose the five (understand the ticket, find the fix, the same
caller, reply, close well) and said: "We will have all functionalities but through some other way so that it doesn't look cluttered
on the screen", then "the bottom bar should be there in each tab we need to have 5". Approved mockup: boards "Focused" and "All tools"
on https://claude.ai/artifact/WMmZMaVbxigc1WP3UrUgj3.

**What stays:** the bottom bar with the five screens (My work, Team, Ticket, Write, Knowledge) on every screen; the compact ticket
header; Insights | AI Assist; every function (nothing is deleted except the side rail's per-kind hide/order settings, which have nothing
left to arrange). The other screens already show five or fewer per half (Team's "Team overview" dashboard has exactly five sections).

## Shared pieces (written by the lead; ask before changing them)

- `src/features/focus.js`: `PAIN_POINTS` (the five: id, title, the card ids that answer it, the AI action ids that may fill its slot,
  first offered wins), `painOfCard`, `focusCards(cards) -> { groups, rest }`, `focusActions(planItems) -> { five, rest }`.
- `src/sidepanel/palette/allToolsContext.js`: `AllToolsContext` and `useAllTools()`; calling it opens All tools, optionally at a group
  (`'ticket-insights'`, `'ticket-assist'`).
- Icons: `grid` (All tools), `user` (same caller), `eye` and `tool` (pain points); `painIcon(id)`, `cardIcon('caller')`,
  `featureIcon('caller-briefing')` in `src/sidepanel/ui/featureIcons.js`.
- Arabic: `src/i18n/ar/focus.js` (`AR_FOCUS`: the Ticket screen's and All tools' new texts) and `src/i18n/ar/caller.js` (`AR_CALLER`:
  the new card and the caller briefing). Both are wired in `src/i18n/ar/index.js`. Remove the Arabic of any English text you delete
  (`node scripts/i18n-check.js` must say 0 missing and 0 unused).
- **Launch ids** (what All tools, the keyboard shortcuts and the bar on the ServiceNow page send to the Ticket screen; they arrive as
  `launch.featureId` exactly like today's ids):
  - a feature id (`'reply-draft'`): start that AI action as today, whether or not it is one of the five;
  - a `QUICK_CARDS` id (`'card:ready'`): as today, that card alone in Insights;
  - `'show:<cardId>'` (new): that Insights card alone in Insights, with "Back" to the five; ignored when the record has no such card;
  - `'ask:ticket'` (new): AI Assist with "Ask about this ticket" open at the top and the focus in its box.
- **Settings:** `railShow` (new, default `false`): the side rail is drawn only when it is `true`. `railNames` stays. `railLayout` and
  `railByState` are removed. `quickPins` (the AI actions on the bar on the ServiceNow page) stays as it is.

## A. The Ticket screen

**Insights: five rows.** `focusCards(cardsFor(...))`. One row per group that has cards (in `PAIN_POINTS` order):

- The row: the pain point's icon (`painIcon`) in a small tile with a dot when the group needs a look, the pain point as its title, one
  line under it, a chevron. A click opens the group in place (`aria-expanded`), as card rows open today.
- The line: for "Understand the ticket", the first fact that needs the agent now (needsNow: SLA, a customer waiting, a possible outage)
  when there is one, else the first member card's line; for the others, the member cards' lines (the first non-empty one, or two
  joined by " · ").
- Inside: "Understand the ticket" starts with the needs facts (today's plain rows). A group with ONE card shows that card's content
  directly (no row inside a row), in an element with `data-card="<id>"`; a group with several shows them as today's card rows
  (`li[data-card] > button.ab-ins-card-toggle`, title, one line, content in place).
- The group's dot: the worst of its cards and (for Understand) its facts. The number on the Insights tab counts the groups that need
  a look. There is no "All clear in ..." row any more: five rows always show.
- At the end: a quiet button "More for this ticket: {n} Insights" (n = the rest), which opens All tools at `'ticket-insights'`. Hidden
  when n is 0.
- The rest of the cards are not drawn in the list. A rest card is mounted the first time it is asked for (`show:<id>`, a card's link,
  the page dock) and then stays mounted while the record is on screen. Shown alone it looks as today's focus mode, with "Back".

**AI Assist: five rows.** `focusActions(plan.items)`. One per pain point the record has an action for:

- Each list item: the pain point's name as a small label above the row, then today's action row button (`ActionRow`: the action's
  title FIRST in its text, its one line or the reason it cannot run, "Change format" under it when it has one). The button's text must
  still start with the action's title (scenarios find actions by it).
- One filled mark ("Start") at most: the first action of `SUGGEST[stage]` that is among the five and can run, unless an answer with its
  own main button is on screen (today's `quiet`).
- Then the answers (`AnswerArea`), then a quiet button "More for this ticket: {n} AI actions" that opens All tools at
  `'ticket-assist'`.
- "Ask about this ticket" is no longer drawn by default: `'ask:ticket'` opens it at the top of AI Assist (and it stays for that record).
  "More actions" (the grouped list) is no longer drawn: those actions are in All tools.

**The side rail** (drawn only when Settings has `railShow`): with Insights on, the five groups (a click opens that group and brings it
into view); with AI Assist on, the five actions (a click starts it, as today); both end with "All tools" (icon `grid`), which opens All
tools. No "All insights" or "Suggested" item. `ticketRail.js` no longer uses `src/features/railLayout.js` (it is deleted, part C).

**The new card "Caller's other tickets"** (id `caller`, `src/sidepanel/ticket/cards/CallerCard.jsx`, kinds: every ticket kind,
profiles: all): the caller's earlier tickets (`useHistory`), the repeat flag and the last fix that worked: the group that "Related
tickets" shows today. "Related tickets" keeps the solved look-alikes and what is open on the same item (no caller group), so nothing
shows twice.

## B. The caller briefing (AI, new)

`caller-briefing`: "Brief me on this caller" (actions start with a verb; its short label on the bar is "Caller briefing"), "What this caller raised before, and what fixed it." Like `account-briefing`: an `enrich` that
reads the caller's other tickets with the existing `history` read (the caller from `pack.people`, the same roles in the same order as
`CALLER_ROLES` in `src/sidepanel/ticket/cards/data.js`), at most 10, merged onto the pack as a related list; parts from this ticket's
short fields and that list; a fixed prompt with headings (who the caller is by role, what they raised before, whether this looks like
the same issue, what fixed it last time, what to watch out for); facts only, "Not stated" when missing, no names, short; the same
rules as every feature (`rulesFor('agent')`). A history that could not be read is said to be not available, never presented as empty.
Copy as the main button; insert into work notes like the account briefing. Every kind that has a caller (not change, not knowledge).
Masking, preview and policy apply as for every feature (it goes through the pipeline). Arabic for its title and description.

## C. All tools, the header, Settings

**All tools** is the command palette grown up: the same dialog (combobox over a listbox, the rest of the panel inert, Esc closes),
named "All tools", as a sheet over the panel under the header (not a small box), with its search box ("Find a tool...") at the top and
group headings that stay while searching (empty groups hidden). Opened by the header button (icon `grid`, "All tools", `Ctrl+K` /
`⌘K` as today) and by `useAllTools()`. Groups, on the Ticket screen with a record:

1. "More for this ticket: Insights": the record's rest cards (`focusCards` over `cardIdsFor(record, null, eff)`), each with its title,
   a short fixed line saying what it shows, its card icon; choosing one sends `show:<cardId>`.
2. "More for this ticket: AI Assist": first "Ask about this ticket" (`ask:ticket`), then the offered actions that are not among the
   five (`focusActions`), with their titles and descriptions and the AI mark; choosing one sends the feature id (preview first, as
   always).
3. "Go to": the screens (as today).
4. "Panel": Insights / AI Assist, Settings, colours, language (as today).

On other screens only 3 and 4. The `QUICK_CARDS` entries leave All tools (their cards are in group 1). Opened at a group: that group's
first item is the highlighted one and in view.

**The header:** the mark, the name, the instance, then two buttons: All tools (`grid`) and Settings. The colours button leaves the
header (Settings > Appearance and All tools keep it).

**Settings > Side rail:** one switch "Show the side rail" (`railShow`) with one line ("The five of each screen on the right of the
panel, with All tools at its foot"), "Show names" (`railNames`) under it while the rail is on, and the page tab's actions (`quickPins`)
as today. The per-kind and per-half hide and order lists go, with `railLayout`, `railByState`, `src/features/railLayout.js`,
`src/features/railCatalog.js` and what of `src/options/railOptions.js` only they used.

**The shell** (part C too, `src/sidepanel/App.jsx`): provide `AllToolsContext` (open the palette, at a group), draw the side rail only
when `railShow` is `true`. `src/lib/launch.js` already accepts the new launch ids (the lead changed `FEATURE_ID_RE`).

## The lead

The shared pieces above, the e2e helpers and scenarios, `npm run verify` and `npm run e2e`, the docs
(TRACKER.md, CHANGELOG.md, `docs/rail-layout.md` marked as superseded where it differs).

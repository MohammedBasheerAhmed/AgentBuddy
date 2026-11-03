# Live questions: the look of the panel, the colours and the command palette

Built in R9 (the new header, icon tiles, state chips, light / dark / computer colours, the command palette). Everything was checked in
a real Chrome against a fake ServiceNow (scenario `zx`, plus the accessibility audit `zz` and the Arabic scenario `zy`), never in the
browser's own side panel and never on a real instance. These are the things only a person at the real Chrome and Edge can answer.

1. **Does Ctrl+K reach the panel?** Click inside the side panel, press `Ctrl+K` (Mac: `Cmd+K`). Expected: the palette opens over the
   panel. Chrome and Edge keep some keys for themselves (Ctrl+K puts a search into the address bar on some builds). If the browser
   takes it, tell us which browser and version: the header button (the command-key icon) always works, and the key can change.
2. **Does "Same as the computer" follow the right setting?** In Chrome the side panel should follow the browser's own colour setting
   (Settings > Appearance > Mode: Device, Light, Dark), which by default follows Windows or macOS. Check that Device with Windows dark
   gives a dark panel, and that Light in Agent Buddy's Settings beats it.
3. **The look at the real width.** Open a ticket in the panel (about 400 px wide) in light and in dark and look at: the header (mark,
   name, instance, four buttons), the ticket card (title on two lines, state chips), the quick-action tiles (icon, name, AI mark),
   and the palette. Anything cut off, too small or unclear? A screenshot is enough.
4. **Do the icons read?** Is each tile's icon understood without the word (reply arrow, document, arrow, link)? Is the command-key icon
   in the header understood as "search commands" (it has a tooltip with the shortcut)?
5. **The bar on the ServiceNow page in dark.** Set Settings > Appearance > Colours to Dark: the small bar on the ServiceNow page
   should turn dark within a few seconds, whatever the page's own colours are. Does it stay readable on your instance's page colours?
6. **Arabic.** In Arabic the header reads right to left (mark and name on the right, buttons on the left), the palette is right to left,
   and the AI actions in it are named in Arabic. Typing English words ("settings", "dark") still finds the commands. Does it feel right?
7. **Which commands are missing?** The palette lists the screens, every AI action this ticket offers, the Insights cards the quick
   bar can open, the two halves, Settings, the colours and the languages. What would you type that finds nothing?
8. **The icon dock at the bottom of the panel (R10).** The screens are five round icons in a pill at the bottom centre. Do the icons read
   without the words (ticket, inbox, two people, pen, book) and does the name on hover or on the keyboard help? Does the dock cover
   something you need while a screen scrolls behind it (a button at the bottom of a card, the Ask box)? A screenshot of the spot is enough.
9. **Is the screen on show clear enough?** It is the green filled icon; the others are plain. Without a visible name, would you want the
   name of the screen on show written next to its icon (it would make the dock a little wider and move when you change screen)?
10. **The dock at the real width and in Arabic.** At about 400 px the dock is about 230 px wide. In Arabic it is mirrored (Ticket at the
   right end). Anything cut off, too small, or in the wrong order?

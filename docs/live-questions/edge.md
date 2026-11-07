# Live questions: Edge on a real instance

Edge runs the same package as Chrome (`dist/`; one build, `scripts/lib/browsers.js`) and the same code paths: the side panel, the
service worker, the sender check (`chrome-extension://<id>`). An automated run in Edge covers everything but the real side panel, the toolbar button and the keyboard shortcuts (`npm run e2e:edge`; the first full run, Edge 156, 2026-11-07, passed 1,244 checks). The questions below were written in
other files, wherever a feature met Edge; they are gathered here so one walk-through in Edge answers them all. Each links back to the
question with the full detail (what was assumed, how to check, what to change). Answer them in the other file, or here with the
number.

Run them as a person with only fulfiller roles, on dev364920, in Edge on Windows (and on a Mac where the question says so). Note the
Edge version (`edge://version`).

## A. Set up

1. **Load the build.** `edge://extensions`, turn on Developer mode, Load unpacked, choose `D:\AgentBuddy\dist`. Click the Agent Buddy
   toolbar button: the side panel opens. Then "Turn on for this site" on a ServiceNow tab, and enter the AI key in Settings yourself.
   Assumed: the same as in Chrome. If Edge shows a warning or an error on `edge://extensions`, copy its text.
2. **"Copy diagnostics" says Edge.** Settings > Copy diagnostics: a line "Browser: Edge <version>" (`browserName`,
   `src/options/diagnostics.js`).

## B. The panel and the page

3. **A click on the dock opens the side panel.** On a ticket, with the panel closed, press "Summarise" on the dock.
   `quickbar.md` 1 (headed Chrome opened it; Edge and a person clicking by hand are still to check), and 2 (the panel opened late
   still starts the action within 30 seconds).
4. **Two windows.** The panel opens in the window of the tab you clicked. `quickbar.md` 3.
5. **Right to left in the real side panel.** With Arabic on: the order of the screens, the switch, the arrows, the tables, the
   preview. `i18n.md` 2.
6. **Ctrl+K reaches the panel**, and "Same as the computer" follows Edge's own appearance setting; the look at the real width.
   `look.md` 1 to 3 (written for Chrome; Edge has its own appearance setting).
7. **Right-click on a ticket link in the side panel** shows "Open link in new tab". `ai-provider.md` 21.
8. **A record opens in a new tab next to the ticket** (also with tab groups). `insights.md` 14.
9. **Printing from the side panel.** `reports-ai.md` 18.
10. **The file chooser from the side panel** ("Load a layout file"). `reports.md` 39.
11. **A snippet file is saved** from the side panel into the downloads folder. `compose.md` 31.
12. **Checklist ticks in session storage** in the side panel. `compose.md` 24.
13. **The panel only on the sites you added.** `sidePanel.setOptions` with a `tabId`, `getOptions` and `open` behave as in Chrome; the
    seven hand steps of `docs/panel-scope.md`, with ifBash.com as the page that must not show the panel. `audit-1107-panel.md` 12.

## C. Keyboard shortcuts

13. **`Alt+Shift+1/2/3`** (Mac `Control+Shift+1/2/3`) with the English and the Arabic keyboard layout, on Windows and on a Mac;
    `edge://extensions/shortcuts` lists the three and lets you change them. `i18n.md` 6.
14. **Settings > Keyboard shortcuts > "Change the shortcuts in the browser"** opens `edge://extensions/shortcuts` in a tab, not
    Chrome's page. (Edge is told apart from Chrome there by its user agent string, `src/options/basics/ShortcutsSection.jsx`.)

## D. Security checks

15. **Storage closed to content scripts.** Does Edge accept `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`?
    `quickbar.md` 11, `docs/security.md` limit 17.
16. **Session storage pinned to extension pages.** Edge accepts `chrome.storage.session.setAccessLevel` from an extension page.
    `ai-provider.md` 23.

## E. Managed Edge (a managed computer)

17. **The policy samples.** Deploy `docs/review-pack/policies/edge-windows.reg` (or `edge-macos.mobileconfig`, `edge-linux.json`) as
    `docs/deployment.md` says; `edge://policy` shows every Agent Buddy key with status OK.
18. **`defaultDashboard` as one object** (a `REG_SZ` holding JSON on Windows). `policy.md` 15.
19. **Organisation snippets** from `orgSnippets` show as "From your organisation" and cannot be edited. `compose.md` 30.
20. **The self-hosted install** on a pilot computer, then an update arriving. `i18n.md` 7, `docs/deployment.md` "Self-hosted install".

## Answers so far

**2026-11-06, Edge 156 on Windows, dev364920 (signed in as System Administrator), checked through Claude in Edge:**

- 1 (partly): Agent Buddy runs in Edge on the instance: the site is turned on and the dock shows on INC0000055 (classic form) with
  Summarise, Reply and "Ready to resolve?". No console error on the ticket page after a fresh load. Not seen yet: `edge://extensions`
  (warnings, the build that is loaded) and the toolbar button; automation cannot open `edge://` or extension pages.
- 3 (not answerable by automation): the dock refused the automated click and the automated Enter key with "Nothing was started:
  something on the page was covering the bar". The automation draws on the page and holds it, and the bar's visibility check
  (IntersectionObserver v2, `clickVerdict` in `src/content/barLogic.js`) counts that as covering. So the protection works in Edge; whether
  a click opens the side panel must be checked by a person.
- Everything else is still open and needs a person (the side panel, shortcuts, extension pages) or a managed computer (17 to 20).

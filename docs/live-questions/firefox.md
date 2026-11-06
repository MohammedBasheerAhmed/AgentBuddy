# Live questions: Firefox on a real instance

Area: the Firefox build (`dist-firefox/`, made by `node build.js --browser firefox`), the browser layer (`src/lib/platform.js`), the
sender check (`src/lib/senderCheck.js`) and the Firefox manifest (`scripts/lib/browsers.js`). Built on 2026-11-06 and tested with unit
tests (`tests/platform.test.js`, `tests/manifest-firefox.test.js`, `tests/senderCheck-content.test.js`) and an automated run in real
Firefox (`npm run e2e:firefox`, `e2e/firefox/`). None of it has met a real ServiceNow instance or a person.

Run the steps in order, as a person with only fulfiller roles, on dev364920. Each step says what to do, what was assumed (what you
should see), and what to change if it is different. Note the Firefox version (`about:support`, "Version") next to your answers.

## A. Set up

1. **Install Firefox.** Any current release (128 or later; an older one refuses the add-on). It is not on your computer yet.
   Check: `about:support` shows the version. If you use ESR: ESR 153 (ESR 128 and 140 get no more updates; `docs/deployment.md`,
   "Which Firefox").
2. **Build.** `npm run build:firefox` writes `dist-firefox/` (the lead does this; not while another build runs).
3. **Load the temporary add-on.** Open `about:debugging`, then This Firefox, Load Temporary Add-on..., and choose
   `D:\AgentBuddy\dist-firefox\manifest.json`.
   Assumed: Agent Buddy is listed with no error. A warning that Firefox does not know `storage.managed_schema` is expected (Firefox reads
   the policy without a schema), and an enterprise build also warns about `version_name`.
   Check: any other warning or an error: copy its text. A temporary add-on goes when Firefox closes: load it again after a restart.
   If the Agent Buddy button is not on the toolbar, open the Extensions button (the puzzle piece) and pin it.
4. **Sign in.** Open dev364920 in that Firefox and sign in yourself.

## B. Turn on and open

5. **Turn the site on.** Open an incident, click the Agent Buddy toolbar button, then "Turn on for this site".
   Assumed: the sidebar opens; the click on the toolbar button lets Agent Buddy see the tab's address and the page's ServiceNow marks
   (`activeTab`), so "Turn on" is offered; Firefox asks for access to that one site; after you allow it the panel shows the ticket and
   the dock appears at the bottom centre of the page.
   Check: also `about:addons`, Agent Buddy, Permissions: the site is listed.
   If wrong: note what the panel says. If "Turn on" is not offered, "Turn on anyway" should be. If Firefox does not ask at all, look at
   the Browser Console: Firefox asks for a permission only while the click is being handled, before the code waits for anything.
6. **The sidebar loads.** The extension's CSP has `frame-ancestors 'none'`.
   Assumed: Firefox shows the sidebar page as its own document, so `frame-ancestors 'none'` does not block it.
   Check: the sidebar shows the panel, not a blank or grey page. Open the Browser Console (Ctrl+Shift+J) and look for a CSP message
   that names `frame-ancestors`. Also: no screen says "This request is only allowed from Agent Buddy's own pages." (that would mean the
   sender check refused the sidebar's own origin, `moz-extension://...`).
   If wrong: the CSP comes from `manifest.json`. A Firefox-only CSP would go in `firefoxManifest()` (`scripts/lib/browsers.js`), never in
   the Chrome manifest, and is a manifest change for the security team (build rule 6). For the sender check: copy diagnostics and
   note the Firefox version.
7. **The toolbar button toggles the sidebar.** Click it: the sidebar opens; click again: it closes.
   Assumed: `wireToolbarButton` toggles the sidebar inside the click (`src/lib/platform.js`).
   Check: also after Firefox has been left alone for 5 minutes (the background is an event page and may have stopped; the click must
   still wake it), and in a second window.
   If wrong: the listener must be added at the top level of the background script on every start (`tests/platform.test.js` checks it).
8. **The keyboard shortcuts.** On a ticket: `Alt+Shift+1` opens the panel, `Alt+Shift+2` opens it and starts "Summarise this ticket",
   `Alt+Shift+3` "Draft a reply" (Mac: `Control+Shift+1/2/3`). Try each with the sidebar closed and with it open.
   Assumed: a shortcut counts as your action, so the sidebar may open; Summarise and Draft a reply stop at the check before sending.
   If a key does nothing: `about:addons`, the gear, Manage Extension Shortcuts shows which keys Firefox gave to Agent Buddy (a clash
   with another add-on or with Firefox shows there).

## C. The dock on the page

9. **The sidebar is closed and you click the dock.** Close the sidebar, hover the dock and press "Summarise".
   Assumed: Firefox does not let a click on a page open the sidebar, so the dock says "Click the Agent Buddy button in your browser
   toolbar. The action starts in the panel." The request waits 30 seconds (`LAUNCH_TTL_MS`, `src/lib/launch.js`).
   Check: (a) the note shows; (b) click the toolbar button within 30 seconds: the sidebar opens and Summarise starts with the check
   before sending; (c) press the dock again, wait more than 30 seconds, then open the sidebar: nothing starts.
   If wrong: if nothing shows, look at the Browser Console; if the action does not start in time, raise the time or read the request
   again when the panel's page becomes visible (`docs/live-questions/quickbar.md` 2).
10. **The sidebar is open and you click the dock.** Assumed: the action starts in the sidebar at once.
11. **Two windows.** Open a ticket in each of two Firefox windows. Open the sidebar in window 1 only, then press a dock action in
    window 2.
    Assumed: window 1's sidebar ignores it (the request names window 2's tab); window 2's dock shows the note; opening window 2's
    sidebar with its toolbar button within 30 seconds starts the action there, on window 2's ticket. With both sidebars open, a dock
    click in window 2 starts only in window 2's sidebar.
    If wrong: note which window did what. Whether the sidebar is open is asked for the window you are in
    (`sidebarAction.isOpen({})`, `src/lib/platform.js`); a request for the wrong tab starts nothing (`src/lib/launch.js`).

## D. An action from start to end

12. **A summary with the masking preview.** Enter your AI key in Settings yourself, then on a ticket with a caller and an email in the
    text, run "Summarise this ticket".
    Assumed: the check before sending shows the exact text, names and the email hidden as chips; Send gives a plain-text answer with the
    real names put back.
13. **Insert fills a field and nothing is saved.** Draft a reply, then Insert it as a customer comment.
    Assumed: the text appears in Additional comments and the panel says where it went; the form is not saved (no new entry in the
    activity stream until you press Save or Post). Try a Workspace record too if you have one.
14. **Arabic.** Settings > Language > العربية.
    Assumed: the sidebar reads right to left (Ticket first, on the right), the dock is in Arabic and mirrored, and an Arabic ticket's
    summary comes back in Arabic (`docs/live-questions/i18n.md` 2, 3 and 5).
15. **Dark mode.** Settings > Appearance: Dark, Light, then Same as the computer.
    Assumed: the sidebar and Settings change at once; the dock on the page turns dark within a few seconds; "Same as the computer"
    follows Firefox's own theme setting (Settings, General, Website appearance), which by default follows Windows or macOS.
16. **The Settings page.** Open it from the panel and from Agent Buddy's entry in `about:addons`.
    Assumed: it opens in a tab; every section loads; a change is saved and the panel follows it; "Test connection" works.
17. **The shortcuts in Settings.** Settings > Keyboard shortcuts lists the three with their keys.
    Assumed: in Firefox 137 or later, "Change the shortcuts in the browser" opens Firefox's Manage Extension Shortcuts. In Firefox 128 to
    136 that button is not shown (Firefox cannot be taken there); the shortcuts are in `about:addons`, the gear, Manage Extension
    Shortcuts.
    If wrong: `canOpenShortcutSettings` / `openShortcutSettings` in `src/lib/platform.js`.
18. **"Copy diagnostics" says Firefox.** Settings > Copy diagnostics, paste it into a text editor.
    Assumed: a line "Browser: Firefox <version>", and no AI key anywhere in it.
    If wrong: `browserName` in `src/options/diagnostics.js`.

## E. For the security review

19. **Storage closed to content scripts.** The background asks Firefox to close `storage.local`, `storage.session` and `storage.sync`
    to content scripts (`restrictStorageAccess`, `src/background/bar.js`), where the browser supports it. The result is recorded in
    `docs/security.md` limit 17. To see it by hand: `about:debugging`, This Firefox, Agent Buddy, Inspect; in that console run
    `await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`. It returns nothing when Firefox supports it and
    fails ("is not a function", or an error) when it does not.
20. **The managed policy** (only with a managed Firefox). Deploy one file from `docs/review-pack/policies-firefox/` as
    `docs/deployment.md`, section "Firefox", says, restart Firefox, open `about:policies`: `ExtensionSettings` and `3rdparty` are under
    Active Policies. Then Agent Buddy's Settings shows "Set by your organisation" for each key the policy fixes, and a table in
    `blockedTables` is refused when read (`docs/live-questions/policy.md` 1).

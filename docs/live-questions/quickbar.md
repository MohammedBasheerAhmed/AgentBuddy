# The quick-actions bar: what was assumed and how to check it

Area: the bar at the top of a record in the side panel (`src/sidepanel/QuickBar.jsx`) and the dock on the ServiceNow page
(`src/content/bar.js`, `src/background/bar.js`). Built and tested against the fake instance in `e2e/` (scenarios x, y and z) and against
plain unit tests. In that test Chrome, a real click on the bar opened Chrome's side panel and the panel started the action. None of it
has met a real ServiceNow instance or a headed browser that a person uses. Each question says what was assumed, how to check it as a
person with only fulfiller roles, and what to change if it is different.

## A. Opening the panel from the page

1. **Does a click on the bar open the side panel on a real, headed Chrome and Edge?**
   Assumed: yes. The click's permission to open a panel travels from the content script through the service worker, which asks for the
   panel before it waits for anything (`handleBarMessage`, `src/background/bar.js`). The test browser (Chrome, new headless mode) did open it, and so did installed desktop Chrome in a headed e2e run on 2026-10-30 (`E2E_HEADED=1 node e2e/run.js`, scenario z). Still to check: Edge, and a person clicking by hand.
   Check: on a ticket, open the bar and press "Summarise" with the side panel closed.
   If wrong: the bar already says "Click the Agent Buddy button in your browser toolbar. The action starts in the panel." and the request
   waits 30 seconds for the panel, so the person loses one click, not the action. If a browser never allows it, say so in the bar's tooltip
   and consider offering the bar only where the panel is already open.

2. **Does the panel start the action when it was closed and opens late?**
   Assumed: yes, within 30 seconds of the click (`LAUNCH_TTL_MS` in `src/lib/launch.js`). The panel reads the request when it opens.
   Check: press an action, close the panel at once, open it again from the toolbar button within 30 seconds.
   If wrong: raise the time, or read the request again when the panel's page becomes visible.

3. **Which window does the panel open in when two browser windows hold ServiceNow tabs?**
   Assumed: the window of the tab that was clicked (`chrome.sidePanel.open({ tabId })`), and the request is for that tab, so a panel in
   another window ignores it.
   Check: two windows, a ticket in each; press an action in the second.

## B. How it looks on the real pages

4. **Does the dock collide with something on the real page?** Assumed: a pill at the bottom centre, 16 px above the bottom edge of the
   window, does not hide anything a fulfiller needs. Possible collisions: the last fields of a long form and the paging row of a list
   (the dock floats over the page's own scroll area), a Workspace's own bar at the bottom, a portal footer or cookie banner, the
   Virtual Agent bubble (bottom right; the dock is centred, so it should clear it).
   Check: open a ticket on the classic UI, a Workspace and a portal; look at the bottom centre. Click the mark to fold the dock to a
   small pill, and drag the mark sideways to a free place (the place is kept).
   If wrong: change `DOCK_BOTTOM_PX` (how far above the bottom edge) or `X_DEFAULT` (where it starts) in `src/content/barLogic.js`.

5. **Is the bar above or below the page's own dialogs?** Assumed: above everything (`z-index` 2147483647, the maximum, since round 2), so
   a "session expired" or form dialog still has the bar over its backdrop. Something the page puts OVER the bar now makes a click on it
   say "something on the page was covering the bar" and start nothing (the anti-clickjacking rule, `src/content/barLogic.js`). Check:
   open a ServiceNow modal. If the bar looks wrong over a modal, lower the number.

6. **Does a real instance's Content-Security-Policy or Trusted Types setting block the bar's styles?** Assumed: no. The styles are a
   constructed stylesheet (`adoptedStyleSheets`), not an inline `<style>`, and the fake page's strict CSP did not block it.
   Check: the dock appears (a white pill, 48 px high, with the green Buddy mark) on a ticket of each kind of page. If it appears unstyled or not at all,
   open the browser console for a CSP message.

7. **Does a Workspace or portal that rebuilds its page remove the bar?** Assumed: the bar notices within 2 seconds and puts itself back
   (`refresh()` in `src/content/bar.js`). Check: move between tickets in a Workspace without a reload; the dock should stay.

## C. Detecting the record

8. **Does the bar find the record on every surface the panel does?** It uses the same detection as the panel (`resolveRecord` in
   `src/content/index.js`). Check: a classic form, a Workspace record, a portal ticket page, a request, a requested item, a catalog task.
   The bar should offer the actions of that kind (the defaults are in `QUICK_DEFAULTS`, `src/features/quick.js`).

9. **How many reads does the bar add on a Workspace or portal page that has only a record number in its address?** Assumed: one,
   cached (the number is looked up once; a number that found nothing is not asked again for 30 seconds). Check the Network tab filtered
   to `api/now/table` while a Workspace ticket is open and the panel is closed: expect one request per ticket, not one every 2 seconds.

## D. Policy

10. **Does `disablePageBar` remove the bar on a managed browser?** Assumed: yes, within 30 seconds (the bar asks the service worker
    again that often; while it is off it does not look at the page at all) and at once after a page reload. Check: set the key in the managed policy (`docs/deployment.md`), open a ticket.

## E. From the second security audit (`docs/review/security-audit-2.md`)

11. **Does Chrome 116+ / Edge accept `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`?** Check: in the
    service worker's console, `await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})`, then in the ServiceNow
    tab's console (context "Agent Buddy") `await chrome.storage.local.get(null)` must fail. If not: the AI key is still safe (vault or
    session storage); settings and the activity log stay readable by a compromised page process (security.md limit 17).
12. **Does anything on a real classic, Workspace or portal page cover the bar?** The bar would then say "something on the page was
    covering the bar". Check with the page's dialogs, toasts and the Virtual Agent bubble; if a legitimate element does, drag the dock
    sideways by its mark, or raise `DOCK_BOTTOM_PX`.
13. **Is half a second on screen before a click counts too long for anyone?** A click within 0.5 s of the actions appearing says "Nothing
    was started yet. Click the action again". Watch real people use it; lower `ARM_MS` in `src/content/barLogic.js` if it trips them.

## Round 3: the tab on the page (F6, Foundation); since R10 it is a dock at the bottom centre

14. **Is the dock below every ServiceNow dialog?** The bar's layer is now `z-index: 1000` (`BAR_Z` in `src/content/barLogic.js`), under the
    classic UI's dialog backdrop (1040) and dialog (1050), and the bar hides while the top document or the classic form's frame shows
    `body.modal-open`, `[aria-modal="true"]`, a shown `.modal`, a `<dialog open>` or a `.modal-backdrop`. A Next Experience dialog
    inside a shadow root is not visible to the content script, so there only the layer protects. Check on dev364920 (Next Experience,
    `itil`): open an incident, open a dialog (Resolve with a mandatory field, or "Add attachment"), and see that the dialog and its dim
    backdrop cover the dock. If the dock still shows on top, read the dialog's `z-index` in DevTools (it is in a shadow root: the
    `now-modal` element) and lower `BAR_Z` under it.
15. **Does the lower layer hide the dock under something ordinary?** With `z-index: 1000` a fixed header, a Workspace side panel or a
    floating chat bubble with a higher layer can now cover the dock; a click on a covered icon says "something on the page was covering the
    bar". Check classic, Next Experience and a Workspace record; if something covers the dock, drag it to a free place (the place is kept).
16. **Is the bottom centre of a Workspace clear?** Assumed: nothing of a Workspace record sits fixed at the bottom centre of the
    window. Check in Service Operations Workspace and in Customer Service Workspace; if something does, change `DOCK_BOTTOM_PX` or
    start the dock elsewhere (`X_DEFAULT`).
17. **Does dragging work with a pen and a touch screen?** The mark uses pointer events with `touch-action: none` and pointer capture; a
    press that moves less than 5 px is a click. Check on a touch laptop.
18. **Does the page bar's "no AI" offer make sense?** With AI off (switched off, "Skip AI for now", or no key saved) the worker offers
    `card:ready` ("Ready to resolve?") and `card:related` ("Related tickets") for ticket kinds, which open that Insights card in the
    panel. Whether the panel opens the card for such a launch is the Ticket screen's part (the lead's `TicketView.jsx`).

## R10: the dock at the bottom centre

19. **Do the tooltips read?** Hover each icon: the name, the AI mark (AI actions only) and one line saying where text goes appear above
    the dock at once. Tab to an icon with the keyboard: the same. Escape takes the name away first and folds the dock on the next press.
    Anything cut off, too small to read, or in the way of the page's own content?
20. **Do the icons read without the words?** Summarise is a document, Draft a reply an arrow turning back, Resolution notes a tick in a
    circle, Handoff brief a clipboard; an Insights item (no AI) has no spark. Is the small spark in the corner understood as "uses AI"?
21. **Does the dock fit a narrow window?** With four actions it is about 250 px wide and keeps 8 px from the window's edge on either side.
    Check at a window about 400 px wide and with the page zoomed to 150% or 200%.
22. **Is clicking the mark to fold and open it found by people?** The chevron at the right end folds it too; the mark both folds and
    opens, and drags. If people drag when they meant to fold (or the other way round), say which, and the 5 px threshold (`DRAG_PX`) or the
    chevron can change.23. **Does pressing an icon work after hovering it?** (Fixed 2026-11-03 after it failed on dev364920.) Hover an icon until its name shows,
    then press it: the panel opens and the action starts behind its preview. If the dock still says "something on the page was covering
    the bar", note the page type (classic form, Next Experience, Workspace, portal) and what is drawn near the bottom centre.

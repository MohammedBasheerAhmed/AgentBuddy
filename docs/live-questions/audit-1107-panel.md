# Panel scope: what was assumed (owner's request of 2026-11-07, "Agent Buddy occupies space on ifBash.com")

Area: the side panel only on the sites the person added. Design and the by-hand walk-through: `docs/panel-scope.md`. The rules are
`src/background/panelScope.js`, the browser calls `src/lib/platform.js`, the listeners `src/background/panelScopeWire.js`. All of the
below is about Chrome and Edge; Firefox and Safari are not changed. Nothing here needs a ServiceNow instance except 10; the rest needs
only a signed-in Chrome or Edge with the unpacked build (`D:\AgentBuddy\dist`) and any website. The fake Chrome the tests use opens a
panel only inside a click and only for a tab that is on; these questions check that the real browsers do the same. Note the browser
version (`chrome://version`, `edge://version`).

1. **The panel is gone from other pages and takes no width.** Assumed: with the default set to off and a tab on ifBash.com set to off,
   an open panel closes at once and the page gets its full width back, also after a reload and after Ctrl+T.
   Check: panel open on an added tab; open ifBash.com in another tab of the window. If a strip of the panel's width stays: note
   whether it goes after a reload of the page.
   If wrong: the closing is the browser's; try `setOptions({ tabId, enabled: false })` once more from `tabs.onActivated` (it is looked
   at already) and tell the lead what the browser does.

2. **`sidePanel.open` is refused for a tab whose panel is off.** Assumed: it rejects (the code then opens Settings). The code also asks
   `sidePanel.getOptions({ tabId })` when `open` resolved, and treats a tab that says "off" as a refusal.
   Check: on ifBash.com click the icon: Settings opens, no empty panel. In the worker's console (`chrome://extensions`, "service
   worker") run `await chrome.sidePanel.open({tabId: <ifbash tab id>})` with the tab in front: note the error text.
   If wrong (the panel opens empty on a page that is off): `afterRefusal` in `panelScope.js` gets the case; say what `getOptions` returns.

3. **The clicked tab's address is visible in `action.onClicked`** (`activeTab`) even for a site the extension has no access to. Assumed:
   yes. It decides whether a click on a `*.service-now.com` page that is not added opens the panel for "Turn on for this site" (case b).
   Check: click the icon on an un-added `*.service-now.com` page: the panel opens with "Turn on for this site". If Settings opens
   instead, the address was not visible.
   If wrong: without the `tabs` permission (not to be added) the click cannot tell; the panel would be reachable on such a page only
   from the sites list. Say so; the lead decides.

4. **`setOptions` and `open` in the same turn, neither awaited, keep the user gesture.** Assumed: yes, the browser keeps their order
   (this is how the click on an un-added ServiceNow page opens the panel).
   Check: the same click as 3. If `open` fails with "may only be called in response to a user gesture" in the worker console, swap the
   two calls in `openPanel` (`src/lib/platform.js`): open first, then `setOptions`, which is the order the Chrome documentation's
   own sample uses; the panel then opens on the tab's next load or needs a second click.

5. **Each tab has its own panel; switching between two added tabs.** Assumed: a panel opened on tab A is not open on tab B (both added);
   the person clicks the icon on B. The Chrome documentation says a tab-specific panel is its own instance.
   Check: open two tabs of the added site; open the panel on the first; switch to the second and back. Note whether the panel is open on
   the second without a click, and whether the first keeps what was on screen.
   If wrong, or if the owner wants it to follow across the ServiceNow tabs: build it the other way round. Default ON
   (`setPanelDefault(api, true)`), and a tab that is not an added site gets `{ tabId, enabled: false }` only; an added tab gets
   `{ tabId, enabled: true }` with no `path`, so all added tabs share the one panel. `scopeFor` and the click handler stay as they
   are. The cost: a new tab shows the open panel for a moment until its `onCreated` turns it off.

6. **The icon no longer toggles.** Assumed: acceptable. A click on an open panel leaves it open (`open` is idempotent); it is closed with
   the panel's own X. Chrome 141 and later has `sidePanel.close()` if a toggle is wanted; the worker would need to know the panel is open
   (`runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })`), which is an `await` before `open` and would lose the click.
   Check: click the icon twice on an added tab and note what the owner expects.

7. **Setting the same options again does not reload an open panel.** Assumed: it does not. The tab events ask `getOptions` first and
   change nothing that is right; but the click on an added `*.service-now.com` page repeats `setOptions({ tabId, path, enabled: true })`
   in the same turn as `open` (it cannot know in advance that the tab is on).
   Check: type something in the panel (the AI box), click the icon again: the text must still be there.
   If it reloads: pass `enable` only when the page is not an added site; this needs the active sites in memory before the click, which
   a stopped worker does not have. Tell the lead.

8. **How fast the panel leaves a tab that navigates away.** Assumed: when the page finishes loading (`status: 'complete'`) the
   address of the new page is not visible to the extension (no access) and the tab is switched off; on a slow page the panel stays for
   those seconds. Check: in the added tab go to ifbash.com by the address bar; time it.
   If too slow: also react to `tabs.onUpdated` `status: 'loading'` with the pending address (`tab.pendingUrl`, visible to the same rules).

9. **"Turn on for this site" keeps the panel open.** Assumed: the permission arrives first (`permissions.onAdded`; the worker only
   switches tabs on, never off), the site is saved a moment later (a storage change), and the panel stays open the whole way.
   Check: case 3, then press "Turn on for this site" and allow. The panel must not blink shut. Then Settings > ServiceNow sites > Turn
   off on that site: the panel closes. If it closes after the permission, the order of events in this browser is different: say how.

10. **Policy-listed sites.** Assumed: with the site in the organisation's `allowedInstances` and the permission granted at install
    (an enterprise build), the tabs of the site have the panel on from the worker's start without a click on the icon first. Check on a
    managed Chrome or an enterprise build.

11. **A tab restored after a browser restart.** Assumed: the browser gives restored tabs new numbers and forgets their panel setting; the
    worker's start sets the added ones on again. Check: restart the browser with an added tab open; click the icon: the panel opens.

12. **Edge.** Assumed: `sidePanel.setOptions` with `tabId`, `getOptions` and `open` behave as in Chrome, and the Edge sidebar entry of
    the extension appears and disappears with the tab. Check: questions 1 to 4 in Edge. Also `edge://extensions/shortcuts` still lists
    the three keys (`edge.md` 13).

13. **Many tabs.** Assumed: a worker start with about 100 tabs open finishes in well under a second and nothing visibly flickers.
    Check: open 50 tabs, reload the extension, then click the icon on an added tab at once.

# Panel scope: Agent Buddy's panel only on the sites you added

Owner's request, 2026-11-07: "I opened ifBash.com in Chrome and Agent Buddy is occupying space for it. Make it so our extension comes
only on ServiceNow pages and for other pages it doesn't."

Before this, the manifest registered ONE side panel for every tab, and the toolbar button was set to open it on a click. Once open, the
panel followed the person to every tab of the window and kept its width on pages that have nothing to do with ServiceNow.

"A ServiceNow page" here means a page of a site in Settings > ServiceNow sites ("added"): the sites the person turned on, plus the exact
sites the organisation lists in `allowedInstances`, as long as the browser has granted access. Portals of the same origin are pages of
the same site (`https://acme.service-now.com/sp`, `/esc`, `/csm`). Anything else, including another port, a sub-domain, plain `http`, a
look-alike such as `acme.service-now.com.evil.example`, `chrome://` pages, files and the extension's own pages, is not an added site.

## What it does, per browser

| Browser | Panel | What changed |
|---|---|---|
| Chrome, Edge (116 and later) | side panel | **The panel is off by default and on only for tabs on an added site.** It takes no width anywhere else. |
| Firefox (128 and later) | sidebar | **Nothing.** See "Firefox" below. |
| Safari | none yet | Nothing. |

## Chrome and Edge: how it works

All of it runs in the service worker; nothing is remembered between wake-ups (the browser's own per-tab setting is the only state, and
every start recomputes it).

1. **At every start of the worker** the default is set to off (`sidePanel.setOptions({ enabled: false })`), then every open tab is looked
   at (`tabs.query({})`): a tab on an added site gets `{ tabId, path: 'sidepanel.html', enabled: true }`, any other tab is off.
2. **A tab is looked at again** when it is made, loads or changes address (`tabs.onUpdated`, only for `url` or `status`), is shown
   (`tabs.onActivated`) or replaced (`tabs.onReplaced`). The address is read afresh each time (`tabs.get`) and one tab is handled one
   job at a time, in order.
3. **Every tab is looked at again** when a permission is removed, when the list of sites in the settings changes, and when the
   organisation's policy changes (`storage.onChanged`, area `managed`). When a permission is **added**, tabs of an active site are
   switched on and **none is switched off**: "Turn on for this site" first asks the browser for the permission and only then asks the
   worker to save the site, and switching the tab off between the two would close the panel the person is using. The save is a
   storage change, which looks at every tab.
4. **The browser only shows a tab's address for the sites the extension has access to** (we have no `tabs` permission and do not add
   one). A tab whose address is not shown is "not an added site": correct and intended. Nothing is read from the pages themselves.
5. **A panel that is open on a tab that becomes off closes by itself** and gives its width back.
6. A call the browser refuses never throws out of a listener; the next event tries again. If the active sites cannot be read, nothing is
   changed (reading badly must not switch every panel off).

Files: `src/background/panelScope.js` (the rules, pure), `src/background/panelScopeWire.js` (listeners and calls),
`src/lib/platform.js` (the only file that talks to the browser's panel: `setPanelDefault`, `setPanelForTab`, `panelEnabledFor`,
`openPanel(api, tabId, { enable })`, `wireToolbarButton(api, onClick)`), `src/background/service-worker.js` (wires it at the top level).
Tests: `tests/panel-scope-rules.test.js`, `tests/panel-scope-platform.test.js`, `tests/panel-scope-wire.test.js` (a fake Chrome in
`tests/panel-scope-fake.js` that opens the panel only inside a click and only for a tab that is on).

### The toolbar button

The browser does nothing by itself for a click on a tab whose panel is off, so the extension handles the click
(`setPanelBehavior({ openPanelOnActionClick: false })` and `action.onClicked`). The browser opens a panel only while the click is
being handled, and that ends at the first `await`, so the handler asks the browser first and decides afterwards:

| The clicked tab | In the turn of the click | Then |
|---|---|---|
| a page of an added site (its panel is on already) | `sidePanel.open({ tabId })` | nothing |
| an address that looks like ServiceNow (host ends `.service-now.com` or `.servicenowservices.com`) | `sidePanel.setOptions({ tabId, path, enabled: true })` then `sidePanel.open({ tabId })`, neither awaited first | the panel shows "Turn on for this site" |
| any other page (ifBash.com, a new tab, `chrome://`) | `sidePanel.open({ tabId })`, which the browser refuses because the panel is off | Settings opens at ServiceNow sites (`options.html#h-instances`) to add a site |

The clicked tab's address is visible after a click because of the `activeTab` permission the extension already has. For a page on an
added site that looks like ServiceNow, the click repeats the same `setOptions` that is already in force (the Chrome documentation's own
example does this on every tab update). A site on its own web address (for example `servicenow.acme.example`) that is not added looks
like any other page, so a click there goes to Settings, where its address is added.

### The keyboard shortcuts and the bar

They go through the same `openPanel(api, tabId, { enable })`. The shortcut passes its tab: on an added site it opens the panel as
before; on an address that looks like ServiceNow and is not added it switches the panel on for that tab, like a click; on any other
page the browser refuses and nothing opens, quietly (no Settings page for a key press). The bar on the ServiceNow page only exists on
added sites, whose tabs are on already, so it passes no tab and works as before.

## Limits and changes a person can notice

- **Each tab has its own panel.** The panel is on for a tab, not for the window: after opening it on one added tab, another added tab
  shows it only once the icon is clicked there. (If this is wrong in practice, see question 5 in
  `docs/live-questions/audit-1107-panel.md` for the other way to build it.)
- **The toolbar icon no longer closes an open panel**; a second click on an open panel leaves it open. Close it with the panel's own
  close button (the side panel's X, or the browser's side panel menu).
- A ServiceNow page that is not added gets its panel from a click on the icon. That panel stays until the tab loads, changes address or is
  switched away from and back (the tab is looked at again and found not to be an added site), and after "Turn on for this site" it stays.
- After a browser restart the browser gives restored tabs new numbers and forgets their panel setting; the worker's start sets the
  added ones on again, and the panel itself opens with a click on the icon.
- Not built: a tooltip on the icon for pages that are not added (a per-tab title cannot be reset cleanly, and the Settings page it opens
  says what to do). So there is no new text, and nothing new to translate.

## Firefox

Left as it is. Firefox's sidebar belongs to the window, not to a tab: once it is open it shows next to every tab of that window.
`sidebarAction.close()` and `open()` work only while a click or key press is being handled, so an extension cannot close it when the
person moves to another page, and there is no per-tab switch like Chrome's `sidePanel.setOptions`. The sidebar can show something
different per tab (`sidebarAction.setPanel({ tabId })`), but it would still take the width, which is the owner's complaint, and it
would need a new page to show. So in Firefox the toolbar button still toggles the sidebar; to get its width back on a page that is not
ServiceNow the person clicks the button again (or closes the sidebar from Firefox's View > Sidebar menu).

Text for `docs/deployment.md`, "Firefox": "Firefox shows its sidebar next to every tab of the window and does not let an extension close
it by itself. Agent Buddy cannot, as it does in Chrome and Edge, keep the panel to ServiceNow tabs. The toolbar button opens and closes
the sidebar; close it when you move to a page that is not ServiceNow. See `docs/panel-scope.md`."

## What the owner tries by hand (Chrome; then Edge)

The real browser cannot be driven by automation here, and the end-to-end run hosts the panel in a window of its own, so it never uses
the side panel API. Do this once in Chrome and once in Edge, on a computer where at least one ServiceNow site is added (dev364920):

1. In `chrome://extensions` (or `edge://extensions`) press Reload on Agent Buddy, loaded unpacked from `D:\AgentBuddy\dist`.
2. Open the added ServiceNow site in a tab and click the Agent Buddy icon: the panel opens.
3. Open ifBash.com in another tab of the same window: the panel is gone from that tab and takes no width. Switch back to the ServiceNow
   tab, click the icon again if the panel is closed there: it opens.
4. On the ifBash.com tab, click the icon: the panel does not open; the Settings page opens in a new tab at "ServiceNow sites".
5. Open a ServiceNow page that is not added (any `*.service-now.com` site you have not turned on) and click the icon: the panel opens
   with "Turn on for this site". Press it and allow the site: the panel stays open and stops asking.
6. Press Alt+Shift+1 on ifBash.com: nothing opens. Press it on the added ServiceNow tab: the panel opens.
7. Turn the site off in Settings > ServiceNow sites with the panel open on its tab: the panel closes.
8. Open a new tab (Ctrl+T): no panel. Reload the extension while a ServiceNow tab is open: the panel is available on that tab again
   (the worker sets it on start).

Anything that does not happen as written is recorded in `docs/live-questions/audit-1107-panel.md`, which lists what was assumed.

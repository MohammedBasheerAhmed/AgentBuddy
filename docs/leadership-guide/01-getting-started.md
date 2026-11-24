# Getting started

Install it, turn it on for your ServiceNow site, add an AI key (or skip AI), and you can work a ticket in about five minutes.

## Install

Agent Buddy runs in Chrome 116 or later, current Edge, and Firefox 128 or later. Chrome and Edge share one build. Firefox has its own.

| Browser | On your own computer | For everyone, by managed policy |
|---|---|---|
| Chrome | `chrome://extensions`, turn on Developer mode, Load unpacked, choose the `dist` folder. | `ExtensionInstallForcelist`, from files your administrator deploys. |
| Edge | `edge://extensions`, Developer mode, Load unpacked, choose `dist`. | The same, with the Edge policy files. |
| Firefox | `about:debugging`, This Firefox, Load Temporary Add-on, choose `manifest.json` in `dist-firefox`. It stays until Firefox closes. | The `ExtensionSettings` policy, with a package signed by Mozilla. |

In Firefox, pin the button from the Extensions button (the puzzle piece) if it is missing. A store listing: not verified.

## Turn it on for a ServiceNow site

1. Open your ServiceNow site in a tab.
2. Click the Agent Buddy button on the toolbar. The panel opens with a "Getting started" card.
3. In step 1, "Turn on Agent Buddy for your ServiceNow site", press **Turn on for this site**.
4. When the browser asks, choose Allow.

If the browser did not turn it on, press the button again and choose Allow. If no question appears, your organisation may block it.

Another way: Settings > ServiceNow sites. Type the address, for example `https://yourcompany.service-now.com`, and press **Turn on**. For a site on its own web address, the panel says "This does not look like ServiceNow". Press **Turn on anyway**.

Agent Buddy reads only what you can already see. It never writes to ServiceNow. "Insert" fills one field, and you press Save yourself.

**Why the panel is silent on other sites.** In Chrome and Edge the panel is off by default. It is on only for tabs on a site you turned on, and the sites your organisation lists. On any other page it does not show and takes no width. The toolbar button there opens Settings at "ServiceNow sites". Firefox's sidebar shows next to every tab and cannot be closed by the extension, so close it yourself.

## Add an AI key

Everything under Insights works without a key. To skip AI, press **Skip AI for now**.

1. Press the gear in the panel header, or **Set up AI** on the card. Settings opens in a tab.
2. Choose the **AI Assist** page.
3. Under **Provider**, choose one. Anthropic (Claude) is the default.
4. Paste your key in the key box. Its label names the provider, for example "Anthropic API key".
5. Press **Save key**, then **Test connection**.

Providers: Anthropic (Claude), OpenAI / company gateway, Azure OpenAI, Google Gemini, Mistral, Groq, DeepSeek, OpenRouter, Ollama, and Other (OpenAI-compatible server). Use the one your organisation approved. For a company gateway, fill **Address (optional)**.

**A model on your own computer.** Choose "Ollama (on this computer, nothing leaves it)". Leave the key empty. Start Ollama and pull a model first, for example `ollama pull llama3.1`. For another local server, choose "Other (OpenAI-compatible server)" and enter its address, for example `http://localhost:1234/v1`.

**Where the key is kept.** Under **Where to keep the key**: "This browser (simple)", "Memory only (forgotten on close)" or "Encrypted with a passphrase". Your organisation may set this, or supply the key.

## The side panel tour

**The header.** The mark, the name, and your site's short name (for example `dev364920`). On the right: **All tools** (grid icon) and **Settings** (gear).

**The screens.** A bar along the bottom. Press one, or use the Left and Right arrow keys, Home and End.

| Screen | What it is for |
|---|---|
| Ticket | The record that is open. |
| My work | Your queue, most urgent first. |
| Team | Dashboards. Only for the "Team lead" work profile. |
| Write | Replies, emails, rewrites, snippets, a safe-to-send check. |
| Knowledge | Articles from tickets, duplicates, article checks. |

**Insights and AI Assist.** A switch under the screen picks the half. My work has one half.

| Half | What happens | Line under the switch |
|---|---|---|
| Insights | Reads in ServiceNow. Nothing is sent. | "Stays in ServiceNow. Nothing is sent anywhere." |
| AI Assist | Asks the AI. You see the masked text first. | "Masked text goes to ... You see it first." |

The number on Insights counts rows that need a look. After "Skip AI for now", AI Assist says "off" and offers **Turn AI Assist on**.

On the Ticket screen each half shows up to five rows: Understand the ticket, Find the fix, Same caller, Reply, Close well. A row shows only when the ticket has something for it. In AI Assist, **Start** marks the suggested action.

**All tools.** The grid button, or Ctrl+K (Cmd+K on a Mac), opens a sheet with everything beyond the five rows. Type in "Find a tool..." and press Enter. Groups: "More for this ticket: Insights", "More for this ticket: AI Assist", "Go to", "Panel" (Settings, colours, language). Buttons like "More for this ticket: 3 Insights" open it at that group.

**The record header.** Top of the Ticket screen: ticket number, "Priority", short description. Chips show state, SLA, "Unassigned" and "VIP" when they apply. The chevron ("Ticket details") opens Caller, Assigned to, Group, Opened, Updated, Service and Configuration item. If you may not read the ticket: "Details are not available to you."

A side rail is off by default (Settings > Side rail).

## The quick-actions bar and the icon dock

The dock is a small pill at the bottom centre of a ServiceNow ticket page: the Agent Buddy mark and 3 or 4 round icons for the main actions. It is the only thing Agent Buddy puts on a ServiceNow page.

- Hover an icon to read its name. An "AI" badge means it uses AI.
- Click an icon. The panel opens and starts the action. You see what will be sent first.
- Click the mark to fold the dock, and again to open it.
- Drag the mark, or press Left and Right on it, to move the dock along the bottom.
- It hides while a ServiceNow dialog is open. If something covers it, a click starts nothing and says so.

Until you choose, an incident shows "Summarise", "Draft a reply" and "Resolution notes". With no AI, it offers "Ready to resolve?" and "Related tickets".

Change it in Settings > Side rail > "On the ServiceNow page": turn the bar off, or pick up to 4 actions per kind of ticket. Your organisation can switch it off.

## Keyboard shortcuts

| Action | Windows, Linux | Mac |
|---|---|---|
| Open Agent Buddy | Alt+Shift+1 | Control+Shift+1 |
| Summarise this ticket | Alt+Shift+2 | Control+Shift+2 |
| Draft a reply | Alt+Shift+3 | Control+Shift+3 |
| All tools (in the panel) | Ctrl+K | Cmd+K |

Summarise and Draft a reply start on the open ticket and still show what will be sent. On a page that is not an added site, nothing opens.

In All tools: Up and Down move (Ctrl+N and Ctrl+P too), Home and End jump, Enter runs, Esc closes.

To change the first three, press **Change the shortcuts in the browser** in Settings > Keyboard shortcuts. Or use `chrome://extensions/shortcuts`, `edge://extensions/shortcuts`, or in Firefox `about:addons`, the gear, Manage Extension Shortcuts.

## Language and Arabic/right-to-left

Settings > Language has two choices.

- **Language of the panel and this page**: "Same as the browser", English or العربية.
- **Language of AI answers**: "The language of the ticket" or "The language of the panel".

All tools also switches the language ("Language: ..."). Ticket text is never translated.

In Arabic the layout runs right to left, the arrow keys on tab rows swap sides, and the dock follows. Ctrl+K uses the physical K key, so it works on an Arabic keyboard. Right-to-left in the real side panel: not verified by hand.

## A first five minutes

1. Open an incident and click the Agent Buddy toolbar button.
2. Finish "Getting started": turn the site on, choose what you work on, add a key or press **Skip AI for now**.
3. Read the record header: number, priority, state, SLA.
4. On Insights, open "Understand the ticket", then "Find the fix".
5. Click the dock icon "Summarise".
6. In "Send to the AI?", read "What will be sent" and "What is hidden". Press **Send to AI**.
7. Read the answer. Press **Copy**, or insert it and press Save in ServiceNow yourself.
8. Press Ctrl+K, type `reply`, choose "Draft a reply to the customer".

## Browser differences

| | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| Version | 116 or later | Current | 128 or later | Planned, not supported |
| Panel | Side panel | Side panel | Sidebar | None |
| Only on added sites | Yes | Yes | No | Not applicable |
| Toolbar button | Opens the panel, does not close it | Same | Opens and closes the sidebar | Not applicable |
| Click on the dock | Opens panel, starts action | Same | Does not open the sidebar | Not applicable |
| Real-instance checks | Not verified for every step | Automated run passed; panel by hand not verified | Not verified | None |

In Firefox the dock says "Click the Agent Buddy button in your browser toolbar. The action starts in the panel." If the panel opens within 30 seconds, the action starts. If the sidebar is already open, it starts at once.

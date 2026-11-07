# Daily pain points of service personnel, and what Agent Buddy does about them

Written 2026-10-30 as input to the production plan (`TRACKER.md`). For every pain point: what happens on a normal day, what it
costs, what Agent Buddy offers today, and what the plan adds. Item IDs (`N..` = Insights, no AI; `AI..` = AI Assist; `F..` =
foundation) refer to `TRACKER.md`.

## How this was put together, and how sure it is

- **Sources:** published industry data (listed at the end, with how reliable each is), how ServiceNow's ticket workflows work
  for a non-admin fulfiller, the code audit of this repo and a screenshot tour of every panel screen.
- **Not yet checked with real agents.** The list is what the evidence and the workflows point to. Item V3 in the plan is to
  shadow a few agents for an hour and take baseline numbers from the instance before rollout, so the impact can be shown after.
- **The numbers that matter most:**
  - Wrong first assignment: a Microsoft study of 20 large online services found reassignment adds **up to 10x** to triage time,
    most for high-severity incidents (Chen et al., ICSE 2019). A vendor survey puts each reassignment at about **40 extra
    minutes** and a visible drop in user happiness (HappySignals, self-reported).
  - Searching: agents spend **26% to 35%** of their time looking for information across systems (ManageEngine; Forrester citing
    [24]7.ai; both vendor-sponsored).
  - Wrap-up: after-contact work is **6% to 25%** of handle time depending on the source (vendor estimates).
  - Native AI is not a given: ServiceNow's own summaries and resolution notes (Now Assist) come with the **Pro Plus** tiers, which
    many organisations do not license (consultancy and community sources; confirm with ServiceNow). Agent Buddy needs no admin,
    no plugin and no extra licence.

## Who we serve

| Role | Works in | A good day is | Top three pains |
|---|---|---|---|
| **Service desk agent (L1)** | Incidents, requests, calls, chats, email | Many contacts handled, most fixed first time, few chasers | Logging calls fast and well; finding the answer; writing replies |
| **Resolver (L2/L3)** | Incidents, problems, tasks | Root cause found, nothing bounced back | Tickets arrive without the facts; long threads; "has this happened before?" |
| **Catalog fulfiller** | Requested items, catalog tasks | Requests done in order, no "where is my laptop?" calls | Reading variables; approvals and other teams blocking; status chasers |
| **Customer service agent (CSM)** | Cases, accounts, contacts | Customer feels known, case solved or escalated cleanly | No account context; engineering bounces cases; B2B SLAs |
| **HR case agent** | HR cases (sensitive) | Employee helped quickly and discreetly | Confidential data; policy-correct, kind wording; strict handling rules |
| **Team lead / queue manager** | Queues, dashboards | No breaches, balanced load, clean hand-overs | Queue health is invisible without building reports; stale tickets; ping-pong |
| **Knowledge owner** | Knowledge bases | Agents trust and use the KB | No time to write; duplicates and stale articles; not knowing what to write |
| **Major incident / change roles** | Major incidents, changes, problems | Stakeholders updated, risk understood, causes found | Updates every 30 minutes; CAB prep; linking incidents to a problem |

## Pain points along the life of a ticket

Ratings: **How often** (every ticket / daily / weekly) and **Cost** (time lost, or risk: SLA breach, reopen, data leak, upset
customer). The last column says what the plan gives: what exists today (in brackets) and what is new or improved.

### 1. Intake: the ticket is logged (phone, walk-up, email, chat, portal)

| # | Pain point | How often | Cost | What Agent Buddy gives |
|---|---|---|---|---|
| P1 | Typing a ticket while or after talking: short description, description, category, caller, CI. Rushed tickets are vague and get routed wrong. | Every phone/walk-up ticket | Minutes per ticket; bad data starts the bounce chain | (AI24 Notes to ticket, classic blank form only) + a button that opens a blank form, caller and category suggestions; N21 snippets as call templates |
| P2 | Ten people report the same outage, each as a new ticket; nobody connects them for an hour. | Weekly, painful when it happens | Duplicate work; the outage is noticed late | (Open duplicates, buried at the bottom of Related) + **N29 Outage spotter**: "9 open tickets on VPN Gateway EU in the last 2 h" as a banner on the ticket and in My work |
| P3 | The first ticket lacks the basics (error text, affected user, CI, impact), so the next step is a round trip to the customer. | Daily | A day or more per round trip | N11 Missing details (no AI) + AI8 Questions to ask |

### 2. Triage and routing

| # | Pain point | How often | Cost | What Agent Buddy gives |
|---|---|---|---|---|
| P4 | Picking the assignment group and category from long lists; a wrong guess bounces the ticket between teams. | Every ticket | Up to 10x triage time per reassignment | N10 Where similar tickets went (no AI) + AI12 Where should this go?; **N24 Ticket journey** shows "bounced 3 times: Service Desk > Network > Desktop" so the next team sees the pattern |
| P5 | Priority set wrongly: a VIP or a whole site affected but logged as low, or the reverse. | Daily | SLA breaches on the wrong tickets | N9 Risk signals also flags priority mismatches (VIP caller, many affected, outage pattern) |

### 3. Understanding the ticket (picking it up, or picking it up again)

| # | Pain point | How often | Cost | What Agent Buddy gives |
|---|---|---|---|---|
| P6 | Picking up a ticket mid-flight (shift change, reassignment, callback) means scrolling a long thread to find what was tried and what is pending. | Many times a day | 5 to 10 minutes per pick-up | N1 Ticket at a glance + **N24 Ticket journey** (no AI: opened, assigned, reassigned, state changes, last customer message, SLA events, in one short list) + AI1 Summarise ticket |
| P7 | What matters is spread over related lists: tasks, approvals, SLAs, CI, caller's other tickets. Each is a click and a page load. | Every ticket | Clicks, context switching | (Related tab, Request tab) made compact: N2, N5 |
| P8 | Not knowing the caller: VIP? repeat issue? three other open tickets? | Daily | Wrong tone, missed patterns | (Caller history in Related) + N9 VIP and repeat flags in the header |

### 4. Diagnosing and fixing

| # | Pain point | How often | Cost | What Agent Buddy gives |
|---|---|---|---|---|
| P9 | Searching the knowledge base with the right words; results in another tab; not sure which article is current. | Many times a day | 26% to 35% of agent time goes to searching | N3 Knowledge for this ticket + **N23 Knowledge search** in the panel; N7 shows freshness |
| P10 | Solving again what a colleague solved last week. | Daily | The whole diagnosis time | (Solved look-alikes in Related) + N12 Steps that worked before + AI11 Next best actions |
| P11 | **A change caused it**, but the resolver does not look at the change calendar. "What changed?" is the first question of every good resolver. | Daily on infrastructure tickets | Hours of diagnosis; repeat incidents | **N25 Recent changes on this CI or service** (no AI): changes implemented on the same CI or service in the last few days, with their window. Reuses the change reading the CAB brief already has. |
| P12 | **A known error already exists** with a workaround, but the agent does not find it. | Weekly | Diagnosis time; the customer waits for a fix that exists | **N26 Known errors and open problems** for this CI or service, workaround first |

### 5. Communicating

| # | Pain point | How often | Cost | What Agent Buddy gives |
|---|---|---|---|---|
| P13 | Writing replies and updates is the biggest typing task; harder when stressed, in a second language, or to an angry customer. | Many times a day | Minutes per reply; tone complaints | AI7 Draft reply, AI9 Email drafts, AI23 Rewrite (shorter, friendlier, plain, formal, translate); no-AI: N20 email templates, N21 snippets |
| P14 | Customers chase "where is my request?" because nobody updated them; every chaser is a new contact. | Daily | Repeat contacts, lower satisfaction | N5 Request status ("who to chase" in one line) + **N27 Follow-ups due**: "customer not updated for 3 days" with a one-click status update |
| P15 | Internal details or personal data slip into a customer-visible comment, or a work note goes to the customer by mistake. | Weekly | Data leak, complaints, audit findings | (Safe-to-send check on inserted text) + N22 check what the agent typed + F5 says where text lands |
| P16 | Customers write in other languages. | Daily on global desks | Delay, misunderstanding | AI7 replies in the customer's language; AI23 translate and bilingual |

### 6. Waiting and following up

| # | Pain point | How often | Cost | What Agent Buddy gives |
|---|---|---|---|---|
| P17 | Tickets "on hold, awaiting customer" are forgotten; the follow-up day passes; the 3-strike close rule is not applied. | Daily | Stale queues, unfair reopens or breaches | **N27 Follow-ups due** in My work: waiting on the customer past N days, with the reminder template; "customer replied" marker when they answer |
| P18 | An SLA is about to breach and nobody notices until it is red. | Daily | Breaches, penalties (B2B) | N13 time left on every ticket, ordered by it; N15 SLA radar for leads |
| P19 | A request waits on an approval or another team's task, and the fulfiller does not know who to chase. | Daily for fulfillers | Days of waiting | N5 Request status: the blocker and its owner; AI9 Approval reminder |

### 7. Hand-off and escalation

| # | Pain point | How often | Cost | What Agent Buddy gives |
|---|---|---|---|---|
| P20 | Escalations bounce back because the facts (steps tried, evidence, impact, contact window) are not in the ticket. | Daily | A day per bounce | AI13 Hand-off brief, AI14 Escalate to engineering; N11 Missing details doubles as a hand-off check |
| P21 | Shift change: the next shift does not know what is hot. | Every shift | Missed breaches, repeated work | N16 Shift hand-over tables + AI28 note |
| P22 | Major incident: stakeholder updates every 30 minutes while also fixing it. | Weekly or less, very intense | Hours under pressure | AI15 Major incident updates (only on major incidents) |

### 8. Resolving and closing

| # | Pain point | How often | Cost | What Agent Buddy gives |
|---|---|---|---|---|
| P23 | Resolution notes are skipped or say "fixed"; the next person cannot find the fix, and reports cannot tell causes. | Every resolved ticket | Future search fails (P10) | AI19 Resolution notes, AI20 Improve my notes, N4 Ready to resolve? |
| P24 | Closed without the customer confirming; the ticket reopens. | Daily | Reopen rate, lower satisfaction | N4 "who wrote last" + N20 resolution email asking to confirm |
| P25 | Picking the close code. | Every resolved ticket | Bad reporting data | N4 flags a missing close code; AI19 suggests one |

### 9. Capturing knowledge

| # | Pain point | How often | Cost | What Agent Buddy gives |
|---|---|---|---|---|
| P26 | No time to turn a fix into an article. | Weekly | The same problem is solved again and again | AI21 Knowledge article from ticket (offered at Resolve) |
| P27 | Duplicate and stale articles make agents distrust the KB. | Ongoing | Agents stop using the KB (feeds P9) | N18 Duplicate finder, N7 Article checks, AI25 Optimise, AI26 Merge |
| P28 | Not knowing which articles to write next. | Monthly | KB effort goes to the wrong topics | N19 Gap radar, AI27 Gap outline |

### 10. Leading the team

| # | Pain point | How often | Cost | What Agent Buddy gives |
|---|---|---|---|---|
| P29 | Queue health needs reports a team lead often cannot build. | Daily | Problems seen late | N15 Team dashboards (no admin needed) |
| P30 | Unbalanced workload, stale tickets, ping-pong between groups. | Daily | Breaches, unfairness | N15 workload and ageing; N24's reassignment counts roll up per group |
| P31 | Coaching without evidence. | Monthly | Generic coaching | AI30 Coaching snapshot (off unless the organisation turns it on) |
| P32 | Showing management that a tool helped. | Quarterly | The tool is cut | **V3**: baseline numbers before rollout (reassignment, reopen, time to first response, customer-update gap) from N15's engine, compared after |

### Across all of it

| # | Pain point | What Agent Buddy gives |
|---|---|---|
| P33 | Context switching between lists, forms, related lists, KB, email and reports | One panel beside the ticket that follows it; both halves keep their context |
| P34 | Too many clicks for the daily three (understand, reply, resolve) | State-aware quick actions; answers at the top; several answers kept per ticket (AI0.4) |
| P35 | New joiners do not know groups, categories or the process | N10, N12, N4 act as guard rails; team snippets (N21) |
| P36 | Native AI needs extra licences and admin set-up | Works on any instance as a normal fulfiller, with the organisation's own AI key, or without AI at all (Insights) |
| P37 | Sensitive data (HR, personal data) and approval by security | Insights halves never send anything; AI Assist masks, previews and is policy-controlled (AI0.2, F7) |

## Role-specific additions

| Role | Pain | What Agent Buddy gives |
|---|---|---|
| CSM agent | Walking into a call without knowing the account | **N28 Account at a glance** (no AI): open and recent cases for the account, entitlement, priority account flag, recent changes on the account's assets; AI5 Account briefing on top |
| HR agent | Confidential case, policy-correct and kind wording | AI4 HR brief in Strict mode only; HR child tables recognised (F3); no HR text leaves without the organisation's approval (AI0.2) |
| Problem manager | Which incidents belong to this problem, and when it started | Linked incidents and a timeline (exists for the RCA feature) shown as Insights on the problem; AI16 RCA |
| Change implementer | Conflicts, and what broke after the last change | Conflicting changes (exists for the CAB brief) as Insights; N25 in reverse: incidents on the CI since the change |
| Catalog fulfiller | Reading the request form, many steps, waiting on others | N5, N6 (checklist from the instructions, ticks kept) |

## What this changes in the plan

New items (all in `TRACKER.md`, status Planned):

| # | Item | Screen | Built from |
|---|---|---|---|
| N24 | **Ticket journey**: opened, assigned, reassignments (count and path), state changes, last customer message, SLA events | Ticket > Insights | The journal and the record's own counters (`reassignment_count`, `reopen_count`); full field history may not be readable without admin, to check on dev364920 |
| N25 | **Recent changes on this CI or service** | Ticket > Insights | The change reading already used for cases and the CAB brief |
| N26 | **Known errors and open problems for this CI or service**, workaround first | Ticket > Insights | `problem` (known error flag, workaround) |
| N27 | **Follow-ups due**: waiting on the customer past N days, customers not updated for N days, with the reminder template | My work | My queue data plus the last customer-visible entry per ticket |
| N28 | **Account at a glance** (CSM) | Ticket > Insights | The account cases already read for the account briefing |
| N29 | **Outage spotter** banner: open tickets on the same CI or service in the last hours | Ticket > Insights, My work | The existing open-duplicates check (`src/context/similar.js`) |
| V3 | **Prove it**: shadow a few agents, take baseline numbers from the instance before rollout, compare after | After the screens | The Team engine |

Changed items: N9 also flags priority mismatches; AI1 sits next to N24 (the journey is the no-AI answer to "what happened?").

### Where the value is (proposed order of work)

1. **Every ticket, every day:** N1 Ticket at a glance (+ N24 journey, N29 outage banner); F5 Insert done right; AI0.4 the answer
   area; AI1 Summarise; AI7 Draft reply with N20 templates; N3/N23 knowledge; N13 My queue with N27 follow-ups.
2. **Fixes found faster:** N25 recent changes, N26 known errors, N2/N12 what worked before, N10 routing, N11 missing details.
3. **Closing well:** N4 Ready to resolve?, AI19 resolution notes, AI21 article from ticket, N22 safe-to-send.
4. **Leads and knowledge owners:** N15 to N19, AI25 to AI30.
5. **Role packs:** CSM (N28, AI5, AI14), HR (AI4), problem and change.

## Platform recipes: do these in ServiceNow itself

Agent Buddy only builds what an agent needs and ServiceNow cannot do inside the platform (see the product filter in TRACKER.md). These are
pain points the platform already solves, with ordinary configuration, so they are not built here. Each is a recipe for the ServiceNow
administrator:

- **Expiring and stale knowledge articles:** use ServiceNow's own Knowledge dashboards and reports (articles that expire soon, articles not
  updated for a year, articles nobody reads). Not built in Agent Buddy; its Knowledge screen shows an article's freshness when you search, and
  finds duplicates and gaps, which the platform does not.
- SLA warnings, inactivity monitors and auto-close of tickets waiting on the customer; VIP highlighting; ping-pong (reassignment) alerts;
  outage detection when a ticket is created; change conflict checks; on-call schedules; survey reports; guided tours for new agents.

## Sources

- Chen et al., "An Empirical Investigation of Incident Triage for Online Service Systems", ICSE 2019 SEIP (Microsoft):
  https://www.microsoft.com/en-us/research/uploads/prod/2019/03/incidenttriage_cameraReady.pdf (peer reviewed)
- HappySignals, "Impact of ServiceNow's Reassignment Count on Employees Productivity":
  https://happysignals.com/blog/measuring-servicenow-reassignment-counts-on-employee-productivity (vendor, self-reported)
- Forrester, "Agent Desktops: The Silent, and Costly, Tax On Your Agents' Time And Energy" (cites [24]7.ai data):
  https://www.forrester.com/blogs/agent-desktops-the-silent-and-costly-tax-on-your-agents-time-and-energy/ (analyst blog citing a vendor)
- ManageEngine, "The DNA of the Service Desk": https://www.manageengine.com/products/service-desk/dna-servicedesk-plus.html (vendor)
- After-contact work ranges: OpsDog, https://opsdog.com/products/after-call-work-as-a-percentage-of-total-handle-time ; CX Today,
  https://www.cxtoday.com/contact-centre/what-is-wrap-up-time (vendor and trade press; figures vary widely)
- Now Assist licensing: Redress Compliance, https://redresscompliance.com/servicenow-now-assist-ai-licensing.html ; ServiceNow
  Community, https://www.servicenow.com/community/itsm-articles/now-assist-for-itsm-faq/ta-p/2898299 (consultancy and community;
  confirm with ServiceNow)

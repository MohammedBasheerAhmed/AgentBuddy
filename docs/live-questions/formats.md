# Answer formats: what was assumed and how to check it

Area: how an AI action writes its answer (`src/formats/`, the Settings section `src/options/FormatsSection.jsx`, the "Change format" link under
an action in `src/sidepanel/ticket/assist/actions/ActionGroups.jsx`, the policy key `orgFormats`). Built and tested against a stub AI in
`e2e/` (scenario `zv`) and plain unit tests. None of it has met a real AI model on a real ticket, a managed browser profile, or an Arabic
reader. Each question says what was assumed, how to check it, and what to change if it is different.

## A. What the model does with a format

1. **Does a real model write exactly the sections you named, in that order?**
   Assumed: yes, the way it writes the standard five lines. The prompt lists each section as "Name: what belongs here." and says "exactly
   these N lines, in this order". The stub AI only proves the text arrives.
   Check: Settings > AI Assist > "How AI answers are written" > "Summarise this ticket": start from "Issue, key actions, outcome", save, and
   summarise a real ticket with your model. Try bullet points too.
   If wrong: tell me which model and what it wrote; the wording of the lead sentence per style (`SECTIONED` in `src/formats/formats.js`) is the
   place to change, and `tests/formats.test.js` shows what is pinned.

2. **Does the hint ("what was done, in order") help, or does the model copy it into the answer?**
   Assumed: it guides and is not copied.
   Check: give a section a hint and a section without one; read both answers.
   If wrong: the hint can move into brackets after the name (as the hand-off brief lists its headings) or be dropped from the prompt.

3. **Do extra instructions ever break what the panel reads back?**
   Assumed: no, because the extras are placed after the rules and say that headings and labels stay. A model may still obey "do not use labels"
   from the extra text.
   Check: on resolution notes, write the extra instruction "Write it as one paragraph", press Insert, and see whether the Cause, Fix and
   Verification still arrive in the right boxes (and "Suggested close code" stays out of them).
   If wrong: the five read-back actions (`note: 'reads-back'` in `src/formats/formats.js`) can lose their extra box, or the panel's
   parsers (`src/features/picks.js`) can be made to cope.

4. **Is a customer reply with extra instructions still safe to send?**
   Assumed: yes: the customer-safe rules come first and the safe-to-send review (`src/safeSend/review.js`) still runs before Insert.
   Check: "Draft a reply to the customer", extra instruction "Mention the team's name", press Insert on a ticket whose work notes name an
   internal team.
   If wrong: say what it let through; the review's phrase list is the first place to look.

## B. How it feels

5. **Are the "Change format" links under each action too much on the main screen?**
   Assumed: a small quiet link under each of the three suggested actions is fine. (Scenario `y`/the action list test keeps the four-button
   rule by not counting them as action buttons.)
   Check: open a ticket on the AI Assist half and judge whether the page looks busier than before.
   If wrong: show the link only inside "More actions", or only on the answer card ("More" menu), or only in Settings.

6. **Is the editor clear on a 320 px panel and in Settings?** Sections, heading, hint, move and remove, style, length, extra, "Show the
   instructions this sends". Check: build a format with four sections on both. If wrong: say what to drop or to move under "More".

7. **Do the ready layouts ("Issue, key actions, outcome", "Situation, background, assessment, recommendation") match what your team
   writes?** Tell me the layouts your leads use and they become the ready ones (`presets` in `src/formats/formats.js`).

## C. Teams

8. **Does the browser accept `orgFormats` in a managed policy?** Assumed: yes. The schema is a list of objects holding a list of objects,
   an enum and an integer range (`managed_schema.json`), a shape the browser's policy check accepts, but only a real managed profile
   proves it. Check: put the example from `docs/deployment.md` ("Formats for AI answers") in the policy, open `chrome://policy`, and look
   for an error on `orgFormats`; run `node scripts/check-policy.js <file>` first. If wrong: the entries can become one text value holding the
   JSON (as `defaultDashboard` allows), which the reader would then parse.

9. **Does a locked format look locked?** Check: lock `record-summary` in the policy; in Settings the item says "Set by your organisation",
   its fields are greyed and there is no Save; in the panel the link says "See format". And an unlocked one: it says "Your organisation's
   format" until you save your own, and "Use my organisation's format" takes yours away again.

10. **Is "Copy for your administrator" what a lead needs?** It copies one policy entry as JSON. Check: build a format, press it, paste it into
    a policy file, run the checker. If wrong: copy a whole `orgFormats` list of everything you have set.

## D. Arabic

11. **Would an Arabic-speaking agent word these texts differently?** About 50 new texts (`src/i18n/ar/formats.js`); the section names you
    type, and the ready layouts' section names, stay as written (the answer keeps every heading as written). Check: read Settings > AI
    Assist in Arabic. If wrong: change the entry in `src/i18n/ar/formats.js` (the key is the English text).

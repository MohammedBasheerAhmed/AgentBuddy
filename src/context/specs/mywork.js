// Context specs for the My work screen (owner: My work agent, docs/round3.md). See src/context/specs/index.js.
//
// My work reads no context pack: its reads (src/mywork/read.js) ask for a fixed, small list of columns per table, written down with
// the reason for each in src/mywork/tables.js (COMMON_COLUMNS, KNOWN_TABLES): the number, the title, priority, state, times, class and
// CI of each ticket, the hold reason, and the customer's login (compared in the content script, never sent to the panel). No free text
// but the title, no journal text (only who wrote a comment and when). Nothing here goes to an AI.
export default {};

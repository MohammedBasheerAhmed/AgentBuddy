// The first steps with Agent Buddy, as a short numbered list the panel shows until they are done: turn it on for the ServiceNow
// site, add an AI key (or pick a model on this computer), open a ticket. Pure: the panel's state in, the steps out
// (tests/panel-first-run.test.js). The buttons that do each step stay where they are (the setup help, Settings); this list says
// where the person is and what comes next.

/**
 * @param {{ page: object, lastSeen: object|null, aiReady: boolean }} input
 *   page: what usePage says about the active tab; lastSeen: the last ServiceNow page that answered (any enabled site counts)
 * @returns {{ show: boolean, steps: { id: string, label: string, state: 'done'|'next'|'later', hint: string }[] }}
 *   show: false once both setup steps are done (the list is for a first run, not for every page that is not a ticket)
 */
export function firstRunSteps({ page, lastSeen, aiReady }) {
  const enabledHere = page?.status === 'record' || page?.status === 'no-record';
  const siteOn = enabledHere || Boolean(lastSeen);
  const onTicket = page?.status === 'record';
  const raw = [
    {
      id: 'site',
      label: 'Turn on Agent Buddy for your ServiceNow site',
      done: siteOn,
      hint: page?.origin ? 'The button for it is below. Agent Buddy then reads only what you can already see there.' : 'Open your ServiceNow instance in this tab first.',
    },
    { id: 'key', label: 'Add an AI key in Settings', done: aiReady, hint: 'Settings is at the top of the panel. You can also choose a model that runs on this computer. Personal data is masked before anything is sent.' },
    { id: 'ticket', label: 'Open a ticket', done: onTicket, hint: 'An incident, request, catalog task or case. Agent Buddy offers help for it here.' },
  ];
  let nextGiven = false;
  const steps = raw.map(({ done, ...step }) => {
    if (done) return { ...step, state: 'done' };
    if (nextGiven) return { ...step, state: 'later' };
    nextGiven = true;
    return { ...step, state: 'next' };
  });
  return { show: !(siteOn && aiReady), steps };
}

export const STEP_WORD = Object.freeze({ done: 'Done', next: 'Next', later: 'Later' });

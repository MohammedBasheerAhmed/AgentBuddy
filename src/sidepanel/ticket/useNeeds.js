import { useEffect, useState } from 'react';
import { buildGlance } from '../../insights/glance.js';
import { useTicketFacts } from './cards/data.js';
import { needsNow } from './needsNow.js';

/**
 * What needs the agent now on the record on screen (needsNow.js: the SLA, a customer waiting, a possible outage), for the first rows of
 * "Understand the ticket" (its line and its dot, and so the number on the Insights tab). It listens to the Glance's read and makes
 * none of its own (`active: false`: the Glance at the top always reads it), with a clock that moves once a minute ("due in 40 min").
 * @param {{ page, record, eff, header, headPhase: string, cards: { id: string }[] }} input   cards: the Insights cards drawn in the list
 */
export function useNeeds({ page, record, eff, header, headPhase, cards }) {
  const facts = useTicketFacts({ page, record, eff, active: false });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setNow(Date.now()), [facts.at]);
  // Right after the record changed the hook may still hold the last record's answer for one draw: never this record's facts then.
  const sysId = String(facts.data?.pack?.sysId || '').toLowerCase();
  const answer = sysId && sysId !== String(record?.sysId || '').toLowerCase() ? null : facts.data;
  return needsNow({ glance: buildGlance({ record, header, headPhase, answer, now }), cards });
}

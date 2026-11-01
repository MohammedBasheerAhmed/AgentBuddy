import React, { useId, useState } from 'react';
import { AiBadge } from '../../../ui/primitives.jsx';
import { featureById, isFeatureAvailable } from '../../../../features/registry.js';
import { profilesOfFeature, shownFor } from '../../../../profiles/profiles.js';
import { MAX_ASK_CHARS, askProblem, clipAsk, withQuestion } from '../../../../features/packs/assist.js';
import { recordBlock } from '../actions/plan.js';

/**
 * "Ask about this ticket" (AI0.5): a question box. The question goes to the AI like everything else (permission, masking, the
 * preview, policy), as one more untrusted data part next to the ticket (src/features/packs/assist.js), never as prompt text. The
 * answer appears at the top of the answer area, with the question above it.
 *
 * props: assist (useAnswers), page, eff, record
 */
export default function AskBox({ assist, eff, record }) {
  const id = `ab-ask${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`; // (no colons: the id must work in a CSS selector)
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const feature = featureById('ask-ticket');
  // Switched off by the organisation (disabledFeatures: ask-ticket), outside the person's profiles, or a record no AI action may use
  // (a blocked table, HR content not allowed: the actions below say why, once; src/sidepanel/ticket/assist/actions/plan.js): no box.
  // The pipeline would refuse the run anyway; this only spares the person a question that cannot be sent.
  if (!feature || !isFeatureAvailable(feature, eff.policy) || !shownFor(profilesOfFeature(feature), eff) || recordBlock({ record, eff })) return null;

  const submit = (e) => {
    e.preventDefault();
    const why = askProblem(text);
    if (why) {
      setProblem(why);
      return;
    }
    const asked = withQuestion(feature, text);
    if (!asked) return;
    setProblem('');
    assist.run(asked, { meta: { question: clipAsk(text) } });
    setText('');
  };

  return (
    <form className="ab-ask" onSubmit={submit} aria-label="Ask about this ticket">
      <label className="ab-ask-label" htmlFor={`${id}-q`}>
        <AiBadge title="Your question and the ticket go to the AI, masked, after a preview." />
        <span>Ask about this ticket</span>
      </label>
      <div className="ab-ask-row">
        <input
          id={`${id}-q`}
          className="ab-input ab-ask-input"
          type="text"
          value={text}
          maxLength={MAX_ASK_CHARS}
          autoComplete="off"
          placeholder="When did the customer last reply?"
          aria-describedby={problem ? `${id}-why` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            if (problem) setProblem('');
          }}
        />
        <button type="submit" className="ab-btn ab-btn-sm" data-feature="ask-ticket" disabled={assist.busy}>
          Ask
        </button>
      </div>
      {problem && (
        <p className="ab-hint ab-ask-why" id={`${id}-why`} role="status">
          {problem}
        </p>
      )}
    </form>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { AiBadge } from '../../../ui/primitives.jsx';
import { Icon } from '../../../ui/icons.jsx';
import { featureById, isFeatureAvailable } from '../../../../features/registry.js';
import { profilesOfFeature, shownFor } from '../../../../profiles/profiles.js';
import { MAX_ASK_CHARS, askProblem, clipAsk, withQuestion } from '../../../../features/packs/assist.js';
import { recordBlock } from '../actions/plan.js';
import { reveal } from '../../ticketRail.js';
import { t } from '../../../../i18n/index.js';

/**
 * "Ask about this ticket" (AI0.5): a question box. The question goes to the AI like everything else (permission, masking, the
 * preview, policy), as one more untrusted data part next to the ticket (src/features/packs/assist.js), never as prompt text. The
 * answer appears at the top of the answer area, with the question above it.
 *
 * Since the focus layout (docs/focus-layout.md) the Ticket screen draws it only when it is asked for (All tools, 'ask:ticket'): then
 * at the top of AI Assist, with the focus in its box (`focusAt` changes with every request), and it stays for that record.
 *
 * props: assist (useAnswers), page, eff, record, focusAt (a time: put the focus in the box once it is drawn; 0: leave the focus be)
 */
export default function AskBox({ assist, eff, record, focusAt = 0 }) {
  const id = `ab-ask${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`; // (no colons: the id must work in a CSS selector)
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const form = useRef(null);
  const feature = featureById('ask-ticket');
  // Asked for: once the half it is in is on screen (the same draw that shows it), the box comes into view and takes the focus.
  useEffect(() => {
    if (!focusAt) return undefined;
    const timer = setTimeout(() => {
      const box = form.current;
      if (!box) return;
      reveal(box);
      box.querySelector('input')?.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [focusAt]);
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

  const hover = t('Your question and the ticket go to the AI, masked, after a preview.');
  return (
    <form className="ab-ask" ref={form} onSubmit={submit} aria-label={t('Ask about this ticket')}>
      <label className="ab-ask-label" htmlFor={`${id}-q`}>
        <AiBadge label="" title={hover} />
        <span>{t('Ask about this ticket')}</span>
      </label>
      <div className="ab-ask-row">
        <input
          id={`${id}-q`}
          className="ab-ask-input"
          type="text"
          value={text}
          maxLength={MAX_ASK_CHARS}
          autoComplete="off"
          placeholder={t('When did the customer last reply?')}
          aria-describedby={problem ? `${id}-why` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            if (problem) setProblem('');
          }}
        />
        <button type="submit" className="ab-ask-send" data-feature="ask-ticket" disabled={assist.busy} aria-label={t('Ask')} title={hover}>
          <Icon name="arrowUp" size={16} />
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

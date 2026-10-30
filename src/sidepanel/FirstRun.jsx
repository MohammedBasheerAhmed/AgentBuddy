import React from 'react';
import { STEP_WORD, firstRunSteps } from './firstRun.js';

/**
 * "Getting started" on a first run: the three steps in order, each one saying Done, Next or Later in words (colour only backs it
 * up), with a hint for the next one. The buttons that do the steps are where they always are (the setup help below, Settings at the
 * top of the panel); this list says where the person is. Renders nothing once the site is on and the AI can be used.
 *
 * props: page, lastSeen, aiReady
 */
export default function FirstRun({ page, lastSeen, aiReady }) {
  const { show, steps } = firstRunSteps({ page, lastSeen, aiReady });
  if (!show) return null;
  const at = steps.findIndex((s) => s.state === 'next');
  return (
    <section className="ab-card ab-firstrun" aria-labelledby="ab-firstrun-title">
      <h2 className="ab-h" id="ab-firstrun-title">Getting started</h2>
      {at >= 0 && <p className="ab-sub">Step {at + 1} of {steps.length}</p>}
      <ol className="ab-firstrun-steps">
        {steps.map((s, i) => (
          <li key={s.id} className={`ab-firstrun-step ab-firstrun-${s.state}`} aria-current={s.state === 'next' ? 'step' : undefined}>
            <span className="ab-firstrun-num" aria-hidden="true">{i + 1}</span>
            <span className="ab-firstrun-body">
              <span className="ab-firstrun-label">
                {s.label} <span className={`ab-tag ab-firstrun-tag-${s.state}`}>{STEP_WORD[s.state]}</span>
              </span>
              {s.state === 'next' && <span className="ab-hint">{s.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

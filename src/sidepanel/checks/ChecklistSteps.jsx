// The tick list of the fulfilment checklist. Pure drawing: the view owns the state and passes `onToggle`.
import React from 'react';

export function ProgressBar({ progress }) {
  return (
    <div className="ab-chk-progress">
      <div className="ab-chk-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Checklist progress">
        <div className="ab-chk-bar-fill" style={{ width: `${progress.percent}%` }} />
      </div>
      <span className="ab-chk-progress-text">{progress.text}</span>
    </div>
  );
}

export function StepList({ steps, done, onToggle }) {
  const ticked = new Set(done);
  return (
    <ul className="ab-chk-steps" aria-label="Steps">
      {steps.map((step) => {
        const on = ticked.has(step.id);
        return (
          <li key={step.id} className={`ab-chk-step${on ? ' ab-chk-step-done' : ''}`}>
            <label className="ab-check">
              <input type="checkbox" checked={on} onChange={(e) => onToggle(step, e.target.checked)} />
              <span>{step.text}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

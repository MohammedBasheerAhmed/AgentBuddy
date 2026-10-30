import React from 'react';
import { aiNeedsText } from './aiReady.js';

/**
 * "Add an AI key in Settings to use ..." (or "Your AI key is locked") with the way there: one button that opens Settings. A note that
 * only says what is wrong leaves the person to find Settings themselves; this is the next step, one click away.
 * Renders nothing when the AI can be used.
 *
 * props: eff, what (finishes "...to use <what>."), also (a second sentence: what works without a key)
 */
export default function AiKeyNote({ eff, what = 'these actions', also = '' }) {
  const text = aiNeedsText(eff, what);
  if (!text) return null;
  return (
    <div className="ab-note ab-note-warn ab-keynote">
      <p className="ab-keynote-text">
        {text}
        {also ? ` ${also}` : ''}
      </p>
      <button type="button" className="ab-btn ab-btn-sm" onClick={() => chrome.runtime.openOptionsPage()}>
        Open Settings
      </button>
    </div>
  );
}

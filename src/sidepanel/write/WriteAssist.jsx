import React from 'react';
import ErrorBoundary from '../ErrorBoundary.jsx';
import AiKeyNote from '../AiKeyNote.jsx';
import { AiBadge, CardFrame } from '../ui/primitives.jsx';
import RewritePanel from '../compose/RewritePanel.jsx';
import NotesPanel from '../compose/NotesPanel.jsx';
import { featureById } from '../../features/registry.js';
import { profilesOfFeature, shownFor } from '../../profiles/profiles.js';
import TicketLine, { useTicketHeader } from './TicketLine.jsx';
import { t, tm } from '../../i18n/index.js';

// The Write screen, AI Assist half: Rewrite (7 modes, AI23) and Notes to ticket (AI24). Masked text goes to the AI after a preview;
// every AI button carries the AI mark. The AI email drafts are offered on the Ticket screen now. Props: { page, eff, active }.
// Notes to ticket is for the work profiles that open tickets from a call or a chat (IT, customer service); "Show everything" shows it.
export default function WriteAssist({ page, eff, active }) {
  const header = useTicketHeader(page, active);
  const notes = shownFor(profilesOfFeature(featureById('notes-to-ticket')), eff);
  return (
    <div className="ab-write" data-half="assist">
      <TicketLine page={page} header={header} />
      <AiKeyNote eff={eff} what={tm('Rewrite and Notes to ticket')} />
      <CardFrame id="write-rewrite" title={t('Rewrite')} summary={t('Shorter, friendlier, plain, formal, translated')} actions={<AiBadge />}>
        <ErrorBoundary resetKey="rewrite">
          <RewritePanel page={page} eff={eff} showKeyNote={false} />
        </ErrorBoundary>
      </CardFrame>
      {notes && (
        <CardFrame id="write-notes" title={t('Notes to ticket')} summary={t('Rough notes into a new ticket')} actions={<AiBadge />}>
          <ErrorBoundary resetKey="notes">
            <NotesPanel page={page} eff={eff} showKeyNote={false} />
          </ErrorBoundary>
        </CardFrame>
      )}
    </div>
  );
}

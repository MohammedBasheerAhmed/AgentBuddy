import ErrorBoundary from '../ErrorBoundary.jsx';
import AiKeyNote from '../AiKeyNote.jsx';
import RewritePanel from '../compose/RewritePanel.jsx';
import NotesPanel from '../compose/NotesPanel.jsx';
import { featureById } from '../../features/registry.js';
import { profilesOfFeature, shownFor } from '../../profiles/profiles.js';
import TicketLine, { useTicketHeader } from './TicketLine.jsx';
import { Section } from './Section.jsx';
import { t, tm } from '../../i18n/index.js';

// The Write screen, AI Assist half: Rewrite (7 modes, AI23) and Notes to ticket (AI24), as two calm sections, each marked with the
// small AI spark. Masked text goes to the AI after a preview. The AI email drafts are offered on the Ticket screen now.
// Props: { page, eff, active }. Notes to ticket is for the work profiles that open tickets from a call or a chat (IT, customer
// service); "Show everything" shows it.
export default function WriteAssist({ page, eff, active }) {
  const header = useTicketHeader(page, active, Boolean(eff?.policy?.allowHrContent));
  const notes = shownFor(profilesOfFeature(featureById('notes-to-ticket')), eff);
  return (
    <div className="ab-write" data-half="assist">
      <TicketLine page={page} header={header} />
      <AiKeyNote eff={eff} what={tm('Rewrite and Notes to ticket')} />
      <Section id="write-rewrite" title={t('Rewrite')} ai>
        <ErrorBoundary resetKey="rewrite">
          <RewritePanel page={page} eff={eff} showKeyNote={false} />
        </ErrorBoundary>
      </Section>
      {notes && (
        <Section id="write-notes" title={t('Notes to ticket')} ai>
          <ErrorBoundary resetKey="notes">
            <NotesPanel page={page} eff={eff} showKeyNote={false} />
          </ErrorBoundary>
        </Section>
      )}
    </div>
  );
}

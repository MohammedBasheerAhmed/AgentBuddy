import { useState } from 'react';
import ErrorBoundary from '../ErrorBoundary.jsx';
import SnippetsPanel from '../compose/SnippetsPanel.jsx';
import SafeSendCheck from './SafeSendCheck.jsx';
import TicketLine, { useTicketHeader } from './TicketLine.jsx';
import { Section } from './Section.jsx';
import { WRITE_SECTIONS as S } from './railSections.js';

// The Write screen, Insights half (no AI; nothing leaves ServiceNow): the safe-to-send check on what the agent typed (N22) and the
// snippets (N21), as two calm sections under the line that names the ticket, each an item of the side rail (railSections.js). The
// email templates and "Which email fits" moved to the Ticket screen (N20). Props: { page, eff, active }.
export default function WriteInsights({ page, eff, active }) {
  const header = useTicketHeader(page, active, Boolean(eff?.policy?.allowHrContent));
  const [check, setCheck] = useState({ text: '', attention: '' });
  const [snippets, setSnippets] = useState('');
  return (
    <div className="ab-write" data-half="insights">
      <TicketLine page={page} header={header} />
      <Section rail={S.check} summary={check.text} attention={check.attention}>
        <ErrorBoundary resetKey="check">
          <SafeSendCheck page={page} eff={eff} active={active} onSummary={setCheck} />
        </ErrorBoundary>
      </Section>
      <Section rail={S.snippets} summary={snippets}>
        <ErrorBoundary resetKey="snippets">
          <SnippetsPanel page={page} eff={eff} active={active} onSummary={setSnippets} />
        </ErrorBoundary>
      </Section>
    </div>
  );
}

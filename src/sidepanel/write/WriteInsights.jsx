import React, { useState } from 'react';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { CardFrame } from '../ui/primitives.jsx';
import SnippetsPanel from '../compose/SnippetsPanel.jsx';
import SafeSendCheck from './SafeSendCheck.jsx';
import TicketLine, { useTicketHeader } from './TicketLine.jsx';
import { t } from '../../i18n/index.js';

// The Write screen, Insights half (no AI; nothing leaves ServiceNow): the safe-to-send check on what the agent typed (N22) and the
// snippets (N21). The email templates and "Which email fits" moved to the Ticket screen (N20). Props: { page, eff, active }.
// Both cards stay mounted while folded, so a half-written snippet or a pasted text survives.
export default function WriteInsights({ page, eff, active }) {
  const header = useTicketHeader(page, active, Boolean(eff?.policy?.allowHrContent));
  const [check, setCheck] = useState({ text: '', attention: '' });
  const [snippets, setSnippets] = useState('');
  return (
    <div className="ab-write" data-half="insights">
      <TicketLine page={page} header={header} />
      <CardFrame id="write-check" title={t('Safe-to-send check')} summary={check.text} attention={check.attention}>
        <ErrorBoundary resetKey="check">
          <SafeSendCheck page={page} eff={eff} active={active} onSummary={setCheck} />
        </ErrorBoundary>
      </CardFrame>
      <CardFrame id="write-snippets" title={t('Snippets')} summary={snippets}>
        <ErrorBoundary resetKey="snippets">
          <SnippetsPanel page={page} eff={eff} active={active} onSummary={setSnippets} />
        </ErrorBoundary>
      </CardFrame>
    </div>
  );
}

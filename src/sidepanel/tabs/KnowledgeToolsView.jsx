import { useState } from 'react';
import { useRun } from '../useRun.js';
import RunPanel from '../RunPanel.jsx';
import Tabs, { TabPanel } from '../Tabs.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import AiKeyNote from '../AiKeyNote.jsx';
import { isAiReady } from '../aiReady.js';
import DuplicatesPanel from '../knowledge/DuplicatesPanel.jsx';
import GapsPanel from '../knowledge/GapsPanel.jsx';

// The Knowledge section (C6, C7): tools for the people who look after the knowledge base. Works from any page of an enabled
// site. Both tools read with the person's own session and rank locally; the AI is only used for the drafts they ask for.
// Both tools stay mounted (hidden, not removed), each with its own AI run, so what one found and the draft it made survive a look at
// the other. (They used to share one run, and choosing the other tool threw the draft away.)
// props: { page, eff }

const TOOLS = [
  { id: 'duplicates', label: 'Duplicates', View: DuplicatesPanel },
  { id: 'gaps', label: 'Gaps', View: GapsPanel },
];

/** One tool with its own run: the preview and the answer show under the tool that asked for them. */
function Tool({ View, page, eff, aiReady }) {
  // Not about one record: every run supplies its own pack.
  const run = useRun({ page, eff, record: null });
  return (
    <>
      <View page={page} eff={eff} run={run} aiReady={aiReady} />
      <ErrorBoundary resetKey={run.active?.id || ''}>
        <RunPanel run={run} eff={eff} page={page} readingText="Reading from ServiceNow with your session…" />
      </ErrorBoundary>
    </>
  );
}

export default function KnowledgeToolsView({ page, eff }) {
  const [tool, setTool] = useState('duplicates');
  const aiReady = isAiReady(eff);

  return (
    <>
      <Tabs idBase="ab-kbt" label="Knowledge tools" tabs={TOOLS} value={tool} onChange={setTool} />
      <AiKeyNote eff={eff} what="the merged drafts and outlines" also="Finding duplicates and gaps needs no AI." />
      {TOOLS.map(({ id, View }) => (
        <TabPanel key={id} idBase="ab-kbt" id={id} hidden={tool !== id} className="ab-pane">
          <ErrorBoundary resetKey={id}>
            <Tool View={View} page={page} eff={eff} aiReady={aiReady} />
          </ErrorBoundary>
        </TabPanel>
      ))}
    </>
  );
}

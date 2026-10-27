import { useState } from 'react';
import { useRun } from '../useRun.js';
import RunPanel from '../RunPanel.jsx';
import Tabs, { TabPanel } from '../Tabs.jsx';
import { isAiReady } from '../aiReady.js';
import DuplicatesPanel from '../knowledge/DuplicatesPanel.jsx';
import GapsPanel from '../knowledge/GapsPanel.jsx';

// The Knowledge section (C6, C7): tools for the people who look after the knowledge base. Works from any page of an enabled
// site. Both tools read with the person's own session and rank locally; the AI is only used for the drafts they ask for.
// Both tools stay mounted (hidden, not removed) so the groups found in one survive a look at the other.
// props: { page, eff }

const TOOLS = [
  { id: 'duplicates', label: 'Duplicates', View: DuplicatesPanel },
  { id: 'gaps', label: 'Gaps', View: GapsPanel },
];

export default function KnowledgeToolsView({ page, eff }) {
  const [tool, setTool] = useState('duplicates');
  // Not about one record: every run supplies its own pack.
  const run = useRun({ page, eff, record: null });
  const aiReady = isAiReady(eff);

  return (
    <>
      <Tabs
        idBase="ab-kbt"
        label="Knowledge tools"
        tabs={TOOLS}
        value={tool}
        onChange={(id) => {
          run.reset(); // a draft belongs to the tool that asked for it
          setTool(id);
        }}
      />
      {!aiReady && <p className="ab-note ab-note-warn">Add an AI key in Settings to draft merged articles and outlines. Finding duplicates and gaps needs no AI.</p>}
      {TOOLS.map(({ id, View }) => (
        <TabPanel key={id} idBase="ab-kbt" id={id} hidden={tool !== id} className="ab-pane">
          <View page={page} eff={eff} run={run} aiReady={aiReady} />
        </TabPanel>
      ))}
      <RunPanel run={run} eff={eff} page={page} readingText="Reading from ServiceNow with your session…" />
    </>
  );
}

import { useState } from 'react';
import Tabs, { TabPanel } from '../Tabs.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import DuplicatesPanel from '../knowledge/DuplicatesPanel.jsx';
import GapsPanel from '../knowledge/GapsPanel.jsx';
import { GapOutline, MergeDraft } from '../knowledgeScreen/KnowledgeAssist.jsx';
import { useShared } from '../knowledgeScreen/shared.js';

// LEGACY: the Knowledge tools as one tabbed view, from before the Knowledge screen was split into Insights and AI Assist
// (src/sidepanel/knowledgeScreen). The panel no longer draws it; it is kept, built from the same parts, only while
// tests/panel-tabs.test.js still looks at its tab list. Remove both together.
// props: { page, eff }

const TOOLS = [
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'gaps', label: 'Gaps' },
];

export default function KnowledgeToolsView({ page, eff }) {
  const [tool, setTool] = useState('duplicates');
  const [, setMerge] = useShared(page, 'merge');
  const [, setGaps] = useShared(page, 'gaps');
  return (
    <>
      <Tabs idBase="ab-kbt" label="Knowledge tools" tabs={TOOLS} value={tool} onChange={setTool} />
      <TabPanel idBase="ab-kbt" id="duplicates" hidden={tool !== 'duplicates'} className="ab-pane">
        <ErrorBoundary resetKey="duplicates">
          <h2 className="ab-h">Find near-duplicate articles</h2>
          <DuplicatesPanel page={page} active={tool === 'duplicates'} onCompared={setMerge} />
          <MergeDraft page={page} eff={eff} />
        </ErrorBoundary>
      </TabPanel>
      <TabPanel idBase="ab-kbt" id="gaps" hidden={tool !== 'gaps'} className="ab-pane">
        <ErrorBoundary resetKey="gaps">
          <h2 className="ab-h">Articles to write</h2>
          <GapsPanel page={page} active={tool === 'gaps'} onFound={setGaps} />
          <GapOutline page={page} eff={eff} />
        </ErrorBoundary>
      </TabPanel>
    </>
  );
}

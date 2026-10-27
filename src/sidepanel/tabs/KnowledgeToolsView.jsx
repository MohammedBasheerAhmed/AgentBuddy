import { useState } from 'react';
import { useRun } from '../useRun.js';
import RunPanel from '../RunPanel.jsx';
import DuplicatesPanel from '../knowledge/DuplicatesPanel.jsx';
import GapsPanel from '../knowledge/GapsPanel.jsx';

// The Knowledge section (C6, C7): tools for the people who look after the knowledge base. Works from any page of an enabled
// site. Both tools read with the person's own session and rank locally; the AI is only used for the drafts they ask for.
// props: { page, eff }

const TOOLS = [
  { id: 'duplicates', label: 'Duplicates', View: DuplicatesPanel },
  { id: 'gaps', label: 'Gaps', View: GapsPanel },
];

export default function KnowledgeToolsView({ page, eff }) {
  const [tool, setTool] = useState('duplicates');
  // Not about one record: every run supplies its own pack.
  const run = useRun({ page, eff, record: null });
  const aiReady = Boolean(eff.apiKey) || Boolean(eff.values.providedApiKey) || ['ollama'].includes(eff.values.provider);
  const Current = TOOLS.find((t) => t.id === tool).View;

  return (
    <>
      <div className="ab-row" role="tablist" aria-label="Knowledge tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tool === t.id}
            className={`ab-btn ab-btn-sm${tool === t.id ? ' ab-btn-primary' : ''}`}
            onClick={() => {
              run.reset();
              setTool(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!aiReady && <p className="ab-note ab-note-warn">Add an AI key in Settings to draft merged articles and outlines. Finding duplicates and gaps needs no AI.</p>}
      <Current key={tool} page={page} eff={eff} run={run} aiReady={aiReady} />
      <RunPanel run={run} eff={eff} page={page} readingText="Reading from ServiceNow with your session…" />
    </>
  );
}

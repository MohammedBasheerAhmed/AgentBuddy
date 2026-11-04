import { useEffect, useState } from 'react';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { CardFrame } from '../ui/primitives.jsx';
import DuplicatesPanel from '../knowledge/DuplicatesPanel.jsx';
import GapsPanel from '../knowledge/GapsPanel.jsx';
import { shownFor } from '../../profiles/profiles.js';
import SearchCard from './SearchCard.jsx';
import { placeOf, useShared } from './shared.js';
import { KM_PROFILES } from './KnowledgeAssist.jsx';
import { t } from '../../i18n/index.js';

// The Knowledge screen, Insights half (no AI; nothing leaves ServiceNow). Knowledge search (N23) for everyone; for knowledge managers
// also the duplicate article finder (N18) and the knowledge-gap radar (N19), folded until opened (they read only when opened). What
// those two find is handed to the AI Assist half in memory (shared.js). Props: { page, eff, active }.
export default function KnowledgeInsights({ page, eff, active }) {
  const km = shownFor(KM_PROFILES, eff);
  const [open, setOpen] = useState({ duplicates: false, gaps: false });
  const [searchSummary, setSearchSummary] = useState('');
  // The tools start over on another tab or instance (placeOf); the search's line in the card's title goes with its results.
  const place = placeOf(page);
  useEffect(() => {
    setSearchSummary('');
  }, [place]);
  const [, setMerge] = useShared(page, 'merge');
  const [, setGaps] = useShared(page, 'gaps');
  const toggle = (id) => (next) => setOpen((o) => ({ ...o, [id]: next }));
  return (
    <div className="ab-kbx" data-half="insights">
      <CardFrame id="kb-search" title={t('Knowledge search')} summary={searchSummary}>
        <ErrorBoundary resetKey="search">
          <SearchCard page={page} active={active} onSummary={setSearchSummary} />
        </ErrorBoundary>
      </CardFrame>
      {km && (
        <CardFrame id="kb-duplicates" title={t('Duplicate articles')} open={open.duplicates} onToggle={toggle('duplicates')}>
          <ErrorBoundary resetKey="duplicates">
            <DuplicatesPanel page={page} active={active && open.duplicates} onCompared={setMerge} />
          </ErrorBoundary>
        </CardFrame>
      )}
      {km && (
        <CardFrame id="kb-gaps" title={t('Articles to write')} open={open.gaps} onToggle={toggle('gaps')}>
          <ErrorBoundary resetKey="gaps">
            <GapsPanel page={page} active={active && open.gaps} onFound={setGaps} />
          </ErrorBoundary>
        </CardFrame>
      )}
    </div>
  );
}

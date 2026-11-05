import { useState } from 'react';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { t } from '../../i18n/index.js';
import { HalfPanel, HalfRule, HalfSwitch } from '../ui/primitives.jsx';
import { aiOffByPolicy } from '../../profiles/profiles.js';
import { AiSkippedNote, destinationOf, useHalf } from './shellParts.jsx';
import { RailSectionsContext, goToSection, useRailPublish, useSectionRegistry } from './SideRail.jsx';

/**
 * A screen with an Insights half and, when it has one and the organisation allows AI, an AI Assist half (TRACKER.md 2.1).
 * The half that was opened stays mounted (hidden) so what was typed or found in it survives a look at the other half.
 *
 * The side rail (SideRail.jsx) lists the sections of the half on show: each section registers itself with useRailSection, so the rail
 * holds exactly what is drawn for this person, in the page's order. A click brings that section into view (and opens it if it folds).
 *
 * props: screen (id), label (the screen's name: the rail's title when the screen has one half), Insights, Assist (component or null),
 *        page, eff, active (the screen is on show), extra (more props for both)
 */
export default function ScreenView({ screen, label = '', Insights, Assist = null, page, eff, active, extra = {} }) {
  // A screen's AI half may only be for some profiles (Knowledge's is for knowledge managers): `Assist.shownFor(eff)` says so.
  const hasAssist = Boolean(Assist) && !aiOffByPolicy(eff) && (typeof Assist.shownFor !== 'function' || Assist.shownFor(eff));
  const [half, setHalf] = useHalf(screen, eff);
  const shown = hasAssist ? half : 'insights';
  const [visited, setVisited] = useState(() => new Set([shown]));
  const idBase = `ab-${screen}-half`;
  const choose = (next) => {
    setHalf(next);
    setVisited((v) => (v.has(next) ? v : new Set([...v, next])));
  };
  const mounted = (h) => visited.has(h) || shown === h;
  const skipped = Boolean(eff.values?.aiSkipped);

  // The rail: the sections of the half on show; the one last chosen is marked.
  const [insightsRegistry, insightsSections] = useSectionRegistry();
  const [assistRegistry, assistSections] = useSectionRegistry();
  const [current, setCurrent] = useState('');
  const sections = shown === 'assist' ? assistSections : insightsSections;
  const title = hasAssist ? (shown === 'assist' ? t('AI Assist') : t('Insights')) : label;
  useRailPublish(
    screen,
    {
      title,
      items: sections.map((s) => ({
        id: s.id,
        label: s.label,
        icon: s.icon,
        attention: s.attention,
        current: current === `${shown}:${s.id}`,
        onSelect: () => {
          setCurrent(`${shown}:${s.id}`);
          goToSection(s);
        },
      })),
    },
    active
  );

  return (
    <div className="ab-pane">
      {hasAssist && <HalfSwitch idBase={idBase} value={shown} onChange={choose} assistNote={skipped ? t('off') : ''} />}
      {hasAssist && <HalfRule half={shown} destination={destinationOf(eff)} />}
      <HalfPanel idBase={idBase} half="insights" hidden={shown !== 'insights'} switched={hasAssist}>
        {mounted('insights') && (
          <RailSectionsContext.Provider value={insightsRegistry}>
            <ErrorBoundary resetKey={`${screen}:insights`}>
              <Insights page={page} eff={eff} active={active && shown === 'insights'} {...extra} />
            </ErrorBoundary>
          </RailSectionsContext.Provider>
        )}
      </HalfPanel>
      {hasAssist && (
        <HalfPanel idBase={idBase} half="assist" hidden={shown !== 'assist'}>
          {mounted('assist') &&
            (skipped ? (
              <AiSkippedNote />
            ) : (
              <RailSectionsContext.Provider value={assistRegistry}>
                <ErrorBoundary resetKey={`${screen}:assist`}>
                  <Assist page={page} eff={eff} active={active && shown === 'assist'} {...extra} />
                </ErrorBoundary>
              </RailSectionsContext.Provider>
            ))}
        </HalfPanel>
      )}
    </div>
  );
}

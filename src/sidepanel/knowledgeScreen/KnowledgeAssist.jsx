import { useEffect, useState } from 'react';
import { useRun } from '../useRun.js';
import RunPanel from '../RunPanel.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import AiKeyNote from '../AiKeyNote.jsx';
import { isAiReady } from '../aiReady.js';
import { AiBadge, EmptyNote } from '../ui/primitives.jsx';
import { MoreRows, Section } from '../write/Section.jsx';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import { gapPack, mergePack } from '../../knowledge/parts.js';
import { shownFor } from '../../profiles/profiles.js';
import { shown as shownText } from '../../reports/shown.js';
import { useShared } from './shared.js';
import { KNOWLEDGE_SECTIONS as S } from './railSections.js';
import { isolate, t, tm, tn } from '../../i18n/index.js';

// The Knowledge screen, AI Assist half (knowledge managers): draft ONE article out of the duplicate group compared in Insights (AI26)
// and an outline for a knowledge-gap topic found there (AI27). Each has its own run, so the answer of one survives a look at the
// other; every AI button carries the AI mark. "Suggest improvements" (AI25) works on an article that is open (Ticket screen, AI
// Assist), because it reads the article form and inserts into it; a search result opens the article for that.

export const KM_PROFILES = Object.freeze(['km']);
const pct = (ratio) => `${Math.round(ratio * 100)}%`;

/** The AI button of a card: filled (the one main step) or outlined, always with the AI mark. */
function AiButton({ primary, disabled, onClick, children }) {
  return (
    <button type="button" className={primary ? 'ab-btn ab-btn-ai' : 'ab-btn ab-btn-ai-quiet'} disabled={disabled} title={t('Sends masked text to the AI you chose, after a preview.')} onClick={onClick}>
      <AiBadge label="" title="" /> {children}
    </button>
  );
}

export function MergeDraft({ page, eff, primary = true }) {
  const run = useRun({ page, eff, record: null }); // not about one record: the run supplies its own pack
  const [merge] = useShared(page, 'merge');
  const feature = featureById('kb-merge-draft');
  const available = Boolean(feature) && isFeatureAvailable(feature, eff.policy);
  const aiReady = isAiReady(eff);

  // A newer group compared in Insights: the draft of the old one is not about it.
  useEffect(() => {
    run.reset();
    // run.reset is stable; only the group's identity matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merge?.at]);

  if (!merge?.texts) {
    return <EmptyNote>{t('Find duplicate articles in Insights, pick a group and compare its text. The group then shows up here.')}</EmptyNote>;
  }
  const { texts } = merge;
  const articles = Array.isArray(texts.articles) ? texts.articles : [];
  const best = (texts.pairs || []).reduce((top, p) => (!top || p.containment > top.containment ? p : top), null);
  return (
    <>
      <ul className="ab-rows ab-wk-rows ab-kb-articles" aria-label={t('Articles in the group')}>
        {articles.map((a) => (
          <li key={a.sysId} className="ab-row">
            <span className="ab-row-main ab-row-title"><span className="ab-kbx-number">{a.number}</span> {a.title}</span>
          </li>
        ))}
      </ul>
      {best && <p className="ab-hint">{t('{a} and {b} share {percent} of the shorter text.', { a: isolate(best.a), b: isolate(best.b), percent: pct(best.containment) })}</p>}
      {!available && <p className="ab-note ab-note-warn">{t('Your organisation has switched the merge draft off.')}</p>}
      <p className="ab-hint">{t('Hidden details show as placeholders such as [EMAIL_1]: put the real ones back before you publish.')}</p>
      <div className="ab-row">
        <AiButton primary={primary} disabled={!aiReady || !available || run.busy || articles.length < 2} onClick={() => run.run(feature, { getPack: async () => mergePack(articles, texts.access || [], texts.people || []) })}>
          {t('Draft a merged article')}
        </AiButton>
      </div>
      <ErrorBoundary resetKey={run.active?.id || ''}>
        <RunPanel run={run} eff={eff} page={page} readingText={t('Getting ready…')} />
      </ErrorBoundary>
    </>
  );
}

export function GapOutline({ page, eff, primary = true }) {
  const run = useRun({ page, eff, record: null });
  const [gaps] = useShared(page, 'gaps');
  const [chosen, setChosen] = useState('');
  const feature = featureById('kb-gap-outline');
  const available = Boolean(feature) && isFeatureAvailable(feature, eff.policy);
  const aiReady = isAiReady(eff);
  const clusters = Array.isArray(gaps?.clusters) ? gaps.clusters : [];
  const topic = clusters.find((c) => c.id === chosen) || clusters[0] || null;

  useEffect(() => {
    run.reset();
    setChosen('');
    // run.reset is stable; a new list of topics starts over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaps?.at]);

  if (!clusters.length) {
    return <EmptyNote>{t('Find topics under "Articles to write" in Insights first. They then show up here.')}</EmptyNote>;
  }
  return (
    <>
      <fieldset className="ab-fieldset ab-kbx-topics">
        <legend className="ab-label">{t('Topic to outline')}</legend>
        <MoreRows
          items={clusters}
          keep={(c) => c.id === topic?.id}
          className="ab-kbx-topic-rows"
          render={(c) => (
            <li key={c.id} className="ab-row ab-kbx-topic">
              <label className="ab-check">
                <input type="radio" name="ab-gap-topic" value={c.id} checked={topic?.id === c.id} onChange={() => setChosen(c.id)} />
                <span className="ab-row-main">
                  <span className="ab-row-title">{shownText(c.label)}</span>
                  <span className="ab-row-sub">{tn(c.count, '{n} ticket', '{n} tickets')}</span>
                </span>
              </label>
            </li>
          )}
        />
      </fieldset>
      {!available && <p className="ab-note ab-note-warn">{t('Your organisation has switched the outline off.')}</p>}
      <p className="ab-hint">{t('Only the topic words, the counts, the category and the item are sent: no ticket text.')}</p>
      <div className="ab-row">
        <AiButton primary={primary} disabled={!aiReady || !available || run.busy || !topic} onClick={() => run.run(feature, { getPack: async () => gapPack(topic, { days: gaps.days }) })}>
          {t('Draft an article outline')}
        </AiButton>
      </div>
      <ErrorBoundary resetKey={run.active?.id || ''}>
        <RunPanel run={run} eff={eff} page={page} readingText={t('Getting ready…')} />
      </ErrorBoundary>
    </>
  );
}

export default function KnowledgeAssist({ page, eff }) {
  const [merge] = useShared(page, 'merge');
  if (!shownFor(KM_PROFILES, eff)) {
    return <EmptyNote>{t('Merging duplicate articles and outlining missing ones are for knowledge managers. Add the Knowledge manager work profile in Settings to use them.')}</EmptyNote>;
  }
  const mergeReady = Boolean(merge?.texts);
  return (
    <div className="ab-kbx" data-half="assist">
      <AiKeyNote eff={eff} what={tm('the merged drafts and outlines')} />
      <Section rail={S.merge} summary={mergeReady ? t('A compared group is ready') : ''} ai>
        <ErrorBoundary resetKey="merge">
          <MergeDraft page={page} eff={eff} primary />
        </ErrorBoundary>
      </Section>
      <Section rail={S.outline} ai>
        <ErrorBoundary resetKey="outline">
          <GapOutline page={page} eff={eff} primary={!mergeReady} />
        </ErrorBoundary>
      </Section>
    </div>
  );
}

/** Whether the Knowledge screen has an AI Assist half for this person: knowledge managers only (the shell asks, see index.js). */
KnowledgeAssist.shownFor = (eff) => shownFor(KM_PROFILES, eff);

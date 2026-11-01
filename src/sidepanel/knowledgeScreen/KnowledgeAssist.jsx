import React, { useEffect, useState } from 'react';
import { useRun } from '../useRun.js';
import RunPanel from '../RunPanel.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import AiKeyNote from '../AiKeyNote.jsx';
import { isAiReady } from '../aiReady.js';
import { AiBadge, CardFrame, EmptyNote, ShowMore } from '../ui/primitives.jsx';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import { gapPack, mergePack } from '../../knowledge/parts.js';
import { shownFor } from '../../profiles/profiles.js';
import { useShared } from './shared.js';

// The Knowledge screen, AI Assist half (knowledge managers): draft ONE article out of the duplicate group compared in Insights (AI26)
// and an outline for a knowledge-gap topic found there (AI27). Each has its own run, so the answer of one survives a look at the
// other; every AI button carries the AI mark. "Suggest improvements" (AI25) works on an article that is open (Ticket screen, AI
// Assist), because it reads the article form and inserts into it; a search result opens the article for that.

export const KM_PROFILES = Object.freeze(['km']);
const pct = (ratio) => `${Math.round(ratio * 100)}%`;
const aiTitle = 'Sends masked text to the AI you chose, after a preview.';

/** The AI button of a card: filled (the one main step) or outlined, always with the AI mark. */
function AiButton({ primary, disabled, onClick, children }) {
  return (
    <button type="button" className={primary ? 'ab-btn ab-wk-aibtn' : 'ab-btn ab-wk-aibtn-quiet'} disabled={disabled} title={aiTitle} onClick={onClick}>
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
    return <EmptyNote>Find duplicate articles in Insights, pick a group and compare its text. The group then shows up here.</EmptyNote>;
  }
  const { texts } = merge;
  const articles = Array.isArray(texts.articles) ? texts.articles : [];
  const best = (texts.pairs || []).reduce((top, p) => (!top || p.containment > top.containment ? p : top), null);
  return (
    <>
      <ul className="ab-kb-articles">
        {articles.map((a) => (
          <li key={a.sysId}>
            <span><span className="ab-record-number">{a.number}</span> {a.title}</span>
          </li>
        ))}
      </ul>
      {best && <p className="ab-hint">{best.a} and {best.b} share {pct(best.containment)} of the shorter text.</p>}
      {!available && <p className="ab-note ab-note-warn">Your organisation has switched the merge draft off.</p>}
      <p className="ab-hint">Hidden details show as placeholders such as [EMAIL_1]: put the real ones back before you publish.</p>
      <div className="ab-row">
        <AiButton primary={primary} disabled={!aiReady || !available || run.busy || articles.length < 2} onClick={() => run.run(feature, { getPack: async () => mergePack(articles, texts.access || [], texts.people || []) })}>
          {feature?.title || 'Draft a merged article'}
        </AiButton>
      </div>
      <ErrorBoundary resetKey={run.active?.id || ''}>
        <RunPanel run={run} eff={eff} page={page} readingText="Getting ready…" />
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
    return <EmptyNote>Find topics under "Articles to write" in Insights first. They then show up here.</EmptyNote>;
  }
  return (
    <>
      <fieldset className="ab-fieldset ab-kbx-topics">
        <legend className="ab-label">Topic to outline</legend>
        <ShowMore
          items={clusters}
          className="ab-list"
          render={(c) => (
            <label key={c.id} className="ab-check">
              <input type="radio" name="ab-gap-topic" value={c.id} checked={topic?.id === c.id} onChange={() => setChosen(c.id)} />
              <span>
                {c.label} <span className="ab-hint">({c.count} ticket{c.count === 1 ? '' : 's'})</span>
              </span>
            </label>
          )}
        />
      </fieldset>
      {!available && <p className="ab-note ab-note-warn">Your organisation has switched the outline off.</p>}
      <p className="ab-hint">Only the topic words, the counts, the category and the item are sent: no ticket text.</p>
      <div className="ab-row">
        <AiButton primary={primary} disabled={!aiReady || !available || run.busy || !topic} onClick={() => run.run(feature, { getPack: async () => gapPack(topic, { days: gaps.days }) })}>
          {feature?.title || 'Draft an article outline'}
        </AiButton>
      </div>
      <ErrorBoundary resetKey={run.active?.id || ''}>
        <RunPanel run={run} eff={eff} page={page} readingText="Getting ready…" />
      </ErrorBoundary>
    </>
  );
}

export default function KnowledgeAssist({ page, eff }) {
  const [merge] = useShared(page, 'merge');
  if (!shownFor(KM_PROFILES, eff)) {
    return <EmptyNote>Merging duplicate articles and outlining missing ones are for knowledge managers. Add the Knowledge manager work profile in Settings to use them.</EmptyNote>;
  }
  const mergeReady = Boolean(merge?.texts);
  return (
    <div className="ab-kbx" data-half="assist">
      <AiKeyNote eff={eff} what="the merged drafts and outlines" />
      <CardFrame id="kb-merge" title="Merge duplicate articles" summary={mergeReady ? 'A compared group is ready' : ''} actions={<AiBadge />}>
        <ErrorBoundary resetKey="merge">
          <MergeDraft page={page} eff={eff} primary />
        </ErrorBoundary>
      </CardFrame>
      <CardFrame id="kb-outline" title="Outline a missing article" actions={<AiBadge />}>
        <ErrorBoundary resetKey="outline">
          <GapOutline page={page} eff={eff} primary={!mergeReady} />
        </ErrorBoundary>
      </CardFrame>
    </div>
  );
}

/** Whether the Knowledge screen has an AI Assist half for this person: knowledge managers only (the shell asks, see index.js). */
KnowledgeAssist.shownFor = (eff) => shownFor(KM_PROFILES, eff);

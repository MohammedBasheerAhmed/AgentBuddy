import React, { useMemo } from 'react';
import { ShowMore } from '../../ui/primitives.jsx';
import { stepsThatWorked } from '../../../insights/steps.js';
import { useKnowledge, useLookalikes } from './data.js';
import { useReport } from './useInsight.js';
import { ItemLink, QuietButton, ReadState } from './bits.jsx';
import { t, tn } from '../../../i18n/index.js';

// N12, steps that worked before: what fixed the solved look-alikes and what the matching articles say to do, as one list, best match
// first. The words are colleagues' own, cut to the first sentences. (AI next best actions are in AI Assist.)

export default function StepsCard({ page, eff, record, active, setSummary }) {
  const look = useLookalikes({ page, record, eff, active });
  const kb = useKnowledge({ page, record, eff, active });
  const lookOk = look.data && !look.error;
  const kbOk = kb.data && !kb.error;
  const { items } = useMemo(() => stepsThatWorked({ lookalikes: lookOk ? look.data.hits : [], articles: kbOk ? kb.data.hits : [] }), [look.data, kb.data, lookOk, kbOk]);
  const done = Boolean(look.data || look.error) && Boolean(kb.data || kb.error);
  useReport(setSummary, done && (lookOk || kbOk) ? (items.length ? tn(items.length, '{n} fix from solved tickets and articles', '{n} fixes from solved tickets and articles') : t('None found')) : '');

  return (
    <>
      {!items.length && <ReadState state={look.data ? kb : look} what={t('solved tickets and articles')} onRetry={() => (look.error ? look.reload() : kb.reload())} />}
      {items.length > 0 && (
        <ShowMore
          items={items}
          render={(x) => (
            <div key={`${x.kind}:${x.sysId || x.number}`} className="ab-ins-step">
              <ItemLink page={page} item={{ table: x.table, sysId: x.sysId, number: x.number, short_description: x.title }} line={x.kind === 'article' ? t('Article') : t('Solved ticket')} />
              <p className="ab-ins-steptext">{x.fix}</p>
            </div>
          )}
        />
      )}
      {done && !items.length && (lookOk || kbOk) && <p className="ab-hint">{t('No solved ticket or article with written steps matches this ticket yet.')}</p>}
      {done && (
        <div className="ab-ins-foot">
          <QuietButton
            onClick={() => {
              look.reload();
              kb.reload();
            }}
          >
            {t('Refresh')}
          </QuietButton>
        </div>
      )}
    </>
  );
}

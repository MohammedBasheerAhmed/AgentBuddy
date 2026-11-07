import { useMemo, useState } from 'react';
import { ShowMore } from '../../ui/primitives.jsx';
import { problemFacts, stepsThatWorked } from '../../../insights/steps.js';
import { errorCodesOf } from '../../../insights/errorCodes.js';
import { solvedBy } from '../../../insights/solvedBy.js';
import { agoText } from '../../../insights/time.js';
import { parseSnTime } from '../../../context/util.js';
import { allowSensitiveOf, read, useKnowledge, useLookalikes, useTicketFacts } from './data.js';
import { readFully, recordKey, useInsight, useReport } from './useInsight.js';
import { ItemLink, Notes, QuietButton, ReadState } from './bits.jsx';
import { isolate, t, tm, tn } from '../../../i18n/index.js';

// N12, steps that worked before: what fixed the solved look-alikes and what the matching articles say to do, as one list, best match
// first. The words are colleagues' own, cut to the first sentences. (AI next best actions are in AI Assist.)
//
// Round 4 (docs/round4.md), two facts inside it, no new card: the error code the ticket quotes, with one search of the articles and
// solved tickets that mention it; and "solved before by", the group most solved look-alikes went to. Its one line carries both
// ("Error 0x800CCC0F found · solved 3 times before by Service Desk – Email"), which leads the "Find the fix" row. No AI, nothing sent
// anywhere: the names are shown to the agent only.

const LIST_AGE = 300000; // as the other lists of the Ticket screen (data.js)

const CODE_LABEL = {
  short_description: tm('Error code in the short description'),
  description: tm('Error code in the description'),
  notes: tm('Error code in the notes'),
};

const solvedAgo = (utc) => {
  const at = parseSnTime(utc);
  return Number.isFinite(at) ? agoText(Math.max(0, Date.now() - at)) : '';
};

/**
 * "Error code in the description: 0x800CCC0F" and its one search: published articles and solved tickets of this table that mention
 * it, listed in place under it. The search runs only when the agent asks for it; the answer stays in panel memory for the record.
 */
function ErrorCodeFact({ page, eff, record, table, codes, active }) {
  const terms = codes.map((c) => c.search);
  const key = `${recordKey(page, record)}|fixCodes|${terms.join(',')}`;
  // Asked for these codes: a ticket read again with another code waits for the button again.
  const [askedFor, setAskedFor] = useState('');
  const asked = askedFor === key;
  const search = useInsight({
    key,
    load: () => read(page.tabId, 'fixCodeSearch', { table, sysId: record.sysId, codes: terms, allowSensitive: allowSensitiveOf(eff) }),
    active: asked && Boolean(active),
    maxAgeMs: LIST_AGE,
  });
  const several = codes.length > 1;
  const shown = codes.map((c) => isolate(c.code)).join(t(', '));
  const nameOf = new Map(codes.map((c) => [c.search.toLowerCase(), c.code]));
  const mentions = (hit) =>
    several && Array.isArray(hit.codes) && hit.codes.length ? t('Mentions {code}', { code: hit.codes.map((s) => isolate(nameOf.get(String(s).toLowerCase()) || s)).join(t(', ')) }) : '';
  const data = search.data && !search.error ? search.data : null;
  const hits = data
    ? [
        ...(Array.isArray(data.articles) ? data.articles : []).map((a) => ({ ...a, kind: 'article', table: 'kb_knowledge' })),
        ...(Array.isArray(data.tickets) ? data.tickets : []).map((x) => ({ ...x, kind: 'ticket' })),
      ]
    : [];
  const articleCount = hits.filter((h) => h.kind === 'article').length;

  return (
    <div className="ab-fix-fact" data-fact="error-code">
      <dl className="ab-fix-kv">
        <dt>{several ? t('Error codes in the ticket') : t(CODE_LABEL[codes[0].where] || CODE_LABEL.description)}</dt>
        <dd className="ab-fix-code">{shown}</dd>
      </dl>
      <div className="ab-ins-foot">
        <QuietButton onClick={() => (asked ? search.reload() : setAskedFor(key))} disabled={search.phase === 'loading'}>
          {t('Search articles and solved tickets')}
        </QuietButton>
      </div>
      <div className="ab-fix-results" aria-live="polite">
        {(asked || search.data) && <ReadState state={search} what={t('solved tickets and articles')} onRetry={search.reload} />}
        {data && hits.length > 0 && (
          <>
            <p className="ab-hint">{t('Articles: {articles}. Solved tickets: {tickets}.', { articles: articleCount, tickets: hits.length - articleCount })}</p>
            <ShowMore
              items={hits}
              limit={4}
              render={(h) =>
                h.kind === 'article' ? (
                  <ItemLink key={`kb:${h.sysId}`} page={page} item={{ table: 'kb_knowledge', sysId: h.sysId, number: h.number, short_description: h.short_description }} line={[t('Article'), h.knowledgeBase, mentions(h)].filter(Boolean).join(' · ')} extra={h.excerpt} />
                ) : (
                  <ItemLink key={`t:${h.sysId}`} page={page} item={{ table: h.table, sysId: h.sysId, number: h.number, short_description: h.short_description }} line={[t('Solved ticket'), h.state, solvedAgo(h.solvedUtc), mentions(h)].filter(Boolean).join(' · ')} extra={h.fix} />
                )
              }
            />
          </>
        )}
        {data && !hits.length && (readFully(data.access) ? <p className="ab-hint">{t('No article or solved ticket found that mentions {code}.', { code: shown })}</p> : <p className="ab-hint">{t('Nothing found that mentions {code}, but some could not be checked.', { code: shown })}</p>)}
        {data && <Notes access={data.access} />}
      </div>
    </div>
  );
}

export default function StepsCard({ page, eff, record, active, setSummary, setAttention }) {
  const look = useLookalikes({ page, record, eff, active });
  const kb = useKnowledge({ page, record, eff, active });
  // The ticket's own words (the Glance's read, shared: nothing more is asked of the instance) for the error codes it quotes.
  const ticket = useTicketFacts({ page, record, eff, active });
  const pack = ticket.data?.pack || null;
  const codes = useMemo(() => errorCodesOf(pack), [pack]);
  // A problem's own workaround and known-error mark come with the same read (F14).
  const problem = useMemo(() => problemFacts(pack), [pack]);
  const lookOk = look.data && !look.error;
  const kbOk = kb.data && !kb.error;
  const { items } = useMemo(() => stepsThatWorked({ lookalikes: lookOk ? look.data.hits : [], articles: kbOk ? kb.data.hits : [] }), [look.data, kb.data, lookOk, kbOk]);
  const solved = solvedBy(lookOk ? look.data.hits : []);
  const done = Boolean(look.data || look.error) && Boolean(kb.data || kb.error);
  // "None found" needs both searches to have seen everything: the solved tickets and the articles (R-08, R-09).
  const allSeen = Boolean(lookOk) && Boolean(kbOk) && readFully(look.data?.access, kb.data?.access);

  // The line: the facts when there are some ("Error 0x800CCC0F found · solved 3 times before by Service Desk – Email"), else the list.
  const codeLine = codes.length ? t('Error {code} found', { code: isolate(codes[0].code) }) : '';
  const solvedLine = solved.enough ? (codeLine ? solved.after : solved.line) : '';
  const problemLine = problem ? (problem.workaround ? t('Workaround recorded') : problem.knownError ? t('Known error') : '') : '';
  const factLine = [problemLine, codeLine, solvedLine].filter(Boolean).join(' · ');
  const listLine = done && (lookOk || kbOk) ? (items.length ? tn(items.length, '{n} fix from solved tickets and articles', '{n} fixes from solved tickets and articles') : allSeen ? t('None found') : t('Could not check everything')) : '';
  useReport(setSummary, factLine || listLine);
  // A fix that worked before is good news; a code or a group to ask is plain information; none of it is nothing to report.
  useReport(setAttention, done && (lookOk || kbOk) ? (items.length || problem?.workaround ? 'ok' : factLine || !allSeen ? '' : 'clear') : '');

  return (
    <>
      {problem && (
        <dl className="ab-fix-kv ab-fix-fact" data-fact="workaround">
          <dt>{problem.knownError ? t('Known error, workaround') : t('Workaround')}</dt>
          <dd>{problem.workaround || (problem.hidden ? t('Not shown to you') : t('None recorded yet'))}</dd>
        </dl>
      )}
      {codes.length > 0 && <ErrorCodeFact page={page} eff={eff} record={record} table={pack?.table || record.table} codes={codes} active={active} />}
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
      {done && !items.length && (lookOk || kbOk) && <p className="ab-hint">{allSeen ? t('No solved ticket or article with written steps matches this ticket yet.') : t('No solved ticket or article with written steps found, but some could not be checked.')}</p>}
      {done && !allSeen && (lookOk || kbOk) && <Notes access={[...(look.data?.access || []), ...(kb.data?.access || [])]} />}
      {solved.enough && (
        <dl className="ab-fix-kv ab-fix-fact" data-fact="solved-by">
          <dt>{t('Solved before by')}</dt>
          <dd>{solved.fact}</dd>
        </dl>
      )}
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

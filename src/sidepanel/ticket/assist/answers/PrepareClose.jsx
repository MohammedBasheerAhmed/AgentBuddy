import { useId } from 'react';
import { SafeText } from '../../../../render/SafeText.jsx';
import RecordLink from '../../../RecordLink.jsx';
import { AiBadge } from '../../../ui/primitives.jsx';
import { Tag } from '../../../checks/Bits.jsx';
import { plainNote } from '../../../plainAccess.js';
import { t } from '../../../../i18n/index.js';

const TAGS = { warn: () => [t('Look at this'), 'warn'], info: () => [t('Note'), ''] };

/**
 * The body of a "Prepare to close" answer (round 4): its sections (prepareClose.js closeSections), each saying where it came from.
 * Only the notes are the AI's, shown through SafeText like every model answer; the resolve check, the close code and the repeat are
 * ServiceNow data, shown as plain text. "Open INC..." opens that ticket in a new tab: the ticket being closed is never replaced.
 *
 * props: sections, page
 */
export default function PrepareCloseBody({ sections, page }) {
  const base = `ab-close${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <div className="ab-output ab-close-answer">
      {sections.map((s) => (
        <div key={s.id} className={`ab-close-sec${s.ai ? ' is-ai' : ''}`} data-section={s.id} role="group" aria-labelledby={`${base}-${s.id}`}>
          <p className="ab-close-sec-head" id={`${base}-${s.id}`}>
            <span className="ab-close-sec-title">{s.title}</span>
            <span className="ab-close-sec-src">
              {s.ai && <AiBadge label="" title={t('Written by AI. It can be wrong: check it before you use it.')} />}
              {s.source}
            </span>
          </p>
          {s.id === 'notes' ? (
            s.text ? <SafeText text={s.text} /> : <p className="ab-hint">{t('The AI wrote no notes. Try again, or write them yourself.')}</p>
          ) : (
            <>
              {Array.isArray(s.items) && s.items.length > 0 && (
                <ul className="ab-close-findings">
                  {s.items.map((item) => {
                    const [word, tone] = (TAGS[item.status] || TAGS.info)();
                    return (
                      <li key={item.id} data-status={item.status}>
                        <span className="ab-chk-head">
                          <Tag tone={tone}>{word}</Tag> <span className="ab-chk-item-main">{item.title}</span>
                        </span>
                        {item.hint && <span className="ab-hint">{plainNote(item.hint)}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {s.text && <p className={`ab-close-sec-text${s.quiet ? ' is-quiet' : ''}`}>{s.text}</p>}
              {s.link && (
                <RecordLink page={page} item={{ table: s.link.table, sysId: s.link.sysId }} newTab className="ab-btn ab-btn-sm ab-close-open">
                  {t('Open {number}', { number: s.link.number })}
                </RecordLink>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

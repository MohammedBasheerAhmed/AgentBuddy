import { useId } from 'react';
import { Icon } from '../ui/icons.jsx';
import { showCard } from './cards/bits.jsx';
import { t } from '../../i18n/index.js';

/**
 * "Needs you now", under the ticket at the top of the Ticket screen: the items src/sidepanel/ticket/needsNow.js chose, the most urgent
 * first. Each is a round mark, one sentence, and one quiet line under it: a detail, or a link to the Insights card it came from. The
 * caller draws nothing when there are no items.
 *
 * props: items (needsNow), onShowCard(cardId) (the shell's way to bring a card of the Insights half forward)
 */
export default function NeedsNow({ items, onShowCard }) {
  const titleId = `ab-needs${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <section className="ab-needs" aria-labelledby={titleId}>
      <h3 className="ab-needs-title" id={titleId}>
        {t('Needs you now')}
      </h3>
      <ul className="ab-needs-list">
        {items.map((item) => (
          <li key={item.id} className={`ab-needs-item ab-needs-${item.level}`} data-need={item.id}>
            <span className="ab-needs-icon" aria-hidden="true">
              <Icon name={item.icon} size={15} />
            </span>
            <span className="ab-needs-main">
              <span className="ab-needs-text">{item.text}</span>
              {item.sub && <span className="ab-needs-sub">{item.sub}</span>}
              {item.card && (
                <button type="button" className="ab-needs-link" onClick={() => showCard(item.card, onShowCard)}>
                  {item.id === 'outage' ? t('Show the tickets') : t('See {card}', { card: item.cardTitle })}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

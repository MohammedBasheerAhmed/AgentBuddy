import { isolate, t } from '../../i18n/index.js';

// The Knowledge screen's sections as the side rail lists them (docs/rail-layout.md B), in the page's order within each half. The
// sections draw their heading from `label`, so the rail always says what the heading says; `icon` is a name of
// src/sidepanel/ui/iconPaths.js. Each section registers itself (write/Section.jsx `rail`): the duplicate finder and the gap radar are
// in the rail only for knowledge managers, the articles for the open ticket only while a ticket is open (without one it is a line with
// no heading, not a section). tests/screens-rail.test.js checks the ids, the icons and the Arabic of every label.
export const KNOWLEDGE_SECTIONS = Object.freeze({
  ticket: {
    id: 'kb-ticket',
    half: 'insights',
    icon: 'ticket',
    label: ({ number = '' } = {}) => (number ? t('Articles for {number}', { number: isolate(number) }) : t('Articles for the open ticket')),
  },
  search: { id: 'kb-search', half: 'insights', icon: 'search', label: () => t('Knowledge search') },
  duplicates: { id: 'kb-duplicates', half: 'insights', icon: 'file', label: () => t('Duplicate articles') },
  gaps: { id: 'kb-gaps', half: 'insights', icon: 'filePlus', label: () => t('Articles to write') },
  merge: { id: 'kb-merge', half: 'assist', icon: 'file', label: () => t('Merge duplicate articles') },
  outline: { id: 'kb-outline', half: 'assist', icon: 'filePlus', label: () => t('Outline a missing article') },
});

import { t } from '../../i18n/index.js';

// The Write screen's sections as the side rail lists them (docs/rail-layout.md B), in the page's order within each half. The sections
// draw their heading from `label`, so the rail always says what the heading says; `icon` is a name of src/sidepanel/ui/iconPaths.js.
// Each section registers itself (Section.jsx `rail`), so one that is not drawn for this person is not in the rail either.
// tests/screens-rail.test.js checks that the ids are unique, the icons can be drawn and every label has its Arabic.
export const WRITE_SECTIONS = Object.freeze({
  check: { id: 'write-check', half: 'insights', icon: 'shield', label: () => t('Safe-to-send check') },
  snippets: { id: 'write-snippets', half: 'insights', icon: 'clipboard', label: () => t('Snippets') },
  rewrite: { id: 'write-rewrite', half: 'assist', icon: 'pen', label: () => t('Rewrite') },
  notes: { id: 'write-notes', half: 'assist', icon: 'ticket', label: () => t('Notes to ticket') },
});

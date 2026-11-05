import { t } from '../../i18n/index.js';

// The My work screen's sections as the side rail lists them (docs/rail-layout.md B), in the page's order. My work has no AI half. The
// cards draw their title from `label`, so the rail always says what the card says; `icon` is a name of src/sidepanel/ui/iconPaths.js.
// Each card registers itself (reports/RailCard.jsx): the approvals are in the rail only when there are some, as on the screen.
// tests/screens-rail.test.js checks that the ids are unique, the icons can be drawn and every label has its Arabic.
export const MYWORK_SECTIONS = Object.freeze({
  queue: { id: 'mywork-queue', half: 'insights', icon: 'inbox', label: () => t('My queue') },
  approvals: { id: 'mywork-approvals', half: 'insights', icon: 'checkCircle', label: () => t('Approvals waiting on you') },
  followUps: { id: 'mywork-followups', half: 'insights', icon: 'reply', label: () => t('Follow-ups due') },
  groups: { id: 'mywork-groups', half: 'insights', icon: 'users', label: () => t('Unassigned in my groups') },
});

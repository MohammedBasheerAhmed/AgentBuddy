// Extra tabs on a record, beyond Actions and Related. A tab shows only for the kinds it lists. Its view receives
//   { page, eff, record, header, run, aiReady }
// where `run` comes from useRun() (src/sidepanel/useRun.js): call run.run(feature, { getPack }) to run an AI feature through
// the firewall; RecordView renders the preview and the result for you (<RunPanel>).
import RequestExplainerView from './tabs/RequestExplainerView.jsx';
import QualityGateView from './tabs/QualityGateView.jsx';
import KnowledgeRecordView from './tabs/KnowledgeRecordView.jsx';
import ChatRecordView from './tabs/ChatRecordView.jsx';
import FulfilmentChecklistView from './tabs/FulfilmentChecklistView.jsx';

export const RECORD_TABS = [
  { id: 'request', label: 'Request', kinds: ['request', 'requested_item', 'catalog_task'], View: RequestExplainerView },
  { id: 'check', label: 'Check', kinds: ['incident', 'problem', 'request', 'requested_item', 'catalog_task', 'case', 'task'], View: QualityGateView },
  { id: 'article', label: 'Article', kinds: ['knowledge'], View: KnowledgeRecordView },
  { id: 'checklist', label: 'Checklist', kinds: ['catalog_task', 'requested_item'], View: FulfilmentChecklistView },
  { id: 'chat', label: 'Chat', kinds: ['chat'], View: ChatRecordView },
];

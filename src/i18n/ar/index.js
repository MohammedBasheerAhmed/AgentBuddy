// The Arabic texts, one file per part of the panel (see src/i18n/index.js). Keys are the exact English texts; the style and the
// words to use for ServiceNow terms are in docs/i18n-arabic.md.
import { AR_REPORTS } from './reports.js';
import { AR_TICKET } from './ticket.js';
import { AR_WRITE } from './write.js';
import { AR_SHELL } from './shell.js';
import { AR_LANGUAGE } from './language.js';
import { AR_POLICY } from './policy.js';
import { AR_BAR } from './bar.js';
import { AR_PALETTE } from './palette.js';
import { AR_FORMATS } from './formats.js';
import { AR_FOCUS } from './focus.js';
import { AR_CALLER } from './caller.js';
import { AR_LANGRULES } from './langrules.js';
import { AR_READS } from './reads.js';
import { AR_FIX } from './fix.js';
import { AR_UNDERSTAND } from './understand.js';
import { AR_CLOSE } from './close.js';
import { AR_MYWORK } from './mywork.js';
import { AR_REPLY } from './reply.js';
import { AR_GATE } from './gate.js';
import { AR_LABELS } from './labels.js';
import { AR_LINKS } from './links.js';
import { AR_NOTES } from './notes.js';
import { AR_HONEST } from './honest.js';
import { AR_ROLES } from './roles.js';
import { AR_FIT } from './fit.js';
import { AR_WORKSPACE } from './workspace.js';
import { AR_STATES } from './states.js';
import { AR_FINISH } from './finish.js';
import { AR_CATALOG } from './catalog.js';
import { AR_LEAD } from './lead.js';
import { withKm } from './km.js';
import { withFinish2 } from './finish2.js';
import { withWords } from './words.js';

// withWords adds the plain-words texts (words.js) and drops the English texts they replaced.
export const AR = withKm(withFinish2(withWords({ ...AR_LANGUAGE, ...AR_POLICY, ...AR_BAR, ...AR_PALETTE, ...AR_FORMATS, ...AR_SHELL, ...AR_TICKET, ...AR_WRITE, ...AR_REPORTS, ...AR_FOCUS, ...AR_CALLER, ...AR_LANGRULES, ...AR_READS, ...AR_FIX, ...AR_UNDERSTAND, ...AR_CLOSE, ...AR_MYWORK, ...AR_REPLY, ...AR_GATE, ...AR_LABELS, ...AR_LINKS, ...AR_NOTES, ...AR_HONEST, ...AR_ROLES, ...AR_FIT, ...AR_WORKSPACE, ...AR_STATES, ...AR_FINISH, ...AR_CATALOG, ...AR_LEAD })));
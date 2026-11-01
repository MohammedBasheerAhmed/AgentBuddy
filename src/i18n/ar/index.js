// The Arabic texts, one file per part of the panel (see src/i18n/index.js). Keys are the exact English texts; the style and the
// words to use for ServiceNow terms are in docs/i18n-arabic.md.
import { AR_REPORTS } from './reports.js';
import { AR_TICKET } from './ticket.js';
import { AR_WRITE } from './write.js';
import { AR_SHELL } from './shell.js';
import { AR_LANGUAGE } from './language.js';
import { AR_POLICY } from './policy.js';

export const AR = Object.freeze({ ...AR_LANGUAGE, ...AR_POLICY, ...AR_SHELL, ...AR_TICKET, ...AR_WRITE, ...AR_REPORTS });

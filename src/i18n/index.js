// The words of the panel, in the language the person chose (English or Arabic): see core.js for how it works and the rules for a text.
// Importing this file registers the whole Arabic catalogue (src/i18n/ar/index.js); a script that needs only a few texts imports
// core.js and registers its own (the bar on the ServiceNow page: src/content/bar.js).
import { registerCatalogue } from './core.js';
import { AR } from './ar/index.js';

registerCatalogue('ar', AR);

export * from './core.js';

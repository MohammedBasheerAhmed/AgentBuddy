// Saving one action's format to the person's settings. Reads the stored formats again first, so two windows (the Settings page and the
// side panel) saving different actions do not undo each other. `format` null removes the person's own entry for the action (the
// organisation's standard format, if it publishes one, is used again); STANDARD_CHOICE (formats.js) keeps the action's own format.
import { cleanFormats } from './formats.js';
import { loadSettings, saveSettings } from '../lib/storage.js';

export async function saveFormat(id, format) {
  const stored = cleanFormats((await loadSettings()).formats);
  if (format) stored[id] = format;
  else delete stored[id];
  await saveSettings({ formats: stored });
}

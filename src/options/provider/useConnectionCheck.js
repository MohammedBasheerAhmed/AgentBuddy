// "Test connection" and "Load models" in the AI provider section, with their Cancel. The checks (the organisation's rules, the address,
// the privacy mode), the browser permission, the firewall and the call are all in src/lib/connectionCheck.js: the same refusals as every
// run, made before the browser is asked for permission. This only runs them from the click and says on the section what happened.
import { useEffect, useRef } from 'react';
import { testConnection, loadModelList } from '../../lib/connectionCheck.js';
import { cleanKey } from '../../lib/keyStore.js';
import { t, tn, isolate } from '../../i18n/index.js';

const TEST_TIMEOUT_MS = 45000; // "Test connection" asks for one word; it should not keep the page waiting for minutes

/**
 * @param {object} p
 * @param {object} p.eff the effective settings (with the saved key, apiKey)
 * @param {string} p.typedKey what is in the key box, saved or not
 * @param {(busy: string) => void} p.setBusy ProviderSection's busy state: 'test' or 'models' while one runs, '' after
 * @param {(status: object|null) => void} p.setStatus ProviderSection's status line
 * @param {(patch: object) => Promise<boolean>} p.change ProviderSection's save, false when the browser did not save
 * @returns {{ test: () => Promise<void>, loadModels: () => Promise<void>, cancel: () => void }}
 */
export function useConnectionCheck({ eff, typedKey, setBusy, setStatus, change }) {
  const v = eff.values;
  const running = useRef(null); // the AbortController of a test or a list that is running
  // Leaving the page (or another provider) stops a test or a list that is still running.
  useEffect(() => () => running.current?.abort(), [v.provider]);

  // The key that a test uses: one typed in the box and not saved yet is the one the person wants tested; otherwise the saved one.
  const keyForUse = () => cleanKey(typedKey) || eff.apiKey;

  // Runs a test or a list with a Cancel; the browser permission is asked first, straight from the click.
  async function withCancel(kind, work) {
    setStatus(null);
    setBusy(kind);
    const controller = new AbortController();
    running.current = controller;
    try {
      await work(controller.signal);
    } catch (err) {
      if (err?.code === 'CANCELLED') setStatus({ kind: 'warn', text: t('Cancelled.') });
      else setStatus({ kind: 'danger', text: err?.message || t('Something went wrong. Try again; if it keeps happening, tell your administrator.') });
    } finally {
      if (running.current === controller) running.current = null;
      setBusy('');
    }
  }

  const test = () =>
    withCancel('test', async (signal) => {
      const reply = await testConnection({ values: v, policy: eff.policy, apiKey: keyForUse(), signal, timeoutMs: TEST_TIMEOUT_MS });
      const typed = cleanKey(typedKey);
      const unsaved = typed && typed !== eff.apiKey ? ` ${t('This key is not saved yet: press Save key to keep it.')}` : '';
      const cut = reply.note ? ` ${reply.note}` : '';
      setStatus({ kind: 'ok', text: `${t('Connected. The model answered: {answer}', { answer: isolate(reply.answer) })}${unsaved}${cut}` });
    });

  // The models the server offers, so one can be picked instead of typed. Only the key goes out (to the address chats go to).
  const loadModels = () =>
    withCancel('models', async (signal) => {
      const ids = await loadModelList({ values: v, policy: eff.policy, apiKey: keyForUse(), signal });
      if (!(await change({ modelLists: { ...v.modelLists, [v.provider]: ids } }))) return;
      setStatus({ kind: 'ok', text: t('Found {models}. Pick one from the list, or type a name.', { models: tn(ids.length, '{n} model', '{n} models') }) });
    });

  const cancel = () => running.current?.abort();

  return { test, loadModels, cancel };
}

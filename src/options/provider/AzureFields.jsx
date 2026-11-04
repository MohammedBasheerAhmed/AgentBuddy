// The Azure OpenAI fields of the AI provider section: the resource, the API form and version, the deployment(s). Shown in place of the
// address and model fields when the provider is Azure OpenAI. A whole Azure address pasted into the resource box is split into its
// parts (src/lib/aiUsage.js splitAzureAddress).
import { useState } from 'react';
import { validateBaseUrl, splitAzureAddress, azureOptions, isAzureHost, AZURE_DEFAULT_API_VERSION } from '../../lib/aiUsage.js';
import { parseDeployments } from '../policyNotes.js';
import { DraftInput, FieldError, Locked, describedBy } from '../fields.jsx';
import { Icon } from '../../sidepanel/ui/icons.jsx';
import { t } from '../../i18n/index.js';

/**
 * props:
 *   eff          the effective settings
 *   change(patch) -> Promise   ProviderSection's save (says itself when the browser did not save)
 *   model        the deployment in use
 *   setStatus    ProviderSection's status line
 */
export function AzureFields({ eff, change, model, setStatus }) {
  const v = eff.values;
  const az = azureOptions(v.azure);
  const typed = v.baseUrls?.azure || '';
  const [addressError, setAddressError] = useState('');
  const check = validateBaseUrl(typed);
  const host = check.ok && check.url ? new URL(check.url).host : '';
  const lockedAddress = Boolean(eff.locked.baseUrl);
  const otherIds = Array.isArray(v.modelLists?.azure) ? v.modelLists.azure : [];
  const [deploymentsError, setDeploymentsError] = useState('');

  async function saveAddress(text) {
    setAddressError('');
    const split = splitAzureAddress(text);
    if (!split) {
      await change({ baseUrls: { ...v.baseUrls, azure: text } });
      return;
    }
    if (!split.ok) {
      setAddressError(split.error);
      return;
    }
    // A whole address was pasted: each part goes to its own field, and the address keeps no path or query of its own.
    await change({
      baseUrls: { ...v.baseUrls, azure: split.base },
      ...(split.deployment ? { models: { ...v.models, azure: split.deployment } } : {}),
      azure: { ...(v.azure || {}), ...(split.form ? { form: split.form } : {}), ...(split.apiVersion ? { apiVersion: split.apiVersion } : {}) },
    });
    setStatus({ kind: 'ok', text: t('The address you pasted was split into its parts: the resource address, the form, the version and the deployment below.') });
  }

  async function saveDeployments(text) {
    const { ids, bad } = parseDeployments(text);
    setDeploymentsError(bad.length ? t('Not a deployment name Azure allows: {names}. Use letters, digits, - _ and .', { names: bad.join(', ') }) : '');
    await change({ modelLists: { ...v.modelLists, azure: ids } });
  }

  const addressProblem = addressError || (!check.ok ? check.error : '');
  return (
    <>
      <div className="ab-field">
        <label className="ab-label" htmlFor="baseurl">{t('Resource address (required)')}</label>
        <DraftInput
          id="baseurl"
          className="ab-input ab-mono"
          value={typed}
          readOnly={lockedAddress}
          placeholder={t('https://your-resource.openai.azure.com')}
          aria-invalid={addressProblem ? true : undefined}
          aria-describedby={describedBy('baseurl-hint', addressProblem && 'baseurl-error')}
          onSave={saveAddress}
        />
        <FieldError id="baseurl-error" text={addressProblem} />
        <span className="ab-hint" id="baseurl-hint">
          {t('The "Endpoint" of your Azure OpenAI resource, from "Keys and Endpoint" in the Azure portal. You can also paste a whole address that ends in ?api-version=...: it is split into the fields below.')}
          {host && !isAzureHost(host) ? ` ${t('This is not an Azure OpenAI address (…openai.azure.com). That is fine for a company gateway in front of Azure.')}` : ''}
        </span>
        <Locked why={eff.locked.baseUrl} />
      </div>

      {/* Technical details, folded: most resources use the recommended form. Open when the older form is chosen or its version is wrong. */}
      <details className="ab-more ab-set-fold" open={az.form === 'deployment' && !az.apiVersionOk}>
        <summary>{t('Technical details: how Agent Buddy calls Azure')}<Icon name="chevronDown" className="ab-chevron" /></summary>
        <div className="ab-field">
          <label className="ab-label" htmlFor="azure-form">{t('How to call it')}</label>
          <select id="azure-form" className="ab-select" value={az.form} aria-describedby="azure-form-hint" onChange={(e) => change({ azure: { ...(v.azure || {}), form: e.target.value } })}>
            <option value="v1">{t('v1 API (recommended): /openai/v1')}</option>
            <option value="deployment">{t('Deployment address with an api-version (older resources)')}</option>
          </select>
          <span className="ab-hint" id="azure-form-hint">
            {az.form === 'v1'
              ? t('Sends to <resource>/openai/v1/chat/completions with the deployment name as the model.')
              : t('Sends to <resource>/openai/deployments/<deployment>/chat/completions?api-version=<version>.')}
          </span>
        </div>

        {az.form === 'deployment' && (
          <div className="ab-field">
            <label className="ab-label" htmlFor="azure-version">{t('API version')}</label>
            <DraftInput
              id="azure-version"
              className="ab-input ab-mono"
              value={v.azure?.apiVersion || ''}
              placeholder={AZURE_DEFAULT_API_VERSION}
              aria-invalid={!az.apiVersionOk ? true : undefined}
              aria-describedby={describedBy('azure-version-hint', !az.apiVersionOk && 'azure-version-error')}
              onSave={(text) => change({ azure: { ...(v.azure || {}), apiVersion: text.trim() } })}
            />
            <FieldError id="azure-version-error" text={az.apiVersionOk ? '' : t('An API version looks like 2024-10-21 or 2025-04-01-preview.')} />
            <span className="ab-hint" id="azure-version-hint">{t('Leave empty for {AZURE_DEFAULT_API_VERSION}. Use the version your administrator gave you if it differs.', { AZURE_DEFAULT_API_VERSION })}</span>
          </div>
        )}
      </details>

      <div className="ab-field">
        <label className="ab-label" htmlFor="model">{t('Deployment name (required)')}</label>
        <DraftInput
          id="model"
          className="ab-input ab-mono"
          value={model}
          disabled={Boolean(eff.locked.model)}
          aria-describedby="model-hint"
          onSave={(text) => change({ models: { ...v.models, azure: text.trim() } })}
        />
        <span className="ab-hint" id="model-hint">
          {t('The name of the deployment in Azure AI Foundry, under Deployments (it can differ from the model\'s name). Azure does not give a key a list of deployments, so there is no "Load models" here.')}
        </span>
        <Locked why={eff.locked.model} />
      </div>

      {!eff.locked.model && (
        <div className="ab-field">
          <label className="ab-label" htmlFor="azure-deployments">{t('Other deployments to switch between (optional)')}</label>
          <DraftInput
            id="azure-deployments"
            className="ab-input ab-mono"
            value={otherIds.join(', ')}
            placeholder={t('gpt-5-mini, gpt-5')}
            aria-invalid={deploymentsError ? true : undefined}
            aria-describedby={describedBy('azure-deployments-hint', deploymentsError && 'azure-deployments-error')}
            onSave={saveDeployments}
          />
          <FieldError id="azure-deployments-error" text={deploymentsError} />
          <span className="ab-hint" id="azure-deployments-hint">{t('Separate names with commas. They appear in the model switch at the top of the side panel.')}</span>
        </div>
      )}
    </>
  );
}

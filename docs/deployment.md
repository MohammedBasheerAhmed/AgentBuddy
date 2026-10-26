# Agent Buddy: deployment and managed policy

## Recommended profile for a security-approved rollout

| Setting | Value | Why |
|---|---|---|
| `allowedInstances` | your instances, e.g. `["https://acme.service-now.com", "https://acme-test.service-now.com"]` | People cannot turn it on for any other site. |
| `aiProvider` + `aiBaseUrl` | `openai` + your internal gateway or Azure OpenAI address | One approved AI endpoint; people cannot point it elsewhere. |
| `allowedModels` | the models the organisation has approved | |
| `piiMode` | `strict` (or `local-only` with an internal model) | Raises the floor; people can only go stricter. |
| `previewMode` | `first` or `always` | People see exactly what leaves the browser. |
| `keyStorage` | `session` | The key is memory-only and cleared when the browser closes. Or supply the key through your gateway instead of per-person keys. |
| `allowHrContent` | `false` (default) | HR case free text is never sent. |
| `disabledFeatures` | `["coaching-snapshot"]` until HR/works-council sign-off | |
| `blockedTables` / `blockedFields` | tables or fields that must never be read or sent | |
| `tokenBudgetPerDay` | an agreed daily cap | Cost and abuse control. |

All keys are optional and are described in `managed_schema.json`. A person can always choose a stricter option than the policy; never
a looser one. Locked settings show "Set by your organisation" in Settings.

## Chrome and Edge policy samples

Replace `<EXTENSION_ID>` with the id shown at `chrome://extensions` (or `edge://extensions`) for your installed build.

Windows registry (Chrome): `HKLM\SOFTWARE\Policies\Google\Chrome\3rdparty\extensions\<EXTENSION_ID>\policy`
Windows registry (Edge): `HKLM\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\<EXTENSION_ID>\policy`

macOS / Linux managed-policy file (Chrome: `/etc/opt/chrome/policies/managed/agentbuddy.json`):

```json
{
  "3rdparty": {
    "extensions": {
      "<EXTENSION_ID>": {
        "allowedInstances": ["https://acme.service-now.com"],
        "aiProvider": "openai",
        "aiBaseUrl": "https://ai-gateway.corp.example/v1",
        "allowedModels": ["gpt-5-mini"],
        "piiMode": "strict",
        "previewMode": "first",
        "keyStorage": "session",
        "allowHrContent": false,
        "disabledFeatures": ["coaching-snapshot"],
        "blockedTables": [],
        "blockedFields": [],
        "tokenBudgetPerDay": 200000,
        "auditExport": true
      }
    }
  }
}
```

## Installing for everyone

1. Build: `npm ci && npm run build`. The `dist/` folder is the extension.
2. Pilot: load `dist/` unpacked in a test profile.
3. Rollout: publish through the organisation's controlled channel. Either a private/unlisted store listing, or force-install with
   `ExtensionInstallForcelist` pointing at a self-hosted update manifest. Pin the version; review each update.
4. Browser access to a site is still granted per site by the person (or the browser's own enterprise rules): the manifest declares
   no static host permissions. A build that bakes in your instance hosts so no prompt appears is planned.

## What to tell the security team

See `docs/security.md` (controls, limits, threat model) and the tests that enforce each claim (`npm test`). The three tests to read
first: `tests/manifest.test.js` (permission snapshot), `tests/readonly.test.js` (no writes to ServiceNow), `tests/seal.test.js`
(nothing reaches the AI without the PII firewall).

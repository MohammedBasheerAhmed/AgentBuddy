import { FORMAT_FEATURES, orgFormatOf, resolveFormat } from '../formats/formats.js';
import { saveFormat } from '../formats/saveFormat.js';
import FormatEditor from '../formats/FormatEditor.jsx';
import { featureById, isFeatureAvailable } from '../features/registry.js';
import { SectionHead } from './fields.jsx';
import { Icon } from '../sidepanel/ui/icons.jsx';
import { t, tm, t as tr } from '../i18n/index.js';

/**
 * Settings, AI Assist: how each AI action writes its answer (TRACKER R11). The actions whose sections can be named come first (the
 * ticket summary, the hand-off brief, the discussion catch-up), then the others, which take extra instructions. A format is saved at once
 * to this person's settings (settings.formats, by src/formats/saveFormat.js); an organisation can publish a standard one, or lock one,
 * through its policy. The same editor is under each action in the side panel.
 */

// (English texts marked with tm(); each is shown with tr() at the moment it is used)
const STATE_TEXT = {
  locked: tm('Set by your organisation'),
  org: tm("Your organisation's format"),
  mine: tm('Your format'),
  standard: tm('Your choice: the standard format'),
  default: '',
};

/** The actions whose format can change, as the policy leaves them (the section is on the page, and in the menu beside it, when any). */
export const formatItems = (eff) => FORMAT_FEATURES.map((spec) => ({ spec, feature: featureById(spec.id) })).filter((x) => x.feature && isFeatureAvailable(x.feature, eff.policy));

export function FormatsSection({ eff, reload }) {
  const mine = eff.values.formats || {};
  const org = eff.policy?.orgFormats || [];
  const items = formatItems(eff);
  const groups = [
    { id: 'sections', title: t('Summaries and notes you can lay out'), items: items.filter((x) => x.spec.kind === 'sections') },
    { id: 'extras', title: t('Other AI actions: extra instructions'), items: items.filter((x) => x.spec.kind === 'extras') },
  ].filter((g) => g.items.length);
  if (!items.length) return null;
  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-formats">
      <SectionHead id="h-formats" title={t('How AI answers are written')}>
        {t('Choose the sections, the style and the length of a summary, or add a few sentences of your own to any action. You can read exactly what is sent, and the rules about facts, privacy and customers always stay on.')}
      </SectionHead>
      {groups.map((g) => (
        <div key={g.id} className="ab-fmt-group" role="group" aria-label={g.title}>
          <h3 className="ab-fmt-grouphead">{g.title}</h3>
          {g.items.map(({ feature }) => {
            const { source } = resolveFormat(feature.id, mine, org);
            // The organisation's format whatever is in force, so the editor can offer it back after the person chose another one.
            const inherited = orgFormatOf(feature.id, org);
            return (
              <details key={feature.id} className="ab-more ab-set-fold ab-fmt-item" data-feature={feature.id}>
                <summary>
                  <span className="ab-fmt-title">{tr(feature.title)}</span>
                  {source !== 'default' && <span className={`ab-fmt-state ab-fmt-state-${source}`}>{tr(STATE_TEXT[source])}</span>}
                  <Icon name="chevronDown" className="ab-chevron" />
                </summary>
                <p className="ab-hint">{tr(feature.description)}</p>
                <FormatEditor
                  feature={feature}
                  saved={mine[feature.id] || null}
                  source={source}
                  inherited={inherited}
                  idBase={`fmt-${feature.id}`}
                  onSave={async (next) => {
                    await saveFormat(feature.id, next);
                    // Read back before the editor says "Saved.", so the mark next to the title ("Your format") already agrees with it.
                    await reload();
                  }}
                />
              </details>
            );
          })}
        </div>
      ))}
    </section>
  );
}

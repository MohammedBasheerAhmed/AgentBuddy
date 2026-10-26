// Placeholder allocation and re-hydration.
//
// The same value always gets the same placeholder ([EMAIL_1] stays [EMAIL_1] for every mention and every request of one
// firewall instance), and the map from placeholder back to the real value lives ONLY in this closure: it has no
// property to read, no toJSON, and nothing here logs. The firewall instance owns the tokenizer and dies with it.
//
// Re-hydration is deliberately dumb and safe: one pass, exact `[LABEL_n]` tokens only, and only tokens this instance
// handed out. A model that writes [PERSON_9] (which we never issued) or "[person_1]" gets the text back unchanged, and a
// value that itself looks like a placeholder is never re-processed, so nothing is substituted twice.

// Which placeholder label each finding kind uses.
const LABELS = Object.freeze({
  PERSON: 'PERSON',
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  CARD: 'CARD',
  IBAN: 'IBAN',
  NATIONAL_ID: 'ID',
  EMPLOYEE_ID: 'ID',
  IP: 'IP',
  MAC: 'MAC',
  DOB: 'DOB',
  ADDRESS: 'ADDRESS',
  SECRET: 'SECRET',
  URL_CREDENTIALS: 'SECRET',
});

export function labelFor(kind) {
  return LABELS[kind] || 'DATA';
}

const PLACEHOLDER = /\[([A-Z]{2,12})_(\d{1,6})\]/g;

// Normalised comparison: two spellings of the same value share one placeholder.
function normalise(label, value) {
  const v = String(value);
  switch (label) {
    case 'EMAIL':
    case 'IP':
      return v.trim().toLowerCase();
    case 'PHONE':
      return (v.trim().startsWith('+') ? '+' : '') + v.replace(/\D/g, '');
    case 'CARD':
    case 'IBAN':
    case 'ID':
    case 'MAC':
      return v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    case 'SECRET':
      return v; // secrets are case-sensitive and compared exactly
    default:
      return v.replace(/\s+/g, ' ').trim().toLowerCase();
  }
}

export function createTokenizer() {
  const forward = new Map(); // "LABEL|normalised" -> placeholder
  const reverse = new Map(); // placeholder -> original text
  const counters = new Map(); // label -> last number

  return {
    /**
     * The placeholder for a finding. A PERSON finding that carries an `entity` (the dictionary's person id) is keyed by it,
     * so "Abel", "Tuter" and "Abel Tuter" are all the same [PERSON_n], and rehydrates to the person's name from the record.
     * @param {{kind: string, value: string, entity?: string, canonical?: string}} finding
     */
    placeholderFor(finding) {
      const label = labelFor(finding.kind);
      const key = `${label}|${finding.entity ? `entity:${finding.entity}` : normalise(label, finding.value)}`;
      const known = forward.get(key);
      if (known) return known;
      const n = (counters.get(label) || 0) + 1;
      counters.set(label, n);
      const placeholder = `[${label}_${n}]`;
      forward.set(key, placeholder);
      reverse.set(placeholder, finding.canonical || finding.value);
      return placeholder;
    },

    /**
     * Defuse text that already looks like one of our placeholders, so ticket text cannot pose as [PERSON_1] and be
     * re-hydrated into somebody's name. "[PERSON_1]" becomes "(PERSON_1)".
     */
    protect(text) {
      return String(text).replace(PLACEHOLDER, '($1_$2)');
    },

    /** Replace known placeholders with their real values. Unknown or malformed look-alikes are left untouched. */
    rehydrate(text) {
      if (typeof text !== 'string' || !reverse.size) return typeof text === 'string' ? text : '';
      // A function replacement: the real value is inserted literally, never read as a "$&" pattern, and not re-scanned.
      return text.replace(PLACEHOLDER, (token) => (reverse.has(token) ? reverse.get(token) : token));
    },

    /** Original values handed out so far. For the firewall's own leak check only; never exposed by the firewall. */
    originals() {
      return [...reverse.values()];
    },

    /** How many distinct placeholders exist. */
    get size() {
      return reverse.size;
    },

    /** Forget everything. */
    clear() {
      forward.clear();
      reverse.clear();
      counters.clear();
    },

    // Serialising a tokenizer must never leak the map.
    toJSON() {
      return { placeholders: reverse.size };
    },
  };
}

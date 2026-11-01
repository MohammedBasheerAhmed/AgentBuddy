// node scripts/i18n-check.js [folder or file ...]    which texts have no Arabic entry yet (see src/i18n/index.js)
// With no argument the whole of src is checked, and entries that no text uses are reported too.
const { checkI18n } = require('./lib/i18nCheck.js');

const only = process.argv.slice(2);
const r = checkI18n({ only, whole: true });
const show = (title, list, line) => {
  if (!list.length) return;
  console.log(`\n${title} (${list.length})`);
  for (const item of list.slice(0, 60)) console.log(`  ${line(item)}`);
  if (list.length > 60) console.log(`  ... and ${list.length - 60} more`);
};
show('No Arabic entry', r.missing, (m) => `${m.where.file}:${m.where.line}  ${JSON.stringify(m.key)}`);
show('Entry with different {names} than its English text', r.params, (p) => `${JSON.stringify(p.key)}  english {${p.english}}  arabic {${p.arabic}}`);
show('Plural entries that are wrong', r.badPlural, (p) => `${JSON.stringify(p.key)}  ${p.why}`);
show('Calls that are not a plain text (write the text out, or mark it with tm())', r.dynamic, (d) => `${d.file}:${d.line}  ${d.text}`);
show('Entries no text uses', r.extra, (k) => JSON.stringify(k));
console.log(`\n${r.used} texts used${only.length ? ` in ${only.join(', ')}` : ''}; ${r.entries} Arabic entries; ${r.missing.length} missing, ${r.params.length + r.badPlural.length} wrong, ${r.dynamic.length} dynamic, ${r.extra.length} unused.`);
process.exit(r.missing.length || r.params.length || r.badPlural.length || r.dynamic.length || r.extra.length ? 1 : 0);

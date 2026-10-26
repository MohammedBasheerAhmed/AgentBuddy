// Collects PASS / FAIL / WARN lines. A WARN is a finding that is not a bug in the harness or the extension flow but that a
// reader must know about (for example a kind of personal data the firewall is known not to catch). It does not fail the run.
const oneLine = (value, max = 400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

class Checker {
  constructor() {
    this.pass = 0;
    this.fail = 0;
    this.warn = 0;
    this.failures = [];
    this.warnings = [];
    this.current = '';
    this.seenWarnings = new Set();
  }

  section(title) {
    this.current = title;
    console.log(`\n== ${title}`);
  }

  check(name, ok, detail = '') {
    const d = oneLine(detail);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${d ? `  [${d}]` : ''}`);
    if (ok) this.pass += 1;
    else {
      this.fail += 1;
      this.failures.push(`${this.current}: ${name}${d ? ` [${d}]` : ''}`);
    }
    return ok;
  }

  warning(name, detail = '') {
    // The same finding seen again later in the run is reported once.
    if (this.seenWarnings.has(name)) return;
    this.seenWarnings.add(name);
    const d = oneLine(detail);
    this.warn += 1;
    this.warnings.push(`${this.current}: ${name}${d ? ` [${d}]` : ''}`);
    console.log(`  WARN  ${name}${d ? `  [${d}]` : ''}`);
  }

  info(text) {
    console.log(`  info  ${oneLine(text)}`);
  }
}

module.exports = { Checker };

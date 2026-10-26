// Collects PASS / FAIL / WARN lines. A WARN is a finding that is not a bug in the harness or the extension flow but that a
// reader must know about (for example a kind of personal data the firewall is known not to catch). It does not fail the run.
class Checker {
  constructor() {
    this.pass = 0;
    this.fail = 0;
    this.warn = 0;
    this.failures = [];
    this.warnings = [];
    this.current = '';
  }

  section(title) {
    this.current = title;
    console.log(`\n== ${title}`);
  }

  check(name, ok, detail = '') {
    const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`;
    console.log(`  ${line}`);
    if (ok) this.pass += 1;
    else {
      this.fail += 1;
      this.failures.push(`${this.current}: ${name}${detail ? ` [${detail}]` : ''}`);
    }
    return ok;
  }

  warning(name, detail = '') {
    this.warn += 1;
    this.warnings.push(`${this.current}: ${name}${detail ? ` [${detail}]` : ''}`);
    console.log(`  WARN  ${name}${detail ? `  [${detail}]` : ''}`);
  }

  info(text) {
    console.log(`  info  ${text}`);
  }
}

module.exports = { Checker };

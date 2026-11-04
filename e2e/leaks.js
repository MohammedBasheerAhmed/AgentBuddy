// What counts as a leak when we read a request the fake AI server received.
//
//   critical  data the firewall is built to mask and that the ticket plainly contains: the caller and the agent by name
//             and email, a full phone number, a card number, a password. Seeing any of it at the AI is a FAIL.
//   gaps      data a person would also call personal but that the firewall documents it cannot find reliably (a name that
//             only appears inside a sentence, a short local phone number, an employee id written without a label).
//             Seeing these is reported as a WARN with the exact string, because the lead needs to know, but it does not
//             fail the run: it is a limit of pattern matching, which is why the preview exists.
const squash = (s) => String(s).replace(/[\s\-().]/g, '').toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-word match, so "Abel" is found in "Abel Tuter" but not inside "label".
const word = (value) => ({ value, test: (text) => new RegExp(String.raw`(?<![\p{L}\p{N}])` + escapeRe(value) + String.raw`(?![\p{L}\p{N}])`, 'iu').test(text) });
// Plain substring (emails, numbers, secrets are long and distinctive); digit strings also match with separators removed.
const literal = (value) => ({
  value,
  test: (text) => text.toLowerCase().includes(value.toLowerCase()) || (/\d{6,}/.test(value) && squash(text).includes(squash(value))),
});

function criticalList(data) {
  const { SEED, MORE_SEED, ABEL, BETH, CHARLIE, DAVE, ERIN } = data;
  const parts = (n) => n.split(' ');
  const list = [
    literal(SEED.proseName), // named only inside a sentence ("manager is ..."): masked by the prose-name detector since round 2
    literal(SEED.callerName), word(parts(ABEL.name)[0]), word(parts(ABEL.name)[1]), literal(SEED.callerEmail), literal('abel.tuter'),
    literal(BETH.name), word(parts(BETH.name)[0]), word(parts(BETH.name)[1]), literal(BETH.email),
    literal('+1 555-0134'), literal('555-0134'), literal(SEED.card), literal(SEED.cardDigits), literal(SEED.password),
  ];
  // The people and secrets of the newer fixtures (data.more.js). Erin's surname is a common word ("Contact"), so only her full name counts.
  if (CHARLIE) list.push(literal(CHARLIE.name), word(parts(CHARLIE.name)[0]), word(parts(CHARLIE.name)[1]), literal(CHARLIE.email));
  if (DAVE) list.push(literal(DAVE.name), word(parts(DAVE.name)[0]), word(parts(DAVE.name)[1]), literal(DAVE.email));
  if (ERIN) list.push(literal(ERIN.name), word(parts(ERIN.name)[0]), literal(ERIN.email));
  if (MORE_SEED) {
    list.push(
      literal(MORE_SEED.secret), literal(MORE_SEED.articleSecret), literal(MORE_SEED.chatEmail), literal(MORE_SEED.chatPhone), literal(MORE_SEED.articleEmail), literal(MORE_SEED.articlePhone),
      literal(MORE_SEED.rewriteCard), literal(MORE_SEED.rewriteName), word('Priya'), word('Raman'), literal(MORE_SEED.rewriteEmail), literal(MORE_SEED.rewritePhone), literal(MORE_SEED.rewritePassword)
    );
  }
  return list;
}

function gapList() {
  return [
    { ...literal('555-0199'), why: 'short local phone number after "Call me on"' },
    { ...literal('555-0123'), why: 'short local phone number after "please call"' },
    { ...word('E12345'), why: 'employee id written as "employee id is E12345"' },
  ];
}

/** @returns {{ critical: string[], gaps: {value: string, why: string}[] }} what is present in `text`. */
function findLeaks(text, data) {
  const t = String(text);
  return {
    critical: [...new Set(criticalList(data).filter((c) => c.test(t)).map((c) => c.value))],
    gaps: gapList().filter((g) => g.test(t)).map((g) => ({ value: g.value, why: g.why })),
  };
}

module.exports = { findLeaks };

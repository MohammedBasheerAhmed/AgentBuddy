// AI0.3 (b): what a mail program adds to an emailed comment or description (the quoted thread, signatures, legal notices, "Sent from
// my iPhone", "external sender" banners) is taken out before the text becomes a part, and the customer's own words never are.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEmailText } from '../src/context/journal.js';
import { packToParts } from '../src/features/parts.js';
import { journalParts, fieldParts } from '../src/itsm/parts.js';

const LEFT_OUT = '(earlier quoted email left out)';

// ---- Quoted threads ----------------------------------------------------------------------------------------------------

test('Outlook (desktop): the From/Sent/To/Subject block and everything below it go, with the line of underscores', () => {
  const text = [
    'Hi,',
    '',
    'The VPN still drops every ten minutes, also on the home network.',
    '',
    '________________________________',
    'From: Service Desk <servicedesk@contoso.example>',
    'Sent: Monday, October 26, 2026 9:14 AM',
    'To: Tuter, Abel <abel.tuter@example.com>',
    'Subject: RE: INC0010001 VPN keeps disconnecting',
    '',
    'Hello Abel, please try the TCP profile and tell us whether the drops continue.',
  ].join('\n');
  assert.equal(cleanEmailText(text), `Hi,\n\nThe VPN still drops every ten minutes, also on the home network.\n${LEFT_OUT}`);
});

test('Outlook with bold labels and "-----Original Message-----"', () => {
  const bold = 'Yes, that worked, thank you!\n\n*From:* Beth Anglin <beth@contoso.example>\n*Sent:* Tuesday, 27 October 2026 10:02\n*To:* Abel Tuter\n*Subject:* RE: printer\n\nCan you try again?';
  assert.equal(cleanEmailText(bold), `Yes, that worked, thank you!\n${LEFT_OUT}`);
  const original = 'Still broken after the restart.\n\n-----Original Message-----\nFrom: Service Desk\nSent: 26 October 2026 09:14\nTo: Abel\nSubject: INC0010001\n\nPlease restart.';
  assert.equal(cleanEmailText(original), `Still broken after the restart.\n${LEFT_OUT}`);
});

test('Gmail and Apple Mail: "On ... wrote:" (also wrapped over two lines) and the "> " lines below it', () => {
  const gmail = 'The error is 809, screenshot attached.\n\nOn Mon, 26 Oct 2026 at 09:14, Service Desk <servicedesk@contoso.example> wrote:\n> Could you send the error code?\n> Thanks';
  assert.equal(cleanEmailText(gmail), `The error is 809, screenshot attached.\n${LEFT_OUT}`);
  const wrapped = 'The error code is 809 again.\n\nOn Mon, Oct 26, 2026 at 9:14 AM Service Desk <\nservicedesk@contoso.example> wrote:\n\n> Could you send the error code?';
  assert.equal(cleanEmailText(wrapped), `The error code is 809 again.\n${LEFT_OUT}`);
  const apple = 'Done, it works now.\n\n> On 26 Oct 2026, at 09:14, Service Desk <servicedesk@contoso.example> wrote:\n> \n> Please restart.';
  // Apple quotes the header line too: "> On ... wrote:" is not cut by the header rule, and a bare "> " block is left alone.
  assert.equal(cleanEmailText(apple), apple);
});

test('mobile: "Sent from my iPhone" and its kin go, the quoted thread below too', () => {
  const iphone = 'Ok, I will try tonight.\n\nSent from my iPhone\n\nOn 26 Oct 2026, at 09:14, Service Desk <sd@contoso.example> wrote:\n\n> Please try the TCP profile.';
  assert.equal(cleanEmailText(iphone), `Ok, I will try tonight.\n${LEFT_OUT}`);
  for (const sig of ['Sent from my iPhone', 'Sent from my Samsung Galaxy smartphone.', 'Get Outlook for Android', 'Sent from Outlook for iOS', 'Von meinem iPhone gesendet', 'Envoyé de mon iPhone', 'Enviado desde mi iPhone', 'Verzonden vanaf mijn iPhone', 'Inviato da iPhone', 'Sent from Mail for Windows']) {
    assert.equal(cleanEmailText(`The printer works again.\n\n${sig}`), 'The printer works again.', sig);
  }
  // A sentence that only starts like one stays.
  assert.equal(cleanEmailText('Sent from my laptop it fails too.'), 'Sent from my laptop it fails too.');
});

test('German, French, Spanish and Dutch reply headers', () => {
  const de = 'Hallo,\n\ndas Problem besteht weiterhin.\n\nVon: Service Desk <sd@contoso.example>\nGesendet: Montag, 26. Oktober 2026 09:14\nAn: Tuter, Abel\nBetreff: AW: INC0010001\n\nBitte neu starten.';
  assert.equal(cleanEmailText(de), `Hallo,\n\ndas Problem besteht weiterhin.\n${LEFT_OUT}`);
  const deGmail = 'Leider nicht, der Fehler kommt wieder.\n\nAm Mo., 26. Okt. 2026 um 09:14 Uhr schrieb Service Desk <sd@contoso.example>:\n> Bitte neu starten.';
  assert.equal(cleanEmailText(deGmail), `Leider nicht, der Fehler kommt wieder.\n${LEFT_OUT}`);
  const fr = 'Toujours en panne ce matin.\n\nDe : Service Desk <sd@contoso.example>\nEnvoyé : lundi 26 octobre 2026 09:14\nÀ : Abel Tuter\nObjet : RE: INC0010001\n\nMerci de redémarrer.';
  assert.equal(cleanEmailText(fr), `Toujours en panne ce matin.\n${LEFT_OUT}`);
  const frGmail = 'Toujours en panne ce matin.\n\nLe lun. 26 oct. 2026 à 09:14, Service Desk <sd@contoso.example> a écrit :\n> Merci de redémarrer.';
  assert.equal(cleanEmailText(frGmail), `Toujours en panne ce matin.\n${LEFT_OUT}`);
  const es = 'Sigue sin funcionar desde ayer.\n\nEl lun, 26 oct 2026 a las 09:14, Service Desk (<sd@contoso.example>) escribió:\n> Reinicie el equipo.';
  assert.equal(cleanEmailText(es), `Sigue sin funcionar desde ayer.\n${LEFT_OUT}`);
  const nl = 'Het werkt nog steeds niet.\n\nVan: Service Desk <sd@contoso.example>\nVerzonden: maandag 26 oktober 2026 09:14\nAan: Abel Tuter\nOnderwerp: RE: INC0010001\n\nGraag opnieuw opstarten.';
  assert.equal(cleanEmailText(nl), `Het werkt nog steeds niet.\n${LEFT_OUT}`);
});

test('nothing is cut when the person\'s own words are only above "see below", when it is a forward, or when there is nothing above', () => {
  const below = 'See my answers below.\n\nOn Mon, 26 Oct 2026 at 09:14, Service Desk <sd@contoso.example> wrote:\n> Which version?\nVersion 5.1\n> Since when?\nSince Monday';
  assert.equal(cleanEmailText(below), below);
  const unten = 'Antworten unten im Text.\n\nVon: Service Desk\nGesendet: Montag, 26. Oktober 2026 09:14\nBetreff: Fragen\n\n> Version? 5.1';
  assert.equal(cleanEmailText(unten), unten);
  const forward = 'FYI, this came from the vendor about our licence:\n\n---------- Forwarded message ---------\nFrom: Vendor Support <support@vendor.example>\nDate: Mon, Oct 26, 2026 at 9:14 AM\nSubject: Licence expiry\nTo: Abel Tuter <abel.tuter@example.com>\n\nYour licence expires on 31 October.';
  assert.equal(cleanEmailText(forward), forward);
  const onlyQuote = 'From: Service Desk\nSent: Monday, 26 October 2026 09:14\nSubject: x\n\nHello';
  assert.equal(cleanEmailText(onlyQuote), onlyQuote, 'a header on the first line: there is no own text above it');
  const tooLittle = 'Ok\n\nOn Mon, 26 Oct 2026 at 09:14, Service Desk <sd@contoso.example> wrote:\n> Did it work?';
  assert.equal(cleanEmailText(tooLittle), tooLittle, 'too little own text to be sure');
});

test('look-alikes in ordinary text are not reply headers', () => {
  const travel = 'Please book the flight for the workshop.\nFrom: London\nDate: 26 Oct\nTo: Paris\nSubject: Q4 workshop';
  assert.equal(cleanEmailText(travel), travel, 'no time on the date line: not a mail header');
  const printer = 'The label printer failed again.\nOn Monday the printer wrote: ERROR 5 on every label.';
  assert.equal(cleanEmailText(printer), printer);
  const shell = 'I ran these commands:\n> ping gateway\n> tracert gateway\nBoth time out.';
  assert.equal(cleanEmailText(shell), shell);
});

// ---- Signatures and legal notices ----------------------------------------------------------------------------------------------

test('a signature after a sign-off goes, the sign-off stays; a legal notice at the end goes', () => {
  const text = [
    'Hi team,',
    '',
    'The shared drive S: is read-only since this morning.',
    '',
    'Kind regards,',
    'Abel Tuter',
    'Senior Analyst | Finance Operations',
    'Contoso Ltd',
    'Tel: +1 555 0134 | Mobile: +1 555 0199',
    'www.contoso.example',
    '',
    'CONFIDENTIALITY NOTICE: This e-mail and any attachments are confidential and may be privileged. If you are not the intended recipient, please notify the sender immediately and delete this message. Any unauthorised use or disclosure is prohibited.',
    '',
    'Please consider the environment before printing this email.',
  ].join('\n');
  assert.equal(cleanEmailText(text), 'Hi team,\n\nThe shared drive S: is read-only since this morning.\n\nKind regards,');
});

test('German signature and company footer, "-- " signatures, a contact block without a sign-off', () => {
  const de = [
    'Guten Tag,',
    '',
    'der Drucker im 2. Stock druckt nur leere Seiten.',
    '',
    'Mit freundlichen Grüßen',
    'Anna Schmidt',
    'Teamleiterin Buchhaltung',
    'Telefon: +49 30 1234567',
    '',
    'Contoso GmbH, Sitz der Gesellschaft: Berlin, Registergericht: Amtsgericht Charlottenburg HRB 12345, Geschäftsführer: Max Muster',
    '',
    'Diese E-Mail enthält vertrauliche und/oder rechtlich geschützte Informationen. Wenn Sie nicht der richtige Adressat sind oder diese E-Mail irrtümlich erhalten haben, informieren Sie bitte sofort den Absender und vernichten Sie diese E-Mail. Das unerlaubte Kopieren sowie die unbefugte Weitergabe dieser Mail ist nicht gestattet.',
  ].join('\n');
  assert.equal(cleanEmailText(de), 'Guten Tag,\n\nder Drucker im 2. Stock druckt nur leere Seiten.\n\nMit freundlichen Grüßen');
  const dash = 'The laptop does not charge.\n\n-- \nAbel Tuter\nFinance Operations\n+1 555 0134';
  assert.equal(cleanEmailText(dash), 'The laptop does not charge.');
  const block = 'The laptop does not charge any more, even with another charger.\n\nAbel Tuter | Finance Operations\nTel: +1 555 0134\nabel.tuter@example.com';
  assert.equal(cleanEmailText(block), 'The laptop does not charge any more, even with another charger.');
});

test('the customer\'s own words after a sign-off are kept', () => {
  const more = 'The VPN drops.\n\nThanks\nI also need access to the finance share by Friday.';
  assert.equal(cleanEmailText(more), more, 'a sentence is not a signature');
  const question = 'The VPN drops.\n\nRegards,\nAbel\nCan you call me back?';
  assert.equal(cleanEmailText(question), question, 'a question is not a signature');
  const confidential = 'Hello,\n\nThis message is confidential: my salary slip shows the wrong tax code. Could you check it?';
  assert.equal(cleanEmailText(confidential), confidential, 'a question in it: never a legal notice');
  const shortNotice = 'Hi,\n\nPlease reset my token.\n\nThis email is confidential.';
  assert.equal(cleanEmailText(shortNotice), shortNotice, 'too short to be a legal notice');
});

test('banners and ServiceNow\'s own "reply from:" line', () => {
  const banner = 'CAUTION: This email originated from outside of the organization. Do not click links or open attachments unless you recognize the sender.\n\nMy account is locked after the password change.';
  assert.equal(cleanEmailText(banner), 'My account is locked after the password change.');
  const de = '[EXTERN] Diese E-Mail stammt von einem externen Absender.\n\nMein Konto ist gesperrt.';
  assert.equal(cleanEmailText(de), 'Mein Konto ist gesperrt.');
  assert.equal(cleanEmailText('reply from: abel.tuter@example.com\n\nIt works now, thanks.'), 'It works now, thanks.');
});

test('never empty, never more: text without clutter comes back as it was, an all-clutter text too', () => {
  for (const text of ['', '   ', 'The printer is broken.', 'Line one\n\nLine two', 'Regards,', 'Sent from my iPhone']) assert.equal(cleanEmailText(text), text, JSON.stringify(text));
  assert.equal(cleanEmailText(undefined), '');
});

// ---- Where it is applied --------------------------------------------------------------------------------------------------------

test('the parts carry the cleaned notes and description; the pack keeps the whole text', () => {
  const email = 'The VPN drops again.\n\nKind regards,\nAbel Tuter\nFinance Operations\nTel: +1 555 0134\n\nFrom: Service Desk\nSent: Monday, 26 October 2026 09:14\nTo: Abel\nSubject: RE: VPN\n\nPlease try again.';
  const pack = {
    table: 'incident',
    fields: { short_description: 'VPN', description: email, close_notes: email },
    journal: [{ when: '2026-10-26 10:00:00', by: 'Abel Tuter', type: 'comment', text: email }],
  };
  const parts = packToParts(pack, { journal: 5 });
  const description = parts.find((p) => p.field === 'description').text;
  assert.equal(description, `The VPN drops again.\n\nKind regards,\n${LEFT_OUT}`);
  assert.equal(parts.find((p) => p.field === 'close_notes').text, email, 'agent-written columns are left alone');
  assert.equal(parts.find((p) => p.field === 'comments').text, `[2026-10-26 10:00:00] Abel Tuter: The VPN drops again.\n\nKind regards,\n${LEFT_OUT}`);
  assert.equal(journalParts(pack, { depth: 5 })[0].text, `[2026-10-26 10:00:00] Abel Tuter: The VPN drops again.\n\nKind regards,\n${LEFT_OUT}`);
  assert.equal(fieldParts(pack).find((p) => p.field === 'description').text, description);
  assert.equal(pack.journal[0].text, email, 'the pack is not changed');
});

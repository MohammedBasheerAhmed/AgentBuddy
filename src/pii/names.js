// Person names written in prose: "my manager is María-José O'Neil", "spoke with Dr. Priya Raman", "Hi Tom,", "Regards,\nAnna
// Schmidt", "cc: Jean-Luc Picard", "@Kevin Lee". Pure functions, no I/O.
//
// HOW. A name is only looked for where the words around it say a person comes next (a CUE): a salutation or sign-off, an
// honorific (Mr, Dr, Prof...), "manager is", "spoke with", "according to", "cc:", "assigned to", "on behalf of", an @mention.
// After the cue come one to four capitalised words (Unicode letters, hyphens, apostrophes, Mc/Mac/O', particles such as van, de,
// da, initials such as "J."), or one to three words of a script that has no capital letters. A word that is ServiceNow or IT
// vocabulary, a product, a team, a weekday or a month ends the name, so "spoke with Service Desk", "per Microsoft Teams" and
// "called Monday" find nothing.
//
// HOW SURE. Three strengths of cue, chosen by the privacy mode:
//   strong  a salutation, a sign-off, an honorific, "manager is", "spoke with", "cc:"... : one word is enough ("Hi Tom,").
//   weak    "with", "to", "by", "for", a role noun ("user", "colleague", "new starter"): in Standard mode only a full name of two
//           or more words whose first word is not an everyday English word ("for Anna Schmidt", not "for Go Live").
//   none    Strict (and Local-only) mode also takes two or more capitalised words that are not vocabulary anywhere in the text
//           ("Carol Diaz joined"), and one word after a weak cue. It masks more and gets more wrong; that is the trade.
//
// WHAT IT CANNOT DO. A name with no cue near it ("Carol Diaz joined") is missed in Standard mode, and so is a name made only of
// vocabulary words (a person called "June" or "Austin Teams"). It is a guess, so a finding is never treated as certain: its
// confidence stays below the firewall's "high" level, and the people the ticket itself lists are still matched exactly by the
// dictionary (dictionary.js), which wins wherever both find the same words.
//
// Regex safety: the cue scan walks word tokens once; every name is parsed with sticky patterns of bounded length from one
// position, at most a handful of words, so the work is linear in the text.

import { COMMON_WORDS, fold } from './dictionary.js';
import { resolveOverlaps } from './detectors.js';

// ---------------------------------------------------------------------------------------------------------------
// Vocabulary: capitalised words that are never (part of) a person's name in a ticket
// ---------------------------------------------------------------------------------------------------------------

const words = (s) => s.trim().split(/\s+/);

/** ServiceNow and IT vocabulary, products, vendors, teams, places, time words and function words. Folded (lowercase, no accents). */
export const NAME_STOP_WORDS = new Set(
  words(`
  the a an this that these those there here it its i me my mine myself we us our ours you your yours he him his she her they
  them their all everyone everybody anyone anybody someone somebody nobody none both each either neither every any some
  team teams folks guys people sir madam madame maam ma'am mam colleagues customer customers client clients user users caller
  callers requester requestor requesters agent agents fulfiller fulfillers analyst analysts engineer engineers technician
  technicians administrator administrators admin admins manager managers supervisor supervisors lead leads owner owners member
  members staff employee employees contractor contractors vendor vendors supplier suppliers partner partners person persons
  human individual individuals somebody whoever world valued all-hands
  hi hello hey hiya dear thanks thank thankyou thx ta regards regard best kind warm warmest cheers sincerely yours greetings
  welcome morning afternoon evening night good great please note notes fyi asap update updates reminder urgent important
  attention action required info information again sorry apologies unfortunately hope hoping just quick following further
  regarding re fw fwd as can could would should shall must might may also kindly let still now then so but and or yes no not
  nor trust wanted want need needed writing checking adding hereby attached see find got noted sure glad happy okay ok what
  when where why how who whom whose which after before since because if unless though although while once until upon
  per via from to cc bcc subject date sent attn
  monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun weekday weekend
  january february march april may june july august september october november december jan feb mar apr jun jul aug sep
  sept oct nov dec today tomorrow yesterday tonight week weeks month months year years day days hour hours minute minutes
  noon midnight eod eow cob christmas xmas easter diwali eid ramadan hanukkah thanksgiving holiday holidays spring summer
  autumn fall winter quarter
  servicenow now platform instance incident incidents problem problems change changes request requests requested item items
  task tasks case cases ticket tickets record records catalog catalogue knowledge article articles kb portal portals
  workspace workspaces service services desk helpdesk servicedesk support help itsm itil itom csm hrsd sla slas ola olas cab
  approval approvals approver approvers queue queues group groups assignment category subcategory priority impact urgency
  state status new open active pending hold awaiting progress resolved closed cancelled canceled complete completed done
  draft review scheduled implement implementation work journal activity stream form field fields list view views dashboard
  dashboards report reports flow flows designer workflow workflows script scripts business rule rules ui policy policies acl
  acls role roles table tables module modules plugin plugins set sets application applications app apps scoped integration
  integrations api apis rest soap mid discovery cmdb ci cis configuration asset assets software hardware license licenses
  licence licences entitlement entitlements contract contracts outage outages major minor critical high moderate low planning
  planned emergency standard normal sev severity tier level escalation escalations resolution workaround root cause known
  error backlog sprint epic story stories release releases
  it hr finance financial accounting accounts payable receivable payroll legal compliance procurement purchasing facilities
  operations ops devops secops security infosec network networking networks infrastructure infra database databases dba
  server servers storage backup backups cloud desktop desktops endpoint endpoints mobile telecom telecoms telephony unified
  communications collaboration messaging email e-mail mail exchange identity iam access directory sales marketing engineering
  development dev qa testing test tests production prod staging uat sandbox research product products management executive
  executives leadership board office offices headquarters hq branch site sites campus building floor room reception lobby
  warehouse store shop retail plant factory lab labs center centre data datacenter datacentre region regions global
  international domestic north south east west central northern southern eastern western emea apac amer latam americas
  europe asia africa department departments division unit units function functions
  microsoft windows win10 win11 office365 outlook excel powerpoint onenote onedrive sharepoint azure entra intune defender
  bitlocker autopilot copilot viva yammer skype lync visio dynamics m365 o365 ldap okta duo google gmail chrome drive docs
  sheets meet android pixel apple mac macos macbook imac ipad iphone ios icloud safari firefox mozilla edge opera brave linux
  ubuntu debian redhat centos fedora unix vmware citrix horizon receiver netscaler cisco anyconnect webex meraki juniper
  fortinet fortigate forticlient palo alto globalprotect prisma zscaler cloudflare akamai aws amazon kubernetes docker
  openshift terraform ansible jenkins github gitlab bitbucket jira confluence atlassian trello asana slack zoom dropbox box
  adobe acrobat reader photoshop illustrator sap oracle salesforce workday successfactors concur coupa ariba netsuite
  quickbooks sage tableau splunk datadog dynatrace newrelic pagerduty opsgenie solarwinds nagios zabbix grafana prometheus
  elastic kibana crowdstrike falcon sentinelone sophos mcafee symantec norton kaspersky qualys tenable nessus proofpoint
  mimecast barracuda dell hp hpe lenovo asus acer samsung sony logitech jabra plantronics poly polycom yealink avaya genesys
  twilio vonage ringcentral zendesk freshdesk freshservice ivanti cherwell bmc remedy manageengine sccm mecm jamf airwatch
  mobileiron blackberry whatsapp telegram wechat facebook instagram linkedin twitter youtube tiktok openai chatgpt claude
  anthropic gemini bard siri alexa cortana nvidia intel amd qualcomm broadcom realtek wifi wi-fi bluetooth ethernet vpn dns
  dhcp ssl tls http https ftp sftp ssh rdp smtp imap sso mfa otp saml oauth power bi visual studio code team-viewer
  teamviewer anydesk bomgar beyondtrust lastpass bitwarden keepass 1password authenticator
  account password passwords login logon logout signin laptop laptops pc pcs computer computers monitor monitors screen
  screens keyboard mouse printer printers scanner scanners phone phones headset headsets camera cameras dock docking station
  charger battery cable cables router routers switch switches firewall firewalls proxy gateway gateways certificate
  certificates cert certs token tokens key keys badge badges card cards file files folder folders share shares disk disks
  memory cpu ram errors issue issues fault failure failures bug bugs crash crashes alert alerts alarm alarms event events log
  logs message messages notification notifications meeting meetings call calls chat chats conversation conversations invite
  invites calendar calendars mailbox mailboxes inbox distribution channel channels pages link links url website web
  browser system systems device devices machine machines host hosts node nodes cluster clusters vm vms virtual environment
  environments version versions patch patches upgrade upgrades install installation deployment deploy rollback restart
  reboot reset unlock enable disable activate migrate migration restore sync permission permissions rights privilege
  privileges order orders invoice invoices payment payments refund refunds purchase quote budget cost procedure process
  guide manual documentation doc faq training onboarding offboarding leaver leavers starter starters joiner joiners mover
  movers hire hires annual leave remote hybrid go live golive general default custom demo example sample internal external
  public private confidential personal corporate company corp inc ltd llc plc gmbh ag co holdings limited group
  yes no n/a na tbd tbc null unknown other others misc
  fixed resolved reopened restarted rebooted replaced installed updated upgraded confirmed checked verified tested works
  working worked failed failing broken down up unable cannot
  london paris berlin madrid rome dublin amsterdam brussels zurich geneva vienna prague warsaw stockholm oslo copenhagen
  helsinki lisbon athens istanbul moscow dubai abu dhabi doha riyadh cairo lagos nairobi johannesburg mumbai delhi bangalore
  bengaluru chennai hyderabad pune kolkata singapore hong kong tokyo osaka seoul beijing shanghai shenzhen melbourne auckland
  toronto vancouver montreal chicago boston seattle atlanta miami york jersey san francisco diego los angeles las vegas usa
  us uk gb india china japan germany france spain italy canada australia brazil mexico ireland netherlands belgium
  switzerland austria sweden norway denmark finland poland portugal greece turkey russia uae emirates qatar saudi arabia
  egypt nigeria kenya korea
  person placeholder masked redacted hidden buddy
  in on at of off out into onto over under with without within about above below between for from to by up down near not
  than then also too very offline online settings setting control panel preferences options locked unlocked inactive
  enabled disabled expired project projects programme program checklist checklists template templates analysis due shared
  home head guest guests visitor visitors number numbers back signature signatures forwarding recording
  mr mrs ms miss mx dr prof professor sir dame madam madame mme mlle herr frau sra srta senor senora shri smt sri mister rev
`).map(fold)
);

// Everyday English words that are also capitalised in titles ("Go Live", "Annual Leave"). A WEAK cue or no cue at all needs a
// first name word that is not one of these, so "for Purchase Order" is left alone while "for Anna Schmidt" is a name. Common
// words that are mostly given names ("Will", "Grace", "Mark") are taken out again: "for Grace Hopper" is a name.
const GIVEN_NAMES = new Set(words('will mark grace hope faith joy bill pat art don dawn amber ruby violet rose lily daisy holly ivy sandy chase frank gene guy jay dean'));
const ENGLISH = new Set([
  ...[...COMMON_WORDS].filter((w) => !GIVEN_NAMES.has(w)),
  ...words(`
  about across add added adding address advice again agree alarm allow almost alone already always amount another answer
  apply area around arrive ask asked asking auto available away bad base basic become begin behind believe better beyond
  bit block blocked book books boost bottom box break bring broken build built busy buy came cannot care carry catch
  check checked choose clean clear click close cloud collect come coming common complete contact content continue copy
  correct could country cover create created cut daily dark date deal decide deep define delay delete deliver describe
  design detail details different direct do doing door double draw drive drop due easy eat edit else empty end enough enter
  entire even ever every exact example expect explain extra face fact fail fair far feel few figure fill final finish fire
  first fit fix fixed flag floor focus follow food force form forward front fully future gain get getting give go going
  gone got ground grow guess hand handle hang happen hard head hear heard heavy hello help hold home hot however huge idea
  include increase index inside instead interest into issue join jump keep kind know known large later learn leave level
  life light likely limit line link list listen live load local lock long loss lost lot made main major make many matter
  maybe mean meet member mind miss mode model money more move moving much must name near need never next nice none note
  nothing notice number offer often online only open option order out over own page paper part pass past path pay pick
  piece place plan play plus point poor possible post press print private put quality quick quiet raise range rate read
  ready reason receive record reduce remain remove repair repeat reply report require result return review ring rise risk
  room route run safe same save say scan search section see seem select send sense sent serve setting settings share
  shared short show side sign signal simple since single size skip slow small smart soft solid solve sort sound source
  space speed spend split stand start started stay step stop store straight strong study style submit success such suggest
  supply sure table take talk target tell term than thing think through tick time title together top total touch track
  trade transfer travel tree trial trouble true turn type under unit upon urgent useful usual value very view visit wait
  walk want watch water way weekly well whole wide window wish word words world write wrong annual leave remote work
  visual studio live purchase order guide quick start shared mailbox new old big small free full half general global
  great happy high low just kind last late little long next nice old only open own plain pretty proper real right
  same short simple sorry special still sure true whole wild young
`),
]);

// Honorifics: the title stays readable, the name after it is masked ("Dr [PERSON_1]").
const HONORIFICS = new Set(words('mr mrs ms miss mx dr prof professor sir dame madam madame mme mlle herr frau sra srta senor senora shri smt sri mister rev'));

// Lowercase name particles: part of a name only between two name words ("Ludwig van Beethoven", "Leonardo da Vinci").
const PARTICLES = new Set(words('van von der den de da das dos del della dei di du la le ten ter bin binti bint ibn al el y zu af av'));

// @here, @channel and their kind name a group, not a person.
const NOT_A_HANDLE = new Set(words('here channel all everyone team admin admins support servicedesk helpdesk it hr security ops devops me you mention mentions group'));
const DOMAIN_ENDINGS = new Set(words('com org net io co uk de fr in au ca us gov edu info biz app dev cloud local'));

// ---------------------------------------------------------------------------------------------------------------
// Cues
// ---------------------------------------------------------------------------------------------------------------

// Each type: how many name words it needs per mode, whether it must start a line (or a sentence), whether a colon must follow,
// and whether a list ("Anna, Tom and Raj") may follow.
const TYPES = {
  strong: { min: { standard: 1, strict: 1 }, uncased: true },
  weak: { min: { standard: 2, strict: 1 }, uncased: false, plainFirst: true },
  label: { min: { standard: 1, strict: 1 }, uncased: true, colon: true, commaList: true },
  salutation: { min: { standard: 1, strict: 1 }, uncased: true, lineStart: true, commaList: true },
  signoff: { min: { standard: 1, strict: 1 }, uncased: true, lineStart: true, signoff: true },
  honorific: { min: { standard: 1, strict: 1 }, uncased: true, honorific: true },
};

const POSSESSIVES = ['my', 'his', 'her', 'their', 'our', 'your', "'s"];
const RELATIONS = [
  'manager', 'line manager', 'boss', 'supervisor', 'colleague', 'coworker', 'co worker', 'teammate', 'team lead', 'lead',
  'assistant', 'deputy', 'director', 'contact', 'wife', 'husband', 'partner', 'son', 'daughter', 'friend', 'mentor', 'buddy',
  'delegate', 'replacement', 'backup', 'cover', 'approver', 'sponsor',
];

const CUES = {
  strong: [
    // talking to someone
    ...['spoke', 'speak', 'speaking', 'spoken', 'talked', 'talk', 'talking', 'chatted', 'chat', 'chatting', 'met', 'meeting', 'meet', 'working', 'worked', 'work', 'checked', 'check', 'checking', 'confirmed', 'confirm', 'confirming', 'followed up', 'follow up', 'following up', 'agreed', 'agree', 'sync', 'synced', 'catch up', 'caught up', 'liaised', 'liaising']
      .flatMap((v) => [`${v} with`, ...(/^(?:spoke|speak|speaking|spoken|talked|talk|talking)$/.test(v) ? [`${v} to`] : [])]),
    'called', 'calling', 'phoned', 'phoning', 'rang', 'ring', 'emailed', 'e mailed', 'emailing', 'mailed', 'messaged', 'messaging',
    'texted', 'pinged', 'pinging', 'contacted', 'contacting', 'contact', 'reached', 'reached out to', 'reaching out to', 'reach out to',
    'asked', 'asking', 'ask', 'told', 'tell', 'telling', 'informed', 'inform', 'informing', 'notified', 'notify', 'advised', 'advise',
    'reminded', 'remind', 'thanked', 'thank', 'thanks', 'thank you', 'many thanks', 'thanks to', 'cc', "cc'd", "cc'ed", "cc'ing", 'ccd',
    'bcc', 'looped in', 'loop in', 'looping in', 'copied in', 'copying in', 'heard from', 'heard back from', 'email from', 'mail from',
    'message from', 'call from', 'reply from', 'response from', 'note from', 'update from', 'feedback from', 'approval from',
    'request from', 'complaint from', 'sent to', 'forwarded to', 'forward to', 'replied to', 'responded to', 'wrote to', 'writing to',
    'escalated to', 'assigned to', 'reassigned to', 'assign to', 'assigning to', 'handed over to', 'handed to', 'handover to',
    'passed to', 'transferred to', 'routed to', 'delegated to', 'on behalf of', 'according to', 'per', 'as per', 'requested by',
    'reported by', 'raised by', 'logged by', 'opened by', 'created by', 'submitted by', 'approved by', 'rejected by', 'updated by',
    'resolved by', 'closed by', 'signed by', 'signed off by', 'authorised by', 'authorized by', 'confirmed by', 'reviewed by',
    'handled by', 'sent by', 'written by', 'entered by', 'provided by', 'completed by', 'fixed by', 'escalated by', 'requested for',
    'raised for', 'logged for', 'on behalf', 'covering for', 'cover for', 'standing in for', 'replacing', 'replacement for',
    'manager is', 'manager was', 'boss is', 'supervisor is', 'supervisor was', 'lead is', 'contact is', 'contact was',
    'contact person', 'contact person is', 'point of contact', 'point of contact is', 'poc is', 'name is', 'named', 'user named',
    'my name is', 'this is', "i'm", 'i am', 'caller is', 'requester is', 'requestor is', 'user is', 'owner is', 'approver is',
    ...POSSESSIVES.flatMap((p) => RELATIONS.map((r) => `${p} ${r}`)),
  ],
  weak: [
    'with', 'to', 'by', 'from', 'for', 'user', 'users', 'employee', 'colleague', 'coworker', 'customer', 'client', 'caller',
    'requester', 'requestor', 'agent', 'technician', 'engineer', 'contractor', 'consultant', 'intern', 'analyst', 'member',
    'staff', 'student', 'visitor', 'guest', 'approver', 'reviewer', 'owner', 'starter', 'new starter', 'leaver', 'joiner',
    'new joiner', 'new hire', 'hire', 'new user', 'onboarding', 'offboarding', 'onboard', 'offboard', 'mover', 'manager',
    'access for', 'account for', 'laptop for', 'mailbox for', 'licence for', 'license for',
    // verbs that are also nouns in ticket titles ("Call Forwarding", "Email Signature"): a full name only
    'call', 'email', 'e mail', 'mail', 'phone', 'ping', 'message', 'text',
  ],
  label: [
    'from', 'to', 'cc', 'bcc', 'attn', 'attention', 'author', 'owner', 'caller', 'contact', 'name', 'full name', 'user',
    'employee', 'employee name', 'requester', 'requestor', 'requested by', 'requested for', 'reported by', 'opened by',
    'assigned to', 'assignee', 'approver', 'manager', 'line manager', 'supervisor', 'sent by', 'submitted by', 'attendees',
    'participants', 'present', 'agent', 'technician', 'engineer', 'signature', 'customer contact', 'on behalf of', 'recipient',
    'recipients', 'reviewer', 'reviewers', 'member', 'members', 'who', 'person', 'colleague', 'new starter', 'starter', 'leaver',
    'joiner', 'new hire', 'onboarding', 'offboarding', 'for user', 'affected user', 'end user',
  ],
  salutation: ['hi', 'hello', 'hey', 'dear', 'hiya', 'howdy', 'greetings', 'good morning', 'good afternoon', 'good evening', 'good day', 'morning', 'afternoon', 'evening', 'hallo', 'hola', 'bonjour', 'ciao', 'yo'],
  signoff: [
    'regards', 'kind regards', 'best regards', 'warm regards', 'warmest regards', 'many thanks', 'thanks', 'thank you', 'thanks and regards',
    'thanks regards', 'thx', 'ta', 'cheers', 'best', 'best wishes', 'all the best', 'sincerely', 'yours sincerely', 'yours faithfully',
    'yours truly', 'yours', 'respectfully', 'rgds', 'br', 'kr', 'with thanks', 'thanks again', 'take care', 'speak soon', 'talk soon',
  ],
  honorific: [...HONORIFICS],
};

// A trie over folded cue words. Each node can end one cue per type.
function buildTrie() {
  const root = { kids: new Map(), types: null };
  for (const [type, phrases] of Object.entries(CUES)) {
    for (const phrase of phrases) {
      let node = root;
      for (const w of phrase.split(/[\s-]+/).filter(Boolean)) {
        const key = fold(w);
        if (!node.kids.has(key)) node.kids.set(key, { kids: new Map(), types: null });
        node = node.kids.get(key);
      }
      node.types = node.types || new Set();
      node.types.add(type);
    }
  }
  return root;
}
const TRIE = buildTrie();

// ---------------------------------------------------------------------------------------------------------------
// The grammar of a name
// ---------------------------------------------------------------------------------------------------------------

const APOS = "['\u2019]";
const LOW = '[\\p{Ll}\\p{M}]';
// One capitalised part: "Anna", "McDonald", "MacKenzie", "DeShawn", "O'Neil", "D'Souza", "d'Arcy", "al-Rashid".
const SEG = `(?:(?:Mc|Mac|De|Di|Da|Du|La|Le|Lo|Fitz|d${APOS}|l${APOS}|al-|el-)?\\p{Lu}${LOW}{1,40}|\\p{Lu}${APOS}\\p{Lu}${LOW}{1,40})`;
// A name word: parts joined by hyphens ("María-José"), an optional possessive, and nothing glued on after it.
// Bounded (at most four hyphenated parts of at most 40 letters), so a long run such as "Ab-Ab-Ab-..." is never re-read from every
// capital letter in it.
const NAME_WORD = new RegExp(`${SEG}(?:-${SEG}){0,3}(?<poss>${APOS}s|${APOS})?(?![\\p{L}\\p{N}_@-])`, 'uy');
const INITIAL = /\p{Lu}\.(?:\p{Lu}\.){0,2}(?![\p{L}\p{N}])|\p{Lu}(?=[ \t\u00a0]+\p{Lu})/uy;
const PARTICLE = /\p{Ll}{1,5}(?=[ \t\u00a0])/uy;
// A word of a script without capital letters (Arabic, Hebrew, Devanagari, Chinese...). Scripts written without spaces between
// words only count when short (a name, not the rest of the sentence).
const UNCASED = /[\p{Lo}][\p{Lo}\p{M}]{0,24}(?![\p{L}\p{N}])/uy;
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const HONORIFIC_AHEAD = new RegExp(`(?:${[...HONORIFICS].map((h) => h[0].toUpperCase() + h.slice(1)).join('|')})\\.?[ \\t\\u00a0]+(?=\\p{Lu}|\\p{Lo})`, 'uy');

const SPACE = /[ \t\u00a0]/;
const isSpace = (ch) => ch !== undefined && SPACE.test(ch);
const isLetterOrDigit = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

function stickyAt(re, text, at) {
  re.lastIndex = at;
  return re.exec(text);
}

/** Is `word` vocabulary (stops a name)? Looks at the whole word without a possessive, and at each hyphenated part. */
export function isStopWord(word) {
  const base = fold(String(word).replace(/['\u2019]s?$/, ''));
  if (NAME_STOP_WORDS.has(base) || NAME_STOP_WORDS.has(base.replace(/-/g, ''))) return true;
  return base.includes('-') && base.split('-').some((part) => NAME_STOP_WORDS.has(part));
}

const isEnglish = (word) => ENGLISH.has(fold(String(word).replace(/['\u2019]s?$/, '')));

/**
 * Parse a name that starts at `at`. Returns { start, end, words } or null. `words` are the name words (initials and particles
 * are inside the span but not counted). The span stops before a possessive "'s".
 */
function parseName(text, at, { uncased = true, maxWords = 4 } = {}) {
  let i = at;
  let start = -1;
  let end = -1;
  const found = [];
  let pending = false; // an initial or particle that needs a name word after it
  let kind = ''; // 'cased' | 'uncased': one name does not mix them
  for (let steps = 0; steps < 8 && found.length < maxWords; steps++) {
    let j = i;
    if (steps > 0) {
      // Name words are separated by one or two spaces on the same line.
      let n = 0;
      while (isSpace(text[j]) && n < 3) {
        j++;
        n++;
      }
      if (n === 0 || n > 2) break;
    }
    const word = kind !== 'uncased' ? stickyAt(NAME_WORD, text, j) : null;
    if (word) {
      const poss = word.groups.poss || '';
      const bare = word[0].slice(0, word[0].length - poss.length);
      if (isStopWord(bare)) break;
      if (start === -1) start = j;
      found.push(bare);
      kind = 'cased';
      end = j + bare.length;
      i = j + word[0].length;
      pending = false;
      if (poss) break; // "Anna's laptop": the name ends at the possessive
      continue;
    }
    if (kind !== 'uncased') {
      const initial = stickyAt(INITIAL, text, j);
      if (initial) {
        if (start === -1) start = j;
        i = j + initial[0].length;
        pending = true;
        kind = 'cased';
        continue;
      }
      const particle = found.length ? stickyAt(PARTICLE, text, j) : null;
      if (particle && PARTICLES.has(particle[0])) {
        i = j + particle[0].length;
        pending = true;
        continue;
      }
    }
    if (uncased && kind !== 'cased') {
      const other = stickyAt(UNCASED, text, j);
      if (other && !(NO_SPACE_SCRIPT.test(other[0]) && [...other[0]].length > 4)) {
        if (start === -1) start = j;
        found.push(other[0]);
        kind = 'uncased';
        end = j + other[0].length;
        i = end;
        pending = false;
        if (found.length >= 3) break;
        continue;
      }
    }
    break;
  }
  if (!found.length || start === -1 || end <= start) return null;
  // A dangling initial or particle at the end is not part of the name ("Anna van" -> "Anna"); `end` already stops before it.
  void pending;
  return { start, end, words: found };
}

// What may sit between a cue and the name: spaces, and a colon, comma or dash ("Thanks, Tom", "cc: Anna", "Leaver - Tom Baker").
function skipAfterCue(text, i, { colon = false, newline = false } = {}) {
  let j = i;
  while (isSpace(text[j])) j++;
  let sawColon = false;
  if (text[j] === ':' || text[j] === ',' || text[j] === '-' || text[j] === '\u2013' || text[j] === '\u2014' || text[j] === '=') {
    sawColon = text[j] === ':';
    j++;
    while (isSpace(text[j])) j++;
  }
  if (colon && !sawColon) return -1;
  if (newline && (text[j] === '\n' || text[j] === '\r')) return j;
  return j;
}

// A salutation or sign-off begins a line, a quoted reply, a sentence, or the text after "Name:" (a journal line).
function startsLine(text, at) {
  let k = at - 1;
  while (k >= 0 && (isSpace(text[k]) || text[k] === '>' || text[k] === '"' || text[k] === '\u201c' || text[k] === '*' || text[k] === '\u2022' || text[k] === '-')) k--;
  if (k < 0) return true;
  const ch = text[k];
  return ch === '\n' || ch === '\r' || ch === '.' || ch === '!' || ch === '?' || ch === ':' || ch === ']';
}

const lineEndAt = (text, i) => {
  let j = i;
  while (isSpace(text[j])) j++;
  return j >= text.length || text[j] === '\n' || text[j] === '\r';
};

// After a name on a signature line only the end of the line, punctuation or a job title after a separator may follow.
function signatureTail(text, i) {
  let j = i;
  while (isSpace(text[j])) j++;
  if (j >= text.length || text[j] === '\n' || text[j] === '\r') return true;
  if (/[,|(/\u2013\u2014-]/.test(text[j])) return true;
  if ((text[j] === '.' || text[j] === '!') && lineEndAt(text, j + 1)) return true;
  return false;
}

// A name in a comma list must look like a list item: what follows is punctuation, "and", or the end of the line.
function listItemTail(text, i) {
  let j = i;
  while (isSpace(text[j])) j++;
  if (j >= text.length || /[,;:!.\n\r&/)]/.test(text[j])) return true;
  return /^(?:and|or)(?![\p{L}])/iu.test(text.slice(j, j + 4));
}

// ---------------------------------------------------------------------------------------------------------------
// The detector
// ---------------------------------------------------------------------------------------------------------------

const CONFIDENCE = { strong: 0.8, weak: 0.75, uncued: 0.6 };
const MAX_LIST = 8;

const CUE_WORD = /[\p{L}\p{N}]+(?:['\u2019][\p{L}]+)*/gu;

function tokenize(text) {
  const out = [];
  CUE_WORD.lastIndex = 0;
  let m;
  while ((m = CUE_WORD.exec(text)) !== null) out.push({ start: m.index, end: m.index + m[0].length, key: fold(m[0]).replace(/\u2019/g, "'") });
  return out;
}

const CUE_GAP = /^(?:[ \t\u00a0]{1,3}|[ \t\u00a0]*[-&][ \t\u00a0]*)$/;

/**
 * Person names found by context. Every finding is { kind: 'PERSON', start, end, value, confidence, source: 'prose' }.
 * @param {string} text
 * @param {{ mode?: 'standard' | 'strict' | 'local-only' }} [options] Strict and Local-only also find names with no cue.
 */
export function detectProseNames(text, options = {}) {
  if (typeof text !== 'string' || !text) return [];
  const strict = options.mode === 'strict' || options.mode === 'local-only';
  const level = strict ? 'strict' : 'standard';
  const out = [];
  const seen = new Set();
  const push = (name, confidence) => {
    const key = `${name.start}:${name.end}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind: 'PERSON', start: name.start, end: name.end, value: text.slice(name.start, name.end), confidence, source: 'prose' });
  };

  // Is this parsed name good enough for this cue?
  const accept = (name, type) => {
    if (!name) return false;
    const rule = TYPES[type];
    if (name.words.length < rule.min[level]) return false;
    if (!rule.uncased && !/\p{Lu}/u.test(name.words[0][0])) return false;
    // A weak cue in Standard mode wants a real-looking full name: the first word is not an everyday word ("for Go Live").
    if (rule.plainFirst && !strict && isEnglish(name.words[0])) return false;
    return true;
  };

  // The name after a cue; an honorific in front of it ("spoke with Dr. Priya Raman", "Mr Smith and Dr Jones") is skipped.
  const nameAfter = (at, type) => {
    let j = at;
    const h = stickyAt(HONORIFIC_AHEAD, text, j);
    if (h) j += h[0].length;
    return parseName(text, j, { uncased: TYPES[type].uncased });
  };

  // One cue: the first name, then a list of more ("cc: Anna, Tom and Raj").
  function takeFrom(at, type, confidence) {
    let name = nameAfter(at, type);
    if (!accept(name, type)) return;
    if (TYPES[type].signoff && !signatureTail(text, name.end)) return;
    push(name, confidence);
    for (let n = 0; n < MAX_LIST; n++) {
      let j = name.end;
      if (/^['\u2019]s?/.test(text.slice(j, j + 2))) break; // a possessive ends the list too
      while (isSpace(text[j])) j++;
      const sep = /^(?:,|;|&|\/|and(?![\p{L}])|or(?![\p{L}]))/u.exec(text.slice(j, j + 4));
      if (!sep) break;
      const comma = sep[0] === ',' || sep[0] === ';';
      if (comma && !TYPES[type].commaList && !TYPES[type].colon) break;
      j += sep[0].length;
      if (!isSpace(text[j])) break;
      while (isSpace(text[j])) j++;
      const next = nameAfter(j, type);
      if (!accept(next, type)) break;
      if (comma && !listItemTail(text, next.end)) break;
      push(next, confidence);
      name = next;
    }
  }

  // 1. Cues, found on word tokens.
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    // "Customer's manager is": a possessive word stands for "my/his/her".
    const starts = [[TRIE.kids.get(tokens[i].key), i]];
    if (/'s$/.test(tokens[i].key) && i + 1 < tokens.length && CUE_GAP.test(text.slice(tokens[i].end, tokens[i + 1].start))) starts.push([TRIE.kids.get("'s")?.kids.get(tokens[i + 1].key), i + 1]);
    for (const [first, firstIndex] of starts) {
      let node = first;
      let j = firstIndex;
      const matches = []; // [types, end index]
      while (node) {
        if (node.types) matches.push([node.types, tokens[j].end]);
        if (j + 1 >= tokens.length || !CUE_GAP.test(text.slice(tokens[j].end, tokens[j + 1].start))) break;
        node = node.kids.get(tokens[j + 1].key);
        j++;
      }
      for (const [types, cueEnd] of matches) {
        const cueStart = tokens[i].start;
        for (const type of types) {
          const rule = TYPES[type];
          if (rule.lineStart && !startsLine(text, cueStart)) continue;
          if (rule.honorific) {
            if (!/\p{Lu}/u.test(text[cueStart])) continue; // "Dr", not "dr"
            let k = cueEnd;
            if (text[k] === '.') k++;
            if (!isSpace(text[k])) continue;
            while (isSpace(text[k])) k++;
            takeFrom(k, type, CONFIDENCE.strong);
            continue;
          }
          if (rule.signoff) {
            let k = cueEnd;
            while (isSpace(text[k])) k++;
            if (/[,!.:;]/.test(text[k] || '')) k++;
            while (isSpace(text[k])) k++;
            if (text[k] === '\r') k++;
            if (text[k] === '\n') {
              // The name is on the next line (one blank line allowed).
              k++;
              while (isSpace(text[k])) k++;
              if (text[k] === '\r') k++;
              if (text[k] === '\n') k++;
              while (isSpace(text[k])) k++;
            } else if (!/[,!.:;]/.test(text[cueEnd] || '') && !isSpace(text[cueEnd])) {
              continue;
            }
            takeFrom(k, type, CONFIDENCE.strong);
            continue;
          }
          const k = skipAfterCue(text, cueEnd, { colon: rule.colon });
          if (k === -1) continue;
          takeFrom(k, type, type === 'weak' ? CONFIDENCE.weak : CONFIDENCE.strong);
        }
      }
    }
  }

  // 2. A signature after "--" on its own line.
  for (let at = text.indexOf('--'); at !== -1; at = text.indexOf('--', at + 2)) {
    if (!startsLine(text, at) || text[at - 1] === '-') continue;
    let k = at + 2;
    while (isSpace(text[k])) k++;
    if (text[k] === '\r') k++;
    if (text[k] !== '\n') continue;
    k++;
    while (isSpace(text[k])) k++;
    takeFrom(k, 'signoff', CONFIDENCE.strong);
  }

  // 3. @mentions: "@Kevin Lee", "@kevin.lee". An "@" inside a word belongs to an email address.
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (at > 0 && /[\p{L}\p{N}._%+-]/u.test(text[at - 1])) continue;
    const name = parseName(text, at + 1, { uncased: true, maxWords: 3 });
    if (name && name.start === at + 1) {
      push(name, CONFIDENCE.strong);
      continue;
    }
    const handle = /\p{L}[\p{L}\p{N}._-]{1,40}/uy;
    handle.lastIndex = at + 1;
    const h = handle.exec(text);
    if (!h) continue;
    const value = h[0].replace(/[._-]+$/, '');
    const lower = value.toLowerCase();
    const last = lower.split('.').pop();
    if (value.length < 2 || NOT_A_HANDLE.has(lower) || isStopWord(value) || text[at + 1 + h[0].length] === '@') continue;
    if (lower.includes('.') && DOMAIN_ENDINGS.has(last)) continue; // "@example.com" is a domain
    if (/^\d+$/.test(value)) continue;
    push({ start: at + 1, end: at + 1 + value.length }, CONFIDENCE.strong);
  }

  // 4. Strict: a run of two to four capitalised name words with no cue, none of them vocabulary. A run that starts with an everyday
  // word or a cue word ("Emailed Connor O'Brien", "Hola José") is looked at again from its next word.
  if (strict) {
    for (let i = 0; i < text.length; ) {
      if (isLetterOrDigit(text[i - 1]) || !/\p{Lu}/u.test(text[i] || '')) {
        i++;
        continue;
      }
      const name = parseName(text, i, { uncased: false });
      if (name && name.words.length >= 2 && !isEnglish(name.words[0]) && !TRIE.kids.has(fold(name.words[0]))) {
        push(name, CONFIDENCE.uncued);
        i = name.end;
      } else {
        i++;
      }
    }
  }

  // One finding per place: where two cues found overlapping names, the surer one wins, then the longer.
  return resolveOverlaps(out);
}

/**
 * Does `text` look like a person's name on its own (one to four capitalised name words, no vocabulary)? Used to choose the
 * placeholder for text the person masks by hand in the preview.
 */
export function looksLikeName(text) {
  const s = String(text ?? '').trim();
  if (!s || s.length > 80) return false;
  const name = parseName(s, 0, { uncased: true });
  return Boolean(name && name.start === 0 && name.end === s.length && name.words.length >= 1);
}

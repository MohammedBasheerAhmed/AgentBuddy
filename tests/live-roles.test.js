const test = require('node:test');
const assert = require('node:assert/strict');
import { loadBridge } from './bridge-fixtures.js';

// Wave 4, live checks of 2026-11-07 (docs/live-checks-2026-11-07.md): where g_user is on a ServiceNow page. The classic home page (a UI
// page, /ui_page.do) has none in the TOP window but one in its inner frame; Next Experience record pages and Workspaces have none in the
// top window, and NOW.user there has only userID and isImpersonating. The bridge looks for g_user in same-origin child frames when the
// page has no form window, and says "not known" (null) when there is none anywhere. Roles are never guessed.

const ADMIN = { userName: 'admin', userID: 'a'.repeat(32), firstName: 'System', lastName: 'Administrator', getRoles: () => ['admin', 'itil'], hasRoleExactly: () => true };
const ITIL = { userName: 'itil', userID: 'b'.repeat(32), firstName: 'ITIL', lastName: 'User', roles: ['itil'] };

/** A page with the given child frames (each: { g_user?, frames? } or a function that makes one). */
function pageWith(frames, extra = {}) {
  const page = loadBridge({ ...extra });
  page.window.frames = frames;
  return page;
}
const infoOf = (frames, extra) => pageWith(frames, extra).ask('getSessionInfo');

/** A frame of another origin: asking it anything throws, as the browser does. */
const crossOrigin = () =>
  new Proxy(
    {},
    {
      get() {
        throw new Error('SecurityError: Blocked a frame from accessing a cross-origin frame.');
      },
    }
  );

test('the classic home page: no g_user in the top window, one in the inner frame, and its roles are reported', () => {
  const info = infoOf([{ g_user: ADMIN, frames: [] }]);
  assert.equal(info.userId, 'a'.repeat(32));
  assert.equal(info.userName, 'admin');
  assert.equal(info.firstName, 'System');
  assert.deepEqual(info.roles, ['admin', 'itil'], 'from getRoles() of the frame\'s g_user');
  // a plain agent: the roles property
  assert.deepEqual(infoOf([{ g_user: ITIL }]).roles, ['itil']);
});

test('the first frame that has a g_user is the one used; frames without one are passed over', () => {
  const info = infoOf([{ frames: [] }, { g_user: ITIL }, { g_user: ADMIN }]);
  assert.equal(info.userName, 'itil');
  assert.deepEqual(info.roles, ['itil']);
});

test('a g_user in the top window comes first, and a form window\'s g_user comes before any other frame\'s', () => {
  const top = loadBridge({ g_user: ITIL });
  top.window.frames = [{ g_user: ADMIN }];
  assert.equal(top.ask('getSessionInfo').userName, 'itil');
  const gsft = { g_user: ITIL, g_form: { getValue: () => '', getTableName: () => 'incident', getUniqueValue: () => 'c'.repeat(32) } };
  const form = loadBridge({});
  form.window.frames = [{ g_user: ADMIN }];
  form.window.frames.gsft_main = gsft;
  assert.equal(form.ask('getSessionInfo').userName, 'itil', 'the form frame\'s person, not an unrelated frame\'s');
});

test('the classic frame is reached by its name too (on Next Experience it sits inside a shadow root), and a cross-origin one by that name is skipped', () => {
  const named = pageWith([]);
  named.window.frames.gsft_main = { g_user: ADMIN };
  assert.equal(named.ask('getSessionInfo').userName, 'admin');
  const foreign = pageWith([{ g_user: ITIL }]);
  foreign.window.frames.gsft_main = crossOrigin();
  assert.equal(foreign.ask('getSessionInfo').userName, 'itil', 'the named frame is another origin: the next frame is looked at');
});

test('frames inside frames are looked at, breadth first and only three levels deep', () => {
  const deep = (levels, user) => {
    let frame = { g_user: user };
    for (let i = 1; i < levels; i++) frame = { frames: [frame] };
    return frame;
  };
  assert.equal(infoOf([deep(1, ADMIN)]).userName, 'admin', 'a frame');
  assert.equal(infoOf([deep(2, ADMIN)]).userName, 'admin', 'a frame in a frame');
  assert.equal(infoOf([deep(3, ADMIN)]).userName, 'admin', 'three levels');
  assert.equal(infoOf([deep(4, ADMIN)]), null, 'a fourth level is not searched: unknown');
  // the shallower person wins over a deeper one
  assert.equal(infoOf([{ frames: [{ g_user: ADMIN }] }, { g_user: ITIL }]).userName, 'itil');
});

test('only twenty frames of a window are looked at', () => {
  const crowd = Array.from({ length: 20 }, () => ({}));
  assert.equal(infoOf([...crowd, { g_user: ADMIN }]), null);
  assert.equal(infoOf([...crowd.slice(1), { g_user: ADMIN }]).userName, 'admin');
});

test('a frame of another origin is skipped without a word, and a later one is still found', () => {
  const info = infoOf([crossOrigin(), { frames: crossOrigin() }, { g_user: ITIL }]);
  assert.equal(info.userName, 'itil');
  assert.equal(infoOf([crossOrigin()]), null);
  // a frame whose frames cannot be listed does not stop the search
  assert.equal(infoOf([{ get frames() { throw new Error('SecurityError'); } }, { g_user: ADMIN }]).userName, 'admin');
});

test('no g_user anywhere: nobody is named and the roles are unknown, never "none"', () => {
  assert.equal(infoOf([]), null);
  assert.equal(infoOf([{}, { frames: [{}] }]), null);
  // something that is not an object is not a g_user
  assert.equal(infoOf([{ g_user: 'admin' }, { g_user: 7 }, { g_user: null }]), null);
  // a g_user with no way to say its roles: the person is known, the roles are not
  const info = infoOf([{ g_user: { userName: 'abel', userID: 'c'.repeat(32) } }]);
  assert.equal(info.userId, 'c'.repeat(32));
  assert.equal(info.roles, null);
});

test('the roles of a frame\'s g_user are read the ways the top window\'s are (a fixed list with hasRoleExactly, empty only when asked)', () => {
  const asked = [];
  const probing = { userName: 'sam', userID: 'd'.repeat(32), hasRoleExactly: (name) => (asked.push(name), name === 'itil'), hasRole: () => { throw new Error('never hasRole'); } };
  assert.deepEqual(infoOf([{ g_user: probing }]).roles, ['itil']);
  assert.ok(asked.length >= 15 && asked.every((name) => /^[a-z][a-z0-9_.]*$/.test(name)));
  assert.deepEqual(infoOf([{ g_user: { userName: 'sam', userID: 'd'.repeat(32), hasRoleExactly: () => false } }]).roles, []);
});

// ---- Workspaces and Next Experience: no g_user at all ---------------------------------------------------------------------------------------

test('a Workspace: no g_user anywhere, NOW.user has the id and nothing else; the id is reported and the roles stay unknown', () => {
  const info = infoOf([], { pathname: '/now/sow/home', NOW: { user: { userID: 'e'.repeat(32), isImpersonating: false } } });
  assert.equal(info.userId, 'e'.repeat(32));
  assert.equal(info.roles, null);
  assert.ok(!('isImpersonating' in info), 'only the four things the panel uses');
  assert.deepEqual(Object.keys(info).sort(), ['displayName', 'firstName', 'lastName', 'roles', 'userId', 'userName']);
  // impersonating changes nothing here: it is not read
  assert.equal(infoOf([], { NOW: { user: { userID: 'e'.repeat(32), isImpersonating: true } } }).roles, null);
});

test('a Workspace inside frames that carry no g_user either: the same answer', () => {
  const info = infoOf([{}, { frames: [{}] }], { pathname: '/now/sow/record/incident/xyz', NOW: { user: { userID: 'e'.repeat(32), isImpersonating: false } } });
  assert.equal(info.userId, 'e'.repeat(32));
  assert.equal(info.roles, null);
});

test('a frame\'s g_user wins over NOW.user for the roles, and the two never mix the wrong person\'s roles in', () => {
  const info = infoOf([{ g_user: ITIL }], { NOW: { user: { userID: 'e'.repeat(32), isImpersonating: false } } });
  assert.equal(info.userId, 'b'.repeat(32), 'the g_user\'s own id');
  assert.deepEqual(info.roles, ['itil']);
});

test('nothing is asked of the instance: the search of frames is page memory only', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'page', 'bridge.js'), 'utf8');
  const start = source.indexOf('function childFrames');
  const body = source.slice(start, source.indexOf('// ---- Who is signed in, on pages without g_user'));
  assert.ok(body.length > 200);
  assert.ok(!/\bfetch\(|XMLHttpRequest|\.click\(|\.submit\(|postMessage|eval\(|innerHTML|contentDocument/.test(body));
});

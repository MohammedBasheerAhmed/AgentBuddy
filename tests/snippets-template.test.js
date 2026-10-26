import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSnippet, listVariables, buildVariables, BUILTIN_VARIABLES } from '../src/snippets/render.js';

const cp = (...codes) => String.fromCodePoint(...codes);

const VARS = {
  caller: { first_name: 'Abel', last_name: 'Tuter', name: 'Abel Tuter' },
  number: 'INC0010001',
  count: 3,
  flag: false,
};

// ---- Filling -------------------------------------------------------------------------------------------------------

test('dotted lookups fill from a nested object', () => {
  const r = renderSnippet('Hi {{caller.first_name}}, about {{number}}.', VARS);
  assert.equal(r.text, 'Hi Abel, about INC0010001.');
  assert.deepEqual(r.missing, []);
});

test('whitespace inside the braces is tolerated, names are case-sensitive', () => {
  assert.equal(renderSnippet('{{ caller.first_name }}|{{\tnumber\n}}', VARS).text, 'Abel|INC0010001');
  const r = renderSnippet('{{Caller.first_name}} {{NUMBER}}', VARS);
  assert.equal(r.text, '{{Caller.first_name}} {{NUMBER}}');
  assert.deepEqual(r.missing, ['Caller.first_name', 'NUMBER']);
});

test('values are coerced to strings: numbers, booleans, lists', () => {
  assert.equal(renderSnippet('{{count}} {{flag}} {{tags}}', { ...VARS, tags: ['a', 2, { x: 1 }] }).text, '3 false a, 2');
});

test('fallbacks fill in when the value is missing or empty', () => {
  const r = renderSnippet('Hello {{caller.nickname | there}}, {{ caller.first_name | friend }}!', VARS);
  assert.equal(r.text, 'Hello there, Abel!');
  assert.deepEqual(r.missing, []);
  assert.equal(renderSnippet('[{{x | }}]', {}).text, '[]', 'an empty fallback means "leave blank"');
  assert.equal(renderSnippet('{{x | a | b}}', {}).text, 'a | b');
  assert.equal(renderSnippet('{{x | there}}', { x: '' }).text, 'there');
  assert.equal(renderSnippet('{{x | there}}', { x: '   ' }).text, 'there');
  assert.equal(renderSnippet('{{x | there}}', { x: null }).text, 'there');
});

test('a fallback is literal text: placeholders inside it are not expanded', () => {
  const r = renderSnippet('{{x | use {{number}} }}', VARS);
  // the inner placeholder is the real one; the outer braces stay as text around it
  assert.equal(r.text, '{{x | use INC0010001 }}');
  assert.deepEqual(r.missing, []);
});

test('unknown variables stay visible and are listed once, in order of appearance', () => {
  const r = renderSnippet('{{b}} {{ a }} {{b}} {{caller.first_name}} {{a.b.c}} {{a}}', VARS);
  assert.equal(r.text, '{{b}} {{a}} {{b}} Abel {{a.b.c}} {{a}}');
  assert.deepEqual(r.missing, ['b', 'a', 'a.b.c']);
});

test('a name used once with and once without a fallback is missing only for the one without', () => {
  const r = renderSnippet('{{x | a}} {{x}}', {});
  assert.equal(r.text, 'a {{x}}');
  assert.deepEqual(r.missing, ['x']);
});

test('empty, whitespace-only, null and object values count as missing', () => {
  const r = renderSnippet('{{a}}{{b}}{{c}}{{d}}{{e}}', { a: '', b: '  ', c: null, d: { x: 1 }, e: () => 'run' });
  assert.deepEqual(r.missing, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(r.text, '{{a}}{{b}}{{c}}{{d}}{{e}}');
});

// ---- No code, no recursion -----------------------------------------------------------------------------------------

test('a value that contains placeholders is inserted literally and never expanded', () => {
  const r = renderSnippet('{{a}} / {{b}}', { a: '{{b}}', b: 'second' });
  assert.equal(r.text, '{{b}} / second');
  assert.deepEqual(r.missing, [], 'text inserted from a value is not scanned');
  const loop = renderSnippet('{{a}}', { a: '{{a}}' });
  assert.equal(loop.text, '{{a}}');
  assert.deepEqual(loop.missing, []);
});

test('no code runs: expressions, calls, prototypes and getters are all inert', () => {
  let ran = false;
  const vars = {
    fn: () => {
      ran = true;
      return 'x';
    },
    nested: { fn() { ran = true; return 'x'; } },
  };
  Object.defineProperty(vars, 'sneaky', { enumerable: true, get() { ran = true; return 'got'; } });
  const template = '{{fn}} {{fn()}} {{nested.fn}} {{sneaky}} {{constructor}} {{__proto__}} {{toString}} {{a.constructor.name}} {{1+1}} {{ process.exit() }} {{`x`}} {{ ${1} }}';
  const r = renderSnippet(template, vars);
  assert.equal(ran, false);
  assert.ok(!r.text.includes('got'));
  assert.ok(!r.text.includes('function'));
  assert.ok(!r.text.includes('[object'));
  assert.ok(r.text.includes('{{fn()}}'), 'invalid placeholders stay as written');
  assert.ok(r.text.includes('{{1+1}}'));
  assert.ok(!r.missing.some((n) => /[()+`]/.test(n)), 'only well-formed names are reported');
  assert.deepEqual(r.missing, ['fn', 'nested.fn', 'sneaky', 'constructor', '__proto__', 'toString', 'a.constructor.name']);
});

test('inherited and prototype properties are not readable', () => {
  const base = { secret: 'hidden' };
  const child = Object.create(base);
  child.own = 'yes';
  const r = renderSnippet('{{own}} {{secret}} {{x.length}}', { ...child, x: 'abc' });
  assert.equal(r.text, 'yes {{secret}} {{x.length}}');
  assert.equal(renderSnippet('{{length}}', 'abc').text, '{{length}}', 'a string is not a variables object');
  assert.equal(renderSnippet('{{a}}', null).text, '{{a}}');
  assert.equal(renderSnippet('{{a}}', undefined).text, '{{a}}');
});

test('a polluted __proto__ key from JSON is not followed', () => {
  const vars = JSON.parse('{"__proto__": {"name": "x"}, "ok": "fine"}');
  const r = renderSnippet('{{__proto__.name}} {{ok}}', vars);
  assert.equal(r.text, '{{__proto__.name}} fine');
});

test('values lose control and direction-changing characters; very long values are cut', () => {
  const dirty = `a${cp(0x202e)}b${cp(0x200b)}c${cp(7)}d`;
  assert.equal(renderSnippet('{{v}}', { v: dirty }).text, 'abcd');
  assert.equal(renderSnippet('{{v}}', { v: 'x'.repeat(50000) }).text.length, 2000);
});

test('output is capped so a template cannot multiply a value without limit', () => {
  const template = '{{v}}'.repeat(5000);
  const r = renderSnippet(template, { v: 'y'.repeat(2000) });
  assert.ok(r.text.length <= 100000);
});

test('non-string templates do not throw', () => {
  assert.deepEqual(renderSnippet(undefined, VARS), { text: '', missing: [] });
  assert.deepEqual(renderSnippet(null, VARS), { text: '', missing: [] });
  assert.equal(renderSnippet(12, VARS).text, '12');
  assert.deepEqual(renderSnippet('', VARS), { text: '', missing: [] });
});

// ---- Placeholder syntax --------------------------------------------------------------------------------------------

test('malformed or unclosed braces stay as written', () => {
  assert.equal(renderSnippet('a {{ b', VARS).text, 'a {{ b');
  assert.equal(renderSnippet('a }} b {{', VARS).text, 'a }} b {{');
  assert.equal(renderSnippet('{{}} {{ }} {{|x}}', VARS).text, '{{}} {{ }} {{|x}}');
  assert.equal(renderSnippet('{ {number} }', VARS).text, '{ {number} }');
  assert.equal(renderSnippet('{{{number}}}', VARS).text, '{INC0010001}');
  assert.deepEqual(renderSnippet('{{}} {{ }}', VARS).missing, []);
});

test('listVariables: unique names in order of first use, fallbacks do not matter', () => {
  assert.deepEqual(listVariables('{{b}} {{a | x}} {{b}} {{ c.d }} {{1+1}} {{a}}'), ['b', 'a', 'c.d']);
  assert.deepEqual(listVariables('no variables here'), []);
  assert.deepEqual(listVariables(undefined), []);
});

test('hostile braces run in linear time', () => {
  const inputs = [
    '{{'.repeat(150000),
    '{{ x '.repeat(60000),
    `${'{{'.repeat(100000)}}}`,
    `{{${'a'.repeat(300000)}}}`,
    '}}'.repeat(150000),
    '{{a}}'.repeat(60000),
    '{{a|'.repeat(75000),
    `${'{{ '.repeat(1000)}${'a'.repeat(2000)}`.repeat(100),
  ];
  for (const input of inputs) {
    const started = performance.now();
    renderSnippet(input, { a: 'v' });
    listVariables(input);
    const ms = performance.now() - started;
    assert.ok(ms < 500, `${input.slice(0, 12)}: ${Math.round(ms)} ms`);
  }
});

// ---- Built-in variables --------------------------------------------------------------------------------------------

test('BUILTIN_VARIABLES documents the twelve names', () => {
  assert.deepEqual(
    BUILTIN_VARIABLES.map((v) => v.name),
    ['caller.first_name', 'caller.last_name', 'caller.name', 'number', 'short_description', 'state', 'priority', 'assigned_to.name', 'agent.first_name', 'agent.name', 'sla.due', 'today']
  );
  for (const v of BUILTIN_VARIABLES) {
    assert.ok(v.description.length > 3);
    assert.ok(v.example);
  }
  assert.ok(Object.isFrozen(BUILTIN_VARIABLES));
});

const PACK = {
  version: 1,
  table: 'incident',
  number: 'INC0010001',
  kind: 'incident',
  fields: { short_description: 'Cannot connect to VPN', state: 'In Progress', priority: '2 - High', sla_due: '2026-10-27 09:00:00' },
  people: [
    { role: 'opened_by', name: 'Someone Else', email: 'x@example.com' },
    { role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' },
    { role: 'assigned_to', name: 'Beth Anglin', email: 'beth@example.com' },
  ],
};

test('buildVariables maps a ContextPack and the agent to the nested names', () => {
  const vars = buildVariables(PACK, { name: 'Fred Luddy', first_name: 'Fred' }, new Date(2026, 9, 26, 12));
  assert.deepEqual(vars, {
    caller: { first_name: 'Abel', last_name: 'Tuter', name: 'Abel Tuter' },
    number: 'INC0010001',
    short_description: 'Cannot connect to VPN',
    state: 'In Progress',
    priority: '2 - High',
    assigned_to: { name: 'Beth Anglin' },
    sla: { due: '2026-10-27 09:00:00' },
    agent: { first_name: 'Fred', name: 'Fred Luddy' },
    today: '2026-10-26',
  });
  const out = renderSnippet(BUILTIN_VARIABLES.map((v) => `{{${v.name}}}`).join('|'), vars);
  assert.deepEqual(out.missing, []);
  assert.equal(out.text.split('|').length, 12);
});

test('buildVariables tolerates missing data: absent pieces stay missing, nothing throws', () => {
  for (const [pack, agent] of [[undefined, undefined], [null, null], [{}, {}], [{ fields: null, people: 'x', related: 5 }, 'nope'], [[], []]]) {
    const vars = buildVariables(pack, agent, new Date(2026, 0, 5));
    assert.equal(vars.today, '2026-01-05');
    assert.equal(vars.caller, undefined);
    assert.equal(vars.number, undefined);
  }
  const r = renderSnippet('Hi {{caller.first_name | there}}, {{agent.first_name | }}', buildVariables({}, {}));
  assert.equal(r.text, 'Hi there, ');
  assert.deepEqual(r.missing, []);
});

test('buildVariables: names, caller roles and the agent', () => {
  assert.deepEqual(buildVariables({ people: [{ role: 'caller', name: 'Madonna' }] }, {}).caller, { first_name: 'Madonna', name: 'Madonna' });
  assert.deepEqual(buildVariables({ people: [{ role: 'caller', name: 'Tuter, Abel' }] }, {}).caller, { first_name: 'Abel', last_name: 'Tuter', name: 'Tuter, Abel' });
  assert.deepEqual(buildVariables({ people: [{ role: 'caller', name: 'Mary Jane van Dyke' }] }, {}).caller, { first_name: 'Mary', last_name: 'Jane van Dyke', name: 'Mary Jane van Dyke' });
  assert.equal(buildVariables({ people: [{ role: 'requested_for', name: 'Req Uester' }] }, {}).caller.first_name, 'Req');
  assert.equal(buildVariables({ people: [{ role: 'opened_by', name: 'Not Caller' }] }, {}).caller, undefined);
  assert.deepEqual(buildVariables({}, { name: 'Fred Luddy' }).agent, { first_name: 'Fred', name: 'Fred Luddy' });
  assert.deepEqual(buildVariables({}, { first_name: 'Fred', last_name: 'Luddy' }).agent, { first_name: 'Fred', name: 'Fred Luddy' });
  assert.equal(buildVariables({ fields: { assigned_to: 'Field Person' } }, {}).assigned_to.name, 'Field Person');
});

test('buildVariables: sla.due falls back to the earliest open related SLA', () => {
  const pack = {
    related: {
      slas: [
        { due: '2026-10-30 10:00:00', stage: 'In progress' },
        { due: '2026-10-28 08:00:00', stage: 'In progress' },
        { due: '2026-10-25 08:00:00', has_breached: 'true' },
        { due: '2026-10-24 08:00:00', stage: 'Completed' },
      ],
    },
  };
  assert.equal(buildVariables(pack, {}).sla.due, '2026-10-28 08:00:00');
  assert.equal(buildVariables({ related: { slas: [] } }, {}).sla, undefined);
});

test('buildVariables returns plain strings only, and a fresh object each time', () => {
  const a = buildVariables(PACK, {});
  const b = buildVariables(PACK, {});
  assert.notEqual(a, b);
  const walk = (o) => Object.values(o).forEach((v) => (typeof v === 'object' ? walk(v) : assert.equal(typeof v, 'string')));
  walk(a);
});

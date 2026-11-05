// The Crew page core (members/crew.js). Run: node --test tests/crew.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mod = { exports: {} };
new Function('module', fs.readFileSync(path.join(__dirname, '..', 'members', 'crew.js'), 'utf8'))(mod);
const C = mod.exports;

test('best lap over all sessions, ignoring bad entries', () => {
  const car = { sessions: [{ laps: '1:42.5, 1:41.9 junk' }, { laps: '1:41.75;1:75.0' }, { laps: '' }, {}] };
  assert.equal(C.bestLap(car), 101.75);
  assert.equal(C.fmtLap(101.75), '1:41.750');
  assert.equal(C.fmtLap(58.2), '58.200');
  assert.equal(C.bestLap({ sessions: [] }), null);
  assert.equal(C.fmtLap(null), '');
});

test('last session is the latest date', () => {
  assert.equal(C.lastSession({ sessions: [{ id: 'a', date: '2026-06-01' }, { id: 'b', date: '2026-07-04' }, { id: 'c', date: '2026-05-01' }] }).id, 'b');
  assert.equal(C.lastSession({}), null);
});

test('shares grouped by car; candidates exclude me and the current crew', () => {
  const by = C.sharesByCar([{ car_id: 'c1', crew_id: 'b' }, { car_id: 'c1', crew_id: 'c' }, { car_id: 'c2', crew_id: 'b' }]);
  assert.deepEqual(by, { c1: ['b', 'c'], c2: ['b'] });
  const members = [{ id: 'a', name: 'Me' }, { id: 'b', name: 'Bea' }, { id: 'c', name: 'Cam' }, { id: 'd', name: 'Dee' }];
  assert.deepEqual(C.candidates(members, 'a', by.c1).map(m => m.id), ['d']);
  assert.deepEqual(C.candidates(members, 'a', undefined).map(m => m.id), ['b', 'c', 'd']);
});

test('crew page hands the cars to the Setup Log without breaking out of the script', () => {
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
  const out = C.crewPage(html, 'Alex', [{ id: 'c1', name: '</script><script>alert(1)</script>' }]);
  assert.ok(out.startsWith('<!doctype html><html><head><script>window.RACEME_CREW = '));
  assert.equal((out.match(/<\/script>/g) || []).length, 1, 'only the closing tag of the injected script');
  const json = out.match(/window.RACEME_CREW = (.*?);<\/script>/)[1];
  assert.equal(JSON.parse(json).cars[0].name, '</script><script>alert(1)</script>');
  assert.equal(JSON.parse(json).owner, 'Alex');
});

test('names are escaped', () => {
  assert.equal(C.esc('<b>"x"&\''), '&lt;b&gt;&quot;x&quot;&amp;&#39;');
  assert.equal(C.carName({ name: 'MX-5', number: '42' }), 'MX-5 #42');
  assert.equal(C.carName(null), 'Car');
});

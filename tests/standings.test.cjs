// Season standings core (standings/standings.js). Run: node --test tests/standings.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mod = { exports: {} };
new Function('module', fs.readFileSync(path.join(__dirname, '..', 'standings', 'standings.js'), 'utf8'))(mod);
const S = mod.exports;
const R = { first: 'Ann', second: 'Ben', third: 'Cat', fastest: 'Dan' };

test('scoring matches standings.sql: 5 exact, 2 on the podium elsewhere, 3 fastest lap', () => {
  assert.equal(S.score({ first: 'Ann', second: 'Ben', third: 'Cat', fastest: 'Dan' }, R), 18);
  assert.equal(S.score({ first: 'Ben', second: 'Ann', third: 'Dan', fastest: 'Dan' }, R), 7);
  assert.equal(S.score({ first: 'Cat', second: '', third: '', fastest: '' }, R), 2);
  assert.equal(S.score({ first: 'Zed', second: 'Yan', third: 'Xi', fastest: 'Ann' }, R), 0);
  assert.equal(S.score({ first: 'Ann' }, null), null, 'no results yet');
});

test('entry list: one per line or comma separated, trimmed, no repeats', () => {
  assert.deepEqual(S.parseEntrants(' Ann  Lee \nBen, Cat\n\nAnn Lee\n  '), ['Ann Lee', 'Ben', 'Cat']);
  assert.deepEqual(S.parseEntrants(''), []);
});

test('ties share a place', () => {
  assert.deepEqual(S.ranks([{ points: 20, exact: 3 }, { points: 20, exact: 3 }, { points: 20, exact: 1 }, { points: 7, exact: 0 }]), [1, 1, 3, 4]);
});

test('picks close at 8 am on the event day by default', () => {
  assert.equal(S.defaultClose('2026-05-01'), '2026-05-01T08:00');
  assert.equal(S.defaultClose(''), '');
  assert.equal(S.localInput(new Date(2026, 4, 1, 7, 5)), '2026-05-01T07:05');
});

// The Deals page core (members/deals.js). Run: node --test tests/deals.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mod = { exports: {} };
new Function('module', fs.readFileSync(path.join(__dirname, '..', 'members', 'deals.js'), 'utf8'))(mod);
const D = mod.exports;

test('money rounds to whole dollars with separators', () => {
  assert.equal(D.money(10500), '$10,500');
  assert.equal(D.money(14999.6), '$15,000');
  assert.equal(D.money(null), '$0');
});

test('sale prices accept $ and commas, reject nonsense', () => {
  assert.equal(D.parsePrice('$12,500'), 12500);
  assert.equal(D.parsePrice(' 9800 '), 9800);
  assert.equal(D.parsePrice('abc'), null);
  assert.equal(D.parsePrice('-5'), null);
  assert.equal(D.parsePrice('0'), null);
  assert.equal(D.parsePrice('20000000'), null);
});

test('only https listing links are allowed', () => {
  assert.equal(D.safeUrl('https://www.ebay.com/itm/1'), 'https://www.ebay.com/itm/1');
  assert.equal(D.safeUrl('javascript:alert(1)'), '');
  assert.equal(D.safeUrl('http://example.com'), '');
});

test('vote and sale summaries', () => {
  assert.equal(D.voteLine({ yes: 3, maybe: 1, no: 0 }), "Club: 3 would buy · 1 maybe · 0 wouldn't");
  assert.equal(D.voteLine(null), 'No votes yet');
  assert.equal(D.salesLine([14000, 13500]), 'Reported sold for $14,000, $13,500');
  assert.equal(D.salesLine([]), '');
});

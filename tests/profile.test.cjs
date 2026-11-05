// Profile validation in members/profile.js. Run: node --test tests/profile.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mod = { exports: {} };
new Function('module', fs.readFileSync(path.join(__dirname, '..', 'members', 'profile.js'), 'utf8'))(mod);
const P = mod.exports;
const now = new Date('2026-11-05T12:00:00Z');
const good = () => ({ ...P.blank(), first_name: ' Alex ', last_name: 'Driver', phone: '(719) 555-0100', address_line1: '1 Main St', city: 'Colorado Springs',
  state: 'CO', postal_code: '80903', emergency_name: 'Sam Driver', emergency_phone: '719.555.0101', emergency_relationship: 'Spouse', discord: '@alexd',
  experience: 'track', track_days: '12', cars: [{ year: '2019', make: 'Mazda', model: 'MX-5', mods: 'Coilovers' }, { year: '', make: '', model: '', mods: '' }], age_21: true, rules: true });

test('a complete form becomes a clean row', () => {
  const { row, errors } = P.validate(good(), { now });
  assert.deepEqual(errors, {});
  assert.equal(row.first_name, 'Alex');
  assert.equal(row.discord, 'alexd');
  assert.equal(row.track_days, 12);
  assert.equal(row.address_line2, null);
  assert.deepEqual(row.cars, [{ year: 2019, make: 'Mazda', model: 'MX-5', mods: 'Coilovers' }], 'blank extra car rows are dropped');
  assert.equal(row.rules_accepted_at, now.toISOString());
  assert.equal(P.validate(good(), { now, acceptedAt: '2026-01-01T00:00:00Z' }).row.rules_accepted_at, '2026-01-01T00:00:00Z', 'keeps the first agreement date');
});

test('missing and bad fields are reported by name', () => {
  const f = { ...good(), first_name: ' ', phone: '555', experience: 'pro', track_days: '2.5', age_21: false, rules: false,
    cars: [{ year: '1850', make: 'Ford', model: '', mods: '' }] };
  const { row, errors } = P.validate(f, { now });
  assert.equal(row, null);
  for (const k of ['first_name', 'phone', 'experience', 'track_days', 'age_21', 'rules', 'cars.0.year', 'cars.0.model']) assert.ok(errors[k], 'expected error for ' + k);
  assert.ok(!errors['cars.0.make']);
  assert.ok(P.validate({ ...good(), cars: [{ year: '', make: '', model: '', mods: '' }] }, { now }).errors['cars.0.year'], 'needs at least one car');
  assert.ok(P.validate({ ...good(), cars: [{ year: '2028', make: 'X', model: 'Y' }] }, { now }).errors['cars.0.year'], 'year too far ahead');
  assert.ok(!P.validate({ ...good(), cars: [{ year: '2027', make: 'X', model: 'Y' }] }, { now }).errors['cars.0.year'], 'next model year is fine');
});

test('a saved row loads back into the form', () => {
  const { row } = P.validate(good(), { now });
  const f = P.toForm(row);
  assert.equal(f.track_days, '12');
  assert.equal(f.cars[0].year, '2019');
  assert.equal(f.rules, true);
  assert.deepEqual(P.validate(f, { now, acceptedAt: row.rules_accepted_at }).row, row, 'round trip');
  assert.deepEqual(P.toForm(null), P.blank());
});

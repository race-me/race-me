// Admin panel core (members/admin.js). Run: node --test tests/admin.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mod = { exports: {} };
new Function('module', fs.readFileSync(path.join(__dirname, '..', 'members', 'admin.js'), 'utf8'))(mod);
const A = mod.exports;
const alex = { user_id: 'a', email: 'alex@x.com', invited_at: '2026-11-01T00:00:00Z', last_sign_in_at: '2026-11-04T00:00:00Z',
  profile: { first_name: 'Alex', last_name: 'Driver', phone: '719-555-0100', city: 'Colorado Springs', state: 'CO', postal_code: '80903', address_line1: '1 Main', country: 'USA',
    emergency_name: 'Sam', emergency_phone: '719-555-0101', emergency_relationship: 'Spouse', experience: 'track', track_days: 12, age_21: true,
    rules_accepted_at: '2026-11-04T10:00:00Z', cars: [{ year: 2019, make: 'Mazda', model: 'MX-5', mods: 'Coilovers, "big" brakes' }] } };
const invited = { user_id: 'b', email: 'new@x.com', invited_at: '2026-11-05T00:00:00Z', last_sign_in_at: null, profile: null };
const noProfile = { user_id: 'c', email: 'np@x.com', last_sign_in_at: '2026-11-05T00:00:00Z', profile: null };

test('status, name and search', () => {
  assert.deepEqual([alex, invited, noProfile].map(m => A.status(m).key), ['active', 'invited', 'noprofile']);
  assert.equal(A.name(alex), 'Alex Driver');
  assert.equal(A.cars(alex), '2019 Mazda MX-5');
  assert.ok(A.matches(alex, 'mx-5') && A.matches(alex, 'DRIVER') && A.matches(alex, '555-0100') && A.matches(alex, ''));
  assert.ok(!A.matches(invited, 'mazda') && A.matches(invited, 'new@'));
});

test('CSV quotes every cell, escapes quotes, and defuses spreadsheet formulas', () => {
  const evil = { ...alex, profile: { ...alex.profile, first_name: '=HYPERLINK("http://x","click")', last_name: '+1' } };
  const csv = A.toCsv([alex, evil, invited]);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^"First name","Last name","Email"/);
  assert.match(lines[1], /"Coilovers, ""big"" brakes"/);
  assert.match(lines[1], /"2019 Mazda MX-5"/);
  assert.match(lines[2], /^"'=HYPERLINK\(""http:\/\/x"",""click""\)","'\+1"/);
  assert.match(lines[3], /"Invited, not signed in yet"/);
});

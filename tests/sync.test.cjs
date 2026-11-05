// Sync logic for members/sync.js with two fake devices and a fake server. Run: node --test tests/sync.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mod = { exports: {} };
new Function('module', fs.readFileSync(path.join(__dirname, '..', 'members', 'sync.js'), 'utf8'))(mod);
const core = mod.exports;

const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
// Postgres jsonb returns object keys sorted (shorter keys first, then by bytes); mimic that so hashes can't rely on order.
const jsonb = v => Array.isArray(v) ? v.map(jsonb) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map(k => [k, jsonb(v[k])])) : v;
const server = () => {
  const rows = new Map(); let t = 0; const calls = { push: 0 };
  return { calls, rows, list: async () => [...rows.values()].map(r => JSON.parse(JSON.stringify(r))),
    push: async (tool, data) => { calls.push++; const r = { tool, data: jsonb(JSON.parse(JSON.stringify(data))), updated_at: 't' + (++t) }; rows.set(tool, r); return r.updated_at; } };
};
const log = (sessions, extra = {}) => JSON.stringify({ v: 1, units: 'imp', carId: 'c1', cars: [{ id: 'c1', name: 'MR2', setup: { 'camber.LF': -2.5 }, sessions: sessions.map(id => ({ id, track: 'PPIR' })) }], ...extra });
const ids = s => JSON.parse(s.getItem('raceme.setuplog.v1')).cars[0].sessions.map(x => x.id).sort();

test('first device uploads, second device downloads, then edits flow both ways', async () => {
  const srv = server(), A = store(), B = store();
  A.setItem('raceme.setuplog.v1', log(['s1']));
  A.setItem('sgb.v2.vehicles', JSON.stringify({ v1: { name: 'Supra' } }));
  let r = await core.syncOnce(srv, A);
  assert.deepEqual(r.pushed.sort(), ['setup-log', 'suspension-bench']);
  r = await core.syncOnce(srv, B);
  assert.deepEqual(r.pulled.sort(), ['setup-log', 'suspension-bench']);
  assert.deepEqual(ids(B), ['s1']);
  // nothing changed: no traffic beyond the list
  const before = srv.calls.push;
  for (const d of [A, B, A, B]) { r = await core.syncOnce(srv, d); assert.deepEqual([r.pushed, r.pulled, r.merged], [[], [], []]); }
  assert.equal(srv.calls.push, before);
  // B edits, A (unchanged) receives it
  B.setItem('raceme.setuplog.v1', log(['s1', 's2']));
  r = await core.syncOnce(srv, B); assert.deepEqual(r.pushed, ['setup-log']);
  r = await core.syncOnce(srv, A); assert.deepEqual(r.pulled, ['setup-log']);
  assert.deepEqual(ids(A), ['s1', 's2']);
});

test('both devices changed: merged, nothing lost, backup kept', async () => {
  const srv = server(), A = store(), B = store();
  A.setItem('raceme.setuplog.v1', log(['s1'])); await core.syncOnce(srv, A); await core.syncOnce(srv, B);
  A.setItem('raceme.setuplog.v1', log(['s1', 'a2'])); await core.syncOnce(srv, A);   // A adds a session
  B.setItem('raceme.setuplog.v1', log(['s1', 'b2']));                                 // B adds one offline
  const r = await core.syncOnce(srv, B);
  assert.deepEqual(r.merged, ['setup-log']);
  assert.deepEqual(ids(B), ['a2', 'b2', 's1']);
  assert.ok(JSON.parse(B.getItem('raceme.sync.backup.setup-log')).keys['raceme.setuplog.v1']);
  await core.syncOnce(srv, A);
  assert.deepEqual(ids(A), ['a2', 'b2', 's1']);
});

test('device with its own data meets an existing account: merged on first sign-in', async () => {
  const srv = server(), A = store(), B = store();
  A.setItem('raceme.corner.v1', JSON.stringify({ name: 'MR2', weights: [1, 2, 3, 4], log: [{ id: 'x' }] })); await core.syncOnce(srv, A);
  B.setItem('raceme.corner.v1', JSON.stringify({ name: 'Yaris', weights: [5, 6, 7, 8], log: [{ id: 'y' }] }));
  const r = await core.syncOnce(srv, B);
  assert.deepEqual(r.merged, ['corner-balance']);
  const c = JSON.parse(B.getItem('raceme.corner.v1'));
  assert.equal(c.name, 'Yaris');                        // this device wins on plain settings
  assert.deepEqual(c.log.map(e => e.id), ['y', 'x']);   // logs from both are kept
});

test('bench vehicle maps merge by key; current car stays this device\'s', () => {
  const m = core.merge({ 'sgb.v2.vehicles': { a: 1, b: 2 }, 'sgb.v1.current': { name: 'mine' } }, { 'sgb.v2.vehicles': { b: 9, c: 3 }, 'sgb.v1.current': { name: 'theirs' } });
  assert.deepEqual(m['sgb.v2.vehicles'], { b: 2, c: 3, a: 1 });
  assert.equal(m['sgb.v1.current'].name, 'mine');
});

test('unreadable or untracked storage is ignored', async () => {
  const srv = server(), A = store();
  A.setItem('raceme.corner.v1', '{not json'); A.setItem('something.else', '{"a":1}');
  const r = await core.syncOnce(srv, A);
  assert.deepEqual(r.pushed, []);
  assert.equal(srv.rows.size, 0);
});

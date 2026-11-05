// The Paddock forum core (paddock/forum.js). Run: node --test tests/forum.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mod = { exports: {} };
new Function('module', fs.readFileSync(path.join(__dirname, '..', 'paddock', 'forum.js'), 'utf8'))(mod);
const F = mod.exports;

test('formatting: paragraphs, lists, bold, italic, code, links, mentions', () => {
  const html = F.renderBody('Coilovers in. **Big** day, *finally*.\nSecond line\n\n- springs\n- dampers\n\nSee https://race-me.org/paddock/. Ask @Bea Racer about `M14x1.5` or [the manual](https://x.com/a?b=1&c=2).', ['Bea Racer']);
  assert.equal(html,
    '<p>Coilovers in. <strong>Big</strong> day, <em>finally</em>.<br>Second line</p>' +
    '<ul><li>springs</li><li>dampers</li></ul>' +
    '<p>See <a href="https://race-me.org/paddock/" rel="nofollow ugc noopener" target="_blank">https://race-me.org/paddock/</a>. ' +
    'Ask <span class="mention">@Bea Racer</span> about <code>M14x1.5</code> or ' +
    '<a href="https://x.com/a?b=1&amp;c=2" rel="nofollow ugc noopener" target="_blank">the manual</a>.</p>');
  assert.equal(F.renderBody('2*3*4 and a*b'), '<p>2*3*4 and a*b</p>', 'no italics inside words');
  assert.equal(F.renderBody(''), '');
});

test('formatting can\'t inject HTML or scripts', () => {
  const evil = [
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[x](javascript:alert(1))',
    'https://x.com/"onmouseover="alert(1)', '[a](https://x.com/"><script>alert(1)</script>)', '**<b>bold</b>**',
    '`<i>`', '@<svg onload=alert(1)>',
  ];
  for (const s of evil) {
    const h = F.renderBody(s, ['<svg onload=alert(1)>']);
    assert.ok(!/<(script|img|svg|b|i)\b/i.test(h), 'tag got through: ' + h);
    assert.ok(!/href="javascript:/i.test(h), 'javascript link: ' + h);
    assert.ok(!/<a [^>]*"[^>]*on\w+=/i.test(h.replace(/&quot;/g, '')) || !/" on\w+=/.test(h), 'attribute breakout: ' + h);
    assert.ok(!/ on\w+="/i.test(h), 'event attribute: ' + h);
  }
  assert.equal(F.renderBody('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.equal(F.snippet('<b>[[seat]]</b>'), '&lt;b&gt;<mark>seat</mark>&lt;/b&gt;');
});

test('@mention detection and which picked mentions are still used', () => {
  assert.deepEqual(F.mentionQuery('Ask @Be', 7), { start: 4, q: 'Be' });
  assert.deepEqual(F.mentionQuery('Ask @Bea Ra', 11), { start: 4, q: 'Bea Ra' });
  assert.deepEqual(F.mentionQuery('@', 1), { start: 0, q: '' });
  assert.equal(F.mentionQuery('email me@x.com', 14), null, 'not inside a word');
  assert.equal(F.mentionQuery('Ask @Bea Racer about', 20), null, 'two spaces ends it');
  const picked = new Map([['u1', 'Bea Racer'], ['u2', 'Alex Driver']]);
  assert.deepEqual(F.usedMentions('thanks @Bea Racer', picked), ['u1']);
});

test('routes, photo sizing, money and time', () => {
  assert.deepEqual(F.route('#/'), { view: 'home' });
  assert.deepEqual(F.route('#/s/builds'), { view: 'section', id: 'builds', page: 0 });
  assert.deepEqual(F.route('#/s/classifieds/2'), { view: 'section', id: 'classifieds', page: 2 });
  assert.deepEqual(F.route('#/t/0E1C2D3B-1111-2222-3333-444455556666'), { view: 'thread', id: '0e1c2d3b-1111-2222-3333-444455556666' });
  assert.deepEqual(F.route('#/new/tech'), { view: 'new', id: 'tech' });
  assert.deepEqual(F.route('#/search/coil%20overs'), { view: 'search', q: 'coil overs' });
  assert.deepEqual(F.route('#/t/<script>'), { view: 'home' });
  assert.deepEqual(F.fit(4032, 3024), { w: 1600, h: 1200 });
  assert.deepEqual(F.fit(800, 600), { w: 800, h: 600 });
  assert.equal(F.money(400), '$400');
  assert.equal(F.money(''), '');
  const now = Date.parse('2026-11-05T12:00:00Z');
  assert.equal(F.ago('2026-11-05T11:59:30Z', now), 'just now');
  assert.equal(F.ago('2026-11-05T09:00:00Z', now), '3 h ago');
});

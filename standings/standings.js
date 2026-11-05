/* Race Me season standings: members pick the podium and fastest lap before each event; the admin enters results;
   picks are scored and ranked. Bragging rights only. Data: supabase/standings.sql in race-me/members-src
   (tables season_events and season_picks; functions standings, standings_pick). Loaded by standings/index.html. */
(() => {
  /* ---------- core (no DOM; tested in tests/standings.test.cjs) ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SLOTS = [['first', '1st'], ['second', '2nd'], ['third', '3rd']];
  // Same scoring as standings_score() in standings.sql: 5 exact podium spot, 2 on the podium elsewhere, 3 fastest lap.
  function score(p, r) {
    if (!p || !r) return null;
    const podium = [r.first, r.second, r.third];
    let pts = 0;
    for (const [k] of SLOTS) if (p[k]) pts += p[k] === r[k] ? 5 : podium.includes(p[k]) ? 2 : 0;
    if (p.fastest && p.fastest === r.fastest) pts += 3;
    return pts;
  }
  // One driver per line (or comma separated); trimmed, blanks and repeats dropped.
  function parseEntrants(text) {
    const out = [];
    for (const n of String(text || '').split(/[\n,]+/).map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)) if (!out.includes(n)) out.push(n);
    return out.slice(0, 80);
  }
  // Picks close at 8 am local time on the event day unless the admin says otherwise; for <input type=datetime-local>.
  const pad = n => String(n).padStart(2, '0');
  const localInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const defaultClose = date => date ? `${date}T08:00` : '';
  // Ranks with ties sharing a place: [10, 10, 7] -> [1, 1, 3].
  function ranks(board) {
    return board.map((b, i) => board.findIndex(x => x.points === b.points && x.exact === b.exact) + 1 || i + 1);
  }
  const core = { esc, score, parseEntrants, localInput, defaultClose, ranks, SLOTS };
  if (typeof module !== 'undefined') { module.exports = core; return; }

  /* ---------- page ---------- */
  const main = document.getElementById('standings');
  const $ = s => main.querySelector(s);
  const A = window.RaceMeAccount;
  const CLASSES = { podium: 'Podium', driver: 'Driver', 'pit-crew': 'Pit Crew', supporter: 'Supporter' };
  let user = null, ready = false, codeFor = '', d = null, editing = null;
  let season = Number(new URLSearchParams(location.search).get('season')) || new Date().getFullYear();

  const person = id => d?.people?.[id] || { name: 'Member' };
  const badge = p => p.admin ? '<span class="badge admin">Admin</span>' : p.class && CLASSES[p.class] ? `<span class="badge ${p.class}">${CLASSES[p.class]}</span>` : '';
  const when = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const day = s => new Date(s + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  async function rpc(name, args) {
    const { data, error } = await (await A.db()).rpc(name, args);
    if (error) throw new Error(/standings|season_|does not exist|schema cache/i.test(error.message) && !/closed|entry list|different driver/i.test(error.message)
      ? 'Standings aren\'t set up yet. Ask info@race-me.org to run standings.sql.' : error.message);
    return data;
  }

  function signInPanel() {
    return `<section class="panel"><h2 class="h2" style="margin-top:0">Members, sign in</h2>
      <p class="muted" style="margin:0 0 14px">Standings and picks are for members. We email you an 8-digit code. Not a member? <a href="../support.html#membership">Join the club</a>.</p>
      <form id="si-form" class="signin">
        <div><label class="l" for="si-email" style="margin-top:0">Email</label><input id="si-email" type="email" autocomplete="email" required value="${esc(codeFor)}" ${codeFor ? 'readonly' : ''}></div>
        ${codeFor ? '<div><label class="l" for="si-code" style="margin-top:0">Code from the email</label><input id="si-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="8-digit code"></div>' : ''}
        <button class="btn" type="submit">${codeFor ? 'Sign in' : 'Email me a code'}</button>
        ${codeFor ? '<button class="btn btn-ghost" type="button" data-si-again>Different email</button>' : ''}
      </form><p class="msg" id="si-msg" role="status"></p></section>`;
  }

  const options = (names, val, blank) => `<option value="">${blank}</option>` + names.map(n => `<option ${n === val ? 'selected' : ''}>${esc(n)}</option>`).join('');

  function eventCard(e) {
    const mine = e.mine || {}, r = e.results;
    const head = `<div class="ev-head"><div><h3>${esc(e.name)}</h3><div class="muted small">${day(e.date)}${e.track ? ' · ' + esc(e.track) : ''} · ${e.entrants.length} entr${e.entrants.length === 1 ? 'y' : 'ies'} · ${e.pickers} member${e.pickers === 1 ? '' : 's'} picked</div></div>
      ${r ? '<span class="tag done">results in</span>' : e.open ? `<span class="tag open">picks close ${esc(when(e.picks_close_at))}</span>` : '<span class="tag shut">picks closed · waiting on results</span>'}</div>`;
    let body = '';
    if (e.open) {
      body = e.entrants.length < 2 ? '<p class="muted">The entry list isn\'t up yet. Check back before picks close.</p>'
        : `<form class="picks" data-pick="${e.id}">
          ${SLOTS.map(([k, l]) => `<label><span>${l}</span><select name="${k}">${options(e.entrants, mine[k], '—')}</select></label>`).join('')}
          <label><span>Fastest lap</span><select name="fastest">${options(e.entrants, mine.fastest, '—')}</select></label>
          <button class="btn btn-sm" type="submit">${e.mine ? 'Update picks' : 'Save picks'}</button>
          <p class="msg" role="status">${e.mine ? 'Your picks are saved. You can change them until picks close.' : ''}</p></form>`;
    } else {
      const rows = (e.picks || []).map(p => `<tr${p.user_id === d.me ? ' class="me"' : ''}><td>${esc(person(p.user_id).name)}${badge(person(p.user_id))}</td>
        ${SLOTS.map(([k]) => `<td class="${r && p[k] === r[k] ? 'hit' : r && p[k] && [r.first, r.second, r.third].includes(p[k]) ? 'near' : ''}">${esc(p[k] || '—')}</td>`).join('')}
        <td class="${r && p.fastest && p.fastest === r.fastest ? 'hit' : ''}">${esc(p.fastest || '—')}</td><td class="num">${p.points ?? '—'}</td></tr>`).join('');
      body = `${r ? `<div class="result">${SLOTS.map(([k, l]) => `<span><b>${l}</b> ${esc(r[k] || '—')}</span>`).join('')}<span><b>Fastest lap</b> ${esc(r.fastest || '—')}</span></div>` : ''}
        ${rows ? `<div class="scroll"><table><thead><tr><th>Member</th><th>1st</th><th>2nd</th><th>3rd</th><th>Fastest</th><th class="num">Pts</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Nobody picked this one.</p>'}`;
    }
    const admin = d.is_admin ? `<div class="acts"><button type="button" class="btn btn-ghost btn-sm" data-edit="${e.id}">Edit event</button>
      ${!e.open || r ? `<button type="button" class="btn btn-ghost btn-sm" data-results="${e.id}">${r ? 'Change results' : 'Enter results'}</button>` : ''}</div>
      <div data-admin-box="${e.id}"></div>` : '';
    return `<article class="ev" id="ev-${e.id}">${head}${body}${admin}</article>`;
  }

  function eventForm(e) {
    const close = e ? localInput(new Date(e.picks_close_at)) : '';
    return `<form class="panel adm-form" data-save="${e ? e.id : ''}">
      <h3 style="margin-top:0">${e ? 'Edit event' : 'Add an event'}</h3>
      <div class="grid">
        <label><span>Name</span><input name="name" type="text" maxlength="120" required value="${esc(e?.name || '')}" placeholder="HPR Club Race, Round 1"></label>
        <label><span>Track</span><input name="track" type="text" maxlength="120" value="${esc(e?.track || '')}" placeholder="High Plains Raceway"></label>
        <label><span>Date</span><input name="date" type="date" required value="${esc(e?.date || '')}"></label>
        <label><span>Picks close</span><input name="close" type="datetime-local" required value="${esc(close)}"></label>
      </div>
      <label><span>Entry list: one driver per line</span><textarea name="entrants" rows="6">${esc((e?.entrants || []).join('\n'))}</textarea></label>
      <div class="acts"><button class="btn btn-sm" type="submit">${e ? 'Save event' : 'Add event'}</button><button class="btn btn-ghost btn-sm" type="button" data-cancel>Cancel</button>
        ${e ? `<button class="btn btn-ghost btn-sm" type="button" data-delete="${e.id}" data-confirm>Delete event and its picks</button>` : ''}</div>
      <p class="msg" role="status"></p></form>`;
  }

  function resultsForm(e) {
    const r = e.results || {};
    return `<form class="panel adm-form" data-save-results="${e.id}"><h3 style="margin-top:0">Results</h3>
      <div class="grid">${SLOTS.map(([k, l]) => `<label><span>${l}</span><select name="${k}">${options(e.entrants, r[k], '—')}</select></label>`).join('')}
        <label><span>Fastest lap</span><select name="fastest">${options(e.entrants, r.fastest, '—')}</select></label></div>
      <div class="acts"><button class="btn btn-sm" type="submit">Save results</button><button class="btn btn-ghost btn-sm" type="button" data-cancel>Cancel</button>
        ${e.results ? `<button class="btn btn-ghost btn-sm" type="button" data-clear-results="${e.id}" data-confirm>Clear results</button>` : ''}</div>
      <p class="msg" role="status"></p></form>`;
  }

  async function load() {
    if (!user) { main.innerHTML = `${intro()}${signInPanel()}`; wireSignIn(); return; }
    try { d = await rpc('standings', { yr: season }); render(); }
    catch (err) { main.innerHTML = `${intro()}<p class="msg bad">${esc(err.message)}</p>`; }
  }

  const intro = () => `<div class="kick">Bragging rights</div><h1 class="big">Standings</h1>
    <p class="lead">Pick the podium and fastest lap before each event, wherever you are. 5 points for each driver in the right spot, 2 for a driver on the podium in a different spot, 3 for fastest lap. No money, just the table.</p>`;

  function render() {
    const seasons = [...new Set([season, new Date().getFullYear(), ...d.seasons])].sort((a, b) => b - a);
    const rk = ranks(d.board);
    const board = d.board.length ? `<div class="scroll"><table class="board"><thead><tr><th class="num">#</th><th>Member</th><th class="num">Events</th><th class="num">Exact</th><th class="num">Points</th></tr></thead><tbody>
      ${d.board.map((b, i) => `<tr${b.user_id === d.me ? ' class="me"' : ''}><td class="num">${rk[i]}</td><td>${esc(person(b.user_id).name)}${badge(person(b.user_id))}</td><td class="num">${b.events}</td><td class="num">${b.exact}</td><td class="num pts">${b.points}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">No results yet this season. The table fills in after the first event.</p>';
    const upcoming = d.events.filter(e => !e.results), done = d.events.filter(e => e.results).reverse();
    main.innerHTML = `${intro()}
      <div class="bar"><label class="small">Season <select id="season" style="width:auto">${seasons.map(y => `<option ${y === season ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
        ${d.is_admin ? '<button type="button" class="btn btn-ghost btn-sm" data-add>Add an event</button>' : ''}</div>
      <div id="add-box"></div>
      <h2 class="h2">Table</h2>${board}
      <h2 class="h2">Upcoming</h2>${upcoming.length ? upcoming.map(eventCard).join('') : `<p class="muted">No events on the calendar for ${season} yet.</p>`}
      ${done.length ? `<h2 class="h2">Results</h2>${done.map(eventCard).join('')}` : ''}`;
    if (editing) openAdmin(editing.kind, editing.id);
  }

  function openAdmin(kind, id) {
    editing = { kind, id };
    main.querySelectorAll('[data-admin-box], #add-box').forEach(b => { b.innerHTML = ''; });
    const e = d.events.find(x => x.id === id);
    const box = kind === 'add' ? $('#add-box') : main.querySelector(`[data-admin-box="${id}"]`);
    if (!box) { editing = null; return; }
    box.innerHTML = kind === 'results' ? resultsForm(e) : eventForm(kind === 'add' ? null : e);
    const date = box.querySelector('[name=date]'), close = box.querySelector('[name=close]');
    date?.addEventListener('change', () => { if (!close.value) close.value = defaultClose(date.value); });
  }

  function wireSignIn() {
    $('#si-form')?.addEventListener('submit', async ev => {
      ev.preventDefault();
      const msg = $('#si-msg');
      msg.className = 'msg'; msg.textContent = codeFor ? 'Checking…' : 'Sending…';
      const r = codeFor ? await A.verifyCode(codeFor, $('#si-code').value) : await A.sendCode($('#si-email').value.trim());
      if (r.ok && !codeFor) { codeFor = $('#si-email').value.trim(); load(); $('#si-msg').textContent = r.message; $('#si-code')?.focus(); return; }
      if (r.ok) { codeFor = ''; return; }
      msg.className = 'msg bad'; msg.textContent = r.message;
    });
    $('[data-si-again]')?.addEventListener('click', () => { codeFor = ''; load(); });
  }

  main.addEventListener('change', e => {
    if (e.target.id === 'season') { season = Number(e.target.value); history.replaceState(null, '', '?season=' + season); editing = null; load(); }
  });
  main.addEventListener('submit', async ev => {
    const f = ev.target, msg = f.querySelector('.msg'), val = n => f.elements[n]?.value ?? '';
    if (!f.dataset.pick && f.dataset.save == null && !f.dataset.saveResults) return;
    ev.preventDefault();
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      if (f.dataset.pick) {
        await rpc('standings_pick', { event: f.dataset.pick, first: val('first'), second: val('second'), third: val('third'), fastest: val('fastest') });
        await load();
        const m = main.querySelector(`[data-pick="${f.dataset.pick}"] .msg`); if (m) m.textContent = 'Saved. You can change your picks until they close.';
        return;
      }
      const db = await A.db();
      if (f.dataset.saveResults) {
        const r = { first: val('first'), second: val('second'), third: val('third'), fastest: val('fastest') };
        if (!r.first) throw new Error('Pick at least the winner.');
        if (new Set([r.first, r.second, r.third].filter(Boolean)).size !== [r.first, r.second, r.third].filter(Boolean).length) throw new Error('Each podium spot needs a different driver.');
        const { error } = await db.from('season_events').update({ results: r }).eq('id', f.dataset.saveResults);
        if (error) throw error;
      } else {
        const date = val('date'), row = { season: Number(date.slice(0, 4)), name: val('name').trim(), track: val('track').trim(), event_date: date,
          picks_close_at: new Date(val('close')).toISOString(), entrants: parseEntrants(val('entrants')) };
        if (row.name.length < 2) throw new Error('Give the event a name.');
        const { error } = f.dataset.save ? await db.from('season_events').update(row).eq('id', f.dataset.save) : await db.from('season_events').insert(row);
        if (error) throw error;
        if (row.season !== season) { season = row.season; history.replaceState(null, '', '?season=' + season); }
      }
      editing = null; await load();
    } catch (err) { btn.disabled = false; msg.className = 'msg bad'; msg.textContent = err.message; }
  });
  main.addEventListener('click', async ev => {
    const b = ev.target.closest('button');
    if (!b || (b.type === 'submit' && b.form)) return;
    if (b.hasAttribute('data-confirm') && !b.dataset.armed) {
      b.dataset.armed = '1'; const was = b.textContent; b.textContent = 'Click again to confirm';
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = was; } }, 5000);
      return;
    }
    try {
      if (b.hasAttribute('data-add')) openAdmin('add');
      else if (b.dataset.edit) openAdmin('edit', b.dataset.edit);
      else if (b.dataset.results) openAdmin('results', b.dataset.results);
      else if (b.hasAttribute('data-cancel')) { editing = null; b.closest('form').remove(); }
      else if (b.dataset.delete || b.dataset.clearResults) {
        const db = await A.db();
        const { error } = b.dataset.delete ? await db.from('season_events').delete().eq('id', b.dataset.delete)
          : await db.from('season_events').update({ results: null }).eq('id', b.dataset.clearResults);
        if (error) throw error;
        editing = null; await load();
      }
    } catch (err) { const m = b.closest('form')?.querySelector('.msg'); if (m) { m.className = 'msg bad'; m.textContent = err.message; } else alert(err.message); }
  });

  document.addEventListener('raceme:account', e => {
    const u = e.detail?.user || null, changed = (u?.id || null) !== (user?.id || null) || !ready;
    user = u; ready = true;
    const out = document.querySelector('[data-action="signout"]'), guest = document.querySelector('[data-guest]');
    if (out) out.hidden = !user;
    if (guest) guest.hidden = !!user;
    if (changed) { editing = null; load(); }
  });
  document.querySelector('[data-action="signout"]')?.addEventListener('click', () => location.reload());
  setTimeout(() => { if (!ready) main.innerHTML = '<p class="msg bad">Standings couldn\'t load. Check your connection and reload the page.</p>'; }, 12000);
})();

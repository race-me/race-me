/* Race Me members: the Crew page. A member shares cars from their Setup Log with other members (a remote crew chief,
   a coach, a friend). The crew member opens those cars read only, and both can leave notes on each car.
   Tables public.crew_shares and public.crew_notes (supabase/crew.sql in race-me/members-src), with row-level security:
   only the owner and the members a car is shared with can see it. The shared copy is whatever the owner's Setup Log
   last synced to their account.
   Loaded by the members page (src/shell.html) the first time the Crew page is shown. */
(() => {
  const LS_SETUP = 'raceme.setuplog.v1';
  const CLASSES = { podium: 'Podium', driver: 'Driver', 'pit-crew': 'Pit Crew', supporter: 'Supporter' };

  /* ---------- core (no DOM; tested in tests/crew.test.cjs) ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const carName = c => (c?.name || 'Car') + (c?.number ? ' #' + c.number : '');
  // Best lap (seconds) over a car's sessions, from "1:32.4, 1:31.9" style lap lists.
  function parseLap(t) {
    const m = String(t).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
    return m && (!m[1] || +m[2] < 60) ? (m[1] ? +m[1] * 60 : 0) + +m[2] : null;
  }
  function bestLap(car) {
    let best = null;
    for (const s of car?.sessions || []) for (const t of String(s.laps || '').split(/[\s,;]+/)) {
      const v = parseLap(t);
      if (v != null && v > 0 && (best == null || v < best)) best = v;
    }
    return best;
  }
  const fmtLap = v => v == null ? '' : (v >= 60 ? Math.floor(v / 60) + ':' + (v % 60).toFixed(3).padStart(6, '0') : v.toFixed(3));
  function lastSession(car) {
    const l = [...(car?.sessions || [])].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    return l[l.length - 1] || null;
  }
  // Who each of my cars is shared with: { carId: [crewId, …] }.
  function sharesByCar(rows) {
    const out = {};
    for (const r of rows || []) (out[r.car_id] = out[r.car_id] || []).push(r.crew_id);
    return out;
  }
  // Members I could still add to a car: everyone with a profile but me and the car's current crew.
  const candidates = (members, me, already) => (members || []).filter(m => m.id !== me && !(already || []).includes(m.id));
  // The Setup Log page with a crew member's cars handed to it (read-only mode in tools/setup-log.html).
  function crewPage(html, owner, cars) {
    const tag = `<script>window.RACEME_CREW = ${JSON.stringify({ owner, cars }).replace(/</g, '\\u003c')};</` + 'script>';
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + tag) : tag + html;
  }
  const core = { esc, carName, parseLap, bestLap, fmtLap, lastSession, sharesByCar, candidates, crewPage };
  if (typeof module !== 'undefined') { module.exports = core; return; }

  /* ---------- page ---------- */
  const root = document.querySelector('[data-crew]');
  if (!root) return;
  const css = document.createElement('style');
  css.textContent = `
    .crew h2 { margin: 40px 0 6px; font-stretch: 62%; font-weight: 900; font-size: 34px; text-transform: uppercase; }
    .crew h2:first-child { margin-top: 0; }
    .crew .muted { color: #9fb0c8; } .crew .small { font-size: 14px; }
    .crew .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr)); gap: 12px; margin-top: 14px; }
    .crew .card { background: #0b0f18; border: 1px solid rgba(159,176,200,.3); padding: 20px 20px 22px; min-width: 0; }
    .crew .card h3 { margin: 0 0 4px; font-size: 21px; }
    .crew .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
    .crew .chip { display: inline-flex; align-items: center; gap: 8px; border: 1px solid rgba(159,176,200,.4); padding: 4px 4px 4px 10px; font-size: 15px; }
    .crew .chip button { background: none; border: 0; color: #9fb0c8; cursor: pointer; font-size: 18px; line-height: 1; padding: 2px 6px; }
    .crew .chip button:hover { color: #ff8a3d; }
    .crew .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .crew select, .crew textarea { font: 16px 'Archivo', system-ui, sans-serif; background: #0b0f18; color: #e8edf5; border: 1px solid rgba(159,176,200,.4); padding: 10px 12px; }
    .crew select { flex: 1 1 200px; min-width: 0; }
    .crew textarea { width: 100%; box-sizing: border-box; min-height: 80px; resize: vertical; margin-top: 10px; }
    .crew .btn-sm { padding: 9px 14px; font-size: 15px; }
    .crew .badge { display: inline-block; font-size: 11.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; padding: 2px 8px; border-radius: 2px; vertical-align: 2px; color: #080b12; margin-left: 6px; }
    .crew .badge.podium { background: linear-gradient(135deg,#ffe08a,#d4a72c); } .crew .badge.driver { background: linear-gradient(135deg,#f1f4f8,#a9b2be); }
    .crew .badge.pit-crew { background: linear-gradient(135deg,#e7ae7c,#a8642e); } .crew .badge.supporter { background: linear-gradient(135deg,#b9d8ff,#5b8fcf); }
    .crew .badge.admin { background: #ff8a3d; }
    .crew .note { border-top: 1px solid rgba(159,176,200,.2); padding: 10px 0; }
    .crew .note .by { font-size: 14px; color: #8b9bb3; margin-bottom: 4px; }
    .crew .note .tx { white-space: pre-wrap; overflow-wrap: anywhere; }
    .crew .msg { min-height: 1.4em; margin: 8px 0 0; color: #9fb0c8; } .crew .msg.bad { color: #ff8a3d; }
    .crew .viewer { margin-top: 24px; border: 2px solid #4da3ff; background: #0b0f18; }
    .crew .viewer iframe { display: block; width: 100%; height: max(640px, calc(100dvh - 24px)); border: 0; background: #e9edf1; }
    .crew .viewer .bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 14px; font-weight: 700; }
    .crew .stat { color: #c9d3e2; font-size: 15px; }`;
  document.head.append(css);

  const A = () => window.RaceMeAccount;
  let state = null, members = null, openNotes = null;
  const person = id => state?.people?.[id] || { name: 'Member' };
  const badge = p => p.admin ? '<span class="badge admin">Admin</span>' : p.class && CLASSES[p.class] ? `<span class="badge ${p.class}">${CLASSES[p.class]}</span>` : '';
  const myCars = () => { try { return JSON.parse(localStorage.getItem(LS_SETUP))?.cars || []; } catch (e) { return []; } };
  const say = (el, text, bad) => { if (el) { el.textContent = text || ''; el.classList.toggle('bad', !!bad); } };
  const friendly = err => /crew_overview|crew_shares|crew_notes|does not exist|schema cache/i.test(err?.message || '')
    ? 'Crew sharing isn\'t set up yet. Ask info@race-me.org to run crew.sql.' : (err?.message || 'Something went wrong.');

  async function db() { return A().db(); }
  async function rpc(name, args) {
    const { data, error } = await (await db()).rpc(name, args);
    if (error) throw error;
    return data;
  }

  async function load() {
    if (!A()?.user()) { root.innerHTML = '<p class="muted">Sign in to use Crew.</p>'; return; }
    try {
      [state, members] = await Promise.all([rpc('crew_overview'), members || rpc('forum_members')]);
      render();
    } catch (err) { root.innerHTML = `<p class="msg bad">${esc(friendly(err))}</p>`; }
  }

  function render() {
    const me = state.me, shared = sharesByCar(state.shared_by_me), cars = myCars();
    const mineHtml = cars.length ? cars.map(c => {
      const crew = shared[c.id] || [];
      const opts = candidates(members, me, crew);
      const best = bestLap(c);
      return `<div class="card">
        <h3>${esc(carName(c))}</h3>
        <div class="stat">${(c.sessions || []).length} session${(c.sessions || []).length === 1 ? '' : 's'}${best != null ? ' · best ' + fmtLap(best) : ''}</div>
        <div class="chips">${crew.length ? crew.map(id => `<span class="chip">${esc(person(id).name)}${badge(person(id))}<button type="button" data-unshare="${esc(c.id)}" data-crew="${id}" aria-label="Stop sharing with ${esc(person(id).name)}">×</button></span>`).join('') : '<span class="muted small">Not shared with anyone.</span>'}</div>
        <div class="row"><select data-pick="${esc(c.id)}" aria-label="Member to share ${esc(carName(c))} with"><option value="">Share with a member…</option>${opts.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
          <button type="button" class="btn btn-sm" data-share="${esc(c.id)}">Share</button></div>
        <div class="row" style="margin-top:10px"><button type="button" class="btn btn-ghost btn-sm" data-notes="${me}|${esc(c.id)}">Notes</button></div>
        <div data-notes-box="${me}|${esc(c.id)}"></div>
        <p class="msg" data-msg="${esc(c.id)}" role="status"></p>
      </div>`;
    }).join('') : '<div class="card"><p class="muted" style="margin:0">No cars in your Setup Log yet. Open the <a href="#setup">Setup Log</a> and add one; it shows up here to share.</p></div>';

    const theirs = state.shared_with_me.filter(o => o.cars.length);
    const theirsHtml = theirs.length ? theirs.map(o => o.cars.map(c => {
      const p = person(o.owner_id), last = lastSession(c), best = bestLap(c);
      return `<div class="card">
        <div class="small muted">${esc(p.name)}${badge(p)}</div>
        <h3 style="margin-top:6px">${esc(carName(c))}</h3>
        <div class="stat">${(c.sessions || []).length} session${(c.sessions || []).length === 1 ? '' : 's'}${best != null ? ' · best ' + fmtLap(best) : ''}${last ? ` · last ${esc(last.date || '')}${last.track ? ' at ' + esc(last.track) : ''}` : ''}</div>
        <div class="row" style="margin-top:14px">
          <button type="button" class="btn btn-sm" data-open="${o.owner_id}|${esc(c.id)}">Open setup and sessions</button>
          <button type="button" class="btn btn-ghost btn-sm" data-notes="${o.owner_id}|${esc(c.id)}">Notes</button>
          <button type="button" class="btn btn-ghost btn-sm" data-leave="${o.owner_id}|${esc(c.id)}" data-confirm>Leave this crew</button>
        </div>
        <div data-notes-box="${o.owner_id}|${esc(c.id)}"></div>
      </div>`;
    }).join('')).join('') : '<div class="card"><p class="muted" style="margin:0">Nobody has shared a car with you yet. When they do, it shows up here.</p></div>';

    root.innerHTML = `<div class="crew">
      <h2>Shared with me</h2>
      <p class="muted" style="margin:0">Cars other members have asked you to crew on. You see them as their owner last synced them.</p>
      <div class="cards">${theirsHtml}</div>
      <div class="viewer" id="crew-viewer" hidden><div class="bar"><span id="crew-viewer-title"></span><button type="button" class="btn btn-ghost btn-sm" id="crew-viewer-close">Close</button></div><iframe title="Shared Setup Log"></iframe></div>
      <h2>My cars</h2>
      <p class="muted" style="margin:0">From your Setup Log. Your crew sees each car's setup sheet and sessions, read only, as your account last synced them. Stop sharing any time.</p>
      <div class="cards">${mineHtml}</div>
    </div>`;
    if (openNotes) showNotes(openNotes);
  }

  async function showNotes(key) {
    const box = root.querySelector(`[data-notes-box="${CSS.escape(key)}"]`);
    if (!box) return;
    openNotes = key;
    const [owner, car] = key.split('|');
    box.innerHTML = '<p class="muted small">Loading notes…</p>';
    try {
      const d = await rpc('crew_car_notes', { owner, car });
      const names = { ...state.people, ...d.people };
      box.innerHTML = `<div style="margin-top:12px">${d.notes.length ? d.notes.map(n => `<div class="note">
          <div class="by">${esc(names[n.author_id]?.name || 'Member')} · ${esc(new Date(n.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}
          ${n.author_id === state.me || owner === state.me ? `<button type="button" class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:13px;margin-left:6px" data-del-note="${n.id}">Delete</button>` : ''}</div>
          <div class="tx">${esc(n.body)}</div></div>`).join('') : '<p class="muted small">No notes yet. Ask a question or suggest a change.</p>'}
        <textarea maxlength="4000" placeholder="Write a note on this car" aria-label="New note"></textarea>
        <div class="row" style="margin-top:8px"><button type="button" class="btn btn-sm" data-add-note="${esc(key)}">Add note</button><button type="button" class="btn btn-ghost btn-sm" data-hide-notes>Hide notes</button></div>
        <p class="msg" role="status"></p></div>`;
    } catch (err) { box.innerHTML = `<p class="msg bad">${esc(friendly(err))}</p>`; }
  }

  async function openViewer(owner, carId) {
    const o = state.shared_with_me.find(x => x.owner_id === owner), c = o?.cars.find(x => x.id === carId);
    if (!c) return;
    const v = root.querySelector('#crew-viewer'), frame = v.querySelector('iframe');
    v.hidden = false;
    root.querySelector('#crew-viewer-title').textContent = `${person(owner).name} · ${carName(c)} · read only`;
    frame.srcdoc = '<p style="font:16px system-ui;padding:24px;color:#5a6774">Loading…</p>';
    v.scrollIntoView({ block: 'start', behavior: 'smooth' });
    try { frame.srcdoc = crewPage(await window.RaceMeMembers.toolPage('setup'), person(owner).name.split(' ')[0], [c]); }
    catch (err) { frame.srcdoc = '<p style="font:16px system-ui;padding:24px;color:#b42318">The Setup Log couldn\'t load. Reload the page and try again.</p>'; }
  }

  root.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-confirm') && !b.dataset.armed) {
      b.dataset.armed = '1'; const was = b.textContent; b.textContent = 'Click again to confirm';
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = was; } }, 5000);
      return;
    }
    const client = await db();
    try {
      if (b.dataset.share) {
        const car = b.dataset.share, sel = root.querySelector(`[data-pick="${CSS.escape(car)}"]`), msg = root.querySelector(`[data-msg="${CSS.escape(car)}"]`);
        if (!sel.value) { say(msg, 'Pick a member first.', true); return; }
        b.disabled = true;
        const { error } = await client.from('crew_shares').insert({ owner_id: state.me, crew_id: sel.value, car_id: car });
        if (error && error.code !== '23505') throw error;
        await load();
      } else if (b.dataset.unshare) {
        const { error } = await client.from('crew_shares').delete().match({ owner_id: state.me, crew_id: b.dataset.crew, car_id: b.dataset.unshare });
        if (error) throw error;
        await load();
      } else if (b.dataset.leave) {
        const [owner, car] = b.dataset.leave.split('|');
        const { error } = await client.from('crew_shares').delete().match({ owner_id: owner, crew_id: state.me, car_id: car });
        if (error) throw error;
        if (openNotes === b.dataset.leave) openNotes = null;
        root.querySelector('#crew-viewer').hidden = true;
        await load();
      } else if (b.dataset.open) {
        const [owner, car] = b.dataset.open.split('|');
        await openViewer(owner, car);
      } else if (b.id === 'crew-viewer-close') {
        root.querySelector('#crew-viewer').hidden = true;
        root.querySelector('#crew-viewer iframe').srcdoc = '';
      } else if (b.dataset.notes) {
        if (openNotes && openNotes !== b.dataset.notes) { const old = root.querySelector(`[data-notes-box="${CSS.escape(openNotes)}"]`); if (old) old.innerHTML = ''; }
        await showNotes(b.dataset.notes);
      } else if (b.hasAttribute('data-hide-notes')) {
        b.closest('[data-notes-box]').innerHTML = ''; openNotes = null;
      } else if (b.dataset.addNote) {
        const box = b.closest('[data-notes-box]'), ta = box.querySelector('textarea'), msg = box.querySelector('.msg');
        if (!ta.value.trim()) { say(msg, 'Write something first.', true); return; }
        const [owner, car] = b.dataset.addNote.split('|');
        b.disabled = true;
        const { error } = await client.from('crew_notes').insert({ owner_id: owner, car_id: car, body: ta.value.trim() });
        if (error) { b.disabled = false; throw error; }
        await showNotes(b.dataset.addNote);
      } else if (b.dataset.delNote) {
        const { error } = await client.from('crew_notes').delete().eq('id', b.dataset.delNote);
        if (error) throw error;
        if (openNotes) await showNotes(openNotes);
      }
    } catch (err) {
      b.disabled = false;
      const box = b.closest('.card'), msg = box?.querySelector('.msg');
      if (msg) say(msg, friendly(err), true); else alert(friendly(err));
    }
  });

  // Signing in or out elsewhere on the page, and Setup Log changes (new cars), refresh the lists.
  let who = A()?.user()?.id || null;
  document.addEventListener('raceme:account', e => {
    const id = e.detail?.user?.id || null;
    if (id !== who) { who = id; members = null; openNotes = null; load(); }
  });
  // Not while a shared car is open: re-drawing the page would close it.
  window.addEventListener('storage', e => { if (e.key === LS_SETUP && state && root.querySelector('#crew-viewer')?.hidden !== false) render(); });
  load();
})();

/* The Paddock: Race Me's club forum. Data and rules live in Supabase (supabase/forum.sql in race-me/members-src):
   visitors read the public section, members (signed in through ../members/sync.js) read and post everywhere, the
   admin moderates. This file only displays and sends; every permission is checked by the database. */
(() => {
  /* ---------- core (no DOM; tested in tests/forum.test.cjs) ---------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Post text to safe HTML: paragraphs, "- " lists, **bold**, *italic*, `code`, [text](https://…) and bare links,
  // and @mentions of the given names. Everything is escaped first; links must be http(s).
  function inline(line, names) {
    const keep = [];
    const hold = html => { keep.push(html); return `\u0000${keep.length - 1}\u0000`; };
    let h = esc(line);
    h = h.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${c}</code>`));
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => hold(`<a href="${u}" rel="nofollow ugc noopener" target="_blank">${t}</a>`));
    h = h.replace(/https?:\/\/[^\s<\u0000]+/g, u => {
      const trail = (u.match(/[.,;:!?)]+$/) || [''])[0];
      const url = u.slice(0, u.length - trail.length);
      return hold(`<a href="${url}" rel="nofollow ugc noopener" target="_blank">${url}</a>`) + trail;
    });
    h = h.replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, '$1<em>$2</em>');
    for (const n of [...names].sort((a, b) => b.length - a.length)) {
      const at = '@' + esc(n);
      h = h.split(at).join(hold(`<span class="mention">${at}</span>`));
    }
    return h.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]).replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
  }
  function renderBody(src, names = []) {
    const text = String(src || '').replace(/\r\n?/g, '\n').trim();
    if (!text) return '';
    return text.split(/\n{2,}/).map(block => {
      const lines = block.split('\n');
      if (lines.every(l => /^\s*[-*]\s+\S/.test(l))) return '<ul>' + lines.map(l => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''), names)}</li>`).join('') + '</ul>';
      return '<p>' + lines.map(l => inline(l, names)).join('<br>') + '</p>';
    }).join('');
  }
  // Search snippets come back with [[ ]] around the matches.
  const snippet = s => esc(s).replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>');

  // "@Al" being typed just before the caret: where it starts and what's typed so far.
  function mentionQuery(text, caret) {
    const m = String(text).slice(0, caret).match(/(^|\s)@([A-Za-z][\w'.-]*(?: [\w'.-]*)?)?$/);
    return m ? { start: caret - (m[2] || '').length - 1, q: m[2] || '' } : null;
  }
  // Mentioned people still named in the text (someone may have deleted the @name after picking it).
  const usedMentions = (text, picked) => [...picked].filter(([, name]) => String(text).includes('@' + name)).map(([id]) => id);

  function route(hash) {
    const h = String(hash || '').replace(/^#\/?/, '');
    let m;
    if ((m = h.match(/^s\/([a-z0-9-]+)(?:\/(\d+))?$/))) return { view: 'section', id: m[1], page: +(m[2] || 0) };
    if ((m = h.match(/^t\/([0-9a-f-]{36})$/i))) return { view: 'thread', id: m[1].toLowerCase() };
    if ((m = h.match(/^new\/([a-z0-9-]+)$/))) return { view: 'new', id: m[1] };
    if ((m = h.match(/^search\/(.+)$/))) { let q = m[1]; try { q = decodeURIComponent(q); } catch (e) { /* keep raw */ } return { view: 'search', q }; }
    return { view: 'home' };
  }
  // Photos are shrunk to fit within max × max pixels before upload.
  function fit(w, h, max = 1600) {
    const k = Math.min(1, max / Math.max(w, h));
    return { w: Math.round(w * k), h: Math.round(h * k) };
  }
  function ago(iso, now = Date.now()) {
    const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const initials = name => String(name || '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  const money = n => n == null || n === '' ? '' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });

  const core = { esc, renderBody, snippet, mentionQuery, usedMentions, route, fit, ago, money, initials };
  if (typeof module !== 'undefined') { module.exports = core; return; }

  /* ---------- browser ---------- */
  const A = window.RaceMeAccount;
  const $ = s => document.querySelector(s);
  const main = $('#forum');
  const STATUS = { available: 'Available', pending: 'Pending', sold: 'Sold' };
  // Membership class badges: Podium gold, Driver silver, Pit Crew bronze; Admin in club orange.
  const CLASSES = { podium: 'Podium', driver: 'Driver', 'pit-crew': 'Pit Crew', supporter: 'Supporter' };
  let user = null, accountReady = false, members = null, sections = null;
  const urls = new Map(); // photo path -> signed URL

  async function rpc(name, args) {
    const db = await A.db();
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  }
  async function photoUrls(paths) {
    const need = [...new Set(paths)].filter(p => p && !urls.has(p));
    if (need.length) {
      const db = await A.db();
      const { data } = await db.storage.from('forum').createSignedUrls(need, 3600);
      for (const d of data || []) if (d.signedUrl) urls.set(d.path, d.signedUrl);
    }
    return p => urls.get(p) || '';
  }
  // Profile photos (members only; the database leaves them out for visitors). Cached per person and photo version.
  const avatars = new Map();
  async function avatarUrls(people) {
    const need = Object.entries(people || {}).filter(([id, p]) => p.avatar && !avatars.has(id + p.avatar));
    if (need.length) {
      const db = await A.db();
      const { data } = await db.storage.from('avatars').createSignedUrls(need.map(([id]) => id + '.jpg'), 3600);
      (data || []).forEach((d, i) => { if (d.signedUrl) avatars.set(need[i][0] + need[i][1].avatar, d.signedUrl); });
    }
    return (id, p) => {
      const url = p?.avatar && avatars.get(id + p.avatar);
      return url ? `<img class="av" src="${esc(url)}" alt="">` : `<span class="av" aria-hidden="true">${esc(initials(p?.name))}</span>`;
    };
  }
  const person = (people, id) => people?.[id] || { name: 'Member', cars: [] };
  const badge = p => `${p.class && CLASSES[p.class] ? ` <span class="badge ${p.class}">${CLASSES[p.class]}</span>` : ''}${p.admin ? ' <span class="badge admin">Admin</span>' : ''}`;
  const sectionName = id => sections?.find(s => s.id === id)?.name || id;

  /* ----- sign-in panel (visitors) ----- */
  let codeFor = '';
  function signInPanel() {
    return `<section class="panel" aria-labelledby="si-h">
      <h2 id="si-h" style="margin:0 0 6px;font-stretch:62%;font-weight:900;font-size:30px;text-transform:uppercase">Members, sign in</h2>
      <p class="muted" style="margin:0 0 14px">See every section and post. We email you an 8-digit code. Not a member? <a href="../support.html#membership">Join the club</a>.</p>
      <form id="si-form" class="signin">
        <div><label class="l" for="si-email" style="margin-top:0">Email</label><input id="si-email" type="email" autocomplete="email" required value="${esc(codeFor)}" ${codeFor ? 'readonly' : ''}></div>
        ${codeFor ? `<div><label class="l" for="si-code" style="margin-top:0">Code from the email</label><input id="si-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="8-digit code"></div>` : ''}
        <button class="btn" type="submit">${codeFor ? 'Sign in' : 'Email me a code'}</button>
        ${codeFor ? '<button class="btn btn-ghost" type="button" data-si-again>Different email</button>' : ''}
      </form>
      <p class="msg" id="si-msg" role="status"></p>
    </section>`;
  }
  async function signInSubmit() {
    const msg = $('#si-msg');
    msg.className = 'msg'; msg.textContent = codeFor ? 'Checking…' : 'Sending…';
    const r = codeFor ? await A.verifyCode(codeFor, $('#si-code').value) : await A.sendCode($('#si-email').value.trim());
    if (r.ok && !codeFor) { codeFor = $('#si-email').value.trim(); render(); $('#si-msg').textContent = r.message; $('#si-code')?.focus(); return; }
    if (r.ok) { codeFor = ''; return; } // the account event re-renders
    msg.className = 'msg bad'; msg.textContent = r.message;
  }

  /* ----- views ----- */
  async function home() {
    const d = await rpc('forum_overview');
    sections = d.sections;
    const q = '';
    main.innerHTML = `
      <div class="kick">Club forum</div>
      <h1 class="big">The paddock</h1>
      <p class="lead">Build threads, tech help, parts for sale, and what's coming up on the calendar. ${d.signed_in ? 'Pick a section, or search everything.' : 'Visitors can read Events &amp; road trips; members see the rest.'}</p>
      <div class="bar"><form class="search" id="search-form" role="search"><input type="search" id="search-q" placeholder="Search the Paddock" aria-label="Search the Paddock" value="${esc(q)}"><button class="btn btn-ghost" type="submit">Search</button></form>
        ${d.signed_in ? '<a class="btn btn-ghost" href="../standings/">Season standings and picks</a>' : ''}</div>
      ${d.signed_in ? '' : signInPanel()}
      <div class="sections">${d.sections.map(s => {
        const latest = s.latest ? `Latest: <strong style="color:#c9d3e2">${esc(s.latest.title)}</strong> · ${esc(person(d.people, s.latest.by).name)} · ${ago(s.latest.at)}` : 'No threads yet. Start one.';
        return `<a class="sec" href="#/s/${s.id}">
          <h2>${esc(s.name)} ${s.new ? `<span class="tag new">${s.new} new</span>` : ''}</h2>
          <span style="color:#c9d3e2">${esc(s.description)}</span>
          <span class="meta">${s.threads} thread${s.threads === 1 ? '' : 's'}${s.is_public ? ' · <span class="tag pub">public</span>' : ''}<br>${latest}</span></a>`;
      }).join('')}</div>`;
  }

  async function section(r) {
    const d = await rpc('forum_threads', { sec: r.id, page: r.page });
    const s = d.section, classified = s.kind === 'classifieds';
    const pic = classified ? await photoUrls(d.threads.map(t => t.thumb).filter(Boolean)) : null;
    const filter = classified ? (sessionStorage.getItem('paddock-filter') || 'all') : 'all';
    const list = d.threads.filter(t => filter === 'all' || t.sale_status === filter);
    main.innerHTML = `
      <div class="crumbs"><a href="#/">The Paddock</a> /</div>
      <h1 class="title">${esc(s.name)}</h1>
      <p class="lead">${esc(s.description)}</p>
      <div class="bar">
        ${d.signed_in ? `<a class="btn" href="#/new/${s.id}">${classified ? 'Post a listing' : 'New thread'}</a>` : '<span class="muted">Sign in on the <a href="#/">Paddock home</a> to post.</span>'}
        ${classified ? `<label class="small muted">Show <select id="sale-filter" style="width:auto;margin-left:6px">${['all', 'available', 'pending', 'sold'].map(v => `<option value="${v}" ${v === filter ? 'selected' : ''}>${v === 'all' ? 'Everything' : STATUS[v]}</option>`).join('')}</select></label>` : ''}
      </div>
      <div class="list">${list.length ? list.map(t => {
        const a = person(d.people, t.author_id), last = person(d.people, t.last_post_by);
        return `<a class="row" href="#/t/${t.id}">
          ${classified ? (t.thumb && pic(t.thumb) ? `<img class="thumb" src="${esc(pic(t.thumb))}" alt="">` : '<span class="thumb"></span>') : '<span class="nothumb"></span>'}
          <span><span class="t">${t.pinned ? '<span class="tag pin">pinned</span> ' : ''}${t.locked ? '<span class="tag lock">locked</span> ' : ''}${t.hidden ? '<span class="tag hid">hidden</span> ' : ''}${esc(t.title)} ${t.is_new ? '<span class="tag new">new</span>' : ''}</span><br>
            <span class="s">${classified ? `${money(t.price) ? `<strong style="color:#e8edf5">${money(t.price)}</strong> · ` : ''}${t.location ? esc(t.location) + ' · ' : ''}<span class="tag ${t.sale_status}">${STATUS[t.sale_status] || ''}</span> · ` : ''}by ${esc(a.name)}${badge(a)}</span></span>
          <span class="r">${t.reply_count} repl${t.reply_count === 1 ? 'y' : 'ies'}<br>${esc(last.name)} · ${ago(t.last_post_at)}</span></a>`;
      }).join('') : `<p class="muted" style="padding:18px 4px">${d.threads.length ? 'Nothing with that status.' : 'No threads here yet.'}</p>`}</div>
      <div class="pager">${r.page > 0 ? `<a class="btn btn-ghost" href="#/s/${s.id}/${r.page - 1}">Newer</a>` : ''}${(r.page + 1) * 30 < d.total ? `<a class="btn btn-ghost" href="#/s/${s.id}/${r.page + 1}">Older</a>` : ''}</div>`;
    $('#sale-filter')?.addEventListener('change', e => { sessionStorage.setItem('paddock-filter', e.target.value); section(r); });
  }

  let current = null; // the open thread's data, for actions
  // Race day threads check for new posts every 30 seconds while they're open, so members away from the track can follow along.
  const LIVE = new Set(['race-day']);
  let liveTimer = null;
  function stopLive() { clearInterval(liveTimer); liveTimer = null; }
  function startLive(r, seen) {
    stopLive();
    liveTimer = setInterval(async () => {
      if (document.hidden || route(location.hash).id !== r.id) return;
      let d; try { d = await rpc('forum_thread', { tid: r.id }); } catch (e) { return; }
      const fresh = d.posts.length - seen;
      if (fresh <= 0) return;
      const box = $('#c-reply'), busy = box && (box.value.trim() || $('#th-reply')?.children.length || document.activeElement === box);
      if (!busy) { const atEnd = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80; await thread(r); if (atEnd) window.scrollTo(0, document.body.scrollHeight); return; }
      const bar = $('#live-bar');
      if (bar) { bar.hidden = false; bar.textContent = `${fresh} new post${fresh === 1 ? '' : 's'} · Show`; }
    }, 30000);
  }
  async function thread(r) {
    const d = current = await rpc('forum_thread', { tid: r.id });
    const t = d.thread, s = d.section, classified = s.kind === 'classifieds', live = LIVE.has(s.id);
    const pic = await photoUrls(d.posts.flatMap(p => p.images || []));
    const face = await avatarUrls(d.people);
    const mine = id => id === d.me;
    const names = p => (p.mentions || []).map(id => person(d.people, id).name);
    const listing = classified ? `<div class="panel" style="margin-top:6px">
        <div class="listing"><span class="price">${money(t.price) || 'Price on request'}</span>${t.location ? `<span>${esc(t.location)}</span>` : ''}<span class="tag ${t.sale_status}">${STATUS[t.sale_status]}</span></div>
        ${mine(t.author_id) || d.is_admin ? `<form id="listing-form" class="signin" style="margin-top:14px">
          <div><label class="l" for="ls-price" style="margin-top:0">Price ($)</label><input id="ls-price" type="number" min="0" step="1" value="${t.price ?? ''}"></div>
          <div><label class="l" for="ls-loc" style="margin-top:0">Location</label><input id="ls-loc" type="text" maxlength="80" value="${esc(t.location || '')}"></div>
          <div><label class="l" for="ls-status" style="margin-top:0">Status</label><select id="ls-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === t.sale_status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <button class="btn btn-ghost" type="submit">Update listing</button></form>` : ''}</div>` : '';
    const admin = d.is_admin ? `<div class="panel warn"><strong>Admin</strong>
        <div class="acts">
          <button class="btn btn-ghost btn-sm" data-mod="${t.pinned ? 'unpin' : 'pin'}">${t.pinned ? 'Unpin' : 'Pin'}</button>
          <button class="btn btn-ghost btn-sm" data-mod="${t.locked ? 'unlock' : 'lock'}">${t.locked ? 'Unlock' : 'Lock'}</button>
          <button class="btn btn-ghost btn-sm" data-mod="${t.hidden ? 'unhide' : 'hide'}">${t.hidden ? 'Unhide thread' : 'Hide thread'}</button>
          <label class="small">Move to <select id="mod-move" style="width:auto">${(sections || [s]).map(x => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          <button class="btn btn-ghost btn-sm" data-mod="delete" data-confirm>Delete thread</button>
        </div></div>` : '';
    main.innerHTML = `
      <div class="crumbs"><a href="#/">The Paddock</a> / <a href="#/s/${s.id}">${esc(s.name)}</a> /</div>
      <h1 class="title">${esc(t.title)}</h1>
      <div class="muted small">${t.pinned ? '<span class="tag pin">pinned</span> ' : ''}${t.locked ? '<span class="tag lock">locked</span> ' : ''}${t.hidden ? '<span class="tag hid">hidden</span> ' : ''}${t.reply_count} repl${t.reply_count === 1 ? 'y' : 'ies'}${live ? ' · <span class="tag live">live</span> new posts appear on their own' : ''}</div>
      ${listing}${admin}
      <div style="border-top:2px solid #4da3ff;margin-top:18px">${d.posts.map((p, i) => {
        const a = person(d.people, p.author_id);
        return `<article class="post${p.hidden ? ' hid' : ''}" id="p-${p.id}">
          <div class="who">${face(p.author_id, a)}<div><div class="n">${esc(a.name)}${badge(a)}</div>${a.cars?.length ? `<div class="c">${a.cars.map(esc).join('<br>')}</div>` : ''}</div></div>
          <div><div class="when">${ago(p.created_at)}${p.edited_at ? ' · edited' : ''}${p.hidden ? ' · <span class="tag hid">hidden</span>' : ''}</div>
            <div class="body" data-body="${p.id}">${renderBody(p.body, names(p))}</div>
            ${(p.images || []).length ? `<div class="pics">${p.images.map(src => pic(src) ? `<a href="${esc(pic(src))}" target="_blank" rel="noopener"><img src="${esc(pic(src))}" alt="Photo" loading="lazy"></a>` : '').join('')}</div>` : ''}
            <div class="acts">
              ${mine(p.author_id) ? `<button class="btn btn-ghost btn-sm" data-edit="${p.id}" data-first="${i === 0}">Edit</button>
                <button class="btn btn-ghost btn-sm" data-del="${p.id}" data-confirm>${i === 0 ? 'Delete thread' : 'Delete'}</button>` : ''}
              ${d.is_admin && i > 0 ? `<button class="btn btn-ghost btn-sm" data-mod="${p.hidden ? 'unhide-post' : 'hide-post'}" data-value="${p.id}">${p.hidden ? 'Unhide post' : 'Hide post'}</button>` : ''}
            </div></div></article>`;
      }).join('')}</div>
      ${live ? '<button class="btn live-bar" id="live-bar" type="button" hidden></button>' : ''}
      <div id="reply">${!d.signed_in ? `<p class="muted" style="margin-top:20px">Members can reply. <a href="#/">Sign in</a>.</p>`
        : t.locked && !d.is_admin ? '<p class="muted" style="margin-top:20px">This thread is locked.</p>'
        : `<h2 style="font-stretch:62%;font-weight:900;font-size:30px;text-transform:uppercase;margin:28px 0 0">Reply</h2>${composer('reply', { public: s.is_public })}`}</div>
      <p class="msg" id="thread-msg" role="status"></p>`;
    if (d.signed_in) wireComposer('reply', { public: s.is_public, onSubmit: async c => {
      await rpc('forum_reply', { tid: t.id, body: c.body, images: c.images, mentions: c.mentions });
      await thread(r); location.hash = `#/t/${t.id}`; window.scrollTo(0, document.body.scrollHeight);
    } });
    $('#listing-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      try { await rpc('forum_listing', { tid: t.id, price: $('#ls-price').value === '' ? null : Number($('#ls-price').value), location: $('#ls-loc').value, status: $('#ls-status').value }); await thread(r); }
      catch (err) { say(err.message, true); }
    });
    $('#mod-move')?.addEventListener('change', async e => { try { await rpc('forum_moderate', { tid: t.id, action: 'move', value: e.target.value }); await thread(r); } catch (err) { say(err.message, true); } });
    $('#live-bar')?.addEventListener('click', async () => { await thread(r); window.scrollTo(0, document.body.scrollHeight); });
    if (live) startLive(r, d.posts.length); else stopLive();
  }

  function newThread(r) {
    const s = sections?.find(x => x.id === r.id);
    const classified = s ? s.kind === 'classifieds' : r.id === 'classifieds';
    main.innerHTML = `
      <div class="crumbs"><a href="#/">The Paddock</a> / <a href="#/s/${r.id}">${esc(sectionName(r.id))}</a> /</div>
      <h1 class="title">${classified ? 'Post a listing' : 'New thread'}</h1>
      ${user ? `<form id="new-form">
        <label class="l" for="nt-title">${classified ? 'What are you selling or looking for?' : 'Title'}</label>
        <input id="nt-title" type="text" maxlength="140" required>
        ${classified ? `<div class="signin" style="margin-top:4px">
          <div><label class="l" for="nt-price">Price ($) <span class="muted">(optional)</span></label><input id="nt-price" type="number" min="0" step="1"></div>
          <div><label class="l" for="nt-loc">Location <span class="muted">(optional)</span></label><input id="nt-loc" type="text" maxlength="80" placeholder="e.g. Colorado Springs"></div></div>` : ''}
        </form>${composer('new', { public: s?.is_public })}` : '<p class="muted">Sign in on the <a href="#/">Paddock home</a> to post.</p>'}`;
    if (!user) return;
    $('#nt-title').focus();
    wireComposer('new', { public: s?.is_public, label: classified ? 'Post listing' : 'Post thread', onSubmit: async c => {
      const title = $('#nt-title').value.trim();
      if (title.length < 3) throw new Error('Give it a title (at least 3 characters).');
      const price = classified && $('#nt-price').value !== '' ? Number($('#nt-price').value) : null;
      const id = await rpc('forum_new_thread', { sec: r.id, title, body: c.body, images: c.images, mentions: c.mentions, price, location: classified ? $('#nt-loc').value : null });
      location.hash = `#/t/${id}`;
    } });
  }

  async function search(r) {
    const res = await rpc('forum_search', { q: r.q });
    main.innerHTML = `
      <div class="crumbs"><a href="#/">The Paddock</a> /</div>
      <h1 class="title">Search</h1>
      <div class="bar"><form class="search" id="search-form" role="search"><input type="search" id="search-q" value="${esc(r.q)}" aria-label="Search the Paddock"><button class="btn btn-ghost" type="submit">Search</button></form></div>
      <div class="list">${res.length ? res.map(x => `<a class="row" href="#/t/${x.id}"><span class="nothumb"></span>
        <span><span class="t">${esc(x.title)}</span><br><span class="s">${snippet(x.snippet)}</span></span>
        <span class="r">${esc(sectionName(x.section_id))}<br>${ago(x.last_post_at)}</span></a>`).join('') : `<p class="muted" style="padding:18px 4px">Nothing found${user ? '' : ' in the public section. Members can search everything'}.</p>`}</div>`;
  }

  /* ----- composer: text, photos, @mentions ----- */
  const drafts = {};
  function composer(key, { label } = {}) {
    return `<div class="composer" style="position:relative">
      <label class="l" for="c-${key}">${key === 'reply' ? 'Your reply' : 'Post'}</label>
      <textarea id="c-${key}" placeholder="Write here. **bold**, *italic*, links, - lists, and @name to mention a member."></textarea>
      <div class="mentions" id="m-${key}" hidden role="listbox" aria-label="Members"></div>
      <div class="thumbs" id="th-${key}"></div>
      <div class="tools">
        <button class="btn" type="button" id="send-${key}">${label || (key === 'reply' ? 'Post reply' : 'Post')}</button>
        <label class="btn btn-ghost">Add photos<input type="file" id="ph-${key}" accept="image/*" multiple hidden></label>
        <span class="hint">Up to 6 photos per post. They're shrunk before upload.</span>
      </div>
      <p class="msg" id="msg-${key}" role="status"></p></div>`;
  }
  function wireComposer(key, { public: isPublic, onSubmit, initial }) {
    const c = drafts[key] = initial || { images: [], picked: new Map() };
    const ta = $(`#c-${key}`), menu = $(`#m-${key}`), msg = $(`#msg-${key}`);
    if (initial?.body) ta.value = initial.body;
    const showThumbs = async () => {
      const pic = await photoUrls(c.images);
      $(`#th-${key}`).innerHTML = c.images.map((p, i) => `<figure><img src="${esc(pic(p))}" alt=""><button type="button" data-rmpic="${i}" aria-label="Remove photo">×</button></figure>`).join('');
    };
    showThumbs();
    $(`#th-${key}`).addEventListener('click', e => { const b = e.target.closest('[data-rmpic]'); if (b) { c.images.splice(+b.dataset.rmpic, 1); showThumbs(); } });
    $(`#ph-${key}`).addEventListener('change', async e => {
      const files = [...e.target.files].slice(0, 6 - c.images.length);
      e.target.value = '';
      for (const f of files) {
        msg.className = 'msg'; msg.textContent = `Uploading ${f.name}…`;
        try { c.images.push(await uploadPhoto(f, isPublic)); await showThumbs(); msg.textContent = ''; }
        catch (err) { msg.className = 'msg bad'; msg.textContent = `${f.name}: ${err.message}`; }
      }
    });
    // @mentions
    let opts = [], sel = 0, q = null;
    const closeMenu = () => { menu.hidden = true; q = null; };
    const pick = m => {
      const before = ta.value.slice(0, q.start), after = ta.value.slice(ta.selectionStart);
      ta.value = `${before}@${m.name} ${after}`;
      c.picked.set(m.id, m.name);
      const pos = before.length + m.name.length + 2;
      ta.setSelectionRange(pos, pos); ta.focus(); closeMenu();
    };
    ta.addEventListener('input', async () => {
      q = mentionQuery(ta.value, ta.selectionStart);
      if (!q) return closeMenu();
      if (!members) { try { members = await rpc('forum_members'); } catch (err) { members = []; } }
      const s = q.q.toLowerCase();
      opts = members.filter(m => m.name.toLowerCase().includes(s) && m.id !== user?.id).slice(0, 8);
      sel = 0;
      if (!opts.length) return closeMenu();
      menu.innerHTML = opts.map((m, i) => `<button type="button" role="option" aria-selected="${i === sel}" data-i="${i}">${esc(m.name)}</button>`).join('');
      menu.style.left = '0'; menu.style.top = ta.offsetTop + ta.offsetHeight + 'px';
      menu.hidden = false;
    });
    ta.addEventListener('keydown', e => {
      if (menu.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length;
        menu.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String(i === sel)));
      } else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(opts[sel]); }
      else if (e.key === 'Escape') closeMenu();
    });
    menu.addEventListener('mousedown', e => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pick(opts[+b.dataset.i]); } });
    ta.addEventListener('blur', () => setTimeout(closeMenu, 150));
    $(`#send-${key}`).addEventListener('click', async () => {
      const body = ta.value.trim();
      if (!body) { msg.className = 'msg bad'; msg.textContent = 'Write something first.'; return; }
      const btn = $(`#send-${key}`); btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Posting…';
      try { await onSubmit({ body, images: c.images, mentions: usedMentions(body, c.picked) }); delete drafts[key]; }
      catch (err) { msg.className = 'msg bad'; msg.textContent = err.message; btn.disabled = false; }
    });
  }
  async function uploadPhoto(file, isPublic) {
    if (!/^image\//.test(file.type)) throw new Error('Not a photo.');
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('This browser can\'t read that photo format. Try a JPEG or PNG.'); }
    const { w, h } = fit(bmp.width, bmp.height);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    const path = `${isPublic ? 'public' : 'members'}/${user.id}/${crypto.randomUUID()}.jpg`;
    const db = await A.db();
    const { error } = await db.storage.from('forum').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(error.message);
    return path;
  }

  /* ----- actions in a thread ----- */
  const say = (text, bad) => { const m = $('#thread-msg'); if (m) { m.className = 'msg' + (bad ? ' bad' : ''); m.textContent = text; } };
  main.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-si-again]')) { codeFor = ''; render(); return; }
    if (b.hasAttribute('data-confirm') && !b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Click again to confirm'; b.classList.add('btn-armed'); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; } }, 5000); return; }
    const r = route(location.hash);
    try {
      if (b.dataset.mod) {
        await rpc('forum_moderate', { tid: current.thread.id, action: b.dataset.mod, value: b.dataset.value || null });
        if (b.dataset.mod === 'delete') { location.hash = `#/s/${current.section.id}`; return; }
        await thread(r);
      } else if (b.dataset.del) {
        const what = await rpc('forum_delete_post', { pid: b.dataset.del });
        if (what === 'thread') location.hash = `#/s/${current.section.id}`; else await thread(r);
      } else if (b.dataset.edit) {
        const p = current.posts.find(x => x.id === b.dataset.edit), first = b.dataset.first === 'true';
        const box = $(`[data-body="${p.id}"]`);
        b.closest('.acts').hidden = true;
        box.innerHTML = `${first ? `<label class="l" for="et-${p.id}" style="margin-top:0">Title</label><input id="et-${p.id}" type="text" maxlength="140" value="${esc(current.thread.title)}">` : ''}${composer('edit', { label: 'Save changes' })}<button class="btn btn-ghost btn-sm" type="button" data-cancel>Cancel</button>`;
        const picked = new Map((p.mentions || []).map(id => [id, person(current.people, id).name]));
        wireComposer('edit', { public: current.section.is_public, initial: { body: p.body, images: [...(p.images || [])], picked }, onSubmit: async c => {
          await rpc('forum_edit_post', { pid: p.id, body: c.body, images: c.images, mentions: c.mentions, title: first ? $(`#et-${p.id}`).value.trim() : null });
          await thread(r);
        } });
      } else if (b.matches('[data-cancel]')) await thread(r);
    } catch (err) { say(err.message, true); }
  });
  main.addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.id === 'si-form') signInSubmit();
    if (e.target.id === 'search-form') { const q = $('#search-q').value.trim(); if (q) location.hash = '#/search/' + encodeURIComponent(q); }
  });

  /* ----- routing and account ----- */
  async function render() {
    const r = route(location.hash);
    if (r.view !== 'thread') stopLive();
    try {
      if (!sections && r.view !== 'home') sections = (await rpc('forum_overview')).sections;
      if (r.view === 'home') await home();
      else if (r.view === 'section') await section(r);
      else if (r.view === 'thread') await thread(r);
      else if (r.view === 'new') newThread(r);
      else if (r.view === 'search') await search(r);
      document.title = (r.view === 'thread' && current ? current.thread.title + ' — ' : '') + 'The Paddock — Race Me';
    } catch (err) {
      main.innerHTML = `<div class="crumbs"><a href="#/">The Paddock</a> /</div><p class="msg bad">${esc(err.message)}</p>${user ? '' : signInPanel()}`;
    }
  }
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  document.addEventListener('raceme:account', e => {
    const u = e.detail?.user || null, changed = (u?.id || null) !== (user?.id || null) || !accountReady;
    user = u; accountReady = true; members = null;
    const out = document.querySelector('[data-action="signout"]'), guest = document.querySelector('[data-guest]');
    if (out) out.hidden = !user;
    if (guest) guest.hidden = !!user;
    if (changed) { sections = null; render(); }
  });
  // Sign out of the forum = sign out of the members area too (sync.js clears the account token first).
  document.querySelector('[data-action="signout"]')?.addEventListener('click', () => {
    try { localStorage.removeItem('raceme-members-key'); sessionStorage.removeItem('raceme-members-key'); } catch (e) { /* storage blocked */ }
    location.reload();
  });
  setTimeout(() => { if (!accountReady) main.innerHTML = '<p class="msg bad">The Paddock couldn\'t load. Check your connection and reload the page.</p>'; }, 12000);
})();

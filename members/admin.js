/* Race Me members: admin panel. Loaded by sync.js only for an account with app_metadata.role = 'admin'.
   Lists members with their profiles (database function admin_members), invites by email (Edge Function
   admin-invite), sends a sign-in code, and removes members (admin_remove_member). The database checks the admin
   role for every one of these; hiding this panel from others is only for tidiness. See supabase/admin.sql in
   race-me/members-src. */
(() => {
  const EXP = { none: 'None yet', autocross: 'Autocross', track: 'Track days', timetrial: 'Time trials', racing: 'Racing' };

  /* ---------- core (no DOM; tested in tests/admin.test.cjs) ---------- */
  const name = m => m.profile ? `${m.profile.first_name || ''} ${m.profile.last_name || ''}`.trim() : '';
  const cars = m => (m.profile?.cars || []).map(c => [c.year, c.make, c.model].filter(Boolean).join(' ')).join('; ');
  function status(m) {
    if (!m.last_sign_in_at) return { key: 'invited', text: 'Invited, not signed in yet' };
    if (!m.profile) return { key: 'noprofile', text: 'Signed in, no profile yet' };
    return { key: 'active', text: 'Active' };
  }
  function matches(m, q) {
    const s = String(q || '').toLowerCase().trim();
    if (!s) return true;
    const p = m.profile || {};
    return [m.email, name(m), p.phone, p.city, cars(m)].some(v => String(v || '').toLowerCase().includes(s));
  }
  const csvCell = v => {
    const t = String(v ?? '');
    // Quote every cell; neutralise a leading = + - @ so spreadsheets don't run it as a formula.
    return '"' + (/^[=+\-@]/.test(t) ? "'" + t : t).replace(/"/g, '""') + '"';
  };
  function toCsv(list) {
    const head = ['First name', 'Last name', 'Email', 'Phone', 'Street', 'Unit', 'City', 'State', 'ZIP', 'Country',
      'Emergency contact', 'Emergency phone', 'Relationship', 'Experience', 'Track days', 'Cars', 'Modifications',
      '21 or older', 'Rules agreed', 'Status', 'Invited', 'Last sign-in'];
    const rows = list.map(m => {
      const p = m.profile || {};
      return [p.first_name, p.last_name, m.email, p.phone, p.address_line1, p.address_line2, p.city, p.state, p.postal_code, p.country,
        p.emergency_name, p.emergency_phone, p.emergency_relationship, EXP[p.experience] || '', p.track_days ?? '',
        cars(m), (p.cars || []).map(c => c.mods).filter(Boolean).join(' | '), p.age_21 ? 'yes' : '',
        p.rules_accepted_at ? p.rules_accepted_at.slice(0, 10) : '', status(m).text,
        (m.invited_at || m.created_at || '').slice(0, 10), (m.last_sign_in_at || '').slice(0, 10)];
    });
    return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  const core = { name, cars, status, matches, toCsv };
  if (typeof module !== 'undefined') { module.exports = core; return; }

  /* ---------- browser ---------- */
  const A = window.RaceMeAccount;
  if (!A || !A.isAdmin()) return;
  let members = [], query = '', open = null, busy = false, note = '', loadErr = '', armed = null, wrap, btn;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = t => t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  const css = `
    .rm-adm { position: fixed; inset: 0; z-index: 65; overflow: auto; background: #080b12; color: #e8edf5; font: 400 16px/1.5 'Archivo', system-ui, sans-serif; }
    .rm-adm .in { max-width: 1200px; margin: 0 auto; padding: clamp(24px, 4vw, 48px) clamp(16px, 4vw, 40px) 64px; }
    .rm-adm .top { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; }
    .rm-adm .kick { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #ff8a3d; margin-bottom: 8px; }
    .rm-adm h1 { margin: 0; font-stretch: 62%; font-weight: 900; font-size: clamp(44px, 7vw, 84px); line-height: .9; text-transform: uppercase; }
    .rm-adm .bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 24px 0 14px; }
    .rm-adm input[type=email], .rm-adm input[type=search] { padding: 11px 13px; background: #0b0f18; color: #e8edf5; border: 1px solid rgba(159,176,200,.45); font: 500 16px 'Archivo', system-ui, sans-serif; min-width: 0; }
    .rm-adm .invite { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 16px; border: 2px solid #4da3ff; background: #0b0f18; margin-bottom: 18px; }
    .rm-adm .invite input { flex: 1 1 260px; }
    .rm-adm .msg { color: #c9d3e2; min-height: 1.5em; margin: 6px 0 10px; }
    .rm-adm .msg.bad { color: #ff8a3d; }
    .rm-adm table { width: 100%; border-collapse: collapse; font-size: 15px; }
    .rm-adm th { text-align: left; font-size: 12px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #8b9bb3; padding: 8px 10px; border-bottom: 2px solid rgba(159,176,200,.35); }
    .rm-adm td { padding: 10px; border-bottom: 1px solid rgba(159,176,200,.2); vertical-align: top; }
    .rm-adm tr.row { cursor: pointer; } .rm-adm tr.row:hover td { background: #0b0f18; }
    .rm-adm tr.row:focus-visible { outline: 2px solid #ff8a3d; outline-offset: -2px; }
    .rm-adm .tag { display: inline-block; font-size: 12px; font-weight: 700; padding: 1px 8px; border: 1px solid currentColor; white-space: nowrap; }
    .rm-adm .tag.active { color: #3ad08a; } .rm-adm .tag.invited { color: #4da3ff; } .rm-adm .tag.noprofile { color: #ff8a3d; }
    .rm-adm .det td { background: #0b0f18; }
    .rm-adm dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 10px 24px; margin: 4px 0 14px; }
    .rm-adm dt { font-size: 12px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #8b9bb3; }
    .rm-adm dd { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .rm-adm .acts { display: flex; flex-wrap: wrap; gap: 10px; }
    .rm-adm .danger { border-color: #ff8a3d !important; color: #ff8a3d !important; }
    .rm-adm .danger.armed { background: #ff8a3d !important; color: #080b12 !important; }
    .rm-adm .count { color: #8b9bb3; }
    @media (max-width: 760px) { .rm-adm .hide-sm { display: none; } }`;

  function details(m) {
    const p = m.profile;
    if (!p) return `<p style="margin:0 0 12px;color:#9fb0c8">${m.last_sign_in_at ? 'Signed in but hasn\'t filled in a profile yet. They\'ll be asked next time they sign in.' : 'Invited; hasn\'t signed in yet. Send them a sign-in code if the invite got lost.'}</p>`;
    const dd = (k, v) => `<div><dt>${k}</dt><dd>${esc(v) || '—'}</dd></div>`;
    return `<dl>
      ${dd('Phone', p.phone)}${dd('Paddock emails', `Replies: ${p.notify_replies === false ? 'off' : 'on'} · Mentions: ${p.notify_mentions === false ? 'off' : 'on'}`)}
      ${dd('Address', [p.address_line1, p.address_line2, `${p.city || ''}, ${p.state || ''} ${p.postal_code || ''}`, p.country !== 'USA' ? p.country : ''].filter(Boolean).join('\n'))}
      ${dd('Emergency contact', `${p.emergency_name || ''} (${p.emergency_relationship || ''})\n${p.emergency_phone || ''}`)}
      ${dd('Experience', `${EXP[p.experience] || '—'}${p.track_days != null ? `, about ${p.track_days} days` : ''}`)}
      ${dd('Agreements', `21 or older: ${p.age_21 ? 'yes' : 'no'}\nRules agreed: ${day(p.rules_accepted_at)}`)}
      ${dd('Cars', (p.cars || []).map(c => [c.year, c.make, c.model].join(' ') + (c.mods ? `\n  Mods: ${c.mods}` : '')).join('\n'))}
      ${dd('Account', `Invited ${day(m.invited_at || m.created_at)}\nLast sign-in ${day(m.last_sign_in_at)}\nProfile updated ${day(p.updated_at)}`)}
    </dl>`;
  }

  function render() {
    if (!wrap || wrap.hidden) return;
    const list = members.filter(m => matches(m, query));
    const keepFocus = document.activeElement?.id;
    wrap.innerHTML = `<div class="in">
      <div class="top"><div><div class="kick">Admin</div><h1>Members</h1></div>
        <div class="acts"><button type="button" class="btn btn-ghost" data-csv ${members.length ? '' : 'disabled'}>Download CSV</button><button type="button" class="btn btn-ghost" data-close>Close</button></div></div>
      <form class="invite" data-invite style="margin-top:24px">
        <label for="adm-invite" style="font-weight:700">Invite a member</label>
        <input id="adm-invite" type="email" placeholder="their@email.com" autocomplete="off" required>
        <button type="submit" class="btn" ${busy ? 'disabled' : ''}>Send invite</button>
      </form>
      <p class="msg ${/^(Could|That|Admins|Sign)/.test(note) ? 'bad' : ''}" role="status" aria-live="polite">${esc(note)}</p>
      <div class="bar"><input type="search" id="adm-q" placeholder="Search name, email, phone, car…" value="${esc(query)}" style="flex:1 1 280px" aria-label="Search members">
        <span class="count">${loadErr ? '' : `${list.length} of ${members.length} member${members.length === 1 ? '' : 's'}`}</span></div>
      ${loadErr ? `<p class="msg bad">${esc(loadErr)}</p>` : `<div style="overflow-x:auto"><table>
        <thead><tr><th>Name</th><th>Email</th><th class="hide-sm">Phone</th><th class="hide-sm">Cars</th><th>Status</th><th class="hide-sm">Last sign-in</th></tr></thead>
        <tbody>${list.map(m => `
          <tr class="row" tabindex="0" data-id="${m.user_id}" aria-expanded="${open === m.user_id}">
            <td>${esc(name(m)) || '<span style="color:#8b9bb3">—</span>'}${m.is_admin ? ' <span class="tag invited">admin</span>' : ''}</td><td style="overflow-wrap:anywhere">${esc(m.email)}</td>
            <td class="hide-sm">${esc(m.profile?.phone || '')}</td><td class="hide-sm">${esc(cars(m))}</td>
            <td><span class="tag ${status(m).key}">${esc(status(m).text)}</span></td><td class="hide-sm">${day(m.last_sign_in_at)}</td></tr>
          ${open === m.user_id ? `<tr class="det"><td colspan="6">${details(m)}
            <div class="acts">
              <button type="button" class="btn btn-ghost" data-code="${esc(m.email)}">Send sign-in code</button>
              ${m.is_admin ? '' : `<button type="button" class="btn btn-ghost danger ${armed === m.user_id ? 'armed' : ''}" data-remove="${m.user_id}">${armed === m.user_id ? `Click again to remove ${esc(name(m) || m.email)}` : 'Remove member'}</button>`}
            </div></td></tr>` : ''}`).join('')}
        </tbody></table></div>`}
    </div>`;
    if (keepFocus) { const el = document.getElementById(keepFocus); if (el) { el.focus(); if (el.setSelectionRange && el.type === 'search') el.setSelectionRange(el.value.length, el.value.length); } }
  }

  async function load() {
    loadErr = '';
    try {
      const db = await A.db();
      const { data, error } = await db.rpc('admin_members');
      if (error) throw error;
      members = data || [];
    } catch (e) {
      loadErr = 'Could not load members: ' + (e.message || e) + (/function|schema cache/i.test(e.message || '') ? ' Has supabase/admin.sql been run?' : '');
    }
    render();
  }

  function show() {
    if (!wrap) {
      const st = document.createElement('style'); st.textContent = css; document.head.append(st);
      wrap = document.createElement('div');
      wrap.className = 'rm-adm'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'Admin: members');
      document.body.append(wrap);
      wire();
    }
    wrap.hidden = false; document.documentElement.style.overflow = 'hidden';
    note = ''; render(); load();
    wrap.querySelector('#adm-invite')?.focus();
  }
  function hide() { wrap.hidden = true; document.documentElement.style.overflow = ''; }

  function wire() {
    wrap.addEventListener('input', e => { if (e.target.id === 'adm-q') { query = e.target.value; render(); } });
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape') hide();
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.row')) { e.preventDefault(); e.target.click(); }
    });
    wrap.addEventListener('submit', async e => {
      e.preventDefault();
      const email = wrap.querySelector('#adm-invite').value.trim();
      busy = true; note = 'Sending invite…'; render();
      try { await A.callFunction('admin-invite', { email }); note = `Invited ${email}. They'll get an email to set up their account.`; await load(); }
      catch (err) { note = 'Could not send the invite: ' + err.message; }
      busy = false; render();
    });
    wrap.addEventListener('click', async e => {
      const t = e.target;
      if (t.closest('[data-close]')) return hide();
      if (t.closest('[data-csv]')) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + toCsv(members)], { type: 'text/csv' }));
        a.download = `race-me-members-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return;
      }
      const code = t.closest('[data-code]');
      if (code) { const r = await A.sendCode(code.dataset.code); note = r.ok ? `Sent a sign-in code to ${code.dataset.code}.` : r.message; return render(); }
      const rm = t.closest('[data-remove]');
      if (rm) {
        const id = rm.dataset.remove;
        if (armed !== id) { armed = id; return render(); }
        armed = null;
        const m = members.find(x => x.user_id === id);
        try {
          const db = await A.db();
          const { error } = await db.rpc('admin_remove_member', { member: id });
          if (error) throw error;
          note = `Removed ${name(m) || m.email}. Their account, profile and saved tool data are gone.`;
          open = null; await load();
        } catch (err) { note = 'Could not remove: ' + (err.message || err); render(); }
        return;
      }
      const row = t.closest('tr.row');
      if (row) { open = open === row.dataset.id ? null : row.dataset.id; armed = null; render(); }
    });
  }

  // "Admin" button in the members header, next to the account button.
  function mountButton() {
    const out = document.querySelector('[data-action="signout"]');
    if (!out || btn) return;
    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn btn-ghost'; btn.textContent = 'Admin'; btn.hidden = out.hidden;
    out.before(btn);
    new MutationObserver(() => { btn.hidden = out.hidden; }).observe(out, { attributes: true, attributeFilter: ['hidden'] });
    btn.addEventListener('click', show);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton); else mountButton();
  document.addEventListener('raceme:account', e => { if (!e.detail?.user?.app_metadata || e.detail.user.app_metadata.role !== 'admin') { btn?.remove(); btn = null; if (wrap) hide(); } });
})();

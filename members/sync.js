/* Race Me members: sign in with email to keep tool data on the club's Supabase project and sync it between devices.
   The tools save to browser storage as always. This copies their storage keys to and from one database row per
   tool (table public.tool_data, row-level security: each member sees only their own rows).
   Loaded by members/index.html with <script src="sync.js" defer></script>. */
(() => {
  const CFG = {
    url: 'https://lkktdmdnwdklyvapyjxb.supabase.co',
    key: 'sb_publishable_GZnQtZX9P1NSJJYD5d6VFw_mU0K_TKr', // publishable key: safe in page code; RLS protects the data
    lib: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.min.js',
  };
  // Which browser storage keys belong to which tool. One row per tool.
  const TOOLS = {
    'suspension-bench': ['sgb.v1.current', 'sgb.v1.prefs', 'sgb.v2.vehicles', 'sgb.v2.overrides'],
    'corner-balance': ['raceme.corner.v1'],
    'setup-log': ['raceme.setuplog.v1'],
    'tire-analysis': ['raceme.tires.v1'],
    'alignment': ['raceme.alignment.v1'],
    'springs': ['raceme.springs.v1'],
    'brake-bias': ['raceme.brakes.v1'],
    'gearing': ['raceme.gearing.v1'],
  };
  const META = 'raceme.sync.meta', BACKUP = 'raceme.sync.backup.';
  const TRACKED = new Set(Object.values(TOOLS).flat());

  /* ---------- core (no DOM; tested in tests/sync.test.cjs) ---------- */
  const readLocal = (store, keys) => {
    const out = {};
    for (const k of keys) {
      try { const v = store.getItem(k); if (v != null) out[k] = JSON.parse(v); } catch (e) { /* unreadable value: skip it */ }
    }
    return out;
  };
  // FNV-1a over the JSON text, enough to notice that something changed.
  const hash = obj => {
    let h = 0x811c9dc5;
    const s = JSON.stringify(obj);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + ':' + s.length;
  };
  // Lists of records with ids: keep every id from both, this device's copy first and winning on the same id.
  const unionById = (a = [], b = []) => {
    const seen = new Set(a.map(x => x && x.id));
    return [...a, ...b.filter(x => x && !seen.has(x.id))];
  };
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  // When both this device and the server changed since the last sync: keep everything from both, this device wins ties.
  function mergeKey(key, l, r) {
    if (l === undefined) return r;
    if (r === undefined) return l;
    if (key === 'raceme.setuplog.v1' && isObj(l) && isObj(r)) {
      const rc = new Map((r.cars || []).map(c => [c.id, c]));
      const cars = (l.cars || []).map(c => rc.has(c.id) ? { ...rc.get(c.id), ...c, sessions: unionById(c.sessions, rc.get(c.id).sessions) } : c);
      return { ...r, ...l, cars: unionById(cars, r.cars) };
    }
    if (key === 'raceme.corner.v1' && isObj(l) && isObj(r)) return { ...r, ...l, log: unionById(l.log, r.log) };
    if ((key === 'sgb.v2.vehicles' || key === 'sgb.v2.overrides') && isObj(l) && isObj(r)) return { ...r, ...l };
    return l;
  }
  const merge = (l, r) => Object.fromEntries([...new Set([...Object.keys(l), ...Object.keys(r)])].map(k => [k, mergeKey(k, l[k], r[k])]));
  const apply = (store, data) => { for (const [k, v] of Object.entries(data)) store.setItem(k, JSON.stringify(v)); };

  // One pass over every tool for member uid. api: { list() -> [{tool, data, updated_at}], push(tool, data) -> updated_at }.
  // What was last synced is remembered per member, so a second account on the same device starts fresh.
  async function syncOnce(api, store, uid) {
    let all = {};
    try { all = JSON.parse(store.getItem(META) || '{}') || {}; } catch (e) { all = {}; }
    const meta = all[uid] = all[uid] || {};
    const rows = Object.fromEntries((await api.list()).map(r => [r.tool, r]));
    const result = { pushed: [], pulled: [], merged: [] };
    for (const [tool, keys] of Object.entries(TOOLS)) {
      const local = readLocal(store, keys), m = meta[tool] || {}, row = rows[tool];
      const empty = !Object.keys(local).length, h = hash(local);
      const localDirty = !empty && h !== m.hash;
      const serverNew = !!row && row.updated_at !== m.at;
      if (!row) {
        // The server has nothing for this tool yet: upload whatever this device has.
        if (!empty) { meta[tool] = { hash: h, at: await api.push(tool, { keys: local }) }; result.pushed.push(tool); }
      } else if (!serverNew) {
        if (localDirty) { meta[tool] = { hash: h, at: await api.push(tool, { keys: local }) }; result.pushed.push(tool); }
      } else if (!localDirty) {
        const data = row.data?.keys || {};
        apply(store, data);
        meta[tool] = { hash: hash(readLocal(store, keys)), at: row.updated_at };
        result.pulled.push(tool);
      } else {
        store.setItem(BACKUP + tool, JSON.stringify({ at: new Date().toISOString(), keys: local }));
        const merged = merge(local, row.data?.keys || {});
        apply(store, merged);
        const mine = readLocal(store, keys);
        meta[tool] = { hash: hash(mine), at: await api.push(tool, { keys: mine }) };
        result.merged.push(tool);
      }
    }
    store.setItem(META, JSON.stringify(all));
    return result;
  }
  const core = { TOOLS, readLocal, hash, merge, mergeKey, syncOnce };
  if (typeof module !== 'undefined') { module.exports = core; return; }
  window.RaceMeSync = core;

  /* ---------- browser: Supabase client, sign-in panel, triggers ---------- */
  const ref = new URL(CFG.url).hostname.split('.')[0];
  let client = null, user = null, busy = false, again = false, lastSync = null, lastErr = '';

  const loadLib = () => window.supabase ? Promise.resolve() : new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = CFG.lib; s.onload = ok; s.onerror = () => fail(new Error('Could not load the sign-in library.'));
    document.head.append(s);
  });

  const api = {
    async list() {
      const { data, error } = await client.from('tool_data').select('tool,data,updated_at');
      if (error) throw error;
      return data;
    },
    async push(tool, data) {
      const { data: row, error } = await client.from('tool_data')
        .upsert({ user_id: user.id, tool, data }, { onConflict: 'user_id,tool' }).select('updated_at').single();
      if (error) throw error;
      return row.updated_at;
    },
  };

  // Tools read storage when they start, so reload any open tool after new data comes in.
  const reloadTools = () => document.querySelectorAll('iframe[srcdoc]').forEach(f => { f.srcdoc = f.srcdoc; });

  async function sync() {
    if (!user || !navigator.onLine) return render();
    if (busy) { again = true; return; }
    busy = true; lastErr = ''; render();
    try {
      const r = await syncOnce(api, localStorage, user.id);
      lastSync = new Date();
      if (r.pulled.length || r.merged.length) reloadTools();
      if (r.merged.length) note('This device and another one both had changes. Both are kept; this device\'s copy wins where they disagree.');
    } catch (e) {
      lastErr = /fetch|network/i.test(e.message || '') ? 'Offline. Will sync when the connection is back.' : 'Sync failed: ' + (e.message || e);
    } finally {
      busy = false; render();
      if (again) { again = false; sync(); }
    }
  }
  let timer = 0;
  const soon = (ms = 2500) => { clearTimeout(timer); timer = setTimeout(sync, ms); };

  /* UI: a button in the members header and a small dialog. Uses the page's .btn styles. */
  const css = `
    .rm-sync-btn[data-state="on"]::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #3ad08a; margin-right: 8px; vertical-align: 1px; }
    .rm-sync-btn[data-state="busy"]::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #4da3ff; margin-right: 8px; vertical-align: 1px; }
    .rm-sync-btn[data-state="err"]::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ff8a3d; margin-right: 8px; vertical-align: 1px; }
    dialog.rm-sync { background: #0b0f18; color: #e8edf5; border: 2px solid #4da3ff; padding: 24px; width: min(440px, calc(100vw - 32px)); font: 400 16px/1.5 'Archivo', system-ui, sans-serif; }
    dialog.rm-sync::backdrop { background: rgba(5, 7, 12, 0.7); }
    dialog.rm-sync h2 { margin: 0 0 10px; font-stretch: 62%; font-weight: 900; font-size: 30px; line-height: 1; text-transform: uppercase; }
    dialog.rm-sync p { margin: 0 0 14px; color: #9fb0c8; text-wrap: pretty; }
    dialog.rm-sync label { display: block; font-weight: 700; font-size: 15px; margin-bottom: 8px; }
    dialog.rm-sync input { display: block; width: 100%; padding: 12px 14px; background: #080b12; color: #e8edf5; border: 1px solid rgba(159,176,200,0.45); font: 500 17px 'Archivo', system-ui, sans-serif; margin-bottom: 14px; }
    dialog.rm-sync .row { display: flex; flex-wrap: wrap; gap: 10px; }
    dialog.rm-sync .msg { min-height: 1.5em; margin: 12px 0 0; font-size: 15px; color: #c9d3e2; }
    dialog.rm-sync .who { color: #e8edf5; font-weight: 700; overflow-wrap: anywhere; }`;
  let btn, dlg, noteText = '';
  const note = t => { noteText = t; render(); };
  const ago = d => { const s = Math.round((Date.now() - d) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function render() {
    if (!btn) return;
    btn.dataset.state = !user ? 'off' : busy ? 'busy' : lastErr ? 'err' : 'on';
    btn.textContent = !user ? 'Save to my account' : busy ? 'Syncing…' : lastErr ? 'Sync paused' : 'Synced';
    if (!dlg.open) return;
    dlg.querySelector('[data-body]').innerHTML = user ? `
      <h2>Your account</h2>
      <p>Signed in as <span class="who">${esc(user.email)}</span>. Your saved cars, setups, sessions and tool settings are saved to your account and kept the same on every device you sign in on.</p>
      <p>${busy ? 'Syncing now…' : lastErr ? esc(lastErr) : lastSync ? 'Last synced ' + ago(lastSync) + '.' : 'Not synced yet.'}</p>
      ${noteText ? `<p style="color:#e8edf5">${esc(noteText)}</p>` : ''}
      <div class="row"><button type="button" class="btn" data-do="profile">Edit my profile</button><button type="button" class="btn btn-ghost" data-do="sync">Sync now</button><button type="button" class="btn btn-ghost" data-do="out">Sign out of my account</button><button type="button" class="btn btn-ghost" data-do="close">Close</button></div>
      <p class="msg">Signing out keeps the data on this device; it just stops syncing.</p>` : `
      <h2>Save to my account</h2>
      <p>Sign in with the email the club has on file. Your tool data is then saved online and follows you to any device. Without signing in, it stays in this browser only.</p>
      <form data-form><label for="rm-sync-email">Email</label><input id="rm-sync-email" type="email" autocomplete="email" required value="${esc(codeFor)}">
      ${codeFor ? `<label for="rm-sync-code">Code from the email</label><input id="rm-sync-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required>` : ''}
      <div class="row"><button type="submit" class="btn">${codeFor ? 'Sign in' : 'Email me a code'}</button><button type="button" class="btn btn-ghost" data-do="close">Close</button></div></form>
      <p class="msg" role="status" aria-live="polite" data-msg>${esc(codeMsg)}</p>`;
  }

  // Emails a sign-in code (and a link, if the email template still has one). Resolves to a message for the
  // person; ok is false when nothing was sent.
  async function sendCode(email) {
    try {
      await ready;
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      return { ok: true, message: `We emailed a sign-in code to ${email}. Enter it here. It can take a minute; check spam too.` };
    } catch (e) {
      return { ok: false, message: /signup|not allowed|not found/i.test(e.message || '')
        ? 'That email isn\'t set up for an account yet. Ask info@race-me.org to add it.'
        : /rate|too many|seconds/i.test(e.message || '') ? 'Too many sign-in emails just now. Wait a minute and try again.'
        : 'Could not send the code: ' + (e.message || e) };
    }
  }
  // Checks the code from the email; on success Supabase signs in and the usual account events follow.
  async function verifyCode(email, code) {
    try {
      await ready;
      const token = String(code || '').replace(/\D/g, '');
      if (token.length < 6) return { ok: false, message: 'Enter the code from the email.' };
      const { error } = await client.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
      return { ok: true, message: 'Signed in.' };
    } catch (e) {
      return { ok: false, message: /expired|invalid/i.test(e.message || '')
        ? 'That code didn\'t work. It may have expired or been mistyped; ask for a new one.'
        : 'Could not sign in: ' + (e.message || e) };
    }
  }
  let codeFor = '', codeMsg = '';
  async function signIn() {
    const msg = dlg.querySelector('[data-msg]'), email = dlg.querySelector('#rm-sync-email').value.trim();
    if (!codeFor) {
      msg.textContent = 'Sending…';
      const r = await sendCode(email);
      codeMsg = r.message;
      if (r.ok) { codeFor = email; render(); dlg.querySelector('#rm-sync-code')?.focus(); } else msg.textContent = r.message;
    } else {
      msg.textContent = 'Checking…';
      const r = await verifyCode(codeFor, dlg.querySelector('#rm-sync-code').value);
      if (r.ok) { codeFor = ''; codeMsg = ''; } else msg.textContent = r.message;
    }
  }

  function mount() {
    const out = document.querySelector('[data-action="signout"]');
    if (!out) return;
    const st = document.createElement('style'); st.textContent = css; document.head.append(st);
    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn btn-ghost rm-sync-btn'; btn.hidden = out.hidden;
    out.before(btn);
    // Show the account button only once the members area is unlocked, like the page's own Sign out button.
    new MutationObserver(() => { btn.hidden = out.hidden; }).observe(out, { attributes: true, attributeFilter: ['hidden'] });
    // Signing out of the members area also signs out of the account on this device.
    out.addEventListener('click', () => { try { localStorage.removeItem(`sb-${ref}-auth-token`); } catch (e) {} }, true);
    dlg = document.createElement('dialog');
    dlg.className = 'rm-sync'; dlg.setAttribute('aria-label', 'Your account');
    dlg.innerHTML = '<div data-body></div>';
    document.body.append(dlg);
    btn.addEventListener('click', () => { noteText = noteText && user ? noteText : ''; dlg.showModal(); render(); });
    dlg.addEventListener('click', e => {
      if (e.target === dlg) return dlg.close();
      const d = e.target.closest('[data-do]')?.dataset.do;
      if (d === 'close') dlg.close();
      if (d === 'sync') sync();
      if (d === 'profile') { dlg.close(); document.dispatchEvent(new CustomEvent('raceme:edit-profile')); }
      if (d === 'out') { client.auth.signOut({ scope: 'local' }).finally(() => { user = null; render(); }); }
    });
    dlg.addEventListener('submit', e => { e.preventDefault(); signIn(); });
    render();
  }

  const ready = loadLib().then(() => {
    client = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    client.auth.onAuthStateChange((event, session) => {
      const was = user?.id;
      user = session?.user || null;
      render();
      if (user && user.id !== was) setTimeout(sync, 0);
      if (user?.app_metadata?.role === 'admin') loadScript('admin.js');
      // The members page listens for this to unlock itself for a signed-in member (single login).
      if (user?.id !== was || event === 'INITIAL_SESSION') setTimeout(() => document.dispatchEvent(new CustomEvent('raceme:account', { detail: { user } })), 0);
    });
  });
  ready.catch(e => { lastErr = e.message; render(); });

  // For the members page's login screen: sign in by email, and read the members page key once signed in.
  window.RaceMeAccount = {
    sendCode,
    verifyCode,
    sendLink: sendCode, // older name
    user: () => user,
    isAdmin: () => user?.app_metadata?.role === 'admin',
    callFunction: async (name, body) => {
      await ready;
      const { data, error } = await client.functions.invoke(name, { body });
      if (error) {
        let msg = error.message;
        try { msg = (await error.context.json()).error || msg; } catch (e) { /* not JSON */ }
        throw new Error(msg);
      }
      return data;
    },
    db: async () => { await ready; return client; }, // for profile.js
    async membersKey() {
      await ready;
      if (!user) return null;
      const { data, error } = await client.from('members_key').select('key').eq('id', 1).maybeSingle();
      if (error) throw error;
      return data?.key || null;
    },
  };

  // Changes from a tool (they run in frames of this page, or in other tabs) arrive as storage events.
  window.addEventListener('storage', e => { if (e.key && TRACKED.has(e.key)) soon(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(300); else if (timer) { clearTimeout(timer); sync(); } });
  window.addEventListener('online', () => soon(300));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

  // The member profile form (first sign-in, and "Edit my profile") lives in profile.js next to this file; the admin
  // panel in admin.js, loaded only for the admin account.
  const base = document.currentScript?.src || location.href, loaded = new Set();
  function loadScript(name) {
    if (loaded.has(name)) return;
    loaded.add(name);
    const el = document.createElement('script');
    el.src = new URL(name, base).href;
    document.head.append(el);
  }
  loadScript('profile.js');
})();

/* Race Me members: the member profile. The first time a member signs in, this asks for their details before the
   members area can be used; "Edit my profile" (in the account panel) opens it again later. Stored in Supabase table
   public.member_profiles, one row per member, readable and editable only by that member (supabase/profiles.sql in
   race-me/members-src). If that table can't be reached, members aren't blocked.
   Loaded by members/index.html after sync.js. */
(() => {
  const EXPERIENCE = [
    ['none', 'No track or autocross yet'],
    ['autocross', 'Autocross'],
    ['track', 'Track days (HPDE)'],
    ['timetrial', 'Time trials'],
    ['racing', 'Wheel-to-wheel racing'],
  ];
  const MAX_CARS = 10;

  /* ---------- core (no DOM; tested in tests/profile.test.cjs) ---------- */
  const clean = v => String(v ?? '').trim();
  const digits = v => (String(v ?? '').match(/\d/g) || []).length;
  const emptyCar = () => ({ year: '', make: '', model: '', mods: '' });
  const blank = () => ({
    first_name: '', last_name: '', phone: '', address_line1: '', address_line2: '', city: '', state: '', postal_code: '',
    country: 'USA', emergency_name: '', emergency_phone: '', emergency_relationship: '', experience: '',
    track_days: '', cars: [emptyCar()], age_21: false, rules: false, notify_replies: true, notify_mentions: true, avatar_at: null,
  });
  // A saved row back into form values.
  function toForm(row) {
    if (!row) return blank();
    const f = { ...blank() };
    for (const k of Object.keys(f)) if (row[k] != null && k !== 'cars') f[k] = row[k];
    f.track_days = row.track_days == null ? '' : String(row.track_days);
    f.cars = Array.isArray(row.cars) && row.cars.length ? row.cars.map(c => ({ ...emptyCar(), ...c, year: c.year == null ? '' : String(c.year) })) : [emptyCar()];
    f.rules = !!row.rules_accepted_at;
    return f;
  }
  // Form values -> { row, errors }. errors maps a field ('phone', 'cars.0.year', …) to a message; row is null if any.
  function validate(f, { now = new Date(), acceptedAt = null } = {}) {
    const e = {};
    const need = (k, label, max = 120) => {
      const v = clean(f[k]);
      if (!v) e[k] = `Enter your ${label}.`;
      else if (v.length > max) e[k] = `Keep it under ${max} characters.`;
      return v;
    };
    const phone = (k, label) => {
      const v = clean(f[k]);
      if (digits(v) < 7 || v.length > 30) e[k] = `Enter ${label} with area code.`;
      return v;
    };
    const row = {
      first_name: need('first_name', 'first name', 80),
      last_name: need('last_name', 'last name', 80),
      phone: phone('phone', 'a phone number'),
      address_line1: need('address_line1', 'street address'),
      address_line2: clean(f.address_line2) || null,
      city: need('city', 'city', 80),
      state: need('state', 'state', 40),
      postal_code: need('postal_code', 'ZIP code', 12),
      country: clean(f.country) || 'USA',
      emergency_name: need('emergency_name', "emergency contact's name"),
      emergency_phone: phone('emergency_phone', "your emergency contact's phone"),
      emergency_relationship: need('emergency_relationship', 'relationship to you', 60),
      experience: clean(f.experience),
      track_days: null,
      cars: [],
      age_21: !!f.age_21,
      rules_accepted_at: null,
      notify_replies: f.notify_replies !== false,
      notify_mentions: f.notify_mentions !== false,
      avatar_at: f.avatar_at || null,
    };
    if (row.postal_code && row.postal_code.length < 3) e.postal_code = 'Enter your ZIP code.';
    if (row.address_line2 && row.address_line2.length > 120) e.address_line2 = 'Keep it under 120 characters.';
    if (!EXPERIENCE.some(([k]) => k === row.experience)) e.experience = 'Pick the one closest to your experience.';
    const td = clean(f.track_days);
    if (td) {
      const n = Number(td);
      if (!Number.isInteger(n) || n < 0 || n > 10000) e.track_days = 'Enter a whole number, or leave it blank.';
      else row.track_days = n;
    }
    const nextYear = now.getFullYear() + 1;
    const cars = (f.cars || []).filter(c => clean(c.year) || clean(c.make) || clean(c.model) || clean(c.mods));
    if (!cars.length) e['cars.0.year'] = 'Add at least one car.';
    if (cars.length > MAX_CARS) e.cars = `Up to ${MAX_CARS} cars.`;
    cars.forEach((c, i) => {
      const year = Number(clean(c.year));
      if (!Number.isInteger(year) || year < 1900 || year > nextYear) e[`cars.${i}.year`] = `Year from 1900 to ${nextYear}.`;
      if (!clean(c.make)) e[`cars.${i}.make`] = 'Enter the make.';
      if (!clean(c.model)) e[`cars.${i}.model`] = 'Enter the model.';
      if (clean(c.mods).length > 2000) e[`cars.${i}.mods`] = 'Keep it under 2,000 characters.';
      row.cars.push({ year, make: clean(c.make).slice(0, 60), model: clean(c.model).slice(0, 80), mods: clean(c.mods) });
    });
    if (!row.age_21) e.age_21 = 'Members must be 21 or older.';
    if (!f.rules) e.rules = 'Please read and agree to the member rules.';
    else row.rules_accepted_at = acceptedAt || now.toISOString();
    return Object.keys(e).length ? { row: null, errors: e } : { row, errors: {} };
  }
  // Profile photo helpers: initials for people without a photo, and the centred square to crop a photo to.
  const initials = name => String(name || '').trim().split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  function cropSquare(w, h) {
    const size = Math.min(w, h);
    return { sx: Math.round((w - size) / 2), sy: Math.round((h - size) / 2), size };
  }
  const core = { EXPERIENCE, MAX_CARS, blank, toForm, validate, initials, cropSquare };
  if (typeof module !== 'undefined') { module.exports = core; return; }

  /* ---------- browser ---------- */
  const CLASSES = { podium: 'Podium', driver: 'Driver', 'pit-crew': 'Pit Crew' };
  let myClass = null;
  let photoUrl = '', photoMsg = null;
  const AVATARS = 'avatars';
  async function refreshPhoto() {
    photoUrl = '';
    if (!form.avatar_at) return;
    try {
      const db = await window.RaceMeAccount.db();
      const { data } = await db.storage.from(AVATARS).createSignedUrl(user.id + '.jpg', 3600);
      photoUrl = data?.signedUrl || '';
    } catch (e) { photoUrl = ''; }
  }
  // Crop to a centred square, shrink to 256 px, upload as avatars/<user id>.jpg.
  async function uploadPhoto(file) {
    if (!/^image\//.test(file.type)) throw new Error('That isn\'t a photo.');
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('This browser can\'t read that photo format. Try a JPEG or PNG.'); }
    const { sx, sy, size } = cropSquare(bmp.width, bmp.height);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    canvas.getContext('2d').drawImage(bmp, sx, sy, size, size, 0, 0, 256, 256);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    const db = await window.RaceMeAccount.db();
    const { error } = await db.storage.from(AVATARS).upload(user.id + '.jpg', blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(error.message);
    return new Date().toISOString();
  }
  // Save the photo marker right away when the profile already exists (a new profile saves it with the form).
  async function savePhotoMarker(at) {
    form.avatar_at = at;
    if (!saved) return;
    const db = await window.RaceMeAccount.db();
    const { error } = await db.from('member_profiles').update({ avatar_at: at }).eq('user_id', user.id);
    if (error) throw new Error(error.message);
    saved.avatar_at = at;
  }

  let user = null, saved = null, loadedFor = null, form = blank(), required = false, minimized = false, busy = false, errors = {};
  let wrap, banner;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const css = `
    .rm-prof { position: fixed; inset: 0; z-index: 60; overflow: auto; background: #080b12; color: #e8edf5; font: 400 16px/1.5 'Archivo', system-ui, sans-serif; }
    .rm-prof form { max-width: 820px; margin: 0 auto; padding: clamp(28px, 5vw, 64px) clamp(16px, 4vw, 40px) 64px; }
    .rm-prof .kick { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #ff8a3d; margin-bottom: 12px; }
    .rm-prof h1 { margin: 0 0 14px; font-stretch: 62%; font-weight: 900; font-size: clamp(44px, 7vw, 84px); line-height: .9; text-transform: uppercase; }
    .rm-prof .lead { margin: 0 0 8px; color: #9fb0c8; max-width: 60ch; text-wrap: pretty; }
    .rm-prof fieldset { border: 0; border-top: 2px solid #4da3ff; margin: 28px 0 0; padding: 18px 0 0; min-width: 0; }
    .rm-prof legend { padding: 0 10px 0 0; font-stretch: 62%; font-weight: 900; font-size: 26px; text-transform: uppercase; }
    .rm-prof .grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 14px 14px; }
    .rm-prof .f { display: grid; gap: 6px; min-width: 0; grid-column: span 3; align-content: start; }
    .rm-prof .f.w6 { grid-column: span 6; } .rm-prof .f.w2 { grid-column: span 2; } .rm-prof .f.w4 { grid-column: span 4; }
    @media (max-width: 640px) { .rm-prof .f, .rm-prof .f.w2, .rm-prof .f.w4 { grid-column: span 6; } .rm-prof .f.half { grid-column: span 3; } }
    .rm-prof label.l { font-size: 15px; font-weight: 700; }
    .rm-prof .opt { font-weight: 400; color: #8b9bb3; }
    .rm-prof input[type=text], .rm-prof input[type=tel], .rm-prof input[type=number], .rm-prof select, .rm-prof textarea {
      width: 100%; min-width: 0; padding: 11px 13px; background: #0b0f18; color: #e8edf5; border: 1px solid rgba(159,176,200,.45); font: 500 16px 'Archivo', system-ui, sans-serif; }
    .rm-prof textarea { min-height: 76px; resize: vertical; }
    .rm-prof [aria-invalid="true"] { border-color: #ff8a3d; }
    .rm-prof .err { color: #ff8a3d; font-size: 14px; min-height: 0; }
    .rm-prof .hint { color: #8b9bb3; font-size: 14px; }
    .rm-prof .car { border: 1px solid rgba(159,176,200,.3); padding: 16px; margin-top: 14px; background: #0b0f18; }
    .rm-prof .car-h { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-weight: 700; }
    .rm-prof .check { display: flex; gap: 12px; align-items: flex-start; margin-top: 12px; font-size: 16px; }
    .rm-prof .check input { width: 20px; height: 20px; margin: 2px 0 0; accent-color: #4da3ff; flex: none; }
    .rm-prof .acts { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 30px; }
    .rm-prof .summary { margin-top: 14px; color: #ff8a3d; }
    .rm-badge { display: inline-block; font-size: 12px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; padding: 2px 8px; border-radius: 2px; color: #080b12; vertical-align: 2px; }
    .rm-badge.podium { background: linear-gradient(135deg, #ffe08a, #d4a72c); } .rm-badge.driver { background: linear-gradient(135deg, #f1f4f8, #a9b2be); } .rm-badge.pit-crew { background: linear-gradient(135deg, #e7ae7c, #a8642e); }
    .rm-prof .photo { display: flex; gap: 18px; align-items: center; margin-bottom: 18px; flex-wrap: wrap; }
    .rm-prof .av { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; display: inline-grid; place-items: center; background: #1b2433; color: #c9d3e2; font-weight: 800; }
    .rm-prof .av.big { width: 88px; height: 88px; font-size: 30px; }
    .rm-prof .privacy { margin-top: 26px; font-size: 14px; color: #8b9bb3; max-width: 64ch; }
    .rm-prof-banner { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 60; display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center;
      max-width: calc(100vw - 24px); padding: 12px 16px; background: #0b0f18; border: 2px solid #ff8a3d; color: #e8edf5; font: 600 15px 'Archivo', system-ui, sans-serif; }`;

  const field = (k, label, { type = 'text', cls = '', opt = false, hint = '', auto = '', extra = '' } = {}) => `
    <div class="f ${cls}">
      <label class="l" for="rp-${k}">${label}${opt ? ' <span class="opt">(optional)</span>' : ''}</label>
      <input id="rp-${k}" type="${type}" data-k="${k}" value="${esc(form[k])}" ${auto ? `autocomplete="${auto}"` : ''} ${extra}
        ${errors[k] ? `aria-invalid="true" aria-describedby="rp-${k}-e"` : ''}>
      ${hint ? `<span class="hint">${hint}</span>` : ''}
      ${errors[k] ? `<span class="err" id="rp-${k}-e">${esc(errors[k])}</span>` : ''}
    </div>`;
  const carErr = (i, k) => errors[`cars.${i}.${k}`] ? `<span class="err" id="rp-c${i}${k}-e">${esc(errors[`cars.${i}.${k}`])}</span>` : '';
  const carIn = (i, k, label, cls, attrs = '') => `
    <div class="f ${cls}"><label class="l" for="rp-c${i}${k}">${label}</label>
      <input id="rp-c${i}${k}" type="${k === 'year' ? 'number' : 'text'}" data-car="${i}" data-ck="${k}" value="${esc(form.cars[i][k])}" ${attrs}
        ${errors[`cars.${i}.${k}`] ? `aria-invalid="true" aria-describedby="rp-c${i}${k}-e"` : ''}>${carErr(i, k)}</div>`;

  function render() {
    if (!wrap) return;
    const isNew = !saved;
    wrap.innerHTML = `<form novalidate>
      <div class="kick">${isNew ? 'Welcome to the members area' : 'Your account'}</div>
      <h1>${isNew ? 'Set up your profile' : 'My profile'}</h1>
      ${!isNew ? `<p class="lead" style="margin-bottom:10px">Membership class: ${myClass ? `<span class="rm-badge ${myClass}">${CLASSES[myClass]}</span>` : 'not set yet (the admin sets it when your membership is confirmed)'}</p>` : ''}
      <p class="lead">${isNew ? 'One time only. The club uses this to run events and to reach someone if anything happens at the track.' : 'Keep your details up to date.'} Signed in as <strong>${esc(user?.email)}</strong>.</p>

      <fieldset><legend>About you</legend>
        <div class="photo">
          ${photoUrl ? `<img class="av big" src="${esc(photoUrl)}" alt="Your profile photo">` : `<span class="av big" aria-hidden="true">${esc(initials(`${form.first_name} ${form.last_name}`))}</span>`}
          <div>
            <div class="acts" style="margin-top:0"><label class="btn btn-ghost" style="cursor:pointer">${photoUrl ? 'Change photo' : 'Add a photo'}<input type="file" accept="image/*" data-photo hidden></label>
            ${photoUrl ? '<button type="button" class="btn btn-ghost" data-photo-remove>Remove photo</button>' : ''}</div>
            <span class="hint">Optional. Shown to members next to your name in the Paddock. It's cropped square and shrunk.</span>
            ${photoMsg ? `<div class="${photoMsg.bad ? 'err' : 'hint'}">${esc(photoMsg.text)}</div>` : ''}
          </div>
        </div>
        <div class="grid">
        ${field('first_name', 'First name', { auto: 'given-name', cls: 'half' })}
        ${field('last_name', 'Last name', { auto: 'family-name', cls: 'half' })}
        ${field('phone', 'Phone', { type: 'tel', auto: 'tel' })}
      </div></fieldset>

      <fieldset><legend>Address</legend><div class="grid">
        ${field('address_line1', 'Street address', { cls: 'w6', auto: 'address-line1' })}
        ${field('address_line2', 'Apartment, unit', { cls: 'w6', auto: 'address-line2', opt: true })}
        ${field('city', 'City', { cls: 'w2', auto: 'address-level2' })}
        ${field('state', 'State', { cls: 'w2 half', auto: 'address-level1' })}
        ${field('postal_code', 'ZIP code', { cls: 'w2 half', auto: 'postal-code' })}
      </div></fieldset>

      <fieldset><legend>Emergency contact</legend><div class="grid">
        ${field('emergency_name', 'Name', { cls: 'w2' })}
        ${field('emergency_phone', 'Phone', { type: 'tel', cls: 'w2' })}
        ${field('emergency_relationship', 'Relationship', { cls: 'w2', hint: 'e.g. spouse, parent, friend' })}
      </div></fieldset>

      <fieldset><legend>Driving</legend><div class="grid">
        <div class="f w4"><label class="l" for="rp-experience">Your experience</label>
          <select id="rp-experience" data-k="experience" ${errors.experience ? 'aria-invalid="true" aria-describedby="rp-experience-e"' : ''}>
            <option value="">Choose…</option>${EXPERIENCE.map(([k, t]) => `<option value="${k}" ${form.experience === k ? 'selected' : ''}>${t}</option>`).join('')}
          </select>${errors.experience ? `<span class="err" id="rp-experience-e">${esc(errors.experience)}</span>` : ''}
          <span class="hint">The most you've done. It helps us set run groups and the driver ladder.</span></div>
        ${field('track_days', 'Track and autocross days', { type: 'number', cls: 'w2', opt: true, hint: 'Roughly, all time', extra: 'min="0" step="1" inputmode="numeric"' })}
      </div></fieldset>

      <fieldset><legend>Your cars</legend>
        <p class="hint" style="margin:0">Add every car you might bring. Modifications are optional.</p>
        ${form.cars.map((c, i) => `<div class="car">
          <div class="car-h"><span>Car ${i + 1}</span>${form.cars.length > 1 ? `<button type="button" class="btn btn-ghost" data-rm="${i}" style="padding:6px 12px;font-size:14px">Remove</button>` : ''}</div>
          <div class="grid">
            ${carIn(i, 'year', 'Year', 'w2 half', `min="1900" max="${new Date().getFullYear() + 1}" inputmode="numeric"`)}
            ${carIn(i, 'make', 'Make', 'w2 half')}
            ${carIn(i, 'model', 'Model', 'w2')}
            <div class="f w6"><label class="l" for="rp-c${i}mods">Modifications <span class="opt">(optional)</span></label>
              <textarea id="rp-c${i}mods" data-car="${i}" data-ck="mods" placeholder="Coilovers, wheels and tires, seats, harness, cage, engine…">${esc(c.mods)}</textarea>${carErr(i, 'mods')}</div>
          </div></div>`).join('')}
        ${form.cars.length < MAX_CARS ? '<button type="button" class="btn btn-ghost" data-add style="margin-top:14px">Add another car</button>' : ''}
      </fieldset>

      <fieldset><legend>Paddock emails</legend>
        <label class="check"><input type="checkbox" data-k="notify_replies" ${form.notify_replies !== false ? 'checked' : ''}><span>Email me when someone replies to my thread in the Paddock.</span></label>
        <label class="check"><input type="checkbox" data-k="notify_mentions" ${form.notify_mentions !== false ? 'checked' : ''}><span>Email me when someone @mentions me.</span></label>
      </fieldset>

      <fieldset><legend>Agreements</legend>
        <label class="check"><input type="checkbox" data-k="age_21" ${form.age_21 ? 'checked' : ''} ${errors.age_21 ? 'aria-invalid="true"' : ''}><span>I'm 21 or older.</span></label>
        ${errors.age_21 ? `<div class="err">${esc(errors.age_21)}</div>` : ''}
        <label class="check"><input type="checkbox" data-k="rules" ${form.rules ? 'checked' : ''} ${errors.rules ? 'aria-invalid="true"' : ''}><span>I've read and agree to the <a href="#rules" data-rules>member rules and legal notes</a>.${saved?.rules_accepted_at ? ` <span class="opt">Agreed ${esc(new Date(saved.rules_accepted_at).toLocaleDateString())}.</span>` : ''}</span></label>
        ${errors.rules ? `<div class="err">${esc(errors.rules)}</div>` : ''}
      </fieldset>

      <div class="acts">
        <button type="submit" class="btn" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : isNew ? 'Save and continue' : 'Save changes'}</button>
        ${required ? '<button type="button" class="btn btn-ghost" data-signout>Sign out</button>' : '<button type="button" class="btn btn-ghost" data-close>Cancel</button>'}
      </div>
      <p class="summary" role="alert">${Object.keys(errors).length ? 'Please fix the highlighted fields.' : ''}</p>
      <p class="privacy">Your profile is private: only you and the club officers can see it. It's used only to run the club and is never shared or sold. To change your email or delete your account, email info@race-me.org.</p>
    </form>`;
  }

  function open(isRequired, keepEntries = false) {
    required = isRequired; minimized = false;
    if (!keepEntries) {
      errors = {}; form = toForm(saved); photoMsg = null;
      refreshPhoto().then(() => { if (wrap && !wrap.hidden) render(); });
    }
    if (!wrap) {
      const st = document.createElement('style'); st.textContent = css; document.head.append(st);
      wrap = document.createElement('div');
      wrap.className = 'rm-prof'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'Member profile');
      document.body.append(wrap);
      wire();
    }
    if (banner) banner.hidden = true;
    wrap.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    render();
    wrap.scrollTop = 0;
    wrap.querySelector('input')?.focus();
  }
  function close() {
    if (!wrap) return;
    wrap.hidden = true;
    document.documentElement.style.overflow = '';
    if (banner) banner.hidden = true;
  }
  // While a first-time profile isn't saved, members can step out only to read the rules.
  function minimize() {
    minimized = true;
    wrap.hidden = true;
    document.documentElement.style.overflow = '';
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'rm-prof-banner';
      banner.innerHTML = '<span>Finish your profile to use the members area.</span><button type="button" class="btn">Back to my profile</button>';
      banner.querySelector('button').addEventListener('click', () => { minimized = false; banner.hidden = true; wrap.hidden = false; document.documentElement.style.overflow = 'hidden'; wrap.querySelector('[data-k="rules"]')?.focus(); });
      document.body.append(banner);
    }
    banner.hidden = false;
  }

  function wire() {
    const sync = t => {
      if (t.dataset.k) form[t.dataset.k] = t.type === 'checkbox' ? t.checked : t.value;
      else if (t.dataset.car != null) form.cars[+t.dataset.car][t.dataset.ck] = t.value;
    };
    wrap.addEventListener('input', e => sync(e.target));
    wrap.addEventListener('change', e => sync(e.target));
    wrap.addEventListener('change', async e => {
      if (!e.target.matches('[data-photo]')) return;
      const file = e.target.files[0];
      if (!file) return;
      photoMsg = { text: 'Uploading…' }; render();
      try { await savePhotoMarker(await uploadPhoto(file)); await refreshPhoto(); photoMsg = { text: 'Photo saved.' }; }
      catch (err) { photoMsg = { text: 'Could not save the photo: ' + err.message, bad: true }; }
      render();
    });
    wrap.addEventListener('click', async e => {
      if (!e.target.closest('[data-photo-remove]')) return;
      try {
        const db = await window.RaceMeAccount.db();
        await db.storage.from(AVATARS).remove([user.id + '.jpg']);
        await savePhotoMarker(null); photoUrl = ''; photoMsg = { text: 'Photo removed.' };
      } catch (err) { photoMsg = { text: 'Could not remove the photo: ' + err.message, bad: true }; }
      render();
    });
    wrap.addEventListener('click', e => {
      const t = e.target;
      if (t.closest('[data-add]')) { form.cars.push({ year: '', make: '', model: '', mods: '' }); render(); wrap.querySelector(`#rp-c${form.cars.length - 1}year`)?.focus(); }
      else if (t.closest('[data-rm]')) { form.cars.splice(+t.closest('[data-rm]').dataset.rm, 1); render(); }
      else if (t.closest('[data-close]')) close();
      else if (t.closest('[data-signout]')) { close(); document.querySelector('[data-action="signout"]')?.click(); }
      else if (t.closest('[data-rules]')) { e.preventDefault(); location.hash = 'rules'; if (required) minimize(); else close(); }
    });
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape' && !required) close(); });
    wrap.addEventListener('submit', async e => {
      e.preventDefault();
      if (busy || !user) return;
      const r = validate(form, { acceptedAt: saved?.rules_accepted_at || null });
      errors = r.errors;
      if (!r.row) { render(); wrap.querySelector('[aria-invalid="true"]')?.focus(); return; }
      busy = true; render();
      try {
        const db = await window.RaceMeAccount.db();
        const save = row => db.from('member_profiles').upsert({ ...row, user_id: user.id, email: user.email }, { onConflict: 'user_id' }).select().single();
        let { data, error } = await save(r.row);
        if (error && /notify_|avatar_at/.test(error.message || '')) {
          const { notify_replies, notify_mentions, avatar_at, ...rest } = r.row; // newer columns not set up yet
          ({ data, error } = await save(rest));
        }
        if (error) throw error;
        saved = data; required = false;
        shareCars(saved);
        busy = false; close();
      } catch (err) {
        busy = false; render();
        wrap.querySelector('.summary').textContent = 'Could not save your profile: ' + (err.message || err) + '. Check your connection and try again.';
      }
    });
  }

  // The tools offer the member's cars in their car pickers (tools/scripts/cars-lib.js in race-me/members-src reads this).
  function shareCars(row) {
    try { localStorage.setItem('raceme.mycars.v1', JSON.stringify({ at: Date.now(), cars: (row && row.cars) || [] })); } catch (e) {}
  }

  async function load() {
    try {
      const db = await window.RaceMeAccount.db();
      const { data, error } = await db.from('member_profiles').select('*').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      saved = data || null;
      loadedFor = user.id;
      try { const c = await db.from('member_classes').select('class').eq('user_id', user.id).maybeSingle(); myClass = c.data?.class || null; } catch (e) { myClass = null; }
      if (saved) shareCars(saved);
      if (!saved) open(true);
    } catch (err) {
      // The profile table isn't reachable (not set up yet, or offline): don't lock the member out.
      console.warn('Member profile not available:', err.message || err);
    }
  }

  document.addEventListener('raceme:account', e => {
    const u = e.detail && e.detail.user;
    if (!u) { user = null; saved = null; loadedFor = null; close(); return; }
    user = u;
    if (loadedFor !== u.id) load();
  });
  document.addEventListener('raceme:edit-profile', () => { if (user) open(!saved); });
  window.addEventListener('hashchange', () => { if (required && minimized && location.hash !== '#rules') open(true, true); });
})();

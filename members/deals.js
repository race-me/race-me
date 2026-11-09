/* Race Me members: the Deals page. Built race and track cars for sale elsewhere, found and scored once a day by the
   deal finder in race-me/race-me-private, which writes public.deal_listings (supabase/deals.sql in race-me/members-src).
   Shows excellent and great deals (good ones too when asked); members vote would-buy / maybe / no and report sale
   prices, which the finder reads back into its scoring.
   Loaded by the members page (src/shell.html) the first time the Deals page is shown. */
(() => {
  /* ---------- core (no DOM) ---------- */
  const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const safeUrl = u => /^https:\/\//i.test(u || '') ? u : '';
  const parsePrice = s => {
    const v = Number(String(s || '').replace(/[$,\s]/g, ''));
    return Number.isFinite(v) && v > 0 && v <= 10000000 ? Math.round(v) : null;
  };
  const voteLine = v => {
    const n = (v?.yes || 0) + (v?.maybe || 0) + (v?.no || 0);
    return n ? `Club: ${v.yes || 0} would buy · ${v.maybe || 0} maybe · ${v.no || 0} wouldn't` : 'No votes yet';
  };
  const salesLine = s => (s && s.length) ? 'Reported sold for ' + s.map(money).join(', ') : '';
  const core = { money, safeUrl, parsePrice, voteLine, salesLine };
  if (typeof module !== 'undefined') { module.exports = core; return; }

  /* ---------- page ---------- */
  const root = document.querySelector('[data-deals]');
  if (!root) return;
  const css = document.createElement('style');
  css.textContent = `
    .deals .bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px; margin-bottom: 18px; }
    .deals .bar label { display: flex; align-items: center; gap: 10px; font-size: 15px; color: #c9d3e2; cursor: pointer; }
    .deals .bar input { width: 18px; height: 18px; accent-color: #4da3ff; margin: 0; }
    .deals .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 16px; }
    .deals .deal { display: flex; flex-direction: column; gap: 10px; background: #0b0f18; border: 2px solid #4da3ff; padding: 20px 22px 22px; min-width: 0; }
    .deals .deal[data-tier="excellent"] { border-color: #ff8a3d; }
    .deals .tier { align-self: flex-start; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; padding: 4px 10px; background: #4da3ff; color: #080b12; }
    .deals .deal[data-tier="excellent"] .tier { background: #ff8a3d; }
    .deals .deal[data-tier="good"] .tier { background: #c9d3e2; }
    .deals .title { font-stretch: 62%; font-weight: 900; font-size: 28px; line-height: 1.05; text-transform: uppercase; overflow-wrap: anywhere; }
    .deals .price { font-weight: 800; font-size: 22px; color: #ff8a3d; }
    .deals .meta { font-size: 14px; color: #8b9bb3; }
    .deals .reason { font-size: 15px; line-height: 1.5; color: #c9d3e2; text-wrap: pretty; }
    .deals .votes { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .deals .votes button { border: 1px solid rgba(159,176,200,.45); background: transparent; color: #c9d3e2; padding: 8px 12px; font: 600 14px 'Archivo', system-ui, sans-serif; cursor: pointer; }
    .deals .votes button[aria-pressed="true"] { background: #4da3ff; border-color: #4da3ff; color: #080b12; }
    .deals .sold { display: flex; gap: 6px; }
    .deals .sold input { flex: 1 1 auto; min-width: 0; padding: 8px 10px; background: #080b12; color: #e8edf5; border: 1px solid rgba(159,176,200,.45); font: 500 14px 'Archivo', system-ui, sans-serif; }
    .deals .sold button { border: 1px solid rgba(159,176,200,.45); background: transparent; color: #c9d3e2; padding: 8px 12px; font: 600 14px 'Archivo', system-ui, sans-serif; cursor: pointer; }
    .deals .links { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: auto; padding-top: 4px; font-weight: 700; font-size: 15px; }
    .deals .empty { margin: 0; padding: 28px 24px; border: 1px dashed rgba(159,176,200,.45); font-size: 17px; line-height: 1.55; color: #9fb0c8; }
    .deals .msg { min-height: 1.4em; font-size: 14px; color: #ff8a3d; }
  `;
  document.head.append(css);

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  root.classList.add('deals');
  let includeGood = false;
  let db = null;

  async function load() {
    try {
      db = db || await window.RaceMeAccount.db();
      const { data, error } = await db.rpc('deals_list', { include_good: includeGood });
      if (error) throw error;
      render(data || []);
    } catch (e) {
      root.replaceChildren(el('p', 'empty', /deals_list|does not exist|schema cache/i.test(e.message || '')
        ? 'The deal finder isn\'t set up yet. Run supabase/deals.sql (race-me/members-src) in the Supabase SQL Editor.'
        : 'Deals couldn\'t load just now. Check your connection and reload.'));
    }
  }

  function card(d) {
    const c = el('article', 'deal');
    c.dataset.tier = d.tier;
    const where = [d.location, d.source, d.first_seen && 'found ' + String(d.first_seen).slice(0, 10)].filter(Boolean).join(' · ');
    c.append(el('span', 'tier', d.tier + ' deal'), el('div', 'title', d.title), el('div', 'price', money(d.price)), el('div', 'meta', where));
    if (Array.isArray(d.classes) && d.classes.length) c.append(el('div', 'meta', 'Fits: ' + d.classes.join(', ')));
    c.append(el('div', 'reason', d.reason));

    // Would you buy it at this price?
    const mine = d.mine || {};
    const votes = el('div', 'votes');
    for (const [v, label] of [['yes', '👍 Would buy'], ['maybe', '🤔 Maybe'], ['no', '👎 No']]) {
      const b = el('button', '', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(mine.vote === v));
      b.addEventListener('click', () => act(c, 'deals_vote', { lid: d.id, v: mine.vote === v ? null : v }));
      votes.append(b);
    }
    c.append(votes, el('div', 'meta', voteLine(d.votes)));
    if (salesLine(d.sales)) c.append(el('div', 'meta', salesLine(d.sales)));

    // Heard what it sold for?
    const sold = el('form', 'sold');
    const input = el('input');
    input.inputMode = 'numeric';
    input.placeholder = mine.sold_price ? 'You reported ' + money(mine.sold_price) : 'Heard what it sold for? $';
    input.setAttribute('aria-label', 'Sale price for ' + d.title);
    const save = el('button', '', mine.sold_price ? 'Change' : 'Report');
    save.type = 'submit';
    sold.append(input, save);
    sold.addEventListener('submit', e => {
      e.preventDefault();
      const price = parsePrice(input.value);
      if (!price) { msg.textContent = 'Enter the sale price in dollars.'; return; }
      act(c, 'deals_report_sale', { lid: d.id, price });
    });
    const msg = el('div', 'msg');
    c.append(sold, msg);

    const links = el('div', 'links');
    const url = safeUrl(d.url);
    if (url) { const a = el('a', '', 'View listing →'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; links.append(a); }
    if (d.thread_id) { const a = el('a', '', 'Discuss in the Paddock →'); a.href = '../paddock/#/t/' + encodeURIComponent(d.thread_id); links.append(a); }
    c.append(links);
    return c;
  }

  async function act(cardEl, fn, args) {
    cardEl.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const { error } = await db.rpc(fn, args);
    if (error) {
      cardEl.querySelector('.msg').textContent = error.message || 'That didn\'t save. Try again.';
      cardEl.querySelectorAll('button').forEach(b => { b.disabled = false; });
      return;
    }
    load();
  }

  function render(list) {
    const bar = el('div', 'bar');
    const lab = el('label');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = includeGood;
    box.addEventListener('change', () => { includeGood = box.checked; load(); });
    lab.append(box, document.createTextNode('Show good deals too'));
    bar.append(lab, el('span', 'meta', list.length + (list.length === 1 ? ' car' : ' cars')));
    const grid = el('div', 'grid');
    list.forEach(d => grid.append(card(d)));
    root.replaceChildren(bar, list.length ? grid : el('p', 'empty',
      'No standout deals right now. The list only shows cars that score as great or excellent, so it\'s often short. Check back, or turn on "Show good deals too".'));
  }

  load();
})();

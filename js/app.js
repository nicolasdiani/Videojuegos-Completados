/* ============================================================
   Videojuegos completados — lógica
   ============================================================ */
(function () {
  'use strict';

  const THEME_KEY = 'vj_tema';
  const DB = window.VJDB;

  const PLATFORMS = [
    'PS5', 'PS4', 'Switch', 'Switch 2', 'Xbox Series', 'Xbox One',
    'PC', 'Steam Deck', 'Nintendo 3DS', 'Retro', 'Móvil'
  ];

  /* ---------- estado ---------- */
  let games = [];
  let activeYear = 'all';
  const filters = { q: '', platform: 'all', minRating: 0, sort: 'date' };
  let me = null;          // { email, name, avatar, admin }
  let rawgKey = '';       // clave compartida, se lee de la base al entrar

  /* ---------- persistencia (Supabase) ---------- */
  async function loadGames() {
    games = await DB.listGames();
  }

  /* ---------- utilidades ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const yearOf = g => (g.date || '').slice(0, 4) || 'Sin fecha';

  function fmtDate(iso) {
    if (!iso) return '—';
    if (/^\d{4}$/.test(iso)) return iso; // solo año
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }
  function rateClass(r) { return r >= 8 ? 'high' : r >= 6 ? 'mid' : 'low'; }
  function fmtRating(r) { r = Number(r) || 0; return Number.isInteger(r) ? String(r) : r.toFixed(1); }

  // distintivo "metascore" estilo Metacritic (sin reproducir su logo oficial):
  // "m" amarilla fija + nota coloreada según el metascore (verde/amarillo/rojo).
  function mcScoreClass(mc) {
    return mc >= 75 ? 'high' : mc >= 50 ? 'mid' : 'low';
  }
  function mcBadge(mc, mini) {
    if (!mc) return '';
    return `<span class="mc-badge ${mcScoreClass(mc)}${mini ? ' mini' : ''}" title="Metacritic: ${mc}/100"><span class="mc-m">m</span><span class="mc-score">${mc}</span></span>`;
  }
  function mcBadgeNA() {
    return `<span class="mc-badge na" title="Sin nota de Metacritic — elige un juego del buscador para autocompletarla"><span class="mc-m">m</span><span class="mc-score">N/A</span></span>`;
  }

  // color candy determinista a partir del título -> carátula generada
  const COVER_PALETTE = ['#25D6E8', '#FF54C6', '#FFD23F', '#4FE08A', '#FF8A3D', '#A06CF5'];
  function hueOf(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }
  function genCoverStyle(title) {
    let n = 0;
    for (let i = 0; i < title.length; i++) n = (n * 31 + title.charCodeAt(i)) >>> 0;
    return `background:${COVER_PALETTE[n % COVER_PALETTE.length]};`;
  }
  function monogram(title = '') {
    const words = title.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return title.trim().slice(0, 2).toUpperCase();
  }

  window.__coverFail = function (img) {
    const box = img.closest('.cover');
    if (!box) return;
    box.className = 'cover-gen';
    box.style.cssText = box.dataset.grad || '';
    box.innerHTML = `<div class="gmono">${box.dataset.mono || ''}</div>`;
  };

  function searchURL(site, title) {
    const q = encodeURIComponent(title.trim());
    if (site === 'hltb') return `https://howlongtobeat.com/?q=${q}`;
    return `https://www.metacritic.com/search/${q}/`;
  }

  /* ============================================================
     RAWG — base de datos de videojuegos (autocompletado)
     ============================================================ */
  const getKey = () => rawgKey;

  // aviso cuando no hay clave: el admin puede configurarla, el resto solo se entera
  function noKeyHint() {
    if (!me || !me.admin) {
      setHint('El autocompletado todavía no está configurado — rellena los datos a mano.');
      return;
    }
    setHint('<span class="link" id="acConnect">Conecta RAWG</span> para autocompletar título, carátula y datos.');
    const c = $('#acConnect'); if (c) c.onclick = openSettings;
  }

  // mapea nombres de plataforma de RAWG a nuestra lista
  const RAWG_PLAT = [
    ['PlayStation 5', 'PS5'], ['PlayStation 4', 'PS4'],
    ['Nintendo Switch 2', 'Switch 2'], ['Nintendo Switch', 'Switch'],
    ['Xbox Series', 'Xbox Series'], ['Xbox One', 'Xbox One'],
    ['PC', 'PC'], ['macOS', 'PC'], ['Linux', 'PC'],
    ['iOS', 'Móvil'], ['Android', 'Móvil'], ['Nintendo 3DS', 'Nintendo 3DS']
  ];
  function mapPlatform(platforms) {
    if (!platforms || !platforms.length) return null;
    const names = platforms.map(p => (p.platform && p.platform.name) || '').join(' | ');
    for (const [needle, ours] of RAWG_PLAT) if (names.includes(needle)) return ours;
    return null;
  }
  const mcClass = m => m >= 80 ? 'high' : m >= 50 ? 'mid' : 'low';

  let acTimer = null, acController = null, acResults = [], acActive = -1;
  let modalExtra = {}; // mc, rawgSlug, releaseYear capturados del autofill

  function hideAc() { const d = $('#acDropdown'); d.hidden = true; d.innerHTML = ''; acActive = -1; }

  function setHint(html) { $('#acHint').innerHTML = html || ''; }

  function onTitleInput() {
    $('#autofillBadge').hidden = true;
    $('#autofillInfo').hidden = true;
    modalExtra = {};
    clearTimeout(acTimer);
    const q = $('#f_title').value.trim();
    if (!getKey()) {
      hideAc();
      noKeyHint();
      return;
    }
    setHint('');
    if (q.length < 2) { hideAc(); return; }
    acTimer = setTimeout(() => acSearch(q), 350);
  }

  async function acSearch(q) {
    if (acController) acController.abort();
    acController = new AbortController();
    $('#titleSpin').hidden = false;
    try {
      const url = `https://api.rawg.io/api/games?key=${encodeURIComponent(getKey())}&search=${encodeURIComponent(q)}&page_size=7`;
      const r = await fetch(url, { signal: acController.signal });
      if (r.status === 401) {
        if (me && me.admin) { setHint('Clave de RAWG no válida. <span class="link" id="acConnect">Revisar →</span>'); const c = $('#acConnect'); if (c) c.onclick = openSettings; }
        else setHint('El autocompletado no está disponible ahora — rellena los datos a mano.');
        hideAc(); return;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      acResults = (data.results || []).filter(g => g.name);
      renderAc();
    } catch (e) {
      if (e.name === 'AbortError') return;
      setHint('No se pudo conectar a RAWG — puedes rellenar los datos a mano.');
      hideAc();
    } finally {
      $('#titleSpin').hidden = true;
    }
  }

  function renderAc() {
    const d = $('#acDropdown');
    if (!acResults.length) { d.hidden = false; d.innerHTML = '<div class="ac-empty">Sin resultados — escribe el título a mano</div>'; return; }
    d.innerHTML = acResults.map((g, i) => {
      const yr = (g.released || '').slice(0, 4);
      const plats = (g.platforms || []).map(p => p.platform && p.platform.name).filter(Boolean).slice(0, 3).join(' · ');
      const thumb = g.background_image
        ? `<img class="ac-thumb" src="${escapeAttr(g.background_image)}" alt="" loading="lazy">`
        : `<div class="ac-thumb"></div>`;
      const mc = g.metacritic ? `<span class="ac-mc ${mcClass(g.metacritic)}">${g.metacritic}</span>` : '';
      return `<button type="button" class="ac-item" data-i="${i}">
        ${thumb}
        <span class="ac-meta">
          <span class="ac-name">${escapeHTML(g.name)}</span>
          <span class="ac-sub">${[yr, plats].filter(Boolean).join('  ·  ')}</span>
        </span>${mc}
      </button>`;
    }).join('');
    d.hidden = false;
    $$('.ac-item', d).forEach(btn => btn.addEventListener('mousedown', e => {
      e.preventDefault();
      selectGame(acResults[Number(btn.dataset.i)]);
    }));
  }

  function selectGame(g) {
    $('#f_title').value = g.name;
    if (g.background_image) { clearPendingCover(); $('#f_cover').value = g.background_image; }
    const plat = mapPlatform(g.platforms);
    if (plat) setSelectValue($('#f_platform'), plat);
    if (g.playtime && !Number($('#f_hours').value)) $('#f_hours').value = g.playtime;
    modalExtra = {
      mc: g.metacritic || 0,
      rawgSlug: g.slug || '',
      releaseYear: (g.released || '').slice(0, 4)
    };
    syncCoverPreview();
    showAutofillInfo(g);
    renderMcField();
    $('#autofillBadge').hidden = false;
    setHint('');
    hideAc();
  }

  function showAutofillInfo(g) {
    const bits = [];
    if (g.released) bits.push(`<span>Lanzado <b>${(g.released || '').slice(0, 4)}</b></span>`);
    if (g.metacritic) bits.push(`<span>Metacritic <b>${g.metacritic}</b></span>`);
    if (g.playtime) bits.push(`<span>~<b>${g.playtime}h</b> de media</span>`);
    const el = $('#autofillInfo');
    el.innerHTML = bits.join('');
    el.hidden = bits.length === 0;
  }

  function setSelectValue(sel, value) {
    if (![...sel.options].some(o => o.value === value)) {
      const o = document.createElement('option');
      o.value = value; o.textContent = value; sel.appendChild(o);
    }
    sel.value = value;
  }

  /* ---------- ajustes (solo admin): invitados + clave RAWG ---------- */
  function openSettings() {
    if (!me || !me.admin) return;
    $('#f_key').value = getKey();
    $('#keyStatus').textContent = '';
    $('#keyStatus').className = 'key-status';
    $('#f_invite').value = '';
    renderInvites();
    $('#settingsBackdrop').classList.add('open');
    setTimeout(() => $('#f_invite').focus(), 60);
  }
  function closeSettings() { $('#settingsBackdrop').classList.remove('open'); }

  async function saveKey() {
    const k = $('#f_key').value.trim();
    const st = $('#keyStatus');
    st.className = 'key-status';
    if (k) {
      st.textContent = 'Comprobando…';
      try {
        const r = await fetch(`https://api.rawg.io/api/games?key=${encodeURIComponent(k)}&search=zelda&page_size=1`);
        if (r.status === 401) { st.textContent = '✗ Clave no válida'; st.className = 'key-status err'; return; }
        if (!r.ok) { st.textContent = '✗ Error ' + r.status; st.className = 'key-status err'; return; }
      } catch (e) {
        st.textContent = '✗ No se pudo conectar con RAWG. Revisa la clave.'; st.className = 'key-status err'; return;
      }
    }
    try {
      await DB.setConfig('rawg_key', k);
    } catch (e) {
      st.textContent = '✗ No se pudo guardar: ' + e.message; st.className = 'key-status err'; return;
    }
    rawgKey = k;
    reflectConnection();
    st.textContent = k ? '✓ Guardada — ya autocompleta para todos' : 'Clave borrada';
    st.className = 'key-status ok';
    setTimeout(closeSettings, 900);
  }

  function reflectConnection() {
    const btn = $('#btnSettings');
    const connected = !!getKey();
    btn.classList.toggle('connected', connected);
    let dot = btn.querySelector('.conn-dot');
    if (!connected && !dot) { dot = document.createElement('span'); dot.className = 'conn-dot'; btn.appendChild(dot); }
    if (connected && dot) dot.remove();
  }

  async function renderInvites() {
    const ul = $('#inviteList');
    ul.innerHTML = '<li class="inv-empty">Cargando…</li>';
    let list;
    try { list = await DB.listInvites(); }
    catch (e) { ul.innerHTML = `<li class="inv-empty">No se pudo cargar: ${escapeHTML(e.message)}</li>`; return; }
    if (!list.length) { ul.innerHTML = '<li class="inv-empty">Nadie invitado todavía</li>'; return; }
    ul.innerHTML = list.map(({ email }) => {
      const mine = email === me.email;
      return `<li>
        <span class="inv-email">${escapeHTML(email)}</span>
        ${mine ? '<span class="inv-you">Tú</span>' : `<button type="button" class="inv-del" data-email="${escapeAttr(email)}" aria-label="Quitar a ${escapeAttr(email)}" title="Quitar acceso">
          <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`}
      </li>`;
    }).join('');
  }

  async function addInvite() {
    const input = $('#f_invite');
    const email = input.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Escribe un email válido'); input.focus(); return; }
    try {
      await DB.addInvite(email);
    } catch (e) {
      toast(e.code === '23505' ? 'Ese email ya está invitado' : 'No se pudo invitar');
      return;
    }
    input.value = '';
    toast('Invitado: ' + email);
    renderInvites();
  }

  async function removeInvite(email) {
    if (!confirm(`¿Quitar el acceso a ${email}? Sus juegos quedan guardados, pero no podrá entrar.`)) return;
    try { await DB.removeInvite(email); } catch (e) { toast('No se pudo quitar'); return; }
    toast('Acceso quitado');
    renderInvites();
  }

  /* ---------- iconos (line icons minimalistas) ---------- */
  const I = {
    star: '<svg class="icon-sm" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 18.6 6.1 21.3l1.2-6.6L2.5 9.5l6.6-.9z"/></svg>',
    clock: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    ext: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5h5v5M19 5l-8 8M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5"/></svg>',
    edit: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    pad: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 11h4M8 9v4M15 11h.01M18 13h.01"/><rect x="2" y="6" width="20" height="12" rx="5"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
  };

  /* ---------- render: tabs de año ---------- */
  function years() {
    const set = new Set(games.map(yearOf).filter(y => y !== 'Sin fecha'));
    const cur = String(new Date().getFullYear());
    set.add(cur);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }

  function inActiveYear(g) { return activeYear === 'all' || yearOf(g) === activeYear; }

  function renderYearFilter() {
    const ys = years();
    if (activeYear !== 'all' && !ys.includes(activeYear)) activeYear = 'all';
    const el = $('#filterYear');
    el.innerHTML = `<option value="all"${activeYear === 'all' ? ' selected' : ''}>Todos los años</option>`
      + ys.map(y => `<option value="${y}"${y === activeYear ? ' selected' : ''}>Año ${y}</option>`).join('');
    el.value = activeYear;
  }

  /* ---------- render: stats ---------- */
  function renderStats(list) {
    const n = list.length;
    const hrs = list.reduce((s, g) => s + (Number(g.hours) || 0), 0);
    const rated = list.filter(g => Number(g.rating) > 0);
    const avg = rated.length ? (rated.reduce((s, g) => s + Number(g.rating), 0) / rated.length) : 0;
    $('#statCount').textContent = n;
    $('#statHours').innerHTML = `${hrs}<small>h</small>`;
    $('#statAvg').innerHTML = avg ? `${avg.toFixed(1)}<small>/10</small>` : '—';
  }

  /* ---------- render: filtros de plataforma ---------- */
  function renderPlatformFilter() {
    const used = Array.from(new Set(games.map(g => g.platform).filter(Boolean))).sort();
    const sel = $('#filterPlatform');
    const cur = sel.value || 'all';
    sel.innerHTML = `<option value="all">Todas las plataformas</option>` +
      used.map(p => `<option value="${p}">${p}</option>`).join('');
    sel.value = used.includes(cur) || cur === 'all' ? cur : 'all';
  }

  /* ---------- render: grid ---------- */
  function currentList() {
    let list = games.filter(inActiveYear);
    if (filters.q) {
      const q = filters.q.toLowerCase();
      list = list.filter(g => (g.title || '').toLowerCase().includes(q) || (g.platform || '').toLowerCase().includes(q));
    }
    if (filters.platform !== 'all') list = list.filter(g => g.platform === filters.platform);
    if (filters.minRating > 0) list = list.filter(g => Number(g.rating) >= filters.minRating);

    const s = filters.sort;
    list.sort((a, b) => {
      if (s === 'rating') return (b.rating || 0) - (a.rating || 0);
      if (s === 'hours') return (b.hours || 0) - (a.hours || 0);
      if (s === 'title') return (a.title || '').localeCompare(b.title || '');
      return (b.date || '').localeCompare(a.date || ''); // date
    });
    return list;
  }

  function cardHTML(g) {
    const rc = rateClass(g.rating);
    const genCover = `<div class="cover-gen" style="${genCoverStyle(g.title)}"><div class="gmono">${escapeHTML(monogram(g.title))}</div></div>`;
    const cover = g.cover
      ? `<div class="cover" data-mono="${escapeAttr(monogram(g.title))}" data-grad="${escapeAttr(genCoverStyle(g.title))}"><img src="${escapeAttr(g.cover)}" alt="" loading="lazy" onerror="window.__coverFail(this)"></div>`
      : genCover;

    const rateChip = g.rating ? `<div class="rate-chip ${rc}">${I.star}${fmtRating(g.rating)}</div>` : '';
    const hours = g.hours ? `<span class="card-sub">${I.clock}${g.hours}h</span>` : '';

    return `<article class="card" data-id="${g.id}" tabindex="0" aria-label="${escapeAttr(g.title)}">
      <div class="card-cover">
        ${cover}
        ${rateChip}
        <div class="card-actions">
          <a class="act hltb" href="${searchURL('hltb', g.title)}" target="_blank" rel="noopener" data-stop>${I.clock} HowLongToBeat ${I.ext}</a>
          <a class="act mc" href="${searchURL('mc', g.title)}" target="_blank" rel="noopener" data-stop>${I.star} Metacritic ${I.ext}</a>
          <div class="act-row">
            <button class="act edit-btn" data-edit="${g.id}" data-stop>${I.edit} Editar</button>
          </div>
        </div>
      </div>
      <div class="card-info">
        <div class="card-title">${escapeHTML(g.title)}</div>
        <div class="card-meta">
          ${g.platform ? `<span class="tag">${escapeHTML(g.platform)}</span>` : ''}
          ${g.mc ? mcBadge(g.mc, true) : ''}
        </div>
        <div class="card-foot">
          ${g.hours ? `<span class="card-hours">${I.clock}${g.hours}h</span><span class="foot-sep"></span>` : ''}
          <span class="card-year">${fmtDate(g.date)}</span>
        </div>
      </div>
    </article>`;
  }

  function renderGrid() {
    const list = currentList();
    renderStats(games.filter(inActiveYear));
    const grid = $('#grid');
    const total = games.filter(inActiveYear).length;

    if (list.length === 0) {
      const filtered = total > 0;
      grid.innerHTML = `<div class="empty">
        <div class="ico">${I.pad}</div>
        <h3>${filtered ? 'Sin resultados' : `Aún no hay juegos en ${activeYear}`}</h3>
        <p>${filtered ? 'Prueba a cambiar los filtros o el buscador.' : 'Empieza a registrar los juegos que has terminado este año.'}</p>
        ${filtered ? '' : `<button class="btn-add" id="emptyAdd">${I.plus} Añadir el primero</button>`}
      </div>`;
      const ea = $('#emptyAdd');
      if (ea) ea.addEventListener('click', () => openModal());
      return;
    }
    grid.innerHTML = list.map(cardHTML).join('');
    // animación de entrada escalonada
    grid.classList.remove('anim'); void grid.offsetWidth; grid.classList.add('anim');
    $$('.card', grid).forEach((c, i) => { c.style.animationDelay = Math.min(i * 45, 600) + 'ms'; });
  }

  /* ---------- marquesina ---------- */
  function renderMarquee() {
    const track = $('#marqueeTrack');
    if (!track) return;
    const words = ['Tus partidas', 'Completados', 'Howlongtobeat', 'Metacritic', 'Nivel completado', 'Game over', 'Play hard'];
    const group = `<span>${words.join('</span><span>')}</span>`;
    track.innerHTML = group + group; // duplicado para bucle continuo
  }

  function escapeHTML(s = '') { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function escapeAttr(s = '') { return escapeHTML(s); }

  function renderAll() {
    renderYearFilter();
    renderPlatformFilter();
    renderGrid();
    updateMasthead();
    syncCustomSelects();
  }

  function updateMasthead() {
    const n = games.filter(inActiveYear).length;
    $('#mastCount').textContent = n;
  }

  /* ============================================================
     MODAL
     ============================================================ */
  let editingId = null;
  let pendingCover = null; // { blob, url } — imagen elegida del dispositivo, se sube al guardar
  let saving = false;

  function clearPendingCover() {
    if (pendingCover) URL.revokeObjectURL(pendingCover.url);
    pendingCover = null;
  }

  function buildPlatformOptions(selected) {
    return PLATFORMS.map(p => `<option value="${p}" ${p === selected ? 'selected' : ''}>${p}</option>`).join('');
  }
  function buildYearOptions(selected) {
    const now = new Date().getFullYear();
    const opts = [];
    for (let y = now + 1; y >= 1985; y--) {
      opts.push(`<option value="${y}" ${String(selected) === String(y) ? 'selected' : ''}>${y}</option>`);
    }
    return opts.join('');
  }

  function openModal(id) {
    editingId = id || null;
    const g = id ? games.find(x => x.id === id) : null;
    $('#modalTitle').textContent = g ? 'Editar juego' : 'Añadir juego';
    $('#f_title').value = g ? g.title : '';
    $('#f_platform').innerHTML = buildPlatformOptions(g ? g.platform : 'PS5');
    $('#f_date').innerHTML = buildYearOptions(g ? yearOf(g) : new Date().getFullYear());
    $('#f_hours').value = g && g.hours ? g.hours : '';
    setRating(g && g.rating ? g.rating : 8);
    $('#f_note').value = g ? (g.note || '') : '';
    $('#f_cover').value = g ? (g.cover || '') : '';
    modalExtra = g ? { mc: g.mc || 0, rawgSlug: g.rawgSlug || '', releaseYear: g.releaseYear || '' } : {};
    $('#autofillBadge').hidden = true;
    $('#autofillInfo').hidden = true;
    hideAc();
    clearPendingCover();
    if (getKey()) setHint(''); else noKeyHint();
    syncRating();
    syncCoverPreview();
    renderMcField();
    $('#btnDelete').style.display = g ? 'inline-flex' : 'none';
    $('#modalBackdrop').classList.add('open');
    setTimeout(() => $('#f_title').focus(), 60);
  }
  function closeModal() { $('#modalBackdrop').classList.remove('open'); editingId = null; clearPendingCover(); }

  function renderMcField() {
    const mc = modalExtra.mc || 0;
    $('#mcField').hidden = false;
    $('#mcBadgeSlot').innerHTML = mc ? mcBadge(mc) : mcBadgeNA();
  }

  function setRating(v) {
    v = Math.min(10, Math.max(0, Math.round((Number(v) || 0) * 10) / 10));
    $('#f_rating').value = v;
    $('#f_ratingNum').value = v.toFixed(1);
  }
  function syncRating() { // desde el deslizador
    $('#f_ratingNum').value = (Number($('#f_rating').value) || 0).toFixed(1);
  }
  function syncRatingFromNum(reformat) { // desde la casilla
    let v = Math.min(10, Math.max(0, Number($('#f_ratingNum').value) || 0));
    $('#f_rating').value = v;
    if (reformat) $('#f_ratingNum').value = (Math.round(v * 10) / 10).toFixed(1);
  }
  function syncCoverPreview() {
    const url = pendingCover ? pendingCover.url : $('#f_cover').value.trim();
    const box = $('#coverPreview');
    if (url) {
      box.innerHTML = `<img src="${escapeAttr(url)}" alt="" onerror="this.style.display='none'">`;
    } else {
      const title = $('#f_title').value.trim() || 'Juego';
      box.innerHTML = `<div class="cover-gen" style="${genCoverStyle(title)};position:absolute;inset:0;"><div class="gtitle" style="font-size:14px">${escapeHTML(title)}</div></div>`;
    }
  }

  async function saveFromModal() {
    if (saving) return;
    const title = $('#f_title').value.trim();
    if (!title) { $('#f_title').focus(); toast('Pon un título'); return; }
    const data = {
      title,
      platform: $('#f_platform').value,
      date: $('#f_date').value,
      hours: Number($('#f_hours').value) || 0,
      rating: Math.round((Number($('#f_ratingNum').value) || 0) * 10) / 10,
      cover: $('#f_cover').value.trim(),
      note: $('#f_note').value.trim(),
      mc: modalExtra.mc || 0,
      rawgSlug: modalExtra.rawgSlug || '',
      releaseYear: modalExtra.releaseYear || ''
    };
    const prev = editingId ? games.find(x => x.id === editingId) : null;

    saving = true;
    const btn = $('#btnSave');
    btn.disabled = true; btn.textContent = 'Guardando…';
    let uploaded = '';
    try {
      if (pendingCover) data.cover = uploaded = await DB.uploadCover(pendingCover.blob);
      if (prev) {
        const saved = await DB.updateGame(prev.id, data);
        games[games.findIndex(x => x.id === prev.id)] = saved;
        if (prev.cover !== saved.cover) DB.removeCover(prev.cover);
        toast('Juego actualizado');
      } else {
        games.push(await DB.insertGame(data));
        toast('Juego añadido');
      }
    } catch (e) {
      console.error(e);
      if (uploaded) DB.removeCover(uploaded);
      toast('No se pudo guardar — revisa tu conexión');
      return;
    } finally {
      saving = false;
      btn.disabled = false; btn.textContent = 'Guardar';
    }
    activeYear = (activeYear === 'all' || yearOf(data) === 'Sin fecha') ? activeYear : yearOf(data);
    closeModal();
    renderAll();
  }

  function deleteCurrent() {
    if (!editingId) return;
    const g = games.find(x => x.id === editingId);
    if (!g) return;
    pendingDeleteId = editingId;
    $('#confirmText').innerHTML = `Vas a borrar <b>${escapeHTML(g.title)}</b>. Esta acción no se puede deshacer.`;
    $('#confirmBackdrop').classList.add('open');
    setTimeout(() => $('#confirmOk').focus(), 60);
  }
  let pendingDeleteId = null;
  function closeConfirm() { $('#confirmBackdrop').classList.remove('open'); pendingDeleteId = null; }
  async function confirmDelete() {
    if (!pendingDeleteId) return;
    const g = games.find(x => x.id === pendingDeleteId);
    try {
      await DB.deleteGame(pendingDeleteId);
    } catch (e) {
      console.error(e);
      toast('No se pudo borrar — revisa tu conexión');
      return;
    }
    if (g) DB.removeCover(g.cover);
    games = games.filter(x => x.id !== pendingDeleteId);
    closeConfirm();
    closeModal();
    renderAll();
    toast('Juego borrado');
  }

  /* ---------- toast ---------- */
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    $('#toastMsg').textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2400);
  }

  /* ---------- tema ---------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    $('#themeIcon').innerHTML = theme === 'dark'
      ? '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'
      : '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>';
  }

  /* ============================================================
     EVENTOS
     ============================================================ */
  function bind() {
    $('#filterYear').addEventListener('change', e => {
      activeYear = e.target.value;
      renderAll();
    });

    $('#searchInput').addEventListener('input', e => { filters.q = e.target.value; renderGrid(); });
    $('#filterPlatform').addEventListener('change', e => { filters.platform = e.target.value; renderGrid(); });
    $('#filterRating').addEventListener('change', e => { filters.minRating = Number(e.target.value); renderGrid(); });

    $('#btnReset').addEventListener('click', () => {
      filters.q = ''; filters.platform = 'all'; filters.minRating = 0;
      activeYear = 'all';
      $('#searchInput').value = '';
      $('#filterPlatform').value = 'all';
      $('#filterRating').value = '0';
      $('#filterYear').value = 'all';
      renderAll();
      toast('Filtros restablecidos');
    });

    $('#btnAdd').addEventListener('click', () => openModal());

    // grid: click tarjeta -> editar; botones internos paran propagación
    $('#grid').addEventListener('click', e => {
      if (e.target.closest('[data-stop]')) {
        const eb = e.target.closest('[data-edit]');
        if (eb) { e.preventDefault(); openModal(eb.dataset.edit); }
        return;
      }
      const card = e.target.closest('.card');
      if (card) openModal(card.dataset.id);
    });
    $('#grid').addEventListener('keydown', e => {
      if (e.key === 'Enter') { const c = e.target.closest('.card'); if (c) openModal(c.dataset.id); }
    });

    // modal
    $('#btnSave').addEventListener('click', saveFromModal);
    $('#btnCancel').addEventListener('click', closeModal);
    $('#btnClose').addEventListener('click', closeModal);
    $('#btnDelete').addEventListener('click', deleteCurrent);
    $('#confirmCancel').addEventListener('click', closeConfirm);
    $('#confirmOk').addEventListener('click', confirmDelete);
    $('#confirmBackdrop').addEventListener('click', e => { if (e.target.id === 'confirmBackdrop') closeConfirm(); });
    $('#modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if ($('#confirmBackdrop').classList.contains('open')) { closeConfirm(); return; }
        closeModal(); closeSettings();
      }
      if (e.key === 'Enter' && $('#confirmBackdrop').classList.contains('open')) { confirmDelete(); return; }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && $('#modalBackdrop').classList.contains('open')) saveFromModal();
    });
    $('#f_rating').addEventListener('input', syncRating);
    $('#f_ratingNum').addEventListener('input', () => syncRatingFromNum(false));
    $('#f_ratingNum').addEventListener('change', () => syncRatingFromNum(true));
    $('#f_cover').addEventListener('input', () => { clearPendingCover(); syncCoverPreview(); });
    $('#f_title').addEventListener('input', () => {
      onTitleInput();
      if (!$('#f_cover').value.trim()) syncCoverPreview();
    });
    // navegación con teclado en el autocompletado
    $('#f_title').addEventListener('keydown', e => {
      const items = $$('.ac-item'); if (!items.length || $('#acDropdown').hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); acActive = Math.min(acActive + 1, items.length - 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); acActive = Math.max(acActive - 1, 0); }
      else if (e.key === 'Enter' && acActive >= 0) { e.preventDefault(); selectGame(acResults[acActive]); return; }
      else return;
      items.forEach((it, i) => it.classList.toggle('active', i === acActive));
    });
    $('#f_title').addEventListener('blur', () => setTimeout(hideAc, 150));

    // ajustes (admin): invitados + clave RAWG
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnInvite').addEventListener('click', addInvite);
    $('#f_invite').addEventListener('keydown', e => { if (e.key === 'Enter') addInvite(); });
    $('#inviteList').addEventListener('click', e => {
      const b = e.target.closest('.inv-del');
      if (b) removeInvite(b.dataset.email);
    });
    $('#btnCloseSettings').addEventListener('click', closeSettings);
    $('#btnCloseSettings2').addEventListener('click', closeSettings);
    $('#btnSaveKey').addEventListener('click', saveKey);
    $('#settingsBackdrop').addEventListener('click', e => { if (e.target.id === 'settingsBackdrop') closeSettings(); });
    $('#f_key').addEventListener('keydown', e => { if (e.key === 'Enter') saveKey(); });

    // subir imagen -> se reduce y se sube al guardar
    $('#f_file').addEventListener('change', e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      shrinkImage(file).then(blob => {
        clearPendingCover();
        pendingCover = { blob, url: URL.createObjectURL(blob) };
        $('#f_cover').value = '';
        syncCoverPreview();
      }).catch(() => toast('No se pudo leer la imagen'));
    });

    // tema
    $('#btnTheme').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'dark' ? 'light' : 'dark');
    });
  }

  /* ---------- desplegable propio (candy) ---------- */
  const csTick = '<svg class="cs-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
  const csChev = '<svg class="cs-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  function enhanceSelects() {
    $$('.select-wrap').forEach(wrap => {
      const sel = wrap.querySelector('select');
      if (!sel || wrap.classList.contains('cs-ready')) return;
      const oldChev = wrap.querySelector('.chev');
      if (oldChev) oldChev.style.display = 'none';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cs-btn';
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.innerHTML = `<span class="cs-label"></span>${csChev}`;

      const menu = document.createElement('ul');
      menu.className = 'cs-menu';
      menu.setAttribute('role', 'listbox');

      wrap.appendChild(btn);
      wrap.appendChild(menu);
      wrap.classList.add('cs-ready');

      function labelText() {
        const o = sel.options[sel.selectedIndex];
        return o ? o.textContent : '';
      }
      function syncLabel() { btn.querySelector('.cs-label').textContent = labelText(); }
      function buildMenu() {
        menu.innerHTML = [...sel.options].map(o =>
          `<li class="cs-opt" role="option" data-val="${escapeAttr(o.value)}" aria-selected="${o.selected}" tabindex="-1">${csTick}<span>${escapeHTML(o.textContent)}</span></li>`
        ).join('');
      }
      function open() {
        $$('.select-wrap.cs-open').forEach(w => w !== wrap && w.classList.remove('cs-open'));
        buildMenu();
        wrap.classList.add('cs-open');
        btn.setAttribute('aria-expanded', 'true');
      }
      function close() { wrap.classList.remove('cs-open'); btn.setAttribute('aria-expanded', 'false'); }

      btn.addEventListener('click', e => {
        e.stopPropagation();
        wrap.classList.contains('cs-open') ? close() : open();
      });
      menu.addEventListener('click', e => {
        const opt = e.target.closest('.cs-opt');
        if (!opt) return;
        sel.value = opt.dataset.val;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        syncLabel();
        close();
      });
      sel._cs = { syncLabel };
      syncLabel();
    });
  }
  function syncCustomSelects() { $$('.select-wrap.cs-ready select').forEach(s => s._cs && s._cs.syncLabel()); }

  /* ============================================================
     CUENTA — acceso, menú de usuario, exportar / importar
     ============================================================ */
  function showGate(mode, detail) {
    document.body.classList.add('locked');
    const text = $('#gateText'), err = $('#gateErr');
    $('#btnGoogle').hidden = mode !== 'login';
    $('#btnGoogle').disabled = false;
    $('#btnGateLogout').hidden = mode !== 'denied';
    err.hidden = !(mode === 'login' && detail);
    if (mode === 'login') {
      text.textContent = 'Tu registro de juegos terminados. Entra con tu cuenta de Google para ver tu lista.';
      err.textContent = detail || '';
    } else if (mode === 'denied') {
      text.innerHTML = `La cuenta <b>${escapeHTML(detail)}</b> no tiene invitación. Pídele acceso a quien te pasó el link.`;
    } else if (mode === 'config') {
      text.textContent = 'Falta conectar la base de datos: completa js/config.js (ver SETUP.md).';
    } else if (mode === 'error') {
      text.textContent = 'No se pudo conectar. Revisa tu conexión y recarga la página.';
    } else {
      text.textContent = 'Cargando…';
    }
  }
  function hideGate() { document.body.classList.remove('locked'); }

  // si el login con Google falla (p. ej. email no invitado), Supabase vuelve con el error en la URL
  function readOAuthError() {
    const params = new URLSearchParams(location.hash.slice(1) + '&' + location.search.slice(1));
    const desc = params.get('error_description') || params.get('error');
    if (!desc) return '';
    history.replaceState(null, '', location.pathname);
    return /invitaci/i.test(desc) ? 'Ese email no está invitado. Pídele acceso a quien te pasó el link.' : desc.replace(/\+/g, ' ');
  }

  async function enter(session) {
    showGate('loading');
    const u = session.user;
    const meta = u.user_metadata || {};
    let access;
    try { access = await DB.access(); }
    catch (e) { console.error(e); showGate('error'); return; }
    if (!access.allowed) { showGate('denied', u.email); return; }

    me = {
      email: (u.email || '').toLowerCase(),
      name: meta.full_name || meta.name || u.email,
      avatar: meta.avatar_url || meta.picture || '',
      admin: access.admin
    };
    try {
      [rawgKey] = await Promise.all([DB.getConfig('rawg_key'), loadGames()]);
    } catch (e) {
      console.error(e); showGate('error'); return;
    }
    renderUser();
    $('#btnSettings').hidden = !me.admin;
    reflectConnection();
    renderAll();
    hideGate();
  }

  function renderUser() {
    $('#userWrap').hidden = false;
    $('#userName').textContent = me.name;
    $('#userEmail').textContent = me.email;
    const btn = $('#btnUser');
    btn.textContent = (me.name || '?').trim().charAt(0).toUpperCase();
    if (me.avatar) {
      const img = document.createElement('img');
      img.src = me.avatar; img.alt = ''; img.referrerPolicy = 'no-referrer';
      img.onload = () => { btn.textContent = ''; btn.appendChild(img); };
    }
  }

  function toggleUserMenu(open) {
    const menu = $('#userMenu');
    open = open === undefined ? menu.hidden : open;
    menu.hidden = !open;
    $('#btnUser').setAttribute('aria-expanded', String(open));
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportGames() {
    const clean = games.map(({ id, ...g }) => g);
    const stamp = new Date().toISOString().slice(0, 10);
    download(`videojuegos-completados-${stamp}.json`, JSON.stringify({ app: 'videojuegos-completados', version: 1, exportedAt: new Date().toISOString(), games: clean }, null, 2));
    toast(`Exportados ${clean.length} juegos`);
  }

  // acepta el export nuevo ({ games: [...] }) y la lista de la versión anterior ([...])
  async function importGames(file) {
    let list;
    try {
      const parsed = JSON.parse(await file.text());
      list = Array.isArray(parsed) ? parsed : parsed.games;
      if (!Array.isArray(list)) throw new Error('formato');
    } catch (e) { toast('Ese archivo no es una lista de juegos'); return; }

    const key = g => String(g.title || '').trim().toLowerCase() + '|' + String(g.date || '').slice(0, 4);
    const have = new Set(games.map(key));
    const fresh = list.filter(g => g && String(g.title || '').trim() && !have.has(key(g)));
    const skipped = list.length - fresh.length;
    if (!fresh.length) { toast(skipped ? 'Todos esos juegos ya estaban en tu lista' : 'El archivo está vacío'); return; }

    toast(`Importando ${fresh.length} juegos…`);
    const ready = [];
    for (const g of fresh) {
      let cover = String(g.cover || '');
      if (cover.startsWith('data:')) { // carátula subida en la versión anterior -> a Storage
        try { cover = await DB.uploadCover(await shrinkImage(await (await fetch(cover)).blob())); }
        catch (e) { cover = ''; }
      }
      ready.push({ ...g, title: String(g.title).trim(), cover });
    }
    try {
      games.push(...await DB.insertGames(ready));
    } catch (e) {
      console.error(e); toast('No se pudo importar — revisa tu conexión'); return;
    }
    renderAll();
    toast(`Importados ${ready.length} juegos` + (skipped ? ` (${skipped} repetidos omitidos)` : ''));
  }

  // reduce la imagen a máx. 800px de lado y la pasa a JPEG
  function shrinkImage(blob, max = 800) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => b ? resolve(b) : reject(new Error('canvas')), 'image/jpeg', 0.86);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen')); };
      img.src = url;
    });
  }

  function bindAccount() {
    $('#btnGoogle').addEventListener('click', async () => {
      $('#btnGoogle').disabled = true;
      const { error } = await DB.signInWithGoogle();
      if (error) showGate('login', 'No se pudo abrir el login de Google: ' + error.message);
    });
    const logout = async () => { toggleUserMenu(false); await DB.signOut(); location.reload(); };
    $('#btnGateLogout').addEventListener('click', logout);
    $('#btnLogout').addEventListener('click', logout);
    $('#btnUser').addEventListener('click', e => { e.stopPropagation(); toggleUserMenu(); });
    $('#userMenu').addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => toggleUserMenu(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleUserMenu(false); });
    $('#btnExport').addEventListener('click', () => { toggleUserMenu(false); exportGames(); });
    $('#f_import').addEventListener('change', e => {
      const file = e.target.files[0];
      e.target.value = '';
      toggleUserMenu(false);
      if (file) importGames(file);
    });
  }

  /* ---------- init ---------- */
  async function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'light');
    bind();
    bindAccount();
    enhanceSelects();
    document.addEventListener('click', () => $$('.select-wrap.cs-open').forEach(w => w.classList.remove('cs-open')));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.select-wrap.cs-open').forEach(w => w.classList.remove('cs-open')); });
    renderMarquee();

    if (!DB || !DB.configured) { showGate('config'); return; }
    const oauthError = readOAuthError();
    DB.onAuthChange(event => { if (event === 'SIGNED_OUT') location.reload(); });
    const session = await DB.getSession();
    if (!session) { showGate('login', oauthError); return; }
    await enter(session);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

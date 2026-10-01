/* ============================================================
   Videojuegos completados — lógica
   ============================================================ */
(function () {
  'use strict';

  const THEME_KEY = 'vj_tema';
  const SECTION_KEY = 'vj_seccion';
  const DB = window.VJDB;

  const PLATFORMS = [
    'PS5', 'PS4', 'Switch', 'Switch 2', 'Xbox Series', 'Xbox One',
    'PC', 'Steam Deck', 'Nintendo 3DS', 'Retro', 'Móvil'
  ];

  /* ---------- estado ---------- */
  let games = [];
  let wishlist = [];      // juegos pendientes
  let section = 'done';   // 'done' (Completados) | 'play' (Jugando) | 'wish' (Wishlist)
  let activeYear = 'all';
  const filters = { q: '', platform: 'all', rating: 'all', priority: 'all', sort: 'date' }; // rating: all | high | mid | low (color de la nota)
  let me = null;          // { email, name, avatar, admin }

  /* ---------- persistencia (Supabase) ---------- */
  // si la tabla de wishlist no existe todavía (falta correr la migración), Completados sigue andando
  // y si falta la migración de "Jugando" (003), Wishlist y Completados siguen andando
  let wishlistReady = true, playReady = true;
  async function loadGames() {
    const [g, w] = await Promise.all([
      DB.listGames(),
      DB.listWishlist().catch(e => { console.error(e); return null; })
    ]);
    games = g;
    wishlist = w || [];
    wishlistReady = !!w;
    playReady = wishlistReady ? await DB.checkPlaying().catch(() => false) : false;
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
  // color de la nota, como Metacritic: hasta 4.9 rojo, de 5 a 7.4 amarillo, de 7.5 a 10 verde
  function rateClass(r) {
    r = Math.round((Number(r) || 0) * 10) / 10; // una sola cifra decimal: 7.45 guardado como 7.5
    return r >= 7.5 ? 'high' : r >= 5 ? 'mid' : 'low';
  }
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
    const mono = document.createElement('div');
    mono.className = 'gmono';
    mono.textContent = box.dataset.mono || '';
    box.replaceChildren(mono);
  };

  function searchURL(site, title) {
    const q = encodeURIComponent(title.trim());
    if (site === 'hltb') return `https://howlongtobeat.com/?q=${q}`;
    return `https://www.metacritic.com/search/${q}/`;
  }

  /* ============================================================
     RAWG — base de datos de videojuegos (autocompletado)
     ============================================================ */
  // La búsqueda pasa por la Edge Function "rawg-search" (la clave de RAWG vive en Supabase).

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

  let acTimer = null, acSeq = 0, acResults = [], acActive = -1;
  let modalExtra = {}; // mc, rawgSlug, releaseYear del juego (guardados o del autofill)
  let extraFromAutofill = false; // true si modalExtra salió de elegir un resultado de RAWG

  function hideAc() { const d = $('#acDropdown'); d.hidden = true; d.innerHTML = ''; acActive = -1; }

  function setHint(html) { $('#acHint').innerHTML = html || ''; }

  function onTitleInput() {
    $('#autofillBadge').hidden = true;
    $('#autofillInfo').hidden = true;
    // si el dato venía de un resultado elegido y el título cambió, ya no corresponde a este juego;
    // si venía guardado (editar), corregir el título no lo borra
    if (extraFromAutofill) { modalExtra = {}; extraFromAutofill = false; renderMcField(); }
    clearTimeout(acTimer);
    const q = $('#f_title').value.trim();
    setHint('');
    if (q.length < 2) { hideAc(); return; }
    acTimer = setTimeout(() => acSearch(q), 350);
  }

  async function acSearch(q) {
    const seq = ++acSeq; // descarta respuestas de búsquedas viejas
    $('#titleSpin').hidden = false;
    try {
      const results = await DB.searchGames(q);
      if (seq !== acSeq) return;
      acResults = results.filter(g => g.name);
      renderAc();
    } catch (e) {
      if (seq !== acSeq) return;
      console.error(e);
      setHint('El autocompletado no está disponible ahora — rellena los datos a mano.');
      hideAc();
    } finally {
      if (seq === acSeq) $('#titleSpin').hidden = true;
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
      const mc = g.metacritic ? `<span class="ac-mc ${mcScoreClass(g.metacritic)}">${g.metacritic}</span>` : '';
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
    extraFromAutofill = true;
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

  /* ---------- ajustes (solo admin): invitados ---------- */
  function openSettings() {
    if (!me || !me.admin) return;
    $('#f_invite').value = '';
    renderInvites();
    openDialog($('#settingsBackdrop'));
    setTimeout(() => $('#f_invite').focus(), 60);
  }
  function closeSettings() { closeDialog($('#settingsBackdrop')); }

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
    flame: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2-4.6.3 1.6 1.2 2.6 2.2 2.6C11 8.5 11 5.5 12 3z"/></svg>',
    check: '<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
    play: '<svg class="icon-sm" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
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

  /* ---------- recorrido: Wishlist → Jugando → Completados ----------
     Un pendiente vive en "wishlist" con status 'pendiente' o 'jugando'. Al terminarlo se crea el
     juego en "games" y el pendiente queda enlazado (completedGameId): ya no se muestra en ninguna
     sección, así cada juego está en un solo lugar. */
  const isOpenWish = w => !w.completedGameId;
  const pendingList = () => wishlist.filter(w => isOpenWish(w) && w.status !== 'jugando');
  const playingList = () => wishlist.filter(w => isOpenWish(w) && w.status === 'jugando');

  /* ---------- render: stats ---------- */
  // en el celular la segunda palabra baja de línea (ver .stat .label span); ­ = guion suave
  const STAT_LABEL = {
    terminados: 'Juegos <span>termi­nados</span>',
    horas: 'Horas <span>jugadas</span>',
    media: 'Nota <span>media</span>',
    pendientes: 'Juegos <span>pendien­tes</span>',
    ganas: 'Muchas <span>ganas</span>',
    algunDia: 'Algún <span>día</span>',
    enCurso: 'Juegos <span>en curso</span>',
    promedio: 'Horas <span>promedio</span>'
  };
  function setStatLabels(a, b, c) {
    $('#statLabel1').innerHTML = a; $('#statLabel2').innerHTML = b; $('#statLabel3').innerHTML = c;
  }
  function renderStats() {
    $('#statAvg').closest('.stat').dataset.band = '';
    if (section === 'wish') {
      const pend = pendingList();
      const alta = pend.filter(w => w.priority === 'alta').length;
      setStatLabels(STAT_LABEL.pendientes, STAT_LABEL.ganas, STAT_LABEL.algunDia);
      $('#statCount').textContent = pend.length;
      $('#statHours').textContent = alta;
      $('#statAvg').textContent = pend.length - alta;
      return;
    }
    if (section === 'play') {
      const play = playingList();
      const hrs = play.reduce((s, w) => s + (Number(w.hours) || 0), 0);
      setStatLabels(STAT_LABEL.enCurso, STAT_LABEL.horas, STAT_LABEL.promedio);
      $('#statCount').textContent = play.length;
      $('#statHours').innerHTML = `${hrs}<small>h</small>`;
      $('#statAvg').innerHTML = play.length ? `${Math.round(hrs / play.length)}<small>h</small>` : '—';
      return;
    }
    const list = games.filter(inActiveYear);
    const hrs = list.reduce((s, g) => s + (Number(g.hours) || 0), 0);
    const rated = list.filter(g => Number(g.rating) > 0);
    const avg = rated.length ? (rated.reduce((s, g) => s + Number(g.rating), 0) / rated.length) : 0;
    setStatLabels(STAT_LABEL.terminados, STAT_LABEL.horas, STAT_LABEL.media);
    $('#statCount').textContent = list.length;
    $('#statHours').innerHTML = `${hrs}<small>h</small>`;
    $('#statAvg').innerHTML = avg ? `${avg.toFixed(1)}<small>/10</small>` : '—';
    // la nota media usa el mismo color que las notas (rojo / amarillo / verde)
    $('#statAvg').closest('.stat').dataset.band = avg ? rateClass(avg.toFixed(1)) : '';
  }

  /* ---------- render: filtros de plataforma ---------- */
  function renderPlatformFilter() {
    const source = section === 'wish' ? pendingList() : section === 'play' ? playingList() : games;
    const used = Array.from(new Set(source.map(g => g.platform).filter(Boolean))).sort();
    const sel = $('#filterPlatform');
    const cur = filters.platform;
    sel.innerHTML = `<option value="all">Todas las plataformas</option>` +
      used.map(p => `<option value="${escapeAttr(p)}">${escapeHTML(p)}</option>`).join('');
    filters.platform = used.includes(cur) ? cur : 'all';
    sel.value = filters.platform;
  }

  /* ---------- render: grid ---------- */
  function matchesText(g) {
    if (!filters.q) return true;
    const q = filters.q.toLowerCase();
    return (g.title || '').toLowerCase().includes(q) || (g.platform || '').toLowerCase().includes(q);
  }

  function currentList() {
    let list = games.filter(inActiveYear).filter(matchesText);
    if (filters.platform !== 'all') list = list.filter(g => g.platform === filters.platform);
    if (filters.rating !== 'all') list = list.filter(g => Number(g.rating) > 0 && rateClass(g.rating) === filters.rating);

    const s = filters.sort;
    list.sort((a, b) => {
      if (s === 'rating') return (b.rating || 0) - (a.rating || 0);
      if (s === 'hours') return (b.hours || 0) - (a.hours || 0);
      if (s === 'title') return (a.title || '').localeCompare(b.title || '');
      return (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''); // date
    });
    return list;
  }

  // "muchas ganas" arriba y lo más nuevo antes
  function currentWishList() {
    let list = pendingList().filter(matchesText);
    if (filters.platform !== 'all') list = list.filter(w => w.platform === filters.platform);
    if (filters.priority !== 'all') list = list.filter(w => w.priority === filters.priority);
    const rank = w => (w.priority === 'alta' ? 0 : 1);
    return list.sort((a, b) => rank(a) - rank(b) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  // lo último que empezaste, primero
  function currentPlayList() {
    let list = playingList().filter(matchesText);
    if (filters.platform !== 'all') list = list.filter(w => w.platform === filters.platform);
    return list.sort((a, b) => (b.startedAt || b.createdAt || '').localeCompare(a.startedAt || a.createdAt || ''));
  }

  function coverHTML(g) {
    return g.cover
      ? `<div class="cover" data-mono="${escapeAttr(monogram(g.title))}" data-grad="${escapeAttr(genCoverStyle(g.title))}"><img src="${escapeAttr(g.cover)}" alt="" loading="lazy" onerror="window.__coverFail(this)"></div>`
      : `<div class="cover-gen" style="${genCoverStyle(g.title)}"><div class="gmono">${escapeHTML(monogram(g.title))}</div></div>`;
  }

  function cardLinks(title) {
    const t = escapeAttr(title);
    return `<div class="card-links">
          <a class="card-link hltb" href="${searchURL('hltb', title)}" target="_blank" rel="noopener" data-stop title="HowLongToBeat" aria-label="Buscar ${t} en HowLongToBeat (abre otra pestaña)">${I.clock}</a>
          <a class="card-link mc" href="${searchURL('mc', title)}" target="_blank" rel="noopener" data-stop title="Metacritic" aria-label="Buscar ${t} en Metacritic (abre otra pestaña)"><span class="cl-m" aria-hidden="true">m</span></a>
        </div>`;
  }

  function cardHTML(g) {
    const rc = rateClass(g.rating);
    const rateChip = g.rating ? `<div class="rate-chip ${rc}">${I.star}${fmtRating(g.rating)}</div>` : '';

    return `<article class="card" data-id="${g.id}">
      <div class="card-cover">
        ${coverHTML(g)}
        ${rateChip}
      </div>
      <div class="card-info">
        <h3 class="card-title"><button type="button" class="card-open" aria-label="Editar ${escapeAttr(g.title)}">${escapeHTML(g.title)}</button></h3>
        <div class="card-meta">
          ${g.platform ? `<span class="tag">${escapeHTML(g.platform)}</span>` : ''}
          ${g.mc ? mcBadge(g.mc, true) : ''}
        </div>
        <div class="card-foot">
          ${g.hours ? `<span class="card-hours">${I.clock}${g.hours}h</span><span class="foot-sep"></span>` : ''}
          <span class="card-year">${fmtDate(g.date)}</span>
        </div>
        ${cardLinks(g.title)}
      </div>
    </article>`;
  }

  // pendiente de la wishlist: su siguiente paso es "Empezar"
  function wishCardHTML(w) {
    const prio = w.priority === 'alta' ? `<div class="prio-chip">${I.flame} Muchas ganas</div>` : '';
    return `<article class="card wish-card" data-wid="${w.id}">
      <div class="card-cover">
        ${coverHTML(w)}
        ${prio}
      </div>
      <div class="card-info">
        <h3 class="card-title"><button type="button" class="card-open" aria-label="Editar pendiente ${escapeAttr(w.title)}">${escapeHTML(w.title)}</button></h3>
        <div class="card-meta">
          ${w.platform ? `<span class="tag">${escapeHTML(w.platform)}</span>` : ''}
          ${w.mc ? mcBadge(w.mc, true) : ''}
        </div>
        <div class="card-foot"><button type="button" class="step-cta start" data-start="${w.id}" data-stop>${I.play} Empezar</button></div>
        ${cardLinks(w.title)}
      </div>
    </article>`;
  }

  // juego en curso: horas y desde cuándo; su siguiente paso es "¡Terminado!"
  function playCardHTML(w) {
    const since = w.startedAt ? new Date(w.startedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '';
    return `<article class="card play-card" data-wid="${w.id}">
      <div class="card-cover">
        ${coverHTML(w)}
        <div class="playing-chip">${I.play} Jugando</div>
      </div>
      <div class="card-info">
        <h3 class="card-title"><button type="button" class="card-open" aria-label="Editar ${escapeAttr(w.title)} (jugando, ${w.hours || 0} horas)">${escapeHTML(w.title)}</button></h3>
        <div class="card-meta">
          ${w.platform ? `<span class="tag">${escapeHTML(w.platform)}</span>` : ''}
          ${w.mc ? mcBadge(w.mc, true) : ''}
        </div>
        <div class="card-foot">
          <span class="card-hours">${I.clock}${w.hours || 0}h</span>
          ${since ? `<span class="foot-sep"></span><span class="card-year">desde ${since}</span>` : ''}
        </div>
        <div class="card-foot"><button type="button" class="step-cta finish" data-complete="${w.id}" data-stop>${I.check} ¡Terminado!</button></div>
        ${cardLinks(w.title)}
      </div>
    </article>`;
  }

  function emptyHTML(title, text, withAdd, addLabel) {
    return `<div class="empty">
        <div class="ico">${I.pad}</div>
        <h3>${title}</h3>
        <p>${text}</p>
        ${withAdd ? `<button class="btn-add" id="emptyAdd">${I.plus} ${addLabel}</button>` : ''}
      </div>`;
  }

  /* ---------- filtros activos (etiquetas del celular) ---------- */
  const RATING_LABEL = { high: 'Notas verdes', mid: 'Notas amarillas', low: 'Notas rojas' };
  function activeFilterList() {
    const out = [];
    if (section === 'done' && activeYear !== 'all') out.push({ key: 'year', label: 'Año ' + activeYear });
    if (filters.platform !== 'all') out.push({ key: 'platform', label: filters.platform });
    if (section === 'done' && filters.rating !== 'all') out.push({ key: 'rating', label: RATING_LABEL[filters.rating] });
    if (section === 'wish' && filters.priority !== 'all') out.push({ key: 'priority', label: filters.priority === 'alta' ? 'Muchas ganas' : 'Algún día' });
    return out;
  }
  function renderActiveFilters() {
    const list = activeFilterList();
    const x = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    $('#activeFilters').innerHTML = list.map(f =>
      `<button type="button" class="filter-chip" data-clear="${f.key}"${f.key === 'rating' ? ` data-band="${filters.rating}"` : ''} aria-label="Quitar filtro ${escapeAttr(f.label)}">${escapeHTML(f.label)}<span class="x" aria-hidden="true">${x}</span></button>`
    ).join('');
    const count = $('#filtersCount');
    count.textContent = list.length;
    count.hidden = list.length === 0;
    $('#btnFilters').setAttribute('aria-label', list.length ? `Filtros (${list.length} activos)` : 'Filtros');
  }
  function clearFilter(key) {
    if (key === 'year') { activeYear = 'all'; $('#filterYear').value = 'all'; }
    if (key === 'platform') { filters.platform = 'all'; $('#filterPlatform').value = 'all'; }
    if (key === 'rating') { filters.rating = 'all'; $('#filterRating').value = 'all'; }
    if (key === 'priority') { filters.priority = 'all'; $('#filterPriority').value = 'all'; }
    renderAll();
  }

  function renderGrid() {
    renderStats();
    renderActiveFilters();
    const grid = $('#grid');

    if (section !== 'done' && !wishlistReady) {
      grid.innerHTML = emptyHTML('Wishlist sin activar', 'Falta crear la tabla en Supabase: corre supabase/migrations/002_wishlist.sql (ver SETUP.md).', false);
      return;
    }
    if (section === 'play' && !playReady) {
      grid.innerHTML = emptyHTML('Jugando sin activar', 'Falta un paso en Supabase: corre supabase/migrations/003_jugando.sql (ver SETUP.md).', false);
      return;
    }
    const list = section === 'wish' ? currentWishList() : section === 'play' ? currentPlayList() : currentList();
    if (list.length === 0) {
      const total = section === 'wish' ? pendingList().length : section === 'play' ? playingList().length : games.filter(inActiveYear).length;
      grid.innerHTML = total > 0
        ? emptyHTML('Sin resultados', 'Prueba a cambiar los filtros o el buscador.', false)
        : section === 'wish'
          ? emptyHTML('Tu wishlist está vacía', 'Guarda aquí los juegos que tienes ganas de jugar.', true, 'Añadir el primero')
          : section === 'play'
            ? emptyHTML('No estás jugando nada', 'Toca "Empezar" en un juego de tu wishlist, o empieza uno nuevo.', true, 'Empezar un juego')
            : emptyHTML(`Aún no hay juegos en ${activeYear === 'all' ? 'tu lista' : activeYear}`, 'Empieza a registrar los juegos que has terminado.', true, 'Añadir el primero');
      const ea = $('#emptyAdd');
      if (ea) ea.addEventListener('click', openAddForSection);
      return;
    }
    const render = section === 'wish' ? wishCardHTML : section === 'play' ? playCardHTML : cardHTML;
    grid.innerHTML = list.map(render).join('');
    // animación de entrada escalonada
    grid.classList.remove('anim'); void grid.offsetWidth; grid.classList.add('anim');
    $$('.card', grid).forEach((c, i) => { c.style.animationDelay = Math.min(i * 45, 600) + 'ms'; });
  }

  /* ---------- marquesina ---------- */
  const MARQUEE = {
    done: ['Tus partidas', 'Completados', 'Howlongtobeat', 'Metacritic', 'Nivel completado', 'Game over', 'Play hard'],
    play: ['Jugando', 'Partida en curso', 'Checkpoint', 'Continue?', 'Player 1', 'Guardando…', 'Un nivel más'],
    wish: ['Wishlist', 'Próxima partida', 'Muchas ganas', 'Algún día', 'Press start', 'Insert coin', 'Player 2']
  };
  function renderMarquee() {
    const track = $('#marqueeTrack');
    if (!track) return;
    const group = `<span>${MARQUEE[section].join('</span><span>')}</span>`;
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
    $('#tabCountDone').textContent = games.length;
    $('#tabCountPlay').textContent = playingList().length;
    $('#tabCountWish').textContent = pendingList().length;
    $('#mastTitle').textContent = { done: 'Completados', play: 'Jugando', wish: 'Wishlist' }[section];
    renderTop10Button();
    $('#addCtaText').textContent = { done: 'Añadir juego', play: 'Empezar un juego', wish: 'Añadir a wishlist' }[section];
  }
  function openAddForSection() {
    if (section === 'wish') openWishModal();
    else if (section === 'play') openPlayModal();
    else openModal();
  }

  /* ---------- Mi Top 10 ---------- */
  // Ordena por nota; los empates comparten puesto (1, 1, 3…) y, si hay empate en el 10, entran todos.
  // Respeta el filtro de año. "Ver 10 más" amplía de a 10 hasta 100.
  const TOP_STEP = 10, TOP_MAX = 100;
  let topLimit = TOP_STEP;
  function topList(limit = TOP_STEP) {
    const rated = games.filter(inActiveYear).filter(g => Number(g.rating) > 0)
      .sort((a, b) => b.rating - a.rating || (a.title || '').localeCompare(b.title || ''));
    const out = [];
    let rank = 0;
    rated.forEach((g, i) => {
      if (i === 0 || g.rating !== rated[i - 1].rating) rank = i + 1;
      if (rank <= limit) out.push({ g, rank });
    });
    const perRank = out.reduce((m, x) => (m[x.rank] = (m[x.rank] || 0) + 1, m), {});
    const list = out.map(x => ({ ...x, tie: perRank[x.rank] > 1 }));
    list.more = rated.length > out.length && limit < TOP_MAX;
    return list;
  }

  function renderTop10Button() {
    const top = topList();
    const btn = $('#btnTop10');
    btn.disabled = false;
    btn.setAttribute('aria-label', top.length ? `Mi Top 10: el número 1 es ${top[0].g.title}` : 'Mi Top 10');
  }

  function openTop10() {
    topLimit = TOP_STEP;
    renderTop10();
    openDialog($('#top10Backdrop'));
    setTimeout(() => $('#btnCloseTop10').focus(), 60);
  }
  function renderTop10() {
    const top = topList(topLimit);
    $('#top10Title').textContent = 'Mi Top ' + topLimit;
    $('#top10Sub').textContent = activeYear === 'all' ? 'De todos los años' : 'Año ' + activeYear;
    const list = $('#top10List');
    if (!top.length) {
      list.innerHTML = '<li class="top10-empty">Todavía no hay juegos con nota. Ponle nota a los que terminaste y aparecen acá.</li>';
    } else {
      list.innerHTML = top.map(({ g, rank, tie }) => {
        const medal = rank <= 3 ? ` medal-${rank}` : '';
        const meta = [g.platform, fmtDate(g.date)].filter(x => x && x !== '—').join(' · ');
        return `<li class="t10-item rank-${rank}${medal}${rank >= 100 ? ' rank-3d' : ''}">
          <button type="button" class="t10-row" data-id="${g.id}" aria-label="Puesto ${rank}${tie ? ' (empate)' : ''}: ${escapeAttr(g.title)}, nota ${fmtRating(g.rating)}. Editar">
            <span class="t10-rank" aria-hidden="true">${rank}${tie ? '<small>=</small>' : ''}</span>
            <span class="mini-cover" aria-hidden="true">${coverHTML(g)}</span>
            <span class="t10-name"><span class="t10-title">${escapeHTML(g.title)}</span>${meta ? `<span class="t10-meta">${escapeHTML(meta)}</span>` : ''}</span>
            <span class="t10-score ${rateClass(g.rating)}" aria-hidden="true">${fmtRating(g.rating)}</span>
          </button>
        </li>`;
      }).join('');
    }
    $('#btnTopMore').hidden = !top.more;
  }
  // suma 10 puestos y lleva el foco al primero nuevo
  function moreTop10() {
    const shown = $$('#top10List .t10-row').length;
    topLimit = Math.min(TOP_MAX, topLimit + TOP_STEP);
    renderTop10();
    const next = $$('#top10List .t10-row')[shown];
    if (next) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
  }
  function closeTop10() { closeDialog($('#top10Backdrop')); }

  /* ---------- secciones ---------- */
  function setSection(next, silent) {
    section = ['wish', 'play'].includes(next) ? next : 'done';
    try { localStorage.setItem(SECTION_KEY, section); } catch (e) { /* noop */ }
    document.body.dataset.section = section;
    $('#tabDone').setAttribute('aria-selected', String(section === 'done'));
    $('#tabPlay').setAttribute('aria-selected', String(section === 'play'));
    $('#tabWish').setAttribute('aria-selected', String(section === 'wish'));
    filters.platform = 'all';
    renderMarquee();
    if (!silent) renderAll();
  }

  // una carátula puede estar compartida entre un pendiente y el juego completado que salió de él
  function coverInUse(url, skip) {
    if (!url) return false;
    return games.some(g => g !== skip && g.cover === url) || wishlist.some(w => w !== skip && w.cover === url);
  }
  function dropCover(url, skip) {
    if (url && !coverInUse(url, skip)) DB.removeCover(url);
  }

  /* ---------- diálogos: foco atrapado adentro y devuelto al cerrar ---------- */
  const dialogs = []; // [{ el, prev, cardSel }]
  function openDialog(backdrop) {
    if (!dialogs.some(d => d.el === backdrop)) {
      const prev = document.activeElement;
      const card = prev && prev.closest ? prev.closest('.card') : null;
      const cardSel = card ? (card.dataset.id ? `.card[data-id="${card.dataset.id}"] .card-open` : `.card[data-wid="${card.dataset.wid}"] .card-open`) : null;
      dialogs.push({ el: backdrop, prev, cardSel });
    }
    backdrop.classList.add('open');
  }
  function closeDialog(backdrop) {
    backdrop.classList.remove('open');
    const i = dialogs.findIndex(d => d.el === backdrop);
    if (i < 0) return;
    const { prev, cardSel } = dialogs.splice(i, 1)[0];
    // si la tarjeta se volvió a dibujar, buscar la nueva; si se borró, ir a "Añadir"
    const target = (prev && document.contains(prev) && prev !== document.body) ? prev
      : (cardSel && $(cardSel)) || (prev && prev !== document.body ? $('#btnAdd') : null);
    if (target) target.focus({ preventScroll: true });
  }
  function focusablesIn(el) {
    return $$('a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])', el)
      .filter(x => x.offsetParent !== null && !x.closest('[hidden]'));
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || !dialogs.length) return;
    const top = dialogs[dialogs.length - 1].el;
    const items = focusablesIn(top);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ============================================================
     MODAL (juego completado · pendiente de wishlist · completar pendiente)
     ============================================================ */
  let editingId = null;       // id del juego o del pendiente que se edita
  let modalMode = 'done';     // 'done' | 'wish'
  let completingWish = null;  // pendiente que se está marcando como completado
  let pendingCover = null;    // { blob, url } — imagen elegida del dispositivo, se sube al guardar
  let saving = false;

  function clearPendingCover() {
    if (pendingCover) URL.revokeObjectURL(pendingCover.url);
    pendingCover = null;
  }

  function buildPlatformOptions(selected) {
    const list = selected && !PLATFORMS.includes(selected) ? [...PLATFORMS, selected] : PLATFORMS;
    return list.map(p => `<option value="${escapeAttr(p)}" ${p === selected ? 'selected' : ''}>${escapeHTML(p)}</option>`).join('');
  }
  function buildYearOptions(selected) {
    const now = new Date().getFullYear();
    const opts = [];
    for (let y = now + 1; y >= 1985; y--) {
      opts.push(`<option value="${y}" ${String(selected) === String(y) ? 'selected' : ''}>${y}</option>`);
    }
    return opts.join('');
  }

  // src: datos con los que se rellena el formulario (juego, pendiente o nada)
  function fillForm(mode, src, title) {
    modalMode = mode;
    $('#modalBackdrop').dataset.mode = mode;
    $('#modalBackdrop').dataset.editing = editingId ? '1' : '';
    $('#modalTitle').textContent = title;
    $('#f_title').value = src ? src.title : '';
    $('#f_platform').innerHTML = buildPlatformOptions(src && src.platform ? src.platform : 'PS5');
    $('#f_date').innerHTML = buildYearOptions(src && src.date ? yearOf(src) : new Date().getFullYear());
    $('#f_hours').value = src && src.hours ? src.hours : '';
    setRating(src && src.rating ? src.rating : 8);
    $('#f_cover').value = src ? (src.cover || '') : '';
    const prio = src && src.priority === 'alta' ? 'alta' : 'normal';
    $$('input[name="f_prio"]').forEach(r => { r.checked = r.value === prio; });
    const isNote = mode !== 'done';
    $('#noteLabel').textContent = isNote ? 'Nota' : 'Comentario';
    $('#noteToggleText').textContent = isNote ? 'Añadir nota' : 'Añadir comentario';
    $('#f_note').placeholder = mode === 'wish' ? 'Por qué lo quieres jugar, quién te lo recomendó…'
      : mode === 'play' ? 'Por dónde vas, qué te está pareciendo…' : 'Lo que te pareció…';
    $('#hoursLabel').textContent = mode === 'play' ? 'Horas hasta ahora' : 'Horas';
    modalExtra = src ? { mc: src.mc || 0, rawgSlug: src.rawgSlug || '', releaseYear: src.releaseYear || '' } : {};
    extraFromAutofill = false;
    $('#autofillBadge').hidden = true;
    $('#autofillInfo').hidden = true;
    hideAc();
    clearPendingCover();
    setHint('');
    syncRating();
    syncCoverPreview();
    renderMcField();
    $('#btnDelete').style.display = editingId ? 'inline-flex' : 'none';
    openDialog($('#modalBackdrop'));
  }

  function openModal(id) {
    editingId = id || null;
    completingWish = null;
    const g = id ? games.find(x => x.id === id) : null;
    fillForm('done', g, g ? 'Editar juego' : 'Añadir juego');
    $('#f_note').value = g ? (g.note || '') : '';
    setNoteOpen(!!$('#f_note').value);
    setTimeout(() => $('#f_title').focus(), 60);
  }

  function openWishModal(id) {
    if (!wishlistReady) { toast('La wishlist todavía no está activada en la base de datos'); return; }
    editingId = id || null;
    completingWish = null;
    const w = id ? wishlist.find(x => x.id === id) : null;
    fillForm('wish', w, w ? 'Editar pendiente' : 'Añadir a wishlist');
    $('#f_note').value = w ? (w.note || '') : '';
    setNoteOpen(!!$('#f_note').value);
    setTimeout(() => $('#f_title').focus(), 60);
  }

  // juego en curso (nuevo o existente)
  function openPlayModal(id) {
    if (!wishlistReady || !playReady) { toast('"Jugando" todavía no está activado en la base de datos'); return; }
    editingId = id || null;
    completingWish = null;
    const w = id ? wishlist.find(x => x.id === id) : null;
    fillForm('play', w, w ? 'Jugando' : 'Empezar un juego');
    $('#f_note').value = w ? (w.note || '') : '';
    setNoteOpen(!!$('#f_note').value);
    setTimeout(() => $(w ? '#f_hours' : '#f_title').focus(), 60);
  }

  // Wishlist → Jugando
  async function startPlaying(wishId) {
    if (!playReady) { toast('"Jugando" todavía no está activado en la base de datos'); return; }
    const w = wishlist.find(x => x.id === wishId);
    if (!w) return;
    try {
      const saved = await DB.updateWish(w.id, { ...w, status: 'jugando', startedAt: new Date().toISOString() });
      wishlist[wishlist.indexOf(w)] = saved;
    } catch (e) { console.error(e); toast('No se pudo empezar — revisa tu conexión'); return; }
    renderAll();
    toast(`¡A jugar! ${w.title} está en Jugando`);
  }

  // Jugando → Wishlist (lo dejaste para más adelante; las horas se conservan)
  async function backToWishlist() {
    const w = editingId && wishlist.find(x => x.id === editingId);
    if (!w) return;
    try {
      const saved = await DB.updateWish(w.id, { ...w, status: 'pendiente' });
      wishlist[wishlist.indexOf(w)] = saved;
    } catch (e) { console.error(e); toast('No se pudo mover — revisa tu conexión'); return; }
    renderAll();
    closeModal();
    toast(`${w.title} volvió a la wishlist`);
  }

  // Jugando → Completados: mismos datos y horas que llevabas; faltan año, nota y comentario
  function openCompleteModal(wishId) {
    const w = wishlist.find(x => x.id === wishId);
    if (!w) return;
    editingId = null;
    completingWish = w;
    fillForm('done', { ...w, date: String(new Date().getFullYear()), rating: 0 }, '¡Terminado!');
    $('#f_note').value = '';
    setNoteOpen(false);
    setTimeout(() => $('#f_hours').focus(), 60);
  }

  // el comentario se muestra abierto si ya tiene texto; si no, queda el botón "+ Añadir…"
  function setNoteOpen(open) {
    $('#noteWrap').hidden = !open;
    $('#btnNoteToggle').setAttribute('aria-expanded', String(open));
  }

  function closeModal() {
    closeDialog($('#modalBackdrop'));
    editingId = null; completingWish = null;
    clearPendingCover(); acSeq++;
  }

  function renderMcField() {
    const mc = modalExtra.mc || 0;
    $('#mcField').hidden = false;
    $('#mcBadgeSlot').innerHTML = mc ? mcBadge(mc) : mcBadgeNA();
  }

  function paintRatingBox() {
    const box = $('.stepper.rating');
    box.classList.remove('high', 'mid', 'low');
    box.classList.add(rateClass($('#f_ratingNum').value));
  }
  function setRating(v) {
    v = Math.min(10, Math.max(0, Math.round((Number(v) || 0) * 10) / 10));
    $('#f_rating').value = v;
    $('#f_ratingNum').value = v.toFixed(1);
    paintRatingBox();
  }
  function syncRating() { // desde el deslizador
    $('#f_ratingNum').value = (Number($('#f_rating').value) || 0).toFixed(1);
    paintRatingBox();
  }
  function syncRatingFromNum(reformat) { // desde la casilla
    let v = Math.min(10, Math.max(0, Number($('#f_ratingNum').value) || 0));
    $('#f_rating').value = v;
    if (reformat) $('#f_ratingNum').value = (Math.round(v * 10) / 10).toFixed(1);
    paintRatingBox();
  }
  function syncCoverPreview() {
    const url = pendingCover ? pendingCover.url : $('#f_cover').value.trim();
    const box = $('#coverPreview');
    if (url) {
      box.innerHTML = `<img src="${escapeAttr(url)}" alt="" onerror="this.style.display='none'">`;
    } else {
      const title = $('#f_title').value.trim() || '?';
      box.innerHTML = `<div class="cover-gen" style="${genCoverStyle(title)};position:absolute;inset:0;"><div class="gmono">${escapeHTML(monogram(title))}</div></div>`;
    }
  }

  async function saveFromModal() {
    if (saving) return;
    const title = $('#f_title').value.trim();
    if (!title) { $('#f_title').focus(); toast('Pon un título'); return; }
    const common = {
      title,
      platform: $('#f_platform').value,
      cover: $('#f_cover').value.trim(),
      note: $('#f_note').value.trim(),
      mc: modalExtra.mc || 0,
      rawgSlug: modalExtra.rawgSlug || '',
      releaseYear: modalExtra.releaseYear || ''
    };
    const data = modalMode === 'wish'
      ? { ...common, priority: ($('input[name="f_prio"]:checked') || {}).value === 'alta' ? 'alta' : 'normal' }
      : modalMode === 'play'
      ? { ...common, status: 'jugando', hours: Number($('#f_hours').value) || 0 }
      : {
          ...common,
          date: $('#f_date').value,
          hours: Number($('#f_hours').value) || 0,
          rating: Math.round((Number($('#f_ratingNum').value) || 0) * 10) / 10
        };

    const ctx = { mode: modalMode, editingId, completingWish };
    saving = true;
    const btn = $('#btnSave');
    btn.disabled = true; btn.textContent = 'Guardando…';
    let uploaded = '';
    try {
      if (pendingCover) data.cover = uploaded = await DB.uploadCover(pendingCover.blob);
      if (ctx.mode === 'wish' || ctx.mode === 'play') await saveWish(data, ctx);
      else await saveGame(data, ctx);
    } catch (e) {
      console.error(e);
      if (uploaded) dropCover(uploaded);
      toast('No se pudo guardar — revisa tu conexión');
      return;
    } finally {
      saving = false;
      btn.disabled = false; btn.textContent = 'Guardar';
    }
    if (ctx.mode === 'done' && !ctx.completingWish) {
      activeYear = (activeYear === 'all' || yearOf(data) === 'Sin fecha') ? activeYear : yearOf(data);
    }
    renderAll();
    closeModal();
  }

  async function saveGame(data, ctx) {
    const prev = ctx.editingId ? games.find(x => x.id === ctx.editingId) : null;
    if (prev) {
      const saved = await DB.updateGame(prev.id, data);
      games[games.indexOf(prev)] = saved;
      if (prev.cover !== saved.cover) dropCover(prev.cover, saved);
      toast('Juego actualizado');
      return;
    }
    const game = await DB.insertGame(data);
    games.push(game);
    if (!ctx.completingWish) { toast('Juego añadido'); return; }
    // enlazar el pendiente con el juego recién creado
    const w = ctx.completingWish;
    try {
      const linked = await DB.updateWish(w.id, { ...w, completedGameId: game.id });
      const i = wishlist.indexOf(w);
      if (i >= 0) wishlist[i] = linked;
      toast('¡Terminado! Ya está en Completados');
    } catch (e) {
      console.error(e);
      toast('Se guardó en Completados, pero no se pudo sacar de Jugando');
    }
  }

  async function saveWish(data, ctx) {
    const prev = ctx.editingId ? wishlist.find(x => x.id === ctx.editingId) : null;
    if (prev) {
      const saved = await DB.updateWish(prev.id, { ...prev, ...data });
      wishlist[wishlist.indexOf(prev)] = saved;
      if (prev.cover !== saved.cover) dropCover(prev.cover, saved);
      toast(ctx.mode === 'play' ? 'Guardado' : 'Pendiente actualizado');
    } else if (ctx.mode === 'play') {
      wishlist.push(await DB.insertWish({ ...data, startedAt: new Date().toISOString() }));
      toast('¡A jugar! Está en Jugando');
    } else {
      wishlist.push(await DB.insertWish(data));
      toast('Añadido a la wishlist');
    }
  }

  let pendingDelete = null; // { kind: 'game' | 'wish', item }
  function deleteCurrent() {
    if (!editingId) return;
    const kind = modalMode === 'done' ? 'game' : 'wish';
    const item = (kind === 'wish' ? wishlist : games).find(x => x.id === editingId);
    if (!item) return;
    pendingDelete = { kind, item };
    const origin = kind === 'game' && wishlist.find(w => w.completedGameId === item.id);
    const extra = origin ? (origin.status === 'jugando' ? ' Volverá a "Jugando".' : ' Volverá a la wishlist.') : '';
    $('#confirmTitle').textContent = kind === 'game' ? '¿Borrar este juego?' : item.status === 'jugando' ? '¿Quitar de Jugando?' : '¿Quitar de la wishlist?';
    $('#confirmText').innerHTML = `Vas a borrar <b>${escapeHTML(item.title)}</b>.${extra} Esta acción no se puede deshacer.`;
    openDialog($('#confirmBackdrop'));
    setTimeout(() => $('#confirmOk').focus(), 60);
  }
  function closeConfirm() { closeDialog($('#confirmBackdrop')); pendingDelete = null; }
  async function confirmDelete() {
    if (!pendingDelete) return;
    const { kind, item } = pendingDelete;
    try {
      if (kind === 'wish') await DB.deleteWish(item.id);
      else await DB.deleteGame(item.id);
    } catch (e) {
      console.error(e);
      toast('No se pudo borrar — revisa tu conexión');
      return;
    }
    if (kind === 'wish') {
      wishlist = wishlist.filter(x => x !== item);
    } else {
      games = games.filter(x => x !== item);
      // la base desenlaza el pendiente (on delete set null); reflejarlo en memoria
      wishlist.forEach(w => { if (w.completedGameId === item.id) w.completedGameId = null; });
    }
    dropCover(item.cover, item);
    renderAll();
    closeConfirm();
    closeModal();
    toast(kind === 'wish' ? 'Quitado' : 'Juego borrado');
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
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* noop */ }
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
    $('#filterRating').addEventListener('change', e => { filters.rating = e.target.value; renderGrid(); });
    $('#filterPriority').addEventListener('change', e => { filters.priority = e.target.value; renderGrid(); });
    $$('.section-tab').forEach(t => t.addEventListener('click', () => { if (t.dataset.section !== section) setSection(t.dataset.section); }));

    $('#btnReset').addEventListener('click', () => {
      filters.q = ''; filters.platform = 'all'; filters.rating = 'all'; filters.priority = 'all';
      activeYear = 'all';
      $('#searchInput').value = '';
      $('#filterPlatform').value = 'all';
      $('#filterRating').value = 'all';
      $('#filterPriority').value = 'all';
      $('#filterYear').value = 'all';
      renderAll();
      toast('Filtros restablecidos');
    });

    $('#btnAdd').addEventListener('click', openAddForSection);
    $('#btnBackToWish').addEventListener('click', backToWishlist);

    // Mi Top 10: tocar un juego lo abre para editar
    $('#btnTop10').addEventListener('click', openTop10);
    $('#btnCloseTop10').addEventListener('click', closeTop10);
    $('#btnTopMore').addEventListener('click', moreTop10);
    $('#top10Backdrop').addEventListener('click', e => { if (e.target.id === 'top10Backdrop') closeTop10(); });
    $('#top10List').addEventListener('click', e => {
      const row = e.target.closest('.t10-row');
      if (!row) return;
      closeTop10();
      openModal(row.dataset.id);
    });

    // celular: filtros plegados detrás del botón junto al buscador
    $('#btnFilters').addEventListener('click', () => {
      const open = $('.toolbar').classList.toggle('filters-open');
      $('#btnFilters').setAttribute('aria-expanded', String(open));
    });
    $('#activeFilters').addEventListener('click', e => {
      const b = e.target.closest('[data-clear]');
      if (!b) return;
      const next = b.nextElementSibling || b.previousElementSibling; // para no perder el foco
      clearFilter(b.dataset.clear);
      const target = next && $(`#activeFilters [data-clear="${next.dataset.clear}"]`);
      (target || $('#btnFilters')).focus({ preventScroll: true });
    });

    // grid: tocar la tarjeta (su botón de título la cubre entera) -> editar;
    // los accesos de abajo (links, "Completar") llevan data-stop y hacen lo suyo
    const openCard = card => {
      if (!card.dataset.wid) return openModal(card.dataset.id);
      const w = wishlist.find(x => x.id === card.dataset.wid);
      return w && w.status === 'jugando' ? openPlayModal(w.id) : openWishModal(card.dataset.wid);
    };
    $('#grid').addEventListener('click', e => {
      if (e.target.closest('[data-stop]')) {
        const cb = e.target.closest('[data-complete]');
        const sb = e.target.closest('[data-start]');
        if (cb) { e.preventDefault(); openCompleteModal(cb.dataset.complete); }
        if (sb) { e.preventDefault(); startPlaying(sb.dataset.start); }
        return;
      }
      const card = e.target.closest('.card');
      if (card) openCard(card);
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
        closeModal(); closeSettings(); closeTop10();
      }
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

    // ajustes (admin): invitados
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnInvite').addEventListener('click', addInvite);
    $('#f_invite').addEventListener('keydown', e => { if (e.key === 'Enter') addInvite(); });
    $('#inviteList').addEventListener('click', e => {
      const b = e.target.closest('.inv-del');
      if (b) removeInvite(b.dataset.email);
    });
    $('#btnCloseSettings').addEventListener('click', closeSettings);
    $('#btnCloseSettings2').addEventListener('click', closeSettings);
    $('#settingsBackdrop').addEventListener('click', e => { if (e.target.id === 'settingsBackdrop') closeSettings(); });

    // flechas de horas (de a 1) y nota (de a 0,1); mantener apretado repite
    let repeatT = null, repeatI = null;
    const stopRepeat = () => { clearTimeout(repeatT); clearInterval(repeatI); };
    const stepOnce = btn => {
      const box = btn.closest('.stepper');
      const input = $('#' + box.dataset.for);
      const cfg = box.dataset;
      const step = Number(cfg.step), dec = step < 1 ? 1 : 0;
      const next = Math.min(Number(cfg.max), Math.max(Number(cfg.min), (Number(input.value) || 0) + step * Number(btn.dataset.dir)));
      input.value = next.toFixed(dec);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    $$('.step-btn').forEach(btn => {
      btn.addEventListener('click', e => { if (e.detail === 0) stepOnce(btn); }); // teclado
      btn.addEventListener('pointerdown', e => {
        e.preventDefault(); stepOnce(btn); stopRepeat();
        repeatT = setTimeout(() => { repeatI = setInterval(() => stepOnce(btn), 70); }, 400);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stopRepeat));
    });
    // horas: entero de hasta 3 cifras
    $('#f_hours').addEventListener('input', () => {
      const el = $('#f_hours');
      const clean = el.value.replace(/\D/g, '').slice(0, 3);
      if (el.value !== clean) el.value = clean;
    });
    // comentario plegable
    $('#btnNoteToggle').addEventListener('click', () => { setNoteOpen(true); $('#f_note').focus(); });

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

      // el <select> nativo queda solo como dato: fuera del recorrido con Tab y del lector de pantalla
      sel.tabIndex = -1;
      sel.setAttribute('aria-hidden', 'true');
      const baseLabel = sel.getAttribute('aria-label') || '';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cs-btn';
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = `<span class="cs-label"></span>${csChev}`;

      const menu = document.createElement('ul');
      menu.className = 'cs-menu';
      menu.setAttribute('role', 'listbox');
      menu.id = sel.id + '-menu';
      if (baseLabel) menu.setAttribute('aria-label', baseLabel);
      btn.setAttribute('aria-controls', menu.id);

      wrap.appendChild(btn);
      wrap.appendChild(menu);
      wrap.classList.add('cs-ready');

      function labelText() {
        const o = sel.options[sel.selectedIndex];
        return o ? o.textContent : '';
      }
      function syncLabel() {
        const t = labelText();
        btn.querySelector('.cs-label').textContent = t;
        btn.setAttribute('aria-label', baseLabel ? `${baseLabel}: ${t}` : t);
      }
      function buildMenu() {
        menu.innerHTML = [...sel.options].map(o =>
          `<li class="cs-opt" role="option" data-val="${escapeAttr(o.value)}" aria-selected="${o.selected}" tabindex="-1">${csTick}<span>${escapeHTML(o.textContent)}</span></li>`
        ).join('');
      }
      function open(focusOption) {
        $$('.select-wrap.cs-open').forEach(w => w !== wrap && w.classList.remove('cs-open'));
        buildMenu();
        wrap.classList.add('cs-open');
        btn.setAttribute('aria-expanded', 'true');
        if (focusOption) (menu.querySelector('[aria-selected="true"]') || menu.firstElementChild).focus();
      }
      function close(returnFocus) {
        wrap.classList.remove('cs-open');
        btn.setAttribute('aria-expanded', 'false');
        if (returnFocus) btn.focus();
      }
      function choose(opt) {
        sel.value = opt.dataset.val;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        syncLabel();
        close(true);
      }

      btn.addEventListener('click', e => {
        e.stopPropagation();
        // e.detail === 0: activado con Enter/Espacio → el foco entra a las opciones
        wrap.classList.contains('cs-open') ? close() : open(e.detail === 0);
      });
      btn.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(true); }
      });
      menu.addEventListener('click', e => {
        const opt = e.target.closest('.cs-opt');
        if (opt) choose(opt);
      });
      menu.addEventListener('keydown', e => {
        const opts = $$('.cs-opt', menu);
        const i = opts.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); (opts[i + 1] || opts[i] || opts[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (opts[i - 1] || opts[0]).focus(); }
        else if (e.key === 'Home') { e.preventDefault(); opts[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); opts[opts.length - 1].focus(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (opts[i]) choose(opts[i]); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
        else if (e.key === 'Tab') close(false);
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
    $('#btnGateLogout').hidden = mode !== 'denied' && mode !== 'error';
    $('#btnGateLogout').textContent = mode === 'error' ? 'Cerrar sesión' : 'Usar otra cuenta';
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
      await loadGames();
    } catch (e) {
      console.error(e); showGate('error'); return;
    }
    renderUser();
    $('#btnSettings').hidden = !me.admin;
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

  // clave para detectar repetidos y reenlazar pendientes con su juego completado
  // "1 juego" / "3 juegos"
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const gameKey = g => String(g.title || '').trim().toLowerCase() + '|' + String(g.date || '').slice(0, 4);
  const wishKey = w => String(w.title || '').trim().toLowerCase();
  // para no repetir entre secciones: ignora mayúsculas, acentos, ™/® y signos
  const looseKey = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[™®©]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  function exportGames() {
    const cleanGames = games.map(({ id, createdAt, ...g }) => g);
    const cleanWish = wishlist.map(({ id, completedGameId, createdAt, ...w }) => {
      const done = completedGameId && games.find(g => g.id === completedGameId);
      return done ? { ...w, completedKey: gameKey(done) } : w;
    });
    const stamp = new Date().toISOString().slice(0, 10);
    download(`videojuegos-completados-${stamp}.json`, JSON.stringify({
      app: 'videojuegos-completados', version: 2, exportedAt: new Date().toISOString(),
      games: cleanGames, wishlist: cleanWish
    }, null, 2));
    toast(`Exportados ${count(cleanGames.length, "juego", "juegos")} y ${count(cleanWish.length, "pendiente", "pendientes")}`);
  }

  // carátula subida en la versión anterior (dataURL) -> a Storage
  async function importCover(cover) {
    cover = String(cover || '');
    if (!cover.startsWith('data:')) return cover;
    try { return await DB.uploadCover(await shrinkImage(await (await fetch(cover)).blob())); }
    catch (e) { return ''; }
  }

  // valores de un archivo importado, dentro de los rangos que acepta la base
  function cleanImported(x) {
    const num = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));
    return {
      ...x,
      title: String(x.title).trim().slice(0, 200),
      platform: String(x.platform || '').slice(0, 40),
      date: String(x.date || '').slice(0, 10),
      hours: Math.round(num(x.hours, 0, 100000)),
      rating: Math.round(num(x.rating, 0, 10) * 10) / 10,
      mc: Math.round(num(x.mc, 0, 100)),
      note: String(x.note || '').slice(0, 5000)
    };
  }

  // acepta el export nuevo ({ games, wishlist }) y la lista de la versión anterior ([...])
  async function importGames(file) {
    let gList, wList;
    try {
      const parsed = JSON.parse(await file.text());
      gList = Array.isArray(parsed) ? parsed : parsed.games || [];
      wList = Array.isArray(parsed) ? [] : parsed.wishlist || [];
      if (!Array.isArray(gList) || !Array.isArray(wList)) throw new Error('formato');
    } catch (e) { toast('Ese archivo no es una lista de juegos'); return; }

    const haveG = new Set(games.map(gameKey));
    const haveW = new Set([...wishlist, ...games].map(x => looseKey(x.title)));
    const freshG = gList.filter(g => g && String(g.title || '').trim() && !haveG.has(gameKey(g)));
    const freshW = wishlistReady ? wList.filter(w => w && String(w.title || '').trim() && !haveW.has(looseKey(w.title))) : [];
    const skipped = gList.length - freshG.length + wList.length - freshW.length;
    if (!freshG.length && !freshW.length) { toast(skipped ? 'Todo eso ya estaba en tu lista' : 'El archivo está vacío'); return; }

    toast(`Importando ${count(freshG.length + freshW.length, "juego", "juegos")}…`);
    try {
      const readyG = [];
      for (const g of freshG) readyG.push({ ...cleanImported(g), cover: await importCover(g.cover) });
      if (readyG.length) games.push(...await DB.insertGames(readyG));

      const byKey = new Map(games.map(g => [gameKey(g), g.id]));
      const readyW = [];
      for (const w of freshW) {
        readyW.push({ ...cleanImported(w), cover: await importCover(w.cover), completedGameId: byKey.get(w.completedKey) || null });
      }
      if (readyW.length) wishlist.push(...await DB.insertWishes(readyW));
    } catch (e) {
      console.error(e); renderAll(); toast('No se pudo importar todo — revisa tu conexión'); return;
    }
    renderAll();
    const parts = [freshG.length && count(freshG.length, "juego", "juegos"), freshW.length && count(freshW.length, "pendiente", "pendientes")].filter(Boolean).join(' y ');
    toast(`Importados ${parts}` + (skipped ? ` (${count(skipped, "repetido omitido", "repetidos omitidos")})` : ''));
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
    let theme = 'light';
    try { theme = localStorage.getItem(THEME_KEY) || 'light'; } catch (e) { /* noop */ }
    applyTheme(theme);
    bind();
    bindAccount();
    let saved = 'done';
    try { saved = localStorage.getItem(SECTION_KEY) || 'done'; } catch (e) { /* noop */ }
    setSection(saved, true);
    enhanceSelects();
    document.addEventListener('click', () => $$('.select-wrap.cs-open').forEach(w => w.classList.remove('cs-open')));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.select-wrap.cs-open').forEach(w => w.classList.remove('cs-open')); });
    renderMarquee();

    if (!DB || !DB.configured) { showGate('config'); return; }
    const oauthError = readOAuthError();
    DB.onAuthChange(event => { if (event === 'SIGNED_OUT') location.reload(); });
    let session;
    try { session = await DB.getSession(); }
    catch (e) { console.error(e); showGate('error'); return; }
    if (!session) { showGate('login', oauthError); return; }
    await enter(session);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

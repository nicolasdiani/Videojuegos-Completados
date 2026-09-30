/* ============================================================
   Videojuegos completados — datos en la nube (Supabase)
   Expone window.VJDB para app.js
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.VJ_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const BUCKET = 'covers';
  const PUBLIC_PREFIX = `/storage/v1/object/public/${BUCKET}/`;

  // filas de la base (snake_case) <-> objetos de la app (camelCase)
  const fromRow = r => ({
    id: r.id,
    title: r.title,
    platform: r.platform || '',
    date: r.date || '',
    hours: Number(r.hours) || 0,
    rating: Number(r.rating) || 0,
    cover: r.cover || '',
    note: r.note || '',
    mc: r.mc || 0,
    rawgSlug: r.rawg_slug || '',
    releaseYear: r.release_year || '',
    createdAt: r.created_at || ''
  });
  const toRow = g => ({
    title: g.title,
    platform: g.platform || '',
    date: String(g.date || ''),
    hours: Number(g.hours) || 0,
    rating: Number(g.rating) || 0,
    cover: g.cover || '',
    note: g.note || '',
    mc: Number(g.mc) || 0,
    rawg_slug: g.rawgSlug || '',
    release_year: String(g.releaseYear || '')
  });

  const wishFromRow = r => ({
    id: r.id,
    title: r.title,
    platform: r.platform || '',
    cover: r.cover || '',
    note: r.note || '',
    mc: r.mc || 0,
    rawgSlug: r.rawg_slug || '',
    releaseYear: r.release_year || '',
    priority: r.priority === 'alta' ? 'alta' : 'normal',
    completedGameId: r.completed_game_id || null,
    createdAt: r.created_at || ''
  });
  const wishToRow = w => ({
    title: w.title,
    platform: w.platform || '',
    cover: w.cover || '',
    note: w.note || '',
    mc: Number(w.mc) || 0,
    rawg_slug: w.rawgSlug || '',
    release_year: String(w.releaseYear || ''),
    priority: w.priority === 'alta' ? 'alta' : 'normal',
    completed_game_id: w.completedGameId || null
  });

  function must(res) {
    if (res.error) throw res.error;
    return res.data;
  }

  // Supabase devuelve como máximo 1000 filas por consulta: se piden de a tandas hasta traer todo.
  // El orden fijo (fecha de alta + id) evita repetir o saltear filas entre tandas.
  const PAGE = 1000;
  async function selectAll(table) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const data = must(await sb.from(table).select('*')
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(from, from + PAGE - 1));
      rows.push(...data);
      if (data.length < PAGE) return rows;
    }
  }

  let currentUserId = null;

  window.VJDB = {
    configured,

    /* ---------- sesión ---------- */
    async getSession() {
      const { data } = await sb.auth.getSession();
      currentUserId = data.session ? data.session.user.id : null;
      return data.session;
    },
    onAuthChange(cb) {
      sb.auth.onAuthStateChange((event, session) => {
        currentUserId = session ? session.user.id : null;
        cb(event, session);
      });
    },
    signInWithGoogle() {
      return sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + location.pathname }
      });
    },
    signOut() { return sb.auth.signOut(); },

    async access() {
      const [allowed, admin] = await Promise.all([sb.rpc('is_allowed'), sb.rpc('is_admin')]);
      return { allowed: !!must(allowed), admin: !!must(admin) };
    },

    /* ---------- juegos ---------- */
    async listGames() {
      return (await selectAll('games')).map(fromRow);
    },
    async insertGame(g) {
      return fromRow(must(await sb.from('games').insert(toRow(g)).select().single()));
    },
    async insertGames(list) {
      const out = [];
      for (let i = 0; i < list.length; i += 200) {
        const rows = must(await sb.from('games').insert(list.slice(i, i + 200).map(toRow)).select());
        out.push(...rows.map(fromRow));
      }
      return out;
    },
    async updateGame(id, g) {
      return fromRow(must(await sb.from('games').update(toRow(g)).eq('id', id).select().single()));
    },
    async deleteGame(id) {
      must(await sb.from('games').delete().eq('id', id));
    },

    /* ---------- wishlist ---------- */
    async listWishlist() {
      return (await selectAll('wishlist')).map(wishFromRow);
    },
    async insertWish(w) {
      return wishFromRow(must(await sb.from('wishlist').insert(wishToRow(w)).select().single()));
    },
    async insertWishes(list) {
      const out = [];
      for (let i = 0; i < list.length; i += 200) {
        const rows = must(await sb.from('wishlist').insert(list.slice(i, i + 200).map(wishToRow)).select());
        out.push(...rows.map(wishFromRow));
      }
      return out;
    },
    async updateWish(id, w) {
      return wishFromRow(must(await sb.from('wishlist').update(wishToRow(w)).eq('id', id).select().single()));
    },
    async deleteWish(id) {
      must(await sb.from('wishlist').delete().eq('id', id));
    },

    /* ---------- carátulas subidas ---------- */
    async uploadCover(blob) {
      const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${currentUserId}/${crypto.randomUUID()}.${ext}`;
      must(await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg' }));
      return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    },
    isOwnCover(url) {
      return !!url && !!cfg.supabaseUrl && url.startsWith(cfg.supabaseUrl) && url.includes(PUBLIC_PREFIX);
    },
    async removeCover(url) {
      if (!this.isOwnCover(url)) return;
      const path = decodeURIComponent(url.slice(url.indexOf(PUBLIC_PREFIX) + PUBLIC_PREFIX.length));
      await sb.storage.from(BUCKET).remove([path]); // si falla queda un archivo huérfano, no es grave
    },

    /* ---------- búsqueda en RAWG (Edge Function con la clave como secreto) ---------- */
    async searchGames(q) {
      const { data, error } = await sb.functions.invoke('rawg-search', { body: { q } });
      if (error) throw error;
      return data.results || [];
    },

    /* ---------- invitados (solo admin) ---------- */
    async listInvites() {
      return must(await sb.from('allowed_emails').select('email, created_at').order('created_at'));
    },
    async addInvite(email) {
      must(await sb.from('allowed_emails').insert({ email: email.trim().toLowerCase() }));
    },
    async removeInvite(email) {
      must(await sb.from('allowed_emails').delete().eq('email', email));
    }
  };
})();

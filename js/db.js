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
    releaseYear: r.release_year || ''
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

  function must(res) {
    if (res.error) throw res.error;
    return res.data;
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
      return must(await sb.from('games').select('*')).map(fromRow);
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

    /* ---------- configuración compartida ---------- */
    async getConfig(key) {
      const row = must(await sb.from('app_config').select('value').eq('key', key).maybeSingle());
      return row ? row.value : '';
    },
    async setConfig(key, value) {
      must(await sb.from('app_config').upsert({ key, value }));
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

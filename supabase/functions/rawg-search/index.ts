// Edge Function "rawg-search": busca juegos en IGDB (todas las plataformas). Conserva el nombre para no cambiar la app.
// Las credenciales de Twitch son secretos (IGDB_CLIENT_ID, IGDB_CLIENT_SECRET) y nunca llegan al navegador.
// Solo responde a usuarios logueados e invitados.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const TIMEOUT_MS = 7000; // si IGDB no contesta, la app deja escribir el nombre a mano sin esperar más

// clave pública del proyecto: la legacy "anon" o, en proyectos nuevos, la publishable por defecto
function publicKey(): string {
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (anon) return anon;
  try { return JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default ?? ''; } catch { return ''; }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// el token de Twitch dura semanas: se guarda mientras la función siga viva
let token = '';
let tokenExpires = 0;

async function getToken(id: string, secret: string): Promise<string> {
  if (token && Date.now() < tokenExpires) return token;
  const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`;
  const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error('twitch_' + r.status);
  const data = await r.json();
  token = data.access_token;
  tokenExpires = Date.now() + (Number(data.expires_in) - 60) * 1000;
  return token;
}

function igdb(id: string, access: string, body: string) {
  return fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: { 'Client-ID': id, Authorization: `Bearer ${access}`, Accept: 'application/json', 'Content-Type': 'text/plain' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
}

// mismo formato que espera la app (el de RAWG)
function toResult(g: Record<string, any>) {
  return {
    name: g.name,
    slug: g.slug,
    released: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : '',
    background_image: g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : '',
    metacritic: g.aggregated_rating ? Math.round(g.aggregated_rating) : 0,
    platforms: (g.platforms ?? []).map((p: { name?: string }) => ({ platform: { name: p.name ?? '' } }))
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // ¿quién llama? — mismo control que el resto de la web: logueado + invitado
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, publicKey(), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  });
  const { data: user } = await sb.auth.getUser();
  if (!user?.user) return json({ error: 'no_session' }, 401);
  const { data: allowed } = await sb.rpc('is_allowed');
  if (!allowed) return json({ error: 'not_invited' }, 403);

  const id = Deno.env.get('IGDB_CLIENT_ID');
  const secret = Deno.env.get('IGDB_CLIENT_SECRET');
  if (!id || !secret) return json({ error: 'missing_key' }, 500);

  let q = '';
  try { q = String((await req.json()).q ?? '').trim().slice(0, 100); } catch { /* cuerpo vacío */ }
  if (q.length < 2) return json({ results: [] });

  const safe = q.replace(/\s+/g, ' ').replace(/["\\]/g, '\\$&');
  const query = `search "${safe}"; fields name,slug,first_release_date,cover.image_id,platforms.name,aggregated_rating; where version_parent = null; limit 15;`;

  try {
    let r = await igdb(id, await getToken(id, secret), query);
    if (r.status === 401) { // token vencido o revocado: se pide otro una vez
      token = '';
      r = await igdb(id, await getToken(id, secret), query);
    }
    if (!r.ok) {
      console.error('IGDB', r.status, await r.text());
      return json({ error: 'igdb_' + r.status }, 502);
    }
    return json({ results: (await r.json()).map(toResult) });
  } catch (e) {
    console.error('IGDB', e);
    return json({ error: 'igdb_unavailable' }, 502);
  }
});

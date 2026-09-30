// Edge Function "rawg-search": busca juegos en RAWG con la clave guardada como secreto (RAWG_KEY).
// La clave nunca llega al navegador. Solo responde a usuarios logueados e invitados.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // ¿quién llama? — mismo control que el resto de la web: logueado + invitado
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  });
  const { data: user } = await sb.auth.getUser();
  if (!user?.user) return json({ error: 'no_session' }, 401);
  const { data: allowed } = await sb.rpc('is_allowed');
  if (!allowed) return json({ error: 'not_invited' }, 403);

  const key = Deno.env.get('RAWG_KEY');
  if (!key) return json({ error: 'missing_key' }, 500);

  let q = '';
  try { q = String((await req.json()).q ?? '').trim().slice(0, 100); } catch { /* cuerpo vacío */ }
  if (q.length < 2) return json({ results: [] });

  const url = `https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&search=${encodeURIComponent(q)}&page_size=7`;
  const r = await fetch(url);
  if (!r.ok) return json({ error: 'rawg_' + r.status }, 502);
  const data = await r.json();

  // solo los campos que usa la app
  const results = (data.results ?? []).map((g: Record<string, unknown>) => ({
    name: g.name,
    slug: g.slug,
    released: g.released,
    background_image: g.background_image,
    metacritic: g.metacritic,
    playtime: g.playtime,
    platforms: g.platforms
  }));
  return json({ results });
});

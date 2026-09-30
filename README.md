# Videojuegos completados

Registro de videojuegos terminados: nota, horas, plataforma, año, carátula y comentario.
Cada usuario tiene su propia lista en la nube; se entra con Google y solo por invitación.
Autocompletado de datos con la API de [RAWG](https://rawg.io/apidocs).

Origen: export de Claude Design (`Videojuegos completados (para enviar).html`), desempaquetado el 2026-09-29.
Se quitó el panel de "Tweaks" (React + Babel), que solo funcionaba dentro del editor de Claude Design.

**Configuración inicial:** ver [SETUP.md](SETUP.md).

## Estructura

```
index.html                 marcado de la app (incluye la pantalla de acceso)
css/styles.css             estilos (sistema "candy / neo-brutalista", tema claro/oscuro)
js/config.js               URL y anon key de Supabase
js/db.js                   acceso a Supabase: sesión, juegos, carátulas, invitados, búsqueda RAWG
js/app.js                  lógica de la interfaz (JS vanilla)
fonts/                     Anton + Archivo (woff2, servidas localmente)
privacidad.html            política de privacidad y condiciones (la pide Google OAuth)
supabase/schema.sql        tablas, reglas de acceso (RLS), hook de invitados, bucket de carátulas
supabase/functions/        Edge Function rawg-search (búsqueda con la clave como secreto)
herramientas/              exportar los datos de la versión anterior (localStorage)
```

## Cómo funciona

- **Acceso:** login con Google (Supabase Auth). Solo entran los emails de `allowed_emails`;
  el hook `hook_before_user_created` bloquea el registro del resto y las reglas RLS bloquean sus datos.
- **Admin:** los emails de la tabla `admins` ven el engranaje para gestionar invitados.
- **Autocompletado:** la app llama a la Edge Function `rawg-search`, que busca en RAWG con el secreto
  `RAWG_KEY`; la clave nunca llega al navegador y la función solo responde a invitados.
- **Juegos:** tabla `games`, cada fila con `user_id`; cada usuario solo ve y edita los suyos.
- **Carátulas subidas:** se reducen a 800px (JPEG) en el navegador y se suben al bucket `covers/<user_id>/`.
- **Tema claro/oscuro:** preferencia local del navegador.

## Correr en local

```bash
npx http-server . -p 5173 -c-1
```

y abrir http://localhost:5173 (tiene que estar en *Redirect URLs* de Supabase).

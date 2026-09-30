# Configuración (una sola vez)

La web usa **Supabase** (gratis) para el login con Google, guardar los juegos de cada usuario y las carátulas subidas.
Tiempo estimado: 20–30 minutos.

## 1. Crear el proyecto en Supabase

1. Entra en https://supabase.com, crea una cuenta y un proyecto nuevo (región: South America / São Paulo).
2. Guarda la contraseña de la base que te pide (no la usa la web, pero no se puede recuperar).

## 2. Crear las tablas

1. En el proyecto: **SQL Editor → New query**.
2. Pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y pulsa **Run**.
3. En una query nueva, con **tu Gmail**, corre:

   ```sql
   insert into public.allowed_emails (email) values ('tu_email@gmail.com') on conflict do nothing;
   insert into public.admins (email) values ('tu_email@gmail.com') on conflict do nothing;
   ```

   (en minúsculas; ese es el email con el que vas a entrar con Google).

## 3. Activar el filtro de invitados

**Authentication → Hooks → Add hook → Before User Created**
- Tipo: **Postgres**
- Schema: `public` · Function: `hook_before_user_created`

Con esto, un email que no está en la lista no llega ni a crear cuenta.
(Aunque no lo actives, la base ya bloquea sus datos; el hook evita cuentas basura).

## 4. Login con Google

**En Google Cloud** (https://console.cloud.google.com):
1. Crea un proyecto → **APIs y servicios → Pantalla de consentimiento OAuth**: tipo *Externo*, nombre "Videojuegos completados", tu email. Publícala (*En producción*) para que entren tus amigos.
2. **Credenciales → Crear credenciales → ID de cliente OAuth** → *Aplicación web*.
3. En **URIs de redireccionamiento autorizados** pega la *Callback URL* que muestra Supabase en el paso siguiente
   (tiene la forma `https://<tu-proyecto>.supabase.co/auth/v1/callback`).
4. Copia el **Client ID** y el **Client secret**.

**En Supabase**: **Authentication → Sign In / Providers → Google** → activar, pegar Client ID y Secret → Save.

## 5. URLs permitidas

**Authentication → URL Configuration**
- **Site URL**: la dirección donde quede publicada la web (p. ej. `https://<usuario>.github.io/videojuegos-completados/`).
- **Redirect URLs**: agrega esa misma y `http://localhost:5173/` (para probar en la PC).

## 6. Conectar la web

**Project Settings → API** (o el botón **Connect**): copia *Project URL* y la *anon / publishable key* en [`js/config.js`](js/config.js):

```js
window.VJ_CONFIG = {
  supabaseUrl: 'https://xxxx.supabase.co',
  supabaseAnonKey: 'eyJ...'
};
```

La anon key es pública por diseño (va en el navegador); lo que protege los datos son las reglas de la base.
**Nunca** pongas ahí la `service_role` key.

## 7. Primer uso

1. Abre la web → **Entrar con Google** con tu Gmail.
2. Engranaje (solo lo ve el admin):
   - **Invitados**: agrega los emails de tus amigos.
   - **Clave de RAWG**: pégala una vez y sirve para todos (https://rawg.io/apidocs).

## 8. Pasar tus juegos de la versión anterior

Los juegos de la versión vieja están guardados en el navegador donde abrías `Videojuegos completados (para enviar).html`.

1. Copia [`herramientas/exportar-datos-viejos.html`](herramientas/exportar-datos-viejos.html) a la **misma carpeta** que ese HTML (Descargas).
2. Ábrelo con doble clic **en el mismo navegador** → **Descargar .json**.
3. En la web nueva: tu avatar → **Importar juegos (.json)**. Las carátulas que habías subido se pasan a la nube; los repetidos se omiten.

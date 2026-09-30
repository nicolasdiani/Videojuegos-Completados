-- ============================================================
-- Videojuegos completados — esquema de Supabase
-- Pegar entero en Supabase > SQL Editor > New query > Run.
-- Se puede volver a correr sin romper nada.
-- ============================================================

-- ---------- invitados y administradores ----------
create table if not exists public.allowed_emails (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table if not exists public.admins (
  email text primary key check (email = lower(email))
);

-- ¿el usuario logueado está invitado?
create or replace function public.is_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.allowed_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ¿el usuario logueado es administrador?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admins
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

alter table public.allowed_emails enable row level security;
alter table public.admins enable row level security;

drop policy if exists "admin gestiona invitados" on public.allowed_emails;
create policy "admin gestiona invitados" on public.allowed_emails
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- admins: sin políticas => nadie la toca desde la web; se edita solo desde el panel de Supabase.

-- ---------- bloqueo de registro: solo emails invitados ----------
-- Se activa en Authentication > Hooks > "Before User Created" (ver SETUP.md).
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.allowed_emails
    where email = lower(coalesce(event -> 'user' ->> 'email', ''))
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Esta web es por invitación'
  ));
end;
$$;

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;

-- ---------- juegos ----------
create table if not exists public.games (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null,
  platform     text not null default '',
  date         text not null default '',      -- año de finalización (AAAA)
  hours        numeric not null default 0,
  rating       numeric not null default 0 check (rating between 0 and 10),
  cover        text not null default '',      -- URL (RAWG o Storage)
  note         text not null default '',
  mc           integer not null default 0,    -- nota de Metacritic
  rawg_slug    text not null default '',
  release_year text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists games_user_id_idx on public.games (user_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists games_touch on public.games;
create trigger games_touch before update on public.games
  for each row execute function public.touch_updated_at();

alter table public.games enable row level security;

drop policy if exists "cada uno sus juegos" on public.games;
create policy "cada uno sus juegos" on public.games
  for all to authenticated
  using (user_id = auth.uid() and public.is_allowed())
  with check (user_id = auth.uid() and public.is_allowed());

-- ---------- configuración compartida (clave de RAWG) ----------
create table if not exists public.app_config (
  key   text primary key,
  value text not null default ''
);

alter table public.app_config enable row level security;

drop policy if exists "invitados leen config" on public.app_config;
create policy "invitados leen config" on public.app_config
  for select to authenticated using (public.is_allowed());

drop policy if exists "admin escribe config" on public.app_config;
create policy "admin escribe config" on public.app_config
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- carátulas subidas (Storage) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- cada usuario escribe solo en su carpeta: covers/<user_id>/...
drop policy if exists "covers: subir propias" on storage.objects;
create policy "covers: subir propias" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text and public.is_allowed());

drop policy if exists "covers: borrar propias" on storage.objects;
create policy "covers: borrar propias" on storage.objects
  for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- permisos de la API ----------
-- Explícitos, por si el proyecto se creó sin "Automatically expose new tables".
-- Lo que cada usuario puede ver o tocar lo deciden las políticas RLS de arriba.
revoke all on public.games, public.allowed_emails, public.admins, public.app_config from anon;
grant select, insert, update, delete on public.games to authenticated;
grant select, insert, delete on public.allowed_emails to authenticated;
grant select, insert, update on public.app_config to authenticated;
revoke execute on function public.is_allowed(), public.is_admin() from anon, public;
grant execute on function public.is_allowed(), public.is_admin() to authenticated;

-- ============================================================
-- PRIMER ARRANQUE: reemplazá TU_EMAIL@gmail.com por tu Gmail y corré estas dos líneas.
-- ============================================================
-- insert into public.allowed_emails (email) values ('TU_EMAIL@gmail.com') on conflict do nothing;
-- insert into public.admins (email) values ('TU_EMAIL@gmail.com') on conflict do nothing;
